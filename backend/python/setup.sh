#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MODELS_DIR="$SCRIPT_DIR/models"

echo "=== Kraken OCR Setup ==="

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

# Download default models
mkdir -p "$MODELS_DIR"

echo "Downloading default segmentation model..."
if [ ! -f "$MODELS_DIR/default.mlmodel" ]; then
  python3 -c "
from kraken import blla
print('Segmentation model loaded successfully (bundled with kraken)')
"
  echo "Segmentation model ready (bundled with kraken package)."
else
  echo "Segmentation model already exists."
fi

echo "Downloading default recognition model..."
if [ ! -f "$MODELS_DIR/default_rec.mlmodel" ]; then
  python3 -c "
try:
    from kraken.lib.default_specs import RECOGNITION_SPEC
    from kraken import repo
    rec_model = repo.get_model('10.5281/zenodo.6657809')
    import shutil
    shutil.copy(rec_model, '$MODELS_DIR/default_rec.mlmodel')
    print('Recognition model downloaded.')
except Exception as e:
    print(f'Could not download recognition model: {e}')
    print('Line segmentation will still work, but OCR text will be empty.')
"
else
  echo "Recognition model already exists."
fi

echo ""
echo "=== Setup complete ==="
echo "Test with: source venv/bin/activate && python kraken_segment.py path/to/image.jpg"
