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
    pub copy_count: i64,
    pub created_at: i64,
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
                "UPDATE items SET copy_count = copy_count + 1, created_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            return Ok(InsertOutcome::Bumped(id));
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO items (id, type, content, file_path, content_hash, copy_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
            params![id, item.item_type.as_str(), item.content, item.file_path, item.content_hash, now],
        )?;
        Ok(InsertOutcome::Inserted(id))
    }

    pub fn list_recent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, type, content, file_path, copy_count, created_at
             FROM items ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| Ok(ItemDto {
            id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?,
            file_path: r.get(3)?, copy_count: r.get(4)?, created_at: r.get(5)?,
        }))?;
        rows.collect()
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
            file_path: None, content_hash: "h1".into() };
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
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("a".into()),file_path:None,content_hash:"a".into()},100).unwrap();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("b".into()),file_path:None,content_hash:"b".into()},200).unwrap();
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("b"));
        assert_eq!(rows[1].content.as_deref(), Some("a"));
    }
}
