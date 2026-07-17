#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_PY="/Users/adammenges/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"

if [[ ! -x "$RUNTIME_PY" ]]; then
  RUNTIME_PY="$(command -v python3)"
fi

cd "$ROOT_DIR"
"$RUNTIME_PY" scripts/fetch_visual_fixtures.py
"$RUNTIME_PY" scripts/generate_visual_fixtures.py
"$RUNTIME_PY" scripts/extract_visual_captures.py
node scripts/test_grain_model.js
node scripts/measure_grain_response.js
"$RUNTIME_PY" scripts/build_visual_report.py

echo "visual report: $ROOT_DIR/artifacts/visual-tests/report/index.html"
