//! The quick-paste palette: a small always-on-top window for the common case.
//!
//! Summoning the whole app to paste one thing is the slow path. The palette is the fast
//! one — hotkey, two letters, Enter, and the entry is pasted into whatever you were just
//! working in, without the history window ever appearing.
//!
//! It is a second webview on `palette.html`, built on first use and reused afterwards
//! (creating a webview is slow enough to feel it, hiding one is not). It hides itself
//! when it loses focus, so clicking away always dismisses it rather than leaving a
//! floating window behind.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label. Also the name the frontend uses to address it.
pub const LABEL: &str = "palette";

const WIDTH: f64 = 680.0;
const HEIGHT: f64 = 460.0;

/// Shows the palette, creating it the first time. Focus is requested explicitly because
/// a window that appears without the caret in its search box is useless for typing.
pub fn show(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("palette.html".into()))
        .title("ClipVault — Quick paste")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;

    // Clicking away dismisses it. Without this the palette would linger on top of
    // whatever the user switched to.
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let _ = handle.hide();
        }
    });

    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Hides the palette if it exists. Called after it pastes, so focus returns to the
/// window the user was actually working in.
pub fn hide(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}
