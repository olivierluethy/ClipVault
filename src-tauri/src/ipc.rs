use tauri::State;
use std::sync::atomic::Ordering;
use crate::state::AppState;
use crate::storage::ItemDto;

#[tauri::command]
pub fn list_recent_items(state: State<AppState>, limit: i64) -> Result<Vec<ItemDto>, String> {
    state.storage.list_recent(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_privacy(state: State<AppState>) -> bool {
    state.privacy.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_privacy(state: State<AppState>, on: bool) -> Result<(), String> {
    state.privacy.store(on, Ordering::Relaxed);
    state.storage.set_bool("privacy_mode", on).map_err(|e| e.to_string())
}
