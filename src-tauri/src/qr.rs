use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// Render `text` as a self-contained SVG QR code string (dark-on-light so it scans
/// reliably regardless of the app's dark theme). Returns an error if the text is too
/// long to encode. Used by the `qr_svg` IPC command to show a scannable code for a
/// text/link item (e.g. hand a URL off to a phone).
pub fn svg_for(text: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M)
        .map_err(|e| format!("cannot encode QR: {e}"))?;
    let image = code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .quiet_zone(true)
        .dark_color(svg::Color("#111111"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_svg_for_url() {
        let out = svg_for("https://example.com").unwrap();
        assert!(out.starts_with("<?xml") || out.contains("<svg"));
        assert!(out.contains("path") || out.contains("rect"));
    }

    #[test]
    fn empty_string_still_encodes() {
        // An empty payload is a valid (if pointless) QR code, not an error.
        assert!(svg_for("").is_ok());
    }
}
