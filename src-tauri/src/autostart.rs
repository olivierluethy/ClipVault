//! Login autostart.
//!
//! ClipVault is a background app: it should already be running (and sitting in the
//! tray) by the time the user reaches their desktop, so nothing copied before the
//! first manual launch is lost.
//!
//! `tauri-plugin-autostart` only writes `~/.config/autostart/{app_name}.desktop`;
//! its `is_enabled()` is a bare "does the file exist" check. Enabling it once on
//! first run therefore can't survive the entry being deleted (by a cleanup script,
//! a "Startup Applications" edit, or a reinstall) — the app then silently never
//! starts at login again. So instead of a one-shot, [`reconcile`] runs on EVERY
//! start and makes the on-disk entry match the persisted `autostart` setting,
//! rewriting it when it is missing, stale (points at a binary that no longer
//! exists) or predates the `--autostart` flag.

use std::path::{Path, PathBuf};

/// Settings key holding the user's choice (Settings → Startup). Default: on.
pub const SETTING: &str = "autostart";

/// Flag baked into the autostart entry so the app can tell a login start from a
/// user-initiated one and stay hidden in the tray instead of popping the window up.
pub const AUTOSTART_ARG: &str = "--autostart";

/// True when this process was launched by the login autostart entry.
pub fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

/// Path of the entry `auto-launch` writes — mirrors its Linux implementation
/// (`$HOME/.config/autostart/{app_name}.desktop`).
pub fn entry_path(app_name: &str) -> Option<PathBuf> {
    Some(entry_path_in(Path::new(&std::env::var_os("HOME")?), app_name))
}

fn entry_path_in(home: &Path, app_name: &str) -> PathBuf {
    home.join(".config")
        .join("autostart")
        .join(format!("{app_name}.desktop"))
}

/// The `Exec=` line of a desktop entry, without the key.
fn exec_line(contents: &str) -> Option<&str> {
    contents.lines().find_map(|l| l.strip_prefix("Exec="))
}

/// The entry we write ourselves instead of taking the one `auto-launch` generates
/// (`Name=clipvault`, `Comment=clipvaultstartup script`, no icon) — this one is what
/// the user sees in GNOME's "Startup Applications" list, so it gets the real name and
/// the app icon. Same path and filename, so the plugin's disable/is_enabled still match.
fn entry_contents(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name=ClipVault\n\
         Comment=Clipboard history manager — starts hidden in the tray\n\
         Exec=\"{}\" {AUTOSTART_ARG}\n\
         Icon=clipvault\n\
         Terminal=false\n\
         StartupNotify=false\n\
         X-GNOME-Autostart-enabled=true\n",
        exe.display()
    )
}

/// Binary an `Exec=` line points at, tolerating the quoting the desktop-entry spec
/// allows (we quote; `auto-launch`, which may have written an older entry, does not).
/// Paths containing spaces aren't handled — ClipVault installs to `/usr/bin`.
fn exec_binary(exec: &str) -> Option<&str> {
    exec.split_whitespace()
        .next()
        .map(|t| t.trim_matches('"'))
        .filter(|t| !t.is_empty())
}

/// Whether the entry has to be (re)written for autostart to actually work:
/// absent, malformed, pointing at a vanished binary, or missing the flag that
/// keeps the window closed at login. `None` = no file on disk.
pub fn needs_write(contents: Option<&str>) -> bool {
    let Some(exec) = contents.and_then(exec_line) else {
        return true;
    };
    let Some(bin) = exec_binary(exec) else {
        return true;
    };
    !Path::new(bin).exists() || !exec.split_whitespace().any(|t| t == AUTOSTART_ARG)
}

/// True for a cargo build output (`…/target/{debug,release}/clipvault`). Such a
/// binary is throwaway — writing it into the login entry would break the user's
/// autostart the moment the build directory is cleaned, so a dev run never
/// creates the entry on its own (an explicit Settings toggle still can).
pub fn is_dev_build(exe: &Path) -> bool {
    let Some(parent) = exe.parent() else {
        return false;
    };
    let profile_is_build_dir = matches!(
        parent.file_name().and_then(|n| n.to_str()),
        Some("debug") | Some("release")
    );
    profile_is_build_dir
        && parent
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            == Some("target")
}

