use anyhow::Result;
use crate::classifier::{classify, extension_for};
use crate::hashing::sha256_hex;
use crate::storage::{ItemType, NewItem, InsertOutcome, Storage};
use crate::watcher::ClipEvent;

pub const MAX_TEXT: usize = 1_048_576;      // 1 MB
pub const MAX_IMAGE: usize = 26_214_400;    // 25 MB

pub fn process_event(storage: &Storage, ev: ClipEvent) -> Result<Option<InsertOutcome>> {
    let item_type = classify(&ev.mime, &ev.bytes);

    // Size guards.
    let limit = if item_type == ItemType::Text { MAX_TEXT } else { MAX_IMAGE };
    if ev.bytes.len() > limit {
        eprintln!("clipvault: skipping oversized {:?} ({} bytes)", item_type, ev.bytes.len());
        return Ok(None);
    }

    let hash = sha256_hex(&ev.bytes);
    let now = chrono_now_millis();

    let new_item = match item_type {
        ItemType::Text => {
            let text = String::from_utf8_lossy(&ev.bytes).into_owned();
            NewItem { item_type, content: Some(text), file_path: None, content_hash: hash }
        }
        ItemType::Image | ItemType::Gif => {
            // Only write the file if this is a new hash; check first to avoid orphan files.
            let id_ext = extension_for(item_type, &ev.mime);
            let file_name = format!("{}.{}", &hash, id_ext);
            let path = storage.attachments_dir().join(&file_name);
            if !path.exists() {
                std::fs::write(&path, &ev.bytes)?;
            }
            NewItem { item_type, content: None,
                file_path: Some(path.to_string_lossy().into_owned()), content_hash: hash }
        }
    };

    Ok(Some(storage.insert_or_bump(new_item, now)?))
}

fn chrono_now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
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
    fn stores_text_event() {
        let (_d, s) = storage();
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"hello".to_vec() }).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("hello"));
        assert_eq!(rows[0].item_type, "text");
    }

    #[test]
    fn stores_image_as_file() {
        let (_d, s) = storage();
        let png = b"\x89PNG\r\n\x1a\nDATA".to_vec();
        let out = process_event(&s, ClipEvent{ mime: "image/png".into(), bytes: png.clone() }).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].item_type, "image");
        let path = rows[0].file_path.clone().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), png);
    }

    #[test]
    fn oversized_text_skipped() {
        let (_d, s) = storage();
        let big = vec![b'a'; MAX_TEXT + 1];
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: big }).unwrap();
        assert!(out.is_none());
        assert_eq!(s.list_recent(10).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_bumps_not_inserts() {
        let (_d, s) = storage();
        let ev = || ClipEvent{ mime:"UTF8_STRING".into(), bytes:b"x".to_vec() };
        process_event(&s, ev()).unwrap();
        let second = process_event(&s, ev()).unwrap();
        assert!(matches!(second, Some(InsertOutcome::Bumped(_))));
        assert_eq!(s.list_recent(10).unwrap().len(), 1);
    }
}
