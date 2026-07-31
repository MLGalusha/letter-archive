#!/usr/bin/env python3
"""Normalize one source image into the application's canonical raster space."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image
from line_finder import normalize_orientation_with_metadata


def exclusive_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid4()}")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise FileExistsError(
                f"Refusing to overwrite normalized raster: {path}",
            ) from error
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply canonical EXIF orientation and emit RGB PNG bytes",
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    source = args.input.resolve(strict=True)
    output = args.output.resolve()
    source_bytes = source.read_bytes()
    normalized, metadata = normalize_orientation_with_metadata(source_bytes)
    exclusive_write(output, normalized)
    with Image.open(io.BytesIO(normalized)) as opened:
        raster = opened.convert("RGB")
        raster.load()
    framing = f"rgb8:{raster.width}x{raster.height}\n".encode("ascii")
    print(json.dumps({
        **metadata,
        "sourceChecksumSha256": hashlib.sha256(source_bytes).hexdigest(),
        "rasterEncodedChecksumSha256":
            hashlib.sha256(normalized).hexdigest(),
        "rasterChecksumAlgorithm": "sha256-rgb8-v1",
        "rasterChecksumSha256":
            hashlib.sha256(framing + raster.tobytes()).hexdigest(),
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
