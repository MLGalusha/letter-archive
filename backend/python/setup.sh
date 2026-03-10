#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

select_python() {
  local candidates=(
    python3.10
    python3.11
    python3.12
    python3
  )

  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

PYTHON_BIN="$(select_python)"

if [ -z "${PYTHON_BIN:-}" ]; then
  echo "No suitable Python interpreter found. Install Python 3.10+ and retry."
  exit 1
fi

echo "=== Line Finder Setup (Kraken) ==="
echo "Using Python interpreter: $PYTHON_BIN"

# Create virtual environment
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists."
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# Install dependencies
echo "Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Test with: source venv/bin/activate && python line_finder.py path/to/image.jpg --json"
