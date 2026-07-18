use std::sync::mpsc::Sender;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub mod x11;

#[derive(Debug, Clone)]
pub struct ClipEvent {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Preferred clipboard MIME targets, best first.
pub const MIME_PRIORITY: [&str; 5] = [
    "image/gif",
    "image/png",
    "image/jpeg",
    "text/uri-list",
    "UTF8_STRING",
];

/// Given the target names a clipboard owner advertises, choose the best one.
pub fn pick_best<'a>(available: &'a [String]) -> Option<&'a str> {
    for pref in MIME_PRIORITY.iter() {
        if let Some(found) = available.iter().find(|a| a.as_str() == *pref) {
            return Some(found.as_str());
        }
    }
    // Any other image type (webp, bmp, tiff, ...) before falling back to text.
    if let Some(img) = available.iter().find(|a| a.starts_with("image/")) {
        return Some(img.as_str());
    }
    // Prefer plain text, then any text/* target.
    if let Some(t) = available.iter().find(|a| a.starts_with("text/plain")) {
        return Some(t.as_str());
    }
    available.iter().find(|a| a.starts_with("text/")).map(|s| s.as_str())
}

pub trait ClipboardBackend: Send {
    /// Blocks forever, emitting a ClipEvent on each clipboard change.
    /// Skips emission while `privacy` is true.
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefers_gif_over_png_over_text() {
        let avail = vec!["text/plain".into(), "image/png".into(), "image/gif".into()];
        assert_eq!(pick_best(&avail), Some("image/gif"));
        let avail2 = vec!["text/plain".into(), "image/png".into()];
        assert_eq!(pick_best(&avail2), Some("image/png"));
        let avail3 = vec!["text/plain".into(), "text/html".into()];
        assert_eq!(pick_best(&avail3), Some("text/plain"));
    }
    #[test]
    fn falls_back_to_other_image_types() {
        let avail = vec!["text/plain".into(), "image/webp".into()];
        assert_eq!(pick_best(&avail), Some("image/webp"));
    }
    #[test]
    fn prefers_plain_text_over_other_text() {
        let avail = vec!["text/html".into(), "text/plain".into()];
        assert_eq!(pick_best(&avail), Some("text/plain"));
    }
}
