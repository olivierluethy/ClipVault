//! The clipboard stack: paste several copied things back in the order they were copied.
//!
//! Copy five fields, then press the paste-next shortcut five times and get them back one
//! after another — filling a form or moving a block of config between windows becomes one
//! pass instead of five round-trips to the history window.
//!
//! A cursor walks down the recent entries. It resets when the run goes cold
//! ([`RESET_AFTER_MS`]) or when something new is copied, because both mean the user has
//! moved on to a different task and expects the next paste to start from the top again.
//! Reaching the end wraps rather than doing nothing, so a repeated shortcut never feels
//! broken.

use std::sync::atomic::Ordering;

use tauri::Emitter;

use crate::state::AppState;

/// How far down the history the stack can walk.
pub const DEPTH: i64 = 50;

/// Idle time after which the next paste starts from the most recent entry again.
pub const RESET_AFTER_MS: i64 = 25_000;

/// Progress through the stack, emitted to the UI as `stack-advanced` so an open window
/// can show what was just pasted and how far along the run is.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StackStep {
    /// 1-based position of the entry that was just pasted.
    pub position: usize,
    /// How many entries the stack can walk right now.
    pub total: usize,
    /// Short label for the pasted entry, for a toast.
    pub preview: String,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Puts the next entry down the stack on the clipboard, pastes it into whatever window
/// has focus, and advances the cursor. Returns `None` when the history is empty.
///
/// Pasting is best-effort: if input simulation is unavailable the entry is still on the
/// clipboard and the user can paste it themselves, so a missing `enigo` backend degrades
/// to "copied" rather than failing.
pub fn paste_next(app: &tauri::AppHandle, state: &AppState) -> Result<Option<StackStep>, String> {
    let items = state.storage.list_stack(DEPTH).map_err(|e| e.to_string())?;
    if items.is_empty() {
        return Ok(None);
    }

    let now = now_ms();
    let last = state.stack_last_ms.swap(now, Ordering::Relaxed);
    if now - last > RESET_AFTER_MS {
        state.stack_cursor.store(0, Ordering::Relaxed);
    }

    // Wrap instead of stalling once the run reaches the end of what it can see.
    let cursor = state.stack_cursor.fetch_add(1, Ordering::Relaxed) % items.len();
    if cursor + 1 >= items.len() {
        state.stack_cursor.store(0, Ordering::Relaxed);
    }

    let item = &items[cursor];
    crate::ipc::place_item_on_clipboard(state, &item.id)?;

    // Give the writer a moment to take selection ownership before the paste keystroke
    // asks the focused window to read it.
    std::thread::sleep(std::time::Duration::from_millis(60));
    let _ = crate::ipc::paste_active();

    let step = StackStep {
        position: cursor + 1,
        total: items.len(),
        preview: preview_of(item),
    };
    let _ = app.emit("stack-advanced", step.clone());
    Ok(Some(step))
}

/// Resets the cursor so the next paste starts from the most recent entry.
pub fn reset(state: &AppState) {
    state.stack_cursor.store(0, Ordering::Relaxed);
}

/// A one-line label for a toast: the first line of text, or the item type for a picture.
fn preview_of(item: &crate::storage::ItemDto) -> String {
    match item.content.as_deref() {
        Some(content) => {
            let line = content.lines().next().unwrap_or("").trim();
            if line.chars().count() > 60 {
                format!("{}…", line.chars().take(60).collect::<String>())
            } else {
                line.to_string()
            }
        }
        None => format!("[{}]", item.item_type),
    }
}
