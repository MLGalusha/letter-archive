"""Small deterministic I/O and memory-safety helpers."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import psutil


SCHEMA_VERSION = "word-envelope-diagnostic.v2"
CROP_SCHEMA_VERSION = "word-envelope-crop.v1"
CLEANUP_SCHEMA_VERSION = "word-envelope-cleanup-operations.v1"
WARNING_RSS_BYTES = 300 * 1024 * 1024
STOP_RSS_BYTES = 450 * 1024 * 1024
_warned = False


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json_bytes(value))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_mask_pixels(mask: np.ndarray) -> str:
    binary = np.asarray(mask, dtype=bool)
    digest = hashlib.sha256()
    digest.update(f"{binary.shape[1]}x{binary.shape[0]}:row-major-bitpack-v1\n".encode())
    digest.update(np.packbits(binary, axis=None, bitorder="little").tobytes())
    return digest.hexdigest()


def sha256_image_pixels(image: Any) -> str:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    digest = hashlib.sha256()
    digest.update(f"RGB8:{rgb.shape[1]}:{rgb.shape[0]}:row-major-v1\n".encode())
    digest.update(rgb.tobytes(order="C"))
    return digest.hexdigest()


def check_rss(stage: str, *, reserve_bytes: int = 0) -> int:
    """Warn at 300 MiB and stop before work continues above 500 MiB."""

    global _warned
    rss = psutil.Process(os.getpid()).memory_info().rss
    projected = rss + max(0, int(reserve_bytes))
    if rss >= STOP_RSS_BYTES or projected >= STOP_RSS_BYTES:
        raise MemoryError(
            f"RSS is {rss / (1024 * 1024):.1f} MiB and reserved work projects "
            f"{projected / (1024 * 1024):.1f} MiB at {stage}; the POC stops "
            "before 450 MiB to remain safely below 500 MiB"
        )
    if projected >= WARNING_RSS_BYTES and not _warned:
        print(
            f"WARNING: RSS is {rss / (1024 * 1024):.1f} MiB and projected work "
            f"is {projected / (1024 * 1024):.1f} MiB at {stage}",
            file=sys.stderr,
        )
        _warned = True
    return rss
