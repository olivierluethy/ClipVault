use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;

mod items;
pub use items::*;
mod settings;
mod folders;
#[allow(unused_imports)] // FolderDto is consumed by the folders IPC layer (next task).
pub use folders::*;

pub struct Storage {
    pub(crate) conn: Mutex<Connection>,
    root: PathBuf,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  content       TEXT,
  file_path     TEXT,
  content_hash  TEXT NOT NULL,
  copy_count    INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_hash ON items(content_hash);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

impl Storage {
    pub fn open(db_path: &Path) -> rusqlite::Result<Storage> {
        let parent = db_path.parent().filter(|p| !p.as_os_str().is_empty());
        let root = parent.map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
        let attachments = root.join("attachments");
        for dir in [&root, &attachments] {
            std::fs::create_dir_all(dir).map_err(|e| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    Some(format!("failed to create dir {}: {e}", dir.display())),
                )
            })?;
        }

        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        let s = Storage { conn: Mutex::new(conn), root };
        if let Ok(purged) = s.purge_deleted() {
            for (fp, pp) in purged {
                if let Some(p) = fp { let _ = std::fs::remove_file(p); }
                if let Some(p) = pp { let _ = std::fs::remove_file(p); }
            }
        }
        Ok(s)
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join("attachments")
    }
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let mut version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    // Phase 0 DBs report 0; treat 0 and 1 as the pre-Phase-1 baseline.
    if version < 2 {
        // Add columns only if absent (a fresh SCHEMA may already differ across versions).
        let existing: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('items')")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        if !existing.iter().any(|c| c == "pinned") {
            conn.execute("ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !existing.iter().any(|c| c == "preview_path") {
            conn.execute("ALTER TABLE items ADD COLUMN preview_path TEXT", [])?;
        }
        if !existing.iter().any(|c| c == "deleted_at") {
            conn.execute("ALTER TABLE items ADD COLUMN deleted_at INTEGER", [])?;
        }
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(pinned)", [])?;
        conn.execute("PRAGMA user_version = 2", [])?;
        version = 2;
    }
    if version < 3 {
        // Backfill: items captured before link/number/color detection existed were
        // all stored as plain "text". Re-classify them now so historical links,
        // numbers, and colors move into their folders.
        let rows: Vec<(String, String)> = conn
            .prepare("SELECT id, content FROM items WHERE type = 'text' AND content IS NOT NULL")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, content) in rows {
            let new_type = crate::classifier::classify_text(&content);
            if new_type != ItemType::Text {
                conn.execute(
                    "UPDATE items SET type = ?1 WHERE id = ?2",
                    rusqlite::params![new_type.as_str(), id],
                )?;
            }
        }
        conn.execute("PRAGMA user_version = 3", [])?;
        version = 3;
    }
    if version < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folders (
               id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS item_folders (
               item_id TEXT NOT NULL, folder_id TEXT NOT NULL, PRIMARY KEY (item_id, folder_id)
             );
             CREATE INDEX IF NOT EXISTS idx_item_folders_folder ON item_folders(folder_id);",
        )?;
        conn.execute("PRAGMA user_version = 4", [])?;
        version = 4;
    }
    let _ = version;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_wal_and_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        let s = Storage::open(&db).unwrap();
        let conn = s.conn.lock().unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('items','settings')",
                [], |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn open_creates_attachments_dir() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        let s = Storage::open(&db).unwrap();
        assert!(s.attachments_dir().is_dir());
        assert!(dir.path().join("attachments").is_dir());
    }

    #[test]
    fn migration_adds_v2_columns_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        // First open migrates to v2.
        let s = Storage::open(&db).unwrap();
        {
            let conn = s.conn.lock().unwrap();
            let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
            assert_eq!(v, 4);
            let cols: Vec<String> = conn
                .prepare("SELECT name FROM pragma_table_info('items')").unwrap()
                .query_map([], |r| r.get::<_, String>(0)).unwrap()
                .map(|r| r.unwrap()).collect();
            for c in ["pinned", "preview_path", "deleted_at"] {
                assert!(cols.contains(&c.to_string()), "missing column {c}");
            }
        }
        // Reopen: must not error (idempotent) and stay at v3.
        drop(s);
        let s2 = Storage::open(&db).unwrap();
        let v: i64 = s2.conn.lock().unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 4);
    }

    #[test]
    fn migration_v3_backfills_link_number_color_from_text() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        let s = Storage::open(&db).unwrap();
        {
            let conn = s.conn.lock().unwrap();
            // Simulate pre-classification rows stored as plain "text".
            for (id, content) in [
                ("a", "https://www.bild.de"),
                ("b", "http://example.com"),
                ("c", "www.example.org"),
                ("d", "#7C6CF0"),
                ("e", "+41 79 123 45 67"),
                ("f", "just a plain note"),
            ] {
                conn.execute(
                    "INSERT INTO items (id,type,content,content_hash,copy_count,created_at,updated_at) \
                     VALUES (?1,'text',?2,?1,1,1,1)",
                    rusqlite::params![id, content],
                ).unwrap();
            }
            // Pretend this DB predates v3, then run the migration.
            conn.execute("PRAGMA user_version = 2", []).unwrap();
            migrate(&conn).unwrap();
            let ty = |id: &str| -> String {
                conn.query_row("SELECT type FROM items WHERE id=?1", [id], |r| r.get(0)).unwrap()
            };
            assert_eq!(ty("a"), "link");
            assert_eq!(ty("b"), "link");
            assert_eq!(ty("c"), "link");
            assert_eq!(ty("d"), "color");
            assert_eq!(ty("e"), "number");
            assert_eq!(ty("f"), "text");
        }
    }
}
