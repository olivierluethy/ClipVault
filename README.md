# ClipVault

A native-feeling, dark-mode clipboard manager for Ubuntu (Tauri v2 + Rust + React).
Captures text/images/GIFs from the clipboard into local SQLite, lives in the tray,
autostarts, and is summoned with a global hotkey. **Phase 0 (walking skeleton) is complete.**

## Requirements

- **Rust** (stable, via rustup)
- **Node.js** — this project pins **Vite 5** so it runs on the repo's Node 18.
  Vite 7 (and the latest toolchain) require Node 20.19+/22.12+; if you upgrade Node
  to 20+, you can bump Vite back to latest.
- Tauri Linux system deps: `libwebkit2gtk-4.1-dev build-essential libxdo-dev
  libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config`
- Developed and tested on **Ubuntu 24.04 / X11**.

## Running

**Development** (hot-reload UI via the Vite dev server):

```bash
npm install
npm run tauri dev
```

> Note: `npm run tauri dev` starts the Vite dev server and the app together. Running
> the debug binary (`src-tauri/target/debug/clipvault`) *directly* will show
> "Could not connect to localhost" because a debug build loads the UI from the dev
> server. For a standalone app, build a release (below).

**Standalone / installable build** (frontend bundled into the binary, no dev server):

```bash
npm run tauri build            # produces .deb + AppImage under src-tauri/target/release/bundle/
npm run tauri build -- --no-bundle   # just the binary, faster
```

The release binary at `src-tauri/target/release/clipvault` runs on its own and is
what an installed app / autostart entry should point at.

## Tests

```bash
cd src-tauri && cargo test
```

## Docs

Design specs and implementation plans live under `docs/superpowers/`.
