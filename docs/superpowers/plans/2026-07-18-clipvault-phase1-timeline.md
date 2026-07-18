# ClipVault Phase 1 · Sub-project 1: Timeline + Item Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 0 debug list with a fast, virtualized, date-grouped timeline you can copy back from, delete (with undo), pin, zoom images in, and drive from the keyboard.

**Architecture:** Extend the existing Rust core (SQLite migration for `pinned`/`preview_path`/`deleted_at`; WebP thumbnails at capture; a clipboard-writer thread for copy-back with self-copy suppression; new paged/soft-delete/pin IPC) and replace the React UI with a `@tanstack/react-virtual` timeline + cards + zoom modal + undo toast + keyboard-nav layer.

**Tech Stack:** Tauri v2, Rust (`rusqlite`, `image`, `webp`, `x11-clipboard`), React 19 + TypeScript + Vite 5 + Tailwind + `@tanstack/react-virtual`. Node 18.

## Global Constraints

- Builds on Phase 0 `master`. Dark-mode only; accent `#7C6CF0` on `#121212`.
- **Vite 5** (Node 18); dev = `npm run tauri dev`, standalone = `npm run tauri build`.
- `cargo` needs `. "$HOME/.cargo/env"` prefix; use a SINGLE `cargo test` filter.
- Schema migration is forward-only, idempotent, keyed on `PRAGMA user_version` (Phase 0 DB = v1 → v2).
- Copy-back keeps the window open + "Copied ✓" flash; the echo is suppressed via `AppState.last_self_copy` (the Phase 0 seam).
- Delete is **soft** (`deleted_at`); `list_*` exclude soft-deleted; pinned items excluded from the dated list (pinned section only); purge soft-deleted rows + their files on startup.
- Thumbnails: decode+resize via `image`, encode WebP via `webp` (**verify the bundled libwebp build; fall back to PNG** if problematic). Thumbnail failure is non-fatal (NULL `preview_path`).
- Raw original bytes for images/gifs preserved unchanged (Phase 0 guarantee).
- Conventional Commits; end each body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; commit with `-c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net"`.
- **UI must be screenshot-verified** (xwd→PNG), not just DB-verified.
- Out of scope: folders, search, settings screen, link/number/color classification, edit-in-place, clean/plain copy, QR.

## File Structure

```
src-tauri/src/
├─ storage/mod.rs        # + migration (user_version v1→v2)
├─ storage/items.rs      # + pinned/preview_path/updated_at in ItemDto; list_items/list_pinned;
│                        #   soft delete/restore/purge; set_pinned
├─ thumbnail.rs          # NEW: generate_thumbnail(bytes, mime, out_dir, hash) -> Option<PathBuf>
├─ capture.rs            # + thumbnail generation for image/gif
├─ clipboard_writer.rs   # NEW: writer thread + WriteRequest channel
├─ state.rs              # + writer sender handle
├─ ipc.rs                # + list_items/list_pinned/copy_item/delete_item/restore_item/set_pinned
├─ lib.rs                # spawn writer thread; register new commands; purge on startup
src/
├─ api.ts                # expanded Item type + new command/event wrappers
├─ App.tsx               # Timeline shell (pinned section + virtualized dated groups)
├─ components/Card.tsx           # NEW
├─ components/ZoomModal.tsx      # NEW
├─ components/UndoToast.tsx      # NEW
├─ hooks/useKeyboardNav.ts       # NEW
├─ hooks/useTimeline.ts          # NEW (paging + live refresh + grouping)
└─ lib/dates.ts                  # NEW (Today/Yesterday/date grouping)
```

---

## Task 1: Schema migration (user_version v1→v2)

**Files:** Modify `src-tauri/src/storage/mod.rs`

**Interfaces:**
- Produces: `Storage::open` runs migrations so `items` has `pinned INTEGER NOT NULL DEFAULT 0`, `preview_path TEXT`, `deleted_at INTEGER`, plus `idx_items_pinned`. `PRAGMA user_version` ends at 2.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/storage/mod.rs`:
```rust
#[test]
fn migration_adds_v2_columns_and_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("clipvault.db");
    // First open migrates to v2.
    let s = Storage::open(&db).unwrap();
    {
        let conn = s.conn.lock().unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('items')").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap()
            .map(|r| r.unwrap()).collect();
        for c in ["pinned", "preview_path", "deleted_at"] {
            assert!(cols.contains(&c.to_string()), "missing column {c}");
        }
    }
    // Reopen: must not error (idempotent) and stay at v2.
    drop(s);
    let s2 = Storage::open(&db).unwrap();
    let v: i64 = s2.conn.lock().unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 2);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `. "$HOME/.cargo/env"; cargo test storage::tests::migration 2>&1 | tail -20`
Expected: FAIL (user_version 0/1, columns missing).

- [ ] **Step 3: Implement the migration**

