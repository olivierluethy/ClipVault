# ClipVault — Features

A complete list of what ClipVault does today. ClipVault is a native-feeling,
dark-mode clipboard manager for Ubuntu (X11), built on Tauri v2 + Rust + React +
Tailwind + SQLite.

---

## Capture & history

- **Automatic capture.** Everything you copy is saved to a local history — text,
  URLs, numbers/codes, hex/rgb colors, images, and animated GIFs.
- **Fidelity-preserving.** Image and GIF originals are stored byte-for-byte; text
  keeps its exact content.
- **Deduplication.** Copying identical content again collapses onto the existing
  entry (by content hash) and refreshes its recency instead of creating a duplicate.
- **Event-driven watcher.** Clipboard changes are captured via X11 events (no
  polling) → near-0% idle CPU, ~10–20 MB idle RAM.
- **Quick Add.** Save the current clipboard on demand — works even while privacy
  mode is on — from the header button or the tray menu.

## Content classification & organization

- **Automatic typing.** Items are classified as `text | link | number | color |
  image | gif`.
- **Library sidebar.** Built-in smart views with live counts: **All, Text, Links,
  Numbers, Images & GIFs, Colors**.
- **Most Frequently Copied ("Frequent") view.** A ranked list of the items you
  actually reuse most, highest-first, with a friendly empty state until you've
  reused something.
- **User folders.** Create, rename, and delete your own folders; assign items to
  them; per-folder counts.
- **Drag items into folders.** Drag one item — or a whole multi-selection — onto a
  user folder to file it. System views reject drops.
- **Color swatches & link previews.** Colors show a swatch; links show fetched
  Open Graph/Twitter preview image, title, and favicon (metadata fetch is toggleable).

## Reuse (paste-back) & usage tracking

- **One-click Copy.** A clearly labelled **Copy** button on every card puts the item
  back on the system clipboard; clicking a row does the same.
- **Self-copy suppression.** Reusing your own history never creates a new capture
  entry.
- **Clean copy.** Copy text with whitespace normalized and tracking params
  (e.g. `utm_*`) stripped from URLs.
- **Copy as plain text.** Force a plain-text copy.
- **Copy-and-hide.** In the speed workflow (Enter / number keys), copy and dismiss
  the window in one step.
- **"Used N×" reuse count.** Each item shows how many times you've *deliberately
  reused it from ClipVault* — the honest usage signal (pastes into other apps are
  not observable and are never implied). The badge is hidden until an item has been
  reused at least once, with a plain-language tooltip.

## Item management

- **Delete with undo.** Soft-delete any item with a 5-second undo toast.
- **In-place edit.** Edit text-based items (text/link/number/color) directly in the
  row.
- **Pin favorites.** Pin items to a dedicated section at the top.
- **Image/GIF zoom.** Open images and GIFs in a zoom modal.
- **QR codes.** Render any text/link as a scannable QR code.
- **View full value.** Expand long text/links in a modal.
- **Open link in browser.** Launch a captured URL in your default browser.

## Selection & bulk actions

- **Multi-select.** Per-row checkboxes with large, forgiving hit targets and a
  hover-grow affordance.
- **Range & sweep select.** Shift-click for a range; drag down the checkbox column to
  sweep-select.
- **Select-all & per-group select.** Select every item (`Ctrl+A`) or a whole date
  group via its header checkbox (with an indeterminate state).
- **Bulk bar.** Add the selection to a folder or delete it in one action.

## Duplicate cleanup

- **Similar view.** A sidebar smart view that groups entries which are the same
  thing but stored twice — differing only in whitespace, case, line endings, a
  URL's tracking parameters, a one-word edit, or an image re-encoded at another
  size. Exact copies are already collapsed at capture time; this catches the rest.
- **Clusters, not a list.** Each group names a keeper (pinned first, then the
  most reused, then the newest) and shows how close every other member is —
  “identical” or “94% alike”.
- **You choose what survives.** Reassign the keeper inside any group, remove a
  single entry, empty one group, or remove every non-keeper across all groups at
  once. Pinned entries are never offered for removal.
- **Reversible.** Removals go through the standard undo toast, so a bulk cleanup
  can be taken back.
