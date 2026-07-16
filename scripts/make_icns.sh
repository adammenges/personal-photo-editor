#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "Icon conversion to .icns requires macOS (sips + iconutil)."
  exit 1
fi

SOURCE_ICON="${1:-assets/icons/AppIcon-1024.png}"
OUTPUT_ICNS="${2:-assets/icons/AppIcon.icns}"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Missing source icon: $SOURCE_ICON"
  echo "Place a 1024x1024 PNG at assets/icons/AppIcon-1024.png or provide a custom path."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
ICONSET_DIR="$TMP_DIR/AppIcon.iconset"
mkdir -p "$ICONSET_DIR"

for size in 16 32 128 256 512; do
  retina_size=$((size * 2))
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  sips -z "$retina_size" "$retina_size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

mkdir -p "$(dirname "$OUTPUT_ICNS")"
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"
rm -rf "$TMP_DIR"

echo "Generated $OUTPUT_ICNS"
