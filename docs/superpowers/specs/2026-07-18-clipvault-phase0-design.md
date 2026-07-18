# ClipVault — Phase 0 Design (Walking Skeleton)

*Date: 2026-07-18*
*Status: Approved — ready for implementation planning*

## Purpose

Phase 0 is the **de-risking foundation** of ClipVault. Its only job is to prove
the risky system-integration plumbing works end-to-end on the target machine
before any real UI is built on top of it. If any piece here needs a workaround,
we find out now — not after the timeline, folders, and search are built.

This spec covers **Phase 0 only**. Folders, FTS5 search, rich card UI, thumbnails,
export/import, and the full classifier are explicitly out of scope and belong to
later phases, each of which will get its own design → plan → implementation cycle.

## Locked decisions (from §6 of the master plan + environment discovery)

- **App name:** `ClipVault` (package/identifier `clipvault`; data dir
  `~/.local/share/clipvault/`).
- **Display server:** **X11-first, Wayland-ready.** The target machine runs
  Ubuntu 24.04.4 on an **X11** session (`XDG_SESSION_TYPE=x11`,
  `WAYLAND_DISPLAY` empty). We build and validate the X11 path now, behind a
  backend abstraction so a Wayland backend drops in later.
- **Clipboard watcher strategy:** **Event-driven XFIXES + raw MIME targets**
  (Approach B). Wake only on real clipboard change (~0% idle CPU); read the
  original bytes so GIF animation and original encodings are preserved.
- **Link metadata fetching:** ON by default, toggleable — *deferred to Phase 2*,
  noted here only so the schema/settings stay forward-compatible.
- **Encryption at rest:** OFF in v1. Rely on LUKS full-disk encryption. Opt-in
  SQLCipher deferred to Phase 3.
- **Minimum Ubuntu:** 22.04 LTS+, developed and tested against 24.04.
- **Accent color:** Violet/Indigo `#7C6CF0` on deep anthracite `#121212`.
- **Theme:** Dark mode only. No theme system in the codebase.

## Environment (verified 2026-07-18)

| Item | State |
|---|---|
| OS | Ubuntu 24.04.4 LTS |
| Session | X11 (Xorg) — not Wayland |
| Desktop | GNOME (`ubuntu:GNOME`) |
| Tray support | `ubuntu-appindicators@ubuntu.com` extension present ✅ |
| Rust toolchain | Not installed — install via rustup |
| Node | v18.19.1 (sufficient for Tauri v2) |
| Clipboard CLIs | `wl-clipboard`/`xclip` not installed (not required — arboard/x11rb are libraries) |

> Note: the machine defaulting to X11 (rather than Wayland, which Ubuntu 24.04
> ships by default) likely reflects a login-time "Ubuntu on Xorg" choice or a
> GPU-driver fallback. If the session ever switches to Wayland, the capture
> backend must switch with it — hence the trait boundary.

## Phase 0 Definition of Done

A running, installable-in-dev app that:

