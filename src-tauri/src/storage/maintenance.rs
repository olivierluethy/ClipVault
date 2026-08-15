use std::path::Path;
use rusqlite::params;
use super::Storage;

/// A full item row for export — every persisted column, so an import can round-trip.
/// Attachment *bytes* aren't included here (they live on disk); the IPC export layer
/// reads `file_path`/`preview_path` and base64-encodes them into the export file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExportRow {
    pub id: String,
    pub item_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    pub content_hash: String,
    pub copy_count: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub metadata: Option<String>,
}

/// Row to insert on import. `file_path`/`preview_path` point at files the import layer
/// has already materialized in the attachments dir.
pub struct ImportRow {
    pub item_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    pub content_hash: String,
    pub copy_count: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub metadata: Option<String>,
}

impl Storage {
    /// Count of live (non-deleted) items — shown in the Settings screen.
    pub fn item_count(&self) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM items WHERE deleted_at IS NULL", [], |r| r.get(0))
    }

    /// Total bytes used by the data dir (DB + WAL + attachments), best-effort — shown
    /// in the Settings screen. Ignores files it can't stat.
    pub fn data_size_bytes(&self) -> u64 {
        fn walk(dir: &Path) -> u64 {
            let mut total = 0;
            if let Ok(entries) = std::fs::read_dir(dir) {
                for e in entries.flatten() {
                    let path = e.path();
                    if path.is_dir() {
                        total += walk(&path);
                    } else if let Ok(meta) = e.metadata() {
                        total += meta.len();
                    }
                }
            }
            total
        }
        walk(&self.root)
    }

    /// All live items with every column, newest first — the source for export.
    pub fn export_rows(&self) -> rusqlite::Result<Vec<ExportRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, type, content, file_path, preview_path, content_hash,
                    copy_count, pinned, created_at, updated_at, metadata
             FROM items WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ExportRow {
                    id: r.get(0)?,
                    item_type: r.get(1)?,
                    content: r.get(2)?,
                    file_path: r.get(3)?,
                    preview_path: r.get(4)?,
                    content_hash: r.get(5)?,
                    copy_count: r.get(6)?,
                    pinned: r.get::<_, i64>(7)? != 0,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                    metadata: r.get(10)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// Insert an imported row, skipping duplicates (same `content_hash`). Returns
    /// `(item_id, inserted)` — the id of the row (the existing one on a duplicate, a
    /// fresh one on insert) so the caller can restore folder memberships either way,
    /// and `inserted` = whether a new row was actually created. Preserves the original
    /// timestamps / copy_count / pinned flag and keeps the FTS index in sync.
    pub fn insert_imported(&self, row: ImportRow) -> rusqlite::Result<(String, bool)> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = match conn.query_row(
            "SELECT id FROM items WHERE content_hash = ?1",
            params![row.content_hash],
            |r| r.get(0),
        ) {
            Ok(id) => Some(id),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        if let Some(id) = existing {
            return Ok((id, false));
        }
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO items
               (id, type, content, file_path, preview_path, content_hash,
                copy_count, pinned, created_at, updated_at, metadata)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                id, row.item_type, row.content, row.file_path, row.preview_path,
                row.content_hash, row.copy_count, row.pinned as i64,
                row.created_at, row.updated_at, row.metadata
            ],
        )?;
        if let Some(content) = &row.content {
            conn.execute(
                "INSERT INTO items_fts (item_id, content) VALUES (?1, ?2)",
                params![id, content],
            )?;
        }
        Ok((id, true))
    }

    /// Enforce retention limits by hard-deleting non-pinned items that are either older
    /// than `max_age_ms` (relative to `now`) or beyond the newest `max_items`. A `None`
    /// / non-positive limit disables that rule. Returns the `(file_path, preview_path)`
    /// pairs of removed rows so the caller can delete the backing attachment files.
    pub fn run_retention(
        &self,
        max_age_ms: Option<i64>,
        max_items: Option<i64>,
        now: i64,
    ) -> rusqlite::Result<Vec<(Option<String>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut victims: Vec<String> = Vec::new();

        if let Some(age) = max_age_ms.filter(|a| *a > 0) {
            let cutoff = now - age;
            let mut stmt = conn.prepare(
                "SELECT id FROM items WHERE pinned = 0 AND deleted_at IS NULL AND created_at < ?1",
            )?;
            let ids = stmt
                .query_map(params![cutoff], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            victims.extend(ids);
        }

        if let Some(max) = max_items.filter(|m| *m > 0) {
            // Delete non-pinned live items ranked beyond the newest `max`.
            let mut stmt = conn.prepare(
                "SELECT id FROM items
                 WHERE pinned = 0 AND deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC
                 LIMIT -1 OFFSET ?1",
            )?;
            let ids = stmt
                .query_map(params![max], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            victims.extend(ids);
        }

        if victims.is_empty() {
            return Ok(vec![]);
        }
        victims.sort();
        victims.dedup();

        let mut files = Vec::with_capacity(victims.len());
        for id in &victims {
            let fp: (Option<String>, Option<String>) = conn.query_row(
                "SELECT file_path, preview_path FROM items WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            files.push(fp);
            conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
            conn.execute("DELETE FROM items_fts WHERE item_id = ?1", params![id])?;
            conn.execute("DELETE FROM item_folders WHERE item_id = ?1", params![id])?;
        }
        Ok(files)
    }

    /// Write a clean, single-file snapshot of the database to `dest` via `VACUUM INTO`
    /// (safe with WAL; produces a fully self-contained copy). Used by scheduled backups
    /// and the "Backup now" button.
    pub fn backup_to(&self, dest: &Path) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        // VACUUM INTO fails if the destination already exists.
        if dest.exists() {
            let _ = std::fs::remove_file(dest);
        }
        conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy()])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{ItemType, NewItem};

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    fn add(s: &Storage, c: &str, h: &str, t: i64) {
        s.insert_or_bump(
            NewItem { item_type: ItemType::Text, content: Some(c.into()), file_path: None, preview_path: None, content_hash: h.into(), source_app: None },
            t,
        ).unwrap();
    }

    #[test]
    fn retention_by_count_keeps_newest_and_pinned() {
        let (_d, s) = storage();
        add(&s, "a", "ha", 100);
        add(&s, "b", "hb", 200);
        add(&s, "c", "hc", 300);
        // pin the oldest so it survives count-based pruning
        let id_a = s.list_items(10, None, None).unwrap().into_iter().find(|i| i.content.as_deref() == Some("a")).unwrap().id;
        s.set_pinned(&id_a, true).unwrap();
        // keep newest 1 non-pinned -> deletes "b" (a is pinned, c is newest kept)
        let removed = s.run_retention(None, Some(1), 1000).unwrap();
        assert_eq!(removed.len(), 1);
        let remaining: Vec<String> = s.list_items(10, None, None).unwrap().into_iter().map(|i| i.content.unwrap()).collect();
        assert_eq!(remaining, vec!["c"]); // b pruned; a is pinned (not in list_items)
        assert_eq!(s.list_pinned().unwrap().len(), 1);
    }

    #[test]
    fn retention_by_age_prunes_old_unpinned() {
        let (_d, s) = storage();
        add(&s, "old", "ho", 100);
        add(&s, "new", "hn", 10_000);
        // now=10_000, max_age=5_000 -> cutoff 5_000 -> "old" (100) pruned
        let removed = s.run_retention(Some(5_000), None, 10_000).unwrap();
        assert_eq!(removed.len(), 1);
        let remaining: Vec<String> = s.list_items(10, None, None).unwrap().into_iter().map(|i| i.content.unwrap()).collect();
        assert_eq!(remaining, vec!["new"]);
    }

    #[test]
    fn export_then_import_roundtrips_and_dedupes() {
        let (_d, s) = storage();
        add(&s, "hello", "h1", 100);
        add(&s, "world", "h2", 200);
        let rows = s.export_rows().unwrap();
        assert_eq!(rows.len(), 2);

        // fresh DB, import the rows
        let (_d2, s2) = storage();
        let mut inserted = 0;
        for r in &rows {
            let (_id, did) = s2.insert_imported(ImportRow {
                item_type: r.item_type.clone(), content: r.content.clone(),
                file_path: r.file_path.clone(), preview_path: r.preview_path.clone(),
                content_hash: r.content_hash.clone(), copy_count: r.copy_count,
                pinned: r.pinned, created_at: r.created_at, updated_at: r.updated_at,
                metadata: r.metadata.clone(),
            }).unwrap();
            if did { inserted += 1; }
        }
        assert_eq!(inserted, 2);
        assert_eq!(s2.item_count().unwrap(), 2);
        // re-importing the same rows inserts nothing (dedup by hash)
        for r in &rows {
            let (_id, did) = s2.insert_imported(ImportRow {
                item_type: r.item_type.clone(), content: r.content.clone(),
                file_path: r.file_path.clone(), preview_path: r.preview_path.clone(),
                content_hash: r.content_hash.clone(), copy_count: r.copy_count,
                pinned: r.pinned, created_at: r.created_at, updated_at: r.updated_at,
                metadata: r.metadata.clone(),
            }).unwrap();
            assert!(!did);
        }
        assert_eq!(s2.item_count().unwrap(), 2);
        // imported content is searchable (FTS synced)
        assert_eq!(s2.search("hello", 10).unwrap().len(), 1);
    }

    #[test]
    fn backup_to_creates_readable_copy() {
        let (dir, s) = storage();
        add(&s, "backup me", "hb", 100);
        let dest = dir.path().join("backup.db");
        s.backup_to(&dest).unwrap();
        assert!(dest.exists());
        // the backup opens and contains the row
        let restored = Storage::open(&dest).unwrap();
        assert_eq!(restored.item_count().unwrap(), 1);
    }
}
