//! Pure text-cleaning helpers used by the CLEAN-COPY IPC command: whitespace
//! normalization for arbitrary text, plus tracking-query-param stripping for
//! http(s) URLs.

/// List of tracking query-param keys (exact match) to strip from URLs, in addition to
/// any key starting with `utm_`.
const TRACKING_PARAM_KEYS: &[&str] = &[
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref",
    "ref_src", "ref_url", "spm", "_hsenc", "_hsmi", "yclid", "vero_id",
];

fn is_tracking_param(key: &str) -> bool {
    key.starts_with("utm_") || TRACKING_PARAM_KEYS.contains(&key)
}

/// Collapse runs of internal whitespace to a single space, and trim leading/trailing
/// whitespace (including tabs/newlines).
fn normalize_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Strip tracking query params from `url`, preserving the order of the remaining
/// params. Returns the cleaned URL as a string, with no trailing `?` if no params
/// remain.
fn clean_url(mut url: reqwest::Url) -> String {
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| !is_tracking_param(k))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    if kept.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut().clear().extend_pairs(&kept);
    }
    url.to_string()
}

/// Clean a clipboard text payload:
/// - Trim and collapse internal whitespace runs to a single space.
/// - If the result parses as an http(s) URL, strip known tracking query params.
pub fn clean_text(s: &str) -> String {
    let normalized = normalize_whitespace(s);
    if let Ok(url) = reqwest::Url::parse(&normalized) {
        if url.scheme() == "http" || url.scheme() == "https" {
            return clean_url(url);
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_and_trims_whitespace() {
        assert_eq!(clean_text("  hello   world  "), "hello world");
    }

    #[test]
    fn strips_tracking_params_from_url() {
        assert_eq!(
            clean_text("https://x.com/p?utm_source=a&id=5&fbclid=z"),
            "https://x.com/p?id=5"
        );
    }

    #[test]
    fn drops_trailing_question_mark_when_no_params_remain() {
        assert_eq!(clean_text("https://x.com/p?utm_source=a"), "https://x.com/p");
    }

    #[test]
    fn collapses_tabs_and_newlines_in_plain_sentence() {
        assert_eq!(
            clean_text("  this\tis\na\r\nplain   sentence  "),
            "this is a plain sentence"
        );
    }

    #[test]
    fn leaves_non_url_question_mark_untouched_besides_whitespace() {
        assert_eq!(
            clean_text("  is this   a question?  "),
            "is this a question?"
        );
    }
}
