#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POC_ROOT="$REPO_ROOT/experiments/word-envelope-shrink-wrap-poc"
VENV_ROOT="$REPO_ROOT/.venvs"
MODEL_ROOT="$REPO_ROOT/.model-cache"

export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_CACHE_DIR=1

choose_python_311() {
  local candidate
  for candidate in python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && \
      "$candidate" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 11))'; then
      command -v "$candidate"
      return 0
    fi
  done
  if command -v uv >/dev/null 2>&1; then
    uv python install 3.11
    uv python find 3.11
    return 0
  fi
  return 1
}

if ! BASE_PYTHON="$(choose_python_311)"; then
  echo "Python 3.11 is required for the frozen TensorFlow 2.12 runtime." >&2
  echo "Install Python 3.11 (or uv) in the cloud environment, then rerun this setup." >&2
  exit 2
fi
mkdir -p "$VENV_ROOT" "$MODEL_ROOT"

verify_sha256() {
  "$BASE_PYTHON" - "$1" "$2" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

path = Path(sys.argv[1])
expected = sys.argv[2]
digest = sha256()
with path.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
actual = digest.hexdigest()
if actual != expected:
    raise SystemExit(f"SHA-256 mismatch for {path}: expected {expected}, got {actual}")
print(f"verified {path}: {actual}")
PY
}

if [[ ! -x "$VENV_ROOT/word-ink/bin/python" ]]; then
  "$BASE_PYTHON" -m venv "$VENV_ROOT/word-ink"
fi
"$VENV_ROOT/word-ink/bin/python" -m pip install --upgrade pip
"$VENV_ROOT/word-ink/bin/python" -m pip install \
  -r "$POC_ROOT/requirements.txt" \
  -r "$POC_ROOT/requirements-v3.txt" \
  "opencv-python-headless>=4.10,<5"

# The frozen 2022 Eynollah/SBB checkpoint needs TensorFlow 2.12 and its older
# NumPy ABI, so it deliberately lives outside the NumPy-2 geometry environment.
if [[ ! -x "$VENV_ROOT/eynollah-2022/bin/python" ]]; then
  "$BASE_PYTHON" -m venv "$VENV_ROOT/eynollah-2022"
fi
"$VENV_ROOT/eynollah-2022/bin/python" -m pip install --upgrade pip
"$VENV_ROOT/eynollah-2022/bin/python" -m pip install \
  "numpy==1.23.5" \
  "tensorflow-cpu==2.12.0" \
  "opencv-python-headless==4.7.0.72" \
  "Pillow>=9,<10" \
  "scipy==1.10.1" \
  "scikit-image==0.20.0" \
  "huggingface-hub>=0.28,<1"

EYNOLLAH_MODEL="$MODEL_ROOT/sbb-binarization/saved_model/2022-08-16"
if [[ ! -f "$EYNOLLAH_MODEL/saved_model.pb" ]]; then
  "$VENV_ROOT/eynollah-2022/bin/python" - "$MODEL_ROOT/sbb-binarization" <<'PY'
from huggingface_hub import snapshot_download
from pathlib import Path
import sys

target = Path(sys.argv[1])
snapshot_download(
    repo_id="SBB/sbb_binarization",
    revision="cfdf4446f8e33b2c743a66bf7c1a4686515442ae",
    allow_patterns=["saved_model/2022-08-16/**"],
    local_dir=target,
)
PY
fi
verify_sha256 \
  "$EYNOLLAH_MODEL/saved_model.pb" \
  "63cfe676b63569e7cbebf05567448834945e9be9c35bcf3dbce59312ca0d1902"

# Kraken 7 embeds the exact blla.mlmodel used by the accepted page-012 run.
if [[ ! -x "$VENV_ROOT/kraken7/bin/python" ]]; then
  "$BASE_PYTHON" -m venv "$VENV_ROOT/kraken7"
fi
"$VENV_ROOT/kraken7/bin/python" -m pip install --upgrade pip
"$VENV_ROOT/kraken7/bin/python" -m pip install "kraken==7.0.3"

KRAKEN_MODEL="$("$VENV_ROOT/kraken7/bin/python" - <<'PY'
import kraken
from pathlib import Path
print(Path(kraken.__file__).with_name("blla.mlmodel"))
PY
)"
verify_sha256 \
  "$KRAKEN_MODEL" \
  "77a638a83c9e535620827a09e410ed36391e9e8e8126d5796a0f15b978186056"

"$VENV_ROOT/word-ink/bin/python" - <<'PY'
import cv2, numpy, PIL, scipy, skimage, shapely
print("word-ink runtime ready", numpy.__version__, cv2.__version__)
PY
"$VENV_ROOT/eynollah-2022/bin/python" - <<'PY'
import tensorflow as tf
print("Eynollah runtime ready", tf.__version__)
PY
"$VENV_ROOT/kraken7/bin/python" - <<'PY'
import kraken
from importlib.metadata import version
from pathlib import Path
model = Path(kraken.__file__).with_name("blla.mlmodel")
print("Kraken runtime ready", version("kraken"), model)
PY

printf 'Eynollah model: %s\n' "$EYNOLLAH_MODEL"
df -h "$REPO_ROOT" | tail -1
