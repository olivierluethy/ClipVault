use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;

mod items;
pub use items::*;
mod settings;
mod folders;
pub use folders::*;
mod maintenance;
pub use maintenance::*;

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

        // Encryption-at-rest (Story 1.2): resolve the SQLCipher key (OS keyring by
        // default; overridable via CLIPVAULT_KEY; None under tests → plain SQLite).
        // If an existing DB file is still plaintext, transparently re-encrypt it once
        // before opening.
        let key = resolve_db_key();
        if let Some(k) = &key {
            migrate_plaintext_to_encrypted(db_path, k)?;
        }

        let conn = Connection::open(db_path)?;
        if let Some(k) = &key {
            apply_key(&conn, k)?;
        }
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
    if version < 5 {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(item_id UNINDEXED, content);
             INSERT INTO items_fts(item_id, content)
               SELECT id, content FROM items
               WHERE content IS NOT NULL AND id NOT IN (SELECT item_id FROM items_fts);",
        )?;
        conn.execute("PRAGMA user_version = 5", [])?;
        version = 5;
    }
    if version < 6 {
        let existing: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('items')")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        if !existing.iter().any(|c| c == "metadata") {
            conn.execute("ALTER TABLE items ADD COLUMN metadata TEXT", [])?;
        }
        conn.execute("PRAGMA user_version = 6", [])?;
        version = 6;
    }
    if version < 7 {
        // Perf: the type-filtered timeline (`list_by_type`) filters on `type` and
        // orders by (created_at DESC, id DESC); a covering composite index avoids a
        // full scan + temp-sort as the history grows.
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_items_type_created ON items(type, created_at DESC, id DESC)",
            [],
        )?;
        conn.execute("PRAGMA user_version = 7", [])?;
        version = 7;
    }
    if version < 8 {
        // Deliberate-reuse counter (Task): distinct from copy_count (which counts passive
        // capture dedups). Starts at 0 for every existing and new item; only a reuse from
        // within ClipVault bumps it. Backfilling from copy_count would be wrong — those
        // are accidental captures, not reuses — so all history starts fresh at 0.
        let existing: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('items')")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        if !existing.iter().any(|c| c == "reuse_count") {
            conn.execute("ALTER TABLE items ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0", [])?;
        }
        conn.execute("PRAGMA user_version = 8", [])?;
        version = 8;
    }
    let _ = version;
    Ok(())
}

// ─── Encryption at rest (SQLCipher + OS keyring) ────────────────────────────────

/// Resolve the SQLCipher passphrase. Order: `CLIPVAULT_KEY` env override (power users
/// / tooling), then the OS keyring (get-or-create a random key). Returns `None` under
/// `cfg(test)` (so unit tests run on plain, unencrypted temp DBs) and if the keyring is
/// unavailable — in which case the DB is opened unencrypted rather than failing to start.
fn resolve_db_key() -> Option<String> {
    if let Ok(k) = std::env::var("CLIPVAULT_KEY") {
        if !k.is_empty() {
            return Some(k);
        }
    }
    keyring_key()
}

#[cfg(test)]
fn keyring_key() -> Option<String> {
    None
}

/// Fetch the app's DB key from the OS Secret Service, creating (and storing) a fresh
/// random one on first run. A `None` here means "open unencrypted" — chosen over a hard
/// failure so a missing/locked keyring never bricks the app.
#[cfg(not(test))]
fn keyring_key() -> Option<String> {
    let entry = keyring::Entry::new("clipvault", "database-key").ok()?;
    match entry.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        _ => {
            // 256 bits of randomness as hex (two v4 UUIDs = 244 random bits).
            let key = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            match entry.set_password(&key) {
                Ok(()) => Some(key),
                Err(e) => {
                    eprintln!("clipvault: could not store DB key in keyring ({e}); opening unencrypted");
                    None
                }
            }
        }
    }
}

/// Apply the SQLCipher key to a freshly opened connection, before any other access.
fn apply_key(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    let escaped = key.replace('\'', "''");
    conn.execute_batch(&format!("PRAGMA key = '{escaped}';"))
}

