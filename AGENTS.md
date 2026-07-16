# AGENTS.md

These instructions are for coding agents working in this repository (Codex, Claude Code, Qodo, Cursor, etc.). Grainlab has accumulated important product and technical decisions that are not obvious from a single source file. Read the context index before making material changes.

## Repository context

Start with [`.agents/README.md`](.agents/README.md). It routes work to focused context documents:

- [`.agents/product-context.md`](.agents/product-context.md) — product identity, experience goals, scope, and deliberate non-goals.
- [`.agents/interaction-contracts.md`](.agents/interaction-contracts.md) — macOS window behavior, full-resolution image navigation, crop, history, import, and UI invariants.
- [`.agents/film-emulation.md`](.agents/film-emulation.md) — physical film model, WGSL pipeline, grain requirements, process semantics, stock data, and calibration expectations.
- [`.agents/engineering-workflow.md`](.agents/engineering-workflow.md) — repository architecture, generated files, upstream integration, validation, packaging, and handoff rules.

These files record stable decisions from the product’s development history. Prefer them over guessing intent from an isolated implementation detail. Keep them synchronized when a change alters a product contract or architectural boundary.

## Feedback Loop

If I ever correct you, add the correction to `FEEDBACK.md` so it never happens again.

## Mission

Build Grainlab into a clean, modern, local-first macOS film-development application in Rust and Tauri. Preserve physically coherent film behavior, full-resolution image fidelity, and interactions that feel native to macOS while retaining the app’s terminal-inspired identity.

## Non-negotiables

- Prefer simple, legible UI and obvious interaction flows.
- Never downsample the editor’s source buffer. The canvas backing dimensions must match the decoded source image.
- All GPU photo shaders use WGSL. Keep the JavaScript CPU implementation as a compatibility fallback with the same stage order.
- Film stocks remain data-driven and discoverable from `ui/film-stocks/`; do not hard-code stock-specific branches into the primary UI.
- Do not reintroduce Auto Tone. Editing decisions should remain explicit and reversible.
- Preserve local-only processing. Do not add uploads, analytics, or network dependencies without explicit user direction.

## UI direction

- Very CLI like a terminal, but in a hacky kind of cool way.
- Keyboard shortcuts for every primary action.
- ASCII art is welcome when it remains accessible and responsive.
- Aim for beautiful, easy to use, and hacker-oriented.
- Center the UI and make it adapt cleanly at every supported window width.

## Architecture

- Backend: Rust via Tauri v2 (`src-tauri/`)
- Frontend: static HTML/CSS/JS/WGSL (`ui/`) — no Node.js or bundler required
- Native boundary: use Tauri v2 APIs or commands only when a capability genuinely requires the macOS shell; keep image processing local to the static frontend unless a native implementation is intentionally introduced.
- Configuration: `src-tauri/tauri.conf.json`

## Iconography

- Prefer SF Symbols for in-app iconography.
- Store symbol exports in `assets/symbols/` (typically SVG).
- Keep icon weights and sizes consistent within a screen.

## Build and packaging expectations

- `.app` bundles are created with `cargo tauri build` (wrapped by `scripts/build_macos_app.sh`).
- Icon generation pipeline:
  - `assets/icons/AppIcon-1024.png`
  - `cargo tauri icon` generates the platform icon set in `src-tauri/icons/`
  - the bundle embeds `Contents/Resources/icon.icns`
- If icon source is missing, fallback chain is:
  - `scripts/generate_default_icon.swift`
  - existing `src-tauri/icons/icon.png`

## Commands agents should run

```bash
./scripts/dev.sh
./scripts/check.sh
./scripts/build_macos_app.sh
./scripts/doctor.sh
```

## Change checklist

- Keep README/docs in sync with behavior.
- Keep scripts executable and cross-shell safe (`bash`, `set -euo pipefail`).
- Validate macOS packaging still works after refactors.
- Frontend changes go in `ui/`, backend changes go in `src-tauri/src/`.
- Preserve the interaction contracts in `.agents/interaction-contracts.md`.
- When changing film behavior, update `.agents/film-emulation.md`, stock schema documentation, and affected dossiers.
- Verify important UI behavior in the packaged macOS app, not only a browser or static syntax check.
