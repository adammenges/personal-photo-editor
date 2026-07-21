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

IMAGING_PY="${GRAINLAB_PYTHON:-}"
if [[ -z "$IMAGING_PY" ]]; then
  CODEX_PY="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
  if [[ -x "$CODEX_PY" ]]; then
    IMAGING_PY="$CODEX_PY"
  else
    IMAGING_PY="$(command -v python3 2>/dev/null || true)"
  fi
fi
if [[ -n "$IMAGING_PY" ]] && "$IMAGING_PY" -c 'import numpy, PIL' >/dev/null 2>&1; then
  echo "==> Testing learned film styles"
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=scripts "$IMAGING_PY" scripts/test_learn_film_style.py
else
  echo "==> Skipping learned film-style tests (Pillow and NumPy unavailable)"
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