/// Return true if `db_path` opens and reads with `key` (i.e. it's already encrypted
/// with this key, or is a fresh/empty file).
fn opens_with_key(db_path: &Path, key: &str) -> bool {
    match Connection::open(db_path) {
        Ok(conn) => {
            apply_key(&conn, key).is_ok()
                && conn
                    .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
                    .is_ok()
        }
        Err(_) => false,
    }
}

/// One-time migration: if `db_path` exists as a *plaintext* SQLite DB, re-encrypt it in
/// place with `key` using `sqlcipher_export`. The original is backed up alongside as
/// `*.plaintext.bak` before the swap. No-op for a missing/empty file or a DB already
/// encrypted with this key.
fn migrate_plaintext_to_encrypted(db_path: &Path, key: &str) -> rusqlite::Result<()> {
    if !db_path.exists() {
        return Ok(());
    }
    if std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0) == 0 {
        return Ok(());
    }
    if opens_with_key(db_path, key) {
        return Ok(()); // already encrypted (or empty) — nothing to do
    }

    let db_str = db_path.to_string_lossy().to_string();
    let enc_path = format!("{db_str}.enc");
    let bak_path = format!("{db_str}.plaintext.bak");

    // Preserve the original before touching anything.
    std::fs::copy(db_path, &bak_path).map_err(cantopen)?;
    let _ = std::fs::remove_file(&enc_path);

    {
        let plain = Connection::open(db_path)?;
        // Fold any WAL back into the main file so the export sees a consistent state.
        let _ = plain.pragma_update(None, "journal_mode", "DELETE");
        let esc_enc = enc_path.replace('\'', "''");
        let esc_key = key.replace('\'', "''");
        plain.execute_batch(&format!(
            "ATTACH DATABASE '{esc_enc}' AS encrypted KEY '{esc_key}';
             SELECT sqlcipher_export('encrypted');
             DETACH DATABASE encrypted;"
        ))?;
    }

    // Swap the encrypted copy in for the plaintext original, and drop its stale WAL/SHM.
    std::fs::rename(&enc_path, db_path).map_err(cantopen)?;
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{db_str}{suffix}"));
    }
    Ok(())
}

fn cantopen(e: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
        Some(format!("encryption migration failed: {e}")),
    )
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
            assert_eq!(v, 8);
            let cols: Vec<String> = conn
                .prepare("SELECT name FROM pragma_table_info('items')").unwrap()
                .query_map([], |r| r.get::<_, String>(0)).unwrap()
                .map(|r| r.unwrap()).collect();
            for c in ["pinned", "preview_path", "deleted_at", "metadata", "reuse_count"] {
                assert!(cols.contains(&c.to_string()), "missing column {c}");
            }
        }
        // Reopen: must not error (idempotent) and stay at the latest version.
        drop(s);
        let s2 = Storage::open(&db).unwrap();
        let v: i64 = s2.conn.lock().unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 8);
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

    #[test]
    fn migration_v5_backfills_fts_from_existing_items() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        let s = Storage::open(&db).unwrap();
        {
            let conn = s.conn.lock().unwrap();
            // Simulate a row that predates the FTS table (inserted directly, bypassing
            // the items.rs insert path that keeps items_fts in sync).
            conn.execute(
                "INSERT INTO items (id,type,content,content_hash,copy_count,created_at,updated_at) \
                 VALUES ('pre','text','backfill me','pre',1,1,1)",
                [],
            ).unwrap();
            // Pretend this DB predates v5 (no items_fts row for 'pre' yet), then rerun the migration.
            conn.execute("PRAGMA user_version = 4", []).unwrap();
            migrate(&conn).unwrap();
            let found: String = conn
                .query_row(
                    "SELECT content FROM items_fts WHERE item_id = 'pre'",
                    [], |r| r.get(0),
                ).unwrap();
            assert_eq!(found, "backfill me");
        }
    }
}
