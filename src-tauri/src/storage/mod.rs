use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;

mod items;
pub use items::*;
mod settings;

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
        Ok(Storage { conn: Mutex::new(conn), root })
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
            assert_eq!(v, 2);
            let cols: Vec<String> = conn
                .prepare("SELECT name FROM pragma_table_info('items')").unwrap()
                .query_map([], |r| r.get::<_, String>(0)).unwrap()
                .map(|r| r.unwrap()).collect();
            for c in ["pinned", "preview_path", "deleted_at"] {
                assert!(cols.contains(&c.to_string()), "missing column {c}");
            }
        }
        // Reopen: must not error (idempotent) and stay at v2.
        drop(s);
        let s2 = Storage::open(&db).unwrap();
        let v: i64 = s2.conn.lock().unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);
    }
}
