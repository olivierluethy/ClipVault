//! User-defined rules deciding what never enters the history.
//!
//! Three controls, all optional and all read from settings on each capture so a change
//! in the Settings screen takes effect on the very next copy:
//!
//! - **Minimum length** — stops single characters and stray selections from filling the
//!   timeline.
//! - **Maximum length** — a tighter ceiling than the hard 1 MB guard in [`crate::capture`],
//!   for people who never want a whole file pasted into their history.
//! - **Ignore patterns** — one regular expression per line; a text entry matching any of
//!   them is dropped. This is the escape hatch for content only the user can recognise:
//!   internal ticket ids, a password format, a bearer-token shape.
//!
//! Compiling regexes on every capture would be wasteful, so a compiled set is cached and
//! only rebuilt when the setting string changes.

use std::sync::Mutex;

use regex::Regex;

use crate::storage::Storage;

/// Settings keys. Kept here so the Rust side and the Settings screen can't drift.
pub const MIN_CHARS_KEY: &str = "capture_min_chars";
pub const MAX_CHARS_KEY: &str = "capture_max_chars";
pub const IGNORE_PATTERNS_KEY: &str = "capture_ignore_patterns";
/// Comma- or newline-separated window classes that are never captured from.
pub const BLOCKED_APPS_KEY: &str = "capture_blocked_apps";

/// Compiled ignore patterns plus the source string they came from, so the cache can tell
/// when the user edited the setting.
struct PatternCache {
    source: String,
    patterns: Vec<Regex>,
}

static CACHE: Mutex<Option<PatternCache>> = Mutex::new(None);

/// Compiles `source` (one pattern per line) into a regex set, reusing the cached result
/// when the setting hasn't changed. Invalid lines are reported once and skipped — a typo
/// in one pattern must never disable capture altogether.
fn compiled_patterns(source: &str) -> Vec<Regex> {
    let mut guard = CACHE.lock().unwrap();
    if let Some(cache) = guard.as_ref() {
        if cache.source == source {
            return cache.patterns.clone();
        }
    }
    let patterns: Vec<Regex> = source
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter_map(|line| match Regex::new(line) {
            Ok(re) => Some(re),
            Err(e) => {
                eprintln!("clipvault: ignoring invalid capture pattern {line:?}: {e}");
                None
            }
        })
        .collect();
    *guard = Some(PatternCache { source: source.to_string(), patterns: patterns.clone() });
    patterns
}

/// Why an entry was rejected, for the log line and the skipped-item notification.
#[derive(Debug, PartialEq, Eq)]
pub enum Rejection {
    TooShort(usize),
    TooLong(usize),
    Matched(String),
    BlockedApp(String),
}

impl Rejection {
    pub fn reason(&self) -> String {
        match self {
            Rejection::TooShort(n) => format!("shorter than the {n}-character minimum"),
            Rejection::TooLong(n) => format!("longer than the {n}-character maximum"),
            Rejection::Matched(p) => format!("matched the ignore pattern {p:?}"),
            Rejection::BlockedApp(app) => format!("copied from the blocked app {app:?}"),
        }
    }
}

/// Parses a setting that should hold a non-negative count. `0`, unset, or unparseable all
/// mean "no limit".
fn count_setting(storage: &Storage, key: &str) -> usize {
    storage
        .get_setting(key)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0)
}

/// True when `app` (an X11 `WM_CLASS`) appears in the user's blocked list. Matching is
/// case-insensitive and by substring, so `keepass` blocks `KeePassXC` without the user
/// having to know the exact class name.
pub fn is_blocked_app(storage: &Storage, app: &str) -> bool {
    if app.is_empty() {
        return false;
    }
    let list = storage.get_setting(BLOCKED_APPS_KEY).ok().flatten().unwrap_or_default();
    let needle = app.to_lowercase();
    list.split(['\n', ','])
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .any(|entry| needle.contains(&entry.to_lowercase()))
}

/// Applies the user's rules to a text entry. `None` means "capture it".
///
/// Only text-shaped entries are checked — length and patterns say nothing useful about a
/// screenshot, and the app blocklist is applied separately since it covers every type.
pub fn reject_text(storage: &Storage, text: &str) -> Option<Rejection> {
    let len = text.chars().count();

    let min = count_setting(storage, MIN_CHARS_KEY);
    if min > 0 && len < min {
        return Some(Rejection::TooShort(min));
    }

    let max = count_setting(storage, MAX_CHARS_KEY);
    if max > 0 && len > max {
        return Some(Rejection::TooLong(max));
    }

    let source = storage.get_setting(IGNORE_PATTERNS_KEY).ok().flatten().unwrap_or_default();
    if source.trim().is_empty() {
        return None;
    }
    compiled_patterns(&source)
        .into_iter()
        .find(|re| re.is_match(text))
        .map(|re| Rejection::Matched(re.as_str().to_string()))
}
