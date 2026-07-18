use std::sync::mpsc::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use anyhow::{anyhow, Result};
use x11_clipboard::Clipboard;
use x11_clipboard::error::Error as ClipError;
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
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>, exclude_secrets: Arc<AtomicBool>) {
        let selection = self.clipboard.getter.atoms.clipboard;
        let property = self.clipboard.getter.atoms.property;
        let utf8 = self.clipboard.getter.atoms.utf8_string;

        // Intern the image targets we probe (priority order) once up front.
        let image_targets: Vec<(&str, Atom)> = IMAGE_MIMES
            .into_iter()
            .filter_map(|m| self.atom(m).ok().map(|a| (m, a)))
            .collect();

        // Password managers (KeePassXC, KWallet/Klipper, ...) mark a "secret"
        // clipboard offering with this X11 target. Intern it once up front;
        // probed per-change (both text and image branches) below.
        let secret_hint = self.atom("x-kde-passwordManagerHint").ok();

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
                // A non-compliant clipboard owner may reply with an unexpected type,
                // or fail to hand over ownership. That's a per-owner semantic error,
                // not a dead connection — skip this change WITHOUT counting toward the
                // give-up threshold, so one misbehaving app can't stop the watcher.
                Err(ClipError::UnexpectedType(_)) | Err(ClipError::Owner) => {
                    consecutive_failures = 0;
                    continue;
                }
                Err(_) => {
                    // Genuine connection-level errors (X server restart / session
                    // logout) make load_wait fail immediately every call, which would
                    // otherwise busy-loop at 100% CPU. Back off and give up after
                    // repeated consecutive failures instead of spinning.
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

            if exclude_secrets.load(Ordering::Relaxed) {
                if let Some(hint) = secret_hint {
                    if let Ok(v) = self.clipboard.load(selection, hint, property, Duration::from_millis(200)) {
                        if !v.is_empty() {
                            // Concealed/secret content (value is typically "secret"),
                            // as set by password managers (KeePassXC, KWallet/Klipper,
                            // ...) — do not capture, for either the text or image path.
                            continue;
                        }
                    }
                }
            }

            if !text.is_empty() {
                // Phase-0 accepted trade-off: text wins when an owner offers BOTH
                // text and an image (the design's stated image>text priority is
                // deferred; enumerating TARGETS is not viable with this crate — see
                // the module's Phase-1 follow-ups).
                let _ = tx.send(ClipEvent { mime: "UTF8_STRING".to_string(), bytes: text });
                continue;
            }

            // Non-text change: probe image targets for the CURRENT value. `load`
            // reads immediately and returns the raw bytes unmodified, preserving
            // GIF/PNG encoding. First non-empty target wins.
            //
            // Phase-0 limitations (documented; revisit in Phase 1 with raw x11rb
            // XFIXES handling):
            //   * `load` polls internally (crate `process_event`, use_xfixes=false)
            //     up to the timeout — kept short so the probe returns fast.
            //   * If another clipboard change lands during the probe, `load` can
            //     consume+drop its XFIXES notification, so the watcher resyncs one
            //     change late under rapid back-to-back copies. Narrow race (only the
            //     non-text path, only within this sub-second window).
            //   * Only gif/png/jpeg are recognized; text/uri-list and exotic image
            //     formats are out of Phase-0 scope.
            for (mime, atom) in &image_targets {
                match self.clipboard.load(selection, *atom, property, Duration::from_millis(150)) {
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
