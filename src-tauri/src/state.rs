use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use crate::storage::Storage;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub privacy: Arc<AtomicBool>,
    /// Content hash of the last item the app itself copied to the clipboard (one-shot).
    /// Consulted by `capture::process_event` to suppress re-capturing the app's own copy-back.
    /// No copy-back command exists yet (this is a forward-looking seam), so nothing sets
    /// this via `AppState` today; the consumer thread holds its own clone of the same
    /// `Arc<Mutex<..>>` and passes it into `process_event` on every event.
    #[allow(dead_code)]
    pub last_self_copy: Arc<Mutex<Option<String>>>,
}
