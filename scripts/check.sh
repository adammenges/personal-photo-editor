#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUSTUP_BIN_DIR="$(dirname -- "$(command -v rustup 2>/dev/null || true)")"
if [[ -n "$RUSTUP_BIN_DIR" && -x "$RUSTUP_BIN_DIR/cargo" ]]; then
  export PATH="$RUSTUP_BIN_DIR:$PATH"
fi

echo "==> Checking shell syntax"
for script in scripts/*.sh; do
  bash -n "$script"
done

if command -v node >/dev/null 2>&1; then
  echo "==> Checking JavaScript syntax"
  for script in ui/*.js scripts/*.js; do
    node --check "$script"
  done
  echo "==> Checking emulsion grain model"
  node scripts/test_grain_model.js
fi

if command -v python3 >/dev/null 2>&1; then
  echo "==> Checking Python syntax"
  for script in scripts/*.py; do
    python3 -c 'import ast, pathlib, sys; path = pathlib.Path(sys.argv[1]); ast.parse(path.read_text(), filename=str(path))' "$script"
  done
fi

if [[ "${OSTYPE:-}" == darwin* ]] && command -v swift >/dev/null 2>&1; then
  echo "==> Checking Swift syntax"
  for script in scripts/*.swift; do
    swiftc -parse "$script"
  done
  echo "==> Checking app icon source"
  swift scripts/validate_app_icon.swift assets/icons/AppIcon-1024.png
fi

echo "==> Checking Rust formatting"
cargo fmt --all -- --check

echo "==> Running Clippy"
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings

echo "==> Running tests"
cargo test --workspace --all-features --locked
