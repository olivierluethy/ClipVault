# ClipVault Phase 0 (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a running Tauri v2 desktop app on Ubuntu 24.04/X11 that captures clipboard text and images into SQLite, survives in the tray with autostart and a global hotkey, and proves the risky system-integration plumbing before any real UI exists.

**Architecture:** A Rust core runs an event-driven X11 clipboard watcher (XFIXES, raw MIME bytes) on its own thread, feeding a capture pipeline (size-guard → classify → SHA-256 dedup → store) backed by `rusqlite` (WAL) with image bytes as files on disk. A single `ClipboardBackend` trait isolates X11 so Wayland can be added later. A bare React+Tailwind (dark-only) debug list renders captures live via Tauri events. Tray, single-instance, autostart, and global-shortcut come from official Tauri v2 plugins.

**Tech Stack:** Tauri v2, Rust, `rusqlite` (bundled SQLite), `x11-clipboard`, `sha2`, `uuid`, React + TypeScript + Vite + Tailwind CSS. Node 18.

## Global Constraints

- **App identifier / name:** `ClipVault`; package/binary `clipvault`; data dir `~/.local/share/clipvault/`.
- **Display server:** X11-first. All X11 specifics live behind the `ClipboardBackend` trait — no X11 calls anywhere else.
- **Watcher:** event-driven (XFIXES via `x11-clipboard`), never a polling loop. ~0% idle CPU.
- **Image fidelity:** store the raw clipboard bytes to disk unchanged; never re-encode. GIFs must remain GIFs.
- **Theme:** dark mode only. No light-mode code paths, no theme toggle. Background `#121212` family; single accent `#7C6CF0`.
- **Persistence:** every setting written to SQLite synchronously on change (no save-on-exit).
- **Dedup:** SHA-256 of raw content; re-copy bumps `copy_count` + timestamps, never inserts a duplicate.
- **Size guards:** skip text > 1 MB, images > 25 MB; log + tray notify; never crash.
- **Discipline:** DRY, YAGNI, TDD for all pure-Rust logic, frequent commits (Conventional Commits). End every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Out of scope (do NOT build):** folders, FTS5 search, virtualized/date-grouped timeline, rich cards, thumbnails, link metadata, color/number/link classification, multi-select, export/import, retention, SQLCipher, `.deb`/AppImage packaging.

---

## File Structure

```
Clipboard-Manager/
├─ package.json, vite.config.ts, tailwind.config.js, index.html
├─ src/                         # React (dark-only debug UI)
│  ├─ main.tsx
│  ├─ App.tsx                   # debug list + privacy toggle
│  ├─ api.ts                    # typed IPC wrappers + event subscription
│  └─ styles.css                # Tailwind + dark tokens
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json           # identifier, window, tray
   ├─ build.rs
   └─ src/
      ├─ main.rs                # thin entry → clipvault_lib::run()
      ├─ lib.rs                 # Tauri builder: plugins, state, tray, commands
      ├─ state.rs               # AppState (Storage handle, privacy AtomicBool)
      ├─ storage/
      │  ├─ mod.rs              # Storage struct, DB init, WAL, migrations
      │  ├─ items.rs           # ItemType, NewItem, InsertOutcome, ItemDto, item methods
      │  └─ settings.rs        # settings get/set (synchronous)
      ├─ hashing.rs             # sha256_hex
      ├─ classifier.rs          # classify(mime, bytes) -> ItemType
      ├─ watcher/
      │  ├─ mod.rs              # ClipEvent, ClipboardBackend trait, MIME priority
      │  └─ x11.rs             # X11Backend (XFIXES + raw targets)
      ├─ capture.rs             # pipeline: guard → classify → hash → dedup → store → emit
      └─ ipc.rs                 # #[tauri::command] list_recent_items, get/set_privacy
```

---

## Task 1: Toolchain, scaffold, and dark theme tokens

**Files:**
- Create: whole project scaffold via `create-tauri-app`
- Modify: `src-tauri/tauri.conf.json`, `tailwind.config.js`, `src/styles.css`, `src/App.tsx`

**Interfaces:**
- Produces: a runnable dev app (`npm run tauri dev`) with a dark window showing the accent color. No custom Rust/JS APIs yet.

- [ ] **Step 1: Install the Rust toolchain**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustc --version   # expect: rustc 1.7x.x
```

- [ ] **Step 2: Install Tauri v2 Linux prerequisites**

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```
Expected: all install without error (`libayatana-appindicator3-dev` provides the tray backend).

- [ ] **Step 3: Scaffold the app** (run in the parent of `Clipboard-Manager`, target the existing dir)

```bash
cd /home/neuadmin/Documents/Clipboard-Manager
npm create tauri-app@latest . -- --template react-ts --manager npm --identifier net.gmx.clipvault --yes
npm install
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```
Expected: `src/` and `src-tauri/` created alongside the existing `docs/`. If the tool refuses a non-empty dir, scaffold into a temp dir and move `src/`, `src-tauri/`, and root config files in, preserving `docs/` and `.git/`.

