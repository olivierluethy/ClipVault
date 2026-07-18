# ClipVault — Lessons, Mistakes & Pitfalls (living post-mortem)

Purpose: an honest record of every wrong assumption, bug, and dead-end hit while
building ClipVault, so future work (human or agent) knows **what not to do and why**.
Read this before changing capture, the clipboard backend, the build/run flow, or
the UI verification method. Paired with the specs/plans in `docs/superpowers/`.

Legend: **Symptom → Wrong assumption → Root cause → Fix → Rule.**

---

## 1. The X11 clipboard watcher captured NOTHING (Phase 0, Critical)

- **Symptom:** App ran, DB created, ~0% CPU, but no clipboard items were ever stored.
- **Wrong assumption:** the plan's design — enumerate the clipboard `TARGETS` list via
  `x11-clipboard`'s `load_wait(TARGETS)`, then read the best target — was assumed to work.
- **Root cause:** `x11-clipboard` 0.9 `load_wait(TARGETS)` returns empty: the TARGETS
  reply is property type `ATOM`, which the crate's reader treats as mismatched/empty.
  Also `load_wait` blocks for the *next* owner change, so calling it twice per loop
  (once for TARGETS, once for the value) stranded the just-detected data.
- **Fix:** use the crate's real model — `load_wait(UTF8_STRING)` blocks for the change
  and returns text; for non-text changes, probe image targets with `load()` (immediate
  read of the current value). See `src-tauri/src/watcher/x11.rs`.
- **Rule:** **Never trust a library's behavior from its type signatures alone — verify
  against a live run.** Every static review (including a thorough opus whole-branch pass)
  approved the broken TARGETS code; only a runtime gate caught it. `load_wait(<data
  target>)` works; `load_wait(TARGETS)` does not with this crate.

## 2. The dev app showed "Could not connect to localhost" (Phase 0 gate)

- **Symptom:** launching the app showed a white page: "Could not connect to localhost:
  Connection refused." (The user hit this too.)
- **Wrong assumption:** two of them: (a) that Node 18 was "fine, 20+ just recommended";
  (b) that running the debug binary directly was a valid way to test.
- **Root cause (a):** the scaffold pulled **Vite 7**, which requires Node 20.19+/22.12+.
  On Node 18 the dev server crashed at startup (`TypeError: crypto.hash is not a
  function`), so `npm run tauri dev` opened a window with nothing serving the UI.
- **Root cause (b):** a plain `cargo build` produces a **dev-configured** Tauri binary
  that loads the UI from the dev server (`devUrl`); it does **not** embed the frontend.
- **Fix:** pin **Vite 5** (full Node 18 support). For a standalone app, build via the
  **Tauri CLI** (`npm run tauri build`), which embeds `frontendDist` and drops `devUrl`.
- **Rule:** match the toolchain to the runtime BEFORE building (check Node vs Vite
  engine requirements). To test a "real" app, use `tauri build`, not `cargo build`.
  Document the Node/Vite constraint (done in `README.md`).

## 3. THE BIG TIME SINK — "the app renders blank" was a screenshot artifact

- **Symptom:** every automated screenshot of the running app was a black/empty webview
  (title bar fine, content black), across a dozen debug builds. Hours were spent
  bisecting React (error boundary, Suspense, hooks vs JSX, Sidebar, CSS layout).
