use crate::storage::ItemType;

pub fn classify(mime: &str, bytes: &[u8]) -> ItemType {
    let is_gif_magic = bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a");
    if mime == "image/gif" || is_gif_magic {
        ItemType::Gif
    } else if mime.starts_with("image/") {
        ItemType::Image
    } else if mime == "text/uri-list" {
        // A file-manager copy. The payload is a newline-separated list of file:// URIs,
        // which is text, but treating it as text would bury real file references in the
        // notes.
        ItemType::File
    } else {
        ItemType::Text
    }
}

/// Turns a `text/uri-list` payload into readable paths, one per line: comment lines
/// (leading `#`, per RFC 2483) are dropped and `file://` URIs are percent-decoded back
/// into ordinary paths. Non-file URIs are kept verbatim.
pub fn parse_uri_list(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|line| match line.strip_prefix("file://") {
            Some(path) => percent_decode(path),
            None => line.to_string(),
        })
        .collect()
}

/// Minimal percent-decoder for the `file://` URIs a file manager puts on the clipboard.
/// Invalid escapes are passed through rather than dropped, so a path is never silently
/// mangled.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn classify_text(content: &str) -> ItemType {
    let t = content.trim();
    if t.is_empty() { return ItemType::Text; }
    if is_color(t) { return ItemType::Color; }
    if is_link(t) { return ItemType::Link; }
    if is_number(t) { return ItemType::Number; }
    ItemType::Text
}

fn is_hex_digit(c: char) -> bool { c.is_ascii_hexdigit() }

fn is_color(t: &str) -> bool {
    if let Some(rest) = t.strip_prefix('#') {
        return (rest.len() == 3 || rest.len() == 6) && rest.chars().all(is_hex_digit);
    }
    let lower = t.to_ascii_lowercase();
    if (lower.starts_with("rgb(") || lower.starts_with("rgba(")) && lower.ends_with(')') {
        return true;
    }
    false
}

fn is_link(t: &str) -> bool {
    if t.chars().any(char::is_whitespace) { return false; }
    let starts = t.starts_with("http://") || t.starts_with("https://") || t.starts_with("www.");
    starts && t.len() > 4 && t.contains('.')
}

fn is_number(t: &str) -> bool {
    if is_link(t) { return false; }
    if let Some(rest) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        return !rest.is_empty() && rest.chars().all(is_hex_digit);
    }
    let digit_count = t.chars().filter(|c| c.is_ascii_digit()).count();
    let all_allowed = t.chars().all(|c| c.is_ascii_digit() || matches!(c, ' ' | '-' | '+' | '.' | '(' | ')'));
    all_allowed && digit_count >= 3
}

pub fn extension_for(item_type: ItemType, mime: &str) -> &'static str {
    match item_type {
        ItemType::Gif => "gif",
        ItemType::Image => match mime {
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            _ => "png",
        },
        ItemType::Text | ItemType::Link | ItemType::Number | ItemType::Color | ItemType::File => "txt",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gif_by_mime_and_by_magic() {
        assert_eq!(classify("image/gif", b""), ItemType::Gif);
        assert_eq!(classify("application/octet-stream", b"GIF89a...."), ItemType::Gif);
        assert_eq!(classify("image/png", b"\x89PNG\r\n"), ItemType::Image);
        assert_eq!(classify("image/jpeg", &[0xff,0xd8,0xff]), ItemType::Image);
    }

    #[test]
    fn text_otherwise() {
        assert_eq!(classify("text/plain;charset=utf-8", b"hello"), ItemType::Text);
        assert_eq!(classify("text/uri-list", b"file:///tmp/x"), ItemType::File);
    }

    #[test]
    fn extensions() {
        assert_eq!(extension_for(ItemType::Gif, "image/gif"), "gif");
        assert_eq!(extension_for(ItemType::Image, "image/png"), "png");
        assert_eq!(extension_for(ItemType::Image, "image/jpeg"), "jpg");
    }

    #[test]
    fn classifies_colors() {
        assert_eq!(classify_text("#7C6CF0"), ItemType::Color);
        assert_eq!(classify_text("#abc"), ItemType::Color);
        assert_eq!(classify_text("rgb(124, 108, 240)"), ItemType::Color);
    }

    #[test]
    fn classifies_links() {
        assert_eq!(classify_text("https://example.com/x"), ItemType::Link);
        assert_eq!(classify_text("https://www.bild.de"), ItemType::Link);
        assert_eq!(classify_text("http://example.com"), ItemType::Link);
        assert_eq!(classify_text("www.example.com"), ItemType::Link);
        assert_eq!(classify_text("  https://trimmed.example.com/path?q=1  "), ItemType::Link);
        assert_eq!(classify_text("not a link just words"), ItemType::Text);
    }

    #[test]
    fn classifies_numbers() {
        assert_eq!(classify_text("1234567890"), ItemType::Number);
        assert_eq!(classify_text("+41 79 123 45 67"), ItemType::Number);
        assert_eq!(classify_text("0xDEADBEEF"), ItemType::Number);
        assert_eq!(classify_text("hello world"), ItemType::Text);
    }
}