- [ ] **Step 4: Configure Tailwind for dark-only tokens**

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#121212", raised: "#1a1a1a", card: "#1e1e1e" },
        fg: { DEFAULT: "#e6e6e6", muted: "#9a9a9a" },
        accent: { DEFAULT: "#7C6CF0", dim: "#4b4488" },
        border: "#2a2a2a",
      },
    },
  },
  plugins: [],
};
```

`src/styles.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { @apply bg-bg text-fg; margin: 0; font-family: system-ui, sans-serif; }
```

- [ ] **Step 5: Minimal dark App shell to prove the theme**

`src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-full p-6">
      <h1 className="text-lg font-semibold">
        ClipVault <span className="text-accent">Phase 0</span>
      </h1>
      <p className="text-fg-muted mt-2">Walking skeleton — capture debug view.</p>
    </div>
  );
}
```
Ensure `src/main.tsx` imports `./styles.css`.

- [ ] **Step 6: Set app identity and window in `src-tauri/tauri.conf.json`**

Set `productName` to `ClipVault`, `identifier` to `net.gmx.clipvault`, and the main window to `{ "title": "ClipVault", "width": 900, "height": 640, "visible": true }`.

- [ ] **Step 7: Run the dev app**

```bash
npm run tauri dev
```
Expected: a dark window opens titled "ClipVault" with the violet-accented heading. Close it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + React + Tailwind dark shell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Storage foundation (DB init, WAL, schema)

**Files:**
- Create: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (add `mod storage;`)

**Interfaces:**
- Produces: `storage::Storage` with `Storage::open(db_path: &Path) -> rusqlite::Result<Storage>` (creates parent dirs, sets WAL, runs schema). Holds `conn: Mutex<rusqlite::Connection>`. `attachments_dir(&self) -> PathBuf`.

- [ ] **Step 1: Add dependencies to `src-tauri/Cargo.toml`**

```toml
[dependencies]
rusqlite = { version = "0.31", features = ["bundled"] }
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
x11-clipboard = "0.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
tempfile = "3"
```
(Keep the `tauri`, `tauri-build`, and existing plugin lines added by the scaffold.)

- [ ] **Step 2: Write the failing test**

`src-tauri/src/storage/mod.rs`:
```rust
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;

pub struct Storage {
    pub(crate) conn: Mutex<Connection>,
    root: PathBuf,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_wal_and_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("clipvault.db");
        let s = Storage::open(&db).unwrap();
        let conn = s.conn.lock().unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('items','settings')",
                [], |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test storage:: 2>&1 | tail -20`
Expected: FAIL — `Storage::open` not found.

- [ ] **Step 4: Implement `Storage::open`**

Add to `src-tauri/src/storage/mod.rs` (above the tests module):
```rust
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  content       TEXT,
  file_path     TEXT,
  content_hash  TEXT NOT NULL,
  copy_count    INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_hash ON items(content_hash);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

impl Storage {
    pub fn open(db_path: &Path) -> rusqlite::Result<Storage> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let root = db_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        std::fs::create_dir_all(root.join("attachments")).ok();

        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Storage { conn: Mutex::new(conn), root })
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join("attachments")
    }
}
```
Add `mod storage;` to `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test storage:: 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: SQLite storage foundation with WAL and schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Item repository (hashing, insert, dedup, list)

**Files:**
- Create: `src-tauri/src/hashing.rs`, `src-tauri/src/storage/items.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod hashing;`), `src-tauri/src/storage/mod.rs` (add `mod items; pub use items::*;`)

**Interfaces:**
- Consumes: `storage::Storage` from Task 2.
- Produces:
  - `hashing::sha256_hex(bytes: &[u8]) -> String`
  - `ItemType { Text, Image, Gif }` with `as_str(&self) -> &'static str` and `from_str(&str) -> ItemType`
  - `NewItem { item_type: ItemType, content: Option<String>, file_path: Option<String>, content_hash: String }`
  - `InsertOutcome { Inserted(String), Bumped(String) }` (String = item id)
  - `ItemDto { id, item_type: String, content: Option<String>, file_path: Option<String>, copy_count: i64, created_at: i64 }` (serde Serialize)
  - `Storage::insert_or_bump(&self, item: NewItem, now: i64) -> rusqlite::Result<InsertOutcome>`
  - `Storage::list_recent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>>`

- [ ] **Step 1: Implement the hashing helper (with test)**

`src-tauri/src/hashing.rs`:
```rust
use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(64);
    for b in out { s.push_str(&format!("{:02x}", b)); }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hashes_empty_and_known() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(sha256_hex(b"abc").len(), 64);
    }
}
```
Add `mod hashing;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Write the failing test for item insert/dedup/list**

`src-tauri/src/storage/items.rs`:
```rust
use rusqlite::params;
use uuid::Uuid;
use super::Storage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum ItemType { Text, Image, Gif }

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self { ItemType::Text => "text", ItemType::Image => "image", ItemType::Gif => "gif" }
    }
    pub fn from_str(s: &str) -> ItemType {
        match s { "image" => ItemType::Image, "gif" => ItemType::Gif, _ => ItemType::Text }
    }
}