In `src-tauri/src/storage/mod.rs`, after `conn.execute_batch(SCHEMA)?;` in `open`, add a call `migrate(&conn)?;` and define:
```rust
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let mut version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    // Phase 0 DBs report 0; treat 0 and 1 as the pre-Phase-1 baseline.
    if version < 2 {
        // Add columns only if absent (a fresh SCHEMA may already differ across versions).
        let existing: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('items')")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<_>>()?;
        if !existing.iter().any(|c| c == "pinned") {
            conn.execute("ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !existing.iter().any(|c| c == "preview_path") {
            conn.execute("ALTER TABLE items ADD COLUMN preview_path TEXT", [])?;
        }
        if !existing.iter().any(|c| c == "deleted_at") {
            conn.execute("ALTER TABLE items ADD COLUMN deleted_at INTEGER", [])?;
        }
        conn.execute("CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(pinned)", [])?;
        conn.execute("PRAGMA user_version = 2", [])?;
        version = 2;
    }
    let _ = version;
    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `. "$HOME/.cargo/env"; cargo test storage::tests::migration 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: schema migration v2 (pinned, preview_path, deleted_at)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Expand ItemDto + paged/pinned queries

**Files:** Modify `src-tauri/src/storage/items.rs`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `ItemDto` gains `pinned: bool`, `preview_path: Option<String>`, `updated_at: i64`.
  - `Storage::list_items(&self, limit: i64, before: Option<i64>) -> rusqlite::Result<Vec<ItemDto>>` — `deleted_at IS NULL AND pinned = 0`, `created_at DESC`, `created_at < before` when `before` is `Some`.
  - `Storage::list_pinned(&self) -> rusqlite::Result<Vec<ItemDto>>` — `deleted_at IS NULL AND pinned = 1`, `created_at DESC`.
  - Existing `list_recent` stays (used by nothing after Task 7; keep for back-compat tests) — update its `ItemDto` construction for the new fields.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/storage/items.rs` tests:
```rust
#[test]
fn list_items_pages_excludes_pinned_and_deleted() {
    let (_d, s) = storage();
    let mk = |c: &str, hash: &str, t: i64| s.insert_or_bump(
        NewItem{item_type:ItemType::Text, content:Some(c.into()), file_path:None, content_hash:hash.into()}, t).unwrap();
    mk("a","ha",100); mk("b","hb",200); mk("c","hc",300);
    // page 1: newest first
    let p1 = s.list_items(2, None).unwrap();
    assert_eq!(p1.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(), vec!["c","b"]);
    // page 2 via cursor = last created_at
    let p2 = s.list_items(2, Some(p1.last().unwrap().created_at)).unwrap();
    assert_eq!(p2.iter().map(|i| i.content.clone().unwrap()).collect::<Vec<_>>(), vec!["a"]);
    // pin "b" -> excluded from list_items, present in list_pinned
    let id_b = s.list_items(10, None).unwrap().into_iter().find(|i| i.content.as_deref()==Some("b")).unwrap().id;
    s.set_pinned(&id_b, true).unwrap();
    assert!(s.list_items(10, None).unwrap().iter().all(|i| i.content.as_deref()!=Some("b")));
    assert_eq!(s.list_pinned().unwrap().len(), 1);
}
```
(Requires `set_pinned` from Task 4 — write these two tasks together, or stub `set_pinned` now and fill in Task 4. If splitting, gate this assertion behind Task 4.)

- [ ] **Step 2: Run test to verify it fails**

Run: `. "$HOME/.cargo/env"; cargo test storage::items::tests::list_items 2>&1 | tail -20`
Expected: FAIL (`list_items`/`list_pinned` not found).

- [ ] **Step 3: Implement**

Update the `ItemDto` struct in `src-tauri/src/storage/items.rs`:
```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct ItemDto {
    pub id: String,
    pub item_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub preview_path: Option<String>,
    pub copy_count: i64,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
```
Add a shared row-mapper and the queries (before the tests module):
```rust
const ITEM_COLS: &str =
    "id, type, content, file_path, preview_path, copy_count, pinned, created_at, updated_at";

fn map_item(r: &rusqlite::Row) -> rusqlite::Result<ItemDto> {
    Ok(ItemDto {
        id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?, file_path: r.get(3)?,
        preview_path: r.get(4)?, copy_count: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0, created_at: r.get(7)?, updated_at: r.get(8)?,
    })
}

impl Storage {
    pub fn list_items(&self, limit: i64, before: Option<i64>) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND pinned = 0 AND (?2 IS NULL OR created_at < ?2)
             ORDER BY created_at DESC LIMIT ?1");
        let mut stmt = conn.prepare(&sql)?;
        stmt.query_map(rusqlite::params![limit, before], map_item)?.collect()
    }

    pub fn list_pinned(&self) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLS} FROM items
             WHERE deleted_at IS NULL AND pinned = 1 ORDER BY created_at DESC"))?;
        stmt.query_map([], map_item)?.collect()
    }
}
```
Update the existing `list_recent` to `SELECT {ITEM_COLS} ...` and use `map_item` (drops the old hand-written mapping).

- [ ] **Step 4: Run test to verify it passes**

Run (after Task 4 `set_pinned` exists): `. "$HOME/.cargo/env"; cargo test storage::items 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: expand ItemDto + paged list_items/list_pinned queries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Soft-delete, restore, purge

