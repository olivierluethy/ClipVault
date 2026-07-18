use rusqlite::params;
use uuid::Uuid;
use super::{Storage, ItemDto, map_item, ITEM_COLS};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub item_count: i64,
}

impl Storage {
    pub fn create_folder(&self, name: &str, now: i64) -> rusqlite::Result<String> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let next_sort: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders",
            [],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, next_sort, now],
        )?;
        Ok(id)
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])?;
        Ok(())
    }

    pub fn delete_folder(&self, id: &str, delete_items: bool, now: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        if delete_items {
            conn.execute(
                "UPDATE items SET deleted_at = ?1, updated_at = ?1
                 WHERE id IN (SELECT item_id FROM item_folders WHERE folder_id = ?2)",
                params![now, id],
            )?;
        }
        conn.execute("DELETE FROM item_folders WHERE folder_id = ?1", params![id])?;
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_folders(&self) -> rusqlite::Result<Vec<FolderDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name,
                    (SELECT COUNT(*) FROM item_folders itf
                     JOIN items i ON i.id = itf.item_id
                     WHERE itf.folder_id = f.id AND i.deleted_at IS NULL) AS item_count
             FROM folders f
             ORDER BY f.sort_order ASC, f.created_at ASC",
        )?;
        let rows: Vec<FolderDto> = stmt
            .query_map([], |r| {
                Ok(FolderDto { id: r.get(0)?, name: r.get(1)?, item_count: r.get(2)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn assign_item(&self, item_id: &str, folder_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO item_folders (item_id, folder_id) VALUES (?1, ?2)",
            params![item_id, folder_id],
        )?;
        Ok(())
    }

    pub fn unassign_item(&self, item_id: &str, folder_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM item_folders WHERE item_id = ?1 AND folder_id = ?2",
            params![item_id, folder_id],
        )?;
        Ok(())
    }

    pub fn folders_for_item(&self, item_id: &str) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT folder_id FROM item_folders WHERE item_id = ?1")?;
        let rows: Vec<String> = stmt
            .query_map(params![item_id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    pub fn list_items_in_folder(
        &self,
        folder_id: &str,
        limit: i64,
        before_created_at: Option<i64>,
        before_id: Option<&str>,
    ) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items i
             JOIN item_folders f ON f.item_id = i.id
             WHERE f.folder_id = ?4 AND i.deleted_at IS NULL
               AND (?2 IS NULL
                    OR i.created_at < ?2
                    OR (i.created_at = ?2 AND i.id < ?3))
             ORDER BY i.created_at DESC, i.id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<ItemDto> = stmt
            .query_map(params![limit, before_created_at, before_id, folder_id], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{NewItem, ItemType};

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    fn mk_item(s: &Storage, content: &str, hash: &str, t: i64) -> String {
        let outcome = s.insert_or_bump(
            NewItem {
                item_type: ItemType::Text,
                content: Some(content.into()),
                file_path: None,
                preview_path: None,
                content_hash: hash.into(),
            },
            t,
        ).unwrap();
        match outcome {
            crate::storage::InsertOutcome::Inserted(id) => id,
            crate::storage::InsertOutcome::Bumped(id) => id,
        }
    }

    #[test]
    fn create_then_list_shows_zero_count() {
        let (_d, s) = storage();
        s.create_folder("Work", 100).unwrap();
        let folders = s.list_folders().unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Work");
        assert_eq!(folders[0].item_count, 0);
    }

    #[test]
    fn assign_two_items_gives_count_two() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        let b = mk_item(&s, "b", "hb", 200);
        s.assign_item(&a, &fid).unwrap();
        s.assign_item(&b, &fid).unwrap();
        let folders = s.list_folders().unwrap();
        assert_eq!(folders[0].item_count, 2);
    }

    #[test]
    fn unassign_reduces_count() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        let b = mk_item(&s, "b", "hb", 200);
        s.assign_item(&a, &fid).unwrap();
        s.assign_item(&b, &fid).unwrap();
        s.unassign_item(&a, &fid).unwrap();
        let folders = s.list_folders().unwrap();
        assert_eq!(folders[0].item_count, 1);
    }

    #[test]
    fn folders_for_item_lists_memberships() {
        let (_d, s) = storage();
        let f1 = s.create_folder("Work", 100).unwrap();
        let f2 = s.create_folder("Personal", 200).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        s.assign_item(&a, &f1).unwrap();
        s.assign_item(&a, &f2).unwrap();
        let mut ids = s.folders_for_item(&a).unwrap();
        ids.sort();
        let mut expected = vec![f1, f2];
        expected.sort();
        assert_eq!(ids, expected);
    }

    #[test]
    fn list_items_in_folder_returns_only_members_newest_first() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        let b = mk_item(&s, "b", "hb", 200);
        let _c = mk_item(&s, "c", "hc", 300); // not in folder
        s.assign_item(&a, &fid).unwrap();
        s.assign_item(&b, &fid).unwrap();
        let items = s.list_items_in_folder(&fid, 10, None, None).unwrap();
        assert_eq!(items.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(), vec!["b", "a"]);
    }

    #[test]
    fn rename_folder_changes_name() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        s.rename_folder(&fid, "Renamed").unwrap();
        let folders = s.list_folders().unwrap();
        assert_eq!(folders[0].name, "Renamed");
    }

    #[test]
    fn delete_folder_keep_items_leaves_items_in_history() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        s.assign_item(&a, &fid).unwrap();
        s.delete_folder(&fid, false, 500).unwrap();
        assert_eq!(s.list_folders().unwrap().len(), 0);
        // item still present in main history list
        assert!(s.list_items(10, None, None).unwrap().iter().any(|i| i.id == a));
    }

    #[test]
    fn delete_folder_with_delete_items_soft_deletes_members() {
        let (_d, s) = storage();
        let fid = s.create_folder("Work", 100).unwrap();
        let a = mk_item(&s, "a", "ha", 100);
        let b = mk_item(&s, "b", "hb", 200); // not in folder
        s.assign_item(&a, &fid).unwrap();
        s.delete_folder(&fid, true, 500).unwrap();
        assert_eq!(s.list_folders().unwrap().len(), 0);
        let remaining = s.list_items(10, None, None).unwrap();
        assert!(remaining.iter().all(|i| i.id != a));
        assert!(remaining.iter().any(|i| i.id == b));
    }
}