#[derive(Debug, Clone)]
pub struct NewItem {
    pub item_type: ItemType,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub content_hash: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InsertOutcome { Inserted(String), Bumped(String) }

#[derive(Debug, Clone, serde::Serialize)]
pub struct ItemDto {
    pub id: String,
    pub item_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub copy_count: i64,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    #[test]
    fn insert_then_duplicate_bumps() {
        let (_d, s) = storage();
        let item = NewItem { item_type: ItemType::Text, content: Some("hi".into()),
            file_path: None, content_hash: "h1".into() };
        let a = s.insert_or_bump(item.clone(), 1000).unwrap();
        assert!(matches!(a, InsertOutcome::Inserted(_)));
        let b = s.insert_or_bump(item.clone(), 2000).unwrap();
        assert!(matches!(b, InsertOutcome::Bumped(_)));

        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].copy_count, 2);
        assert_eq!(rows[0].created_at, 2000);
    }

    #[test]
    fn list_recent_orders_newest_first() {
        let (_d, s) = storage();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("a".into()),file_path:None,content_hash:"a".into()},100).unwrap();
        s.insert_or_bump(NewItem{item_type:ItemType::Text,content:Some("b".into()),file_path:None,content_hash:"b".into()},200).unwrap();
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("b"));
        assert_eq!(rows[1].content.as_deref(), Some("a"));
    }
    let _ = Path::new(".");
}
```
Add to `src-tauri/src/storage/mod.rs`: `mod items; pub use items::*;`

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test storage::items 2>&1 | tail -20`
Expected: FAIL — `insert_or_bump`/`list_recent` not found.

- [ ] **Step 4: Implement item methods**

Append to `src-tauri/src/storage/items.rs` (before the tests module):
```rust
impl Storage {
    pub fn insert_or_bump(&self, item: NewItem, now: i64) -> rusqlite::Result<InsertOutcome> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = conn.query_row(
            "SELECT id FROM items WHERE content_hash = ?1",
            params![item.content_hash],
            |r| r.get(0),
        ).ok();

        if let Some(id) = existing {
            conn.execute(
                "UPDATE items SET copy_count = copy_count + 1, created_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            return Ok(InsertOutcome::Bumped(id));
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO items (id, type, content, file_path, content_hash, copy_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
            params![id, item.item_type.as_str(), item.content, item.file_path, item.content_hash, now],
        )?;
        Ok(InsertOutcome::Inserted(id))
    }

    pub fn list_recent(&self, limit: i64) -> rusqlite::Result<Vec<ItemDto>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, type, content, file_path, copy_count, created_at
             FROM items ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| Ok(ItemDto {
            id: r.get(0)?, item_type: r.get(1)?, content: r.get(2)?,
            file_path: r.get(3)?, copy_count: r.get(4)?, created_at: r.get(5)?,
        }))?;
        rows.collect()
    }
}
```
Remove the stray `let _ = Path::new(".");` line and the unused `Path` import from the test module.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test storage:: hashing:: 2>&1 | tail -20`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: item repository with SHA-256 dedup and recent listing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Settings repository (synchronous persistence)

**Files:**
- Create: `src-tauri/src/storage/settings.rs`
- Modify: `src-tauri/src/storage/mod.rs` (add `mod settings;`)

**Interfaces:**
- Consumes: `storage::Storage`.
- Produces:
  - `Storage::set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()>` (writes immediately)
  - `Storage::get_setting(&self, key: &str) -> rusqlite::Result<Option<String>>`
  - `Storage::get_bool(&self, key: &str, default: bool) -> bool`
  - `Storage::set_bool(&self, key: &str, value: bool) -> rusqlite::Result<()>`

- [ ] **Step 1: Write the failing test**

`src-tauri/src/storage/settings.rs`:
```rust
use rusqlite::params;
use super::Storage;

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    #[test]
    fn set_get_roundtrip_and_default() {
        let (_d, s) = storage();
        assert_eq!(s.get_bool("privacy_mode", false), false);
        s.set_bool("privacy_mode", true).unwrap();
        assert_eq!(s.get_bool("privacy_mode", false), true);
        // Simulate a crash: reopen the same file, value must persist.
        drop(s);
        let s2 = Storage::open(&_d.path().join("clipvault.db")).unwrap();
        assert_eq!(s2.get_bool("privacy_mode", false), true);
    }
}
```
Add `mod settings;` to `src-tauri/src/storage/mod.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test storage::settings 2>&1 | tail -20`
Expected: FAIL — `get_bool` not found.

- [ ] **Step 3: Implement settings methods**

Append to `src-tauri/src/storage/settings.rs` (before tests):
```rust
impl Storage {
    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        match self.get_setting(key) {
            Ok(Some(v)) => v == "1" || v.eq_ignore_ascii_case("true"),
            _ => default,
        }
    }

    pub fn set_bool(&self, key: &str, value: bool) -> rusqlite::Result<()> {
        self.set_setting(key, if value { "1" } else { "0" })
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test storage::settings 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: synchronous settings store (crash-safe persistence)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Classifier (MIME + magic bytes → ItemType)

**Files:**
- Create: `src-tauri/src/classifier.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod classifier;`)

**Interfaces:**
- Consumes: `ItemType` from Task 3.
- Produces: `classifier::classify(mime: &str, bytes: &[u8]) -> ItemType`, and `classifier::extension_for(item_type: ItemType, mime: &str) -> &'static str` (attachment extension).

