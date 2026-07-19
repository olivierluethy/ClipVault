//! Optional, fully-offline OCR for captured images via the system `tesseract`
//! binary. If tesseract isn't installed this is a graceful no-op — capture is never
//! affected. Recognized text is stored as invisible, searchable metadata so images
//! can be found by the words shown in them.

use std::process::{Command, Stdio};

/// Whether the `tesseract` CLI is available on PATH.
pub fn tesseract_available() -> bool {
    Command::new("tesseract")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Run OCR on the image at `image_path`, returning the recognized text (trimmed,
/// length-capped) or `None` if tesseract is missing/failed or found no text.
pub fn extract(image_path: &str) -> Option<String> {
    let out = Command::new("tesseract")
        .arg(image_path)
        .arg("stdout")
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    // Cap so a pathological image can't bloat the FTS index.
    const MAX: usize = 100_000;
    if text.len() > MAX {
        text.truncate(MAX);
    }
    Some(text)
}
