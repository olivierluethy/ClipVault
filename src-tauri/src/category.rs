//! Per-category library windows (issue #5).
//!
//! Each library category — Text, Links, Numbers, Phone Numbers, Colors, Images & GIFs,
//! Files — can be opened as its own OS window that shows a live-updating list of just
//! that content type. Like the palette, a category window is created on first use and
//! reused afterwards (one window per category), so re-opening a category focuses the
//! existing window instead of piling up duplicates. The category is passed to the
//! frontend via the `?type=` URL parameter on the shared `category.html` document.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const WIDTH: f64 = 420.0;
const HEIGHT: f64 = 560.0;

/// The categories that can be opened in their own window, with a friendly title.
fn title_for(category: &str) -> &'static str {
    match category {
        "text" => "ClipVault — Text",
        "link" => "ClipVault — Links",
        "number" => "ClipVault — Numbers",
        "phone" => "ClipVault — Phone Numbers",
        "color" => "ClipVault — Colors",
        "image" => "ClipVault — Images & GIFs",
        "file" => "ClipVault — Files",
        _ => "ClipVault — Library",
    }
}

fn is_valid(category: &str) -> bool {
    matches!(category, "text" | "link" | "number" | "phone" | "color" | "image" | "file")
}

/// Open (or focus, if already open) the window for `category`.
pub fn show(app: &tauri::AppHandle, category: &str) -> tauri::Result<()> {
    if !is_valid(category) {
        return Err(tauri::Error::WindowNotFound);
    }
    let label = format!("category:{category}");

    // One window per category: if it exists, bring it forward rather than opening another.
    if let Some(w) = app.get_webview_window(&label) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }

    let url = format!("category.html?type={category}");
    // Cascade successive windows so they don't stack exactly on top of one another.
    let offset = (app.webview_windows().len() as f64) * 28.0;
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(title_for(category))
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(300.0, 320.0)
        .resizable(true)
        .position(120.0 + offset, 120.0 + offset)
        .visible(false)
        .build()?;

    window.show()?;
    window.set_focus()?;
    Ok(())
}
