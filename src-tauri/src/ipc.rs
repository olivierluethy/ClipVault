use tauri::{State, Emitter, Manager};
use std::sync::atomic::Ordering;
use crate::state::AppState;
use crate::storage::{DuplicateCluster, ItemDto, FolderDto};
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
pub fn list_frequent(state: State<AppState>, limit: i64) -> Result<Vec<ItemDto>, String> {
    state.storage.list_frequent(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn frequent_count(state: State<AppState>) -> Result<i64, String> {
    state.storage.frequent_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn folder_counts(state: State<AppState>) -> Result<Vec<(String, i64)>, String> {
    state.storage.folder_counts().map_err(|e| e.to_string())
}

/// Applications entries were copied from, with counts — the app filter and the
/// blocklist picker in Settings both read this.
#[tauri::command]
pub fn list_source_apps(state: State<AppState>) -> Result<Vec<(String, i64)>, String> {
    state.storage.list_source_apps().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn item_day_counts(state: State<AppState>) -> Result<Vec<(String, i64)>, String> {
    state.storage.item_day_counts().map_err(|e| e.to_string())
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

/// Set or clear an item's self-destruct time (epoch ms; `None` = never expire).
/// A background reaper hard-deletes items once their expiry passes.
#[tauri::command]
pub fn set_item_expiry(state: State<AppState>, id: String, expires_at: Option<i64>) -> Result<(), String> {
    state.storage.set_expiry(&id, expires_at).map_err(|e| e.to_string())
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

/// Put an item's stored bytes on the clipboard verbatim, counting it as a deliberate
/// reuse and suppressing the echo. Shared by the `copy_item` command and the clipboard
/// stack, which must behave identically apart from what triggers it.
pub(crate) fn place_item_on_clipboard(state: &AppState, id: &str) -> Result<(), String> {
    let (ty, content, file_path, hash) = state.storage.get_item(id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    // Deliberate reuse from within ClipVault → the one honest usage signal we can observe.
    state.storage.increment_reuse(id).map_err(|e| e.to_string())?;
    // Suppress the echo BEFORE writing, so the watcher thread ignores our own copy-back.
    *state.last_self_copy.lock().unwrap() = Some(hash);
    // Content-based items (text/link/number/color/file) have no file and are written as
    // UTF8_STRING; only image/gif are written from their file bytes.
    let req = build_write_request(&ty, content, file_path, |s| s)?;
    state.writer.send(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_item(state: State<AppState>, id: String) -> Result<(), String> {
    place_item_on_clipboard(&state, &id)
}

// ─── Snippets ───────────────────────────────────────────────────────────────────

/// Every snippet, newest first.
#[tauri::command]
pub fn list_snippets(state: State<AppState>) -> Result<Vec<ItemDto>, String> {
    state.storage.list_snippets().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippet_count(state: State<AppState>) -> Result<i64, String> {
    state.storage.snippet_count().map_err(|e| e.to_string())
}

/// Create a snippet from authored text. Returns its id.
#[tauri::command]
pub fn create_snippet(app: tauri::AppHandle, state: State<AppState>, content: String) -> Result<String, String> {
    let id = state.storage.create_snippet(&content, now_ms()).map_err(|e| e.to_string())?;
    let _ = app.emit("item-added", ());
    Ok(id)
}

/// Promote a captured entry into the snippet library, or send it back to history.
#[tauri::command]
pub fn set_snippet(app: tauri::AppHandle, state: State<AppState>, id: String, is_snippet: bool) -> Result<(), String> {
    state.storage.set_snippet(&id, is_snippet).map_err(|e| e.to_string())?;
    let _ = app.emit("item-added", ());
    Ok(())
}

/// Expand a snippet's placeholders and put the result on the clipboard.
///
/// Expansion happens at copy time, not when the snippet is written — that is the whole
/// point of `{{date}}`. The expanded text is NOT stored: a snippet is a template, and
/// rewriting it with today's date would destroy it after one use.
#[tauri::command]
pub fn copy_snippet(state: State<AppState>, id: String) -> Result<String, String> {
    let (_, content, _, _) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("snippet not found")?;
    let template = content.ok_or("this snippet has no text")?;
    let expanded = crate::snippets::expand(&template, now_ms(), || {
        crate::watcher::read_clipboard_once().and_then(|ev| {
            (ev.mime == "UTF8_STRING").then(|| String::from_utf8_lossy(&ev.bytes).into_owned())
        })
    });
    state.storage.increment_reuse(&id).map_err(|e| e.to_string())?;
    write_and_mark(
        &state,
        WriteRequest { mime: "UTF8_STRING".into(), bytes: expanded.clone().into_bytes() },
    )?;
    Ok(expanded)
}

/// Preview what a snippet would expand to, without touching the clipboard.
#[tauri::command]
pub fn preview_snippet(template: String) -> String {
    crate::snippets::expand(&template, now_ms(), || None)
}

// ─── Clipboard stack ────────────────────────────────────────────────────────────

/// Paste the next entry down the clipboard stack into the focused window.
#[tauri::command]
pub fn stack_paste_next(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Option<crate::stack::StackStep>, String> {
    crate::stack::paste_next(&app, &state)
}

/// Start the next stack run from the most recent entry again.
#[tauri::command]
pub fn stack_reset(state: State<AppState>) {
    crate::stack::reset(&state);
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
    // Clean copy is still a deliberate reuse from within ClipVault.
    state.storage.increment_reuse(&id).map_err(|e| e.to_string())?;
    let req = build_write_request(&ty, content, file_path, |s| crate::cleantext::clean_text(&s))?;
    write_and_mark(&state, req)
}

/// Copy an entry back with its formatting: writes the stored `text/html` flavour rather
/// than the plain text, so a rich editor receiving the paste keeps bold, links and lists.
///
/// The clipboard writer owns one selection target at a time, so this is a deliberate
/// either/or rather than an offering of both flavours: `copy_item` puts plain text on the
/// clipboard, this puts HTML. Errors when the entry has no stored HTML.
#[tauri::command]
pub fn copy_item_html(state: State<AppState>, id: String) -> Result<(), String> {
    let html = state
        .storage
        .item_html(&id)
        .map_err(|e| e.to_string())?
        .ok_or("this entry has no formatted version")?;
    state.storage.increment_reuse(&id).map_err(|e| e.to_string())?;
    write_and_mark(&state, WriteRequest { mime: "text/html".into(), bytes: html.into_bytes() })
}

/// Write arbitrary UTF-8 `text` to the system clipboard, suppressing the echo so the
/// watcher does not re-capture it as a new history item. Used by the per-item
/// Transform actions (case conversions, strip-to-plain-text) and code Format, whose
/// fast path copies a *derived* result out without creating an entry.
#[tauri::command]
pub fn copy_text(state: State<AppState>, text: String) -> Result<(), String> {
    let req = WriteRequest { mime: "UTF8_STRING".into(), bytes: text.into_bytes() };
    write_and_mark(&state, req)
}

/// Store arbitrary `text` as a NEW history item (its type inferred by the text
/// classifier) and emit `item-added` so the timeline refreshes. When
/// `copy_to_clipboard` is set, the text is also placed on the system clipboard
/// immediately (echo suppressed so it isn't captured a second time). Powers
/// Multi-Copy-Merge (`copy_to_clipboard = true`) and every "Save as new entry"
/// action (`copy_to_clipboard = false`). Existing items are never modified.
#[tauri::command]
pub fn save_text_item(
    app: tauri::AppHandle,
    state: State<AppState>,
    text: String,
    copy_to_clipboard: bool,
) -> Result<(), String> {
    let hash = crate::hashing::sha256_hex(text.as_bytes());
    let item_type = crate::classifier::classify_text(&text);
    let new_item = crate::storage::NewItem {
        item_type,
        content: Some(text.clone()),
        file_path: None,
        preview_path: None,
        content_hash: hash.clone(),
        source_app: None,
        html: None,
    };
    state
        .storage
        .insert_or_bump(new_item, now_ms())
        .map_err(|e| e.to_string())?;
    if copy_to_clipboard {
        *state.last_self_copy.lock().unwrap() = Some(hash);
        let req = WriteRequest { mime: "UTF8_STRING".into(), bytes: text.into_bytes() };
        state.writer.send(req).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("item-added", ());
    Ok(())
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
pub fn reorder_folders(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    state.storage.reorder_folders(&ids).map_err(|e| e.to_string())
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

/// Typo-tolerant search over item content and OCR text, ranked by Levenshtein
/// distance (closest match first). Never returns an empty list for a non-empty query.
#[tauri::command]
pub fn fuzzy_search(state: State<AppState>, query: String, limit: i64) -> Result<Vec<ItemDto>, String> {
    state.storage.fuzzy_search(&query, limit).map_err(|e| e.to_string())
}

/// Clusters of identical / near-identical entries for the "Similar" view, largest first.
#[tauri::command]
pub async fn duplicate_clusters(state: State<'_, AppState>) -> Result<Vec<DuplicateCluster>, String> {
    state.storage.duplicate_clusters().map_err(|e| e.to_string())
}

/// How many entries the "Similar" view would offer to remove. Drives the sidebar badge.
#[tauri::command]
pub async fn duplicate_count(state: State<'_, AppState>) -> Result<i64, String> {
    state.storage.duplicate_count().map_err(|e| e.to_string())
}

/// The similarity threshold (0.5..=1.0) two entries must reach to be clustered.
#[tauri::command]
pub fn get_similarity_threshold(state: State<AppState>) -> f64 {
    state.storage.similarity_threshold()
}

#[tauri::command]
pub fn set_similarity_threshold(state: State<AppState>, value: f64) -> Result<(), String> {
    state.storage.set_similarity_threshold(value).map_err(|e| e.to_string())
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
    let Some(mut ev) = crate::watcher::read_clipboard_once() else { return Ok(false) };
    // Quick Add is triggered from ClipVault itself, so the focused window is ours —
    // record whatever the user had open before instead of nothing at all.
    ev.source_app = crate::active_window::active_window_class();
    let added = matches!(
        crate::capture::process_event(&state.storage, ev, &state.last_self_copy)
            .map_err(|e| e.to_string())?,
        crate::capture::Capture::Stored(_)
    );
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

/// The user's choice, not the current state of the desktop entry: the entry is
/// re-created from this setting at every start (see `autostart::reconcile`), so the
/// setting is the source of truth and a temporarily missing file mustn't show the
/// toggle as off. Defaults to on — a clipboard manager that isn't running captures
/// nothing.
#[tauri::command]
pub fn get_autostart(state: State<AppState>) -> bool {
    state.storage.get_bool(crate::autostart::SETTING, true)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, state: State<AppState>, on: bool) -> Result<(), String> {
    if on {
        crate::autostart::enable(&app)
    } else {
        crate::autostart::disable(&app)
    }?;
    state
        .storage
        .set_bool(crate::autostart::SETTING, on)
        .map_err(|e| e.to_string())
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

/// Whether the optional `tesseract` OCR binary is available (so the Settings screen
/// can tell the user why image-text search may be inactive).
#[tauri::command]
pub fn ocr_available() -> bool {
    crate::ocr::tesseract_available()
}

// ─── Paste-directly (simulated Ctrl+V) ──────────────────────────────────────────

/// Simulate a Ctrl+V keystroke in whatever window currently has focus. Used by the
/// "paste directly" workflow: after the app copies an item and hides, the previously
/// focused window regains focus and this pastes into it automatically. Best-effort —
/// returns an error string the UI can ignore if input simulation isn't available.
#[tauri::command]
pub fn paste_active() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Quick-paste palette ────────────────────────────────────────────────────────

/// Open the quick-paste palette (also bound to its own global shortcut).
#[tauri::command]
pub fn show_palette(app: tauri::AppHandle) -> Result<(), String> {
    crate::palette::show(&app).map_err(|e| e.to_string())
}

/// Hide the palette. Called by the palette itself right before it pastes, so focus is
/// already back in the target window when the keystroke lands.
#[tauri::command]
pub fn hide_palette(app: tauri::AppHandle) {
    crate::palette::hide(&app);
}

// ─── Global shortcuts ───────────────────────────────────────────────────────────

fn action_from_str(name: &str) -> Result<crate::hotkeys::Action, String> {
    match name {
        "open" => Ok(crate::hotkeys::Action::Open),
        "palette" => Ok(crate::hotkeys::Action::Palette),
        "pasteNext" | "paste_next" => Ok(crate::hotkeys::Action::PasteNext),
        other => Err(format!("unknown shortcut '{other}'")),
    }
}

/// The currently configured global open-hotkey. Kept for the Welcome tips, which only
/// ever mention this one.
#[tauri::command]
pub fn get_hotkey(state: State<AppState>) -> String {
    crate::hotkeys::accelerator(&state.storage, crate::hotkeys::Action::Open)
}

/// All three shortcuts, keyed by action.
#[tauri::command]
pub fn get_hotkeys(state: State<AppState>) -> std::collections::HashMap<String, String> {
    [
        ("open", crate::hotkeys::Action::Open),
        ("palette", crate::hotkeys::Action::Palette),
        ("pasteNext", crate::hotkeys::Action::PasteNext),
    ]
    .into_iter()
    .map(|(name, action)| (name.to_string(), crate::hotkeys::accelerator(&state.storage, action)))
    .collect()
}

/// Rebind one shortcut and persist it.
///
/// All three are re-registered together: the plugin's `unregister_all` is the only
/// reliable way to release a binding, so rebinding one in isolation would silently drop
/// the other two. If the new accelerator won't register (invalid, or reserved by the
/// desktop environment) the previous value is restored and an error comes back for the UI
/// to surface — the user is never left without a working shortcut.
#[tauri::command]
pub fn set_action_hotkey(
    app: tauri::AppHandle,
    state: State<AppState>,
    action: String,
    hotkey: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let action = action_from_str(&action)?;
    let hotkey = hotkey.trim().to_string();
    if hotkey.is_empty() {
        return Err("Shortcut must not be empty".to_string());
    }

    let previous = crate::hotkeys::accelerator(&state.storage, action);
    state.storage.set_setting(action.setting_key(), &hotkey).map_err(|e| e.to_string())?;
    crate::hotkeys::register_all(&app, &state.storage);

    // register_all falls back silently, so verify the binding we were asked for actually
    // took, and roll back if it didn't.
    let registered = app.global_shortcut().is_registered(hotkey.as_str());
    if !registered {
        state.storage.set_setting(action.setting_key(), &previous).map_err(|e| e.to_string())?;
        crate::hotkeys::register_all(&app, &state.storage);
        return Err(format!("Could not register '{hotkey}' — it may be taken by the system"));
    }
    Ok(())
}

/// Rebind the open-hotkey. Thin wrapper kept so the existing Settings control and any
/// stored automation keep working.
#[tauri::command]
pub fn set_hotkey(app: tauri::AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    set_action_hotkey(app, state, "open".to_string(), hotkey)
}
