//! Wayland clipboard backend, used when there's no usable X11 display (a pure
//! Wayland session with no XWayland). Built on the standard `wl-clipboard` tools
//! (`wl-paste`/`wl-copy`) so it needs no extra Rust dependency and stays fully
//! offline. Reads are polled (wlr-data-control offers no simple change event via the
//! CLI); each distinct clipboard value is emitted once.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Duration;

use crate::hashing::sha256_hex;
use super::{ClipEvent, ClipboardBackend};

/// Image MIME targets we prefer on a non-text clipboard change, in priority order.
const IMAGE_MIMES: [&str; 3] = ["image/png", "image/gif", "image/jpeg"];

/// True if `wl-paste` is on PATH (the `wl-clipboard` package is installed).
pub fn wl_paste_available() -> bool {
    Command::new("wl-paste")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Use the Wayland backend when we're in a Wayland session with no X11 display to
/// fall back on, and the wl-clipboard tools are present. (With XWayland present the
/// event-driven X11 backend is preferred and keeps working.)
pub fn should_use_wayland() -> bool {
    let wayland = std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
    let no_x = std::env::var("DISPLAY").map(|v| v.is_empty()).unwrap_or(true);
    wayland && no_x && wl_paste_available()
}

fn list_types() -> Vec<String> {
    let out = Command::new("wl-paste")
        .arg("--list-types")
        .stderr(Stdio::null())
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => vec![],
    }
}

fn is_text_type(t: &str) -> bool {
    t.starts_with("text/") || t == "UTF8_STRING" || t == "STRING" || t == "TEXT"
}

fn read_text() -> Option<Vec<u8>> {
    let out = Command::new("wl-paste")
        .args(["--no-newline"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    (out.status.success() && !out.stdout.is_empty()).then_some(out.stdout)
}

fn read_typed(mime: &str) -> Option<Vec<u8>> {
    let out = Command::new("wl-paste")
        .args(["--type", mime])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    (out.status.success() && !out.stdout.is_empty()).then_some(out.stdout)
}

/// Read the current clipboard value as a `ClipEvent` (text preferred, then images),
/// or `None` when empty/unreadable. Shared by the watcher and the one-shot Quick-Add.
pub fn read_clipboard_once() -> Option<ClipEvent> {
    let types = list_types();
    if types.is_empty() {
        return None;
    }
    if types.iter().any(|t| is_text_type(t)) {
        if let Some(bytes) = read_text() {
            return Some(ClipEvent { mime: "UTF8_STRING".to_string(), bytes });
        }
    }
    for m in IMAGE_MIMES {
        if types.iter().any(|t| t == m) {
            if let Some(bytes) = read_typed(m) {
                return Some(ClipEvent { mime: m.to_string(), bytes });
            }
        }
    }
    None
}

pub struct WaylandBackend;

impl WaylandBackend {
    pub fn new() -> WaylandBackend {
        WaylandBackend
    }
}

impl ClipboardBackend for WaylandBackend {
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>, exclude_secrets: Arc<AtomicBool>) {
        // Last emitted content hash — so a polled value is only sent once.
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(600));

            let types = list_types();
            if types.is_empty() {
                continue;
            }
            // Password managers mark secret offerings with this mime (as on X11).
            let secret = exclude_secrets.load(Ordering::Relaxed)
                && types.iter().any(|t| t == "x-kde-passwordManagerHint");

            let ev = if types.iter().any(|t| is_text_type(t)) {
                read_text().map(|bytes| ClipEvent { mime: "UTF8_STRING".to_string(), bytes })
            } else {
                IMAGE_MIMES
                    .iter()
                    .find(|m| types.iter().any(|t| t == **m))
                    .and_then(|m| read_typed(m).map(|bytes| ClipEvent { mime: m.to_string(), bytes }))
            };
            let Some(ev) = ev else { continue };

            let hash = sha256_hex(&ev.bytes);
            if hash == last {
                continue; // unchanged since last poll
            }
            // Advance the marker even when we won't emit, so content copied during
            // privacy/secret isn't captured after the condition clears.
            last = hash;
            if privacy.load(Ordering::Relaxed) || secret {
                continue;
            }
            let _ = tx.send(ev);
        }
    }
}