1. Scaffolds Tauri v2 + React + Tailwind with dark-only tokens and the violet accent.
2. Enforces single instance (second launch focuses the existing window).
3. Shows a tray icon with menu: **Open / Privacy Mode (toggle) / Quit**.
4. Autostarts on login (enabled on first run; entry in `~/.config/autostart/`).
5. Hides to tray on window close; the process keeps running.
6. **Captures text and images** from the clipboard into SQLite + attachments dir.
7. Preserves **GIF fidelity** (raw bytes stored; `file` confirms still a GIF).
8. **Deduplicates** re-copies (bump `copy_count` + `created_at`, no new row).
9. Displays captures in a bare debug list that updates live.
10. Summons the window via a global hotkey.
11. **Privacy mode** pauses capture and its state survives `kill -9`.
12. Runs at ~0% idle CPU (event-driven, no polling).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Tauri v2 app "clipvault" (single instance)                │
│                                                            │
│  Rust core                                                 │
│  ├─ Tauri shell: tray, autostart, global-shortcut,         │
│  │   single-instance, hide-to-tray window                  │
│  ├─ watcher/  ClipboardBackend trait                        │
│  │            └─ X11Backend (x11rb + XFIXES, raw MIME)      │
│  │               → runs on its own thread                   │
│  ├─ classifier: MIME → {text | image | gif}  (minimal)     │
│  ├─ storage: rusqlite (WAL) + attachments/ dir, dedup       │
│  ├─ settings: SQLite key/value, synchronous writes         │
│  └─ ipc: list_recent_items, get/set_privacy                 │
│                                                            │
│  WebView UI (React + Tailwind, dark-only, #7C6CF0)         │
│  └─ bare debug list + privacy toggle, live via events      │
└──────────────────────────────────────────────────────────┘
```

## Components & responsibilities

### 1. Tauri shell (`src-tauri/src/main.rs`, `lib.rs`)
Wires the four system plugins and window behavior:
- `tauri-plugin-single-instance` — second launch focuses the running window.
- `tauri-plugin-autostart` — enabled on first run; writes `~/.config/autostart/`.
- `tauri-plugin-global-shortcut` — X11 path; registers the summon hotkey directly
  (no GNOME custom-shortcut workaround needed on X11).
- Tray icon (AppIndicator) with menu **Open / Privacy Mode (checkable) / Quit**.
- Window `close-requested` intercepted → `hide()` to tray; process stays alive.
  Only the tray **Quit** item actually exits.

### 2. `watcher/` module — clipboard capture
- **`ClipboardBackend` trait:** `start(sender: Sender<ClipEvent>)`, `stop()`.
  The single seam that isolates X11/Wayland specifics from the rest of the app.
- **`X11Backend`:** subscribes to XFIXES `SelectionNotify` on the `CLIPBOARD`
  selection (event-driven — fires only on real change). On each change it:
  1. Requests `TARGETS` to see available MIME types.
  2. Picks the best by priority: `image/gif` → `image/png` →
     `image/*` → `text/uri-list` → `text/plain;charset=utf-8` → `text/plain`.
  3. Reads the **raw bytes** for that target, handling X11's **INCR protocol**
     for large transfers.
  4. Emits a `ClipEvent { mime, bytes, received_at }` to the core.
- Runs on its **own thread**; panics are caught/isolated and the thread
  self-restarts so a single bad read never kills capture.
- A shared `AtomicBool privacy_on` gates capture: when true, changes are ignored
  entirely (paused, not read-then-discarded).

### 3. Classifier (minimal — `classifier.rs`)
Phase 0 maps MIME → `text | image | gif` only:
- `image/gif` **and** magic-byte check (`GIF87a` / `GIF89a`) → `gif`.
- other `image/*` → `image`.
- text targets → `text`.

Rich heuristics (links, numbers, IBAN/hex, colors) are Phase 1 and intentionally
excluded here.

### 4. Storage (`storage/`)
- `rusqlite` in **WAL mode**, DB at `~/.local/share/clipvault/clipvault.db`.
- `items` table created **forward-compatible** with the master schema:
  `id TEXT PK (UUID), type TEXT, content TEXT, file_path TEXT,
  content_hash TEXT NOT NULL, created_at INTEGER, updated_at INTEGER,
  copy_count INTEGER DEFAULT 1`. (Columns like `preview_path`, `pinned`,
  `source_app`, `metadata` may be added by later-phase migrations; Phase 0
  does not populate them.)
- `settings(key TEXT PRIMARY KEY, value TEXT)` table.
- Images/GIFs written as **files** to
  `~/.local/share/clipvault/attachments/<id>.<ext>` — never BLOBs; DB stores the
  path only. (Thumbnails are Phase 1.)
- **Dedup by SHA-256** of the raw content: if `content_hash` already exists,
  bump `copy_count` and refresh `created_at`/`updated_at` instead of inserting.

### 5. Settings store (`settings.rs`)
Same SQLite DB, `settings(key,value)`, written **synchronously on every change**
(no save-on-exit). Phase 0 exercises it with `privacy_mode` specifically to prove
the crash-safe persistence pattern from day one.

### 6. IPC commands
- `list_recent_items(limit) -> Vec<ItemDto>`
- `get_privacy() -> bool`
- `set_privacy(on: bool)` — persists synchronously and flips the watcher's `AtomicBool`.

The UI refreshes on a Tauri `item-added` event emitted after each successful capture.

### 7. React UI (`src/`)
- Dark tokens only: `#121212`-family background, `#7C6CF0` accent for
  focus/active. No light-mode code paths, no theme toggle.
- A **bare, throwaway debug list** of recent captures: type badge + short preview
  (text snippet or image thumbnail-in-place) + timestamp.
- A privacy toggle bound to `get/set_privacy`.
- This surface exists only to prove capture; the real virtualized timeline is Phase 1.

## Data flow

```
clipboard changes (any app)
  → XFIXES SelectionNotify on watcher thread
  → if privacy_on: ignore
  → else: request TARGETS → pick best MIME → read raw bytes (INCR-aware)
  → size guard (text ≤1MB, image ≤25MB) else skip + tray notify
  → classify MIME → type
  → SHA-256 hash → dedup check
      ├─ existing: bump copy_count + created_at
      └─ new: write attachment file if image/gif; insert items row
  → emit Tauri "item-added"
  → UI calls list_recent_items → re-renders debug list
```

## Error handling & guardrails

- **Size guards:** skip text > 1 MB and images > 25 MB; log + silent tray
  notification; never crash. (Limits are constants in Phase 0; a settings UI comes later.)
- **Self-copy suppression seam:** a hook/marker so a future copy-back action won't
  be re-captured as a new entry. No copy-back UI exists in Phase 0, but the seam
  is in place to avoid a retrofit.
- **DB errors** are logged; the watcher thread never dies from a storage failure.
- **X11 absent** (e.g. app run under a Wayland session): `X11Backend` init fails
  with a clear, actionable message rather than crashing — the trait allows a
  Wayland backend to be added later.
- **Watcher thread panic** is isolated; the thread restarts.

## Testing & verification

### Automated (Rust unit tests, TDD)
- Classifier: MIME + magic-byte → correct type (text/image/gif edge cases).
- Dedup: same hash bumps `copy_count`; different hash inserts.
- Settings: synchronous write → read round-trip against a temp DB.
- Storage: insert + query; attachment path construction.

### Manual gate checklist (on the real X11 machine)
1. Copy text elsewhere → appears in debug list < 200 ms.
2. Copy an image → file present in `attachments/`, row in DB, shows in list.
3. Copy a GIF → stored `.gif`; `file <path>` confirms it is still a GIF (fidelity).
4. Copy the same thing twice → **no** new row; `copy_count` incremented, item bumps to top.
5. Tray icon visible; **Open / Privacy / Quit** all work.
6. Toggle Privacy Mode ON → copying stores nothing; **`kill -9` the process →
   relaunch → Privacy Mode still ON** (crash-safe persistence).
7. Autostart entry exists in `~/.config/autostart/`.
8. Global hotkey summons + focuses the window.
9. Close window → hides to tray; process still running (`ps`).
10. Launch a second instance → focuses the existing window, no duplicate.
11. Idle CPU ~0% measured over 60 s (`top`/`htop`) with no clipboard activity.

## Toolchain setup (first implementation task)
- Install Rust via `rustup`.
- apt-install Tauri v2 Linux prerequisites: `webkit2gtk-4.1`, `libappindicator3`,
  `librsvg2`, and standard build tools.
- Scaffold via `create-tauri-app` (React + TypeScript + Tailwind).
- Node 18.19.1 is sufficient.

## Explicitly out of scope for Phase 0
User/system folders, FTS5 search, virtualized date-grouped timeline, rich card
UI + actions (edit/clean-copy/QR/zoom modal), thumbnails, link metadata fetching,
color/number/link classification, multi-select, export/import, retention rules,
SQLCipher, `.deb`/AppImage packaging, GNOME Wayland shortcut helper. Each returns
in its designated later phase.
