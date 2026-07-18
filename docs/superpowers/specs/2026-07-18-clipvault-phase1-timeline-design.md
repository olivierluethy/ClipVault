# ClipVault — Phase 1 · Sub-project 1: Timeline + Item Actions (Design)

*Date: 2026-07-18*
*Status: Approved (design) — pending written-spec review*

## Purpose

Turn the Phase 0 debug list into a genuinely usable clipboard manager: a fast,
date-grouped, virtualized timeline you can copy back from, delete from (with undo),
pin, zoom images in, and drive entirely from the keyboard. This is the first
sub-project of Phase 1 (the daily-drivable MVP); folders, search, and a settings
screen are later sub-projects that layer onto the timeline this builds.

## Locked decisions (from brainstorming)

- **Copy-back keeps the window open** and shows a brief "Copied ✓" flash (not hide-to-paste).
- **Include all three extras** in this sub-project: pin/favorite, image/GIF zoom modal, quick-copy 1–9.
- **Thumbnails generated at capture** (small WebP), timeline loads thumbnails only.
- **Virtualization: `@tanstack/react-virtual`**.
- Dark-mode only; violet accent `#7C6CF0` on `#121212` (unchanged).
- Toolchain: Vite 5 (Node 18); run via `npm run tauri dev`, standalone via `npm run tauri build`.

## Scope

**In:**
- Virtualized, date-grouped timeline (Today / Yesterday / explicit dates; sticky headers).
- Per-type cards (text / image / gif) — type badge, preview, timestamp, copy_count.
- **Pinned section** at the top (above the dated groups).
- **Copy-back**: click a card or press Enter → writes to the clipboard, "Copied ✓" flash, window stays open; **self-copy suppressed** (no echo entry) via the Phase 0 seam.
- **Delete + 5s undo** toast (soft-delete).
- **Pin/favorite** toggle (click + `P` key); pinned items exempt from future cleanup.
- **Image/GIF zoom modal** (click image → full-size; GIFs animate; `Esc` closes).
- **Quick-copy 1–9** (copy the Nth visible item).
- **Keyboard nav**: `↑`/`↓` move selection, `Enter` copy, `Del` delete, `Esc` close/deselect, `P` pin, `1–9` quick-copy.

**Out (later sub-projects / phases):** folders + sidebar, search (FTS5), settings screen,
link/number/color classification, edit-in-place, clean-copy / plain-text copy, QR, retention.

## Backend (Rust) changes