- **Wrong assumption:** that a black `xwd` screenshot meant the app rendered nothing.
- **Root cause:** WebKitGTK composites the web content to a GPU/EGL surface; `xwd`
  reads the X window pixmap, which is **stale/black when the webview is idle** at
  capture time. A DOM mutation (or any repaint) flushes to the pixmap and `xwd` then
  captures correctly. The app was rendering perfectly on the real screen the whole time
  (the user could use it — that's how they found the copy-back bug).
- **Fix / verification method:** force a repaint immediately before capture (e.g. copy
  a fresh item so `item-added` re-renders) and capture within ~500ms; or add a transient
  DOM mutation. See `scratchpad/confirm.sh` and `xwd2png.py`.
- **Rule:** **an offscreen `xwd` capture of a WebKitGTK webview is not proof of a blank
  UI.** Before concluding "React renders nothing", (a) confirm capture works with a
  static HTML element, (b) force a repaint, (c) check `getBoundingClientRect`/DOM.
  Prefer driving a real change right before the screenshot. Better still: install a
  screenshot tool that captures the composited screen (needs sudo here), or use the
  webview devtools. Do NOT spend hours bisecting app code on the strength of a black
  offscreen capture.

## 4. Build broke: assetProtocol without the `protocol-asset` feature (Phase 0)

- **Symptom:** `cargo`/`tauri` build failed: "tauri dependency features do not match the
  allowlist … add the `protocol-asset` feature." Caught only at the whole-branch level.
- **Root cause:** enabling `app.security.assetProtocol` in `tauri.conf.json` requires the
  `tauri` crate's `protocol-asset` cargo feature; per-task reviews only ran `npm run
  build` (frontend) so they missed it.
- **Fix:** add `protocol-asset` to `tauri` features in `src-tauri/Cargo.toml`.
- **Rule:** enabling a Tauri config capability often needs a matching crate feature.
  Run the FULL build (`cargo build` + the app), not just the frontend, per change.

## 5. Data dir: `app_data_dir()` vs `data_dir()` (Phase 0)

- **Wrong assumption:** the plan's `app.path().app_data_dir()` gives `~/.local/share/clipvault/`.
- **Root cause:** `app_data_dir()` appends the bundle identifier →
  `~/.local/share/net.gmx.clipvault/`. The spec required exactly `~/.local/share/clipvault/`.
- **Fix:** use `app.path().data_dir()?.join("clipvault")`.
- **Rule:** know the difference between `data_dir()` (XDG data home) and `app_data_dir()`
  (that + identifier). Also note the asset-protocol scope must match the real data dir.

## 6. Pagination could silently skip items (Phase 1)

- **Root cause:** `list_items` paged on `created_at < before` with no tiebreak; dedup
  rewrites `created_at` to the current millisecond, so ties at a page boundary dropped an item.
- **Fix:** compound `(created_at, id)` cursor with `ORDER BY created_at DESC, id DESC`.
- **Rule:** cursor pagination needs a unique tiebreak column when the sort key isn't unique.

## 7. Thumbnails: panic + wasteful regeneration (Phase 1)

- **Root cause:** the `webp` crate's `.encode()` internally `.unwrap()`s (panics on
  failure), violating the "non-fatal" contract; and thumbnails were regenerated on every
  duplicate capture even though the dedup path discards them.
- **Fix:** `encode_simple(false, q).ok()?`; only generate when the hash is new (guarded by
  `!path.exists()`), reuse the existing thumbnail otherwise.
- **Rule:** check whether a crate's convenience method panics; guard expensive work behind
  the dedup/new-item check. (Also: a degenerate 1×1 test image is a bad fixture — thumbnails
  of it can legitimately produce nothing; use realistic sizes.)

## 8. Copy-back DUPLICATED items in history (Phase 1, user-reported)

- **Symptom:** copying an item from ClipVault re-added/duplicated it.
- **Wrong assumption:** a one-shot self-copy suppression marker (clear after suppressing
  one echo) is enough.
- **Root cause:** a single copy-back produces **multiple** clipboard-change events (the
  GNOME clipboard manager re-asserts ownership — seen earlier as copy_count jumping to 3).
  The one-shot marker suppressed only the first echo; later echoes were captured.
  Secondary bug: `copy_item` only treated `type == "text"` as content-based, so copying a
  link/number/color item hit the image branch and errored on a missing file.
- **Fix:** keep the self-copy marker set (suppress ALL echoes of that content), clear it
  only when genuinely different content arrives; decide copy-back write mode by presence of
  a file (image/gif) vs content.
- **Rule:** the OS/DE clipboard manager emits multiple events per copy — never assume one
  clipboard change per user action. Handle content-derived types (link/number/color) the
  same as text everywhere they're content-based.

## 9. Classification only applied to NEW captures (Phase 1, user-reported)

- **Symptom:** a saved link (`https://www.bild.de`) didn't appear under the Links folder.
- **Root cause:** items captured before link/number/color detection existed were stored as
  `text`; classification runs only at capture time, so historical rows kept the wrong type.
  (The `is_link` classifier itself was correct for http/https/www.)
- **Fix:** a one-time v3 migration re-classifies existing `text` rows via `classify_text`.
- **Rule:** when adding/refining classification, backfill existing data with a migration —
  don't assume new logic retroactively fixes stored rows.

## 10. UI discoverability: no visible Copy button (Phase 1, user-reported)

- **Symptom:** copy was only via clicking the card body; action icons were hidden until
  hover, and there was no copy icon — a new user couldn't find how to copy.
- **Fix:** an always-visible, labelled **Copy** button on every card (plus pin/edit/delete
  always visible).
- **Rule:** the primary action must be a visible, obvious control — don't rely on
  hover-reveal or "click anywhere" affordances for discoverability.

---

## Cross-cutting process lessons

- **Runtime verification is non-negotiable.** Static review + unit tests + `cargo build`
  all passed while the app captured nothing (§1) and while the webview was (apparently)
  blank (§3). The sandboxed live-X11 gate (`scratchpad/gate.sh`, `clip-set`/`clip-read`,
  `xwd2png.py`) is what catches these. Always drive the real flow and observe it.
- **Verify the observation tool before trusting it** (§3): a black screenshot ≠ a blank app.
- **Sandbox side effects:** run test builds with `XDG_DATA_HOME`/`XDG_CONFIG_HOME` pointed
  at a temp dir. Note: `auto_launch` writes autostart to the REAL `~/.config/autostart`
  (ignores XDG) — clean up test `.desktop` entries.
- **Per-task reviews miss integration issues** (§4): keep a whole-branch review AND a
  runtime gate at the end of each sub-project.
- **Don't over-trust plan code:** the plan/spec are starting points; several bugs (§1, §6,
  §7) were faithfully-implemented plan text. Review against reality, not against the plan.

## Known accepted trade-offs / backlog (not bugs)

- Self-copy marker stays set until different content is copied → re-copying the exact same
  value from an external app right after a ClipVault copy won't bump it (rare, minor).
- `is_color`/`is_number` are permissive heuristics (`rgb(anything)`, version strings like
  `1.2.3` count as numbers). Acceptable for a classifier, not a validator.
- Image-folder view (image+gif) merges two queries client-side, capped at 200 each (no
  deep paging yet). Watcher can drop a clipboard change that lands mid image-probe.
- These are logged for a future hardening pass; see also the SDD progress ledger.
