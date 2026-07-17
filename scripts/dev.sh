#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Prefer Rustup's Cargo proxy over a separately installed Homebrew Cargo, which
# may not honor rust-toolchain.toml and can be older than the pinned toolchain.
RUSTUP_BIN_DIR="$(dirname -- "$(command -v rustup 2>/dev/null || true)")"
if [[ -n "$RUSTUP_BIN_DIR" && -x "$RUSTUP_BIN_DIR/cargo" ]]; then
  export PATH="$RUSTUP_BIN_DIR:$PATH"
fi

cargo tauri dev -- --locked
