use super::{ItemDto, Storage, map_item, ITEM_COLS};

/// A high-level snapshot of usage for the analytics dashboard (issue #7).
#[derive(Debug, Clone, serde::Serialize)]
pub struct UsageOverview {
    /// Total deliberate reuses recorded (all usage events).
    pub total_uses: i64,
    /// Distinct items that have been reused at least once.
    pub used_items: i64,
    /// Live items (not deleted, not snippets) that have never been reused.
    pub unused_items: i64,
    /// Distinct local days on which anything was used.
    pub active_days: i64,
    /// The busiest day and its count, if any usage exists.
    pub busiest_day: Option<(String, i64)>,
}

/// Per-item usage detail (issue #7): count, first/last use, and recent timestamps.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ItemUsage {
    pub count: i64,
    pub first_used: Option<i64>,
    pub last_used: Option<i64>,
    /// Most-recent usage timestamps (epoch ms), newest first, capped.
    pub recent: Vec<i64>,
}

impl Storage {
    /// Usage events grouped by local day ("YYYY-MM-DD") — powers the usage calendar.
    pub fn usage_day_counts(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date(used_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*)
             FROM usage_events
             GROUP BY day
             ORDER BY day",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// The full-history usage snapshot for the dashboard.
    pub fn usage_overview(&self) -> rusqlite::Result<UsageOverview> {
        let conn = self.conn.lock().unwrap();
        let total_uses: i64 =
            conn.query_row("SELECT COUNT(*) FROM usage_events", [], |r| r.get(0))?;
        let used_items: i64 =
            conn.query_row("SELECT COUNT(DISTINCT item_id) FROM usage_events", [], |r| r.get(0))?;
        let unused_items: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items
             WHERE deleted_at IS NULL AND is_snippet = 0 AND reuse_count = 0",
            [],
            |r| r.get(0),
        )?;
        let active_days: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT date(used_at / 1000, 'unixepoch', 'localtime')) FROM usage_events",
            [],
            |r| r.get(0),
        )?;
        let busiest_day: Option<(String, i64)> = conn
            .query_row(
                "SELECT date(used_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS c
                 FROM usage_events GROUP BY day ORDER BY c DESC, day DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        Ok(UsageOverview { total_uses, used_items, unused_items, active_days, busiest_day })
    }

    /// Usage detail for a single item.
    pub fn item_usage(&self, item_id: &str, recent_limit: i64) -> rusqlite::Result<ItemUsage> {
        let conn = self.conn.lock().unwrap();
        let (count, first_used, last_used): (i64, Option<i64>, Option<i64>) = conn.query_row(
            "SELECT COUNT(*), MIN(used_at), MAX(used_at) FROM usage_events WHERE item_id = ?1",
            rusqlite::params![item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let mut stmt = conn.prepare(
            "SELECT used_at FROM usage_events WHERE item_id = ?1 ORDER BY used_at DESC LIMIT ?2",
        )?;
        let recent = stmt
            .query_map(rusqlite::params![item_id, recent_limit], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(ItemUsage { count, first_used, last_used, recent })
    }

    /// Live items that have never been reused (the "unused" filter), newest first.
    pub fn list_unused(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND is_snippet = 0 AND reuse_count = 0
             ORDER BY created_at DESC, id DESC
             LIMIT ?1"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params![limit], map_item)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{NewItem, ItemType, InsertOutcome};

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    fn mk(s: &Storage, c: &str, h: &str) -> String {
        match s.insert_or_bump(
            NewItem {
                item_type: ItemType::Text,
                content: Some(c.into()),
                file_path: None,
                preview_path: None,
                content_hash: h.into(),
                source_app: None,
                html: None,
            },
            100,
        ).unwrap() {
            InsertOutcome::Inserted(id) | InsertOutcome::Bumped(id) => id,
        }
    }

    #[test]
    fn records_events_and_reports_overview() {
        let (_d, s) = storage();
        let a = mk(&s, "a", "ha");
        let _b = mk(&s, "b", "hb"); // never used
        s.increment_reuse(&a, 1_700_000_000_000).unwrap();
        s.increment_reuse(&a, 1_700_000_100_000).unwrap();

        let ov = s.usage_overview().unwrap();
        assert_eq!(ov.total_uses, 2);
        assert_eq!(ov.used_items, 1);
        assert_eq!(ov.unused_items, 1); // "b"

        let u = s.item_usage(&a, 10).unwrap();
        assert_eq!(u.count, 2);
        assert_eq!(u.last_used, Some(1_700_000_100_000));
        assert_eq!(u.recent.len(), 2);

        let unused = s.list_unused(10).unwrap();
        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].content.as_deref(), Some("b"));
    }
}
