# ClipVault

A native-feeling, **dark-mode** clipboard manager for **Ubuntu / X11**, built with
**Tauri v2 (Rust)** and **React + TypeScript**. It runs quietly in the system tray,
captures everything you copy (text, links, numbers, colors, images, GIFs), organizes
it into type folders, and lets you paste anything back with a click — all stored
locally in SQLite, no cloud, no telemetry.

> Status: **Phase 0 (foundation) merged to `master`; Phase 1 (the daily-drivable
> timeline) in progress on the `phase-1` branch.** See [Roadmap](#roadmap).

---

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [How it works (architecture)](#how-it-works-architecture)
- [Data model & storage](#data-model--storage)
- [Clipboard capture design](#clipboard-capture-design)
- [Content classification](#content-classification)
- [IPC API reference](#ipc-api-reference)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Privacy](#privacy)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Developer notes & gotchas](#developer-notes--gotchas)
- [Roadmap](#roadmap)
- [Design decisions (the "why")](#design-decisions-the-why)

---

## What it does

- **Captures automatically.** Every copy is saved to a local history — text, URLs,
  numbers/codes, hex/rgb colors, images, and animated GIFs (originals preserved
  byte-for-byte).
- **Classifies content.** Items are typed as `text | link | number | color | image | gif`
  and grouped into sidebar folders (All / Text / Links / Numbers / Images & GIFs / Colors)
  with live counts.
- **Paste back with one click.** A clearly-labelled **Copy** button on every card puts the
  item back on the clipboard; copying your own history back never creates a duplicate
  (self-copy suppression).
- **Manage items.** Delete (with a 5-second undo), edit text-based items in place, pin
  favorites to a section at the top, and zoom images/GIFs in a modal.
- **Fast, date-grouped timeline.** A virtualized list (Today / Yesterday / dates, sticky
  headers) that stays smooth over large histories; images render as small WebP thumbnails.
- **Keyboard-first.** Navigate and act without the mouse (`↑↓`, `Enter`, `Del`, `Esc`,
  `P`, `E`, `1–9`).
- **Lives in the background.** System-tray icon, autostart on login, global hotkey
  (`Ctrl+Alt+V`) to summon the window, single-instance, hide-to-tray on close.
- **Privacy mode.** Pause capture entirely; the setting survives restarts and crashes.
- **Efficient.** Event-driven clipboard watching (no polling) → ~0% idle CPU; ~10–20 MB
  idle RAM (Rust core, not Electron).

---

## Quick start

```bash
# 1. Install the toolchain (see Requirements for details)
#    - Rust (rustup), Node 18, and the Tauri Linux system libraries

# 2. Install JS dependencies
npm install

# 3. Run in development (hot-reloading UI)
npm run tauri dev
```

`npm run tauri dev` starts the Vite dev server **and** the app together and opens the
window.

> ⚠️ Do **not** launch the debug binary (`src-tauri/target/debug/clipvault`) directly —
> a debug build loads the UI from the Vite dev server, so without it you'll see
> "Could not connect to localhost". Use `npm run tauri dev`, or build a standalone app:

```bash
# Standalone / installable build (frontend embedded, no dev server needed)
npm run tauri build                    # → .deb + AppImage in src-tauri/target/release/bundle/
npm run tauri build -- --no-bundle     # → just the binary at src-tauri/target/release/clipvault
```

The release binary is what an installed app or autostart entry runs.

---

## Requirements

| Dependency | Version / notes |
|---|---|
| **Rust** | stable (via [rustup](https://rustup.rs)); tested on 1.97 |
| **Node.js** | **18.x** — the project pins **Vite 5** to run on Node 18. Vite 7+ needs Node 20.19+/22.12+; if you upgrade Node to 20+, you may bump Vite back to latest. |
| **OS** | Ubuntu **22.04+**, developed & tested on **24.04 / X11**. Wayland is not yet supported (X11-first — see [capture design](#clipboard-capture-design)). |

**Tauri Linux system libraries** (Debian/Ubuntu):

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

`build-essential` is also needed to compile the bundled SQLite (`rusqlite`) and libwebp
(`webp` crate) from source.

---

## How it works (architecture)

ClipVault is a single Tauri process: a **Rust core** (always running) plus a **WebView
UI** (React). The Rust side owns the clipboard, storage, and OS integration; the UI is a
thin, dark, keyboard-first view that talks to Rust over Tauri IPC.

```
┌───────────────────────────────────────────────────────────────────┐
│ Tauri app "ClipVault" (single instance)                            │
│                                                                     │
│  Rust core                                                          │
│   ├─ watcher/x11.rs      Event-driven X11 clipboard watcher (XFIXES)│
│   │        │ ClipEvent {mime, bytes}  (own thread, auto-restarts)   │
│   │        ▼                                                        │
│   ├─ capture.rs          size-guard → classify → SHA-256 dedup      │
│   │                      → thumbnail → store   (consumer thread)    │
│   ├─ classifier.rs       MIME/magic → type; text → link/number/color│
│   ├─ thumbnail.rs        decode+resize → WebP thumbnail             │
│   ├─ storage/            SQLite (WAL) + attachments/; migrations    │
│   ├─ clipboard_writer.rs copy-back: own thread owns an X clipboard  │
│   ├─ state.rs            AppState (storage, privacy flag, writer,   │
│   │                      last_self_copy marker)                     │
│   ├─ ipc.rs              #[tauri::command]s exposed to the UI       │
│   └─ lib.rs              wires plugins (tray, autostart, hotkey,    │
│                          single-instance), spawns threads, events   │
│                                                                     │
│  WebView UI (React 19 + Tailwind, dark only, @tanstack/react-virtual)│
│   ├─ App.tsx             layout, folder state, actions, keyboard nav│
│   ├─ components/         Sidebar, Card, ZoomModal, UndoToast        │
│   ├─ hooks/              useTimeline (paging), useKeyboardNav       │
│   └─ api.ts              typed IPC wrappers + event listeners       │
└───────────────────────────────────────────────────────────────────┘
```

**Threads & data flow**

1. A **watcher thread** blocks on X11 clipboard changes (XFIXES). On each change it emits
   a `ClipEvent{mime, bytes}` over an `mpsc` channel. A supervisor restarts it if the X
   connection dies.
2. A **capture-consumer thread** receives events and runs `capture::process_event`:
   size guard → self-copy suppression check → classify → SHA-256 hash → dedup
   (`insert_or_bump`) → write image file + WebP thumbnail → insert row → emit the Tauri
   event `item-added`.
3. The **UI** listens for `item-added` and refreshes; user actions call IPC commands
   (`copy_item`, `delete_item`, …).
4. **Copy-back** (`copy_item`) sets a one-content self-copy marker, then sends the bytes to
   the **writer thread**, which owns a separate X clipboard and takes ownership; the
   watcher sees the echo, matches the marker, and skips it (so it isn't re-captured).

---

## Data model & storage

Everything lives under **`~/.local/share/clipvault/`** (derived from `data_dir()`, not the
bundle-identifier path):

```
~/.local/share/clipvault/
├─ clipvault.db              SQLite (WAL mode)
└─ attachments/
   ├─ <sha256>.png|gif|…     original image/GIF bytes (never re-encoded)
   └─ thumbs/<sha256>.webp   small thumbnails for the timeline
```

**Schema** (`items` + `settings`; `PRAGMA user_version = 3`):

```sql
items(
  id           TEXT PRIMARY KEY,   -- UUID v4
  type         TEXT NOT NULL,      -- text | link | number | color | image | gif
  content      TEXT,               -- text for content types; NULL for image/gif
  file_path    TEXT,               -- attachments/<hash>.<ext> for image/gif
  preview_path TEXT,               -- attachments/thumbs/<hash>.webp
  content_hash TEXT NOT NULL,      -- SHA-256, UNIQUE (dedup key)
  copy_count   INTEGER DEFAULT 1,  -- bumped on re-copy instead of duplicating
  pinned       INTEGER DEFAULT 0,
  created_at   INTEGER NOT NULL,   -- ms epoch; refreshed on re-copy (recency)
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER             -- soft-delete tombstone (NULL = live)
)
settings(key TEXT PRIMARY KEY, value TEXT)   -- written synchronously on change
```

**Design rules**
- **Images are files, never BLOBs** — the DB stores paths only; the timeline loads
  thumbnails, full images load in the zoom modal.
- **Deduplication** by `content_hash`: re-copying an existing item bumps `copy_count` +
  `created_at` (moves it to the top) instead of inserting a duplicate. Re-copying a
  soft-deleted item un-deletes it.
- **Soft delete**: `delete_item` sets `deleted_at`; the UI hides it and offers a 5s undo
  (`restore_item`); unrestored rows (and their files) are purged on next launch.
- **Settings are written synchronously** on every change (no save-on-exit), so state like
  privacy mode survives a `kill -9`.
- **Migrations** are forward-only, keyed on `PRAGMA user_version` (`storage/mod.rs`):
  v2 added `pinned`/`preview_path`/`deleted_at`; v3 back-fills classification of pre-existing
  `text` rows into link/number/color.

---

## Clipboard capture design

ClipVault is **X11-first, Wayland-ready**. All X11 specifics live behind a
`ClipboardBackend` trait (`watcher/mod.rs`), so a Wayland backend can be added later
without touching the rest of the app.

The X11 backend (`watcher/x11.rs`) uses the [`x11-clipboard`](https://crates.io/crates/x11-clipboard)
crate's **event-driven** model (XFIXES) — never polling:

- `load_wait(UTF8_STRING)` blocks until the clipboard changes and returns the text (empty
  for a non-text change).
- For a non-text change it probes image targets (`image/gif`, `image/png`, `image/jpeg`)
  with `load()` (an immediate read of the current value), preserving the **raw original
  bytes** so GIFs stay animated GIFs.
- On persistent failure (X server restart / logout) it backs off and the supervisor
  restarts it.

**Copy-back & self-copy suppression.** When you copy an item back, a dedicated writer
thread takes clipboard ownership. Because the OS/desktop clipboard manager can emit
*several* change events for a single copy, the self-copy marker is **not** one-shot: it
suppresses **all** echoes of the copied content and is cleared only when genuinely
different content is copied — so copy-back never duplicates history.

---

## Content classification

`classifier::classify_text` (hand-rolled, no regex crate), checked in order:

1. **Color** — `#RGB` / `#RRGGBB` hex, or `rgb(...)` / `rgba(...)`.
2. **Link** — a single whitespace-free token starting with `http://`, `https://`, or
   `www.` that contains a dot (e.g. `https://www.bild.de`).
3. **Number** — digits/space/`-`/`+`/`.`/`()` with ≥3 digits (phone/IBAN/card), or `0x…` hex.
4. Otherwise **text**.

Images/GIFs are classified earlier by MIME + magic bytes. Classification runs at capture
time; the v3 migration re-classifies items captured before this existed.

---

## IPC API reference

All commands are defined in `src-tauri/src/ipc.rs` and registered in `lib.rs`. From the
UI they're called via the typed wrappers in `src/api.ts`.

| Command | Params | Returns | Purpose |
|---|---|---|---|
| `list_items` | `limit, before_created_at?, before_id?` | `Item[]` | Paged non-pinned, non-deleted items, newest-first (compound cursor). |
| `list_pinned` | – | `Item[]` | All pinned items. |
| `list_by_type` | `type_str, limit, before_created_at?, before_id?` | `Item[]` | Items of one type (folder view; includes pinned of that type). |
| `folder_counts` | – | `[type, count][]` | Per-type counts for the sidebar. |
| `copy_item` | `id` | – | Put an item back on the clipboard (self-copy suppressed). |
| `delete_item` | `id` | – | Soft-delete. |
| `restore_item` | `id` | – | Undo a soft-delete. |
| `set_pinned` | `id, pinned` | – | Pin / unpin. |
| `update_content` | `id, content` | – | Edit a content-based item in place. |
| `get_privacy` / `set_privacy` | – / `on` | `bool` / – | Read / toggle privacy mode. |

**Events** emitted to the UI: `item-added` (after a capture) and `privacy-changed(bool)`.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+Alt+V` | Summon / focus the window (global, works from anywhere) |
| `↑` / `↓` | Move selection |
| `Enter` | Copy selected item back to clipboard |
| `1`–`9` | Copy the Nth visible item |
| `Del` | Delete selected (with undo toast) |
| `E` | Edit selected content item |
| `P` | Pin / unpin selected |
| `Esc` | Close zoom modal / cancel edit |

---

## Privacy

Privacy mode fully **pauses capture** (the watcher discards changes; nothing is stored).
Toggle it from the header button or the tray menu. The state is persisted synchronously,
so it survives restarts and crashes. Copied passwords from password managers are out of
scope for this phase but are on the roadmap (MIME-hint exclusion).

---

## Project layout

```
Clipboard-Manager/
├─ README.md                     ← this file
├─ package.json, vite.config.ts, tailwind.config.js, index.html
├─ src/                          React UI (dark, TypeScript)
│  ├─ App.tsx                    layout, folder state, actions, keyboard wiring
│  ├─ api.ts                     typed IPC wrappers + event listeners
│  ├─ components/                Sidebar, Card, ZoomModal, UndoToast
│  ├─ hooks/                     useTimeline (paging/grouping), useKeyboardNav
│  ├─ lib/dates.ts               Today/Yesterday grouping → virtualizer rows
│  └─ styles.css                 Tailwind + dark tokens
├─ src-tauri/                    Rust core
│  ├─ Cargo.toml, tauri.conf.json, capabilities/
│  └─ src/
│     ├─ main.rs, lib.rs         entry + Tauri builder (plugins, threads, events)
│     ├─ watcher/{mod,x11}.rs    ClipboardBackend trait + X11 watcher
│     ├─ capture.rs              capture pipeline
│     ├─ classifier.rs           type detection
│     ├─ thumbnail.rs            WebP thumbnails
│     ├─ hashing.rs              SHA-256
│     ├─ clipboard_writer.rs     copy-back writer thread
│     ├─ storage/{mod,items,settings}.rs  SQLite + migrations
│     ├─ state.rs, ipc.rs        app state + IPC commands
└─ docs/superpowers/            specs, plans, and the lessons-and-pitfalls post-mortem
```

## Tech stack

- **Backend:** Rust · Tauri v2 · `rusqlite` (bundled SQLite) · `x11-clipboard` + `x11rb` ·
  `image` + `webp` (thumbnails) · `sha2` · `uuid` · `anyhow`. Tauri plugins:
  single-instance, autostart, global-shortcut, notification.
- **Frontend:** React 19 · TypeScript · Vite 5 · Tailwind CSS 3 · `@tanstack/react-virtual`.

---

## Testing

```bash
# Rust unit tests (storage, dedup, classifier, thumbnails, capture, migrations)
cd src-tauri && cargo test

# Frontend type-check + build
npm run build
```

Because the clipboard, tray, and rendering can only be truly validated at runtime, the
project also uses a **sandboxed live-X11 runtime gate** (scripts under `scratchpad/` in the
working session): it launches the built binary with `XDG_DATA_HOME`/`XDG_CONFIG_HOME`
pointed at a temp dir, drives the real X clipboard, and asserts against the sandbox
database — plus screenshot verification of the rendered UI. This caught bugs that unit
tests and static review missed (see the post-mortem).

---

## Developer notes & gotchas

Read **`docs/superpowers/lessons-and-pitfalls.md`** before changing capture, the clipboard
backend, the build/run flow, or the UI-verification method. Highlights:

- **`load_wait(TARGETS)` doesn't work** with `x11-clipboard`; use `load_wait(<data
  target>)` + `load()`. Verify clipboard behavior with a live run, not just types.
- **`cargo build` ≠ a real app** — it produces a dev binary that needs the Vite dev
  server. Use `npm run tauri build` for a standalone app.
- **Node 18 needs Vite 5** (Vite 7 crashes on Node 18 with `crypto.hash is not a function`).
- **A black `xwd` screenshot of the webview is not proof of a blank UI** — WebKitGTK
  composites to a GPU surface; force a repaint before capturing.
- Enabling a Tauri config capability (e.g. `assetProtocol`) usually needs a matching crate
  feature (e.g. `protocol-asset`).
- `auto_launch` writes autostart to the real `~/.config/autostart` (ignores `XDG_CONFIG_HOME`).

---

## Roadmap

- **Phase 0 — Walking skeleton (done, merged):** capture, storage, tray, autostart,
  global hotkey, single-instance, hide-to-tray, privacy mode.
- **Phase 1 — MVP timeline (in progress, `phase-1`):** virtualized date-grouped timeline,
  folders sidebar, copy-back, delete+undo, edit, pin, image zoom, keyboard nav,
  link/number/color classification, thumbnails.
- **Phase 2 — Full features:** user folders, full-text search (FTS5), link metadata,
  clean/plain-text copy, password-manager exclusion, settings screen.
- **Phase 3 — Polish:** `.deb`/AppImage packaging & first-run UX, retention rules,
  scheduled backups, opt-in SQLCipher encryption, performance audit.

Design specs and per-phase implementation plans live in `docs/superpowers/`.

---

## Design decisions (the "why")

- **Tauri + Rust over Electron** — for an app that runs 24/7 in the background, ~10–20 MB
  idle RAM and ~0% idle CPU matter; the Rust core also gives raw-byte clipboard access
  (GIF fidelity) that a purely-JS approach can't.
- **X11-first behind a trait** — the target machine runs X11; the `ClipboardBackend`
  boundary keeps a Wayland backend a drop-in for later.
- **Local SQLite, files-on-disk for images** — durable, fast over years of history, and
  trivially portable (Phase 3 adds one-file export/import).
- **Dark mode only** — a deliberate single theme; no theme system in the codebase.
