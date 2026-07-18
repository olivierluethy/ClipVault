use rusqlite::params;
use uuid::Uuid;
use super::Storage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum ItemType { Text, Image, Gif }

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self { ItemType::Text => "text", ItemType::Image => "image", ItemType::Gif => "gif" }
    }
    // Paired with as_str(); used when reading typed items back in a later phase.
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> ItemType {
        match s { "image" => ItemType::Image, "gif" => ItemType::Gif, _ => ItemType::Text }
    }
}

#[derive(Debug, Clone)]
pub struct NewItem {
    pub item_type: ItemType,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    pub content_hash: String,
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
    pub copy_count: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

const ITEM_COLS: &str =
    "id, type, content, file_path, preview_path, copy_count, pinned, created_at, updated_at";

fn map_item(r: &rusqlite::Row) -> rusqlite::Result<ItemDto> {
    Ok(ItemDto {
        id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?, file_path: r.get(3)?,
        preview_path: r.get(4)?, copy_count: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0, created_at: r.get(7)?, updated_at: r.get(8)?,
    })
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
            "INSERT INTO items (id, type, content, file_path, preview_path, content_hash, copy_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![id, item.item_type.as_str(), item.content, item.file_path, item.preview_path, item.content_hash, now],
        )?;
        Ok(InsertOutcome::Inserted(id))
    }

    pub fn list_recent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows: rusqlite::Result<Vec<ItemDto>> = stmt.query_map(params![limit], map_item)?.collect();
        rows
    }

    // Wired to an IPC command in a later task; exercised directly by tests until then.
    #[allow(dead_code)]
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

    // Wired to an IPC command in a later task; exercised directly by tests until then.
    #[allow(dead_code)]
    pub fn list_pinned(&self) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND pinned = 1 ORDER BY created_at DESC"
        ))?;
        let rows: rusqlite::Result<Vec<ItemDto>> = stmt.query_map([], map_item)?.collect();
        rows
    }

    // Wired to an IPC command in a later task; exercised directly by tests until then.
    #[allow(dead_code)]
    pub fn set_pinned(&self, id: &str, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET pinned = ?1 WHERE id = ?2",
            params![pinned as i64, id],
        )?;
        Ok(())
    }

    // Wired to an IPC command in a later task; exercised directly by tests until then.
    #[allow(dead_code)]
    pub fn soft_delete(&self, id: &str, now: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    // Wired to an IPC command in a later task; exercised directly by tests until then.
    #[allow(dead_code)]
    pub fn restore(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET deleted_at = NULL WHERE id = ?1", params![id])?;
        Ok(())
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
        Ok(files)
    }
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
            file_path: None, preview_path: None, content_hash: "h1".into() };
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
    fn set_pinned_toggles() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("p".into()),file_path:None,preview_path:None,content_hash:"hp".into()},100).unwrap();
        let id = s.list_items(10,None,None).unwrap()[0].id.clone();
        s.set_pinned(&id, true).unwrap();
        assert_eq!(s.list_pinned().unwrap().len(), 1);
        s.set_pinned(&id, false).unwrap();
        assert_eq!(s.list_pinned().unwrap().len(), 0);
    }
}
