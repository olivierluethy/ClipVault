# Building & Installing ClipVault (.deb)

This guide covers building the Debian package from source and installing it on
Ubuntu (developed on 24.04, targets 22.04+). Follow it top-to-bottom the first
time; after that, the **TL;DR** at the top is all you need.

---

## TL;DR (once the toolchain is set up)

```bash
cd ~/Documents/Clipboard-Manager

# 1. Build the .deb (release build, ~25s if Rust deps are cached, several minutes cold)
npm run tauri build -- --bundles deb

# 2. Install it (apt pulls in system dependencies automatically)
sudo apt install ./src-tauri/target/release/bundle/deb/clipvault_0.1.0_amd64.deb

# 3. Launch: search "ClipVault" in the app grid, or run `clipvault`, or press Ctrl+Alt+V
```

The finished package lands at:

```
src-tauri/target/release/bundle/deb/clipvault_0.1.0_amd64.deb
```

---

## 1. Prerequisites (one-time setup)

ClipVault is a **Tauri v2** app: a Rust backend + a React/Vite frontend, bundled
into a native binary. You need the Rust toolchain, Node, and the system libraries
Tauri links against.

### 1a. Node.js 18

This machine runs **Node 18**, and the project is pinned to **Vite 5** to match
(newer Vite needs Node 20.19+/22.12+ and will crash on 18 with
`crypto.hash is not a function`). Check your version:

```bash
node --version   # should be v18.x
```

If you ever upgrade to Node 20+, Vite can be bumped back to latest — but don't
mix Node 18 with a newer Vite.

### 1b. Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# then restart the shell, or: source "$HOME/.cargo/env"
rustc --version   # confirm it works
```

### 1c. Tauri build dependencies (system libraries)

These are the `-dev` packages Tauri compiles against. Install once:

```bash
sudo apt update
sudo apt install -y \
  build-essential curl wget file \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxcb1-dev libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libxdo-dev \
  pkg-config
```

> `libxcb-*-dev` are needed for the X11 clipboard watcher; `libxdo-dev` is for the
> paste-directly (auto Ctrl+V) feature via the `enigo` crate.

### 1d. Project dependencies (npm)

From the project root:

```bash
npm install
```

The Tauri CLI is a dev dependency of the project, so you invoke it through
`npm run tauri ...` — no global install required.

---

## 2. Building the .deb

From the project root (`~/Documents/Clipboard-Manager`):

```bash
npm run tauri build -- --bundles deb
```

What happens:

1. Vite builds the frontend into `dist/`.
2. Cargo compiles the Rust backend in **release** mode into
   `src-tauri/target/release/clipvault`.
3. Tauri bundles binary + icons + desktop entry into the `.deb`.

**Output:** `src-tauri/target/release/bundle/deb/clipvault_0.1.0_amd64.deb`
(~11 MB).

### Build timing

- **Cold** (first build, or after `cargo clean`): several minutes — it compiles
  all Rust dependencies.
- **Warm** (deps cached): ~25 seconds — only the app crate recompiles.

### If the build seems to hang or exits oddly

There's a known quirk where the very first background build attempt can exit
early with an empty log. If that happens, just run the command again in the
foreground (as shown above) — it works on the retry. A plain `cargo build`
(without the Tauri CLI) is **not** enough: it produces a dev-configured binary
that expects the Vite dev server. Always build the standalone app with
`npm run tauri build`.

---

## 3. Installing

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/clipvault_0.1.0_amd64.deb
```

Using `apt install` (rather than `dpkg -i`) means the runtime dependencies are
resolved and installed automatically. Those runtime deps are:

```
libxcb1, libxcb-render0, libxcb-shape0, libxcb-xfixes0,
libayatana-appindicator3-1, libwebkit2gtk-4.1-0, libgtk-3-0
```

The installed binary is `/usr/bin/clipvault`.

### Reinstalling / upgrading

Installing the same version again over an existing install is fine — apt replaces
it. If you built a new version, install the new `.deb` the same way.

**Important:** ClipVault is single-instance. If a copy is already running (tray
icon present), **quit it first**, then install and relaunch, so the new binary is
the one actually running. Otherwise the old process keeps holding the window.

---

## 4. Running it

Any of:

- Search **ClipVault** in the GNOME app grid and click it.
- Run `clipvault` in a terminal.
- Press the global hotkey — default **Ctrl+Alt+V** (configurable in Settings ⚙).

The app lives in the system tray. Closing the window hides it to the tray; use the
tray menu to quit fully. It also auto-starts on login.

Your clipboard data is stored (encrypted at rest by default via the OS keyring)
under `~/.local/share/clipvault/`.

---

## 5. Optional features (extra system packages)

Two features rely on external programs. They **degrade gracefully** — the app runs
fine without them, those features just stay inert.

```bash
# OCR: makes text inside captured images searchable
sudo apt install -y tesseract-ocr

# Wayland clipboard support — ONLY if you run a Wayland session.
# This machine runs X11, so you do NOT need this.
sudo apt install -y wl-clipboard
```

---

## 6. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| **Dock/launcher shows a generic gear icon** | GNOME caches launcher icons. It only refreshes after a **re-login**. Log out and back in. |
| **Old code still shows after installing a new build** | An old instance is still running (single-instance guard). Quit it via the tray, then relaunch. |
| **`crypto.hash is not a function` during build** | Vite/Node mismatch. You're on Node 18 → the project must stay on Vite 5 (it is, by default). Don't upgrade Vite without also upgrading Node to 20+. |
| **Build exits immediately with an empty log** | Known first-attempt quirk. Re-run `npm run tauri build -- --bundles deb`. |
| **App window says "Could not connect to localhost"** | You launched a *dev* binary. Use the packaged `/usr/bin/clipvault` (from the `.deb`), or build with `npm run tauri build`, not a bare `cargo build`. |
| **Blank white window in `npm run tauri dev`** | Multiple stacked `tauri dev` instances crashed the esbuild service. Kill them all and run one — or just use the installed `.deb`, which is self-contained. |

---

## 7. Cheat sheet

```bash
# Full cycle: build + install + run
cd ~/Documents/Clipboard-Manager
npm run tauri build -- --bundles deb
sudo apt install ./src-tauri/target/release/bundle/deb/clipvault_0.1.0_amd64.deb
clipvault
```

That's it. Once the toolchain from section 1 is in place, you only ever need
section 7.
