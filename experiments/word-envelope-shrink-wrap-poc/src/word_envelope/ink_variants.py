"""Build hash-bound clean and high-recall ink variants for agent selection."""

from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import tempfile
from typing import Any

import numpy as np
from PIL import Image

from .engine import EnvelopeError
from .io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from .masks import save_mask


SCHEMA_VERSION = "agent-ink-variant-bundle.v1"


def _load_binary(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    if not path.is_file() or path.is_symlink():
        raise EnvelopeError(f"Ink variant input is missing or unsafe: {path}")
    with Image.open(path) as image:
        values = np.asarray(image.convert("L"), dtype=np.uint8)
    if values.shape != (size_wh[1], size_wh[0]):
        raise EnvelopeError("Ink variant dimensions do not match the source")
    if not set(int(value) for value in np.unique(values)).issubset({0, 255}):
        raise EnvelopeError("Ink variant inputs must be exact binary masks")
    return values > 0


def _manifest_hash(value: dict[str, Any]) -> str:
    basis = dict(value)
    basis.pop("manifest_sha256", None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def build_high_recall_union(
    *,
    source_path: Path,
    clean_mask_path: Path,
    possible_ink_mask_path: Path,
    output_dir: Path,
    research_reference: str,
) -> dict[str, Any]:
    """Publish a strict clean-superset while preserving both source masks.

    The possible-ink input is never promoted as truth.  The union is a claim
    universe that the agent must still select from; noise remains visible and
    selectable rather than being silently deleted.
    """

    source_path = Path(source_path).resolve()
    clean_mask_path = Path(clean_mask_path).resolve()
    possible_ink_mask_path = Path(possible_ink_mask_path).resolve()
    output_dir = Path(output_dir).resolve()
    if output_dir.exists() or output_dir.is_symlink():
        raise EnvelopeError(f"Ink variant output already exists: {output_dir}")
    if not source_path.is_file() or source_path.is_symlink():
        raise EnvelopeError("Bound source is missing or unsafe")
    with Image.open(source_path) as source:
        size_wh = tuple(source.size)
    clean = _load_binary(clean_mask_path, size_wh)
    possible = _load_binary(possible_ink_mask_path, size_wh)
    strong = clean | possible
    if not np.any(strong & ~clean):
        raise EnvelopeError("Possible-ink input adds no high-recall evidence")

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output_dir.name}.build-", dir=output_dir.parent)
    )
    try:
        clean_out = temporary / "clean.mask.png"
        strong_out = temporary / "strong.mask.png"
        additions_out = temporary / "strong-additions.mask.png"
        save_mask(clean_out, clean)
        save_mask(strong_out, strong)
        save_mask(additions_out, strong & ~clean)
        manifest: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "source": {
                "path": str(source_path),
                "file_sha256": sha256_file(source_path),
                "size_wh": list(size_wh),
            },
            "inputs": {
                "clean": {
                    "path": str(clean_mask_path),
                    "file_sha256": sha256_file(clean_mask_path),
                    "pixel_sha256": sha256_mask_pixels(clean),
                    "pixels": int(clean.sum()),
                },
                "possible_ink": {
                    "path": str(possible_ink_mask_path),
                    "file_sha256": sha256_file(possible_ink_mask_path),
                    "pixel_sha256": sha256_mask_pixels(possible),
                    "pixels": int(possible.sum()),
                    "semantic_status": "high_recall_possible_ink_not_pixel_truth",
                    "research_reference": research_reference,
                },
            },
            "outputs": {
                "clean": {
                    "path": "clean.mask.png",
                    "file_sha256": sha256_file(clean_out),
                    "pixel_sha256": sha256_mask_pixels(clean),
                    "pixels": int(clean.sum()),
                },
                "strong": {
                    "path": "strong.mask.png",
                    "file_sha256": sha256_file(strong_out),
                    "pixel_sha256": sha256_mask_pixels(strong),
                    "pixels": int(strong.sum()),
                },
                "strong_additions": {
                    "path": "strong-additions.mask.png",
                    "file_sha256": sha256_file(additions_out),
                    "pixel_sha256": sha256_mask_pixels(strong & ~clean),
                    "pixels": int(np.count_nonzero(strong & ~clean)),
                },
            },
            "invariants": {
                "clean_is_exact_subset_of_strong": bool(np.all(~clean | strong)),
                "strong_equals_clean_union_possible_ink": bool(
                    np.array_equal(strong, clean | possible)
                ),
                "coordinate_transform": "identity_source_pixels",
                "claim_policy": "agent_selects_exact_word_ink_from_visible_high_recall_universe",
            },
        }
        manifest["manifest_sha256"] = _manifest_hash(manifest)
        manifest_path = temporary / "manifest.json"
        with manifest_path.open("xb") as handle:
            handle.write(canonical_json_bytes(manifest) + b"\n")
        temporary.rename(output_dir)
        return manifest
    except BaseException:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)
        raise

