# AGENTS.md

These instructions are for coding agents working in this repository (Codex, Claude Code, Qodo, Cursor, etc.).

## Feedback Loop

If I ever correct you, add the correction to `FEEDBACK.md` so it never happens again.

## Mission

Build clean, modern macOS desktop apps in Rust with Tauri, while keeping behavior and visuals aligned with the Apple ecosystem.

## Non-negotiables

- Prefer simple, legible UI and obvious interaction flows.

## UI direction

- Very CLI like a terminal, but in a hacky kind of cool way.
- Keyboard shortcuts for everything.
- ASCII art is nice
- Beautiful, easy to use, hacker
- Center the UI, it should always look good regardless of window width

## Architecture

- Backend: Rust via Tauri v2 (`src-tauri/`)
- Frontend: static HTML/CSS/JS (`ui/`) — no Node.js or bundler required
- IPC: Tauri commands (`#[tauri::command]`) invoked from JS via `window.__TAURI__.core.invoke()`
- Configuration: `src-tauri/tauri.conf.json`

## Iconography

- Prefer SF Symbols for in-app iconography.
- Store symbol exports in `assets/symbols/` (typically SVG).
- Keep icon weights and sizes consistent within a screen.

## Build and packaging expectations

- `.app` bundles are created with `cargo tauri build` (wrapped by `scripts/build_macos_app.sh`).
- Icon generation pipeline:
  - `assets/icons/AppIcon-1024.png`
  - Tauri auto-generates `.icns` during build
  - bundle embeds `Contents/Resources/AppIcon.icns`
- If icon source is missing, fallback chain is:
  - `scripts/generate_default_icon.swift`
  - macOS `GenericApplicationIcon.icns` extraction

## Commands agents should run

```bash
./scripts/dev.sh
./scripts/check.sh
./scripts/build_macos_app.sh
```

## Change checklist

- Keep README/docs in sync with behavior.
- Keep scripts executable and cross-shell safe (`bash`, `set -euo pipefail`).
- Validate macOS packaging still works after refactors.
- Frontend changes go in `ui/`, backend changes go in `src-tauri/src/`.
