# Changelog

All notable changes to ClipVault are documented here.

## 1.0.0

The first complete release. Every tracked feature issue is implemented and closed.

### Content detection
- **Color detection & classification** (#14): recognizes HEX (3/4/6/8-digit), `rgb()/rgba()`, `hsl()/hsla()`, `hsv()/hsb()`, and `cmyk()`, with validation to avoid misclassification. Colors render a correct swatch even for notations CSS can't read (cmyk/hsv), the badge shows the actual format, and the Transform menu converts freely between formats. The original text is preserved.
- **Phone number detection & search** (#12): phone numbers are a distinct type (international `+CC`, `00`-prefixed, and national trunk-0 forms including Swiss `0XX XXX XX XX`), separated from generic Numbers, with their own sidebar category and Transform actions.

### History & navigation
- **Complete history loading** (#6): the timeline loads the whole history eagerly (no scroll-to-discover), so the date rail/calendar shows the full range immediately, with a loading indicator and a range summary.
- **Resizable & collapsible panels** (#4): the left navigation collapses to an icon rail (counts preserved) and is drag-resizable; the right History panel is collapsible and resizable. Layout is remembered per device.
- **Time format preference** (#11): choose 24-hour or 12-hour (AM/PM); applied consistently everywhere, with a live preview in Settings.

### Organization
- **Folder creation modal** (#15) and **folder management** (#16): styled in-app dialogs replace native prompts; folders are drag-reorderable with a persisted order and a styled delete confirmation.
- **Selection controls & bulk actions** (#10): a prominent, grouped bulk-action bar (Select all, Merge, Add to folder, Delete, Clear selection) with an obvious selection state; Esc clears the selection.
- **Multi-window library** (#5): open any library category (Text, Links, Numbers, Phone Numbers, Colors, Images & GIFs, Files) in its own live-updating window; one window per category, re-opening focuses the existing one.

### Insight
- **Clipboard usage tracking** (#13): copying and using are tracked separately — an item counts as "used" only on deliberate reuse from ClipVault, not on capture — and both are surfaced in the UI.
- **Usage analytics** (#7): a new Usage dashboard with overview stats, a 6-month usage heatmap, most-used / never-used filters, per-item usage history, and one-click collections (save to a folder, copy to share).
- **OCR image text search** (#9): searchable text is extracted from captured images via the optional Tesseract binary, with a Settings toggle and graceful fallback when it isn't installed.

### Keyboard
- **Custom keyboard shortcuts** (#8): a full shortcut manager with interactive recording, a visual keyboard, conflict detection with suggested alternatives, a live test, and a unified overview. Adds optional global shortcuts for Toggle Privacy and Quick Add.

### Fixes
- Restored the previously non-compiling test suite and corrected stale schema-version and documentation references.
