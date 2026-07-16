#!/usr/bin/env bash
set -euo pipefail

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required. Install it from https://rustup.rs and rerun this script."
  exit 1
fi

rustup component add rustfmt clippy

# Install Tauri CLI if not present
if ! cargo tauri --version >/dev/null 2>&1; then
  echo "Installing Tauri CLI..."
  cargo install tauri-cli
fi

if [[ "${OSTYPE:-}" == darwin* ]]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode Command Line Tools are required. Run: xcode-select --install"
    exit 1
  fi

  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  echo "macOS toolchain targets installed."
else
  echo "Non-macOS host detected. Rust tooling is ready; macOS app packaging scripts require macOS."
fi

echo "Setup complete."
