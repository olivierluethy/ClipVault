mod hashing;
mod storage;
mod classifier;
mod watcher;
mod capture;
mod state;
mod ipc;

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
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

            app.manage(crate::state::AppState { storage: storage.clone(), privacy: privacy.clone() });

            // Spawn the clipboard watcher thread.
            let handle = app.handle().clone();
            let (tx, rx) = std::sync::mpsc::channel::<crate::watcher::ClipEvent>();
            let privacy_w = privacy.clone();
            std::thread::spawn(move || {
                match crate::watcher::x11::X11Backend::new() {
                    Ok(backend) => {
                        use crate::watcher::ClipboardBackend;
                        Box::new(backend).run(tx, privacy_w);
                    }
                    Err(e) => eprintln!("clipvault: clipboard backend unavailable: {e}"),
                }
            });

            // Consume events on another thread: store + notify UI.
            let storage_c = storage.clone();
            std::thread::spawn(move || {
                for ev in rx {
                    match crate::capture::process_event(&storage_c, ev) {
                        Ok(Some(_)) => { let _ = handle.emit("item-added", ()); }
                        Ok(None) => {}
                        Err(e) => eprintln!("clipvault: capture error: {e}"),
                    }
                }
            });

            // Tray icon with Open / Toggle Privacy Mode / Quit menu.
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let priv_i = MenuItem::with_id(app, "privacy", "Toggle Privacy Mode", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &priv_i, &quit_i])?;

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