/// Write the login entry for the currently running binary.
pub fn enable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let path = entry_path(&app.package_info().name)
        .ok_or_else(|| "no HOME directory to write the autostart entry to".to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, entry_contents(&exe)).map_err(|e| e.to_string())
}

/// Remove the login entry (delegated to the plugin — same file, one code path).
pub fn disable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().disable().map_err(|e| e.to_string())
}

/// Bring the on-disk login entry in line with the persisted setting. Best-effort:
/// autostart never blocks startup, so failures are logged, not propagated.
pub fn reconcile<R: tauri::Runtime>(app: &tauri::AppHandle<R>, storage: &crate::storage::Storage) {
    use tauri_plugin_autostart::ManagerExt;

    if !storage.get_bool(SETTING, true) {
        if app.autolaunch().is_enabled().unwrap_or(false) {
            if let Err(e) = disable(app) {
                eprintln!("clipvault: could not remove autostart entry: {e}");
            }
        }
        return;
    }

    let contents = entry_path(&app.package_info().name)
        .and_then(|p| std::fs::read_to_string(p).ok());
    if !needs_write(contents.as_deref()) {
        return;
    }
    if std::env::current_exe().map(|e| is_dev_build(&e)).unwrap_or(false) {
        eprintln!("clipvault: dev build — leaving the login autostart entry untouched");
        return;
    }
    if let Err(e) = enable(app) {
        eprintln!("clipvault: could not write autostart entry: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(exec: &str) -> String {
        format!("[Desktop Entry]\nType=Application\nName=clipvault\nExec={exec}\nTerminal=false")
    }

    #[test]
    fn missing_entry_needs_write() {
        assert!(needs_write(None));
    }

    #[test]
    fn entry_without_exec_needs_write() {
        assert!(needs_write(Some("[Desktop Entry]\nType=Application\n")));
    }

    #[test]
    fn entry_pointing_at_vanished_binary_needs_write() {
        assert!(needs_write(Some(&entry(
            "/nonexistent/path/clipvault --autostart"
        ))));
    }

    #[test]
    fn entry_without_autostart_flag_needs_write() {
        // An entry from an older version: valid binary, but the window would pop
        // open at login.
        let exe = std::env::current_exe().unwrap();
        assert!(needs_write(Some(&entry(&exe.display().to_string()))));
    }

    #[test]
    fn healthy_entry_is_left_alone() {
        let exe = std::env::current_exe().unwrap();
        let e = entry(&format!("{} {AUTOSTART_ARG}", exe.display()));
        assert!(!needs_write(Some(&e)));
    }

    #[test]
    fn our_own_entry_is_stable_across_restarts() {
        // The entry we write must not look "needs rewriting" to the next start,
        // or every launch would rewrite it (and quoting is easy to get wrong).
        let exe = std::env::current_exe().unwrap();
        let written = entry_contents(&exe);
        assert!(!needs_write(Some(&written)));
        assert!(written.contains("Name=ClipVault"));
    }

    #[test]
    fn recognises_cargo_build_outputs() {
        assert!(is_dev_build(Path::new("/home/u/proj/src-tauri/target/release/clipvault")));
        assert!(is_dev_build(Path::new("/home/u/proj/src-tauri/target/debug/clipvault")));
        assert!(!is_dev_build(Path::new("/usr/bin/clipvault")));
        // "release" that isn't a cargo profile dir.
        assert!(!is_dev_build(Path::new("/opt/release/clipvault")));
    }

    #[test]
    fn entry_path_follows_auto_launch_layout() {
        assert_eq!(
            entry_path_in(Path::new("/home/tester"), "clipvault"),
            PathBuf::from("/home/tester/.config/autostart/clipvault.desktop")
        );
    }
}