- [ ] **Step 1: Write the failing test**

`src-tauri/src/classifier.rs`:
```rust
use crate::storage::ItemType;

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
```
Add `mod classifier;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test classifier:: 2>&1 | tail -20`
Expected: FAIL — `classify` not found.

- [ ] **Step 3: Implement the classifier**

Append to `src-tauri/src/classifier.rs` (before tests):
```rust
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test classifier:: 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: minimal MIME/magic-byte classifier (text/image/gif)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ClipboardBackend trait + X11 backend

**Files:**
- Create: `src-tauri/src/watcher/mod.rs`, `src-tauri/src/watcher/x11.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod watcher;`)

**Interfaces:**
- Produces:
  - `watcher::ClipEvent { mime: String, bytes: Vec<u8> }`
  - `watcher::ClipboardBackend` trait: `fn run(self: Box<Self>, tx: std::sync::mpsc::Sender<ClipEvent>, privacy: std::sync::Arc<std::sync::atomic::AtomicBool>)` (blocking; call from a spawned thread)
  - `watcher::MIME_PRIORITY: [&str; N]` — target preference order
  - `watcher::x11::X11Backend` with `X11Backend::new() -> anyhow::Result<X11Backend>` (return a clear error string if not on X11)
- Consumes: nothing from earlier tasks (pure I/O boundary).

> **Note:** This is the highest-risk task and the one whose "test" is primarily the manual gate (Task 12). The MIME-priority selection is unit-tested here; the live X11 read is verified end-to-end once the pipeline (Task 7) and UI (Task 11) exist. Use `x11-clipboard` 0.9 (re-exports `x11rb`). The change signal comes from `load_wait`, which blocks on the XFIXES SelectionNotify — no polling.

- [ ] **Step 1: Add `anyhow` to `src-tauri/Cargo.toml`**

```toml
anyhow = "1"
```

- [ ] **Step 2: Define the trait + priority, with a unit test for selection**

`src-tauri/src/watcher/mod.rs`:
```rust
use std::sync::mpsc::Sender;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub mod x11;

#[derive(Debug, Clone)]
pub struct ClipEvent {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// Preferred clipboard MIME targets, best first.
pub const MIME_PRIORITY: [&str; 5] = [
    "image/gif",
    "image/png",
    "image/jpeg",
    "text/uri-list",
    "UTF8_STRING",
];

/// Given the target names a clipboard owner advertises, choose the best one.
pub fn pick_best<'a>(available: &'a [String]) -> Option<&'a str> {
    for pref in MIME_PRIORITY.iter() {
        if let Some(found) = available.iter().find(|a| a.as_str() == *pref) {
            return Some(found.as_str());
        }
    }
    // Fallback: any text/* target.
    available.iter().find(|a| a.starts_with("text/")).map(|s| s.as_str())
}

pub trait ClipboardBackend: Send {
    /// Blocks forever, emitting a ClipEvent on each clipboard change.
    /// Skips emission while `privacy` is true.
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prefers_gif_over_png_over_text() {
        let avail = vec!["text/plain".into(), "image/png".into(), "image/gif".into()];
        assert_eq!(pick_best(&avail), Some("image/gif"));
        let avail2 = vec!["text/plain".into(), "image/png".into()];
        assert_eq!(pick_best(&avail2), Some("image/png"));
        let avail3 = vec!["text/plain".into(), "text/html".into()];
        assert_eq!(pick_best(&avail3), Some("text/plain"));
    }
}
```
Add `mod watcher;` to `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run the selection test**

Run: `cargo test watcher:: 2>&1 | tail -20`
Expected: PASS (`pick_best` logic).

- [ ] **Step 4: Implement `X11Backend`**