- **Tunable.** A Strict / Balanced / Loose threshold in Settings decides how
  alike two entries have to be.

## Search & navigation

- **Full-text search.** Fast FTS5 search over item content (`Ctrl+F`), with
  prefix matching; works within any view.
- **Typo-tolerant search.** The `~fuzzy` toggle switches to Levenshtein
  (edit-distance) ranking, so “Gtihub” still finds “Github”. Results are sorted
  closest-match-first with recency as the tiebreaker, and a query never returns
  an empty list — the nearest items always show up. Text recognized from images
  by OCR is searched too.
- **Clear the search.** An “X” inside the search box appears as soon as you type
  and resets back to the folder view (`Esc` does the same).
- **Date filter.** A calendar picker that highlights days containing items and
  filters the timeline to a chosen day/range.
- **Date navigation rail.** A right-side chronological rail with scroll-spy that
  highlights and jumps to date groups (collapses to a header control on narrow
  layouts).
- **Jump to latest.** A floating control returns you to the newest items after
  scrolling away.
- **Sticky column header.** A persistent, muted table header above the list labels
  the columns — **Type / Content / Time / Used** — aligned to the rows, staying
  pinned while you scroll and adapting on narrow widths.
- **Date-grouped timeline.** A virtualized list grouped by Today / Yesterday / dates
  with sticky section headers; smooth over large histories; images shown as small
  WebP thumbnails.

## Background & system integration

- **System tray.** Tray icon with menu (including a privacy toggle and Quick Add);
  a distinct icon variant while privacy mode is on.
- **Global hotkey.** Summon/focus the window from anywhere (default `Ctrl+Alt+V`),
  **configurable** in Settings (presets include Super+V, Ctrl+Shift+V, etc.).
- **Autostart on login.** Toggleable.
- **Single instance.** A second launch focuses the existing window instead of
  starting a duplicate.
- **Hide-to-tray.** Closing the window hides it to the tray rather than quitting.
- **First-run welcome.** A one-time onboarding dialog that shows the configured
  hotkey.

## Privacy & security

- **Privacy mode.** Fully pause capture; the setting is persisted synchronously and
  survives restarts and crashes. Toggle from the header or tray.
- **Timed privacy.** Pause capture for a set number of minutes, then auto-resume.
- **Password-manager exclusion.** Opt-in skipping of secrets/sensitive clipboard
  content.
- **Encryption at rest.** The database is encrypted by default via SQLCipher, with
  the key stored in the OS keyring (auto-generated on first run, transparent at
  startup; overridable via `CLIPVAULT_KEY`). Plaintext DBs are migrated to encrypted
  automatically.

## Data management (Settings)

- **Retention.** Auto-prune history by maximum age and/or maximum item count
  (pinned items are kept).
- **Backups.** "Backup now" plus scheduled backups (clean single-file snapshots via
  `VACUUM INTO`).
- **Export / Import.** Export the whole history to a portable JSON file (attachments
  base64-embedded) and import it back, de-duplicated, with folders restored by name.
- **Storage stats.** Item count and total data size shown in Settings.

## UX & design

- **Dark-mode design system.** Near-black layered surfaces, a single iris accent,
  Space Grotesk (UI) + JetBrains Mono (content/meta), and a custom line-icon set.
- **Fully responsive.** The whole app — sidebar, header controls, rows, and column
  header — adapts down to narrow widths, collapsing labels and columns gracefully.
- **Keyboard-first.** Navigate and act without the mouse (see below).
- **Reduced-motion aware** and accessible focus states.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl+Alt+V` (configurable) | Summon / focus the window (global) |
| `Ctrl+F` | Focus the search box |
| `Ctrl+A` | Select all items in the current view |
| `↑` / `↓` | Move selection |
| `Enter` | Copy selected item (and hide) |
| `1`–`9` | Copy the Nth visible item (and hide) |
| `Space` | Toggle selection of the current item |
| `Del` | Delete selected (with undo) |
| `E` | Edit selected content item |
| `P` | Pin / unpin selected |
| `Esc` | Close modal / cancel edit / clear search |

---

*Reflects the current `master` branch. For architecture, the data model, the full
IPC command reference, and design rationale, see [`README.md`](README.md).*
