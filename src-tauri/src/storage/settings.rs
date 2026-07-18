use rusqlite::params;
use super::Storage;

impl Storage {
    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        match self.get_setting(key) {
            Ok(Some(v)) => v == "1" || v.eq_ignore_ascii_case("true"),
            _ => default,
        }
    }

    pub fn set_bool(&self, key: &str, value: bool) -> rusqlite::Result<()> {
        self.set_setting(key, if value { "1" } else { "0" })
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
    fn set_get_roundtrip_and_default() {
        let (_d, s) = storage();
        assert_eq!(s.get_bool("privacy_mode", false), false);
        s.set_bool("privacy_mode", true).unwrap();
        assert_eq!(s.get_bool("privacy_mode", false), true);
        // Simulate a crash: reopen the same file, value must persist.
        drop(s);
        let s2 = Storage::open(&_d.path().join("clipvault.db")).unwrap();
        assert_eq!(s2.get_bool("privacy_mode", false), true);
    }
}
