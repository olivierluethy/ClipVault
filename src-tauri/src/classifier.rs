use crate::storage::ItemType;

pub fn classify(mime: &str, bytes: &[u8]) -> ItemType {
    let is_gif_magic = bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a");
    if mime == "image/gif" || is_gif_magic {
        ItemType::Gif
    } else if mime.starts_with("image/") {
        ItemType::Image
    } else {
        ItemType::Text
    }
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
        ItemType::Text => "txt",
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
        assert_eq!(classify("text/uri-list", b"https://x"), ItemType::Text);
    }

    #[test]
    fn extensions() {
        assert_eq!(extension_for(ItemType::Gif, "image/gif"), "gif");
        assert_eq!(extension_for(ItemType::Image, "image/png"), "png");
        assert_eq!(extension_for(ItemType::Image, "image/jpeg"), "jpg");
    }
}
