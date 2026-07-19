use std::sync::mpsc::Sender;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub mod x11;
pub mod wayland;

#[derive(Debug, Clone)]
pub struct ClipEvent {
    pub mime: String,
    pub bytes: Vec<u8>,
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
