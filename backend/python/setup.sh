#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

echo "=== Line Finder Setup (Google Cloud Vision) ==="

# Create virtual environment
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV_DIR"
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
echo "Google Cloud auth: ensure ADC is configured via:"
echo "  gcloud auth application-default login"
echo ""
echo "Test with: source venv/bin/activate && python line_finder.py path/to/image.jpg --json"
