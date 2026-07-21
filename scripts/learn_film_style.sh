#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGING_PY="${GRAINLAB_PYTHON:-}"

if [[ -z "$IMAGING_PY" ]]; then
  CODEX_PY="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
  if [[ -x "$CODEX_PY" ]]; then
    IMAGING_PY="$CODEX_PY"
  else
    IMAGING_PY="$(command -v python3)"
  fi
fi

if ! "$IMAGING_PY" -c 'import numpy, PIL' >/dev/null 2>&1; then
  echo "Film-style learning needs Python 3 with Pillow and NumPy." >&2
  echo "Set GRAINLAB_PYTHON to an environment that provides both packages." >&2
  exit 1
fi

cd "$ROOT_DIR"
exec "$IMAGING_PY" scripts/learn_film_style.py "$@"
