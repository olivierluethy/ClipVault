use std::sync::mpsc::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use anyhow::{anyhow, Result};
use x11_clipboard::Clipboard;
use x11rb::protocol::xproto::{Atom, ConnectionExt};
use super::{ClipEvent, ClipboardBackend, pick_best};

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

    /// Resolve an atom id back to its string name (for TARGETS enumeration).
    fn atom_name(&self, atom: Atom) -> Result<String> {
        let conn = &self.clipboard.getter.connection;
        let reply = conn
            .get_atom_name(atom)
            .map_err(|e| anyhow!("get_atom_name request failed: {e}"))?
            .reply()
            .map_err(|e| anyhow!("get_atom_name reply failed: {e}"))?;
        Ok(String::from_utf8_lossy(&reply.name).into_owned())
    }
}

impl ClipboardBackend for X11Backend {
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>) {
        // Atom ids (u32) are Copy; reading the individual fields avoids moving
        // the non-Copy `Atoms` struct out of `self`.
        let selection = self.clipboard.getter.atoms.clipboard;
        let targets_target = self.clipboard.getter.atoms.targets;
        let property = self.clipboard.getter.atoms.property;

        loop {
            // Block until the CLIPBOARD selection changes (XFIXES SelectionNotify),
            // then read its TARGETS list. This is event-driven, never polled.
            let targets_raw = match self.clipboard.load_wait(selection, targets_target, property) {
                Ok(b) => b,
                Err(_) => continue, // transient conversion failure; wait for next change
            };

            if privacy.load(Ordering::Relaxed) {
                continue; // paused: consume the change signal, store nothing
            }

            // TARGETS is a list of 32-bit atom ids, native byte order.
            let names: Vec<String> = targets_raw
                .chunks_exact(4)
                .map(|c| u32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                .filter_map(|a| self.atom_name(a).ok())
                .collect();

            let Some(best) = pick_best(&names) else { continue };
            let Ok(best_atom) = self.atom(best) else { continue };

            // Read the best target's raw bytes, unmodified (no re-encoding).
            match self.clipboard.load_wait(selection, best_atom, property) {
                Ok(bytes) if !bytes.is_empty() => {
                    let _ = tx.send(ClipEvent { mime: best.to_string(), bytes });
                }
                _ => {}
            }
        }
    }
}
