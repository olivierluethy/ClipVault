use std::sync::mpsc::{channel, Sender};
use x11_clipboard::Clipboard;

/// A request to place `bytes` on the X11 CLIPBOARD selection under the given `mime` type.
/// `mime == "UTF8_STRING"` targets the UTF8_STRING atom; any other value is interned as
/// its own atom name (e.g. "image/png").
#[derive(Debug)]
pub struct WriteRequest {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Spawn a Wayland clipboard-writer thread, serving writes via `wl-copy`. Used on a
/// pure-Wayland session (see `watcher::wayland::should_use_wayland`). `wl-copy` forks
/// to keep serving the selection until it's replaced, matching the X11 writer's
/// persistence.
pub fn spawn_wayland() -> Sender<WriteRequest> {
    let (tx, rx) = channel::<WriteRequest>();
    std::thread::spawn(move || {
        use std::io::Write;
        use std::process::Stdio;
        for req in rx {
            let mime = if req.mime == "UTF8_STRING" {
                "text/plain;charset=utf-8".to_string()
            } else {
                req.mime.clone()
            };
            let child = std::process::Command::new("wl-copy")
                .args(["--type", &mime])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            match child {
                Ok(mut child) => {
                    if let Some(mut stdin) = child.stdin.take() {
                        let _ = stdin.write_all(&req.bytes);
                        // drop stdin here → EOF so wl-copy reads all bytes then forks
                    }
                    let _ = child.wait();
                }
                Err(e) => eprintln!("clipvault: wl-copy failed: {e}"),
            }
        }
    });
    tx
}

/// Spawn the clipboard-writer thread and return a channel to send it `WriteRequest`s.
///
/// The thread owns its own `x11-clipboard::Clipboard` (a clipboard-manager connection is
/// not thread-safe to share with the watcher's own `Clipboard`). If `Clipboard::new()`
/// fails (e.g. no X server available), this logs and returns without spawning a serving
/// loop — the returned `Sender`'s receiver is simply dropped, so future `send`s fail
/// silently (callers already treat send failures as best-effort).
pub fn spawn() -> Sender<WriteRequest> {
    let (tx, rx) = channel::<WriteRequest>();
    std::thread::spawn(move || {
        let cb = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("clipvault: clipboard writer unavailable: {e}");
                return;
            }
        };
        let sel = cb.setter.atoms.clipboard;
        for req in rx {
            let target = if req.mime == "UTF8_STRING" {
                cb.setter.atoms.utf8_string
            } else {
                match cb.setter.get_atom(&req.mime) {
                    Ok(a) => a,
                    Err(e) => {
                        eprintln!("clipvault: failed to intern atom {}: {e}", req.mime);
                        continue;
                    }
                }
            };
            if let Err(e) = cb.store(sel, target, req.bytes) {
                eprintln!("clipvault: clipboard store failed: {e}");
            }
        }
    });
    tx
}
