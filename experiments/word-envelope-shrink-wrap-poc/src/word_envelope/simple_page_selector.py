"""Minimal full-page word selection experiment.

The protocol deliberately removes transcript, proposal, and per-word annotation
work.  One action selects exactly one word from a high-recall ink page; software
fits its envelope, marks the selected source ink claimed, and returns the same
page for the next selection.
"""

from __future__ import annotations

import base64
import fcntl
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from io import BytesIO
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import weakref
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from skimage import color, filters

from .engine import EnvelopeParams, EnvelopeError, polygon_checksum
from .fragmented_envelope import (
    fit_fragmented_envelope,
    refine_existing_envelope,
)
from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from .local_ink_recovery import recover_local_ink_candidates
from .pipeline_source_catalog import (
    CatalogRevisionConflictError,
    PipelineSourceCatalog,
    PipelineSourceError,
)


MANIFEST_SCHEMA = "simple-page-selector-manifest.v1"
STATE_SCHEMA = "simple-page-selector-state.v1"
ACTION_SCHEMA = "simple-page-selector-action.v1"
INK_LAYERS_SCHEMA = "simple-page-selector-ink-layers.v1"
UI_VERSION = "simple-page-selector.v2"
MAX_RECTS = 32
MAX_NOTES = 20
MAX_NOTE_CHARS = 2_000
PREVIEW_LONG_EDGE = 1_200
MAX_UPLOADED_IMAGE_BYTES = 25_000_000
MAX_UPLOADED_IMAGE_PIXELS = 16_000_000
MAX_UPLOADED_IMAGE_EDGE = 6_000
LIBRARY_SCHEMA = "simple-selector-library.v1"


