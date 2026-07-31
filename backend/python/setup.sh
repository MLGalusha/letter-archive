#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

select_python() {
  local candidates=(
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
REBUILD="${1:-}"

if [ -z "${PYTHON_BIN:-}" ]; then
  echo "No suitable Python interpreter found. Install Python 3.12 and retry."
  exit 1
fi

PYTHON_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "$PYTHON_VERSION" in
  3.12) ;;
  *)
    echo "This pinned Kraken runtime requires Python 3.12; found Python $PYTHON_VERSION."
    exit 1
    ;;
esac

echo "=== Line Finder Setup (Kraken) ==="
echo "Using Python interpreter: $PYTHON_BIN"

# Create a clean virtual environment on request. This is useful when upgrading
# an older local environment that contains unrelated OCR packages.
if [ "$REBUILD" = "--rebuild" ]; then
  echo "Rebuilding Python virtual environment..."
  "$PYTHON_BIN" -m venv --clear "$VENV_DIR"
elif [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists."
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# Install dependencies
echo "Installing dependencies..."
python -m pip install --quiet --upgrade pip
python -m pip install \
  --quiet \
  --constraint "$SCRIPT_DIR/constraints-runtime.txt" \
  --requirement "$SCRIPT_DIR/requirements.txt"
python -m pip check

python - <<'PY'
from importlib.metadata import version

packages = ("kraken", "torch", "torchvision", "Pillow", "numpy")
print("Runtime:", ", ".join(f"{name}={version(name)}" for name in packages))
PY

echo ""
echo "=== Setup complete ==="
echo ""
echo "Test native output with: source venv/bin/activate && python line_finder.py path/to/image.jpg --native-json"
echo "The remote CLI uses --worker-native-json so Kraken is loaded once per run."