`src-tauri/src/watcher/x11.rs`:
```rust
use std::sync::mpsc::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use anyhow::{anyhow, Result};
use x11_clipboard::Clipboard;
use super::{ClipEvent, ClipboardBackend, pick_best};

pub struct X11Backend {
    clipboard: Clipboard,
}

impl X11Backend {
    pub fn new() -> Result<X11Backend> {
        if std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false)
            && std::env::var("DISPLAY").map(|v| v.is_empty()).unwrap_or(true)
        {
            return Err(anyhow!("Wayland session detected and no X11 DISPLAY; \
                the X11 backend needs Xorg or XWayland. Log in with 'Ubuntu on Xorg'."));
        }
        let clipboard = Clipboard::new().map_err(|e| anyhow!("failed to open X11 clipboard: {e}"))?;
        Ok(X11Backend { clipboard })
    }

    /// Intern an atom by name using the getter connection.
    fn atom(&self, name: &str) -> Result<x11rb::protocol::xproto::Atom> {
        use x11rb::protocol::xproto::ConnectionExt;
        let conn = &self.clipboard.getter.connection;
        let cookie = conn.intern_atom(false, name.as_bytes())?;
        Ok(cookie.reply()?.atom)
    }

    /// Resolve an atom id back to its string name (for TARGETS enumeration).
    fn atom_name(&self, atom: x11rb::protocol::xproto::Atom) -> Result<String> {
        use x11rb::protocol::xproto::ConnectionExt;
        let conn = &self.clipboard.getter.connection;
        let reply = conn.get_atom_name(atom)?.reply()?;
        Ok(String::from_utf8_lossy(&reply.name).into_owned())
    }
}

impl ClipboardBackend for X11Backend {
    fn run(self: Box<Self>, tx: Sender<ClipEvent>, privacy: Arc<AtomicBool>) {
        let atoms = self.clipboard.getter.atoms;
        loop {
            // Block until the CLIPBOARD selection changes; read its TARGETS list.
            let targets_raw = match self.clipboard.load_wait(
                atoms.clipboard, atoms.targets, atoms.property,
            ) {
                Ok(b) => b,
                Err(_) => continue, // transient conversion failure; wait for next change
            };

            if privacy.load(Ordering::Relaxed) {
                continue; // paused: consume the change, store nothing
            }

            // TARGETS is a list of 32-bit atom ids.
            let target_atoms: Vec<u32> = targets_raw
                .chunks_exact(4)
                .map(|c| u32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            let names: Vec<String> = target_atoms
                .iter()
                .filter_map(|a| self.atom_name(*a).ok())
                .collect();

            let Some(best) = pick_best(&names) else { continue };
            let Ok(best_atom) = self.atom(best) else { continue };

            match self.clipboard.load_wait(atoms.clipboard, best_atom, atoms.property) {
                Ok(bytes) if !bytes.is_empty() => {
                    let _ = tx.send(ClipEvent { mime: best.to_string(), bytes });
                }
                _ => {}
            }
        }
    }
}
```

> If the exact `x11-clipboard` 0.9 API differs (field names like `getter.connection`/`getter.atoms`, or `x11rb` re-export path), adjust against `cargo build` errors — the structure (intern atoms → read TARGETS → pick best → read bytes) is the contract. Do not fall back to polling.

- [ ] **Step 5: Verify it compiles**

Run: `cargo build 2>&1 | tail -30`
Expected: builds. Fix any API-name mismatches surfaced by the compiler.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: X11 clipboard backend (event-driven, raw MIME targets)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Capture pipeline (guard, privacy, store, emit)

**Files:**
- Create: `src-tauri/src/capture.rs`, `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod capture; mod state;`)

**Interfaces:**
- Consumes: `Storage`, `classifier::{classify, extension_for}`, `hashing::sha256_hex`, `watcher::ClipEvent`.
- Produces:
  - `state::AppState { storage: Arc<Storage>, privacy: Arc<AtomicBool> }`
  - `capture::MAX_TEXT: usize = 1_048_576`, `capture::MAX_IMAGE: usize = 26_214_400`
  - `capture::process_event(storage: &Storage, ev: ClipEvent) -> anyhow::Result<Option<InsertOutcome>>` (returns `None` when skipped by a size guard)

- [ ] **Step 1: Write the failing test**

`src-tauri/src/capture.rs`:
```rust
use std::sync::Arc;
use anyhow::Result;
use crate::classifier::{classify, extension_for};
use crate::hashing::sha256_hex;
use crate::storage::{ItemType, NewItem, InsertOutcome, Storage};
use crate::watcher::ClipEvent;

pub const MAX_TEXT: usize = 1_048_576;      // 1 MB
pub const MAX_IMAGE: usize = 26_214_400;    // 25 MB

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(&dir.path().join("clipvault.db")).unwrap();
        (dir, s)
    }

    #[test]
    fn stores_text_event() {
        let (_d, s) = storage();
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: b"hello".to_vec() }).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].content.as_deref(), Some("hello"));
        assert_eq!(rows[0].item_type, "text");
    }

    #[test]
    fn stores_image_as_file() {
        let (_d, s) = storage();
        let png = b"\x89PNG\r\n\x1a\nDATA".to_vec();
        let out = process_event(&s, ClipEvent{ mime: "image/png".into(), bytes: png.clone() }).unwrap();
        assert!(matches!(out, Some(InsertOutcome::Inserted(_))));
        let rows = s.list_recent(10).unwrap();
        assert_eq!(rows[0].item_type, "image");
        let path = rows[0].file_path.clone().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), png);
    }

    #[test]
    fn oversized_text_skipped() {
        let (_d, s) = storage();
        let big = vec![b'a'; MAX_TEXT + 1];
        let out = process_event(&s, ClipEvent{ mime: "UTF8_STRING".into(), bytes: big }).unwrap();
        assert!(out.is_none());
        assert_eq!(s.list_recent(10).unwrap().len(), 0);
    }

    #[test]
    fn duplicate_bumps_not_inserts() {
        let (_d, s) = storage();
        let ev = || ClipEvent{ mime:"UTF8_STRING".into(), bytes:b"x".to_vec() };
        process_event(&s, ev()).unwrap();
        let second = process_event(&s, ev()).unwrap();
        assert!(matches!(second, Some(InsertOutcome::Bumped(_))));
        assert_eq!(s.list_recent(10).unwrap().len(), 1);
    }
}
```
Add `mod capture;` and `mod state;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test capture:: 2>&1 | tail -20`
Expected: FAIL — `process_event` not found.

- [ ] **Step 3: Implement the pipeline**

