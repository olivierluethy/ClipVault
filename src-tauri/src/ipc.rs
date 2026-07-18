use tauri::{State, Emitter, Manager};
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
pub fn list_items_range(
    state: State<AppState>,
    from_ms: i64,
    to_ms: i64,
    limit: i64,
    before_created_at: Option<i64>,
    before_id: Option<String>,
) -> Result<Vec<ItemDto>, String> {
    state.storage
        .list_items_in_range(from_ms, to_ms, limit, before_created_at, before_id.as_deref())
        .map_err(|e| e.to_string())
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

// ─── Generic settings passthrough (used by the Settings screen for retention,
// backup cadence, onboarding flags, …) ──────────────────────────────────────────

#[tauri::command]
pub fn get_setting_str(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    state.storage.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting_str(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    state.storage.set_setting(&key, &value).map_err(|e| e.to_string())
}

// ─── Autostart ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_autostart(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if on { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

// ─── Timed privacy ──────────────────────────────────────────────────────────────

/// Turn Privacy mode ON now and automatically turn it back OFF after `minutes`.
/// Keeps the tray checkmark + icon and the UI in sync at both edges. A later manual
/// toggle does not cancel the timer (v1 simplification); the timer's final OFF wins.
#[tauri::command]
pub fn set_privacy_timed(
    app: tauri::AppHandle,
    state: State<AppState>,
    privacy_menu: State<crate::PrivacyMenu>,
    tray: State<crate::TrayState>,
    minutes: u64,
) -> Result<(), String> {
    state.privacy.store(true, Ordering::Relaxed);
    state.storage.set_bool("privacy_mode", true).map_err(|e| e.to_string())?;
    let _ = privacy_menu.0.set_checked(true);
    tray.apply(true);
    let _ = app.emit("privacy-changed", true);

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(minutes.max(1) * 60));
        let st = handle.state::<AppState>();
        st.privacy.store(false, Ordering::Relaxed);
        let _ = st.storage.set_bool("privacy_mode", false);
        let _ = handle.state::<crate::PrivacyMenu>().0.set_checked(false);
        handle.state::<crate::TrayState>().apply(false);
        let _ = handle.emit("privacy-changed", false);
    });
    Ok(())
}

// ─── Stats / backups / retention ────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct Stats {
    pub items: i64,
    pub bytes: u64,
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<Stats, String> {
    Ok(Stats {
        items: state.storage.item_count().map_err(|e| e.to_string())?,
        bytes: state.storage.data_size_bytes(),
    })
}

/// Immediately write a timestamped backup into `<data>/backups/` and prune to the
/// newest `keep` (default 7). Returns the backup file path. `stamp_ms` comes from the
/// caller (JS `Date.now()`) so the backend needs no wall-clock in a command.
#[tauri::command]
pub fn backup_now(state: State<AppState>, stamp_ms: i64) -> Result<String, String> {
    let dir = state.storage.attachments_dir().parent().unwrap().join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("clipvault-{stamp_ms}.db"));
    state.storage.backup_to(&dest).map_err(|e| e.to_string())?;
    prune_backups(&dir, 7);
    Ok(dest.to_string_lossy().into_owned())
}

