use tauri::{State, Emitter};
use std::sync::atomic::Ordering;
use crate::state::AppState;
use crate::storage::{ItemDto, FolderDto};
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

/// Send `req` to the clipboard writer and set the self-copy marker to the hash of the
/// *exact* bytes being written (not e.g. the stored item's content hash), so the watcher
/// thread recognizes the echo it reads back and suppresses re-capturing it.
fn write_and_mark(state: &State<AppState>, req: WriteRequest) -> Result<(), String> {
    let hash = crate::hashing::sha256_hex(&req.bytes);
    *state.last_self_copy.lock().unwrap() = Some(hash);
    state.writer.send(req).map_err(|e| e.to_string())
}

/// Build the `WriteRequest` for an item's stored bytes, applying `transform` to
/// content-based (non-file) items only; image/gif items are written verbatim from disk.
fn build_write_request(
    ty: &str,
    content: Option<String>,
    file_path: Option<String>,
    transform: impl FnOnce(String) -> String,
) -> Result<WriteRequest, String> {
    Ok(match file_path {
        None => WriteRequest {
            mime: "UTF8_STRING".into(),
            bytes: transform(content.unwrap_or_default()).into_bytes(),
        },
        Some(path) => {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let mime = if ty == "gif" { "image/gif" } else { "image/png" };
            WriteRequest { mime: mime.into(), bytes }
        }
    })
}

#[tauri::command]
pub fn copy_item(state: State<AppState>, id: String) -> Result<(), String> {
    let (ty, content, file_path, hash) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    // Suppress the echo BEFORE writing, so the watcher thread ignores our own copy-back.
    *state.last_self_copy.lock().unwrap() = Some(hash);
    // Content-based items (text/link/number/color) have no file and are written as
    // UTF8_STRING; only image/gif are written from their file bytes.
    let req = build_write_request(&ty, content, file_path, |s| s)?;
    state.writer.send(req).map_err(|e| e.to_string())
}

/// Like `copy_item`, but for content-based items (text/link/number/color) applies
/// `cleantext::clean_text` before writing: whitespace normalization plus stripping
/// tracking query params from URLs. Image/gif items are copied unmodified.
///
/// The self-copy marker is set to the hash of the *cleaned* bytes actually written
/// (not the stored item's content_hash), since those are what the watcher reads back.
#[tauri::command]
pub fn copy_item_clean(state: State<AppState>, id: String) -> Result<(), String> {
    let (ty, content, file_path, _hash) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    let req = build_write_request(&ty, content, file_path, |s| crate::cleantext::clean_text(&s))?;
    write_and_mark(&state, req)
}

/// Like `copy_item`, but explicitly copies the item as plain UTF8_STRING text (for
/// "paste as plain text"). All stored content is already plain text, so for
/// content-based items this writes the same bytes as `copy_item`; image/gif items are
/// copied unmodified, same as `copy_item`.
#[tauri::command]
pub fn copy_item_plain(state: State<AppState>, id: String) -> Result<(), String> {
    let (ty, content, file_path, hash) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    *state.last_self_copy.lock().unwrap() = Some(hash);
    let req = build_write_request(&ty, content, file_path, |s| s)?;
    state.writer.send(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String) -> Result<String, String> {
    state.storage.create_folder(&name, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    state.storage.rename_folder(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String, delete_items: bool) -> Result<(), String> {
    state.storage.delete_folder(&id, delete_items, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> Result<Vec<FolderDto>, String> {
    state.storage.list_folders().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assign_item(state: State<AppState>, item_id: String, folder_id: String) -> Result<(), String> {
    state.storage.assign_item(&item_id, &folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unassign_item(state: State<AppState>, item_id: String, folder_id: String) -> Result<(), String> {
    state.storage.unassign_item(&item_id, &folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folders_for_item(state: State<AppState>, item_id: String) -> Result<Vec<String>, String> {
    state.storage.folders_for_item(&item_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_items_in_folder(
    state: State<AppState>,
    folder_id: String,
    limit: i64,
    before_created_at: Option<i64>,
    before_id: Option<String>,
) -> Result<Vec<ItemDto>, String> {
    state.storage.list_items_in_folder(&folder_id, limit, before_created_at, before_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search(state: State<AppState>, query: String, limit: i64) -> Result<Vec<ItemDto>, String> {
    state.storage.search(&query, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_privacy(state: State<AppState>) -> bool {
    state.privacy.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_privacy(
    state: State<AppState>,
    privacy_menu: State<crate::PrivacyMenu>,
    tray: State<crate::TrayState>,
    on: bool,
) -> Result<(), String> {
    state.privacy.store(on, Ordering::Relaxed);
    state.storage.set_bool("privacy_mode", on).map_err(|e| e.to_string())?;
    // Keep the tray checkmark and icon in sync with UI-initiated toggles too.
    let _ = privacy_menu.0.set_checked(on);
    tray.apply(on);
    Ok(())
}

#[tauri::command]
pub fn get_exclude_secrets(state: State<AppState>) -> bool {
    state.exclude_secrets.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_exclude_secrets(state: State<AppState>, on: bool) -> Result<(), String> {
    state.exclude_secrets.store(on, Ordering::Relaxed);
    state.storage.set_bool("exclude_secrets", on).map_err(|e| e.to_string())
}

/// Shared core for "Quick Add": read the CURRENT clipboard contents right now and
/// store them, bypassing the watcher loop entirely — so it works even while privacy
/// mode is on (privacy only pauses passive capture; this is a deliberate, explicit
/// user action). Emits `item-added` and returns `Ok(true)` if something was
/// inserted/bumped, `Ok(false)` if the clipboard was empty/unreadable. Used by both
/// the `quick_add` IPC command (UI button) and the tray "Quick Add" menu item.
pub(crate) fn quick_add_core(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<bool, String> {
    let Some(ev) = crate::watcher::x11::read_clipboard_once() else { return Ok(false) };
    let added = crate::capture::process_event(&state.storage, ev, &state.last_self_copy)
        .map_err(|e| e.to_string())?
        .is_some();
    if added {
        let _ = app.emit("item-added", ());
    }
    Ok(added)
}

/// One-shot "Quick Add" invoked from the UI. See [`quick_add_core`].
#[tauri::command]
pub fn quick_add(app: tauri::AppHandle, state: State<AppState>) -> Result<bool, String> {
    quick_add_core(&app, &state)
}

#[tauri::command]
pub fn get_fetch_link_metadata(state: State<AppState>) -> bool {
    state.storage.get_bool("fetch_link_metadata", true)
}

#[tauri::command]
pub fn set_fetch_link_metadata(state: State<AppState>, on: bool) -> Result<(), String> {
    state.storage.set_bool("fetch_link_metadata", on).map_err(|e| e.to_string())
}
