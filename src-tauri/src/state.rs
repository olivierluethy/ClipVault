use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use crate::storage::Storage;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub privacy: Arc<AtomicBool>,
}
