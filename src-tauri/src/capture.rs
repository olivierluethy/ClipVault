use anyhow::Result;
use crate::classifier::{classify, classify_text, extension_for};
use crate::hashing::sha256_hex;
use crate::storage::{ItemType, NewItem, InsertOutcome, Storage};
use crate::watcher::ClipEvent;

pub const MAX_TEXT: usize = 1_048_576;      // 1 MB
pub const MAX_IMAGE: usize = 26_214_400;    // 25 MB

pub fn process_event(
    storage: &Storage,
    ev: ClipEvent,
    self_copy: &std::sync::Mutex<Option<String>>,
) -> Result<Option<InsertOutcome>> {
    let item_type = classify(&ev.mime, &ev.bytes);

    // Size guards.
    let limit = if item_type == ItemType::Text { MAX_TEXT } else { MAX_IMAGE };
    if ev.bytes.len() > limit {
        eprintln!("clipvault: skipping oversized {:?} ({} bytes)", item_type, ev.bytes.len());
        return Ok(None);
    }

    let hash = sha256_hex(&ev.bytes);

    // Self-copy suppression: if this hash matches what the app itself just copied
    // back to the clipboard, skip re-capturing it. The marker is NOT one-shot:
    // a single copy-back can produce several clipboard-change events (the OS/DE
    // clipboard manager re-asserts ownership), so we must ignore ALL echoes of
    // that content. The marker is cleared only when genuinely different content
    // is copied (below), so a later real re-copy of the same value still lands.
    {
        let mut guard = self_copy.lock().unwrap();
        if guard.as_deref() == Some(hash.as_str()) {
            return Ok(None);
        }
        // Different clipboard content — clear any stale self-copy marker.
        *guard = None;
    }

    let now = chrono_now_millis();

    let new_item = match item_type {
        ItemType::Text | ItemType::Link | ItemType::Number | ItemType::Color => {
            let text = String::from_utf8_lossy(&ev.bytes).into_owned();
            let refined_type = classify_text(&text);
            NewItem { item_type: refined_type, content: Some(text), file_path: None, preview_path: None, content_hash: hash }
        }
        ItemType::Image | ItemType::Gif => {
            // Only write the file if this is a new hash; check first to avoid orphan files.
            let id_ext = extension_for(item_type, &ev.mime);
            let file_name = format!("{}.{}", &hash, id_ext);
            let path = storage.attachments_dir().join(&file_name);
            let thumbs = storage.attachments_dir().join("thumbs");
            let thumb_path = thumbs.join(format!("{}.webp", &hash));
            let preview: Option<String>;
            if !path.exists() {
                std::fs::write(&path, &ev.bytes)?;
                preview = crate::thumbnail::generate(&ev.bytes, &thumbs, &hash)
                    .map(|p| p.to_string_lossy().into_owned());
            } else {
                // dedup: original already stored; reuse the existing thumbnail if present.
                preview = if thumb_path.exists() {
                    Some(thumb_path.to_string_lossy().into_owned())
                } else { None };
            }
            NewItem { item_type, content: None,
                file_path: Some(path.to_string_lossy().into_owned()),
                preview_path: preview, content_hash: hash }
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
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"hello".to_vec() }, &std::sync::Mutex::new(None)).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("hello"));
        assert_eq!(rows[0].item_type, "text");
    }

    #[test]
    fn stores_image_as_file() {
        let (_d, s) = storage();
        let png = b"\x89PNG\r\n\x1a\nDATA".to_vec();
        let out = process_event(&s, ClipEvent{ mime: "image/png".into(), bytes: png.clone() }, &std::sync::Mutex::new(None)).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].item_type, "image");
        let path = rows[0].file_path.clone().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), png);
        // Not a decodable image, so thumbnail generation fails non-fatally.
        assert_eq!(rows[0].preview_path, None);
    }

    #[test]
    fn link_text_stored_as_link_type() {
        let (_d, s) = storage();
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"https://example.com/x".to_vec() }, &std::sync::Mutex::new(None)).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].item_type, "link");
        assert_eq!(rows[0].content.as_deref(), Some("https://example.com/x"));
        assert_eq!(rows[0].file_path, None);
        assert_eq!(rows[0].preview_path, None);
    }

    #[test]
    fn text_event_has_no_preview_path() {
        let (_d, s) = storage();
        process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"hello".to_vec() }, &std::sync::Mutex::new(None)).unwrap();
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].preview_path, None);
    }

    #[test]
    fn valid_image_gets_webp_thumbnail_preview_path() {
        let (_d, s) = storage();
        // 2x2 white PNG, real decodable image bytes.
        const B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==";
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut png = Vec::new();
        let (mut buf, mut bits) = (0u32, 0u32);
        for &c in B64.as_bytes() {
            if c == b'=' { break }
            let v = T.iter().position(|&x| x == c).unwrap() as u32;
            buf = (buf << 6) | v; bits += 6;
            if bits >= 8 { bits -= 8; png.push((buf >> bits) as u8); }
        }

        let out = process_event(&s, ClipEvent{ mime: "image/png".into(), bytes: png }, &std::sync::Mutex::new(None)).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        let preview = rows[0].preview_path.clone().expect("preview_path should be set");
        assert!(preview.ends_with(".webp"));
        assert!(std::fs::metadata(&preview).unwrap().len() > 0);
    }

    #[test]
    fn oversized_text_skipped() {
        let (_d, s) = storage();
        let big = vec![b'a'; MAX_TEXT + 1];
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: big }, &std::sync::Mutex::new(None)).unwrap();
        assert!(out.is_none());
        assert_eq!(s.list_recent(10).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_bumps_not_inserts() {
        let (_d, s) = storage();
        let ev = || ClipEvent{ mime:"UTF8_STRING".into(), bytes:b"x".to_vec() };
        process_event(&s, ev(), &std::sync::Mutex::new(None)).unwrap();
        let second = process_event(&s, ev(), &std::sync::Mutex::new(None)).unwrap();
        assert!(matches!(second, Some(InsertOutcome::Bumped(_))));
        assert_eq!(s.list_recent(10).unwrap().len(), 1);
    }

    #[test]
    fn self_copy_marker_suppresses_all_echoes() {
        let (_d, s) = storage();
        let bytes = b"self-copied text".to_vec();
        let hash = sha256_hex(&bytes);
        let marker = std::sync::Mutex::new(Some(hash.clone()));

        // First echo: suppressed.
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: bytes.clone() }, &marker).unwrap();
        assert!(out.is_none(), "self-copy should be suppressed, not stored");
        assert_eq!(*marker.lock().unwrap(), Some(hash), "marker must persist to suppress repeated echoes");

        // Second echo of the SAME content (clipboard manager re-asserts): also suppressed.
        let out2 = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes }, &marker).unwrap();
        assert!(out2.is_none(), "repeated echo of self-copy must also be suppressed");
        assert_eq!(s.list_recent(10).unwrap().len(), 0, "nothing should be persisted from echoes");
    }

    #[test]
    fn different_content_clears_marker_and_captures() {
        let (_d, s) = storage();
        let marker = std::sync::Mutex::new(Some(sha256_hex(b"OUR COPY")));
        // A genuinely different clipboard change clears the marker and is captured.
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"something else".to_vec() }, &marker).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        assert_eq!(*marker.lock().unwrap(), None, "different content should clear the stale marker");
        assert_eq!(s.list_recent(10).unwrap().len(), 1);
    }
}
