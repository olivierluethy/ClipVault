mod hashing;
mod autostart;
mod cleantext;
pub mod cli;
mod storage;
mod classifier;
mod watcher;
mod active_window;
mod capture;
mod hotkeys;
mod palette;
mod snippets;
mod stack;
mod capture_rules;
mod state;
mod ipc;
mod thumbnail;
mod clipboard_writer;
mod link_meta;
mod ocr;
mod qr;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Manager, Emitter};

/// Handle to the tray's "Toggle Privacy Mode" check item, kept in managed state so
/// UI-initiated privacy toggles (via the `set_privacy` IPC command) can keep the
/// tray checkmark in sync, not just tray-initiated toggles.
pub(crate) struct PrivacyMenu(pub tauri::menu::CheckMenuItem<tauri::Wry>);

/// The tray icon plus its two states' images, kept in managed state so BOTH the
/// tray-initiated and UI-initiated privacy toggles can swap the tray glyph — giving
/// the user an at-a-glance indicator that passive capture is paused.
pub(crate) struct TrayState {
    tray: tauri::tray::TrayIcon<tauri::Wry>,
    normal: tauri::image::Image<'static>,
    privacy: tauri::image::Image<'static>,
}

impl TrayState {
    /// Point the tray at the privacy glyph when capture is paused, else the normal one.
    pub(crate) fn apply(&self, privacy_on: bool) {
        let icon = if privacy_on { self.privacy.clone() } else { self.normal.clone() };
        let _ = self.tray.set_icon(Some(icon));
    }
}