/// Keep only the newest `keep` `clipvault-*.db` files in `dir`, deleting the rest.
pub(crate) fn prune_backups(dir: &std::path::Path, keep: usize) {
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("clipvault-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    // Filenames embed a monotonic millisecond stamp, so lexical sort == chronological.
    backups.sort();
    if backups.len() > keep {
        for old in &backups[..backups.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
}

// ─── Export / Import ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportFile {
    version: u32,
    /// All user folder names — so empty folders survive a round-trip too.
    #[serde(default)]
    folders: Vec<String>,
    items: Vec<ExportItemJson>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportItemJson {
    item_type: String,
    content: Option<String>,
    content_hash: String,
    copy_count: i64,
    pinned: bool,
    created_at: i64,
    updated_at: i64,
    metadata: Option<String>,
    /// User folder names this item belongs to (restored by name on import).
    #[serde(default)]
    folders: Vec<String>,
    /// base64 of the original attachment bytes (image/gif items only).
    file_b64: Option<String>,
    file_ext: Option<String>,
    /// base64 of the webp thumbnail bytes.
    preview_b64: Option<String>,
    preview_ext: Option<String>,
}

fn ext_of(path: &Option<String>) -> Option<String> {
    path.as_ref()
        .and_then(|p| std::path::Path::new(p).extension())
        .and_then(|e| e.to_str())
        .map(|e| e.to_string())
}

/// Export all live items to a single self-contained JSON file at `path` (chosen by
/// the frontend file dialog). Attachment bytes are base64-embedded so the file is
/// portable. Returns the number of items written.
#[tauri::command]
pub fn export_data(state: State<AppState>, path: String) -> Result<usize, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let rows = state.storage.export_rows().map_err(|e| e.to_string())?;
    let mut items = Vec::with_capacity(rows.len());
    for r in rows {
        let file_b64 = match &r.file_path {
            Some(p) => Some(b64.encode(std::fs::read(p).map_err(|e| e.to_string())?)),
            None => None,
        };
        let preview_b64 = match &r.preview_path {
            Some(p) => std::fs::read(p).ok().map(|b| b64.encode(b)),
            None => None,
        };
        let folders = state.storage.folder_names_for_item(&r.id).map_err(|e| e.to_string())?;
        items.push(ExportItemJson {
            item_type: r.item_type,
            content: r.content,
            content_hash: r.content_hash,
            copy_count: r.copy_count,
            pinned: r.pinned,
            created_at: r.created_at,
            updated_at: r.updated_at,
            metadata: r.metadata,
            folders,
            file_ext: ext_of(&r.file_path),
            file_b64,
            preview_ext: ext_of(&r.preview_path),
            preview_b64,
        });
    }
    let count = items.len();
    let folders = state.storage.list_folders().map_err(|e| e.to_string())?
        .into_iter().map(|f| f.name).collect();
    let export = ExportFile { version: 1, folders, items };
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(count)
}

/// Import items from a ClipVault export JSON at `path`, materializing any embedded
/// attachments into the attachments dir. Duplicates (by content hash) are skipped.
/// Returns the number of newly-inserted items and emits `item-added`.
#[tauri::command]
pub fn import_data(app: tauri::AppHandle, state: State<AppState>, path: String) -> Result<usize, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let export: ExportFile = serde_json::from_str(&raw).map_err(|e| format!("not a valid ClipVault export: {e}"))?;
    let attach_dir = state.storage.attachments_dir();
    std::fs::create_dir_all(&attach_dir).map_err(|e| e.to_string())?;

    // Recreate all folders first (so empty folders survive), then assign per item.
    for name in &export.folders {
        let _ = state.storage.folder_id_by_name_or_create(name, now_ms());
    }

    let mut inserted = 0usize;
    for it in export.items {
        // Materialize attachment bytes under fresh filenames.
        let write_attachment = |data: &Option<String>, ext: &Option<String>| -> Result<Option<String>, String> {
            match data {
                Some(d) => {
                    let bytes = b64.decode(d).map_err(|e| e.to_string())?;
                    let ext = ext.clone().unwrap_or_else(|| "bin".into());
                    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
                    let dest = attach_dir.join(&name);
                    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
                    Ok(Some(dest.to_string_lossy().into_owned()))
                }
                None => Ok(None),
            }
        };
        let file_path = write_attachment(&it.file_b64, &it.file_ext)?;
        let preview_path = write_attachment(&it.preview_b64, &it.preview_ext)?;

        let (item_id, did) = state.storage.insert_imported(crate::storage::ImportRow {
            item_type: it.item_type,
            content: it.content,
            file_path,
            preview_path,
            content_hash: it.content_hash,
            copy_count: it.copy_count,
            pinned: it.pinned,
            created_at: it.created_at,
            updated_at: it.updated_at,
            metadata: it.metadata,
        }).map_err(|e| e.to_string())?;
        if did { inserted += 1; }
        // Restore folder memberships by name (creating folders as needed), for both new
        // and pre-existing (duplicate) items so an import merges memberships too.
        for name in &it.folders {
            let fid = state.storage.folder_id_by_name_or_create(name, now_ms()).map_err(|e| e.to_string())?;
            let _ = state.storage.assign_item(&item_id, &fid);
        }
    }
    if inserted > 0 {
        let _ = app.emit("item-added", ());
    }
    Ok(inserted)
}

// ─── QR codes ───────────────────────────────────────────────────────────────────

/// Render an item's text/link content as a scannable SVG QR code.
#[tauri::command]
pub fn qr_svg(text: String) -> Result<String, String> {
    crate::qr::svg_for(&text)
}

/// Open a URL (a captured link) in the user's default browser.
#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
