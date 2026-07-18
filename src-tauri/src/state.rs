use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use crate::storage::Storage;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub privacy: Arc<AtomicBool>,
    /// Content hash of the last item the app itself copied to the clipboard (one-shot).
    /// Consulted by `capture::process_event` to suppress re-capturing the app's own copy-back.
    /// Set by the `copy_item` IPC command before it writes to the clipboard; the consumer
    /// thread holds its own clone of the same `Arc<Mutex<..>>` and passes it into
    /// `process_event` on every event.
    pub last_self_copy: Arc<Mutex<Option<String>>>,
    /// Channel to the clipboard-writer thread; used by the `copy_item` command to place an
    /// item's bytes back on the X11 CLIPBOARD selection.
    pub writer: std::sync::mpsc::Sender<crate::clipboard_writer::WriteRequest>,
}
