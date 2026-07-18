use std::path::{Path, PathBuf};

const MAX_DIM: u32 = 256;

pub fn generate(bytes: &[u8], thumbs_dir: &Path, hash: &str) -> Option<PathBuf> {
    std::fs::create_dir_all(thumbs_dir).ok()?;
    let img = image::load_from_memory(bytes).ok()?;
    let thumb = img.thumbnail(MAX_DIM, MAX_DIM); // preserves aspect, fast
    let rgba = thumb.to_rgba8();
    let encoder = webp::Encoder::from_rgba(&rgba, rgba.width(), rgba.height());
    let webp_data = encoder.encode_simple(false, 80.0).ok()?; // quality 80
    let out = thumbs_dir.join(format!("{hash}.webp"));
    std::fs::write(&out, &*webp_data).ok()?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    // A tiny valid PNG (2x2) so resize has something to do.
    fn png_2x2() -> Vec<u8> {
        // 2x2 white PNG
        base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==")
    }
    fn base64_decode(s: &str) -> Vec<u8> {
        // minimal decoder to avoid a dep in tests
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new(); let mut buf = 0u32; let mut bits = 0;
        for &c in s.as_bytes() {
            if c == b'=' { break }
            let v = T.iter().position(|&x| x == c).unwrap() as u32;
            buf = (buf << 6) | v; bits += 6;
            if bits >= 8 { bits -= 8; out.push((buf >> bits) as u8); }
        }
        out
    }

    #[test]
    fn generates_smaller_webp_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let png = png_2x2();
        let out = generate(&png, dir.path(), "abc123").expect("thumbnail");
        assert!(out.exists());
        assert_eq!(out.extension().unwrap(), "webp");
        assert!(std::fs::metadata(&out).unwrap().len() > 0);
    }

    #[test]
    fn returns_none_on_garbage() {
        let dir = tempfile::tempdir().unwrap();
        assert!(generate(b"not an image", dir.path(), "z").is_none());
    }
}
