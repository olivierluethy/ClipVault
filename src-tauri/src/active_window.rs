//! Which application was focused when something was copied.
//!
//! Knowing the source of an entry is worth three things: a "copied from" label you can
//! filter by, better keeper selection when entries duplicate one another, and — the one
//! that actually matters — a per-app capture blocklist. Blocking by app is a stronger
//! guarantee than the content-based secret hint, because it does not depend on the source
//! application cooperating: a password manager that never sets
//! `x-kde-passwordManagerHint` is still covered.
//!
//! The lookup reads `_NET_ACTIVE_WINDOW` off the root window and then that window's
//! `WM_CLASS` — two plain property reads. Every failure path returns `None`; not knowing
//! the source app must never stop a capture.
//!
//! On a pure-Wayland session there is deliberately no equivalent. A client cannot ask the
//! compositor what else is focused, and that is a privacy property of Wayland rather than
//! a gap to work around, so entries captured there simply carry no source app.

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt};
use x11rb::rust_connection::RustConnection;

/// A live X11 connection for repeated lookups. The watcher builds one at startup and
/// reuses it for every clipboard change, so a copy costs two property reads rather than a
/// fresh connection handshake.
pub struct ActiveWindow {
    conn: RustConnection,
    root: u32,
    net_active_window: Atom,
}

impl ActiveWindow {
    /// Connects to the display and interns the atom. `None` when there is no X11 display
    /// (a pure-Wayland session) or the window manager does not advertise
    /// `_NET_ACTIVE_WINDOW`.
    pub fn new() -> Option<ActiveWindow> {
        let (conn, screen_num) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen_num)?.root;
        let net_active_window = conn
            .intern_atom(true, b"_NET_ACTIVE_WINDOW")
            .ok()?
            .reply()
            .ok()?
            .atom;
        if net_active_window == 0 {
            return None;
        }
        Some(ActiveWindow { conn, root, net_active_window })
    }

    /// The focused window's application class, e.g. `"firefox"`, `"code"`,
    /// `"gnome-terminal-server"`. `None` when nothing is focused, the window sets no
    /// `WM_CLASS`, or the connection has gone away.
    pub fn class(&self) -> Option<String> {
        let active = self
            .conn
            .get_property(false, self.root, self.net_active_window, AtomEnum::WINDOW, 0, 1)
            .ok()?
            .reply()
            .ok()?;
        let window = active.value32()?.next()?;
        if window == 0 {
            return None;
        }

        let class = self
            .conn
            .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)
            .ok()?
            .reply()
            .ok()?;

        // WM_CLASS is two NUL-terminated strings: the instance name, then the class name.
        // The class is the stable one ("Navigator" vs "firefox"), so prefer it and fall
        // back to the instance when only one is present.
        let mut parts = class
            .value
            .split(|&b| b == 0)
            .filter(|p| !p.is_empty())
            .map(|p| String::from_utf8_lossy(p).into_owned());
        let instance = parts.next();
        parts.next().or(instance).filter(|s| !s.is_empty())
    }
}

/// One-shot lookup for callers that do not hold a connection (Quick Add).
pub fn active_window_class() -> Option<String> {
    ActiveWindow::new()?.class()
}
