use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;

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
        Ok(Storage { conn: Mutex::new(conn), root })
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join("attachments")
    }
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
}