def _hash_record(value: Mapping[str, Any], hash_key: str) -> str:
    basis = dict(value)
    basis.pop(hash_key, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def _write_json_new(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(canonical_json_bytes(dict(value)) + b"\n")
        handle.flush()
        os.fsync(handle.fileno())


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink():
        raise ConsoleError("integrity_error", "A selector record is missing or unsafe", status=500)
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ConsoleError("integrity_error", "A selector record is unreadable", status=500) from error
    if not isinstance(value, dict):
        raise ConsoleError("integrity_error", "A selector record has the wrong shape", status=500)
    return value


def _load_binary(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    if not path.is_file() or path.is_symlink():
        raise ConsoleError("integrity_error", "A bound ink mask is missing or unsafe", status=500)
    with Image.open(path) as image:
        values = np.asarray(image.convert("L"), dtype=np.uint8)
    if values.shape != (size_wh[1], size_wh[0]):
        raise ConsoleError("integrity_error", "A bound ink mask has the wrong dimensions", status=500)
    if not set(int(item) for item in np.unique(values)).issubset({0, 255}):
        raise ConsoleError("integrity_error", "The strong ink mask is not exact binary evidence", status=500)
    return values > 0


def _save_binary(path: Path, mask: np.ndarray) -> None:
    Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L").save(path, format="PNG")


def _preview_size(size_wh: tuple[int, int]) -> tuple[int, int]:
    width, height = size_wh
    scale = min(1.0, PREVIEW_LONG_EDGE / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def _remove_small_components(mask: np.ndarray, minimum_area: int) -> np.ndarray:
    labels, count = ndimage.label(
        np.asarray(mask, dtype=bool),
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    if not count:
        return np.zeros_like(mask, dtype=bool)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= minimum_area
    keep[0] = False
    return keep[labels]


def derive_uploaded_dual_ink(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Build conservative and higher-recall source-derived selectable ink."""

    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = np.asarray(image.convert("L"), dtype=np.float32) / np.float32(255.0)
    minimum_edge = min(gray.shape)
    window = min(61, max(21, (minimum_edge // 45) | 1))
    if window % 2 == 0:
        window += 1
    adaptive = filters.threshold_sauvola(gray, window_size=window, k=0.16)
    sigma = max(3.0, min(14.0, minimum_edge / 180.0))
    background_gray = _fast_local_background(gray)
    darkness = np.maximum(background_gray - gray, 0.0)
    channel_spread = (
        rgb.max(axis=2).astype(np.float32) - rgb.min(axis=2).astype(np.float32)
    ) / np.float32(255.0)
    colour_residual = np.maximum(
        channel_spread - ndimage.gaussian_filter(channel_spread, sigma=sigma),
        0.0,
    )
    clean = (
        ((gray < adaptive - 0.008) & (darkness >= 0.010))
        | ((colour_residual >= 0.050) & (gray < 0.90))
    )
    high_recall = (
        ((gray < adaptive + 0.010) & (darkness >= 0.003))
        | ((colour_residual >= 0.024) & (gray < 0.95))
    )
    clean = _remove_small_components(clean, 3)
    high_recall = _remove_small_components(high_recall | clean, 2) | clean
    if not np.any(clean):
        raise ConsoleError(
            "image_has_no_usable_ink",
            "The image did not produce usable selectable ink",
        )
    if not np.any(high_recall & ~clean):
        high_recall = ndimage.binary_dilation(clean, iterations=1)
    support = _derive_source_paper_support(image)
    clean &= support
    high_recall &= support
    if not np.any(clean) or not np.any(high_recall & ~clean):
        raise ConsoleError(
            "image_has_no_usable_ink",
            "The page did not produce distinct clean and high-recall selectable ink",
        )
    return clean, high_recall


def _fast_local_background(gray: np.ndarray) -> np.ndarray:
    """Upper-paper estimate on a quarter-scale grid, projected without seams."""

    height, width = gray.shape
    coarse_wh = (max(1, width // 4), max(1, height // 4))
    coarse = np.asarray(
        Image.fromarray(
            np.clip(gray * 255.0, 0, 255).astype(np.uint8),
            mode="L",
        ).resize(coarse_wh, Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / np.float32(255.0)
    upper = ndimage.percentile_filter(
        coarse,
        percentile=82,
        size=15,
        mode="nearest",
    )
    upper = ndimage.gaussian_filter(upper, sigma=1.2, mode="nearest")
    return np.asarray(
        Image.fromarray(
            np.clip(upper * 65535.0, 0, 65535).astype(np.uint16),
        ).resize((width, height), Image.Resampling.BILINEAR),
        dtype=np.float32,
    ) / np.float32(65535.0)


def _derive_source_paper_support(source: Image.Image) -> np.ndarray:
    """Suppress photographed table/surround without using text geometry."""

    shortest_side = min(source.size)
    blur_radius = max(8, round(shortest_side * 0.0125))
    smoothed = np.asarray(
        source.convert("RGB").filter(ImageFilter.GaussianBlur(radius=blur_radius)),
        dtype=np.int16,
    )
    chroma = smoothed.max(axis=2) - smoothed.min(axis=2)
    lightness = smoothed.mean(axis=2)
    if int(chroma.max()) == int(chroma.min()) and float(lightness.max()) == float(lightness.min()):
        return np.ones(lightness.shape, dtype=bool)
    chroma_threshold = max(
        float(filters.threshold_otsu(chroma)),
        float(np.median(chroma)),
    )
    lightness_threshold = float(filters.threshold_otsu(lightness))
    seed = (chroma <= chroma_threshold) & (lightness >= lightness_threshold)
    labels, count = ndimage.label(
        seed,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    if not count:
        return np.ones(lightness.shape, dtype=bool)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    page_label = int(np.argmax(sizes))
    if not sizes[page_label]:
        return np.ones(lightness.shape, dtype=bool)
    filled = ndimage.binary_fill_holes(labels == page_label)
    support = ndimage.binary_dilation(filled, iterations=2)
    if float(support.mean()) < 0.35:
        return np.ones(lightness.shape, dtype=bool)
    return support


def _render_revision_assets(
    revision_dir: Path,
    *,
    strong: np.ndarray,
    claimed: np.ndarray,
    cut: np.ndarray,
    preview_wh: tuple[int, int],
    render_available: bool = True,
) -> dict[str, dict[str, Any]]:
    revision_dir.mkdir(parents=True, exist_ok=False)
    claimed_path = revision_dir / "claimed.mask.png"
    _save_binary(claimed_path, claimed)
    cut_path = revision_dir / "cut.mask.png"
    _save_binary(cut_path, cut)
    resample = Image.Resampling.NEAREST
    claimed_preview = Image.fromarray(np.where(claimed, 255, 0).astype(np.uint8), mode="L").resize(preview_wh, resample)
    claimed_rgba = np.zeros((preview_wh[1], preview_wh[0], 4), dtype=np.uint8)
    claimed_values = np.asarray(claimed_preview) > 0
    claimed_rgba[claimed_values] = (211, 47, 47, 220)
    claimed_overlay_path = revision_dir / "claimed.overlay.png"
    Image.fromarray(claimed_rgba, mode="RGBA").save(claimed_overlay_path, format="PNG")
    cut_preview = Image.fromarray(
        np.where(cut, 255, 0).astype(np.uint8),
        mode="L",
    ).resize(preview_wh, resample)
    cut_rgba = np.zeros((preview_wh[1], preview_wh[0], 4), dtype=np.uint8)
    cut_values = np.asarray(cut_preview) > 0
    cut_rgba[cut_values] = (245, 151, 45, 210)
    cut_overlay_path = revision_dir / "cut.overlay.png"
    Image.fromarray(cut_rgba, mode="RGBA").save(cut_overlay_path, format="PNG")

    assets = {
        "claimed_mask": {
            "path": str(claimed_path.relative_to(revision_dir.parent.parent)),
            "file_sha256": sha256_file(claimed_path),
            "pixel_sha256": sha256_mask_pixels(claimed),
            "pixels": int(claimed.sum()),
        },
        "claimed_overlay": {
            "path": str(claimed_overlay_path.relative_to(revision_dir.parent.parent)),
            "file_sha256": sha256_file(claimed_overlay_path),
        },
        "cut_mask": {
            "path": str(cut_path.relative_to(revision_dir.parent.parent)),
            "file_sha256": sha256_file(cut_path),
            "pixel_sha256": sha256_mask_pixels(cut),
            "pixels": int(cut.sum()),
        },
        "cut_overlay": {
            "path": str(cut_overlay_path.relative_to(revision_dir.parent.parent)),
            "file_sha256": sha256_file(cut_overlay_path),
        },
    }
    if render_available:
        available = strong & ~claimed & ~cut
        available_preview = Image.fromarray(np.where(available, 0, 255).astype(np.uint8), mode="L").resize(preview_wh, resample)
        available_path = revision_dir / "available.preview.png"
        available_preview.save(available_path, format="PNG")
        assets["available_preview"] = {
            "path": str(available_path.relative_to(revision_dir.parent.parent)),
            "file_sha256": sha256_file(available_path),
        }
    return assets


def install_dual_ink_layers(
    session_dir: Path | str,
    *,
    clean_mask_path: Path | str,
    high_recall_mask_path: Path | str,
) -> dict[str, Any]:
    """Append a bound clean/high-recall selector pair to an existing session.

    The original manifest and every prior revision remain byte-for-byte intact.
    Publishing the sidecar last makes the capability switch atomic: incomplete
    layer files are never treated as active selector evidence.
    """

    session_dir = Path(session_dir).resolve()
    clean_mask_path = Path(clean_mask_path).resolve()
    high_recall_mask_path = Path(high_recall_mask_path).resolve()
    manifest = _read_json(session_dir / "manifest.json")
    if (
        manifest.get("schema_version") != MANIFEST_SCHEMA
        or manifest.get("manifest_sha256")
        != _hash_record(manifest, "manifest_sha256")
    ):
        raise ConsoleError(
            "integrity_error",
            "The selector manifest failed validation",
            status=500,
        )
    sidecar_path = session_dir / "ink-layers.json"
    if sidecar_path.exists() or sidecar_path.is_symlink():
        raise ConsoleError(
            "ink_layers_exist",
            "This selector already has bound clean and high-recall ink layers",
        )
    size_wh = tuple(int(value) for value in manifest["source"]["size_wh"])
    preview_wh = tuple(
        int(value) for value in manifest["source"]["preview_size_wh"]
    )
    clean = _load_binary(clean_mask_path, size_wh)
    high_recall = _load_binary(high_recall_mask_path, size_wh)
    if np.any(clean & ~high_recall):
        raise ConsoleError(
            "invalid_ink_layers",
            "Clean ink must be an exact subset of high-recall ink",
        )
    if not np.any(high_recall & ~clean):
        raise ConsoleError(
            "invalid_ink_layers",
            "High-recall ink must add visible evidence beyond clean ink",
        )

    lock_path = session_dir / ".selector.lock"
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, 0o600)
    created: list[Path] = []
    try:
        with os.fdopen(descriptor, "a+b") as lock_handle:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            if sidecar_path.exists() or sidecar_path.is_symlink():
                raise ConsoleError(
                    "ink_layers_exist",
                    "This selector already has bound clean and high-recall ink layers",
                )
            source_dir = session_dir / "source"
            layer_records: dict[str, dict[str, Any]] = {}
            for name, mask, source_path, description in (
                (
                    "clean",
                    clean,
                    clean_mask_path,
                    "v4_likely_handwriting_lower_noise_source_ink",
                ),
                (
                    "high_recall",
                    high_recall,
                    high_recall_mask_path,
                    "v4_likely_plus_uncertain_source_ink",
                ),
            ):
                mask_out = source_dir / f"{name}.selection.mask.png"
                preview_out = source_dir / f"{name}.selection.preview.png"
                if mask_out.exists() or preview_out.exists():
                    raise ConsoleError(
                        "ink_layers_exist",
                        "A selector ink-layer asset already exists",
                    )
                _save_binary(mask_out, mask)
                created.append(mask_out)
                preview = Image.fromarray(
                    np.where(mask, 0, 255).astype(np.uint8),
                    mode="L",
                ).resize(preview_wh, Image.Resampling.NEAREST)
                preview.save(preview_out, format="PNG")
                created.append(preview_out)
                layer_records[name] = {
                    "description": description,
                    "input_path": str(source_path),
                    "input_file_sha256": sha256_file(source_path),
                    "mask_path": str(mask_out.relative_to(session_dir)),
                    "mask_file_sha256": sha256_file(mask_out),
                    "mask_pixel_sha256": sha256_mask_pixels(mask),
                    "pixels": int(mask.sum()),
                    "preview_path": str(preview_out.relative_to(session_dir)),
                    "preview_file_sha256": sha256_file(preview_out),
                }
            record: dict[str, Any] = {
                "schema_version": INK_LAYERS_SCHEMA,
                "bound_manifest_sha256": manifest["manifest_sha256"],
                "source_working_file_sha256": manifest["source"][
                    "working_file_sha256"
                ],
                "source_size_wh": list(size_wh),
                "default_layer": "clean",
                "layers": layer_records,
                "invariants": {
                    "clean_is_exact_subset_of_high_recall": True,
                    "high_recall_additional_pixels": int(
                        np.count_nonzero(high_recall & ~clean)
                    ),
                    "selection_uses_one_exact_layer_per_word": True,
                },
            }
            record["ink_layers_sha256"] = _hash_record(
                record,
                "ink_layers_sha256",
            )
            _write_json_new(sidecar_path, record)
            return record
    except BaseException:
        if not sidecar_path.exists():
            for path in created:
                path.unlink(missing_ok=True)
        raise


def initialize_simple_selector(
    session_dir: Path | str,
    *,
    page_id: str,
    source_path: Path | str,
    strong_mask_path: Path | str,
    selection_mode: str = "visible_ink_components",
) -> dict[str, Any]:
    session_dir = Path(session_dir).resolve()
    source_path = Path(source_path).resolve()
    strong_mask_path = Path(strong_mask_path).resolve()
    if selection_mode not in {"visible_ink_components", "source_color_guided"}:
        raise ConsoleError("invalid_source", "The selector mode is unsupported")
    if session_dir.exists() or session_dir.is_symlink():
        raise ConsoleError("session_exists", "The simple selector session already exists")
    if not source_path.is_file() or source_path.is_symlink():
        raise ConsoleError("invalid_source", "The selected source image is missing or unsafe")
    with Image.open(source_path) as source:
        source.load()
        working = source.convert("RGB")
        size_wh = tuple(working.size)
    strong = _load_binary(strong_mask_path, size_wh)
    if not np.any(strong):
        raise ConsoleError("invalid_source", "The strong ink mask is empty")

    parent = session_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{session_dir.name}.build-", dir=parent))
    try:
        source_dir = temporary / "source"
        source_dir.mkdir()
        working_path = source_dir / "working.png"
        working.save(working_path, format="PNG")
        strong_path = source_dir / "strong.mask.png"
        _save_binary(strong_path, strong)
        preview_wh = _preview_size(size_wh)
        original_preview_path = source_dir / "original.preview.jpg"
        working.resize(preview_wh, Image.Resampling.LANCZOS).save(
            original_preview_path, format="JPEG", quality=91, optimize=True
        )
        strong_preview_path = source_dir / "strong.preview.png"
        Image.fromarray(np.where(strong, 0, 255).astype(np.uint8), mode="L").resize(
            preview_wh, Image.Resampling.NEAREST
        ).save(strong_preview_path, format="PNG")

        manifest: dict[str, Any] = {
            "schema_version": MANIFEST_SCHEMA,
            "page_id": page_id,
            "source": {
                "input_path": str(source_path),
                "input_file_sha256": sha256_file(source_path),
                "working_path": "source/working.png",
                "working_file_sha256": sha256_file(working_path),
                "size_wh": list(size_wh),
                "preview_path": "source/original.preview.jpg",
                "preview_file_sha256": sha256_file(original_preview_path),
                "preview_size_wh": list(preview_wh),
            },
            "strong_ink": {
                "input_path": str(strong_mask_path),
                "input_file_sha256": sha256_file(strong_mask_path),
                "path": "source/strong.mask.png",
                "file_sha256": sha256_file(strong_path),
                "pixel_sha256": sha256_mask_pixels(strong),
                "pixels": int(strong.sum()),
                "preview_path": "source/strong.preview.png",
                "preview_file_sha256": sha256_file(strong_preview_path),
                "semantic_status": "high_recall_possible_ink_not_pixel_truth",
            },
            "protocol": {
                "one_action": "select_one_word_then_commit",
                "selection_input": "one_or_more_source_coordinate_rectangles",
                "selection_mode": selection_mode,
                "visible_selection_surface": (
                    "original_source_image_only"
                    if selection_mode == "source_color_guided"
                    else "strong_ink_with_original_context"
                ),
                "hidden_seed_role": (
                    "location_seed_for_local_source_color_and_brightness_growth"
                    if selection_mode == "source_color_guided"
                    else "visible_selectable_component_universe"
                ),
                "word_order": "reviewer_or_agent_chosen",
                "cut_semantics": "persistent_page_coordinate_barrier_independent_of_detected_ink",
                "per_word_annotations": False,
                "page_notes": "once_after_finish",
                "boxes_default_visible": False,
            },
        }
        manifest["manifest_sha256"] = _hash_record(manifest, "manifest_sha256")
        _write_json_new(temporary / "manifest.json", manifest)

        empty = np.zeros_like(strong)
        assets = _render_revision_assets(
            temporary / "revisions" / "r000000",
            strong=strong,
            claimed=empty,
            cut=empty,
            preview_wh=preview_wh,
            render_available=selection_mode != "source_color_guided",
        )
        state: dict[str, Any] = {
            "schema_version": STATE_SCHEMA,
            "revision": 0,
            "status": "selecting_words",
            "page_id": page_id,
            "word_count": 0,
            "claimed_pixels": 0,
            "words": [],
            "assets": assets,
            "page_notes": None,
            "previous_state_sha256": None,
        }
        state["state_sha256"] = _hash_record(state, "state_sha256")
        _write_json_new(temporary / "revisions" / "r000000" / "state.json", state)
        _write_json_new(
            temporary / "head.json",
            {"revision": 0, "state_sha256": state["state_sha256"]},
        )
        (temporary / ".selector.lock").touch(mode=0o600, exist_ok=False)
        temporary.rename(session_dir)
        return state
    except BaseException:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)
        raise


class SimplePageSelector:
    def __init__(self, session_dir: Path | str):
        self.session_dir = Path(session_dir).resolve()
        self.manifest = _read_json(self.session_dir / "manifest.json")
        if self.manifest.get("schema_version") != MANIFEST_SCHEMA or self.manifest.get("manifest_sha256") != _hash_record(self.manifest, "manifest_sha256"):
            raise ConsoleError("integrity_error", "The selector manifest failed validation", status=500)
        self.size_wh = tuple(int(value) for value in self.manifest["source"]["size_wh"])
        self.preview_wh = tuple(int(value) for value in self.manifest["source"]["preview_size_wh"])
        self._thread_lock = threading.RLock()
        self.ink_layers = self._load_ink_layers()
        self.selection_mode = (
            "dual_extracted_ink"
            if self.ink_layers is not None
            else str(self.manifest["protocol"].get("selection_mode"))
        )
        self._component_cache: dict[
            str, tuple[np.ndarray, np.ndarray, int]
        ] = {}
        self._source_rgb_cache: np.ndarray | None = None
        self._source_background_cache: np.ndarray | None = None
        self._selection_preview_cache: dict[str, Any] | None = None
        self._last_selection_hygiene: dict[str, Any] = {
            "rule": "not_yet_evaluated",
            "suppressed_component_ids": [],
            "suppressed_pixels": 0,
        }
        self._recovery_preview_cache: dict[str, Any] | None = None
        self._cut_preview_cache: dict[str, Any] | None = None
        self._fit_process: subprocess.Popen[bytes] | None = None
        self._fit_process_lock = threading.Lock()
        self._fit_process_finalizer: weakref.finalize | None = None
        if self.selection_mode == "source_color_guided":
            source = self._source_rgb()
            rgb = source.astype(np.float32) / np.float32(255.0)
            gray = (
                rgb[:, :, 0] * np.float32(0.2126)
                + rgb[:, :, 1] * np.float32(0.7152)
                + rgb[:, :, 2] * np.float32(0.0722)
            )
            self._source_background_cache = np.clip(
                _fast_local_background(gray) * 255.0,
                0,
                255,
            ).astype(np.uint8)
        self._verify_bound("source/working.png", self.manifest["source"]["working_file_sha256"])
        self._verify_bound("source/strong.mask.png", self.manifest["strong_ink"]["file_sha256"])
        self._start_fit_process()

    def _load_ink_layers(self) -> dict[str, Any] | None:
        path = self.session_dir / "ink-layers.json"
        if not path.exists():
            return None
        record = _read_json(path)
        if (
            record.get("schema_version") != INK_LAYERS_SCHEMA
            or record.get("ink_layers_sha256")
            != _hash_record(record, "ink_layers_sha256")
            or record.get("bound_manifest_sha256")
            != self.manifest.get("manifest_sha256")
            or record.get("source_working_file_sha256")
            != self.manifest["source"].get("working_file_sha256")
            or record.get("source_size_wh") != list(self.size_wh)
            or record.get("default_layer") != "clean"
            or set(record.get("layers", {})) != {"clean", "high_recall"}
        ):
            raise ConsoleError(
                "integrity_error",
                "The selector ink layers failed validation",
                status=500,
            )
        masks: dict[str, np.ndarray] = {}
        for name in ("clean", "high_recall"):
            binding = record["layers"][name]
            if not isinstance(binding, dict):
                raise ConsoleError(
                    "integrity_error",
                    "A selector ink layer has the wrong shape",
                    status=500,
                )
            mask_path = self._verify_bound(
                str(binding.get("mask_path")),
                str(binding.get("mask_file_sha256")),
            )
            self._verify_bound(
                str(binding.get("preview_path")),
                str(binding.get("preview_file_sha256")),
            )
            mask = _load_binary(mask_path, self.size_wh)
            if (
                sha256_mask_pixels(mask) != binding.get("mask_pixel_sha256")
                or int(mask.sum()) != binding.get("pixels")
            ):
                raise ConsoleError(
                    "integrity_error",
                    "A selector ink layer changed after publication",
                    status=500,
                )
            masks[name] = mask
        if np.any(masks["clean"] & ~masks["high_recall"]) or not np.any(
            masks["high_recall"] & ~masks["clean"]
        ):
            raise ConsoleError(
                "integrity_error",
                "The selector ink-layer relationship is invalid",
                status=500,
            )
        return record

    def _validated_ink_variant(self, value: Any) -> str:
        if self.ink_layers is None:
            if value in {None, "clean", "strong", "high_recall"}:
                return "clean"
            raise ConsoleError(
                "invalid_ink_variant",
                "This selector has only one extracted ink layer",
            )
        if value not in {"clean", "high_recall"}:
            raise ConsoleError(
                "invalid_ink_variant",
                "Choose either clean or high-recall ink for this word",
            )
        return str(value)

    def _ink_mask(self, variant: str) -> np.ndarray:
        variant = self._validated_ink_variant(variant)
        if self.ink_layers is None:
            return _load_binary(
                self.session_dir / "source/strong.mask.png",
                self.size_wh,
            )
        binding = self.ink_layers["layers"][variant]
        path = self._verify_bound(
            binding["mask_path"],
            binding["mask_file_sha256"],
        )
        mask = _load_binary(path, self.size_wh)
        if (
            sha256_mask_pixels(mask) != binding["mask_pixel_sha256"]
            or int(mask.sum()) != binding["pixels"]
        ):
            raise ConsoleError(
                "integrity_error",
                "A selector ink layer changed after publication",
                status=500,
            )
        return mask

    @staticmethod
    def _stop_fit_process(process: subprocess.Popen[bytes]) -> None:
        try:
            if process.stdin is not None:
                process.stdin.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1.0)
        finally:
            if process.stdout is not None:
                process.stdout.close()

    def _start_fit_process(self) -> subprocess.Popen[bytes]:
        process = self._fit_process
        if process is not None and process.poll() is None:
            return process
        environment = os.environ.copy()
        source_root = str(Path(__file__).resolve().parents[1])
        existing = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = (
            source_root if not existing else source_root + os.pathsep + existing
        )
        process = subprocess.Popen(
            [sys.executable, "-m", "word_envelope.envelope_preview_worker", "--persistent"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        ready = process.stdout.readline() if process.stdout is not None else b""
        if ready != b'{"ready":true}\n':
            self._stop_fit_process(process)
            raise ConsoleError(
                "fit_worker_failed",
                "The fitted-segment helper could not start",
                status=500,
            )
        self._fit_process = process
        if self._fit_process_finalizer is not None:
            self._fit_process_finalizer.detach()
        self._fit_process_finalizer = weakref.finalize(
            self,
            SimplePageSelector._stop_fit_process,
            process,
        )
        return process

    @staticmethod
    def _mask_png_base64(mask: np.ndarray) -> str:
        buffer = BytesIO()
        Image.fromarray(
            np.where(mask, 255, 0).astype(np.uint8),
            mode="L",
        ).save(buffer, format="PNG", optimize=False)
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    def _run_fit_process(self, request: Mapping[str, Any]) -> dict[str, Any]:
        with self._fit_process_lock:
            process = self._start_fit_process()
            if process.stdin is None or process.stdout is None:
                raise ConsoleError("fit_worker_failed", "The fitted-segment helper stopped", status=500)
            try:
                process.stdin.write(
                    json.dumps(
                        dict(request),
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                    + b"\n"
                )
                process.stdin.flush()
                line = process.stdout.readline()
                response = json.loads(line)
            except (BrokenPipeError, OSError, json.JSONDecodeError) as error:
                self._stop_fit_process(process)
                self._fit_process = None
                raise ConsoleError(
                    "fit_worker_failed",
                    "The fitted-segment helper stopped unexpectedly",
                    status=500,
                ) from error
        if not isinstance(response, dict) or response.get("ok") is not True or not isinstance(response.get("result"), dict):
            raise ConsoleError(
                "fit_worker_failed",
                "The fitted-segment helper rejected this preview",
                status=500,
            )
        return response["result"]

    def _verify_bound(self, relative: str, expected: str) -> Path:
        path = (self.session_dir / relative).resolve()
        if self.session_dir not in path.parents or not path.is_file() or path.is_symlink() or sha256_file(path) != expected:
            raise ConsoleError("integrity_error", "A selector input changed after initialization", status=500)
        return path

    def _head_state(self) -> dict[str, Any]:
        head = _read_json(self.session_dir / "head.json")
        revision = head.get("revision")
        if not isinstance(revision, int) or revision < 0:
            raise ConsoleError("integrity_error", "The selector head is invalid", status=500)
        state = _read_json(self.session_dir / "revisions" / f"r{revision:06d}" / "state.json")
        if state.get("schema_version") != STATE_SCHEMA or state.get("state_sha256") != _hash_record(state, "state_sha256") or state.get("state_sha256") != head.get("state_sha256"):
            raise ConsoleError("integrity_error", "The selector state failed validation", status=500)
        return state

    def _claimed(self, state: Mapping[str, Any]) -> np.ndarray:
        binding = state["assets"]["claimed_mask"]
        path = self._verify_bound(binding["path"], binding["file_sha256"])
        mask = _load_binary(path, self.size_wh)
        if sha256_mask_pixels(mask) != binding["pixel_sha256"] or int(mask.sum()) != binding["pixels"]:
            raise ConsoleError("integrity_error", "The claimed mask changed after publication", status=500)
        return mask

    def _cut(self, state: Mapping[str, Any]) -> np.ndarray:
        binding = state.get("assets", {}).get("cut_mask")
        if binding is None:
            return np.zeros((self.size_wh[1], self.size_wh[0]), dtype=bool)
        path = self._verify_bound(binding["path"], binding["file_sha256"])
        mask = _load_binary(path, self.size_wh)
        if (
            sha256_mask_pixels(mask) != binding["pixel_sha256"]
            or int(mask.sum()) != binding["pixels"]
        ):
            raise ConsoleError(
                "integrity_error",
                "The cut mask changed after publication",
                status=500,
            )
        return mask

    def bootstrap(self) -> dict[str, Any]:
        state = self._head_state()
        revision = state["revision"]
        assets = {
            "original": "/api/asset/original",
            "claimed": f"/api/asset/claimed?revision={revision}",
        }
        if "cut_overlay" in state["assets"]:
            assets["cut"] = f"/api/asset/cut?revision={revision}"
        if self.selection_mode == "dual_extracted_ink":
            assets.update(
                {
                    "clean": "/api/asset/clean",
                    "high_recall": "/api/asset/high_recall",
                }
            )
        elif self.selection_mode != "source_color_guided":
            assets.update(
                {
                    "strong": "/api/asset/strong",
                    "available": f"/api/asset/available?revision={revision}",
                }
            )
        protocol = dict(self.manifest["protocol"])
        if self.selection_mode == "dual_extracted_ink":
            protocol.update(
                {
                    "selection_mode": "dual_extracted_ink",
                    "visible_selection_surface": "toggleable_extracted_ink_only",
                    "original_image_role": "read_only_context",
                    "hidden_seed_role": None,
                    "one_exact_ink_layer_per_word": True,
                    "default_ink_layer": "clean",
                }
            )
        manifest_summary: dict[str, Any] = {
            "page_id": self.manifest["page_id"],
            "source_size_wh": list(self.size_wh),
            "preview_size_wh": list(self.preview_wh),
            "strong_ink_pixels": (
                self.ink_layers["layers"]["high_recall"]["pixels"]
                if self.ink_layers is not None
                else self.manifest["strong_ink"]["pixels"]
            ),
            "strong_ink_status": (
                "v4_likely_plus_uncertain_source_ink"
                if self.ink_layers is not None
                else self.manifest["strong_ink"]["semantic_status"]
            ),
            "protocol": protocol,
        }
        if self.ink_layers is not None:
            manifest_summary["ink_layers"] = {
                name: {
                    "description": self.ink_layers["layers"][name]["description"],
                    "pixels": self.ink_layers["layers"][name]["pixels"],
                    "mask_pixel_sha256": self.ink_layers["layers"][name][
                        "mask_pixel_sha256"
                    ],
                }
                for name in ("clean", "high_recall")
            }
            manifest_summary["ink_layers_sha256"] = self.ink_layers[
                "ink_layers_sha256"
            ]
        return {
            "schema_version": "simple-page-selector-bootstrap.v1",
            "ui_version": UI_VERSION,
            "manifest": manifest_summary,
            "state": state,
            "assets": assets,
            "controls": {
                "primary_loop": "drag_one_or_more_times_then_press_enter",
                "enter": "commit_current_word",
                "backspace": "remove_last_selection_rectangle",
                "escape": "clear_current_selection",
                "cut": "persistent_barrier_even_when_detector_reports_zero_ink",
                "boxes_default_visible": False,
            },
        }

    def asset_path(self, kind: str, revision: int | None = None) -> tuple[Path, str]:
        if kind == "original":
            return self._verify_bound(self.manifest["source"]["preview_path"], self.manifest["source"]["preview_file_sha256"]), "image/jpeg"
        if kind in {"clean", "high_recall"} and self.ink_layers is not None:
            binding = self.ink_layers["layers"][kind]
            return self._verify_bound(
                binding["preview_path"],
                binding["preview_file_sha256"],
            ), "image/png"
        if kind == "strong":
            return self._verify_bound(self.manifest["strong_ink"]["preview_path"], self.manifest["strong_ink"]["preview_file_sha256"]), "image/png"
        state = self._head_state()
        if revision != state["revision"]:
            raise ConsoleError("stale_asset", "That page view is no longer current", status=409)
        key = {
            "claimed": "claimed_overlay",
            "cut": "cut_overlay",
            "available": "available_preview",
        }.get(kind)
        if key is None:
            raise ConsoleError("unknown_asset", "That selector image is not available", status=404)
        binding = state["assets"][key]
        return self._verify_bound(binding["path"], binding["file_sha256"]), "image/png"

    def _validated_rectangles(self, value: Any, *, allow_empty: bool = False) -> list[list[int]]:
        if (
            not isinstance(value, list)
            or (not value and not allow_empty)
            or len(value) > MAX_RECTS
        ):
            raise ConsoleError("invalid_selection", f"Select the word with 1–{MAX_RECTS} rectangles")
        width, height = self.size_wh
        result: list[list[int]] = []
        for raw in value:
            if not isinstance(raw, list) or len(raw) != 4 or any(not isinstance(item, int) or isinstance(item, bool) for item in raw):
                raise ConsoleError("invalid_selection", "Every selection must be an integer [x, y, width, height] rectangle")
            x, y, box_width, box_height = raw
            if box_width <= 0 or box_height <= 0 or x < 0 or y < 0 or x + box_width > width or y + box_height > height:
                raise ConsoleError("invalid_selection", "A selection rectangle falls outside the page")
            result.append([x, y, box_width, box_height])
        return result

    def _validated_cut_points(self, value: Any) -> list[list[int]]:
        if not isinstance(value, list) or not 2 <= len(value) <= 32:
            raise ConsoleError(
                "invalid_cut",
                "A cut needs between 2 and 32 ordered points",
            )
        width, height = self.size_wh
        points: list[list[int]] = []
        for point in value:
            if (
                not isinstance(point, list)
                or len(point) != 2
                or any(
                    not isinstance(item, int) or isinstance(item, bool)
                    for item in point
                )
            ):
                raise ConsoleError("invalid_cut", "Every cut point must be [x, y]")
            x, y = point
            if x < 0 or y < 0 or x >= width or y >= height:
                raise ConsoleError("invalid_cut", "A cut point falls outside the page")
            points.append([x, y])
        return points

    @staticmethod
    def _validated_cut_width(value: Any) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 40:
            raise ConsoleError("invalid_cut", "The cut width must be 1–40 source pixels")
        return value

    def _cut_line_mask(self, points: Sequence[Sequence[int]], width: int) -> np.ndarray:
        image = Image.new("L", self.size_wh, 0)
        draw = ImageDraw.Draw(image)
        draw.line(
            [tuple(point) for point in points],
            fill=255,
            width=width,
            joint="curve",
        )
        radius = max(1, width // 2)
        for x, y in points:
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=255,
            )
        return np.asarray(image, dtype=np.uint8) > 0

    def preview_cut(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "base_state_sha256",
            "points",
            "width_px",
        }:
            raise ConsoleError(
                "invalid_cut",
                "Cut preview needs the current state, path points, and width",
            )
        points = self._validated_cut_points(payload.get("points"))
        width_px = self._validated_cut_width(payload.get("width_px"))
        with self._thread_lock:
            state = self._head_state()
            if payload.get("base_state_sha256") != state["state_sha256"]:
                raise ConsoleError(
                    "stale_action",
                    "The page changed before this cut was previewed",
                    status=409,
                )
            if state["status"] != "selecting_words":
                raise ConsoleError("wrong_stage", "Cuts are available only while selecting words", status=409)
            line = self._cut_line_mask(points, width_px)
            high_recall = self._ink_mask("high_recall")
            touched = line & high_recall & ~self._claimed(state) & ~self._cut(state)
            basis = {
                "schema_version": "simple-page-cut-preview.v1",
                "base_state_sha256": state["state_sha256"],
                "points": points,
                "width_px": width_px,
                "line_pixel_sha256": sha256_mask_pixels(line),
            }
            preview_sha256 = hashlib.sha256(
                canonical_json_bytes(basis)
            ).hexdigest()
            self._cut_preview_cache = {
                "preview_sha256": preview_sha256,
                "base_state_sha256": state["state_sha256"],
                "points": points,
                "width_px": width_px,
                "line": line,
            }
            return {
                "schema_version": "simple-page-cut-preview.v1",
                "cut_preview_sha256": preview_sha256,
                "line_pixels": int(line.sum()),
                "touched_ink_pixels": int(touched.sum()),
                "barrier_ready": True,
                "barrier_rule": "persistent_page_coordinate_barrier_independent_of_detected_ink",
            }

    def commit_cut(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "schema_version",
            "base_state_sha256",
            "points",
            "width_px",
            "cut_preview_sha256",
        } or payload.get("schema_version") != "simple-page-cut-action.v1":
            raise ConsoleError("invalid_cut", "The cut confirmation is invalid")
        points = self._validated_cut_points(payload.get("points"))
        width_px = self._validated_cut_width(payload.get("width_px"))
        with self._locked():
            prior = self._head_state()
            cached = self._cut_preview_cache
            if (
                payload.get("base_state_sha256") != prior["state_sha256"]
                or cached is None
                or payload.get("cut_preview_sha256")
                != cached.get("preview_sha256")
                or cached.get("base_state_sha256") != prior["state_sha256"]
                or cached.get("points") != points
                or cached.get("width_px") != width_px
            ):
                raise ConsoleError(
                    "stale_cut_preview",
                    "The cut path changed before it was applied",
                    status=409,
                )
            if prior["status"] != "selecting_words":
                raise ConsoleError("wrong_stage", "Cuts are no longer available", status=409)
            next_cut = self._cut(prior) | cached["line"]
            state = {
                "status": "selecting_words",
                "page_id": prior["page_id"],
                "word_count": prior["word_count"],
                "claimed_pixels": prior["claimed_pixels"],
                "words": prior["words"],
                "page_notes": prior["page_notes"],
            }
            published = self._publish_state(
                prior,
                state,
                self._claimed(prior),
                {
                    "type": "commit_cut",
                    "points": points,
                    "width_px": width_px,
                    "cut_preview_sha256": payload["cut_preview_sha256"],
                },
                cut=next_cut,
            )
            self._component_cache.clear()
            self._selection_preview_cache = None
            self._recovery_preview_cache = None
            self._cut_preview_cache = None
            return {"state": published, "bootstrap": self.bootstrap()}

    def apply_cut(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Persist a cut in one atomic action for the human selector.

        Preview/commit remains available as a machine-facing diagnostic contract,
        but a person pressing Enter must never be left with an unsaved preview that
        disappears when Cut mode is closed.
        """

        if not isinstance(payload, Mapping) or set(payload) != {
            "schema_version",
            "base_state_sha256",
            "points",
            "width_px",
        } or payload.get("schema_version") != "simple-page-cut-apply-action.v1":
            raise ConsoleError("invalid_cut", "The cut action is invalid")
        points = self._validated_cut_points(payload.get("points"))
        width_px = self._validated_cut_width(payload.get("width_px"))
        with self._locked():
            prior = self._head_state()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError(
                    "stale_action",
                    "The page changed before this cut could be applied",
                    status=409,
                )
            if prior["status"] != "selecting_words":
                raise ConsoleError(
                    "wrong_stage",
                    "Cuts are no longer available",
                    status=409,
                )
            line = self._cut_line_mask(points, width_px)
            prior_cut = self._cut(prior)
            added = line & ~prior_cut
            if not np.any(added):
                raise ConsoleError(
                    "cut_already_applied",
                    "That exact barrier is already present",
                )
            high_recall = self._ink_mask("high_recall")
            touched = added & high_recall & ~self._claimed(prior)
            state = {
                "status": "selecting_words",
                "page_id": prior["page_id"],
                "word_count": prior["word_count"],
                "claimed_pixels": prior["claimed_pixels"],
                "words": prior["words"],
                "page_notes": prior["page_notes"],
            }
            published = self._publish_state(
                prior,
                state,
                self._claimed(prior),
                {
                    "type": "apply_cut",
                    "points": points,
                    "width_px": width_px,
                    "line_pixel_sha256": sha256_mask_pixels(line),
                    "added_barrier_pixels": int(added.sum()),
                    "touched_high_recall_ink_pixels": int(touched.sum()),
                },
                cut=prior_cut | line,
            )
            self._component_cache.clear()
            self._selection_preview_cache = None
            self._recovery_preview_cache = None
            self._cut_preview_cache = None
            return {
                "state": published,
                "bootstrap": self.bootstrap(),
                "cut": {
                    "added_barrier_pixels": int(added.sum()),
                    "touched_high_recall_ink_pixels": int(touched.sum()),
                    "persists_when_detected_ink_is_zero": True,
                },
            }

    def _selection_from_rectangles(
        self,
        state: Mapping[str, Any],
        claimed: np.ndarray,
        rectangles: Sequence[Sequence[int]],
        *,
        ink_variant: str = "clean",
        recovery_mask: np.ndarray | None = None,
        recovery_cache_key: str | None = None,
    ) -> tuple[np.ndarray, list[int], np.ndarray]:
        """Expand every touched available-ink component in full.

        The rectangle is an approximate hit target, never a clipping stencil.
        Removing earlier claims before labeling also means a committed word can
        safely sever a formerly shared component for later selections.
        """

        ink_variant = self._validated_ink_variant(ink_variant)
        if self.selection_mode == "source_color_guided":
            selected, groups, available = self._source_color_selection(
                state, claimed, rectangles
            )
            self._last_selection_hygiene = {
                "rule": "micro_island_suppression_not_applied_to_source_color_groups",
                "suppressed_component_ids": [],
                "suppressed_pixels": 0,
            }
            return selected, groups, available

        cache_key = f"{state['state_sha256']}:{ink_variant}"
        if recovery_cache_key is not None:
            cache_key += f":recovery:{recovery_cache_key}"
        cached = self._component_cache.get(cache_key)
        if cached is not None:
            labels, available, component_count = cached
        else:
            active_ink = self._ink_mask(ink_variant)
            if recovery_mask is not None:
                active_ink = active_ink | np.asarray(recovery_mask, dtype=bool)
            available = active_ink & ~claimed & ~self._cut(state)
            labels, component_count = ndimage.label(
                available,
                structure=np.ones((3, 3), dtype=np.uint8),
            )
            labels = labels.astype(np.int32, copy=False)
            self._component_cache[cache_key] = (
                labels,
                available,
                int(component_count),
            )
        touched: set[int] = set()
        for x, y, width, height in rectangles:
            touched.update(
                int(value)
                for value in np.unique(labels[y : y + height, x : x + width])
                if int(value) > 0
            )
        if not touched:
            self._last_selection_hygiene = {
                "rule": "extracted_ink_components_of_one_or_two_pixels_are_probable_noise",
                "suppressed_component_ids": [],
                "suppressed_pixels": 0,
            }
            return np.zeros_like(available), [], available
        component_areas = np.bincount(
            labels.ravel(), minlength=int(component_count) + 1
        )
        suppressed = sorted(
            component_id
            for component_id in touched
            if int(component_areas[component_id]) <= 2
        )
        touched.difference_update(suppressed)
        if not touched:
            self._last_selection_hygiene = {
                "rule": "extracted_ink_components_of_one_or_two_pixels_are_probable_noise",
                "suppressed_component_ids": suppressed,
                "suppressed_pixels": int(
                    sum(int(component_areas[value]) for value in suppressed)
                ),
            }
            return np.zeros_like(available), [], available
        lookup = np.zeros(int(component_count) + 1, dtype=bool)
        lookup[list(touched)] = True
        self._last_selection_hygiene = {
            "rule": "extracted_ink_components_of_one_or_two_pixels_are_probable_noise",
            "suppressed_component_ids": suppressed,
            "suppressed_pixels": int(
                sum(int(component_areas[value]) for value in suppressed)
            ),
        }
        return lookup[labels], sorted(touched), available

    def _source_rgb(self) -> np.ndarray:
        if self._source_rgb_cache is None:
            path = self._verify_bound(
                self.manifest["source"]["working_path"],
                self.manifest["source"]["working_file_sha256"],
            )
            with Image.open(path) as image:
                self._source_rgb_cache = np.asarray(image.convert("RGB"), dtype=np.uint8)
        return self._source_rgb_cache

    def _source_color_selection(
        self,
        state: Mapping[str, Any],
        claimed: np.ndarray,
        rectangles: Sequence[Sequence[int]],
    ) -> tuple[np.ndarray, list[int], np.ndarray]:
        """Use hidden ink only as a seed, then select source-derived stroke pixels."""

        source = self._source_rgb()
        cut = self._cut(state)
        hidden_seed = _load_binary(
            self.session_dir / "source/strong.mask.png",
            self.size_wh,
        ) & ~claimed & ~cut
        selected = np.zeros_like(hidden_seed)
        source_candidates = np.zeros_like(hidden_seed)
        selected_groups: list[int] = []
        next_group = 1
        page_width, page_height = self.size_wh

        for x, y, width, height in rectangles:
            point_like = width <= 16 and height <= 16
            if point_like:
                center_x = x + width // 2
                center_y = y + height // 2
                x0 = max(0, center_x - 300)
                x1 = min(page_width, center_x + 301)
                y0 = max(0, center_y - 180)
                y1 = min(page_height, center_y + 181)
            else:
                pad = max(36, min(150, round(max(width, height) * 0.28)))
                x0 = max(0, x - pad)
                x1 = min(page_width, x + width + pad)
                y0 = max(0, y - pad)
                y1 = min(page_height, y + height + pad)

            rgb = source[y0:y1, x0:x1].astype(np.float32) / np.float32(255.0)
            gray = (
                rgb[:, :, 0] * np.float32(0.2126)
                + rgb[:, :, 1] * np.float32(0.7152)
                + rgb[:, :, 2] * np.float32(0.0722)
            )
            if self._source_background_cache is not None:
                background = (
                    self._source_background_cache[y0:y1, x0:x1].astype(np.float32)
                    / np.float32(255.0)
                )
            else:
                background = _fast_local_background(gray)
            darkness = np.maximum(background - gray, 0.0)
            lab = color.rgb2lab(rgb).astype(np.float32)

            local_seed = hidden_seed[y0:y1, x0:x1].copy()
            hit = np.zeros_like(local_seed)
            local_x = x - x0
            local_y = y - y0
            hit[
                max(0, local_y) : min(hit.shape[0], local_y + height),
                max(0, local_x) : min(hit.shape[1], local_x + width),
            ] = True
            seed_hit = local_seed & hit
            if not np.any(seed_hit) and np.any(local_seed):
                # A click may land on a source-visible edge absent from the seed.
                # Prefer the nearest hidden seed, but never search beyond 12 px.
                distance, indexes = ndimage.distance_transform_edt(
                    ~local_seed,
                    return_indices=True,
                )
                hit_ys, hit_xs = np.nonzero(hit)
                if len(hit_ys):
                    best_index = int(np.argmin(distance[hit_ys, hit_xs]))
                    if float(distance[hit_ys[best_index], hit_xs[best_index]]) <= 12.0:
                        seed_y = int(indexes[0, hit_ys[best_index], hit_xs[best_index]])
                        seed_x = int(indexes[1, hit_ys[best_index], hit_xs[best_index]])
                        seed_hit[seed_y, seed_x] = True
            if not np.any(seed_hit):
                # Last-resort source-only seed: the darkest pixel explicitly hit.
                hit_ys, hit_xs = np.nonzero(hit)
                if not len(hit_ys):
                    continue
                best_index = int(np.argmax(darkness[hit_ys, hit_xs]))
                if float(darkness[hit_ys[best_index], hit_xs[best_index]]) < 0.008:
                    continue
                seed_hit[hit_ys[best_index], hit_xs[best_index]] = True

            seed_pool = local_seed & (
                (ndimage.distance_transform_edt(~seed_hit) <= 80.0)
                if point_like
                else ndimage.binary_dilation(hit, iterations=12)
            )
            supported_seed = seed_pool & (darkness >= 0.004)
            if np.count_nonzero(supported_seed) < 4:
                supported_seed = seed_pool
            seed_lab = lab[supported_seed]
            if not len(seed_lab):
                seed_lab = lab[seed_hit]
            ink_center = np.median(seed_lab, axis=0)
            ink_distance = np.sqrt(
                np.sum((lab - ink_center) ** 2, axis=2, dtype=np.float32)
            )
            distance_seed = supported_seed if np.any(supported_seed) else seed_hit
            seed_distances = ink_distance[distance_seed]
            ink_limit = float(
                min(38.0, max(10.0, np.percentile(seed_distances, 95) + 7.0))
            )
            paper_pool = (~ndimage.binary_dilation(local_seed, iterations=5)) & (
                gray >= np.percentile(gray, 58)
            )
            if np.count_nonzero(paper_pool) < 16:
                paper_pool = ~ndimage.binary_dilation(local_seed, iterations=3)
            paper_center = np.median(lab[paper_pool], axis=0)
            paper_distance = np.sqrt(
                np.sum((lab - paper_center) ** 2, axis=2, dtype=np.float32)
            )
            paper_advantage = paper_distance - ink_distance
            candidate = (
                (darkness >= 0.008)
                & (ink_distance <= ink_limit)
                & (paper_advantage >= -6.0)
            ) | (
                (darkness >= 0.018)
                & (ink_distance <= ink_limit + 8.0)
                & (paper_advantage >= -10.0)
            )
            candidate |= seed_hit
            candidate &= ~claimed[y0:y1, x0:x1]
            candidate &= ~cut[y0:y1, x0:x1]

            labels, component_count = ndimage.label(
                candidate,
                structure=np.ones((3, 3), dtype=np.uint8),
            )
            touched = {
                int(value)
                for value in np.unique(labels[seed_hit])
                if int(value) > 0
            }
            if not touched:
                continue
            lookup = np.zeros(int(component_count) + 1, dtype=bool)
            lookup[list(touched)] = True
            local_selected = lookup[labels] & candidate
            selected[y0:y1, x0:x1] |= local_selected
            source_candidates[y0:y1, x0:x1] |= candidate
            selected_groups.extend(range(next_group, next_group + len(touched)))
            next_group += len(touched)

        selected &= ~claimed
        return selected, selected_groups, source_candidates | selected

    def preview_selection(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        allowed_keys = {
            "base_state_sha256",
            "rectangles",
            "deselect_rectangles",
        }
        recovery_keys = {"recovery_set_sha256", "recovery_profile"}
        if (
            not isinstance(payload, Mapping)
            or frozenset(payload)
            not in {
                frozenset(allowed_keys),
                frozenset(allowed_keys | {"ink_variant"}),
                frozenset(allowed_keys | recovery_keys),
                frozenset(allowed_keys | {"ink_variant"} | recovery_keys),
            }
        ):
            raise ConsoleError(
                "invalid_selection",
                "Selection preview needs only the current state, ink layer, additions, and removals",
            )
        ink_variant = self._validated_ink_variant(payload.get("ink_variant"))
        rectangles = self._validated_rectangles(payload.get("rectangles"))
        deselect_rectangles = self._validated_rectangles(
            payload.get("deselect_rectangles"),
            allow_empty=True,
        )
        with self._thread_lock:
            state = self._head_state()
            if payload.get("base_state_sha256") != state["state_sha256"]:
                raise ConsoleError("stale_action", "The page changed before this selection was previewed", status=409)
            if state["status"] != "selecting_words":
                raise ConsoleError("wrong_stage", "Word selection has already finished", status=409)
            claimed = self._claimed(state)
            recovery_record = None
            recovery_set_sha256 = payload.get("recovery_set_sha256")
            recovery_profile = payload.get("recovery_profile")
            recovery = None
            recovery_mask = None
            recovery_cache_key = None
            if recovery_set_sha256 is not None or recovery_profile is not None:
                recovery = self._recovery_preview_cache
                if (
                    recovery is None
                    or recovery_set_sha256
                    != recovery.get("recovery_set_sha256")
                    or recovery.get("base_state_sha256") != state["state_sha256"]
                    or recovery_profile not in recovery.get("candidates", {})
                ):
                    raise ConsoleError(
                        "stale_recovery_preview",
                        "The recovered-ink choice changed before selection",
                        status=409,
                    )
                recovery_mask = recovery["candidates"][str(recovery_profile)]
                recovery_cache_key = (
                    f"{recovery['recovery_set_sha256']}:{recovery_profile}"
                )
            selected, component_ids, _available = self._selection_from_rectangles(
                state,
                claimed,
                rectangles,
                ink_variant=ink_variant,
                recovery_mask=recovery_mask,
                recovery_cache_key=recovery_cache_key,
            )
            selection_hygiene = dict(self._last_selection_hygiene)
            if recovery is not None:
                additions = (
                    selected
                    & recovery["candidates"][str(recovery_profile)]
                    & ~recovery["anchor"]
                )
                recovery_record = {
                    "profile": str(recovery_profile),
                    "recovery_set_sha256": recovery["recovery_set_sha256"],
                    "parent_selection_preview_sha256": recovery[
                        "parent_selection_preview_sha256"
                    ],
                    "crop_bbox_xywh": list(recovery["crop_bbox_xywh"]),
                    "recovered_source_pixels": int(additions.sum()),
                    "recovered_source_pixel_sha256": sha256_mask_pixels(additions),
                }
            else:
                self._recovery_preview_cache = None
            if deselect_rectangles:
                hit = np.zeros_like(selected)
                for x, y, width, height in deselect_rectangles:
                    hit[y : y + height, x : x + width] = True
                selected_labels, selected_count = ndimage.label(
                    selected,
                    structure=np.ones((3, 3), dtype=np.uint8),
                )
                touched = {
                    int(value)
                    for value in np.unique(selected_labels[hit])
                    if int(value) > 0
                }
                if touched:
                    lookup = np.zeros(int(selected_count) + 1, dtype=bool)
                    lookup[list(touched)] = True
                    selected &= ~lookup[selected_labels]
            if recovery_record is not None:
                final_additions = (
                    selected
                    & recovery["candidates"][str(recovery_profile)]
                    & ~recovery["anchor"]
                )
                recovery_record["recovered_source_pixels"] = int(
                    final_additions.sum()
                )
                recovery_record["recovered_source_pixel_sha256"] = (
                    sha256_mask_pixels(final_additions)
                )
            selected_pixels = int(selected.sum())
            if selected_pixels:
                preview_basis = {
                    "schema_version": "simple-page-selection-preview.v1",
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": rectangles,
                    "deselect_rectangles": deselect_rectangles,
                    "ink_variant": ink_variant,
                    "recovery_set_sha256": recovery_set_sha256,
                    "recovery_profile": recovery_profile,
                    "selected_pixel_sha256": sha256_mask_pixels(selected),
                }
                preview_sha256 = hashlib.sha256(
                    canonical_json_bytes(preview_basis)
                ).hexdigest()
                self._selection_preview_cache = {
                    "preview_sha256": preview_sha256,
                    "base_state_sha256": state["state_sha256"],
                    "rectangles": [list(value) for value in rectangles],
                    "deselect_rectangles": [
                        list(value) for value in deselect_rectangles
                    ],
                    "ink_variant": ink_variant,
                    "selected": selected,
                    "component_ids": component_ids,
                    "selection_hygiene": selection_hygiene,
                    "recovery": recovery_record,
                }
            else:
                self._selection_preview_cache = None
        if selected_pixels:
            ys, xs = np.nonzero(selected)
            selection_bbox = [
                int(xs.min()),
                int(ys.min()),
                int(xs.max()) - int(xs.min()) + 1,
                int(ys.max()) - int(ys.min()) + 1,
            ]
        else:
            selection_bbox = None
        return {
            "selection_rule": (
                "hidden_seed_then_local_source_color_and_brightness_continuity"
                if self.selection_mode == "source_color_guided"
                else "touch_any_pixel_selects_entire_8_connected_available_ink_component"
            ),
            "selection_mode": self.selection_mode,
            "ink_variant": ink_variant,
            "component_ids": component_ids,
            "component_count": len(component_ids),
            "selection_hygiene": selection_hygiene,
            "selected_pixels": int(selected.sum()),
            "selection_bbox_xywh": selection_bbox,
            "selected_pixel_sha256": sha256_mask_pixels(selected),
            "overlay_data_url": self._selection_overlay_data_url(selected),
            "commit_ready": self._selection_preview_cache is not None,
            "selection_preview_sha256": (
                self._selection_preview_cache["preview_sha256"]
                if self._selection_preview_cache is not None
                else None
            ),
            "fit_status": "deferred_until_page_finish",
        }

    def _selection_overlay_data_url(self, selected: np.ndarray) -> str:
        preview = Image.fromarray(
            np.where(selected, 255, 0).astype(np.uint8),
            mode="L",
        ).resize(self.preview_wh, Image.Resampling.NEAREST)
        values = np.asarray(preview) > 0
        rgba = np.zeros((self.preview_wh[1], self.preview_wh[0], 4), dtype=np.uint8)
        rgba[values] = (30, 174, 99, 235)
        buffer = BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buffer, format="PNG")
        return "data:image/png;base64," + base64.b64encode(
            buffer.getvalue()
        ).decode("ascii")

    def _ink_surface_data_url(self, mask: np.ndarray) -> str:
        preview = Image.fromarray(
            np.where(mask, 0, 255).astype(np.uint8),
            mode="L",
        ).resize(self.preview_wh, Image.Resampling.NEAREST)
        buffer = BytesIO()
        preview.save(buffer, format="PNG")
        return "data:image/png;base64," + base64.b64encode(
            buffer.getvalue()
        ).decode("ascii")

    def _recovery_surface(self, profile: str) -> dict[str, Any]:
        recovery = self._recovery_preview_cache
        if recovery is None or profile not in recovery["candidates"]:
            raise ConsoleError(
                "stale_recovery_preview",
                "The recovered-ink choices are no longer current",
                status=409,
            )
        parent = recovery["parent_selection"]
        candidate = recovery["candidates"][profile]
        surface = (
            self._ink_mask(parent["ink_variant"])
            | candidate
        ) & ~recovery["forbidden"]
        additions = candidate & ~recovery["anchor"]
        self._selection_preview_cache = None
        return {
            "recovery_profile": profile,
            "recovered_source_pixels": int(additions.sum()),
            "selectable_pixels": int(surface.sum()),
            "selectable_pixel_sha256": sha256_mask_pixels(surface),
            "selectable_ink_data_url": self._ink_surface_data_url(surface),
            "selected_pixels": 0,
            "selection_preview_sha256": None,
            "commit_ready": False,
            "requires_manual_reselection": True,
        }

    def preview_recovery(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "base_state_sha256",
            "selection_preview_sha256",
        }:
            raise ConsoleError(
                "invalid_recovery",
                "Ink recovery needs only the current green selection",
            )
        with self._thread_lock:
            state = self._head_state()
            if payload.get("base_state_sha256") != state["state_sha256"]:
                raise ConsoleError(
                    "stale_action",
                    "The page changed before ink recovery finished",
                    status=409,
                )
            parent = self._selection_preview_cache
            if (
                parent is None
                or payload.get("selection_preview_sha256")
                != parent.get("preview_sha256")
                or parent.get("base_state_sha256") != state["state_sha256"]
            ):
                raise ConsoleError(
                    "stale_selection_preview",
                    "The green word changed before ink recovery started",
                    status=409,
                )
            anchor = np.asarray(parent["selected"], dtype=bool).copy()
            forbidden = self._claimed(state) | self._cut(state)
            if np.any(anchor & forbidden):
                raise ConsoleError(
                    "stale_selection_preview",
                    "The page changed before ink recovery started",
                    status=409,
                )
            ys, xs = np.nonzero(anchor)
            span = max(int(np.ptp(xs)) + 1, int(np.ptp(ys)) + 1)
            padding = max(70, min(220, round(span * 0.42)))
            x0 = max(0, int(xs.min()) - padding)
            y0 = max(0, int(ys.min()) - padding)
            x1 = min(self.size_wh[0], int(xs.max()) + 1 + padding)
            y1 = min(self.size_wh[1], int(ys.max()) + 1 + padding)
            crop = [x0, y0, x1 - x0, y1 - y0]
            recovered = recover_local_ink_candidates(
                self._source_rgb(),
                anchor,
                forbidden,
                crop,
            )
            candidates: dict[str, np.ndarray] = {"original": anchor}
            summaries: dict[str, Any] = {
                "original": {
                    "recovered_source_pixels": 0,
                    "component_count": int(
                        ndimage.label(
                            anchor,
                            structure=np.ones((3, 3), dtype=np.uint8),
                        )[1]
                    ),
                }
            }
            for name, candidate in recovered["candidates"].items():
                full = np.zeros_like(anchor)
                full[y0:y1, x0:x1] = candidate["mask"]
                full &= ~forbidden
                full |= anchor
                candidates[name] = full
                summaries[name] = {
                    "recovered_source_pixels": int(np.count_nonzero(full & ~anchor)),
                    "recovered_component_count": int(
                        candidate["added_component_count"]
                    ),
                    "component_count": int(
                        ndimage.label(
                            full,
                            structure=np.ones((3, 3), dtype=np.uint8),
                        )[1]
                    ),
                }
            set_basis = {
                "schema_version": "simple-page-recovery-set.v1",
                "base_state_sha256": state["state_sha256"],
                "parent_selection_preview_sha256": parent["preview_sha256"],
                "crop_bbox_xywh": crop,
                "candidates": {
                    name: sha256_mask_pixels(mask)
                    for name, mask in candidates.items()
                },
            }
            recovery_set_sha256 = hashlib.sha256(
                canonical_json_bytes(set_basis)
            ).hexdigest()
            self._recovery_preview_cache = {
                "base_state_sha256": state["state_sha256"],
                "parent_selection_preview_sha256": parent["preview_sha256"],
                "parent_selection": {
                    key: parent[key]
                    for key in (
                        "rectangles",
                        "deselect_rectangles",
                        "ink_variant",
                        "component_ids",
                    )
                },
                "anchor": anchor,
                "forbidden": forbidden,
                "crop_bbox_xywh": crop,
                "candidates": candidates,
                "summaries": summaries,
                "recovery_set_sha256": recovery_set_sha256,
            }
            surface = self._recovery_surface("conservative")
            return {
                "schema_version": "simple-page-recovery-preview.v1",
                "recovery_set_sha256": recovery_set_sha256,
                "crop_bbox_xywh": crop,
                "candidate_order": [
                    "original",
                    "conservative",
                    "balanced",
                    "maximum_recall",
                ],
                "candidates": summaries,
                "active_profile": "conservative",
                "surface": surface,
            }

    def choose_recovery(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "base_state_sha256",
            "recovery_set_sha256",
            "profile",
        }:
            raise ConsoleError(
                "invalid_recovery",
                "Choose one current recovered-ink profile",
            )
        with self._thread_lock:
            state = self._head_state()
            recovery = self._recovery_preview_cache
            if (
                payload.get("base_state_sha256") != state["state_sha256"]
                or recovery is None
                or payload.get("recovery_set_sha256")
                != recovery.get("recovery_set_sha256")
            ):
                raise ConsoleError(
                    "stale_recovery_preview",
                    "The recovered-ink choices are no longer current",
                    status=409,
                )
            profile = payload.get("profile")
            if profile not in recovery["candidates"]:
                raise ConsoleError(
                    "invalid_recovery",
                    "Choose original, conservative, balanced, or maximum recall",
                )
            return {
                "recovery_set_sha256": recovery["recovery_set_sha256"],
                "active_profile": profile,
                "surface": self._recovery_surface(str(profile)),
            }

    def _fit(self, selected: np.ndarray, available: np.ndarray) -> tuple[dict[str, Any], list[list[float]], list[int], list[dict[str, Any]]]:
        ys, xs = np.nonzero(selected)
        if len(xs) < 8:
            raise ConsoleError("empty_selection", "The current selection contains too little available ink")
        pad = max(36, min(120, round(max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1) * 0.25)))
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)
        x1 = min(self.size_wh[0], int(xs.max()) + 1 + pad)
        y1 = min(self.size_wh[1], int(ys.max()) + 1 + pad)
        local = selected[y0:y1, x0:x1]
        excluded = available[y0:y1, x0:x1] & ~local
        local_ys, local_xs = np.nonzero(local)
        points = np.column_stack((local_xs, local_ys)).astype(np.float64)
        center = points.mean(axis=0)
        if len(points) >= 2:
            _u, _s, axes = np.linalg.svd(points - center, full_matrices=False)
            direction = axes[0]
        else:
            direction = np.array([1.0, 0.0])
        if direction[0] < 0:
            direction = -direction
        projection = (points - center) @ direction
        centerline = (
            tuple((center + direction * float(projection.min())).tolist()),
            tuple((center + direction * float(projection.max())).tolist()),
        )
        angle = float(np.degrees(np.arctan2(direction[1], direction[0])))
        selected_width = int(local_xs.max() - local_xs.min() + 1)
        selected_height = int(local_ys.max() - local_ys.min() + 1)
        base = dict(
            angle_degrees=angle,
            centerline=centerline,
            padding_px=max(3.0, min(8.0, min(selected_width, selected_height) * 0.035)),
            maximum_envelope_fraction=0.92,
            maximum_excluded_contamination=0.05,
            maximum_excluded_component_contamination=(
                1.0
                if self.selection_mode == "source_color_guided"
                else 0.25
            ),
            minimum_excluded_component_pixels_for_gate=(
                8
                if self.selection_mode == "source_color_guided"
                else 1
            ),
            maximum_envelope_to_ink_area_ratio=24.0,
            allow_border_touching_ink=True,
        )
        profiles = [
            ("standard", EnvelopeParams(along_bridge_px=max(14.0, min(46.0, selected_width * 0.08)), cross_bridge_px=max(5.0, min(16.0, selected_height * 0.08)), **base)),
            ("fragmented_word", EnvelopeParams(along_bridge_px=max(24.0, min(78.0, selected_width * 0.18)), cross_bridge_px=max(18.0, min(34.0, selected_height * 0.32)), **base)),
            ("detached_mark", EnvelopeParams(along_bridge_px=max(32.0, min(100.0, selected_width * 0.24)), cross_bridge_px=max(24.0, min(48.0, selected_height * 0.46)), **base)),
        ]
        worker_result = self._run_fit_process(
            {
                "selected_png_base64": self._mask_png_base64(local),
                "excluded_png_base64": self._mask_png_base64(excluded),
                "profiles": [
                    {"name": name, "params": parameters.as_record()}
                    for name, parameters in profiles
                ],
                "first_success_only": True,
            }
        )
        successes = worker_result.get("successes")
        failures = worker_result.get("failures")
        fit_trials = worker_result.get("trials")
        if not isinstance(successes, list) or not isinstance(failures, dict) or not isinstance(fit_trials, list):
            raise ConsoleError(
                "fit_worker_failed",
                "The fitted-segment helper returned an invalid result",
                status=500,
            )
        if not successes:
            raise ConsoleError(
                "envelope_failed",
                "The selected ink could not be safely fitted as one word. Adjust the selection.",
                details={"trials": fit_trials, "failures": failures},
            )
        winner = min(successes, key=lambda item: (float(item["envelope_area_px2"]), item["profile"], item["method"]))
        polygon = [[round(float(x) + x0, 3), round(float(y) + y0, 3)] for x, y in winner["polygon"]]
        return winner, polygon, [x0, y0, x1 - x0, y1 - y0], fit_trials

    def _locked(self):
        class LockContext:
            def __init__(inner, owner: "SimplePageSelector"):
                inner.owner = owner
                inner.handle = None
            def __enter__(inner):
                inner.owner._thread_lock.acquire()
                flags = os.O_CREAT | os.O_RDWR
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                descriptor = os.open(inner.owner.session_dir / ".selector.lock", flags, 0o600)
                inner.handle = os.fdopen(descriptor, "a+b")
                fcntl.flock(inner.handle.fileno(), fcntl.LOCK_EX)
            def __exit__(inner, exc_type, exc, traceback):
                if inner.handle is not None:
                    inner.handle.close()
                inner.owner._thread_lock.release()
        return LockContext(self)

    def _publish_state(
        self,
        prior: Mapping[str, Any],
        state: dict[str, Any],
        claimed: np.ndarray,
        action: Mapping[str, Any],
        *,
        cut: np.ndarray | None = None,
    ) -> dict[str, Any]:
        revision = int(prior["revision"]) + 1
        revision_dir = self.session_dir / "revisions" / f"r{revision:06d}"
        assets = _render_revision_assets(
            revision_dir,
            strong=_load_binary(
                self.session_dir / "source/strong.mask.png",
                self.size_wh,
            ),
            claimed=claimed,
            cut=self._cut(prior) if cut is None else cut,
            preview_wh=self.preview_wh,
            render_available=(
                self.selection_mode not in {
                    "source_color_guided",
                    "dual_extracted_ink",
                }
            ),
        )
        state.update({
            "schema_version": STATE_SCHEMA,
            "revision": revision,
            "assets": assets,
            "previous_state_sha256": prior["state_sha256"],
        })
        state["state_sha256"] = _hash_record(state, "state_sha256")
        _write_json_new(revision_dir / "state.json", state)
        event = {
            "schema_version": ACTION_SCHEMA,
            "revision": revision,
            "base_state_sha256": prior["state_sha256"],
            "action": dict(action),
            "result_state_sha256": state["state_sha256"],
        }
        event["event_sha256"] = _hash_record(event, "event_sha256")
        _write_json_new(revision_dir / "event.json", event)
        head_temp = self.session_dir / ".head.next.json"
        head_temp.write_bytes(canonical_json_bytes({"revision": revision, "state_sha256": state["state_sha256"]}) + b"\n")
        os.replace(head_temp, self.session_dir / "head.json")
        return state

    def commit_word(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        allowed_keys = {
            "schema_version",
            "base_state_sha256",
            "rectangles",
            "deselect_rectangles",
            "selection_preview_sha256",
        }
        if (
            not isinstance(payload, Mapping)
            or frozenset(payload)
            not in {
                frozenset(allowed_keys),
                frozenset(allowed_keys | {"ink_variant"}),
            }
            or payload.get("schema_version") != "simple-page-word-selection-action.v1"
        ):
            raise ConsoleError("invalid_action", "A word commit needs only the current state and selection rectangles")
        ink_variant = self._validated_ink_variant(payload.get("ink_variant"))
        rectangles = self._validated_rectangles(payload.get("rectangles"))
        deselect_rectangles = self._validated_rectangles(
            payload.get("deselect_rectangles"),
            allow_empty=True,
        )
        with self._locked():
            prior = self._head_state()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError("stale_action", "The page changed before this word was committed", status=409)
            if prior["status"] != "selecting_words":
                raise ConsoleError("wrong_stage", "Word selection has already finished", status=409)
            claimed = self._claimed(prior)
            cached = self._selection_preview_cache
            if (
                cached is None
                or payload.get("selection_preview_sha256")
                != cached.get("preview_sha256")
                or cached.get("base_state_sha256") != prior["state_sha256"]
                or cached.get("rectangles") != rectangles
                or cached.get("deselect_rectangles") != deselect_rectangles
                or cached.get("ink_variant") != ink_variant
            ):
                raise ConsoleError(
                    "stale_selection_preview",
                    "The green selection changed before Enter. Preview it again.",
                    status=409,
                )
            selected = cached["selected"]
            selected_component_ids = list(cached["component_ids"])
            selection_hygiene = dict(cached["selection_hygiene"])
            recovery_record = (
                dict(cached["recovery"])
                if isinstance(cached.get("recovery"), dict)
                else None
            )
            if int(np.count_nonzero(selected & claimed)):
                raise ConsoleError(
                    "stale_selection_preview",
                    "The green selection overlaps a newly committed word. Preview it again.",
                    status=409,
                )
            ys, xs = np.nonzero(selected)
            selection_bbox = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
            word_number = int(prior["word_count"]) + 1
            word_dir = self.session_dir / "words" / f"word-{word_number:04d}"
            if word_dir.exists():
                word_dir = self.session_dir / "words" / (
                    f"word-{word_number:04d}-r{int(prior['revision']) + 1:06d}"
                )
            word_dir.mkdir(parents=True, exist_ok=False)
            x, y, width, height = selection_bbox
            word_mask_path = word_dir / "selected.mask.png"
            _save_binary(word_mask_path, selected[y : y + height, x : x + width])
            word = {
                "word_number": word_number,
                "ink_variant": ink_variant,
                "ink_variant_pixel_sha256": (
                    self.ink_layers["layers"][ink_variant]["mask_pixel_sha256"]
                    if self.ink_layers is not None
                    else self.manifest["strong_ink"]["pixel_sha256"]
                ),
                "rectangles": rectangles,
                "deselect_rectangles": deselect_rectangles,
                "selection_bbox_xywh": selection_bbox,
                "selected_pixels": int(selected.sum()),
                "selected_source_component_ids": selected_component_ids,
                "selected_source_component_count": len(selected_component_ids),
                "selection_hygiene": selection_hygiene,
                "recovery": recovery_record,
                "selection_preview_sha256": payload["selection_preview_sha256"],
                "selected_pixel_sha256": sha256_mask_pixels(selected[y : y + height, x : x + width]),
                "selected_mask_path": str(word_mask_path.relative_to(self.session_dir)),
                "selected_mask_file_sha256": sha256_file(word_mask_path),
                "fit_status": "pending_page_finish",
                "fit_profile": None,
                "fit_method": None,
                "fit_quality": None,
                "fit_crop_xywh": None,
                "envelope_polygon": None,
                "envelope_polygon_sha256": None,
                "envelope_metrics": None,
                "fit_trials": [],
            }
            words = list(prior["words"]) + [word]
            next_claimed = claimed | selected
            state = {
                "status": "selecting_words",
                "page_id": prior["page_id"],
                "word_count": word_number,
                "claimed_pixels": int(next_claimed.sum()),
                "words": words,
                "page_notes": None,
            }
            published = self._publish_state(
                prior,
                state,
                next_claimed,
                {
                    "type": "commit_word",
                    "rectangles": rectangles,
                    "deselect_rectangles": deselect_rectangles,
                    "ink_variant": ink_variant,
                    "selection_preview_sha256": payload["selection_preview_sha256"],
                    "word_number": word_number,
                    "recovery": recovery_record,
                },
            )
            prior_cache_key = f"{prior['state_sha256']}:{ink_variant}"
            prior_component_cache = self._component_cache.get(prior_cache_key)
            next_component_cache: dict[
                str, tuple[np.ndarray, np.ndarray, int]
            ] = {}
            if (
                self.selection_mode != "source_color_guided"
                and prior_component_cache is not None
                and selected_component_ids
            ):
                labels, available, component_count = prior_component_cache
                lookup = np.zeros(int(component_count) + 1, dtype=bool)
                lookup[selected_component_ids] = True
                selected_source_components = lookup[labels]
                if not np.any(selected_source_components & ~selected):
                    next_labels = labels.copy()
                    next_labels[selected_source_components] = 0
                    next_available = available & ~selected_source_components
                    next_component_cache[
                        f"{published['state_sha256']}:{ink_variant}"
                    ] = (
                        next_labels,
                        next_available,
                        int(component_count),
                    )
            self._component_cache = next_component_cache
            self._selection_preview_cache = None
            self._recovery_preview_cache = None
            return {"committed_word": word, "state": published, "bootstrap": self.bootstrap()}

    def undo_last_word(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {"base_state_sha256"}:
            raise ConsoleError("invalid_action", "Undo needs only the current state")
        with self._locked():
            prior = self._head_state()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError(
                    "stale_action",
                    "The page changed before the last word could be restored",
                    status=409,
                )
            if prior["status"] != "selecting_words":
                raise ConsoleError(
                    "wrong_stage",
                    "Words can be restored only while selecting the page",
                    status=409,
                )
            if not prior["words"]:
                raise ConsoleError("nothing_to_undo", "There is no red word to restore")
            undone = prior["words"][-1]
            claimed = self._claimed(prior)
            restored_mask = self._word_mask(undone)
            next_claimed = claimed & ~restored_mask
            words = list(prior["words"][:-1])
            state = {
                "status": "selecting_words",
                "page_id": prior["page_id"],
                "word_count": len(words),
                "claimed_pixels": int(next_claimed.sum()),
                "words": words,
                "page_notes": prior["page_notes"],
            }
            published = self._publish_state(
                prior,
                state,
                next_claimed,
                {
                    "type": "undo_last_word",
                    "undone_word_number": undone["word_number"],
                    "selected_pixel_sha256": undone["selected_pixel_sha256"],
                    "selected_mask_file_sha256": undone[
                        "selected_mask_file_sha256"
                    ],
                },
            )
            self._component_cache.clear()
            self._selection_preview_cache = None
            self._recovery_preview_cache = None
            return {
                "undone_word": {
                    "word_number": undone["word_number"],
                    "selected_pixels": undone["selected_pixels"],
                },
                "state": published,
                "bootstrap": self.bootstrap(),
            }

    def _word_mask(self, word: Mapping[str, Any]) -> np.ndarray:
        bbox = self._validated_rectangles([word.get("selection_bbox_xywh")])[0]
        x, y, width, height = bbox
        path = self._verify_bound(
            str(word.get("selected_mask_path")),
            str(word.get("selected_mask_file_sha256")),
        )
        local = _load_binary(path, (width, height))
        if (
            sha256_mask_pixels(local) != word.get("selected_pixel_sha256")
            or int(local.sum()) != word.get("selected_pixels")
        ):
            raise ConsoleError(
                "integrity_error",
                "A selected word mask changed before final fitting",
                status=500,
            )
        full = np.zeros((self.size_wh[1], self.size_wh[0]), dtype=bool)
        full[y : y + height, x : x + width] = local
        return full

    def _final_fit(self, selected: np.ndarray, claimed: np.ndarray) -> dict[str, Any]:
        try:
            winner, polygon, fit_crop, fit_trials = self._fit(selected, claimed)
            x, y, width, height = fit_crop
            local_selected = selected[y : y + height, x : x + width]
            local_excluded = (claimed & ~selected)[y : y + height, x : x + width]
            local_polygon = [
                [float(px) - x, float(py) - y]
                for px, py in polygon
            ]
            try:
                refined = refine_existing_envelope(
                    local_selected,
                    local_polygon,
                    local_excluded,
                )
            except EnvelopeError as refinement_error:
                fit_trials = list(fit_trials) + [
                    {
                        "status": "rejected",
                        "method": "refined_existing_envelope",
                        "reason": str(refinement_error),
                    }
                ]
                refined = None
            safe_name = (
                next(
                    (
                        name
                        for name in ("balanced", "compact")
                        if refined["candidates"][name][
                            "excluded_ink_inside_pixels"
                        ]
                        == 0
                    ),
                    None,
                )
                if refined is not None
                else None
            )
            if refined is not None and safe_name is not None:
                candidate = refined["candidates"][safe_name]
                polygon = [
                    [round(float(px) + x, 3), round(float(py) + y, 3)]
                    for px, py in candidate["polygon"]
                ]
                winner = {
                    "profile": "stroke_padded_" + safe_name,
                    "method": "refined_existing_envelope",
                    "selected_ink_coverage": candidate["selected_ink_coverage"],
                    "excluded_ink_contamination": candidate[
                        "excluded_ink_fraction_inside_envelope"
                    ],
                    "envelope_area_px2": candidate["envelope_area_px2"],
                    "selected_component_count": refined[
                        "selected_component_count"
                    ],
                }
                fit_trials = list(fit_trials) + [
                    {
                        "status": "accepted",
                        "method": "refined_existing_envelope",
                        "profile": winner["profile"],
                        "padding_px": candidate["padding_px"],
                        "source": "already_accepted_topology",
                    }
                ]
            fit_quality = "fitted"
            fit_status = "fitted_at_page_finish"
        except ConsoleError as error:
            ys, xs = np.nonzero(selected)
            padding = max(
                36,
                min(
                    120,
                    round(max(int(np.ptp(xs)) + 1, int(np.ptp(ys)) + 1) * 0.22),
                ),
            )
            x0 = max(0, int(xs.min()) - padding)
            y0 = max(0, int(ys.min()) - padding)
            x1 = min(self.size_wh[0], int(xs.max()) + 1 + padding)
            y1 = min(self.size_wh[1], int(ys.max()) + 1 + padding)
            fit_crop = [x0, y0, x1 - x0, y1 - y0]
            local_selected = selected[y0:y1, x0:x1]
            local_excluded = (claimed & ~selected)[y0:y1, x0:x1]
            fit_trials = list((error.details or {}).get("trials", []))
            try:
                fragmented = fit_fragmented_envelope(
                    local_selected,
                    local_excluded,
                )
                safe_name = next(
                    (
                        name
                        for name in ("balanced", "compact")
                        if fragmented["candidates"][name][
                            "excluded_ink_inside_pixels"
                        ]
                        == 0
                    ),
                    None,
                )
                if safe_name is None:
                    raise EnvelopeError(
                        "Every fragmented envelope includes another owned word"
                    )
                candidate = fragmented["candidates"][safe_name]
                polygon = [
                    [round(float(px) + x0, 3), round(float(py) + y0, 3)]
                    for px, py in candidate["polygon"]
                ]
                winner = {
                    "profile": "fragmented_" + safe_name,
                    "method": "component_tree_fragmented_envelope",
                    "selected_ink_coverage": candidate["selected_ink_coverage"],
                    "excluded_ink_contamination": candidate[
                        "excluded_ink_fraction_inside_envelope"
                    ],
                    "envelope_area_px2": candidate["envelope_area_px2"],
                    "selected_component_count": fragmented[
                        "selected_component_count"
                    ],
                }
                fit_trials.append(
                    {
                        "status": "accepted",
                        "method": "component_tree_fragmented_envelope",
                        "profile": safe_name,
                        "geometry_bridges_are_not_owned_ink": True,
                    }
                )
                fit_quality = "fitted_fragmented_selection"
                fit_status = "fitted_at_page_finish"
            except EnvelopeError as fragmented_error:
                x0 = int(xs.min())
                y0 = int(ys.min())
                x1 = int(xs.max()) + 1
                y1 = int(ys.max()) + 1
                polygon = [
                    [float(x0), float(y0)],
                    [float(x1), float(y0)],
                    [float(x1), float(y1)],
                    [float(x0), float(y1)],
                ]
                fit_crop = [x0, y0, x1 - x0, y1 - y0]
                excluded_pixels = int(
                    np.count_nonzero(
                        claimed[y0:y1, x0:x1]
                        & ~selected[y0:y1, x0:x1]
                    )
                )
                selected_pixels = int(selected.sum())
                denominator = max(1, selected_pixels + excluded_pixels)
                winner = {
                    "profile": "selection_only_fallback",
                    "method": "selected_pixel_bbox",
                    "selected_ink_coverage": 1.0,
                    "excluded_ink_contamination": excluded_pixels / denominator,
                    "envelope_area_px2": float((x1 - x0) * (y1 - y0)),
                    "selected_component_count": int(
                        ndimage.label(
                            selected,
                            structure=np.ones((3, 3), dtype=np.uint8),
                        )[1]
                    ),
                }
                fit_trials.append(
                    {
                        "status": "rejected",
                        "method": "component_tree_fragmented_envelope",
                        "reason": str(fragmented_error),
                    }
                )
                fit_quality = "selection_only_fallback"
                fit_status = "fallback_at_page_finish"
        return {
            "fit_status": fit_status,
            "fit_profile": winner["profile"],
            "fit_method": winner["method"],
            "fit_quality": fit_quality,
            "fit_crop_xywh": fit_crop,
            "envelope_polygon": polygon,
            "envelope_polygon_sha256": polygon_checksum(polygon),
            "envelope_metrics": {
                "selected_ink_coverage": winner["selected_ink_coverage"],
                "excluded_ink_contamination": winner[
                    "excluded_ink_contamination"
                ],
                "envelope_area_px2": winner["envelope_area_px2"],
                "selected_component_count": winner["selected_component_count"],
            },
            "fit_trials": fit_trials,
        }

    def finish_words(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {"base_state_sha256"}:
            raise ConsoleError("invalid_action", "Finish needs only the current state")
        with self._locked():
            prior = self._head_state()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError("stale_action", "The page changed before selection was finished", status=409)
            if prior["status"] != "selecting_words":
                raise ConsoleError("wrong_stage", "Word selection is already finished", status=409)
            if prior["word_count"] < 1:
                raise ConsoleError("empty_page", "Select at least one word before finishing")
            claimed = self._claimed(prior)
            words = [dict(word) for word in prior["words"]]
            fitted_word_count = 0
            for word in words:
                if word.get("envelope_polygon") is not None:
                    continue
                word.update(self._final_fit(self._word_mask(word), claimed))
                fitted_word_count += 1
            state = {
                "page_id": prior["page_id"],
                "word_count": prior["word_count"],
                "claimed_pixels": prior["claimed_pixels"],
                "words": words,
                "page_notes": prior["page_notes"],
            }
            state["status"] = "page_notes"
            published = self._publish_state(
                prior,
                state,
                claimed,
                {
                    "type": "finish_words_and_fit_boxes",
                    "fitted_word_count": fitted_word_count,
                },
            )
            return {"state": published, "bootstrap": self.bootstrap()}

    def save_page_notes(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {"base_state_sha256", "summary", "items"}:
            raise ConsoleError("invalid_notes", "Page notes need the current state, summary, and crop notes")
        summary = payload.get("summary")
        items = payload.get("items")
        if not isinstance(summary, str) or len(summary) > 10_000 or not isinstance(items, list) or len(items) > MAX_NOTES:
            raise ConsoleError("invalid_notes", "The final page notes exceed their limits")
        normalized: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, Mapping) or set(item) != {"text", "bbox_xywh"} or not isinstance(item.get("text"), str) or len(item["text"]) > MAX_NOTE_CHARS:
                raise ConsoleError("invalid_notes", "A crop note is invalid")
            bbox = item.get("bbox_xywh")
            if bbox is not None:
                bbox = self._validated_rectangles([bbox])[0]
            normalized.append({"text": item["text"].strip(), "bbox_xywh": bbox})
        with self._locked():
            prior = self._head_state()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError("stale_action", "The page changed before the notes were saved", status=409)
            if prior["status"] != "page_notes":
                raise ConsoleError("wrong_stage", "Final notes are not available in this stage", status=409)
            notes_dir = self.session_dir / "page-notes"
            notes_dir.mkdir(exist_ok=False)
            working_path = self._verify_bound(self.manifest["source"]["working_path"], self.manifest["source"]["working_file_sha256"])
            with Image.open(working_path) as source:
                source.load()
                for index, item in enumerate(normalized, start=1):
                    if item["bbox_xywh"] is None:
                        continue
                    x, y, width, height = item["bbox_xywh"]
                    path = notes_dir / f"crop-{index:02d}.png"
                    source.crop((x, y, x + width, y + height)).save(path, format="PNG")
                    item["crop_path"] = str(path.relative_to(self.session_dir))
                    item["crop_file_sha256"] = sha256_file(path)
            record = {"schema_version": "simple-page-notes.v1", "summary": summary.strip(), "items": normalized}
            record["notes_sha256"] = _hash_record(record, "notes_sha256")
            _write_json_new(notes_dir / "notes.json", record)
            state = {key: prior[key] for key in ("page_id", "word_count", "claimed_pixels", "words")}
            state.update({"status": "complete", "page_notes": {"path": "page-notes/notes.json", "file_sha256": sha256_file(notes_dir / "notes.json"), "notes_sha256": record["notes_sha256"]}})
            published = self._publish_state(prior, state, self._claimed(prior), {"type": "save_page_notes", "notes_sha256": record["notes_sha256"]})
            return {"state": published, "bootstrap": self.bootstrap()}


def initialize_uploaded_simple_selector(
    workspace_dir: Path | str,
    data: bytes,
) -> SimplePageSelector:
    workspace = Path(workspace_dir).resolve()
    if not workspace.is_dir() or workspace.is_symlink():
        raise ConsoleError("unsafe_workspace", "The selector workspace is unsafe", status=500)
    if not isinstance(data, bytes) or not data or len(data) > MAX_UPLOADED_IMAGE_BYTES:
        raise ConsoleError("invalid_image", "Choose an image smaller than 25 MB")
    try:
        with Image.open(BytesIO(data)) as opened:
            if getattr(opened, "n_frames", 1) != 1:
                raise ConsoleError("invalid_image", "Animated images are not supported")
            opened.load()
            if (
                opened.width < 64
                or opened.height < 64
                or opened.width > MAX_UPLOADED_IMAGE_EDGE
                or opened.height > MAX_UPLOADED_IMAGE_EDGE
                or opened.width * opened.height > MAX_UPLOADED_IMAGE_PIXELS
            ):
                raise ConsoleError(
                    "invalid_image",
                    "Choose an image between 64 px and 8,000 px per edge",
                )
            source = opened.convert("RGB")
    except ConsoleError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise ConsoleError("invalid_image", "That file is not a supported image") from error

    clean, high_recall = derive_uploaded_dual_ink(source)
    token = secrets.token_hex(6)
    staging = Path(
        tempfile.mkdtemp(prefix=f".simple-selector-upload-{token}-", dir=workspace)
    )
    target = workspace / f"uploaded-{token}"
    try:
        source_path = staging / "source.png"
        clean_path = staging / "clean.png"
        high_path = staging / "high-recall.png"
        source.save(source_path, format="PNG", compress_level=6)
        _save_binary(clean_path, clean)
        _save_binary(high_path, high_recall)
        initialize_simple_selector(
            target,
            page_id=f"uploaded-{token}",
            source_path=source_path,
            strong_mask_path=high_path,
        )
        install_dual_ink_layers(
            target,
            clean_mask_path=clean_path,
            high_recall_mask_path=high_path,
        )
        return SimplePageSelector(target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def reset_simple_selector(selector: SimplePageSelector) -> SimplePageSelector:
    workspace = selector.session_dir.parent
    token = secrets.token_hex(6)
    page_id = f"{selector.manifest['page_id']}-reset-{token}"
    target = workspace / page_id
    source_path = selector.session_dir / selector.manifest["source"]["working_path"]
    if selector.ink_layers is None:
        initialize_simple_selector(
            target,
            page_id=page_id,
            source_path=source_path,
            strong_mask_path=selector.session_dir / "source/strong.mask.png",
            selection_mode=str(selector.manifest["protocol"]["selection_mode"]),
        )
    else:
        clean_path = selector.session_dir / selector.ink_layers["layers"]["clean"][
            "mask_path"
        ]
        high_path = selector.session_dir / selector.ink_layers["layers"][
            "high_recall"
        ]["mask_path"]
        initialize_simple_selector(
            target,
            page_id=page_id,
            source_path=source_path,
            strong_mask_path=high_path,
        )
        install_dual_ink_layers(
            target,
            clean_mask_path=clean_path,
            high_recall_mask_path=high_path,
        )
    return SimplePageSelector(target)


def _write_json_replace(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(canonical_json_bytes(dict(value)) + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


class SimpleSelectorLibrary:
    """Internal Letter Archive pages with one resumable active run per page."""

    def __init__(
        self,
        workspace_dir: Path | str,
        current_selector: SimplePageSelector,
        *,
        catalog: PipelineSourceCatalog | None = None,
    ) -> None:
        self.workspace_dir = Path(workspace_dir).resolve()
        self.catalog = catalog or PipelineSourceCatalog()
        self.registry_path = self.workspace_dir / "simple-selector-library.json"
        self.thumbnail_dir = self.workspace_dir / ".library-thumbnails"
        self.registry = self._load_registry()
        self.active_catalog_item_id = self._attach_current(current_selector)

    def _empty_registry(self) -> dict[str, Any]:
        return {
            "schema_version": LIBRARY_SCHEMA,
            "catalog_revision": self.catalog.catalog_revision,
            "items": {},
        }

    def _load_registry(self) -> dict[str, Any]:
        if not self.registry_path.exists():
            value = self._empty_registry()
            _write_json_replace(self.registry_path, value)
            return value
        value = _read_json(self.registry_path)
        if (
            value.get("schema_version") != LIBRARY_SCHEMA
            or not isinstance(value.get("items"), dict)
        ):
            raise ConsoleError(
                "integrity_error",
                "The saved image library is unreadable",
                status=500,
            )
        if value.get("catalog_revision") != self.catalog.catalog_revision:
            value["catalog_revision"] = self.catalog.catalog_revision
            _write_json_replace(self.registry_path, value)
        return value

    def _save(self) -> None:
        _write_json_replace(self.registry_path, self.registry)

    @staticmethod
    def _decoded_source_sha256(path: Path) -> str:
        with Image.open(path) as opened:
            opened.load()
            rgb = opened.convert("RGB")
        digest = hashlib.sha256()
        digest.update(f"{rgb.width}x{rgb.height}:RGB:".encode("ascii"))
        digest.update(rgb.tobytes())
        return digest.hexdigest()

    def _candidate_for_selector(self, selector: SimplePageSelector) -> str | None:
        page_id = str(selector.manifest["page_id"])
        match = re.search(r"(?P<collection>[0-9]{3})-p(?P<page>[0-9]{2})", page_id)
        if not match:
            return None
        prefix = f"{match.group('collection')}-"
        suffix = f"-{match.group('page')}"
        choices = [
            item["catalog_item_id"]
            for item in self.catalog.public_listing()["items"]
            if item["catalog_item_id"].startswith(prefix)
            and item["catalog_item_id"].endswith(suffix)
        ]
        if len(choices) == 1:
            return choices[0]
        if not choices:
            return None
        current_path = selector.session_dir / selector.manifest["source"]["working_path"]
        current_sha256 = self._decoded_source_sha256(current_path)
        matches = []
        for catalog_item_id in choices:
            try:
                resolved = self.catalog.resolve_catalog_source(catalog_item_id)
                if self._decoded_source_sha256(resolved.absolute_path) == current_sha256:
                    matches.append(catalog_item_id)
            except (PipelineSourceError, OSError):
                continue
        return matches[0] if len(matches) == 1 else None

    def _attach_current(self, selector: SimplePageSelector) -> str | None:
        for catalog_item_id, record in self.registry["items"].items():
            if record.get("active_session") == selector.session_dir.name:
                return catalog_item_id
        candidate = self._candidate_for_selector(selector)
        if candidate is None:
            return None
        record = self.registry["items"].setdefault(
            candidate,
            {"active_session": selector.session_dir.name, "prior_sessions": []},
        )
        if record.get("active_session") != selector.session_dir.name:
            return None
        self._save()
        return candidate

    def _record_selector(self, catalog_item_id: str) -> SimplePageSelector | None:
        record = self.registry["items"].get(catalog_item_id)
        if not isinstance(record, dict):
            return None
        name = record.get("active_session")
        if not isinstance(name, str) or Path(name).name != name:
            raise ConsoleError("integrity_error", "A saved library run is unsafe", status=500)
        path = self.workspace_dir / name
        if not path.is_dir() or path.is_symlink():
            raise ConsoleError("integrity_error", "A saved library run is missing", status=500)
        return SimplePageSelector(path)

    def listing(self) -> dict[str, Any]:
        listing = self.catalog.public_listing()
        items = []
        for item in listing["items"]:
            catalog_item_id = item["catalog_item_id"]
            selector = self._record_selector(catalog_item_id)
            saved = None
            if selector is not None:
                state = selector.bootstrap()["state"]
                saved = {
                    "word_count": state["word_count"],
                    "status": state["status"],
                    "is_active": catalog_item_id == self.active_catalog_item_id,
                }
            items.append(
                {
                    **item,
                    "thumbnail_url": f"/api/library-thumbnail/{catalog_item_id}",
                    "saved_progress": saved,
                }
            )
        items.sort(
            key=lambda item: (
                0
                if item["saved_progress"] and item["saved_progress"]["is_active"]
                else 1
                if item["saved_progress"]
                else 2,
                item["catalog_item_id"],
            )
        )
        return {
            "schema_version": "simple-selector-library-listing.v1",
            "catalog_revision": listing["catalog_revision"],
            "count": listing["count"],
            "active_catalog_item_id": self.active_catalog_item_id,
            "items": items,
        }

    def thumbnail(self, catalog_item_id: str) -> bytes:
        target = self.thumbnail_dir / f"{catalog_item_id}.jpg"
        if target.is_file() and not target.is_symlink():
            return target.read_bytes()
        resolved = self.catalog.resolve_catalog_source(catalog_item_id)
        with Image.open(resolved.absolute_path) as opened:
            opened.load()
            preview = opened.convert("RGB")
            preview.thumbnail((360, 280), Image.Resampling.LANCZOS)
        self.thumbnail_dir.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{secrets.token_hex(6)}.tmp")
        try:
            preview.save(temporary, format="JPEG", quality=82, optimize=True)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return target.read_bytes()

    def _initialize_catalog_item(self, catalog_item_id: str) -> SimplePageSelector:
        resolved = self.catalog.resolve_catalog_source(catalog_item_id)
        with Image.open(resolved.absolute_path) as opened:
            opened.load()
            source = opened.convert("RGB")
        clean, high_recall = derive_uploaded_dual_ink(source)
        token = secrets.token_hex(6)
        staging = Path(
            tempfile.mkdtemp(prefix=f".library-{catalog_item_id}-", dir=self.workspace_dir)
        )
        target = self.workspace_dir / f"library-{catalog_item_id}-{token}"
        try:
            source_path = staging / "source.png"
            clean_path = staging / "clean.png"
            high_path = staging / "high-recall.png"
            source.save(source_path, format="PNG", compress_level=6)
            _save_binary(clean_path, clean)
            _save_binary(high_path, high_recall)
            initialize_simple_selector(
                target,
                page_id=catalog_item_id,
                source_path=source_path,
                strong_mask_path=high_path,
            )
            install_dual_ink_layers(
                target,
                clean_mask_path=clean_path,
                high_recall_mask_path=high_path,
            )
            return SimplePageSelector(target)
        except BaseException:
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def open_item(self, catalog_item_id: str, catalog_revision: str) -> SimplePageSelector:
        if catalog_revision != self.catalog.catalog_revision:
            raise ConsoleError("stale_library", "The image library changed; reopen it", status=409)
        try:
            selector = self._record_selector(catalog_item_id)
            if selector is None:
                selector = self._initialize_catalog_item(catalog_item_id)
                self.registry["items"][catalog_item_id] = {
                    "active_session": selector.session_dir.name,
                    "prior_sessions": [],
                }
                self._save()
        except (PipelineSourceError, OSError) as error:
            raise ConsoleError("library_image_failed", "That library image could not be opened") from error
        self.active_catalog_item_id = catalog_item_id
        return selector

    def reset_active(self, selector: SimplePageSelector) -> SimplePageSelector:
        replacement = reset_simple_selector(selector)
        catalog_item_id = self.active_catalog_item_id
        if catalog_item_id is not None:
            record = self.registry["items"][catalog_item_id]
            prior = record.setdefault("prior_sessions", [])
            prior.append(record["active_session"])
            record["active_session"] = replacement.session_dir.name
            self._save()
        return replacement


class SimpleSelectorServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], selector: SimplePageSelector, static_dir: Path):
        self.selector = selector
        self.workspace_dir = selector.session_dir.parent
        self.workspace_lock = threading.RLock()
        self.library = SimpleSelectorLibrary(self.workspace_dir, selector)
        self.static_dir = static_dir.resolve()
        self.csrf_token = secrets.token_urlsafe(32)
        super().__init__(address, SimpleSelectorHandler)


class SimpleSelectorHandler(BaseHTTPRequestHandler):
    server: SimpleSelectorServer

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _trusted(self) -> bool:
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0].strip("[]")
        return hostname in {"127.0.0.1", "localhost", "::1"}

    def _json(self, status: int, value: Mapping[str, Any]) -> None:
        body = canonical_json_bytes(dict(value)) + b"\n"
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, error: ConsoleError) -> None:
        self._json(error.status, {"ok": False, "error": {"code": error.code, "message": error.message, "details": error.details}})

    def _payload(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ConsoleError("invalid_json", "The request length is invalid") from error
        if length < 2 or length > 1_000_000:
            raise ConsoleError("invalid_json", "The request body is invalid")
        try:
            value = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ConsoleError("invalid_json", "The request body is invalid JSON") from error
        if not isinstance(value, dict):
            raise ConsoleError("invalid_json", "The request body must be an object")
        return value

    def _uploaded_image(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ConsoleError("invalid_image", "The image length is invalid") from error
        if length < 1 or length > MAX_UPLOADED_IMAGE_BYTES:
            raise ConsoleError("invalid_image", "Choose an image smaller than 25 MB")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise ConsoleError("invalid_image", "Choose a JPEG, PNG, or WebP image")
        data = self.rfile.read(length)
        if len(data) != length:
            raise ConsoleError("invalid_image", "The image upload was incomplete")
        return data

    def _guard(self, post: bool = False) -> None:
        if not self._trusted():
            raise ConsoleError("untrusted_host", "This local selector accepts only localhost requests", status=403)
        if post and self.headers.get("X-Selector-CSRF-Token") != self.server.csrf_token:
            raise ConsoleError("csrf_denied", "The selector security token is missing or stale", status=403)

    def do_GET(self) -> None:
        try:
            self._guard()
            parsed = urlparse(self.path)
            if parsed.path == "/api/bootstrap":
                with self.server.workspace_lock:
                    data = self.server.selector.bootstrap()
                data["csrf_token"] = self.server.csrf_token
                self._json(200, {"ok": True, "data": data})
                return
            if parsed.path == "/api/library":
                with self.server.workspace_lock:
                    data = self.server.library.listing()
                self._json(200, {"ok": True, "data": data})
                return
            if parsed.path.startswith("/api/library-thumbnail/"):
                catalog_item_id = parsed.path.rsplit("/", 1)[-1]
                with self.server.workspace_lock:
                    try:
                        data = self.server.library.thumbnail(catalog_item_id)
                    except PipelineSourceError as error:
                        raise ConsoleError(
                            "not_found",
                            "That library image was not found",
                            status=404,
                        ) from error
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "private, max-age=86400")
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == "/favicon.ico":
                self.send_response(HTTPStatus.NO_CONTENT)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if parsed.path.startswith("/api/asset/"):
                kind = parsed.path.rsplit("/", 1)[-1]
                revision = None
                if "revision=" in parsed.query:
                    try:
                        revision = int(parsed.query.split("revision=", 1)[1].split("&", 1)[0])
                    except ValueError as error:
                        raise ConsoleError("unknown_asset", "The requested selector image is invalid", status=404) from error
                with self.server.workspace_lock:
                    path, media = self.server.selector.asset_path(kind, revision)
                    data = path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", media)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            relative = "index.html" if parsed.path in {"", "/"} else parsed.path.lstrip("/")
            path = (self.server.static_dir / relative).resolve()
            if self.server.static_dir not in path.parents or not path.is_file() or path.is_symlink():
                raise ConsoleError("not_found", "That page was not found", status=404)
            media = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}.get(path.suffix, "application/octet-stream")
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", media)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except ConsoleError as error:
            self._error(error)

    def do_POST(self) -> None:
        try:
            self._guard(post=True)
            endpoint = urlparse(self.path).path
            if endpoint == "/api/change-image":
                uploaded = self._uploaded_image()
                with self.server.workspace_lock:
                    previous = self.server.selector.session_dir.name
                    replacement = initialize_uploaded_simple_selector(
                        self.server.workspace_dir,
                        uploaded,
                    )
                    self.server.selector = replacement
                    result = {
                        "bootstrap": replacement.bootstrap(),
                        "previous_session": previous,
                        "current_session": replacement.session_dir.name,
                    }
            else:
                payload = self._payload()
                with self.server.workspace_lock:
                    if endpoint == "/api/open-library-item":
                        if set(payload) != {"catalog_item_id", "catalog_revision"}:
                            raise ConsoleError(
                                "invalid_action",
                                "Choose one image from the current library",
                            )
                        previous = self.server.selector.session_dir.name
                        replacement = self.server.library.open_item(
                            payload["catalog_item_id"],
                            payload["catalog_revision"],
                        )
                        self.server.selector = replacement
                        result = {
                            "bootstrap": replacement.bootstrap(),
                            "previous_session": previous,
                            "current_session": replacement.session_dir.name,
                            "resumed": replacement.bootstrap()["state"]["revision"] > 0,
                        }
                    elif endpoint == "/api/reset-page":
                        if set(payload) != {"base_state_sha256"}:
                            raise ConsoleError(
                                "invalid_action",
                                "Reset needs only the current page state",
                            )
                        current_state = self.server.selector.bootstrap()["state"]
                        if payload["base_state_sha256"] != current_state["state_sha256"]:
                            raise ConsoleError(
                                "stale_action",
                                "The page changed before it could be reset",
                                status=409,
                            )
                        previous = self.server.selector.session_dir.name
                        replacement = self.server.library.reset_active(
                            self.server.selector
                        )
                        self.server.selector = replacement
                        result = {
                            "bootstrap": replacement.bootstrap(),
                            "previous_session": previous,
                            "current_session": replacement.session_dir.name,
                        }
                    elif endpoint == "/api/commit-word":
                        result = self.server.selector.commit_word(payload)
                    elif endpoint == "/api/undo-last-word":
                        result = self.server.selector.undo_last_word(payload)
                    elif endpoint == "/api/preview-selection":
                        result = self.server.selector.preview_selection(payload)
                    elif endpoint == "/api/preview-recovery":
                        result = self.server.selector.preview_recovery(payload)
                    elif endpoint == "/api/choose-recovery":
                        result = self.server.selector.choose_recovery(payload)
                    elif endpoint == "/api/preview-cut":
                        result = self.server.selector.preview_cut(payload)
                    elif endpoint == "/api/commit-cut":
                        result = self.server.selector.commit_cut(payload)
                    elif endpoint == "/api/apply-cut":
                        result = self.server.selector.apply_cut(payload)
                    elif endpoint == "/api/finish-words":
                        result = self.server.selector.finish_words(payload)
                    elif endpoint == "/api/page-notes":
                        result = self.server.selector.save_page_notes(payload)
                    else:
                        raise ConsoleError("not_found", "That action was not found", status=404)
            self._json(200, {"ok": True, "data": result})
        except ConsoleError as error:
            self._error(error)


def serve_simple_selector(session_dir: Path | str, *, host: str = "127.0.0.1", port: int = 8770, static_dir: Path | str | None = None) -> None:
    selector = SimplePageSelector(session_dir)
    static = Path(static_dir).resolve() if static_dir is not None else Path(__file__).resolve().parents[2] / "simple_selector"
    server = SimpleSelectorServer((host, port), selector, static)
    print(f"Simple page selector: http://{host}:{server.server_address[1]}", flush=True)
    server.serve_forever()