### Schema migration (versioned)
Introduce a real migration step keyed on `PRAGMA user_version`:
- v1 → v2: `ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
  `ADD COLUMN preview_path TEXT`, `ADD COLUMN deleted_at INTEGER` (nullable).
- Idempotent and forward-only; Phase 0 DBs upgrade in place on first launch.
- Add `CREATE INDEX idx_items_pinned ON items(pinned)`.

### Thumbnails at capture
In the capture pipeline, for `image`/`gif`, after writing the original file:
- Decode + resize to a max dimension (~256px, preserve aspect) via the `image` crate.
- Encode a small **WebP** thumbnail (via the `webp` crate; libwebp built bundled — **verify at
  implementation time**, fall back to PNG if the bundled build is problematic) to
  `attachments/thumbs/<hash>.webp`; store its path in `preview_path`.
- GIF thumbnail = first frame (static); the animated original stays for the zoom modal.
- Thumbnail failure is non-fatal: log, leave `preview_path` NULL (card falls back to the original).

### Copy-back write path
- A dedicated **clipboard-writer thread** owns an `x11-clipboard` `Clipboard` (mirrors the
  watcher-thread pattern; sidesteps `Send`/`Sync`), receiving `(mime, bytes)` write requests over a channel.
- `copy_item(id)`: load the item; set the **self-copy marker** (`AppState.last_self_copy` = item hash)
  BEFORE sending the write, so the watcher suppresses the resulting clipboard-change echo; then send
  the bytes+mime to the writer to `store()`.
- Text items store `UTF8_STRING`; image/gif items store their MIME target with the raw file bytes.

### Delete + undo (soft-delete)
- `delete_item(id)`: set `deleted_at = now`; the item disappears from timeline queries immediately.
- `restore_item(id)`: clear `deleted_at` (undo).
- Purge: on startup, hard-delete rows with non-null `deleted_at` (and their attachment/thumb files).
  (5s undo window lives in the UI; a soft-deleted row that outlives the session is purged next launch.)

### Pinning
- `set_pinned(id, bool)`: update `pinned`; pinned items always sort into the pinned section.

### IPC surface (new)
- `list_items(limit: i64, before: Option<i64>) -> Vec<ItemDto>` — paged, ordered `created_at DESC`;
  **excludes both soft-deleted and pinned** items (pinned live only in the pinned section, so they are
  not duplicated in the dated timeline; cursor = last `created_at`).
- `list_pinned() -> Vec<ItemDto>` — all pinned, newest-first (small set, unpaged).
- `copy_item(id: String) -> Result<(), String>`
- `delete_item(id: String) -> Result<(), String>` / `restore_item(id: String) -> Result<(), String>`
- `set_pinned(id: String, pinned: bool) -> Result<(), String>`
- `ItemDto` gains `pinned: bool`, `preview_path: Option<String>`, `updated_at: i64`.
- `item-added` event continues to notify the UI to refresh the head page.

## Frontend (React + Tailwind, dark) changes

Replace the debug `App.tsx` with focused components:
- **`Timeline`** — `@tanstack/react-virtual` list with sticky date-group headers; a pinned section
  rendered above the virtualized dated groups; infinite-scroll paging via `list_items(before)`.
- **`Card`** (per type) — type badge, preview (text snippet / thumbnail via `convertFileSrc(preview_path)`),
  timestamp, copy_count; action buttons (copy / pin / delete) shown on hover and on keyboard focus;
  primary copy action visually dominant.
- **`ZoomModal`** — full-size image/animated-GIF (original file), `Esc` / scroll to close; shows dimensions + size.
- **`UndoToast`** — appears on delete for 5s with an Undo button.
- **`useKeyboardNav`** — selection state + `↑↓/Enter/Del/Esc/P/1–9` handlers; `?` shows a shortcut cheat-sheet (optional).
- **`api.ts`** — typed wrappers for the new commands + events; "Copied ✓" flash state.

## Data flow

Capture (now also writes a thumbnail) → `item-added` → timeline refetches the head page.
Copy-back → set self-copy marker → writer `store()`s → "Copied ✓" flash (no echo entry).
Delete → `delete_item` (soft) → item vanishes + UndoToast → Undo calls `restore_item`, else purged next launch.
Pin → `set_pinned` → item moves to/from the pinned section.

## Error handling
- Thumbnail generation failure → non-fatal (NULL `preview_path`, card uses original).
- Copy-back write failure → surfaced as a command error (toast); no marker leak (marker is one-shot).
- Migration failure → hard error at startup (better than a half-migrated DB); Phase 0 safety-snapshot is a later phase.
- Soft-deleted purge failure (missing file) → log, continue.

## Testing

### Rust unit tests
- Migration idempotency (run twice; columns present; existing rows get defaults).
- Thumbnail generation (valid image in, smaller thumbnail out; failure path leaves NULL).
- Soft-delete: `delete_item` hides from `list_items`; `restore_item` brings it back; purge removes rows+files.
- Pin toggle + ordering (pinned excluded from dated paging / present in `list_pinned`).
- `copy_item` sets the self-copy marker to the item's hash.
- Paging: `list_items(before)` returns the correct next page, newest-first, no soft-deleted.

### Runtime gate (extended, sandboxed X11) — MUST include UI verification
Reuse the Phase 0 harness (`scratchpad/gate.sh` + `clip-set`/`clip-read` helpers, `xwd2png.py`):
- **Copy-back actually sets the X clipboard** — after `copy_item`, `clip-read` reads back the exact bytes;
  and self-copy suppression means no new/bumped entry from the echo.
- Thumbnails created on capture (`attachments/thumbs/*.webp` exists, is a valid smaller image).
- Delete hides the item; undo restores; pin moves it.
- **Screenshot verification** (production build via `npm run tauri build`): capture the window with `xwd`,
  decode to PNG, and confirm the rendered timeline shows the item cards, pinned section, and a thumbnail —
  i.e. verify pixels, not just the DB. (This is the explicit guard against the Phase 0 "blank window" miss.)

### Manual (user)
Tray/hotkey interactions and the zoom-modal/undo-toast feel — a short visual pass.

## Out of scope for this sub-project
Folders/sidebar, FTS5 search, settings screen, link/number/color classification, edit-in-place,
clean/plain-text copy, QR codes, retention rules, scheduled backups, SQLCipher.
