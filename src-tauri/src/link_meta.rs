//! Best-effort link metadata fetching: page title + a guessed favicon URL.
//!
//! This is deliberately minimal (YAGNI): no HTML scraping crate, no favicon
//! image download, no `<link rel="icon">` discovery — just a `/favicon.ico`
//! guess and a small case-insensitive `<title>` scan. Everything here runs off
//! the capture thread (see `lib.rs`'s consumer loop) and every failure mode
//! (parse error, network error, timeout, missing title) degrades to `None`
//! rather than propagating an error, since link metadata is a nice-to-have.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkMeta {
    pub title: Option<String>,
    pub favicon_url: Option<String>,
    /// Best-effort Open Graph / Twitter-card preview image URL (absolute), if the
    /// page advertises one. `None` when the page has no such meta tag. Serde
    /// defaults let older stored metadata (written before this field existed)
    /// still deserialize.
    #[serde(default)]
    pub image_url: Option<String>,
}

const USER_AGENT: &str = "Mozilla/5.0 (compatible; ClipVault/0.1; clipboard-manager)";
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
/// A `<title>` always lives near the top of `<head>`; capping how much of the
/// body we read keeps this fast and bounded even for very large pages.
const MAX_BODY_BYTES: usize = 262_144; // 256 KiB

/// Fetches `url`'s page title, a best-effort favicon URL
/// (`{scheme}://{host}/favicon.ico`, never downloaded — just the URL string),
/// and a best-effort Open Graph / Twitter-card preview image URL (resolved to an
/// absolute http(s) URL). Blocking; callers MUST run this off the capture thread.
/// Returns `None` if the URL can't even be parsed, or if none of title/favicon/
/// image could be produced.
pub fn fetch(url: &str) -> Option<LinkMeta> {
    let parsed = reqwest::Url::parse(url).ok()?;
    // Only ever fetch http(s) — never file:// or other schemes (defense in depth;
    // don't rely on the HTTP client to reject them).
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let favicon_url = parsed
        .host_str()
        .map(|host| format!("{}://{}/favicon.ico", parsed.scheme(), host));

    // Fetch the page body once, then extract both title and preview image from it.
    let body = fetch_body(url);
    let title = body.as_deref().and_then(parse_title);
    let image_url = body
        .as_deref()
        .and_then(parse_og_image)
        // og:image may be a relative path — resolve it against the page URL, and
        // keep only http(s) results (never expose file:// etc. to an <img> tag).
        .and_then(|raw| parsed.join(&raw).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .map(|u| u.to_string());

    if title.is_none() && favicon_url.is_none() && image_url.is_none() {
        return None;
    }
    Some(LinkMeta { title, favicon_url, image_url })
}

/// Downloads up to `MAX_BODY_BYTES` of `url`'s body as a lossy UTF-8 string.
/// Returns `None` on any client/build/network error or non-2xx status.
fn fetch_body(url: &str) -> Option<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .ok()?;
    let mut resp = client.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        if buf.len() >= MAX_BODY_BYTES {
            break;
        }
        match resp.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Pure (no network) extraction of the first `<title>...</title>` from an HTML
/// document. Case-insensitive, tolerates attributes on the opening tag (e.g.
/// `<title lang="en">`), and decodes a handful of common HTML entities.
/// Returns `None` if there's no title tag or its text is empty after trimming.
pub fn parse_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let tag_start = lower.find("<title")?;
    let tag_close = lower[tag_start..].find('>')? + tag_start;
    let content_start = tag_close + 1;
    let end_rel = lower[content_start..].find("</title>")?;
    let content_end = content_start + end_rel;

    let raw = html.get(content_start..content_end)?;
    let decoded = decode_entities(raw);
    let trimmed = decoded.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Decodes the handful of HTML entities likely to appear in a `<title>`.
/// `&amp;` is decoded last so a doubly-escaped `&amp;lt;` correctly yields the
/// literal text `&lt;` rather than being over-decoded into `<`.
fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Pure (no network) extraction of a preview-image URL from an HTML document's
/// `<meta>` tags, trying Open Graph then Twitter-card properties in priority
/// order. Case-insensitive; tolerates either attribute order (`property`/`name`
/// before or after `content`), single or double quotes, and unquoted values.
/// Returns the raw (possibly relative) URL string; the caller resolves it against
/// the page URL. `None` if no matching meta tag is present.
pub fn parse_og_image(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    // Prefer the primary og:image; fall back to explicit url/secure_url variants
    // and finally Twitter cards. Exact property-value matching (below) means
    // "og:image" does NOT accidentally match "og:image:width" etc.
    for key in [
        "og:image",
        "og:image:secure_url",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
    ] {
        if let Some(v) = meta_content_for(html, &lower, key) {
            let decoded = decode_entities(&v);
            let trimmed = decoded.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Scans each `<meta …>` tag and returns the `content` value of the first tag
/// whose `property` or `name` attribute equals `key` (ASCII-case-insensitively).
/// `lower` must be `html.to_ascii_lowercase()` (same byte indices as `html`,
/// since lowercasing ASCII preserves length).
fn meta_content_for(html: &str, lower: &str, key: &str) -> Option<String> {
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<meta") {
        let tag_start = from + rel;
        // Bound the tag at its closing '>'. A tag with no '>' means malformed/
        // truncated HTML — stop scanning (best-effort).
        let tag_end = match lower[tag_start..].find('>') {
            Some(r) => tag_start + r,
            None => return None,
        };
        let tag = &html[tag_start..tag_end];
        let tag_lower = &lower[tag_start..tag_end];
        let matches_key = attr_value(tag, tag_lower, "property")
            .map(|v| v.eq_ignore_ascii_case(key))
            .unwrap_or(false)
            || attr_value(tag, tag_lower, "name")
                .map(|v| v.eq_ignore_ascii_case(key))
                .unwrap_or(false);
        if matches_key {
            if let Some(content) = attr_value(tag, tag_lower, "content") {
                return Some(content);
            }
        }
        from = tag_end + 1;
    }
    None
}

/// Extracts the value of the `attr` attribute from a single tag's text. Matches
/// `attr` only at a word boundary (so `content` isn't found inside another
/// attribute name), skips whitespace around `=`, and handles double-quoted,
/// single-quoted, and unquoted values. `tag`/`tag_lower` share byte indices.
fn attr_value(tag: &str, tag_lower: &str, attr: &str) -> Option<String> {
    let bytes = tag_lower.as_bytes();
    let mut from = 0;
    loop {
        let idx = from + tag_lower[from..].find(attr)?;
        let after = idx + attr.len();
        let prev_ok = idx == 0
            || matches!(bytes[idx - 1], b' ' | b'\t' | b'\r' | b'\n' | b'"' | b'\'' | b'/');
        let mut j = after;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if prev_ok && j < bytes.len() && bytes[j] == b'=' {
            j += 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j >= bytes.len() {
                return None;
            }
            let q = bytes[j];
            if q == b'"' || q == b'\'' {
                let start = j + 1;
                let end_rel = tag[start..].find(q as char)?;
                return Some(tag[start..start + end_rel].to_string());
            }
            // Unquoted value: read until whitespace or the end of the tag.
            let start = j;
            let mut k = start;
            while k < bytes.len() && !bytes[k].is_ascii_whitespace() {
                k += 1;
            }
            return Some(tag[start..k].to_string());
        }
        from = after;
        if from >= tag_lower.len() {
            return None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_title_with_entity_decoding() {
        let html = "<html><head><title>Hello &amp; Bye</title></head><body></body></html>";
        assert_eq!(parse_title(html), Some("Hello & Bye".to_string()));
    }

    #[test]
    fn missing_title_returns_none() {
        let html = "<html><head></head><body>No title here</body></html>";
        assert_eq!(parse_title(html), None);
    }

    #[test]
    fn parses_title_case_insensitively_with_attributes() {
        let html = "<HTML><HEAD><TITLE lang=\"en\">Mixed Case</TITLE></HEAD></HTML>";
        assert_eq!(parse_title(html), Some("Mixed Case".to_string()));
    }

    #[test]
    fn whitespace_only_title_is_none() {
        let html = "<title>   \n  </title>";
        assert_eq!(parse_title(html), None);
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let html = "<title>\n  Padded Title  \n</title>";
        assert_eq!(parse_title(html), Some("Padded Title".to_string()));
    }

    #[test]
    fn unclosed_title_returns_none_without_panic() {
        assert_eq!(parse_title("<title>Foo with no closing tag"), None);
        assert_eq!(parse_title("<title"), None);
        assert_eq!(parse_title(""), None);
    }

    #[test]
    fn parses_og_image_double_quoted() {
        let html = r#"<head><meta property="og:image" content="https://cdn.example.com/p.jpg"></head>"#;
        assert_eq!(
            parse_og_image(html),
            Some("https://cdn.example.com/p.jpg".to_string())
        );
    }

    #[test]
    fn parses_og_image_content_before_property_and_single_quotes() {
        let html = "<meta content='/img/hero.png' property='og:image' />";
        assert_eq!(parse_og_image(html), Some("/img/hero.png".to_string()));
    }

    #[test]
    fn og_image_falls_back_to_twitter_image() {
        let html = r#"<meta name="twitter:image" content="https://x.example/t.png">"#;
        assert_eq!(
            parse_og_image(html),
            Some("https://x.example/t.png".to_string())
        );
    }

    #[test]
    fn og_image_exact_match_does_not_grab_width_meta() {
        // Only og:image:width is present (no plain og:image) → must NOT return "600".
        let html = r#"<meta property="og:image:width" content="600">"#;
        assert_eq!(parse_og_image(html), None);
    }

    #[test]
    fn og_image_decodes_entities_in_url() {
        let html = r#"<meta property="og:image" content="https://e.com/i?a=1&amp;b=2">"#;
        assert_eq!(
            parse_og_image(html),
            Some("https://e.com/i?a=1&b=2".to_string())
        );
    }

    #[test]
    fn og_image_absent_returns_none() {
        assert_eq!(parse_og_image("<html><head></head></html>"), None);
    }

    #[test]
    fn fetch_rejects_non_http_schemes_without_network() {
        // Must return None immediately for non-http(s) schemes (no file:// access).
        assert!(fetch("file:///etc/passwd").is_none());
        assert!(fetch("ftp://example.com/x").is_none());
        assert!(fetch("not a url").is_none());
    }
}
