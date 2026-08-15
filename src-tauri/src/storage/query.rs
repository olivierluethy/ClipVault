//! Search filters: `type:link app:code since:7d is:pinned deploy script`
//!
//! Search was all-or-nothing — one blob of text matched against everything. Once a
//! history is a few thousand entries deep the useful question is usually narrower than
//! that: *the link I copied out of the terminal last week*. Filters let the query say so
//! without a screen full of controls.
//!
//! A query is split into structured filters and leftover free text. Filters are applied
//! as predicates over the candidate rows; the free text still goes through the normal
//! FTS or Levenshtein path. An unrecognised `word:value` is **not** treated as a filter —
//! it stays in the free text, so searching for `http://x` or `TODO:` keeps working.

use super::items::ItemDto;

/// Filters parsed out of a raw query string.
#[derive(Debug, Default, PartialEq)]
pub struct QueryFilters {
    /// `type:link` — item types to keep. Empty means every type.
    pub types: Vec<String>,
    /// `app:code` — source-app substrings to keep. Empty means every app.
    pub apps: Vec<String>,
    /// `is:pinned` / `is:unpinned`.
    pub pinned: Option<bool>,
    /// `is:rich` — only entries that kept a `text/html` flavour.
    pub rich: Option<bool>,
    /// `since:7d` / `since:2026-01-01` — keep entries created at or after this epoch ms.
    pub since_ms: Option<i64>,
    /// `before:3d` — keep entries created strictly before this epoch ms.
    pub before_ms: Option<i64>,
    /// Everything that wasn't a filter, rejoined with single spaces.
    pub text: String,
}

impl QueryFilters {
    /// True when nothing was filtered — the caller can then skip the predicate pass.
    pub fn is_empty(&self) -> bool {
        self.types.is_empty()
            && self.apps.is_empty()
            && self.pinned.is_none()
            && self.rich.is_none()
            && self.since_ms.is_none()
            && self.before_ms.is_none()
    }

    /// Whether `item` survives every filter.
    pub fn matches(&self, item: &ItemDto) -> bool {
        if !self.types.is_empty() && !self.types.iter().any(|t| type_matches(t, &item.item_type)) {
            return false;
        }
        if !self.apps.is_empty() {
            let app = item.source_app.as_deref().unwrap_or("").to_lowercase();
            if !self.apps.iter().any(|a| app.contains(a)) {
                return false;
            }
        }
        if let Some(want) = self.pinned {
            if item.pinned != want {
                return false;
            }
        }
        if let Some(want) = self.rich {
            if item.html.is_some() != want {
                return false;
            }
        }
        if let Some(from) = self.since_ms {
            if item.created_at < from {
                return false;
            }
        }
        if let Some(to) = self.before_ms {
            if item.created_at >= to {
                return false;
            }
        }
        true
    }
}

/// `type:image` should also match GIFs, matching how the sidebar groups them.
fn type_matches(wanted: &str, actual: &str) -> bool {
    match wanted {
        "image" => actual == "image" || actual == "gif",
        other => other == actual,
    }
}

/// Resolves a duration or date into an epoch-ms instant, relative to `now_ms`.
/// Accepts `30m`, `12h`, `7d`, `2w`, and `YYYY-MM-DD`.
fn parse_instant(value: &str, now_ms: i64) -> Option<i64> {
    let v = value.trim().to_lowercase();
    if v.is_empty() {
        return None;
    }

    if let Some(days) = parse_iso_date_as_days(&v) {
        return Some(days * 86_400_000);
    }

    let (digits, unit) = v.split_at(v.len() - 1);
    let n: i64 = digits.parse().ok()?;
    let ms = match unit {
        "m" => n * 60_000,
        "h" => n * 3_600_000,
        "d" => n * 86_400_000,
        "w" => n * 604_800_000,
        _ => return None,
    };
    Some(now_ms - ms)
}

/// Days since the Unix epoch for a `YYYY-MM-DD` string, using the proleptic Gregorian
/// calendar. Returns `None` for anything not in that shape. Treated as UTC midnight —
/// close enough for "things from that day onward" and free of a timezone dependency.
fn parse_iso_date_as_days(v: &str) -> Option<i64> {
    let mut parts = v.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnant's days-from-civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// Splits `raw` into filters plus leftover free text.
pub fn parse(raw: &str, now_ms: i64) -> QueryFilters {
    let mut f = QueryFilters::default();
    let mut words: Vec<&str> = Vec::new();

    for token in raw.split_whitespace() {
        let Some((key, value)) = token.split_once(':') else {
            words.push(token);
            continue;
        };
        if value.is_empty() {
            words.push(token);
            continue;
        }
        let lower = value.to_lowercase();
        match key.to_lowercase().as_str() {
            "type" | "is" if matches!(lower.as_str(), "pinned" | "unpinned" | "rich" | "plain") => {
                match lower.as_str() {
                    "pinned" => f.pinned = Some(true),
                    "unpinned" => f.pinned = Some(false),
                    "rich" => f.rich = Some(true),
                    _ => f.rich = Some(false),
                }
            }
            "type" => f.types.push(lower),
            "app" | "from" => f.apps.push(lower),
            "since" | "after" => match parse_instant(&lower, now_ms) {
                Some(ms) => f.since_ms = Some(ms),
                // Not a duration or date — leave it as free text rather than silently
                // dropping what the user typed.
                None => words.push(token),
            },
            "before" | "until" => match parse_instant(&lower, now_ms) {
                Some(ms) => f.before_ms = Some(ms),
                None => words.push(token),
            },
            _ => words.push(token),
        }
    }

    f.text = words.join(" ");
    f
}
