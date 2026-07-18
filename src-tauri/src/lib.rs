mod hashing;
mod storage;
mod classifier;
mod watcher;
mod capture;
mod state;
mod ipc;
mod thumbnail;
mod clipboard_writer;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Manager, Emitter};

/// Handle to the tray's "Toggle Privacy Mode" check item, kept in managed state so
/// UI-initiated privacy toggles (via the `set_privacy` IPC command) can keep the
/// tray checkmark in sync, not just tray-initiated toggles.
pub(crate) struct PrivacyMenu(pub tauri::menu::CheckMenuItem<tauri::Wry>);

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
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Alt+V")
                .expect("valid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
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
            let last_self_copy: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
            let writer = crate::clipboard_writer::spawn();

            app.manage(crate::state::AppState {
                storage: storage.clone(),
                privacy: privacy.clone(),
                last_self_copy: last_self_copy.clone(),
                writer,
            });

            // Enable autostart on first run only; respects a user's later choice to disable it.
            {
                use tauri_plugin_autostart::ManagerExt;
                if storage.get_setting("autostart_initialized")?.is_none() {
                    let _ = app.autolaunch().enable();
                    storage.set_setting("autostart_initialized", "1")?;
                }
            }

            // Spawn the clipboard watcher thread under a restart supervisor: if the X11
            // backend's run() loop returns (persistent failure, after its own internal
            // 10-failure backoff), wait a bit and try to reconnect rather than leaving
            // capture permanently dead (e.g. transient X server hiccup / VT switch).
            let handle = app.handle().clone();
            let (tx, rx) = std::sync::mpsc::channel::<crate::watcher::ClipEvent>();
            let privacy_w = privacy.clone();
            std::thread::spawn(move || {
                loop {
                    match crate::watcher::x11::X11Backend::new() {
                        Ok(backend) => {
                            use crate::watcher::ClipboardBackend;
                            // run() blocks; returns only on persistent failure (its internal
                            // backoff prevents busy-looping while it's failing).
                            Box::new(backend).run(tx.clone(), privacy_w.clone());
                        }
                        Err(e) => eprintln!("clipvault: clipboard backend unavailable: {e}"),
                    }
                    // Backend exited/failed — wait before restarting so a dead X server
                    // doesn't spin.
                    std::thread::sleep(std::time::Duration::from_secs(5));
                }
            });

            // Consume events on another thread: store + notify UI.
            let storage_c = storage.clone();
            let self_copy_c = last_self_copy.clone();
            std::thread::spawn(move || {
                use tauri_plugin_notification::NotificationExt;
                for ev in rx {
                    match crate::capture::process_event(&storage_c, ev, &self_copy_c) {
                        Ok(Some(_)) => { let _ = handle.emit("item-added", ()); }
                        Ok(None) => {
                            // Either an oversized item was skipped, or a self-copy was
                            // suppressed; either way capture::process_event already logs
                            // the oversized case. Notify the user in the oversized case
                            // by best-effort desktop notification.
                            let _ = handle
                                .notification()
                                .builder()
                                .title("ClipVault")
                                .body("Skipped an oversized clipboard item")
                                .show();
                        }
                        Err(e) => eprintln!("clipvault: capture error: {e}"),
                    }
                }
            });

            // Tray icon with Open / Toggle Privacy Mode / Quit menu.
            use tauri::menu::{CheckMenuItem, Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let priv_i = CheckMenuItem::with_id(
                app,
                "privacy",
                "Toggle Privacy Mode",
                true,
                privacy_init,
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &priv_i, &quit_i])?;

            app.manage(PrivacyMenu(priv_i.clone()));

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("ClipVault")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "quit" => { app.exit(0); }
                    "privacy" => {
                        let state = app.state::<crate::state::AppState>();
                        let now = !state.privacy.load(std::sync::atomic::Ordering::Relaxed);
                        state.privacy.store(now, std::sync::atomic::Ordering::Relaxed);
                        let _ = state.storage.set_bool("privacy_mode", now);
                        let _ = app.emit("privacy-changed", now);

                        let menu_state = app.state::<PrivacyMenu>();
                        let _ = menu_state.0.set_checked(now);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::list_recent_items,
            crate::ipc::get_privacy,
            crate::ipc::set_privacy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipVault");
}
