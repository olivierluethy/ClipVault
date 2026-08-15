use rusqlite::params;
use uuid::Uuid;
use super::levenshtein::{Matcher, MAX_HAYSTACK_CHARS};
use super::query::{self, QueryFilters};
use super::Storage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum ItemType { Text, Image, Gif, Link, Number, Color, File }

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemType::Text => "text",
            ItemType::Image => "image",
            ItemType::Gif => "gif",
            ItemType::Link => "link",
            ItemType::Number => "number",
            ItemType::Color => "color",
            ItemType::File => "file",
        }
    }
    // Paired with as_str(); used when reading typed items back in a later phase.
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> ItemType {
        match s {
            "image" => ItemType::Image,
            "gif" => ItemType::Gif,
            "link" => ItemType::Link,
            "number" => ItemType::Number,
            "color" => ItemType::Color,
            "file" => ItemType::File,
            _ => ItemType::Text,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewItem {
    pub item_type: ItemType,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    pub content_hash: String,
    /// Window class of the app the content came from, when known.
    pub source_app: Option<String>,
    /// The `text/html` flavour offered alongside the plain text, when there was one.
    pub html: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InsertOutcome { Inserted(String), Bumped(String) }

#[derive(Debug, Clone, serde::Serialize)]
pub struct ItemDto {
    pub id: String,
    pub item_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    /// Passive dedup bookkeeping: how many times identical content was *captured*
    /// (bumped on re-capture). Kept for recency collapse; NOT shown as the usage count.
    pub copy_count: i64,
    /// Deliberate reuse from within ClipVault: incremented only when the user re-copies
    /// this item (Copy button / row click). This is the honest "I needed this again"
    /// signal — pastes into other apps are unobservable and never counted. Powers the
    /// "Used N×" badge and the Frequent ranking.
    pub reuse_count: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// JSON-encoded `link_meta::LinkMeta` (title + favicon URL), filled in asynchronously
    /// after a link item is captured. `None` until the background fetch completes (or if
    /// link metadata fetching is disabled / the fetch failed).
    pub metadata: Option<String>,
    /// Optional self-destruct time (epoch ms). When set and reached, a background
    /// reaper hard-deletes the item. `None` = keeps forever (the default).
    pub expires_at: Option<i64>,
    /// Window class of the app that was focused when this was copied, when it could be
    /// determined (X11 only — Wayland does not let a client ask). `None` for entries
    /// captured before this was recorded, and for anything the app created itself.
    pub source_app: Option<String>,
    /// The `text/html` flavour the source offered alongside plain text, when there was
    /// one. Present means the entry can be copied back with its formatting intact.
    pub html: Option<String>,
}

pub(crate) const ITEM_COLS: &str =
    "id, type, content, file_path, preview_path, copy_count, reuse_count, pinned, created_at, updated_at, metadata, expires_at, source_app, html";

pub(crate) fn map_item(r: &rusqlite::Row) -> rusqlite::Result<ItemDto> {
    Ok(ItemDto {
        id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?, file_path: r.get(3)?,
        preview_path: r.get(4)?, copy_count: r.get(5)?, reuse_count: r.get(6)?,
        pinned: r.get::<_, i64>(7)? != 0, created_at: r.get(8)?, updated_at: r.get(9)?,
        metadata: r.get(10)?, expires_at: r.get(11)?, source_app: r.get(12)?,
        html: r.get(13)?,
    })
}

/// Normalises an item's text into a scoring haystack: lowercased (matching is
/// case-insensitive) and capped at [`MAX_HAYSTACK_CHARS`], so one enormous pasted
/// document can't dominate the cost of a keystroke.
fn haystack(s: &str) -> String {
    s.chars()
        .take(MAX_HAYSTACK_CHARS)
        .flat_map(|c| c.to_lowercase())
        .collect()
}

impl Storage {
    pub fn insert_or_bump(&self, item: NewItem, now: i64) -> rusqlite::Result<InsertOutcome> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = match conn.query_row(
            "SELECT id FROM items WHERE content_hash = ?1",
            params![item.content_hash],
            |r| r.get(0),
        ) {
            Ok(id) => Some(id),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        if let Some(id) = existing {
            conn.execute(
                "UPDATE items SET copy_count = copy_count + 1, created_at = ?1, updated_at = ?1, deleted_at = NULL WHERE id = ?2",
                params![now, id],
            )?;
            return Ok(InsertOutcome::Bumped(id));
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO items (id, type, content, file_path, preview_path, content_hash, copy_count, created_at, updated_at, source_app, html)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, ?8, ?9)",
            params![id, item.item_type.as_str(), item.content, item.file_path, item.preview_path, item.content_hash, now, item.source_app, item.html],
        )?;
        if let Some(content) = &item.content {
            conn.execute(
                "INSERT INTO items_fts (item_id, content) VALUES (?1, ?2)",
                params![id, content],
            )?;
        }
        Ok(InsertOutcome::Inserted(id))
    }

    // Superseded by `list_items` (compound-cursor pagination); kept for its existing tests.
    #[allow(dead_code)]
    pub fn list_recent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows: rusqlite::Result<Vec<ItemDto>> = stmt.query_map(params![limit], map_item)?.collect();
        rows
    }

    pub fn list_items(
        &self,
        limit: i64,
        before_created_at: Option<i64>,
        before_id: Option<&str>,
    ) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND pinned = 0
               AND (?2 IS NULL
                    OR created_at < ?2
                    OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<ItemDto> = stmt
            .query_map(rusqlite::params![limit, before_created_at, before_id], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Items whose `created_at` falls in the half-open range `[from_ms, to_ms)`, newest
    /// first, cursor-paginated. Includes pinned items (a date view should show
    /// everything captured that day). Powers the date filter.
    pub fn list_items_in_range(
        &self,
        from_ms: i64,
        to_ms: i64,
        limit: i64,
        before_created_at: Option<i64>,
        before_id: Option<&str>,
    ) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL
               AND created_at >= ?4 AND created_at < ?5
               AND (?2 IS NULL
                    OR created_at < ?2
                    OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<ItemDto> = stmt
            .query_map(
                rusqlite::params![limit, before_created_at, before_id, from_ms, to_ms],
                map_item,
            )?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn list_by_type(
        &self,
        type_str: &str,
        limit: i64,
        before_created_at: Option<i64>,
        before_id: Option<&str>,
    ) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND type = ?4
               AND (?2 IS NULL
                    OR created_at < ?2
                    OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<ItemDto> = stmt
            .query_map(rusqlite::params![limit, before_created_at, before_id, type_str], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Record a deliberate reuse of an item from within ClipVault (Copy button / row
    /// click). Bumps only `reuse_count` — never `copy_count`, `created_at`, or
    /// `updated_at` — so the honest usage count rises without reshuffling the timeline.
    pub fn increment_reuse(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET reuse_count = reuse_count + 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Items the user has actually reused from ClipVault (`reuse_count >= 1`), ranked by
    /// how often (`reuse_count` desc), then most recently touched (`updated_at` desc,
    /// `id` desc to break exact ties). Powers the "Frequent" smart view. Ranking is over
    /// the whole live history; the result is capped at `limit` (top-N), not paginated.
    pub fn list_frequent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND reuse_count >= 1
             ORDER BY reuse_count DESC, updated_at DESC, id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<ItemDto> = stmt
            .query_map(rusqlite::params![limit], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Live items newest-first, pinned included — the true copy order the clipboard
    /// stack walks down. Distinct from `list_items`, which hides pinned entries because
    /// the timeline shows them in their own section.
    pub fn list_stack(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC, id DESC LIMIT ?1"
        ))?;
        let rows: Vec<ItemDto> =
            stmt.query_map(params![limit], map_item)?.collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Distinct applications entries were copied from, with counts, most-used first.
    /// Feeds the app filter and the blocklist picker in Settings.
    pub fn list_source_apps(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT source_app, COUNT(*) AS n FROM items
             WHERE deleted_at IS NULL AND source_app IS NOT NULL AND source_app <> ''
             GROUP BY source_app ORDER BY n DESC, source_app ASC",
        )?;
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// How many live items qualify for the "Frequent" view (`reuse_count >= 1`).
    /// Drives the sidebar count next to that view; independent of the top-N cap.
    pub fn frequent_count(&self) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND reuse_count >= 1",
            [],
            |r| r.get(0),
        )
    }

    /// Distinct local calendar days that contain at least one live item, with counts,
    /// as `("YYYY-MM-DD", n)`. Powers the date-picker's populated-day highlighting.
    pub fn item_day_counts(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*)
             FROM items WHERE deleted_at IS NULL
             GROUP BY day",
        )?;
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn folder_counts(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT type, COUNT(*) FROM items WHERE deleted_at IS NULL GROUP BY type"
        )?;
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn list_pinned(&self) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND pinned = 1 ORDER BY created_at DESC"
        ))?;
        let rows: rusqlite::Result<Vec<ItemDto>> = stmt.query_map([], map_item)?.collect();
        rows
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET pinned = ?1 WHERE id = ?2",
            params![pinned as i64, id],
        )?;
        Ok(())
    }

    pub fn soft_delete(&self, id: &str, now: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn update_content(&self, id: &str, content: &str, now: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![content, now, id],
        )?;
        // items_fts is a plain (non-external-content) FTS5 table with no unique
        // constraint to UPSERT against, so re-sync via delete+insert.
        conn.execute("DELETE FROM items_fts WHERE item_id = ?1", params![id])?;
        conn.execute(
            "INSERT INTO items_fts (item_id, content) VALUES (?1, ?2)",
            params![id, content],
        )?;
        Ok(())
    }

    /// Set (or clear, with `None`) an item's self-destruct time (epoch ms).
    pub fn set_expiry(&self, id: &str, expires_at: Option<i64>) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET expires_at = ?1 WHERE id = ?2",
            params![expires_at, id],
        )?;
        Ok(())
    }

    /// Hard-delete every item whose expiry has passed (`expires_at <= now`), returning
    /// the `(file_path, preview_path)` of each so the caller can remove attachments.
    /// Irreversible — ephemeral items are truly gone (no soft-delete/undo).
    pub fn purge_expired(&self, now: i64) -> rusqlite::Result<Vec<(Option<String>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let victims: Vec<(String, Option<String>, Option<String>)> = conn
            .prepare("SELECT id, file_path, preview_path FROM items WHERE expires_at IS NOT NULL AND expires_at <= ?1")?
            .query_map(params![now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut files = Vec::with_capacity(victims.len());
        for (id, fp, pp) in victims {
            conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
            conn.execute("DELETE FROM items_fts WHERE item_id = ?1", params![id])?;
            conn.execute("DELETE FROM item_folders WHERE item_id = ?1", params![id])?;
            files.push((fp, pp));
        }
        Ok(files)
    }

    pub fn restore(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET deleted_at = NULL WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Store OCR text recognized from an image item, and mirror it into the FTS index
    /// so the image becomes searchable by its visible words. Replaces any existing FTS
    /// row for the item (images have none until OCR runs).
    pub fn set_ocr_text(&self, id: &str, text: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET ocr_text = ?1 WHERE id = ?2", params![text, id])?;
        conn.execute("DELETE FROM items_fts WHERE item_id = ?1", params![id])?;
        conn.execute(
            "INSERT INTO items_fts (item_id, content) VALUES (?1, ?2)",
            params![id, text],
        )?;
        Ok(())
    }

    /// Stores JSON-encoded link metadata (title + favicon URL) for an item, set
    /// asynchronously once the background fetch in `link_meta::fetch` completes.
    pub fn set_metadata(&self, id: &str, metadata_json: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET metadata = ?1 WHERE id = ?2",
            params![metadata_json, id],
        )?;
        Ok(())
    }

    pub fn get_item(&self, id: &str) -> rusqlite::Result<Option<(String, Option<String>, Option<String>, String)>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row("SELECT type, content, file_path, content_hash FROM items WHERE id=?1",
            rusqlite::params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The stored `text/html` flavour of an entry, if the source offered one.
    pub fn item_html(&self, id: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row("SELECT html FROM items WHERE id = ?1", params![id], |r| {
            r.get::<_, Option<String>>(0)
        }) {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Deletes rows already soft-deleted, returning their (file_path, preview_path)
    /// so the caller can remove the backing files. Called from `Storage::open` on startup.
    pub fn purge_deleted(&self) -> rusqlite::Result<Vec<(Option<String>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let files: Vec<(Option<String>, Option<String>)> = conn
            .prepare("SELECT file_path, preview_path FROM items WHERE deleted_at IS NOT NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        conn.execute("DELETE FROM items WHERE deleted_at IS NOT NULL", [])?;
        // Drop any folder memberships whose item no longer exists, so purging a
        // soft-deleted folder member never leaves an orphaned item_folders row.
        conn.execute(
            "DELETE FROM item_folders WHERE item_id NOT IN (SELECT id FROM items)",
            [],
        )?;
        conn.execute(
            "DELETE FROM items_fts WHERE item_id NOT IN (SELECT id FROM items)",
            [],
        )?;
        Ok(files)
    }

    /// Typo-tolerant search: ranks live content-bearing items by Levenshtein (edit)
    /// distance against `query`, so "Gtihub" still finds "Github" even though no
    /// subsequence or prefix match exists. Scoring is done by
    /// [`levenshtein::Matcher`], which measures the distance to the best-matching
    /// *window* of the item rather than the whole string, so a long clipboard entry
    /// isn't punished for being long.
    ///
    /// Closest match first, recency as the tiebreaker. **Never returns an empty list
    /// for a non-empty query** — with no relevance cutoff, the nearest items always
    /// come back even when nothing is a good match. Complements FTS5 (`search`),
    /// which is exact-prefix and therefore can come back empty.
    pub fn fuzzy_search(&self, raw_query: &str, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let filters = query::parse(raw_query, now_ms());
        let needle = filters.text.trim().to_lowercase();
        let matcher = Matcher::new(&needle);
        // `type:link` on its own is a legitimate query: no text to rank by, so the
        // filtered rows come back newest-first.
        if matcher.is_none() && filters.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().unwrap();
        // Cap the scan so a huge history can't make search sluggish. Images carry no
        // `content`, so they only qualify once OCR has given them recognised text.
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS}, ocr_text FROM items
             WHERE deleted_at IS NULL AND (content IS NOT NULL OR ocr_text IS NOT NULL)
             ORDER BY created_at DESC LIMIT 5000"
        ))?;
        let candidates: Vec<(ItemDto, Option<String>)> = stmt
            .query_map([], |r| Ok((map_item(r)?, r.get::<_, Option<String>>(14)?)))?
            .collect::<rusqlite::Result<_>>()?;

        let mut scored: Vec<(f64, ItemDto)> = candidates
            .into_iter()
            .filter(|(it, _)| filters.matches(it))
            .map(|(it, ocr)| {
                let Some(matcher) = matcher.as_ref() else {
                    // Filter-only query: recency is the whole ranking.
                    return (0.0, it);
                };
                // An image's words are as good a match target as a text item's body,
                // so score both haystacks and keep whichever is closer.
                let mut best = matcher.score(&haystack(it.content.as_deref().unwrap_or("")));
                if let Some(ocr) = ocr.as_deref().filter(|s| !s.is_empty()) {
                    best = best.max(matcher.score(&haystack(ocr)));
                }
                (best, it)
            })
            .collect();
        // Best score first; ties broken by recency.
        scored.sort_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(b.1.created_at.cmp(&a.1.created_at))
        });
        scored.truncate(limit.max(0) as usize);
        Ok(scored.into_iter().map(|(_, it)| it).collect())
    }

    /// Full-text search over item content via FTS5. Matches the whole query as a
    /// single phrase with trailing-token prefix matching (e.g. "hel" matches "hello").
    /// The query is escaped into a quoted phrase so arbitrary user input can never be
    /// interpreted as FTS5 query syntax.
    pub fn search(&self, raw_query: &str, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let filters = query::parse(raw_query, now_ms());
        let text = filters.text.trim();
        if text.is_empty() {
            // Filter-only query (`type:link is:pinned`): no phrase to match, so this is
            // a plain newest-first listing of whatever survives the filters.
            return self.filtered_recent(&filters, limit);
        }
        let fts = format!("\"{}\"*", text.replace('"', "\"\""));
        let conn = self.conn.lock().unwrap();
        let cols: String = ITEM_COLS
            .split(", ")
            .map(|c| format!("i.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {cols} FROM items i
             JOIN items_fts f ON f.item_id = i.id
             WHERE items_fts MATCH ?1 AND i.deleted_at IS NULL
             ORDER BY i.created_at DESC
             LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        // Over-fetch when filters will thin the results, so a filtered search doesn't
        // come back short just because the discarded rows used up the limit.
        let fetch = if filters.is_empty() { limit } else { limit.saturating_mul(8).min(5000) };
        let rows: Vec<ItemDto> = stmt
            .query_map(params![fts, fetch], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows
            .into_iter()
            .filter(|it| filters.matches(it))
            .take(limit.max(0) as usize)
            .collect())
    }

    /// Newest-first listing of the live items surviving `filters`. Backs a query made
    /// only of filters, with no text to match.
    fn filtered_recent(&self, filters: &QueryFilters, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        if filters.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 5000"
        ))?;
        let rows: Vec<ItemDto> = stmt.query_map([], map_item)?.collect::<rusqlite::Result<_>>()?;
        Ok(rows
            .into_iter()
            .filter(|it| filters.matches(it))
            .take(limit.max(0) as usize)
            .collect())
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    #[test]
    fn insert_then_duplicate_bumps() {
        let (_d, s) = storage();
        let item = NewItem { item_type: ItemType::Text, content: Some("hi".into()),
            file_path: None, preview_path: None, content_hash: "h1".into(), source_app: None, html: None };
        let a = s.insert_or_bump(item.clone(), 1000).unwrap();
        assert!(matches!(a, InsertOutcome::Inserted(_)));
        let b = s.insert_or_bump(item.clone(), 2000).unwrap();
        assert!(matches!(b, InsertOutcome::Bumped(_)));

        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].copy_count, 2);
        assert_eq!(rows[0].created_at, 2000);
    }

    #[test]
    fn list_recent_orders_newest_first() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("a".into()),file_path:None,preview_path:None,content_hash:"a".into()},100).unwrap();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("b".into()),file_path:None,preview_path:None,content_hash:"b".into()},200).unwrap();
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("b"));
        assert_eq!(rows[1].content.as_deref(), Some("a"));
    }

    #[test]
    fn list_items_pages_excludes_pinned_and_deleted() {
        let (_d, s) = storage();
        let mk = |c: &str, hash: &str, t: i64| s.insert_or_bump(
            NewItem{item_type:ItemType::Text, content:Some(c.into()), file_path:None, preview_path:None, content_hash:hash.into()}, t).unwrap();
        mk("a","ha",100); mk("b","hb",200); mk("c","hc",300);
        // page 1: newest first
        let p1 = s.list_items(2, None, None).unwrap();
        assert_eq!(p1.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(), vec!["c","b"]);
        // page 2 via compound cursor = last row's (created_at, id)
        let last = p1.last().unwrap();
        let p2 = s.list_items(2, Some(last.created_at), Some(&last.id)).unwrap();
        assert_eq!(p2.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(), vec!["a"]);
        // pin "b" -> excluded from list_items, present in list_pinned
        let id_b = s.list_items(10, None, None).unwrap().into_iter().find(|i| i.content.as_deref()==Some("b")).unwrap().id;
        s.set_pinned(&id_b, true).unwrap();
        assert!(s.list_items(10, None, None).unwrap().iter().all(|i| i.content.as_deref()!=Some("b")));
        assert_eq!(s.list_pinned().unwrap().len(), 1);
    }

    #[test]
    fn list_items_pages_without_skipping_tied_timestamps() {
        let (_d, s) = storage();
        // three items with the SAME created_at (ties)
        for (c, h) in [("a","ha"),("b","hb"),("c","hc")] {
            s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some(c.into()),file_path:None,preview_path:None,content_hash:h.into()}, 500).unwrap();
        }
        let mut seen = Vec::new();
        let mut cursor: Option<(i64, String)> = None;
        loop {
            let page = match &cursor {
                None => s.list_items(2, None, None).unwrap(),
                Some((ts, id)) => s.list_items(2, Some(*ts), Some(id)).unwrap(),
            };
            if page.is_empty() { break; }
            for it in &page { seen.push(it.content.clone().unwrap()); }
            let last = page.last().unwrap();
            cursor = Some((last.created_at, last.id.clone()));
            if page.len() < 2 { break; }
        }
        seen.sort();
        assert_eq!(seen, vec!["a","b","c"]);  // all three retrieved, none skipped
    }

    #[test]
    fn reuse_count_only_bumps_on_deliberate_reuse_not_capture() {
        let (_d, s) = storage();
        let mk = |c: &str, h: &str| NewItem {
            item_type: ItemType::Text, content: Some(c.into()),
            file_path: None, preview_path: None, content_hash: h.into(),
        };
        // Capture the same content twice (passive dedup): copy_count rises, reuse stays 0.
        s.insert_or_bump(mk("captured-twice", "h1"), 100).unwrap();
        s.insert_or_bump(mk("captured-twice", "h1"), 200).unwrap();
        let row = s.list_items(10, None, None).unwrap()
            .into_iter().find(|i| i.content.as_deref() == Some("captured-twice")).unwrap();
        assert_eq!(row.copy_count, 2, "capture dedup still bumps copy_count");
        assert_eq!(row.reuse_count, 0, "passive capture must NOT count as reuse");
        // A never-reused item never appears in Frequent, regardless of copy_count.
        assert_eq!(s.list_frequent(100).unwrap().len(), 0);
        assert_eq!(s.frequent_count().unwrap(), 0);

        // Deliberate reuse bumps reuse_count only (not copy_count / timestamps).
        s.increment_reuse(&row.id).unwrap();
        let row2 = s.list_items(10, None, None).unwrap()
            .into_iter().find(|i| i.id == row.id).unwrap();
        assert_eq!(row2.reuse_count, 1);
        assert_eq!(row2.copy_count, 2, "reuse must not touch copy_count");
        assert_eq!(row2.updated_at, row.updated_at, "reuse must not touch updated_at");
        assert_eq!(s.frequent_count().unwrap(), 1);
    }

    #[test]
    fn list_frequent_ranks_by_reuse_and_excludes_unused() {
        let (_d, s) = storage();
        let mk = |c: &str, h: &str| NewItem {
            item_type: ItemType::Text, content: Some(c.into()),
            file_path: None, preview_path: None, content_hash: h.into(),
        };
        let id = |c: &str| s.list_items(50, None, None).unwrap()
            .into_iter().find(|i| i.content.as_deref() == Some(c)).unwrap().id;
        // "unused" is captured but never reused → excluded. Others reused N times.
        s.insert_or_bump(mk("unused", "h0"), 100).unwrap();
        s.insert_or_bump(mk("once", "h1"), 100).unwrap();
        s.insert_or_bump(mk("twice", "h2"), 200).unwrap();
        s.insert_or_bump(mk("thrice", "h3"), 300).unwrap();
        s.increment_reuse(&id("once")).unwrap();
        for _ in 0..2 { s.increment_reuse(&id("twice")).unwrap(); }
        for _ in 0..3 { s.increment_reuse(&id("thrice")).unwrap(); }

        let rows = s.list_frequent(100).unwrap();
        assert_eq!(
            rows.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(),
            vec!["thrice", "twice", "once"] // most-reused first, "unused" absent
        );
        assert_eq!(s.frequent_count().unwrap(), 3);

        // Tie on reuse_count → more recently touched (updated_at) wins.
        s.insert_or_bump(mk("tie-old", "h4"), 400).unwrap();
        s.insert_or_bump(mk("tie-new", "h5"), 700).unwrap();
        s.increment_reuse(&id("tie-old")).unwrap();
        s.increment_reuse(&id("tie-new")).unwrap();
        let ones: Vec<String> = s.list_frequent(100).unwrap().into_iter()
            .filter(|i| i.reuse_count == 1)
            .map(|i| i.content.unwrap())
            .collect();
        assert_eq!(ones, vec!["tie-new", "tie-old", "once"]);
    }

    #[test]
    fn soft_delete_hides_then_restore_then_purge() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("x".into()),file_path:None,preview_path:None,content_hash:"hx".into()},100).unwrap();
        let id = s.list_items(10, None, None).unwrap()[0].id.clone();
        s.soft_delete(&id, 500).unwrap();
        assert_eq!(s.list_items(10, None, None).unwrap().len(), 0);   // hidden
        s.restore(&id).unwrap();
        assert_eq!(s.list_items(10, None, None).unwrap().len(), 1);   // back
        s.soft_delete(&id, 600).unwrap();
        let purged = s.purge_deleted().unwrap();
        assert_eq!(purged.len(), 1);
        // row is gone entirely now
        let conn = s.conn.lock().unwrap();
        let n: i64 = conn.query_row("SELECT count(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn recopy_undeletes_soft_deleted_item() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("z".into()),file_path:None,preview_path:None,content_hash:"hz".into()}, 100).unwrap();
        let id = s.list_items(10, None, None).unwrap()[0].id.clone();
        s.soft_delete(&id, 200).unwrap();
        assert_eq!(s.list_items(10, None, None).unwrap().len(), 0); // hidden
        // re-copy same content -> should reappear (un-deleted) and bump
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("z".into()),file_path:None,preview_path:None,content_hash:"hz".into()}, 300).unwrap();
        let rows = s.list_items(10, None, None).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].copy_count >= 2);
    }

    #[test]
    fn get_item_returns_fields() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("q".into()),file_path:None,preview_path:None,content_hash:"hq".into()},1).unwrap();
        let id = s.list_items(10,None,None).unwrap()[0].id.clone();
        let got = s.get_item(&id).unwrap().unwrap();
        assert_eq!(got.0, "text"); assert_eq!(got.1.as_deref(), Some("q")); assert_eq!(got.3, "hq");
    }

    #[test]
    fn set_metadata_persists_json() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Link,content:Some("https://example.com".into()),file_path:None,preview_path:None,content_hash:"hl".into()},1).unwrap();
        let id = s.list_items(10,None,None).unwrap()[0].id.clone();
        assert_eq!(s.list_items(10,None,None).unwrap()[0].metadata, None);
        s.set_metadata(&id, r#"{"title":"Example","favicon_url":"https://example.com/favicon.ico"}"#).unwrap();
        let row = s.list_items(10,None,None).unwrap().into_iter().next().unwrap();
        assert_eq!(row.metadata.as_deref(), Some(r#"{"title":"Example","favicon_url":"https://example.com/favicon.ico"}"#));
    }

    #[test]
    fn get_item_missing_returns_none() {
        let (_d, s) = storage();
        assert!(s.get_item("nope").unwrap().is_none());
    }

    #[test]
    fn update_content_changes_text_and_updated_at() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("old".into()),file_path:None,preview_path:None,content_hash:"he".into()}, 100).unwrap();
        let id = s.list_items(10, None, None).unwrap()[0].id.clone();
        s.update_content(&id, "new value", 500).unwrap();
        let row = s.list_items(10, None, None).unwrap().into_iter().next().unwrap();
        assert_eq!(row.content.as_deref(), Some("new value"));
        assert_eq!(row.updated_at, 500);
    }

    #[test]
    fn set_pinned_toggles() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("p".into()),file_path:None,preview_path:None,content_hash:"hp".into()},100).unwrap();
        let id = s.list_items(10,None,None).unwrap()[0].id.clone();
        s.set_pinned(&id, true).unwrap();
        assert_eq!(s.list_pinned().unwrap().len(), 1);
        s.set_pinned(&id, false).unwrap();
        assert_eq!(s.list_pinned().unwrap().len(), 0);
    }

    #[test]
    fn list_by_type_filters_and_includes_pinned() {
        let (_d, s) = storage();
        let mk = |ty: ItemType, c: &str, h: &str, t: i64| s.insert_or_bump(NewItem{item_type:ty,content:Some(c.into()),file_path:None,preview_path:None,content_hash:h.into()}, t).unwrap();
        mk(ItemType::Text,"a","ha",100);
        mk(ItemType::Link,"https://x","hb",200);
        mk(ItemType::Link,"https://y","hc",300);
        // pin one link -> still appears in the link folder
        let link_id = s.list_by_type("link", 10, None, None).unwrap()[0].id.clone();
        s.set_pinned(&link_id, true).unwrap();
        let links = s.list_by_type("link", 10, None, None).unwrap();
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|i| i.item_type == "link"));
        let texts = s.list_by_type("text", 10, None, None).unwrap();
        assert_eq!(texts.len(), 1);
    }

    #[test]
    fn folder_counts_groups_by_type() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("a".into()),file_path:None,preview_path:None,content_hash:"ha".into()},1).unwrap();
        s.insert_or_bump(NewItem{item_type:ItemType::Color,content:Some("#fff".into()),file_path:None,preview_path:None,content_hash:"hb".into()},2).unwrap();
        let counts: std::collections::HashMap<String,i64> = s.folder_counts().unwrap().into_iter().collect();
        assert_eq!(counts.get("text"), Some(&1));
        assert_eq!(counts.get("color"), Some(&1));
    }

    #[test]
    fn search_finds_matching_items_by_content() {
        let (_d, s) = storage();
        let mk = |c: &str, h: &str, t: i64| s.insert_or_bump(
            NewItem{item_type:ItemType::Text, content:Some(c.into()), file_path:None, preview_path:None, content_hash:h.into()}, t).unwrap();
        mk("hello world", "h1", 100);
        mk("the quick brown fox", "h2", 200);
        mk("a link https://rust-lang.org", "h3", 300);

        let r = s.search("quick", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].content.as_deref(), Some("the quick brown fox"));

        let r = s.search("hello", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].content.as_deref(), Some("hello world"));

        // prefix match on last token
        let r = s.search("http", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].content.as_deref(), Some("a link https://rust-lang.org"));
    }

    #[test]
    fn search_empty_query_returns_empty() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("hello".into()),file_path:None,preview_path:None,content_hash:"h1".into()}, 100).unwrap();
        assert!(s.search("", 10).unwrap().is_empty());
        assert!(s.search("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn search_excludes_soft_deleted_items() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("hello world".into()),file_path:None,preview_path:None,content_hash:"h1".into()}, 100).unwrap();
        let id = s.list_items(10, None, None).unwrap()[0].id.clone();
        s.soft_delete(&id, 200).unwrap();
        assert!(s.search("hello", 10).unwrap().is_empty());
    }

    #[test]
    fn search_reflects_updated_content() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("old value".into()),file_path:None,preview_path:None,content_hash:"h1".into()}, 100).unwrap();
        let id = s.list_items(10, None, None).unwrap()[0].id.clone();
        s.update_content(&id, "brand new phrase", 200).unwrap();
        assert!(s.search("old", 10).unwrap().is_empty());
        let r = s.search("brand", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].content.as_deref(), Some("brand new phrase"));
    }

    #[test]
    fn search_handles_fts_special_characters_without_error() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("hello world".into()),file_path:None,preview_path:None,content_hash:"h1".into()}, 100).unwrap();
        // Adversarial inputs that would break a naive FTS5 query must not error.
        for q in ["\"", "a OR b", "NEAR(x y)", "foo*", "-bar", "\" OR items_fts MATCH \"x"] {
            let res = s.search(q, 10);
            assert!(res.is_ok(), "search({q:?}) must not error, got {res:?}");
        }
        // A plain prefix still works.
        assert_eq!(s.search("hel", 10).unwrap().len(), 1);
    }
}
