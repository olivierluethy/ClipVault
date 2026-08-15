use std::sync::mpsc::Sender;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub mod x11;
pub mod wayland;

#[derive(Debug, Clone)]
pub struct ClipEvent {
    pub mime: String,
    pub bytes: Vec<u8>,
    /// The window class (X11 `WM_CLASS`) of whatever was focused when the copy happened,
    /// when it could be determined. Powers the "copied from" column, the per-app filter,
    /// and the per-app capture blocklist.
    pub source_app: Option<String>,
    /// The `text/html` flavour offered alongside plain text, when the owner had one.
    /// Kept so formatting survives a trip through the history.
    pub html: Option<String>,
}

impl ClipEvent {
    /// A plain event with no source app and no rich-text flavour — the shape most
    /// call sites want.
    pub fn new(mime: impl Into<String>, bytes: Vec<u8>) -> ClipEvent {
        ClipEvent { mime: mime.into(), bytes, source_app: None, html: None }
    }
}

/// Read the CURRENT clipboard value once, using the Wayland tools on a pure-Wayland
/// session or the X11 backend otherwise. Used by Quick-Add.
pub fn read_clipboard_once() -> Option<ClipEvent> {
    if wayland::should_use_wayland() {
        wayland::read_clipboard_once()
    } else {
        x11::read_clipboard_once()
    }
}

pub trait ClipboardBackend: Send {
    /// Blocks forever, emitting a ClipEvent on each clipboard change.
    /// Skips emission while `privacy` is true. Skips emission when
    /// `exclude_secrets` is true and the clipboard owner marks its content
    /// with the `x-kde-passwordManagerHint` X11 target (as set by password
    /// managers such as KeePassXC / KWallet).
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>, exclude_secrets: Arc<AtomicBool>);
}
