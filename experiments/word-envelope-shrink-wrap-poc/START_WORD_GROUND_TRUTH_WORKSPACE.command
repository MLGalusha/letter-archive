#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PYTHON_BIN="$SCRIPT_DIR/../../../letter-archive/backend/python/venv/bin/python"

cd "$SCRIPT_DIR"
open "http://127.0.0.1:8770"
exec "$PYTHON_BIN" scripts/simple_page_selector.py serve-library
