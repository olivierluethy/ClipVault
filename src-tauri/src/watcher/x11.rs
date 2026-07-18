use std::sync::mpsc::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use anyhow::{anyhow, Result};
use x11_clipboard::Clipboard;
use x11rb::protocol::xproto::Atom;
use super::{ClipEvent, ClipboardBackend};

/// Image MIME targets we probe on a non-text clipboard change, in priority order.
const IMAGE_MIMES: [&str; 3] = ["image/gif", "image/png", "image/jpeg"];

pub struct X11Backend {
    clipboard: Clipboard,
}

impl X11Backend {
    pub fn new() -> Result<X11Backend> {
        if std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false)
            && std::env::var("DISPLAY").map(|v| v.is_empty()).unwrap_or(true)
        {
            return Err(anyhow!(
                "Wayland session detected and no X11 DISPLAY; \
                the X11 backend needs Xorg or XWayland. Log in with 'Ubuntu on Xorg'."
            ));
        }
        let clipboard =
            Clipboard::new().map_err(|e| anyhow!("failed to open X11 clipboard: {e}"))?;
        Ok(X11Backend { clipboard })
    }

    /// Intern an atom by name using the getter connection.
    fn atom(&self, name: &str) -> Result<Atom> {
        self.clipboard
            .getter
            .get_atom(name)
            .map_err(|e| anyhow!("failed to intern atom {name}: {e}"))
    }
}

impl ClipboardBackend for X11Backend {
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>) {
        let selection = self.clipboard.getter.atoms.clipboard;
        let property = self.clipboard.getter.atoms.property;
        let utf8 = self.clipboard.getter.atoms.utf8_string;

        // Intern the image targets we probe (priority order) once up front.
        let image_targets: Vec<(&str, Atom)> = IMAGE_MIMES
            .into_iter()
            .filter_map(|m| self.atom(m).ok().map(|a| (m, a)))
            .collect();

        let mut consecutive_failures: u32 = 0;

        loop {
            // Block until the CLIPBOARD selection changes (XFIXES SelectionNotify).
            // `load_wait` on UTF8_STRING both waits for the change and returns the
            // text when the new content is text; for a non-text change (e.g. an
            // image was copied) the owner can't convert UTF8_STRING and this
            // returns Ok(empty) — we still learn a change happened. This is
            // event-driven (blocking on XFIXES), never polled.
            let text = match self.clipboard.load_wait(selection, utf8, property) {
                Ok(bytes) => {
                    consecutive_failures = 0;
                    bytes
                }
                Err(_) => {
                    // If the X connection has died persistently (X server restart /
                    // session logout), load_wait fails immediately every call, which
                    // would otherwise busy-loop at 100% CPU. Back off and give up
                    // after repeated consecutive failures instead of spinning.
                    consecutive_failures += 1;
                    if consecutive_failures >= 10 {
                        eprintln!(
                            "clipvault: X11 clipboard unavailable after {consecutive_failures} consecutive failures; watcher stopping"
                        );
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
            };

            if privacy.load(Ordering::Relaxed) {
                continue; // paused: consume the change signal, store nothing
            }

            if !text.is_empty() {
                let _ = tx.send(ClipEvent { mime: "UTF8_STRING".to_string(), bytes: text });
                continue;
            }

            // Non-text change: probe image targets for the CURRENT value. `load`
            // reads immediately (no wait) and returns the raw bytes unmodified,
            // preserving GIF/PNG encoding. First non-empty target wins.
            for (mime, atom) in &image_targets {
                match self.clipboard.load(selection, *atom, property, Duration::from_millis(500)) {
                    Ok(bytes) if !bytes.is_empty() => {
                        let _ = tx.send(ClipEvent { mime: mime.to_string(), bytes });
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