Append to `src-tauri/src/capture.rs` (before tests):
```rust
pub fn process_event(storage: &Storage, ev: ClipEvent) -> Result<Option<InsertOutcome>> {
    let item_type = classify(&ev.mime, &ev.bytes);

    // Size guards.
    let limit = if item_type == ItemType::Text { MAX_TEXT } else { MAX_IMAGE };
    if ev.bytes.len() > limit {
        eprintln!("clipvault: skipping oversized {:?} ({} bytes)", item_type, ev.bytes.len());
        return Ok(None);
    }

    let hash = sha256_hex(&ev.bytes);
    let now = chrono_now_millis();

    let new_item = match item_type {
        ItemType::Text => {
            let text = String::from_utf8_lossy(&ev.bytes).into_owned();
            NewItem { item_type, content: Some(text), file_path: None, content_hash: hash }
        }
        ItemType::Image | ItemType::Gif => {
            // Only write the file if this is a new hash; check first to avoid orphan files.
            let id_ext = extension_for(item_type, &ev.mime);
            let file_name = format!("{}.{}", &hash, id_ext);
            let path = storage.attachments_dir().join(&file_name);
            if !path.exists() {
                std::fs::write(&path, &ev.bytes)?;
            }
            NewItem { item_type, content: None,
                file_path: Some(path.to_string_lossy().into_owned()), content_hash: hash }
        }
    };

    Ok(Some(storage.insert_or_bump(new_item, now)?))
}

fn chrono_now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
```

`src-tauri/src/state.rs`:
```rust
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use crate::storage::Storage;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub privacy: Arc<AtomicBool>,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test capture:: 2>&1 | tail -20`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: capture pipeline with size guards and file-backed images

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: IPC commands + app wiring (watcher thread, live events)

**Files:**
- Create: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs` (build the app: state, spawn watcher, register commands, emit events)

**Interfaces:**
- Consumes: `AppState`, `Storage`, `X11Backend`, `capture::process_event`.
- Produces:
  - `#[tauri::command] list_recent_items(state, limit: i64) -> Result<Vec<ItemDto>, String>`
  - `#[tauri::command] get_privacy(state) -> bool`
  - `#[tauri::command] set_privacy(state, on: bool) -> Result<(), String>`
  - Emits Tauri event `"item-added"` (no payload) after each successful capture.

- [ ] **Step 1: Implement IPC commands**

