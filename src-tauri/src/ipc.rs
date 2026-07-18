use tauri::State;
use std::sync::atomic::Ordering;
use crate::state::AppState;
use crate::storage::ItemDto;
use crate::clipboard_writer::WriteRequest;

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn list_items(
    state: State<AppState>,
    limit: i64,
    before_created_at: Option<i64>,
    before_id: Option<String>,
) -> Result<Vec<ItemDto>, String> {
    state.storage.list_items(limit, before_created_at, before_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_pinned(state: State<AppState>) -> Result<Vec<ItemDto>, String> {
    state.storage.list_pinned().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_by_type(
    state: State<AppState>,
    type_str: String,
    limit: i64,
    before_created_at: Option<i64>,
    before_id: Option<String>,
) -> Result<Vec<ItemDto>, String> {
    state.storage.list_by_type(&type_str, limit, before_created_at, before_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folder_counts(state: State<AppState>) -> Result<Vec<(String, i64)>, String> {
    state.storage.folder_counts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pinned(state: State<AppState>, id: String, pinned: bool) -> Result<(), String> {
    state.storage.set_pinned(&id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.soft_delete(&id, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_item(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.restore(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_content(state: State<AppState>, id: String, content: String) -> Result<(), String> {
    state.storage.update_content(&id, &content, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_item(state: State<AppState>, id: String) -> Result<(), String> {
    let (ty, content, file_path, hash) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    // Suppress the echo BEFORE writing, so the watcher thread ignores our own copy-back.
    *state.last_self_copy.lock().unwrap() = Some(hash);
    let req = if ty == "text" {
        WriteRequest { mime: "UTF8_STRING".into(), bytes: content.unwrap_or_default().into_bytes() }
    } else {
        let bytes = std::fs::read(file_path.ok_or("missing file")?).map_err(|e| e.to_string())?;
        let mime = if ty == "gif" { "image/gif" } else { "image/png" };
        WriteRequest { mime: mime.into(), bytes }
    };
    state.writer.send(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_privacy(state: State<AppState>) -> bool {
    state.privacy.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_privacy(
    state: State<AppState>,
    privacy_menu: State<crate::PrivacyMenu>,
    on: bool,
) -> Result<(), String> {
    state.privacy.store(on, Ordering::Relaxed);
    state.storage.set_bool("privacy_mode", on).map_err(|e| e.to_string())?;
    // Keep the tray checkmark in sync with UI-initiated toggles too.
    let _ = privacy_menu.0.set_checked(on);
    Ok(())
}
