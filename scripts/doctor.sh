#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUSTUP_BIN_DIR="$(dirname -- "$(command -v rustup 2>/dev/null || true)")"
if [[ -n "$RUSTUP_BIN_DIR" && -x "$RUSTUP_BIN_DIR/cargo" ]]; then
  export PATH="$RUSTUP_BIN_DIR:$PATH"
fi

status=0

check_command() {
  local command="$1"
  if command -v "$command" >/dev/null 2>&1; then
    printf 'ok    %-14s %s\n' "$command" "$(command -v "$command")"
  else
    printf 'miss  %-14s required\n' "$command"
    status=1
  fi
}

check_command cargo
check_command rustc
check_command rustup

if [[ "${OSTYPE:-}" == darwin* ]]; then
  check_command xcode-select
  if xcode-select -p >/dev/null 2>&1; then
    printf 'ok    %-14s %s\n' "xcode tools" "$(xcode-select -p)"
  else
    printf 'miss  %-14s run: xcode-select --install\n' "xcode tools"
    status=1
  fi
fi

if cargo tauri --version >/dev/null 2>&1; then
  printf 'ok    %-14s %s\n' "tauri" "$(cargo tauri --version)"
else
  printf 'miss  %-14s run: ./scripts/setup.sh\n' "tauri"
  status=1
fi

if cargo metadata --locked --no-deps --format-version 1 >/dev/null 2>&1; then
  printf 'ok    %-14s valid and locked\n' "workspace"
else
  printf 'fail  %-14s metadata or Cargo.lock is stale\n' "workspace"
  status=1
fi

exit "$status"