/// Decode an embedded PNG into an owned `tauri::image::Image` (RGBA). Done via the
/// `image` crate rather than `Image::from_bytes` so we don't depend on tauri's
/// optional `image-png` feature. Panics only on a corrupt *compiled-in* asset.
fn decode_icon(bytes: &[u8]) -> tauri::image::Image<'static> {
    let rgba = image::load_from_memory(bytes)
        .expect("embedded tray icon is a valid image")
        .to_rgba8();
    let (w, h) = rgba.dimensions();
    tauri::image::Image::new_owned(rgba.into_raw(), w, h)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // The login entry carries this flag so the app can start straight into
            // the tray instead of throwing a window at the user right after login.
            Some(vec![crate::autostart::AUTOSTART_ARG]),
        ))
        .plugin(
            // No fixed shortcut here: the actual hotkey is read from settings and
            // registered in setup() (so it's user-configurable at runtime via the
            // set_hotkey IPC command). This handler fires for whichever shortcut is
            // currently registered.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<crate::state::AppState>();
                    match crate::hotkeys::action_for(&state.storage, shortcut) {
                        Some(crate::hotkeys::Action::PasteNext) => {
                            if let Err(e) = crate::stack::paste_next(app, &state) {
                                eprintln!("clipvault: stack paste failed: {e}");
                            }
                        }
                        // The palette window is created on demand; both remaining actions
                        // are "show me a window", they just differ in which one.
                        Some(crate::hotkeys::Action::Palette) => {
                            if let Err(e) = crate::palette::show(app) {
                                eprintln!("clipvault: palette failed to open: {e}");
                            }
                        }
                        _ => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // Data dir: ~/.local/share/clipvault/ (NOT the identifier-based app_data_dir()).
            let data_dir = app.path().data_dir()?.join("clipvault");
            let storage = Arc::new(crate::storage::Storage::open(&data_dir.join("clipvault.db"))?);

            let privacy_init = storage.get_bool("privacy_mode", false);
            let privacy = Arc::new(AtomicBool::new(privacy_init));
            let exclude_secrets = Arc::new(AtomicBool::new(storage.get_bool("exclude_secrets", true)));
            let last_self_copy: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            // Pick the clipboard writer to match the session: wl-copy on a pure-Wayland
            // session, the X11 writer otherwise.
            let writer = if crate::watcher::wayland::should_use_wayland() {
                crate::clipboard_writer::spawn_wayland()
            } else {
                crate::clipboard_writer::spawn()
            };

            let stack_cursor = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let stack_last_ms = Arc::new(std::sync::atomic::AtomicI64::new(0));

            app.manage(crate::state::AppState {
                storage: storage.clone(),
                privacy: privacy.clone(),
                exclude_secrets: exclude_secrets.clone(),
                last_self_copy: last_self_copy.clone(),
                writer,
                stack_cursor: stack_cursor.clone(),
                stack_last_ms: stack_last_ms.clone(),
            });

            // Register the global open-hotkey from settings (default Ctrl+Alt+V). If
            // a stored/custom binding can't be registered (invalid, or reserved by the
            // desktop environment — e.g. Super+V on some GNOME setups), fall back to
            // the default so the user is never left without a way to open the window.
            crate::hotkeys::register_all(&app.handle().clone(), &storage);

            // Keep the login autostart entry in sync with the setting on every start
            // (default on), so a deleted or stale entry heals itself instead of
            // silently leaving the user without a running clipboard manager.
            crate::autostart::reconcile(&app.handle().clone(), &storage);

            // Spawn the clipboard watcher thread under a restart supervisor: if the X11
            // backend's run() loop returns (persistent failure, after its own internal
            // 10-failure backoff), wait a bit and try to reconnect rather than leaving
            // capture permanently dead (e.g. transient X server hiccup / VT switch).
            let handle = app.handle().clone();
            let (tx, rx) = std::sync::mpsc::channel::<crate::watcher::ClipEvent>();
            let privacy_w = privacy.clone();
            let exclude_secrets_w = exclude_secrets.clone();
            std::thread::spawn(move || {
                use crate::watcher::ClipboardBackend;
                loop {
                    if crate::watcher::wayland::should_use_wayland() {
                        // Pure-Wayland session (no XWayland): poll via wl-clipboard.
                        Box::new(crate::watcher::wayland::WaylandBackend::new())
                            .run(tx.clone(), privacy_w.clone(), exclude_secrets_w.clone());
                    } else {
                        match crate::watcher::x11::X11Backend::new() {
                            Ok(backend) => {
                                // run() blocks; returns only on persistent failure (its internal
                                // backoff prevents busy-looping while it's failing).
                                Box::new(backend).run(tx.clone(), privacy_w.clone(), exclude_secrets_w.clone());
                            }
                            Err(e) => eprintln!("clipvault: clipboard backend unavailable: {e}"),
                        }
                    }
                    // Backend exited/failed — wait before restarting so a dead server
                    // doesn't spin.
                    std::thread::sleep(std::time::Duration::from_secs(5));
                }
            });

            // Consume events on another thread: store + notify UI.
            let storage_c = storage.clone();
            let self_copy_c = last_self_copy.clone();
            let stack_cursor_c = stack_cursor.clone();
            std::thread::spawn(move || {
                use tauri_plugin_notification::NotificationExt;
                for ev in rx {
                    match crate::capture::process_event(&storage_c, ev, &self_copy_c) {
                        Ok(crate::capture::Capture::Stored(outcome)) => {
                            // Something new was copied, so the user has moved on — the
                            // next stack paste should start from the top again.
                            stack_cursor_c.store(0, std::sync::atomic::Ordering::Relaxed);
                            let _ = handle.emit("item-added", ());
                            // Link metadata (title + favicon URL) is fetched off this
                            // thread so a slow/unreachable site never blocks capture.
                            if let crate::storage::InsertOutcome::Inserted(id) = &outcome {
                                if storage_c.get_bool("fetch_link_metadata", true) {
                                    if let Ok(Some((ty, Some(content), _, _)))
                                        = storage_c.get_item(id)
                                    {
                                        if ty == "link" {
                                            let storage_meta = storage_c.clone();
                                            let handle_meta = handle.clone();
                                            let id_meta = id.clone();
                                            std::thread::spawn(move || {
                                                if let Some(meta) = crate::link_meta::fetch(&content) {
                                                    if let Ok(json) = serde_json::to_string(&meta) {
                                                        if storage_meta.set_metadata(&id_meta, &json).is_ok() {
                                                            let _ = handle_meta.emit("item-added", ());
                                                        }
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }

                                // Inline OCR: recognize text in captured images off-thread
                                // (best-effort; a no-op if tesseract isn't installed) and
                                // store it as searchable metadata.
                                if storage_c.get_bool("ocr_enabled", true) {
                                    if let Ok(Some((ty, _, Some(path), _))) = storage_c.get_item(id) {
                                        if ty == "image" || ty == "gif" {
                                            let storage_ocr = storage_c.clone();
                                            let handle_ocr = handle.clone();
                                            let id_ocr = id.clone();
                                            std::thread::spawn(move || {
                                                if let Some(text) = crate::ocr::extract(&path) {
                                                    if storage_ocr.set_ocr_text(&id_ocr, &text).is_ok() {
                                                        let _ = handle_ocr.emit("item-added", ());
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        // The app's own copy-back echoing off the clipboard. Constant and
                        // expected — stay silent.
                        Ok(crate::capture::Capture::SelfCopy) => {}
                        Ok(crate::capture::Capture::Skipped(reason)) => {
                            // A rule the user set (or a hard size guard) rejected this
                            // entry. Say which, so a silent gap in the history is never a
                            // mystery.
                            let _ = handle
                                .notification()
                                .builder()
                                .title("ClipVault")
                                .body(format!("Skipped a clipboard item — {reason}"))
                                .show();
                        }
                        Err(e) => eprintln!("clipvault: capture error: {e}"),
                    }
                }
            });

            // Ephemeral-entry reaper: hard-delete items whose self-destruct time has
            // passed. Runs every 30s (finer-grained than the 30-min maintenance pass so
            // short timers fire promptly); refreshes the UI when it removes anything.
            let storage_reap = storage.clone();
            let handle_reap = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if let Ok(removed) = storage_reap.purge_expired(now_ms()) {
                    if !removed.is_empty() {
                        for (fp, pp) in removed {
                            if let Some(p) = fp { let _ = std::fs::remove_file(p); }
                            if let Some(p) = pp { let _ = std::fs::remove_file(p); }
                        }
                        let _ = handle_reap.emit("item-added", ());
                    }
                }
            });

            // Background maintenance: enforce retention limits and take scheduled
            // backups. Reads its cadence/limits from settings each pass so changes in
            // the Settings screen take effect without a restart. Runs every 30 min
            // (plus once shortly after launch).
            let storage_m = storage.clone();
            std::thread::spawn(move || {
                // Small initial delay so startup isn't competing with first-paint work.
                std::thread::sleep(std::time::Duration::from_secs(20));
                loop {
                    run_maintenance(&storage_m);
                    std::thread::sleep(std::time::Duration::from_secs(30 * 60));
                }
            });

            // Tray icon with Open / Toggle Privacy Mode / Quit menu.
            use tauri::menu::{CheckMenuItem, Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quickadd_i =
                MenuItem::with_id(app, "quick_add", "Quick Add current clipboard", true, None::<&str>)?;
            let priv_i = CheckMenuItem::with_id(
                app,
                "privacy",
                "Toggle Privacy Mode",
                true,
                privacy_init,
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quickadd_i, &priv_i, &quit_i])?;

            app.manage(PrivacyMenu(priv_i.clone()));

            // Two tray glyphs: the normal app icon, and a "privacy paused" variant so
            // the tray itself signals when passive capture is off.
            let normal_icon = decode_icon(include_bytes!("../icons/32x32.png"));
            let privacy_icon = decode_icon(include_bytes!("../icons/tray-privacy.png"));

            let tray = TrayIconBuilder::new()
                .icon(if privacy_init { privacy_icon.clone() } else { normal_icon.clone() })
                .menu(&menu)
                .tooltip("ClipVault")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "quit" => { app.exit(0); }
                    "quick_add" => {
                        use tauri_plugin_notification::NotificationExt;
                        let state = app.state::<crate::state::AppState>();
                        let added = crate::ipc::quick_add_core(app, &state).unwrap_or(false);
                        let _ = app
                            .notification()
                            .builder()
                            .title("ClipVault")
                            .body(if added {
                                "Saved current clipboard"
                            } else {
                                "Clipboard empty — nothing saved"
                            })
                            .show();
                    }
                    "privacy" => {
                        let state = app.state::<crate::state::AppState>();
                        let now = !state.privacy.load(std::sync::atomic::Ordering::Relaxed);
                        state.privacy.store(now, std::sync::atomic::Ordering::Relaxed);
                        let _ = state.storage.set_bool("privacy_mode", now);
                        let _ = app.emit("privacy-changed", now);

                        let menu_state = app.state::<PrivacyMenu>();
                        let _ = menu_state.0.set_checked(now);
                        app.state::<TrayState>().apply(now);
                    }
                    _ => {}
                })
                .build(app)?;

            app.manage(TrayState { tray, normal: normal_icon, privacy: privacy_icon });

            // The window starts invisible (tauri.conf.json) so a login start never
            // flashes it up: launched from the autostart entry ClipVault stays in the
            // tray, reachable via the tray menu's Open or the global hotkey. Any other
            // launch — launcher, terminal, second instance — shows it right away.
            if !crate::autostart::launched_by_autostart() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::list_items,
            crate::ipc::list_pinned,
            crate::ipc::list_by_type,
            crate::ipc::list_items_range,
            crate::ipc::list_frequent,
            crate::ipc::frequent_count,
            crate::ipc::folder_counts,
            crate::ipc::item_day_counts,
            crate::ipc::list_source_apps,
            crate::ipc::set_pinned,
            crate::ipc::delete_item,
            crate::ipc::restore_item,
            crate::ipc::set_item_expiry,
            crate::ipc::update_content,
            crate::ipc::copy_item,
            crate::ipc::copy_item_clean,
            crate::ipc::copy_item_html,
            crate::ipc::copy_text,
            crate::ipc::save_text_item,
            crate::ipc::create_folder,
            crate::ipc::rename_folder,
            crate::ipc::delete_folder,
            crate::ipc::list_folders,
            crate::ipc::assign_item,
            crate::ipc::unassign_item,
            crate::ipc::folders_for_item,
            crate::ipc::list_items_in_folder,
            crate::ipc::search,
            crate::ipc::fuzzy_search,
            crate::ipc::duplicate_clusters,
            crate::ipc::duplicate_count,
            crate::ipc::get_similarity_threshold,
            crate::ipc::set_similarity_threshold,
            crate::ipc::get_privacy,
            crate::ipc::set_privacy,
            crate::ipc::get_exclude_secrets,
            crate::ipc::set_exclude_secrets,
            crate::ipc::quick_add,
            crate::ipc::get_fetch_link_metadata,
            crate::ipc::set_fetch_link_metadata,
            crate::ipc::get_setting_str,
            crate::ipc::set_setting_str,
            crate::ipc::get_autostart,
            crate::ipc::set_autostart,
            crate::ipc::set_privacy_timed,
            crate::ipc::get_stats,
            crate::ipc::backup_now,
            crate::ipc::export_data,
            crate::ipc::import_data,
            crate::ipc::qr_svg,
            crate::ipc::open_url,
            crate::ipc::get_hotkey,
            crate::ipc::set_hotkey,
            crate::ipc::paste_active,
            crate::ipc::list_snippets,
            crate::ipc::snippet_count,
            crate::ipc::create_snippet,
            crate::ipc::set_snippet,
            crate::ipc::copy_snippet,
            crate::ipc::preview_snippet,
            crate::ipc::stack_paste_next,
            crate::ipc::stack_reset,
            crate::ipc::show_palette,
            crate::ipc::hide_palette,
            crate::ipc::ocr_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipVault");
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// One maintenance pass: apply retention limits, then take a scheduled backup if one is
/// due. All parameters come from settings (written by the Settings screen); a `0`/unset
/// limit disables that rule. Best-effort — logs nothing on the happy path.
fn run_maintenance(storage: &crate::storage::Storage) {
    let now = now_ms();

    // Retention: days -> ms, and a max item count. 0/unset disables each.
    let days: i64 = storage.get_setting("retention_days").ok().flatten()
        .and_then(|v| v.parse().ok()).unwrap_or(0);
    let max_items: i64 = storage.get_setting("retention_max_items").ok().flatten()
        .and_then(|v| v.parse().ok()).unwrap_or(0);
    let max_age_ms = if days > 0 { Some(days * 24 * 60 * 60 * 1000) } else { None };
    let max_items = if max_items > 0 { Some(max_items) } else { None };
    if max_age_ms.is_some() || max_items.is_some() {
        if let Ok(removed) = storage.run_retention(max_age_ms, max_items, now) {
            for (fp, pp) in removed {
                if let Some(p) = fp { let _ = std::fs::remove_file(p); }
                if let Some(p) = pp { let _ = std::fs::remove_file(p); }
            }
        }
    }

    // Scheduled backups: only if enabled and the configured interval has elapsed.
    if storage.get_bool("backup_enabled", false) {
        let interval_hours: i64 = storage.get_setting("backup_interval_hours").ok().flatten()
            .and_then(|v| v.parse().ok()).unwrap_or(24);
        let last: i64 = storage.get_setting("backup_last_at").ok().flatten()
            .and_then(|v| v.parse().ok()).unwrap_or(0);
        let due = now - last >= interval_hours.max(1) * 60 * 60 * 1000;
        if due {
            let dir = storage.attachments_dir().parent().unwrap().join("backups");
            if std::fs::create_dir_all(&dir).is_ok() {
                let dest = dir.join(format!("clipvault-{now}.db"));
                if storage.backup_to(&dest).is_ok() {
                    let keep: usize = storage.get_setting("backup_keep").ok().flatten()
                        .and_then(|v| v.parse().ok()).unwrap_or(7);
                    crate::ipc::prune_backups(&dir, keep);
                    let _ = storage.set_setting("backup_last_at", &now.to_string());
                }
            }
        }
    }
}
