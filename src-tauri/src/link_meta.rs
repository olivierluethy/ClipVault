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
}

const USER_AGENT: &str = "Mozilla/5.0 (compatible; ClipVault/0.1; clipboard-manager)";
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
/// A `<title>` always lives near the top of `<head>`; capping how much of the
/// body we read keeps this fast and bounded even for very large pages.
const MAX_BODY_BYTES: usize = 262_144; // 256 KiB

/// Fetches `url`'s page title and computes a best-effort favicon URL
/// (`{scheme}://{host}/favicon.ico`, never downloaded — just the URL string).
/// Blocking; callers MUST run this off the capture thread. Returns `None` if
/// the URL can't even be parsed, or if neither a title nor a favicon URL could
/// be produced.
pub fn fetch(url: &str) -> Option<LinkMeta> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let favicon_url = parsed
        .host_str()
        .map(|host| format!("{}://{}/favicon.ico", parsed.scheme(), host));

    let title = fetch_title(url);

    if title.is_none() && favicon_url.is_none() {
        return None;
    }
    Some(LinkMeta { title, favicon_url })
}

fn fetch_title(url: &str) -> Option<String> {
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
    let text = String::from_utf8_lossy(&buf);
    parse_title(&text)
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
}
