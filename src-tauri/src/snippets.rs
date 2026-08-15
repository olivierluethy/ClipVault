//! Snippets: entries you write rather than copy, expanded when they're used.
//!
//! Everything else in ClipVault arrived by being copied. A snippet is authored — a
//! signature, a boilerplate reply, a commit-message scaffold, the SQL you retype every
//! week — and it can carry placeholders that are filled in at the moment it is pasted,
//! so it is a template rather than a fixed string.
//!
//! | Placeholder | Becomes |
//! |---|---|
//! | `{{date}}` | today, `YYYY-MM-DD` |
//! | `{{time}}` | now, `HH:MM` |
//! | `{{datetime}}` | `YYYY-MM-DD HH:MM` |
//! | `{{year}}` | the current year |
//! | `{{clipboard}}` | whatever is on the clipboard right now |
//! | `{{uuid}}` | a fresh v4 UUID |
//! | `{{cursor}}` | removed (marks where to type next) |
//!
//! Unknown placeholders are left exactly as written. A snippet full of `{{foo}}` from
//! some other tool should paste as itself, not as a string with holes punched in it.

use uuid::Uuid;

/// Settings-independent expansion of every placeholder in `template`.
///
/// `now_ms` is passed in rather than read here so the caller controls the clock, and
/// `clipboard` is resolved lazily — reading the clipboard costs a round trip and most
/// snippets never ask for it.
pub fn expand(template: &str, now_ms: i64, clipboard: impl FnOnce() -> Option<String>) -> String {
    if !template.contains("{{") {
        return template.to_string();
    }

    let (y, mo, d, h, mi) = civil_from_ms(now_ms);
    let mut clipboard = Some(clipboard);

    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            // Unclosed — the rest is literal text, not a broken placeholder.
            out.push_str(&rest[start..]);
            return out;
        };
        let name = after[..end].trim().to_lowercase();
        let replacement = match name.as_str() {
            "date" => Some(format!("{y:04}-{mo:02}-{d:02}")),
            "time" => Some(format!("{h:02}:{mi:02}")),
            "datetime" => Some(format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}")),
            "year" => Some(format!("{y:04}")),
            "uuid" => Some(Uuid::new_v4().to_string()),
            "cursor" => Some(String::new()),
            "clipboard" => clipboard.take().and_then(|f| f()).or(Some(String::new())),
            // Not ours — put it back verbatim.
            _ => None,
        };
        match replacement {
            Some(value) => out.push_str(&value),
            None => out.push_str(&rest[start..start + 2 + end + 2]),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// Local civil time (year, month, day, hour, minute) from epoch milliseconds.
///
/// Uses the process's UTC offset as reported by the platform at build-independent
/// runtime — there is no chrono dependency here, and a snippet's `{{date}}` only has to
/// agree with the user's wall clock, not survive a timezone database.
fn civil_from_ms(ms: i64) -> (i64, i64, i64, i64, i64) {
    let secs = ms.div_euclid(1000) + local_offset_secs();
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (y, mo, d) = civil_from_days(days);
    (y, mo, d, tod / 3600, (tod % 3600) / 60)
}

/// Seconds east of UTC for the current local time, derived by comparing `localtime` and
/// `gmtime` through the `TZ`-aware C library. Falls back to UTC when unavailable.
fn local_offset_secs() -> i64 {
    // std has no timezone API, and pulling in chrono for one offset is not worth it.
    // `date +%z` is present on every system this app targets.
    let out = std::process::Command::new("date").arg("+%z").output().ok();
    let text = out
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let bytes = text.as_bytes();
    if bytes.len() < 5 {
        return 0;
    }
    let sign = if bytes[0] == b'-' { -1 } else { 1 };
    let hours: i64 = text[1..3].parse().unwrap_or(0);
    let mins: i64 = text[3..5].parse().unwrap_or(0);
    sign * (hours * 3600 + mins * 60)
}

/// Howard Hinnant's civil-from-days: days since the Unix epoch → (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}