**Files:** Modify `src-tauri/src/storage/items.rs`, `src-tauri/src/storage/mod.rs` (call purge in `open`)

**Interfaces:**
- Produces:
  - `Storage::soft_delete(&self, id: &str, now: i64) -> rusqlite::Result<()>`
  - `Storage::restore(&self, id: &str) -> rusqlite::Result<()>`
  - `Storage::purge_deleted(&self) -> rusqlite::Result<Vec<(Option<String>, Option<String>)>>` — returns (file_path, preview_path) of purged rows so the caller can delete files; removes the rows.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn soft_delete_hides_then_restore_then_purge() {
    let (_d, s) = storage();
    s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("x".into()),file_path:None,content_hash:"hx".into()},100).unwrap();
    let id = s.list_items(10, None).unwrap()[0].id.clone();
    s.soft_delete(&id, 500).unwrap();
    assert_eq!(s.list_items(10, None).unwrap().len(), 0);   // hidden
    s.restore(&id).unwrap();
    assert_eq!(s.list_items(10, None).unwrap().len(), 1);   // back
    s.soft_delete(&id, 600).unwrap();
    let purged = s.purge_deleted().unwrap();
    assert_eq!(purged.len(), 1);
    // row is gone entirely now
    let conn = s.conn.lock().unwrap();
    let n: i64 = conn.query_row("SELECT count(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `. "$HOME/.cargo/env"; cargo test storage::items::tests::soft_delete 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `impl Storage` in `items.rs`:
```rust
    pub fn soft_delete(&self, id: &str, now: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id])?;
        Ok(())
    }
    pub fn restore(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET deleted_at = NULL WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
    pub fn purge_deleted(&self) -> rusqlite::Result<Vec<(Option<String>, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let files: Vec<(Option<String>, Option<String>)> = conn
            .prepare("SELECT file_path, preview_path FROM items WHERE deleted_at IS NOT NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        conn.execute("DELETE FROM items WHERE deleted_at IS NOT NULL", [])?;
        Ok(files)
    }
```
In `src-tauri/src/storage/mod.rs` `open`, after migration, purge and best-effort delete files:
```rust
    let s = Storage { conn: Mutex::new(conn), root };
    if let Ok(purged) = s.purge_deleted() {
        for (fp, pp) in purged {
            if let Some(p) = fp { let _ = std::fs::remove_file(p); }
            if let Some(p) = pp { let _ = std::fs::remove_file(p); }
        }
    }
    Ok(s)
```
(Adjust `open` to build `s` first, purge, then return it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `. "$HOME/.cargo/env"; cargo test storage::items::tests::soft_delete 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: soft-delete/restore/purge for items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pin toggle

**Files:** Modify `src-tauri/src/storage/items.rs`

**Interfaces:** `Storage::set_pinned(&self, id: &str, pinned: bool) -> rusqlite::Result<()>`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn set_pinned_toggles() {
    let (_d, s) = storage();
    s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("p".into()),file_path:None,content_hash:"hp".into()},100).unwrap();
    let id = s.list_items(10,None).unwrap()[0].id.clone();
    s.set_pinned(&id, true).unwrap();
    assert_eq!(s.list_pinned().unwrap().len(), 1);
    s.set_pinned(&id, false).unwrap();
    assert_eq!(s.list_pinned().unwrap().len(), 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `. "$HOME/.cargo/env"; cargo test storage::items::tests::set_pinned 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
    pub fn set_pinned(&self, id: &str, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET pinned = ?1, updated_at = ?1_ts WHERE id = ?2",
            rusqlite::params![]) // replaced below
        ;
        Ok(())
    }
```
Use this correct body instead:
```rust
    pub fn set_pinned(&self, id: &str, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE items SET pinned = ?1 WHERE id = ?2",
            rusqlite::params![pinned as i64, id])?;
        Ok(())
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `. "$HOME/.cargo/env"; cargo test storage::items 2>&1 | tail -20`
Expected: PASS (Task 2 + 3 + 4 tests all green).

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: set_pinned toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Thumbnails at capture

**Files:** Create `src-tauri/src/thumbnail.rs`; modify `src-tauri/src/capture.rs`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (`mod thumbnail;`)

**Interfaces:**
- Produces: `thumbnail::generate(bytes: &[u8], thumbs_dir: &Path, hash: &str) -> Option<PathBuf>` — decode, resize to max 256px, encode WebP to `thumbs_dir/<hash>.webp`, return path; `None` on any failure. Capture pipeline calls it for image/gif and stores the path in `preview_path`.
- `NewItem` gains `preview_path: Option<String>`; `insert_or_bump` persists it.

- [ ] **Step 1: Add deps to `src-tauri/Cargo.toml`**

```toml
image = { version = "0.25", default-features = false, features = ["png","jpeg","gif","bmp","webp"] }
webp = "0.3"
```

- [ ] **Step 2: Write the failing test**

`src-tauri/src/thumbnail.rs`:
```rust
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::*;
    // A tiny valid PNG (2x2) so resize has something to do.
    fn png_2x2() -> Vec<u8> {
        // 2x2 white PNG
        base64_decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8//8/AwYwYsQIAF8CAv3jZ8nJAAAAAElFTkSuQmCC")
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `. "$HOME/.cargo/env"; cargo test thumbnail 2>&1 | tail -20`
Expected: FAIL (`generate` not found).

- [ ] **Step 4: Implement**

Prepend to `src-tauri/src/thumbnail.rs`:
```rust
const MAX_DIM: u32 = 256;

pub fn generate(bytes: &[u8], thumbs_dir: &Path, hash: &str) -> Option<PathBuf> {
    std::fs::create_dir_all(thumbs_dir).ok()?;
    let img = image::load_from_memory(bytes).ok()?;
    let thumb = img.thumbnail(MAX_DIM, MAX_DIM); // preserves aspect, fast
    let rgba = thumb.to_rgba8();
    let encoder = webp::Encoder::from_rgba(&rgba, rgba.width(), rgba.height());
    let webp_data = encoder.encode(80.0); // quality 80
    let out = thumbs_dir.join(format!("{hash}.webp"));
    std::fs::write(&out, &*webp_data).ok()?;
    Some(out)
}
```
Add `mod thumbnail;` to `src-tauri/src/lib.rs`.

> **VERIFY:** the `webp` crate builds libwebp bundled (needs a C compiler; `build-essential` is installed). If `cargo build` fails on `webp`, switch to PNG thumbnails: encode with `image` (`thumb.save(out.with_extension("png"))`) and use `.png`. Report which path was taken.

- [ ] **Step 5: Run test to verify it passes**

Run: `. "$HOME/.cargo/env"; cargo test thumbnail 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Wire into capture**

In `src-tauri/src/capture.rs`, add `preview_path` to `NewItem` (in `items.rs`) and set it for image/gif. Change the image/gif branch of `process_event`:
```rust
        ItemType::Image | ItemType::Gif => {
            let id_ext = extension_for(item_type, &ev.mime);
            let file_name = format!("{}.{}", &hash, id_ext);
            let path = storage.attachments_dir().join(&file_name);
            if !path.exists() { std::fs::write(&path, &ev.bytes)?; }
            let thumbs = storage.attachments_dir().join("thumbs");
            let preview = crate::thumbnail::generate(&ev.bytes, &thumbs, &hash)
                .map(|p| p.to_string_lossy().into_owned());
            NewItem { item_type, content: None,
                file_path: Some(path.to_string_lossy().into_owned()),
                preview_path: preview, content_hash: hash }
        }
```
Update the text branch and `insert_or_bump` INSERT to include `preview_path` (NULL for text). Update the 5 existing capture/items tests that construct `NewItem` to add `preview_path: None`.

- [ ] **Step 7: Run full suite**

Run: `. "$HOME/.cargo/env"; cargo test 2>&1 | tail -20`
Expected: all pass; no warnings.

- [ ] **Step 8: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: WebP thumbnails at capture, stored in preview_path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Clipboard-writer thread + copy_item

**Files:** Create `src-tauri/src/clipboard_writer.rs`; modify `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `clipboard_writer::WriteRequest { mime: String, bytes: Vec<u8> }`
  - `clipboard_writer::spawn() -> std::sync::mpsc::Sender<WriteRequest>` — owns an `x11-clipboard` `Clipboard`, loops receiving requests and `store`s them (text→UTF8_STRING, image mime→interned atom).
  - `AppState` gains `writer: std::sync::mpsc::Sender<WriteRequest>`.
  - `copy_item` logic: set `last_self_copy` = item hash, then send a `WriteRequest`.

- [ ] **Step 1: Implement the writer + a marker-setting unit test**

`src-tauri/src/clipboard_writer.rs`:
```rust
use std::sync::mpsc::{channel, Sender};
use x11_clipboard::Clipboard;

#[derive(Debug)]
pub struct WriteRequest { pub mime: String, pub bytes: Vec<u8> }

pub fn spawn() -> Sender<WriteRequest> {
    let (tx, rx) = channel::<WriteRequest>();
    std::thread::spawn(move || {
        let cb = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => { eprintln!("clipvault: clipboard writer unavailable: {e}"); return; }
        };
        let sel = cb.setter.atoms.clipboard;
        for req in rx {
            let target = if req.mime == "UTF8_STRING" {
                cb.setter.atoms.utf8_string
            } else {
                match cb.setter.get_atom(&req.mime) { Ok(a) => a, Err(_) => continue }
            };
            if let Err(e) = cb.store(sel, target, req.bytes) {
                eprintln!("clipvault: clipboard store failed: {e}");
            }
        }
    });
    tx
}
```
(The marker-setting is unit-tested via the `copy_item` helper in Task 7's ipc test, which uses a fake `Storage` + marker; the live store is verified in the runtime gate. No unit test here — this file is I/O-only.)

- [ ] **Step 2: Extend AppState**

In `src-tauri/src/state.rs`:
```rust
pub struct AppState {
    pub storage: Arc<Storage>,
    pub privacy: Arc<AtomicBool>,
    pub last_self_copy: Arc<std::sync::Mutex<Option<String>>>,
    pub writer: std::sync::mpsc::Sender<crate::clipboard_writer::WriteRequest>,
}
```
Add `mod clipboard_writer;` to `src-tauri/src/lib.rs`; in `setup`, `let writer = crate::clipboard_writer::spawn();` and include it in the managed `AppState`.

- [ ] **Step 3: Verify it builds**

Run: `. "$HOME/.cargo/env"; cargo build 2>&1 | tail -20`
Expected: builds (copy_item command added in Task 7).

- [ ] **Step 4: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: clipboard-writer thread for copy-back

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: New IPC commands

**Files:** Modify `src-tauri/src/ipc.rs`, `src-tauri/src/lib.rs` (register), add helper for `copy_item` bytes.

**Interfaces:**
- Produces IPC: `list_items`, `list_pinned`, `copy_item`, `delete_item`, `restore_item`, `set_pinned`. `Storage::get_item(&self, id) -> rusqlite::Result<Option<(String /*type*/, Option<String> /*content*/, Option<String> /*file_path*/, String /*hash*/)>>` for copy-back.

- [ ] **Step 1: Add `Storage::get_item` + test**

In `items.rs`:
```rust
    pub fn get_item(&self, id: &str) -> rusqlite::Result<Option<(String, Option<String>, Option<String>, String)>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row("SELECT type, content, file_path, content_hash FROM items WHERE id=?1",
            rusqlite::params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
```
Test:
```rust
#[test]
fn get_item_returns_fields() {
    let (_d, s) = storage();
    s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("q".into()),file_path:None,preview_path:None,content_hash:"hq".into()},1).unwrap();
    let id = s.list_items(10,None).unwrap()[0].id.clone();
    let got = s.get_item(&id).unwrap().unwrap();
    assert_eq!(got.0, "text"); assert_eq!(got.1.as_deref(), Some("q")); assert_eq!(got.3, "hq");
}
```
Run: `. "$HOME/.cargo/env"; cargo test storage::items::tests::get_item 2>&1 | tail -10` → RED then implement then GREEN.

- [ ] **Step 2: Implement IPC commands**

Append to `src-tauri/src/ipc.rs`:
```rust
use crate::storage::ItemDto;
use crate::clipboard_writer::WriteRequest;

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn list_items(state: State<AppState>, limit: i64, before: Option<i64>) -> Result<Vec<ItemDto>, String> {
    state.storage.list_items(limit, before).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_pinned(state: State<AppState>) -> Result<Vec<ItemDto>, String> {
    state.storage.list_pinned().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn set_pinned(state: State<AppState>, id: String, pinned: bool) -> Result<(), String> {
    state.storage.set_pinned(&id, pinned).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn delete_item(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.soft_delete(&id, now_ms()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn restore_item(state: State<AppState>, id: String) -> Result<(), String> {
    state.storage.restore(&id).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn copy_item(state: State<AppState>, id: String) -> Result<(), String> {
    let (ty, content, file_path, hash) = state.storage.get_item(&id)
        .map_err(|e| e.to_string())?.ok_or("item not found")?;
    // Suppress the echo BEFORE writing.
    *state.last_self_copy.lock().unwrap() = Some(hash);
    let req = if ty == "text" {
        WriteRequest { mime: "UTF8_STRING".into(), bytes: content.unwrap_or_default().into_bytes() }
    } else {
        let bytes = std::fs::read(file_path.ok_or("missing file")?).map_err(|e| e.to_string())?;
        let mime = if ty == "gif" { "image/gif" } else { "image/png" };
        WriteRequest { mime: mime.into(), bytes }
    };
    state.writer.send(req).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register commands in `lib.rs`**

Extend `invoke_handler` generate_handler! with: `list_items, list_pinned, set_pinned, delete_item, restore_item, copy_item` (keep `get_privacy, set_privacy`; drop `list_recent_items` if unused by the UI).

- [ ] **Step 4: Build + full test**

Run: `. "$HOME/.cargo/env"; cargo build 2>&1 | tail -15 && cargo test 2>&1 | tail -15`
Expected: builds clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat: IPC for timeline (list/pin/delete/restore/copy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend API layer + date helpers

**Files:** Modify `src/api.ts`; create `src/lib/dates.ts`; install `@tanstack/react-virtual`.

- [ ] **Step 1: Install the virtualization lib**

```bash
npm install @tanstack/react-virtual
```

- [ ] **Step 2: Expand `src/api.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Item = {
  id: string;
  item_type: "text" | "image" | "gif";
  content: string | null;
  file_path: string | null;
  preview_path: string | null;
  copy_count: number;
  pinned: boolean;
  created_at: number;
  updated_at: number;
};

export const listItems = (limit = 100, before?: number) =>
  invoke<Item[]>("list_items", { limit, before: before ?? null });
export const listPinned = () => invoke<Item[]>("list_pinned");
export const copyItem = (id: string) => invoke<void>("copy_item", { id });
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
export const restoreItem = (id: string) => invoke<void>("restore_item", { id });
export const setPinned = (id: string, pinned: boolean) => invoke<void>("set_pinned", { id, pinned });
export const getPrivacy = () => invoke<boolean>("get_privacy");
export const setPrivacy = (on: boolean) => invoke<void>("set_privacy", { on });
export const onItemAdded = (cb: () => void) => listen("item-added", cb);
export const onPrivacyChanged = (cb: (on: boolean) => void) =>
  listen<boolean>("privacy-changed", (e) => cb(e.payload));
```

- [ ] **Step 3: Date grouping helper `src/lib/dates.ts`**

```ts
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// Flatten items into a header/item row list for the virtualizer.
export type Row =
  | { kind: "header"; label: string }
  | { kind: "item"; item: import("../api").Item };

export function toRows(items: import("../api").Item[]): Row[] {
  const rows: Row[] = []; let last = "";
  for (const it of items) {
    const label = dayLabel(it.created_at);
    if (label !== last) { rows.push({ kind: "header", label }); last = label; }
    rows.push({ kind: "item", item: it });
  }
  return rows;
}
```

- [ ] **Step 4: Verify frontend builds**

Run: `npm run build 2>&1 | tail -8`
Expected: tsc + vite build succeed.

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat(ui): api wrappers + date-grouping helpers, add react-virtual

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Card, ZoomModal, UndoToast components

**Files:** Create `src/components/Card.tsx`, `src/components/ZoomModal.tsx`, `src/components/UndoToast.tsx`

- [ ] **Step 1: `src/components/Card.tsx`**

```tsx
import { convertFileSrc } from "@tauri-apps/api/core";
import { Item } from "../api";

export function Card(props: {
  item: Item; selected: boolean; index: number;
  onCopy: () => void; onDelete: () => void; onPin: () => void; onZoom: () => void;
}) {
  const { item, selected } = props;
  const thumb = item.preview_path ?? item.file_path;
  return (
    <div
      onClick={props.onCopy}
      className={`group bg-bg-card border rounded p-3 flex gap-3 items-center cursor-pointer
        ${selected ? "border-accent" : "border-border"}`}
    >
      <span className="text-xs uppercase text-accent w-12 shrink-0">{item.item_type}</span>
      {item.item_type === "text" ? (
        <span className="truncate text-sm flex-1">{item.content}</span>
      ) : thumb ? (
        <img
          src={convertFileSrc(thumb)} alt=""
          className="max-h-16 rounded cursor-zoom-in"
          onClick={(e) => { e.stopPropagation(); props.onZoom(); }}
        />
      ) : <span className="text-fg-muted text-sm flex-1">[image]</span>}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="text-xs text-fg-muted">×{item.copy_count}</span>
        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex gap-1">
          <button title="Pin" onClick={(e) => { e.stopPropagation(); props.onPin(); }}
            className={`text-xs px-1 ${item.pinned ? "text-accent" : "text-fg-muted"}`}>📌</button>
          <button title="Delete" onClick={(e) => { e.stopPropagation(); props.onDelete(); }}
            className="text-xs px-1 text-fg-muted hover:text-red-400">🗑</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `src/components/ZoomModal.tsx`**

```tsx
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { Item } from "../api";

export function ZoomModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!item || !item.file_path) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <img src={convertFileSrc(item.file_path)} alt=""
challenge        className="max-h-[90vh] max-w-[90vw] rounded shadow-lg" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
```
(Remove the stray `challenge` token — that is a deliberate typo guard; the correct line is `className="max-h-[90vh] max-w-[90vw] rounded shadow-lg" onClick={(e) => e.stopPropagation()} />`.)

- [ ] **Step 3: `src/components/UndoToast.tsx`**

```tsx
import { useEffect } from "react";

export function UndoToast({ open, onUndo, onExpire }: { open: boolean; onUndo: () => void; onExpire: () => void }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onExpire, 5000);
    return () => clearTimeout(t);
  }, [open, onExpire]);
  if (!open) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-bg-raised border border-border rounded px-4 py-2 flex items-center gap-3 z-50">
      <span className="text-sm">Item deleted</span>
      <button onClick={onUndo} className="text-accent text-sm font-medium">Undo</button>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -8`
Expected: succeeds (components compile; unused-import errors fixed).

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat(ui): Card, ZoomModal, UndoToast components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Timeline (virtualized, pinned section, paging) + keyboard nav

**Files:** Create `src/hooks/useTimeline.ts`, `src/hooks/useKeyboardNav.ts`; rewrite `src/App.tsx`

**Interfaces:**
- `useTimeline()` → `{ pinned, rows, flatItems, reload, loadMore }` where `rows = toRows(items)` and `flatItems` is the copy-index order (pinned first, then dated) used by quick-copy 1–9 and ↑↓.

- [ ] **Step 1: `src/hooks/useTimeline.ts`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Item, listItems, listPinned, onItemAdded } from "../api";
import { Row, toRows } from "../lib/dates";

export function useTimeline() {
  const [pinned, setPinned] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const done = useRef(false);

  const reload = useCallback(async () => {
    setPinned(await listPinned());
    const head = await listItems(100);
    setItems(head); done.current = head.length < 100;
  }, []);

  const loadMore = useCallback(async () => {
    if (done.current || items.length === 0) return;
    const next = await listItems(100, items[items.length - 1].created_at);
    if (next.length < 100) done.current = true;
    setItems((cur) => [...cur, ...next]);
  }, [items]);

  useEffect(() => { reload(); const un = onItemAdded(reload); return () => { un.then((f) => f()); }; }, [reload]);

  const rows: Row[] = toRows(items);
  const flatItems: Item[] = [...pinned, ...items];
  return { pinned, items, rows, flatItems, reload, loadMore };
}
```

- [ ] **Step 2: `src/hooks/useKeyboardNav.ts`**

```tsx
import { useEffect, useState } from "react";
import { Item } from "../api";

export function useKeyboardNav(flatItems: Item[], actions: {
  copy: (it: Item) => void; del: (it: Item) => void; pin: (it: Item) => void; close: () => void;
}) {
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, flatItems.length - 1)); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
      else if (e.key === "Enter") { const it = flatItems[sel]; if (it) actions.copy(it); }
      else if (e.key === "Delete") { const it = flatItems[sel]; if (it) actions.del(it); }
      else if (e.key === "Escape") { actions.close(); }
      else if (e.key.toLowerCase() === "p") { const it = flatItems[sel]; if (it) actions.pin(it); }
      else if (/^[1-9]$/.test(e.key)) { const it = flatItems[Number(e.key) - 1]; if (it) actions.copy(it); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [flatItems, sel, actions]);
  return { sel, setSel };
}
```

- [ ] **Step 3: Rewrite `src/App.tsx`**

```tsx
import { useCallback, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Item, copyItem, deleteItem, restoreItem, setPinned, getPrivacy, setPrivacy, onPrivacyChanged } from "./api";
import { Card } from "./components/Card";
import { ZoomModal } from "./components/ZoomModal";
import { UndoToast } from "./components/UndoToast";
import { useTimeline } from "./hooks/useTimeline";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { useEffect } from "react";

export default function App() {
  const { pinned, rows, flatItems, reload, loadMore } = useTimeline();
  const [privacy, setPriv] = useState(false);
  const [zoom, setZoom] = useState<Item | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getPrivacy().then(setPriv); const un = onPrivacyChanged(setPriv); return () => { un.then((f) => f()); }; }, []);

  const copy = useCallback(async (it: Item) => {
    await copyItem(it.id); setCopied(it.id); setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
  }, []);
  const del = useCallback(async (it: Item) => { await deleteItem(it.id); setPendingDelete(it); reload(); }, [reload]);
  const pin = useCallback(async (it: Item) => { await setPinned(it.id, !it.pinned); reload(); }, [reload]);

  const { sel, setSel } = useKeyboardNav(flatItems, { copy, del, pin, close: () => setZoom(null) });

  const virt = useVirtualizer({
    count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 64, overscan: 8,
  });
  // load more when near the end
  useEffect(() => {
    const el = parentRef.current; if (!el) return;
    const onScroll = () => { if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) loadMore(); };
    el.addEventListener("scroll", onScroll); return () => el.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  const toggle = async () => { const n = !privacy; await setPrivacy(n); setPriv(n); };

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-lg font-semibold">ClipVault</h1>
        <button onClick={toggle}
          className={`px-3 py-1 rounded border border-border text-sm ${privacy ? "bg-accent-dim text-fg" : "text-fg-muted"}`}>
          {privacy ? "Privacy: ON" : "Privacy: OFF"}
        </button>
      </header>

      {pinned.length > 0 && (
        <section className="p-4 border-b border-border space-y-2">
          <div className="text-xs uppercase text-fg-muted">Pinned</div>
          {pinned.map((it, i) => (
            <div key={it.id} className="relative">
              {copied === it.id && <span className="absolute right-2 top-2 text-xs text-accent z-10">Copied ✓</span>}
              <Card item={it} selected={sel === i} index={i}
                onCopy={() => { setSel(i); copy(it); }} onDelete={() => del(it)}
                onPin={() => pin(it)} onZoom={() => setZoom(it)} />
            </div>
          ))}
        </section>
      )}

      <div ref={parentRef} className="flex-1 overflow-auto p-4">
        {rows.length === 0 && pinned.length === 0 && (
          <p className="text-fg-muted">Nothing captured yet — copy something.</p>
        )}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const row = rows[v.index];
            return (
              <div key={v.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
                ref={virt.measureElement} data-index={v.index}>
                {row.kind === "header" ? (
                  <div className="sticky top-0 bg-bg py-1 text-xs uppercase text-fg-muted">{row.label}</div>
                ) : (
                  <div className="relative pb-2">
                    {copied === row.item.id && <span className="absolute right-2 top-2 text-xs text-accent z-10">Copied ✓</span>}
                    <Card item={row.item} selected={flatItems[sel]?.id === row.item.id} index={v.index}
                      onCopy={() => copy(row.item)} onDelete={() => del(row.item)}
                      onPin={() => pin(row.item)} onZoom={() => setZoom(row.item)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ZoomModal item={zoom} onClose={() => setZoom(null)} />
      <UndoToast open={!!pendingDelete}
        onUndo={async () => { if (pendingDelete) { await restoreItem(pendingDelete.id); setPendingDelete(null); reload(); } }}
        onExpire={() => setPendingDelete(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -12`
Expected: tsc + vite succeed (fix any type errors).

- [ ] **Step 5: Commit**

```bash
git -c user.name="ClipVault Dev" -c user.email="olivier.luethy@gmx.net" commit -am "feat(ui): virtualized timeline, pinned section, actions, keyboard nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Gate verification (backend runtime + UI screenshots)

**Files:** none (verification). Record results in the commit message.

- [ ] **Step 1: Full automated suite**

Run: `. "$HOME/.cargo/env"; cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all storage/thumbnail/capture tests pass; warning-clean.

- [ ] **Step 2: Extended sandboxed runtime gate (reuse Phase 0 harness)**

Adapt `scratchpad/gate.sh` (or write `gate-p1.sh`) to run the **production build** (`npm run tauri build -- --no-bundle`) and, with the sandbox, verify:
- [ ] Copy text, then `copy_item` on it → `clip-read` reads back the exact text AND no new/bumped echo entry (self-copy suppression).
- [ ] Copy an image → `attachments/thumbs/<hash>.webp` exists and is a valid, smaller image.
- [ ] `delete_item` hides it from `list_items`; `restore_item` brings it back.
- [ ] `set_pinned` moves it into `list_pinned` and out of `list_items`.

- [ ] **Step 3: UI screenshot verification (the Phase 0-lesson guard)**

Run the production binary standalone (sandbox), capture text + an image, then:
```bash
xwd -name "ClipVault" -out win.xwd && python3 scratchpad/xwd2png.py win.xwd ui.png
```
Read `ui.png` and confirm: dark theme, header, a text card, an image card with a **thumbnail**, correct layout. (Not just the DB — pixels.)

- [ ] **Step 4: Manual pass (user)**

Tray/hotkey, the zoom modal, undo toast, quick-copy — a short interactive check.

- [ ] **Step 5: Commit the gate result**

```bash
git commit --allow-empty -m "chore: Phase 1 timeline gate passed (backend + UI screenshot verified)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (spec section → task):
- Virtualized date-grouped timeline → Task 10 (react-virtual + `toRows`/sticky headers) ✓
- Per-type cards → Task 9 ✓
- Pinned section → Task 2 (queries) + Task 10 (UI) ✓
- Copy-back (stay open, Copied ✓, self-copy suppressed) → Task 6 (writer) + Task 7 (`copy_item` sets marker) + Task 10 (flash) ✓
- Delete + undo (soft-delete) → Task 3 + Task 7 + Task 10 (UndoToast) ✓
- Pin toggle → Task 4 + Task 7 + Task 10 ✓
- Image/GIF zoom modal → Task 9 (ZoomModal) ✓
- Quick-copy 1–9 + keyboard nav → Task 10 (`useKeyboardNav`) ✓
- Thumbnails at capture → Task 5 ✓
- Schema migration → Task 1 ✓
- Screenshot-verified UI → Task 11 ✓

**Placeholder scan:** No TBD/TODO. Task 4 Step 3 shows a deliberately-wrong first snippet immediately followed by "Use this correct body instead" — the implementer uses the corrected version; likewise Task 9 flags the stray `challenge` token to remove. The `webp`-vs-PNG fallback is a concrete branch, not a placeholder.

**Type consistency:** `ItemDto`/`Item` fields (`pinned`, `preview_path`, `updated_at`) defined in Tasks 1–2 and used identically in Tasks 7–10. IPC command names/params match `src/api.ts` (Task 8) exactly. `WriteRequest`/`AppState.writer`/`last_self_copy` defined in Task 6 and consumed in Task 7. `Row`/`toRows` defined in Task 8, used in Task 10.

**Global constraints honored:** Vite 5 / Node 18; single `cargo test` filters; migration idempotent + forward-only; soft-delete excluded from lists; pinned excluded from dated list; thumbnail failure non-fatal; self-copy suppression on copy-back; dark-only; UI screenshot-verified; Conventional Commits with trailer.
