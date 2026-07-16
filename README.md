# Rust + Tauri macOS Template

A GitHub template for building native macOS desktop apps with Rust and [Tauri v2](https://v2.tauri.app). No Node.js, no bundler -- just Rust, HTML, CSS, and JS.

## Features

- **Tauri v2** with capability-based permissions and IPC
- **Static frontend** -- vanilla HTML/CSS/JS in `ui/`, no build step
- **Terminal-style UI** -- ASCII banner, command deck, dark theme
- **Keyboard-first** -- global shortcuts for every action
- **macOS `.app` bundling** via `cargo tauri build`
- **Icon pipeline** -- drop in a 1024x1024 PNG, get a bundled `.icns`
- **CI** -- GitHub Actions workflow for fmt, clippy, test, and build
- **Agent-ready** -- `AGENTS.md` with instructions for Codex, Claude Code, Cursor, etc.

## Prerequisites

- macOS 13.0+
- [Rust](https://rustup.rs) (stable)
- Xcode Command Line Tools (`xcode-select --install`)

## Quick Start

```bash
# Install toolchain + Tauri CLI
make setup

# Run in dev mode (hot reload)
make dev

# Lint, format, test
make check

# Build a production .app bundle
make build-app
```

The built `.app` lands in `dist/`.

## Use as a GitHub Template

1. Push this repo to GitHub
2. **Settings > General > Template repository** -- enable it
3. Click **Use this template** to scaffold a new app

See [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template).

## Project Structure

```
src-tauri/
  src/lib.rs          Tauri commands (Rust backend)
  src/main.rs         Entry point
  tauri.conf.json     App config (window, bundle, permissions)
  capabilities/       Tauri v2 permission grants
ui/
  index.html          App shell
  main.js             Frontend logic + IPC via window.__TAURI__
  style.css           Dark terminal theme
scripts/
  setup.sh            Install toolchain + Tauri CLI
  dev.sh              cargo tauri dev
  check.sh            fmt + clippy + test
  build_macos_app.sh  cargo tauri build + copy to dist/
assets/
  icons/              App icon source (1024x1024 PNG)
  symbols/            SF Symbol exports for in-app icons
```

## Configuration

All app settings live in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json):

| Field | Purpose |
|---|---|
| `productName` | App name in the menu bar and `.app` bundle |
| `identifier` | macOS bundle identifier (e.g. `com.example.myapp`) |
| `app.windows` | Window size, title, transparency, decorations |
| `bundle.icon` | Paths to generated icon files in `src-tauri/icons/` |
| `bundle.macOS.minimumSystemVersion` | Minimum macOS version |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+R` | Run checks |
| `Cmd+B` | Show build command |
| `Cmd+K` | Reset fields |
| `Cmd+1` / `Cmd+2` | Focus APP_NAME / APP_BUNDLE_ID |
| `Tab` / `Shift+Tab` | Cycle focus |
| `Cmd+/` | Toggle shortcut overlay |

## App Icon

1. Place a **1024x1024 PNG** at `assets/icons/AppIcon-1024.png`
2. Run `cargo tauri icon assets/icons/AppIcon-1024.png` to generate all required sizes into `src-tauri/icons/`
3. Run `make build-app` -- Tauri picks up the generated icons and bundles the `.icns`

Fallback if no icon exists: `scripts/generate_default_icon.swift` creates one from SF Symbols, or the macOS generic app icon is extracted.

## Make Targets

| Target | Command |
|---|---|
| `make setup` | Install Rust toolchain, Tauri CLI, macOS targets |
| `make dev` | Start dev server with hot reload |
| `make check` | Run fmt, clippy, and tests |
| `make build-app` | Build production `.app` bundle |
| `make clean` | Remove `target/` and `dist/` |

## Architecture

```
Frontend (ui/)              Backend (src-tauri/)
 index.html                  lib.rs
 main.js ──invoke()──────▶  #[tauri::command] fn
          ◀── return ─────  get_build_command()
                             get_check_command()
```

IPC uses Tauri's `window.__TAURI__.core.invoke()` (enabled by `withGlobalTauri: true` in config). The frontend has no build step -- Tauri serves static files directly from `ui/`.

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

1. `cargo fmt --check`
2. `cargo clippy -- -D warnings`
3. `cargo test`
4. `cargo tauri build`

Runs on `macos-latest` with Rust stable.

## License

MIT
