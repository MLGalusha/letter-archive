from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, __version__ as pillow_version

from .cohort import CohortPage
from .paths import PREPROCESSING_CONFIG_PATH, backend_relative
from .util import BenchmarkError, read_json, sha256_bytes, sha256_file


@dataclass(frozen=True)
class PreparedImage:
    sha256: str
    raster_sha256: str
    width: int
    height: int
    source_exif_orientation: int | None


RASTER_FINGERPRINT_ALGORITHM = "sha256-rgb8-v1"


def rgb8_raster_sha256(width: int, height: int, pixels: bytes) -> str:
    expected_size = width * height * 3
    if len(pixels) != expected_size:
        raise ValueError(
            f"Expected {expected_size} RGB8 bytes, received {len(pixels)}"
        )
    framing = f"rgb8:{width}x{height}\n".encode("ascii")
    return sha256_bytes(framing + pixels)


def fingerprint_prepared_png(
    path: Path,
    *,
    expected_width: int,
    expected_height: int,
) -> str:
    try:
        with Image.open(path) as image:
            image.load()
            if (
                image.mode != "RGB"
                or image.size != (expected_width, expected_height)
            ):
                raise ValueError(
                    "prepared raster is not the declared RGB coordinate space"
                )
            return rgb8_raster_sha256(
                expected_width,
                expected_height,
                image.tobytes(),
            )
    except Exception as exc:
        raise BenchmarkError(
            "comparison",
            "PREPARED_RASTER_DECODE_FAILED",
            f"Could not decode canonical prepared raster {path}: {exc}",
        ) from exc


def preprocessing_metadata() -> dict[str, Any]:
    config = read_json(PREPROCESSING_CONFIG_PATH)
    output = config["output"]
    return {
        "profileId": config["profileId"],
        "path": backend_relative(PREPROCESSING_CONFIG_PATH),
        "profileSha256": sha256_file(PREPROCESSING_CONFIG_PATH),
        "library": "Pillow",
        "libraryVersion": pillow_version,
        "exifPolicy": "transpose",
        "colorMode": config["pixels"]["colorMode"],
        "format": output["format"],
        "encoder": {
            "compressLevel": output["compressLevel"],
            "optimize": output["optimize"],
            "interlace": output["interlace"],
            "metadata": output["metadata"],
        },
    }


def prepare_page(page: CohortPage, output_path: Path) -> PreparedImage:
    if not page.source_path.is_file():
        raise BenchmarkError(
            "source-verification",
            "SOURCE_NOT_FOUND",
            f"Source image not found for {page.page_key}",
            {"sourcePath": page.source_path.as_posix()},
        )
    actual_source_sha = sha256_file(page.source_path)
    if actual_source_sha != page.checksum_sha256:
        raise BenchmarkError(
            "source-verification",
            "SOURCE_CHECKSUM_MISMATCH",
            f"Source checksum mismatch for {page.page_key}",
            {"expected": page.checksum_sha256, "actual": actual_source_sha},
        )

    try:
        with Image.open(page.source_path) as source:
            encoded_width, encoded_height = source.size
            if (encoded_width, encoded_height) != (page.width, page.height):
                raise BenchmarkError(
                    "source-verification",
                    "SOURCE_DIMENSIONS_MISMATCH",
                    f"Encoded dimensions mismatch for {page.page_key}",
                    {
                        "expected": {"width": page.width, "height": page.height},
                        "actual": {
                            "width": encoded_width,
                            "height": encoded_height,
                        },
                    },
                )
            orientation_value = source.getexif().get(274)
            orientation = (
                int(orientation_value) if isinstance(orientation_value, int) else None
            )
            transposed = ImageOps.exif_transpose(source)
            rgb = transposed.convert("RGB")
            # Rebuild from pixels to guarantee that source EXIF/ICC/text chunks do
            # not leak into the canonical prepared input.
            stripped = Image.frombytes("RGB", rgb.size, rgb.tobytes())
            raster_sha256 = rgb8_raster_sha256(
                stripped.width,
                stripped.height,
                stripped.tobytes(),
            )
    except BenchmarkError:
        raise
    except Exception as exc:
        raise BenchmarkError(
            "preprocessing",
            "IMAGE_DECODE_FAILED",
            f"Could not decode {page.page_key}: {exc}",
        ) from exc

    buffer = io.BytesIO()
    stripped.save(
        buffer,
        format="PNG",
        compress_level=9,
        optimize=False,
        interlace=False,
    )
    prepared_bytes = buffer.getvalue()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(prepared_bytes)
    actual_written_sha = sha256_file(output_path)
    expected_sha = sha256_bytes(prepared_bytes)
    if actual_written_sha != expected_sha:
        raise BenchmarkError(
            "preprocessing",
            "PREPARED_WRITE_MISMATCH",
            f"Prepared input checksum changed while writing {page.page_key}",
        )
    with Image.open(output_path) as check:
        if check.mode != "RGB" or check.size != stripped.size:
            raise BenchmarkError(
                "preprocessing",
                "PREPARED_VERIFY_FAILED",
                f"Prepared input verification failed for {page.page_key}",
            )
    return PreparedImage(
        sha256=expected_sha,
        raster_sha256=raster_sha256,
        width=stripped.width,
        height=stripped.height,
        source_exif_orientation=orientation,
    )
