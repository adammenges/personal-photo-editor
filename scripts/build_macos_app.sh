#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This script builds a macOS .app bundle and must run on macOS."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required."
  exit 1
fi

# Tauri CLI handles building, bundling, icon generation, and code signing.
# Configure the product name and bundle identifier in src-tauri/tauri.conf.json.

DIST_DIR="${DIST_DIR:-dist}"

cargo tauri build

mkdir -p "$DIST_DIR"

APP_BUNDLE="$(find src-tauri/target/release/bundle/macos -name "*.app" -maxdepth 1 2>/dev/null | head -n 1)"
if [[ -n "$APP_BUNDLE" ]]; then
  rm -rf "$DIST_DIR/$(basename "$APP_BUNDLE")"
  cp -R "$APP_BUNDLE" "$DIST_DIR/"
  echo "Built macOS app bundle at $DIST_DIR/$(basename "$APP_BUNDLE")"
else
  echo "Build completed but .app bundle not found. Check src-tauri/target/release/bundle/"
fi
