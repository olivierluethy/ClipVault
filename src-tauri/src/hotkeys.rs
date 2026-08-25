//! The app's global shortcuts, in one place.
//!
//! There are three, and they have to be registered together: the plugin's
//! `unregister_all` is the only reliable way to rebind one, so rebinding a single
//! shortcut in isolation would silently drop the other two.
//!
//! | Action | Default | What it does |
//! |---|---|---|
//! | Open | `Ctrl+Alt+V` | Show and focus the main window |
//! | Palette | `Ctrl+Alt+Space` | Open the quick-paste palette |
//! | Paste next | `Ctrl+Alt+B` | Paste the next entry down the clipboard stack |
//!
//! Each is stored under its own settings key and falls back to its default when unset or
//! unregistrable, so a shortcut reserved by the desktop environment can never leave the
//! user without a way in.

use std::str::FromStr;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::storage::Storage;

pub const OPEN_KEY: &str = "hotkey";
pub const PALETTE_KEY: &str = "hotkey_palette";
pub const STACK_KEY: &str = "hotkey_stack";
pub const PRIVACY_KEY: &str = "hotkey_privacy";
pub const QUICKADD_KEY: &str = "hotkey_quickadd";

pub const DEFAULT_OPEN: &str = "Ctrl+Alt+V";
pub const DEFAULT_PALETTE: &str = "Ctrl+Alt+Space";
pub const DEFAULT_STACK: &str = "Ctrl+Alt+B";

/// What a fired shortcut should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Open,
    Palette,
    PasteNext,
    /// Toggle Privacy mode. Unbound by default (empty accelerator).
    Privacy,
    /// Capture the current clipboard now. Unbound by default.
    QuickAdd,
}

impl Action {
    pub fn setting_key(self) -> &'static str {
        match self {
            Action::Open => OPEN_KEY,
            Action::Palette => PALETTE_KEY,
            Action::PasteNext => STACK_KEY,
            Action::Privacy => PRIVACY_KEY,
            Action::QuickAdd => QUICKADD_KEY,
        }
    }

    /// The default accelerator, or "" for actions that are unbound until the user
    /// assigns one (so they never claim a key combination unexpectedly).
    pub fn default_accelerator(self) -> &'static str {
        match self {
            Action::Open => DEFAULT_OPEN,
            Action::Palette => DEFAULT_PALETTE,
            Action::PasteNext => DEFAULT_STACK,
            Action::Privacy | Action::QuickAdd => "",
        }
    }

    pub const ALL: [Action; 5] = [
        Action::Open,
        Action::Palette,
        Action::PasteNext,
        Action::Privacy,
        Action::QuickAdd,
    ];
}

/// The accelerator configured for `action`, or its default.
pub fn accelerator(storage: &Storage, action: Action) -> String {
    storage
        .get_setting(action.setting_key())
        .ok()
        .flatten()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| action.default_accelerator().to_string())
}

/// Clears every binding and registers all three from settings. A binding that won't
/// register falls back to its default; if that fails too the action is simply
/// unavailable rather than blocking the others.
pub fn register_all<R: tauri::Runtime>(app: &tauri::AppHandle<R>, storage: &Storage) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    for action in Action::ALL {
        let wanted = accelerator(storage, action);
        // An empty accelerator means "unbound" (e.g. Privacy/QuickAdd until the user
        // assigns one) — skip it silently rather than logging a spurious failure.
        if wanted.trim().is_empty() {
            continue;
        }
        if gs.register(wanted.as_str()).is_ok() {
            continue;
        }
        let fallback = action.default_accelerator();
        if wanted != fallback && gs.register(fallback).is_ok() {
            eprintln!("clipvault: '{wanted}' could not be registered; using {fallback}");
        } else {
            eprintln!("clipvault: no usable shortcut for {action:?}");
        }
    }
}

/// Which action a fired shortcut belongs to. Compares parsed `Shortcut` values rather
/// than accelerator strings, so `Ctrl+Alt+V` and `control+alt+KeyV` are the same thing.
pub fn action_for(storage: &Storage, fired: &Shortcut) -> Option<Action> {
    Action::ALL.into_iter().find(|&action| {
        let configured = accelerator(storage, action);
        Shortcut::from_str(&configured).map(|s| &s == fired).unwrap_or(false)
            || Shortcut::from_str(action.default_accelerator())
                .map(|s| &s == fired)
                .unwrap_or(false)
    })
}