`src-tauri/src/ipc.rs`:
```rust
use tauri::State;
use std::sync::atomic::Ordering;
use crate::state::AppState;
use crate::storage::ItemDto;

#[tauri::command]
pub fn list_recent_items(state: State<AppState>, limit: i64) -> Result<Vec<ItemDto>, String> {
    state.storage.list_recent(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_privacy(state: State<AppState>) -> bool {
    state.privacy.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_privacy(state: State<AppState>, on: bool) -> Result<(), String> {
    state.privacy.store(on, Ordering::Relaxed);
    state.storage.set_bool("privacy_mode", on).map_err(|e| e.to_string())
}
```
Add `mod ipc;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Wire the Tauri builder in `src-tauri/src/lib.rs`**

Replace the generated `run()` with:
```rust
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tauri::{Manager, Emitter};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            // Data dir: ~/.local/share/clipvault/
            let data_dir = app.path().app_data_dir()?;
            let storage = Arc::new(crate::storage::Storage::open(&data_dir.join("clipvault.db"))?);

            let privacy_init = storage.get_bool("privacy_mode", false);
            let privacy = Arc::new(AtomicBool::new(privacy_init));

            app.manage(crate::state::AppState { storage: storage.clone(), privacy: privacy.clone() });

            // Spawn the clipboard watcher thread.
            let handle = app.handle().clone();
            let (tx, rx) = std::sync::mpsc::channel::<crate::watcher::ClipEvent>();
            let privacy_w = privacy.clone();
            std::thread::spawn(move || {
                match crate::watcher::x11::X11Backend::new() {
                    Ok(backend) => {
                        use crate::watcher::ClipboardBackend;
                        Box::new(backend).run(tx, privacy_w);
                    }
                    Err(e) => eprintln!("clipvault: clipboard backend unavailable: {e}"),
                }
            });

            // Consume events on another thread: store + notify UI.
            let storage_c = storage.clone();
            std::thread::spawn(move || {
                for ev in rx {
                    match crate::capture::process_event(&storage_c, ev) {
                        Ok(Some(_)) => { let _ = handle.emit("item-added", ()); }
                        Ok(None) => {}
                        Err(e) => eprintln!("clipvault: capture error: {e}"),
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::ipc::list_recent_items,
            crate::ipc::get_privacy,
            crate::ipc::set_privacy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipVault");
}
```
Ensure all `mod` declarations exist at the top of `lib.rs`:
`mod storage; mod hashing; mod classifier; mod watcher; mod capture; mod state; mod ipc;`

- [ ] **Step 3: Add the single-instance plugin dependency**

In `src-tauri/Cargo.toml`:
```toml
tauri-plugin-single-instance = "2"
```

- [ ] **Step 4: Build and smoke-run**

Run: `cargo build 2>&1 | tail -30` then `npm run tauri dev`
Expected: app launches; copying text in another app prints no errors and (once UI exists) will list. For now confirm no panic on copy.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire watcher thread, capture consumer, and IPC commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Tray icon, menu, and hide-to-tray

**Files:**
- Modify: `src-tauri/src/lib.rs` (tray + window close handler), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `AppState` (for privacy toggle from tray).
- Produces: a tray icon with **Open / Privacy Mode / Quit**; window close hides instead of exits.

- [ ] **Step 1: Enable the tray feature**

In `src-tauri/Cargo.toml`, ensure the `tauri` dependency has the tray feature:
```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 2: Add tray + close-to-hide in the `setup` closure of `lib.rs`**

Inside `setup(|app| { ... })`, before `Ok(())`, add:
```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

let open_i = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
let priv_i = MenuItem::with_id(app, "privacy", "Toggle Privacy Mode", true, None::<&str>)?;
let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_i, &priv_i, &quit_i])?;

let _tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .tooltip("ClipVault")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "open" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
        "quit" => { app.exit(0); }
        "privacy" => {
            let state = app.state::<crate::state::AppState>();
            let now = !state.privacy.load(std::sync::atomic::Ordering::Relaxed);
            state.privacy.store(now, std::sync::atomic::Ordering::Relaxed);
            let _ = state.storage.set_bool("privacy_mode", now);
            let _ = app.emit("privacy-changed", now);
        }
        _ => {}
    })
    .build(app)?;
```

- [ ] **Step 3: Intercept window close → hide to tray**

Add after the builder's `.plugin(...)` chain (before `.setup`):
```rust
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
```

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`
Expected: tray icon appears near the clock; menu shows Open / Toggle Privacy Mode / Quit; closing the window hides it (process stays — check `ps aux | grep clipvault`); tray **Open** re-shows it; **Quit** exits.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tray icon with menu and hide-to-tray on window close

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Autostart on login

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: autostart enabled on first run; entry in `~/.config/autostart/`.

- [ ] **Step 1: Add the plugin dependency**

`src-tauri/Cargo.toml`:
```toml
tauri-plugin-autostart = "2"
```

- [ ] **Step 2: Register the plugin and enable on first run**

In `lib.rs`, add to the builder chain:
```rust
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
```
Inside `setup`, after storage is created:
```rust
use tauri_plugin_autostart::ManagerExt;
if storage.get_setting("autostart_initialized")?.is_none() {
    let _ = app.autolaunch().enable();
    storage.set_setting("autostart_initialized", "1")?;
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev` once, then:
```bash
ls ~/.config/autostart/ | grep -i clipvault
```
Expected: a `.desktop` autostart entry exists.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: enable autostart on first run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Global hotkey summon

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: a global shortcut (default `Ctrl+Alt+V`) that shows + focuses the window.

> Rationale: Ubuntu/GNOME reserves `Super+V`; on X11 the Tauri global-shortcut plugin works directly, so we use `Ctrl+Alt+V` to avoid clashing with the desktop. (Making it user-configurable is a later phase.)

- [ ] **Step 1: Add the plugin dependency**

`src-tauri/Cargo.toml`:
```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2: Register the shortcut in `lib.rs`**

Add to the builder chain:
```rust
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Alt+V")
                .expect("valid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(),
        )
```

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`, close the window to the tray, then press `Ctrl+Alt+V`.
Expected: the window reappears focused in well under a second.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: global hotkey (Ctrl+Alt+V) to summon the window

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: React debug UI (dark list + privacy toggle, live)

**Files:**
- Create: `src/api.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: IPC commands `list_recent_items`, `get_privacy`, `set_privacy`; events `item-added`, `privacy-changed`.

- [ ] **Step 1: Typed IPC + event wrappers**

`src/api.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Item = {
  id: string;
  item_type: "text" | "image" | "gif";
  content: string | null;
  file_path: string | null;
  copy_count: number;
  created_at: number;
};

export const listRecent = (limit = 200) => invoke<Item[]>("list_recent_items", { limit });
export const getPrivacy = () => invoke<boolean>("get_privacy");
export const setPrivacy = (on: boolean) => invoke<void>("set_privacy", { on });
export const onItemAdded = (cb: () => void) => listen("item-added", cb);
export const onPrivacyChanged = (cb: (on: boolean) => void) =>
  listen<boolean>("privacy-changed", (e) => cb(e.payload));
```

- [ ] **Step 2: Build the debug view**

`src/App.tsx`:
```tsx
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Item, listRecent, getPrivacy, setPrivacy, onItemAdded, onPrivacyChanged } from "./api";

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [privacy, setPriv] = useState(false);

  const refresh = () => listRecent().then(setItems);

  useEffect(() => {
    refresh();
    getPrivacy().then(setPriv);
    const un1 = onItemAdded(refresh);
    const un2 = onPrivacyChanged(setPriv);
    return () => { un1.then((f) => f()); un2.then((f) => f()); };
  }, []);

  const toggle = async () => { const next = !privacy; await setPrivacy(next); setPriv(next); };

  return (
    <div className="min-h-full p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">ClipVault <span className="text-accent">Phase 0</span></h1>
        <button
          onClick={toggle}
          className={`px-3 py-1 rounded border border-border text-sm ${privacy ? "bg-accent-dim text-fg" : "text-fg-muted"}`}
        >
          {privacy ? "Privacy: ON" : "Privacy: OFF"}
        </button>
      </header>

      <ul className="space-y-2">
        {items.length === 0 && <li className="text-fg-muted">Nothing captured yet — copy something.</li>}
        {items.map((it) => (
          <li key={it.id} className="bg-bg-card border border-border rounded p-3 flex gap-3 items-center">
            <span className="text-xs uppercase text-accent w-12 shrink-0">{it.item_type}</span>
            {it.item_type === "text" ? (
              <span className="truncate text-sm">{it.content}</span>
            ) : it.file_path ? (
              <img src={convertFileSrc(it.file_path)} alt="" className="max-h-16 rounded" />
            ) : null}
            <span className="ml-auto text-xs text-fg-muted shrink-0">×{it.copy_count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Allow the asset protocol for attachment images**

In `src-tauri/tauri.conf.json`, under `app`, ensure:
```json
"security": { "assetProtocol": { "enable": true, "scope": ["$APPDATA/**"] } }
```

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`. Copy text → row appears live with `×1`. Copy the same text again → still one row, `×2`. Copy an image → thumbnail renders. Toggle privacy → copying stops adding rows.
Expected: all of the above.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dark debug list with live capture and privacy toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Phase 0 gate verification

**Files:** none (verification only). Record results in the commit message.

- [ ] **Step 1: Run the full automated test suite**

Run: `cd src-tauri && cargo test 2>&1 | tail -30`
Expected: all storage, settings, hashing, classifier, watcher, and capture tests PASS.

- [ ] **Step 2: Execute the manual gate checklist**

Build a release-ish dev session (`npm run tauri dev`) and verify each, checking the box only on success:
- [ ] Copy text elsewhere → appears in list < 200 ms.
- [ ] Copy an image → file in `~/.local/share/clipvault/attachments/`, thumbnail renders.
- [ ] Copy a GIF → run `file ~/.local/share/clipvault/attachments/*.gif` → confirms `GIF image data` (fidelity preserved).
- [ ] Copy the same content twice → no new row; `copy_count` increments (`×2`).
- [ ] Tray menu Open / Toggle Privacy / Quit all work.
- [ ] Privacy ON, then `kill -9 $(pgrep -f clipvault)`, relaunch → Privacy still ON.
- [ ] `ls ~/.config/autostart/ | grep -i clipvault` → entry present.
- [ ] `Ctrl+Alt+V` summons the window.
- [ ] Closing the window hides to tray; `pgrep -f clipvault` still shows the process.
- [ ] Launching a second instance focuses the existing window (no duplicate).
- [ ] Idle CPU ~0%: leave it 60 s with no copying, watch `top -p $(pgrep -f clipvault | head -1)` → ~0% CPU.

- [ ] **Step 3: Commit the gate result**

```bash
git commit --allow-empty -m "chore: Phase 0 walking skeleton gate passed

All automated tests green; manual gate checklist verified on
Ubuntu 24.04.4 / X11 (capture, GIF fidelity, dedup, tray, autostart,
hotkey, single-instance, crash-safe privacy, ~0% idle CPU).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (each Phase 0 DoD item → task):
1. Scaffold Tauri+React+Tailwind dark tokens/accent → Task 1 ✓
2. Single instance → Task 8 ✓
3. Tray + menu → Task 9 ✓
4. Autostart → Task 10 ✓
5. Hide-to-tray → Task 9 ✓
6. Capture text + images → Tasks 6–8, 12 ✓
7. GIF fidelity (raw bytes) → Task 6 (raw target read) + Task 7 (write unmodified) + Task 13 gate ✓
8. Dedup by SHA-256 → Task 3 + Task 7 ✓
9. Live debug list → Task 12 ✓
10. Global hotkey → Task 11 ✓
11. Privacy pause + crash-safe → Task 4 (persistence) + Task 6 (gate) + Task 8/9 (toggle) + Task 13 (kill-9) ✓
12. ~0% idle CPU → Task 6 (event-driven, no polling) + Task 13 (measured) ✓

**Placeholder scan:** No TBD/TODO. The one honest caveat (x11-clipboard API drift in Task 6) includes the concrete structure and contract, not a placeholder. Manual-gate steps replace unit tests only for the system-integration surfaces (tray/autostart/hotkey/single-instance) that cannot be unit-tested — each has explicit commands + expected output.

**Type consistency:** `ItemType`/`NewItem`/`InsertOutcome`/`ItemDto` defined in Task 3 and used identically in Tasks 5, 7, 8, 12. `ClipEvent`/`ClipboardBackend`/`pick_best` defined in Task 6 and consumed in Tasks 7–8. `AppState` defined in Task 7, used in Tasks 8–9. `process_event` signature stable across Tasks 7–8. IPC command names match `src/api.ts` in Task 12.

**Global constraints honored:** X11 confined to `watcher/x11.rs`; event-driven (no polling); raw bytes written unmodified; dark-only tokens; synchronous settings writes; SHA-256 dedup; size guards; Conventional Commits with the required trailer.
