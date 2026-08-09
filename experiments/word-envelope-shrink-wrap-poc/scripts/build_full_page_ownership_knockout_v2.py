#!/usr/bin/env python3
"""Build candidate ink ownership and knockout diagnostics for pass 2.

This stage is deliberately conservative.  A pass-1 rectangle can propose ink,
but it cannot approve it.  Pixels present in two or more rectangles are left in
the residual and reported as collisions.  All uses of "exact" in the output
mean exact subtraction of these software-generated candidate masks, not exact
semantic ownership and not ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi
from skimage import filters, measure


ROOT = Path(__file__).resolve().parents[1]
TRIAL = ROOT / "artifacts/full-page-supervisor-trial-v2"
SCHEMA_VERSION = "full-page-ownership-knockout.v2"
MANIFEST_VERSION = "full-page-ownership-knockout-manifest.v2"
MASK_WARNING = (
    "Software-generated ink and ownership candidates only; never approved "
    "semantic ownership or ground truth."
)
COLLISION_WARNING = (
    "Every pixel proposed by multiple unit boxes is withheld from every unit "
    "candidate and remains in the residual."
)
RED = np.array([222, 50, 42], dtype=np.uint8)
ORANGE = np.array([244, 139, 31], dtype=np.uint8)
BLUE = (8, 104, 172)
LOW_RES_WIDTH = 1200
RESIDUAL_MIN_AREA = 4


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def mask_pixel_hash(mask: np.ndarray) -> str:
    binary = np.asarray(mask, dtype=bool)
    digest = hashlib.sha256()
    digest.update(
        f"{binary.shape[1]}x{binary.shape[0]}:row-major-bitpack-v1\n".encode()
    )
    digest.update(np.packbits(binary, axis=None, bitorder="little").tobytes())
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )


def save_mask(path: Path, mask: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.asarray(mask, dtype=np.uint8) * 255, mode="L").save(
        path, format="PNG", compress_level=9, optimize=False
    )


def font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _resolve_packet_path(packet_path: Path, value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    root_candidate = ROOT / candidate
    if root_candidate.exists():
        return root_candidate
    return packet_path.parent / candidate


def _validate_bound_inputs(
    decision_path: Path, packet_path: Path, validation_path: Path
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], Path]:
    for path in (decision_path, packet_path, validation_path):
        if not path.is_file():
            raise RuntimeError(f"Required bound input is missing: {path}")
    decision = json.loads(decision_path.read_text(encoding="utf-8"))
    packet = json.loads(packet_path.read_text(encoding="utf-8"))
    validation = json.loads(validation_path.read_text(encoding="utf-8"))

    if validation.get("status") != "pass":
        raise RuntimeError("Pass-1 validation status must be exactly 'pass'")
    if decision.get("page_id") != packet.get("page_id") or validation.get(
        "page_id"
    ) != decision.get("page_id"):
        raise RuntimeError("Decision, packet, and validation page IDs do not match")
    if decision.get("hidden_prior_answer_access") is not False:
        raise RuntimeError("Pass-1 decision did not preserve answer blindness")

    packet_claim = packet.get("packet_sha256")
    packet_without_hash = dict(packet)
    packet_without_hash.pop("packet_sha256", None)
    if not isinstance(packet_claim, str) or packet_claim != canonical_hash(
        packet_without_hash
    ):
        raise RuntimeError("Public packet's internal packet_sha256 is stale")
    packet_file_hash = sha256_file(packet_path)
    if decision.get("public_packet_sha256") != packet_file_hash:
        raise RuntimeError("Pass-1 decision does not bind this exact public packet file")
    if validation.get("public_packet_sha256") != packet_file_hash:
        raise RuntimeError("Validation does not bind this exact public packet file")
    validation_internal = validation.get("public_packet_internal_sha256")
    if validation_internal is not None and validation_internal != packet_claim:
        raise RuntimeError("Validation internal packet hash does not match")

    decision_file_hash = sha256_file(decision_path)
    if validation.get("decision_file_sha256") != decision_file_hash:
        raise RuntimeError("Validation decision_file_sha256 does not match")
    decision_canonical_hash = canonical_hash(decision)
    if validation.get("decision_canonical_sha256") != decision_canonical_hash:
        raise RuntimeError("Validation decision_canonical_sha256 does not match")

    validation_claim = validation.get("validation_sha256")
    validation_without_hash = dict(validation)
    validation_without_hash.pop("validation_sha256", None)
    if not isinstance(validation_claim, str) or validation_claim != canonical_hash(
        validation_without_hash
    ):
        raise RuntimeError("Pass-1 validation_sha256 is stale")

    source = packet.get("source", {})
    source_path = _resolve_packet_path(packet_path, source.get("path", ""))
    if not source_path.is_file():
        raise RuntimeError(f"Bound source is missing: {source_path}")
    source_hash = sha256_file(source_path)
    if source_hash != source.get("sha256"):
        raise RuntimeError("Bound source file hash changed")
    if decision.get("source_sha256") != source_hash or validation.get(
        "source_sha256"
    ) != source_hash:
        raise RuntimeError("Decision or validation does not bind the source")
    with Image.open(source_path) as source_image:
        if list(source_image.size) != source.get("size"):
            raise RuntimeError("Bound source dimensions changed")
    return decision, packet, validation, source_path


def _remove_small_components(mask: np.ndarray, minimum_area: int) -> tuple[np.ndarray, int]:
    labels = measure.label(mask, connectivity=2)
    counts = np.bincount(labels.ravel())
    keep = counts >= minimum_area
    if keep.size:
        keep[0] = False
    filtered = keep[labels]
    removed = int(np.count_nonzero(mask) - np.count_nonzero(filtered))
    return filtered, removed


def _derive_007_blue_mask(source: Image.Image) -> tuple[np.ndarray, dict[str, Any]]:
    rgb = np.asarray(source.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    # The photographic surround has a cool blue cast too.  Derive a broad page
    # support region from a heavily blurred image, keep its largest warm-paper
    # component, and fill handwriting/fold holes before applying the pen rule.
    smoothed = np.asarray(
        source.convert("RGB").filter(ImageFilter.GaussianBlur(radius=24)),
        dtype=np.int16,
    )
    warm_seed = (
        (smoothed[:, :, 0] - smoothed[:, :, 2] >= 4)
        & (smoothed[:, :, 0] - smoothed[:, :, 1] >= 1)
    )
    page_labels = measure.label(warm_seed, connectivity=2)
    page_counts = np.bincount(page_labels.ravel())
    if page_counts.size <= 1:
        raise RuntimeError("007 warm-paper support did not contain a page component")
    page_counts[0] = 0
    page_label = int(np.argmax(page_counts))
    page_support = ndi.binary_fill_holes(page_labels == page_label)
    # Explicit, stable RGB rules: blue pen is substantially bluer than the tan
    # paper and darker than the neutral photographic surround.
    raw = (
        (blue - red >= 8)
        & (blue - green >= 2)
        & (red <= 190)
        & (green <= 200)
        & (blue >= 35)
        & page_support
    )
    filtered, removed = _remove_small_components(raw, minimum_area=3)
    return filtered, {
        "method": "explicit_blue_rgb_rule_v1",
        "parameters": {
            "blue_minus_red_min": 8,
            "blue_minus_green_min": 2,
            "red_max": 190,
            "green_max": 200,
            "blue_min": 35,
            "connectivity": 8,
            "minimum_component_area_px": 3,
            "page_support_blur_radius_px": 24,
            "page_support_red_minus_blue_min": 4,
            "page_support_red_minus_green_min": 1,
            "page_support_component_policy": "largest_8_connected_then_fill_holes",
        },
        "page_support_pixels": int(page_support.sum()),
        "page_support_pixel_sha256": mask_pixel_hash(page_support),
        "raw_foreground_pixels": int(raw.sum()),
        "raw_pixel_sha256": mask_pixel_hash(raw),
        "small_speck_pixels_removed": removed,
    }


def _packet_geometry_window(
    packet: dict[str, Any], source_size: tuple[int, int], *, padding_fraction: float
) -> list[int]:
    boxes = [
        proposal["source_axis_aligned_bbox_xywh"]
        for line in packet["lines"]
        for proposal in line["box_proposals"]
    ]
    if not boxes:
        return [0, 0, source_size[0], source_size[1]]
    width, height = source_size
    pad_x = max(32, round(width * padding_fraction))
    pad_y = max(32, round(height * padding_fraction))
    left = max(0, min(box[0] for box in boxes) - pad_x)
    top = max(0, min(box[1] for box in boxes) - pad_y)
    right = min(width, max(box[0] + box[2] for box in boxes) + pad_x)
    bottom = min(height, max(box[1] + box[3] for box in boxes) + pad_y)
    return [left, top, right - left, bottom - top]


def _derive_014_paper_support(source: Image.Image) -> tuple[np.ndarray, dict[str, Any]]:
    """Derive a conservative page-support proposal from source appearance only.

    The packet mask can contain table texture as foreground.  It is not safe to
    use pass-1 boxes (or any other proposal geometry) to remove that texture:
    those boxes are precisely what the residual pass must be allowed to
    challenge.  Instead, identify the largest light, low-chroma region in a
    heavily smoothed source image, fill its ink/fold holes, then add a tiny
    source-independent edge guard so marginal ink *on the page* is retained.
    The result remains software support, not semantic truth.
    """
    shortest_side = min(source.size)
    blur_radius = max(8, round(shortest_side * 0.0125))
    smoothed = np.asarray(
        source.convert("RGB").filter(ImageFilter.GaussianBlur(radius=blur_radius)),
        dtype=np.int16,
    )
    chroma = smoothed.max(axis=2) - smoothed.min(axis=2)
    lightness = smoothed.mean(axis=2)
    chroma_span = int(chroma.max()) - int(chroma.min())
    lightness_span = float(lightness.max() - lightness.min())
    if chroma_span == 0 and lightness_span == 0:
        # A source with no observable appearance boundary has no evidence of a
        # tabletop.  Keeping the whole raster is the only non-geometric,
        # deterministic and lossless support proposal available for that case.
        support = np.ones(lightness.shape, dtype=bool)
        return support, {
            "method": "uniform_source_full_raster_support_v1",
            "parameters": {
                "page_support_blur_radius_px": blur_radius,
                "edge_guard_dilation_px": 0,
            },
            "warning": "No source appearance boundary was observable; support is software-only and unfiltered.",
            "seed_pixels": int(support.sum()),
            "filled_component_pixels": int(support.sum()),
        }

    chroma_otsu_threshold = float(filters.threshold_otsu(chroma))
    # Otsu can split a nearly uniform warm paper into its harmless JPEG/ink
    # variation rather than separating it from a surround.  Never set the
    # chroma ceiling below the source median: in that case brightness supplies
    # the page/background split, while a genuinely more-chromatic surround is
    # still excluded on real photographed pages.
    chroma_threshold = max(chroma_otsu_threshold, float(np.median(chroma)))
    lightness_threshold = float(filters.threshold_otsu(lightness))
    # Require both characteristics.  The largest connected component makes the
    # support independent of any text/box proposal and rejects small pale table
    # highlights without deciding what any ink means.
    seed = (chroma <= chroma_threshold) & (lightness >= lightness_threshold)
    labels = measure.label(seed, connectivity=2)
    counts = np.bincount(labels.ravel())
    if counts.size <= 1:
        raise RuntimeError("014 source-derived paper support did not contain a page component")
    counts[0] = 0
    page_label = int(np.argmax(counts))
    if counts[page_label] == 0:
        raise RuntimeError("014 source-derived paper support did not contain a page component")
    filled = ndi.binary_fill_holes(labels == page_label)
    # The support is derived from blurred paper colour, so it can stop just
    # inside a dark physical edge.  A two-pixel guard protects handwritten ink
    # immediately inside that edge; it is not based on packet geometry.
    edge_guard = 2
    support = ndi.binary_dilation(filled, iterations=edge_guard)
    return support, {
        "method": "largest_light_low_chroma_source_component_v1",
        "parameters": {
            "page_support_blur_radius_px": blur_radius,
            "chroma_otsu_threshold": chroma_otsu_threshold,
            "chroma_threshold": chroma_threshold,
            "lightness_threshold": lightness_threshold,
            "connectivity": 8,
            "component_policy": "largest_8_connected_then_fill_holes",
            "edge_guard_dilation_px": edge_guard,
        },
        "source_chroma_range": [int(chroma.min()), int(chroma.max())],
        "source_lightness_range": [round(float(lightness.min()), 3), round(float(lightness.max()), 3)],
        "seed_pixels": int(seed.sum()),
        "largest_component_seed_pixels": int(counts[page_label]),
        "filled_component_pixels": int(filled.sum()),
    }


def _normalize_014_mask(
    mask_path: Path, source: Image.Image
) -> tuple[np.ndarray, dict[str, Any]]:
    with Image.open(mask_path) as image:
        grayscale = np.asarray(image.convert("L"), dtype=np.uint8)
    if (grayscale.shape[1], grayscale.shape[0]) != source.size:
        raise RuntimeError("Packet-bound 014 ink mask dimensions do not match source")
    unique = np.unique(grayscale)
    if unique.size == 1:
        threshold = float(unique[0])
        dark = grayscale < 128
        bright = grayscale >= 128
    else:
        threshold = float(filters.threshold_otsu(grayscale))
        dark = grayscale <= threshold
        bright = grayscale > threshold
    dark_count = int(dark.sum())
    bright_count = int(bright.sum())
    # Foreground must be the minority class.  This is explicit rather than
    # relying on PNG palette conventions or assuming white means ink.
    if dark_count == bright_count:
        raise RuntimeError("014 mask polarity is ambiguous: equal class sizes")
    polarity = "dark_foreground" if dark_count < bright_count else "bright_foreground"
    raw_foreground = dark if polarity == "dark_foreground" else bright
    paper_support, support_record = _derive_014_paper_support(source)
    normalized = raw_foreground & paper_support
    suppressed_outside_paper = raw_foreground & ~paper_support
    # Preserve fail-closed, exact accounting.  A normalizer may only partition
    # packet-mask foreground into retained and explicitly suppressed pixels.
    if int(raw_foreground.sum()) != int(normalized.sum()) + int(suppressed_outside_paper.sum()):
        raise RuntimeError("014 page-support normalization failed exact foreground accounting")
    if np.any(normalized & suppressed_outside_paper):
        raise RuntimeError("014 page-support normalization produced overlapping partitions")
    return normalized, {
        # Preserve the bound-mask polarity method identifier for consumers that
        # only need to know how the packet mask was decoded.  The separately
        # named normalizer records the additional source-derived support stage.
        "method": "packet_bound_mask_explicit_otsu_polarity_v1",
        "normalization_method": "source_derived_paper_support_v2",
        "input_path": str(mask_path),
        "input_file_sha256": sha256_file(mask_path),
        "input_min": int(grayscale.min()),
        "input_max": int(grayscale.max()),
        "input_unique_value_count": int(unique.size),
        "otsu_threshold": threshold,
        "dark_class_pixels": dark_count,
        "bright_class_pixels": bright_count,
        "selected_polarity": polarity,
        "selection_rule": "minority_class_is_foreground_proposal",
        "raw_foreground_pixels": int(raw_foreground.sum()),
        "raw_foreground_pixel_sha256": mask_pixel_hash(raw_foreground),
        "paper_support": support_record,
        "paper_support_pixels": int(paper_support.sum()),
        "paper_support_pixel_sha256": mask_pixel_hash(paper_support),
        "retained_within_paper_pixels": int(normalized.sum()),
        "suppressed_outside_paper_pixels": int(suppressed_outside_paper.sum()),
        "suppressed_outside_paper_pixel_sha256": mask_pixel_hash(suppressed_outside_paper),
        "exact_foreground_partition": {
            "raw_equals_retained_plus_suppressed": True,
            "retained_and_suppressed_disjoint": True,
        },
        "paper_support_role": "source_appearance_software_support_never_semantic_truth_or_proposal_geometry",
    }


def _build_ink_proposal(
    page_id: str,
    packet: dict[str, Any],
    packet_path: Path,
    source: Image.Image,
) -> tuple[np.ndarray, dict[str, Any]]:
    if page_id == "007-p02":
        mask, record = _derive_007_blue_mask(source)
        # Keep the complete warm-paper-supported ink proposal.  Proposal geometry
        # is useful as a review locator, but it must never define the canonical
        # residual universe: doing so could silently delete the very marginal or
        # omitted word that the knockout pass is meant to discover.
        window = _packet_geometry_window(packet, source.size, padding_fraction=0.06)
        x, y, width, height = window
        inside = np.zeros(mask.shape, dtype=bool)
        inside[y : y + height, x : x + width] = True
        outside_pixels = int(np.count_nonzero(mask & ~inside))
        record["packet_geometry_analysis_window_source_xywh"] = window
        record["packet_geometry_padding_fraction"] = 0.06
        record["ink_proposal_pixels_outside_packet_geometry_window_retained"] = outside_pixels
        record["packet_geometry_window_role"] = "review_hint_only_never_mask_filter"
        record["input_source_file_sha256"] = packet["source"]["sha256"]
    elif page_id == "014-p04":
        mask_input = packet.get("ink_mask_input", {})
        mask_path = _resolve_packet_path(packet_path, mask_input.get("path", ""))
        if not mask_path.is_file():
            raise RuntimeError(f"Packet-bound 014 mask is missing: {mask_path}")
        if sha256_file(mask_path) != mask_input.get("sha256"):
            raise RuntimeError("Packet-bound 014 mask file hash changed")
        mask, record = _normalize_014_mask(mask_path, source)
        record["packet_mask_role"] = mask_input.get("role")
    else:
        raise RuntimeError(f"Unsupported real-page trial page: {page_id}")
    record.update(
        {
            "schema_version": "full-page-ink-proposal.v2",
            "page_id": page_id,
            "role": "binary_ink_proposal_never_truth",
            "warning": MASK_WARNING,
            "size": list(source.size),
            "foreground_pixels": int(mask.sum()),
            "foreground_fraction": round(float(mask.mean()), 9),
            "pixel_sha256": mask_pixel_hash(mask),
        }
    )
    return mask, record


def _safe_name(value: str) -> str:
    cleaned = "".join(character if character.isalnum() or character in "-_" else "_" for character in value)
    return cleaned or "unit"


def _bbox_xyxy(box: Iterable[int]) -> tuple[int, int, int, int]:
    x, y, width, height = (int(value) for value in box)
    return x, y, x + width, y + height


def _box_mask_slice(mask: np.ndarray, box: Iterable[int]) -> np.ndarray:
    x0, y0, x1, y1 = _bbox_xyxy(box)
    return mask[y0:y1, x0:x1]


def _component_inventory(mask: np.ndarray) -> tuple[np.ndarray, list[dict[str, Any]]]:
    labels = measure.label(mask, connectivity=2)
    inventory: list[dict[str, Any]] = []
    for region in measure.regionprops(labels):
        y0, x0, y1, x1 = region.bbox
        inventory.append(
            {
                "component_id": f"C{int(region.label):06d}",
                "label": int(region.label),
                "area_px": int(region.area),
                "bbox_source_xywh": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                "centroid_source_xy": [
                    round(float(region.centroid[1]), 3),
                    round(float(region.centroid[0]), 3),
                ],
                "touches_source_border": bool(
                    x0 == 0 or y0 == 0 or x1 == mask.shape[1] or y1 == mask.shape[0]
                ),
            }
        )
    return labels.astype(np.int32, copy=False), inventory


def _analysis_window(
    decision: dict[str, Any], packet: dict[str, Any], source_size: tuple[int, int]
) -> list[int]:
    boxes: list[list[int]] = []
    for line in decision["lines"]:
        boxes.extend(unit["bbox_source_xywh"] for unit in line["visible_units"])
    for line in packet["lines"]:
        boxes.extend(item["source_axis_aligned_bbox_xywh"] for item in line["box_proposals"])
    if not boxes:
        return [0, 0, source_size[0], source_size[1]]
    width, height = source_size
    pad_x = max(48, round(width * 0.12))
    pad_y = max(48, round(height * 0.12))
    left = max(0, min(box[0] for box in boxes) - pad_x)
    top = max(0, min(box[1] for box in boxes) - pad_y)
    right = min(width, max(box[0] + box[2] for box in boxes) + pad_x)
    bottom = min(height, max(box[1] + box[3] for box in boxes) + pad_y)
    return [left, top, right - left, bottom - top]


def _resize_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    image = Image.fromarray(np.asarray(mask, dtype=np.uint8) * 255, mode="L")
    resized = image.resize(size, Image.Resampling.NEAREST)
    return np.asarray(resized, dtype=np.uint8) > 0


def _fit_low_res(image: Image.Image) -> tuple[Image.Image, float]:
    scale = min(1.0, LOW_RES_WIDTH / image.width)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    if size == image.size:
        return image.convert("RGB"), scale
    return image.convert("RGB").resize(size, Image.Resampling.LANCZOS), scale


def _overlay(base: Image.Image, red_mask: np.ndarray, orange_mask: np.ndarray) -> Image.Image:
    array = np.asarray(base.convert("RGB"), dtype=np.uint8).copy()
    red_binary = np.asarray(red_mask, dtype=bool)
    orange_binary = np.asarray(orange_mask, dtype=bool) & ~red_binary
    array[red_binary] = ((array[red_binary].astype(np.uint16) + RED * 2) // 3).astype(np.uint8)
    array[orange_binary] = ((array[orange_binary].astype(np.uint16) + ORANGE * 2) // 3).astype(np.uint8)
    return Image.fromarray(array, mode="RGB")


def _local_background(rgb: np.ndarray, box: list[int], ink: np.ndarray) -> tuple[int, int, int]:
    x, y, width, height = box
    pad = 8
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(rgb.shape[1], x + width + pad), min(rgb.shape[0], y + height + pad)
    ring = np.ones((y1 - y0, x1 - x0), dtype=bool)
    ring[y - y0 : y + height - y0, x - x0 : x + width - x0] = False
    ring &= ~ink[y0:y1, x0:x1]
    pixels = rgb[y0:y1, x0:x1][ring]
    if pixels.size == 0:
        pixels = rgb[y0:y1, x0:x1].reshape(-1, 3)
    median = np.median(pixels, axis=0).round().astype(np.uint8)
    return int(median[0]), int(median[1]), int(median[2])


def _render_component_board(
    source: Image.Image,
    labels: np.ndarray,
    component_ids: list[int],
    box: list[int],
    destination: Path,
    title: str,
) -> None:
    x, y, width, height = box
    padding = 30
    left, top = max(0, x - padding), max(0, y - padding)
    right, bottom = min(source.width, x + width + padding), min(source.height, y + height + padding)
    crop = source.crop((left, top, right, bottom)).convert("RGB")
    crop_labels = labels[top:bottom, left:right]
    array = np.asarray(crop, dtype=np.uint8).copy()
    palette = (
        np.array([222, 50, 42], dtype=np.uint8),
        np.array([8, 104, 172], dtype=np.uint8),
        np.array([42, 150, 80], dtype=np.uint8),
        np.array([150, 70, 170], dtype=np.uint8),
    )
    for index, component_id in enumerate(component_ids):
        selected = crop_labels == component_id
        color = palette[index % len(palette)]
        array[selected] = ((array[selected].astype(np.uint16) + color * 2) // 3).astype(np.uint8)
    body = Image.fromarray(array, mode="RGB")
    scale = min(3.0, max(1.0, 650 / max(1, body.width)))
    if scale != 1.0:
        body = body.resize((round(body.width * scale), round(body.height * scale)), Image.Resampling.NEAREST)
    header = 58
    board = Image.new("RGB", (body.width, body.height + header), "#f4f1e9")
    board.paste(body, (0, header))
    draw = ImageDraw.Draw(board)
    draw.text((8, 6), title, fill="#111111", font=font(18))
    draw.text((8, 31), "Numbers are global proposal component IDs; colors imply no answer.", fill="#333333", font=font(14))
    label_font = font(16)
    for component_id in component_ids:
        positions = np.argwhere(crop_labels == component_id)
        if positions.size:
            row, column = positions.min(axis=0)
            draw.text(
                (int(column * scale), int(row * scale) + header),
                f"C{component_id:06d}",
                fill="white",
                font=label_font,
                stroke_width=2,
                stroke_fill="black",
            )
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="PNG", compress_level=9, optimize=False)
    body.close()
    board.close()


def _render_line_board(
    source: Image.Image,
    line: dict[str, Any],
    packet_line: dict[str, Any],
    candidate_union: np.ndarray,
    residual: np.ndarray,
    collided: np.ndarray,
    destination: Path,
) -> dict[str, Any]:
    units = line["visible_units"]
    if packet_line.get("evidence", {}).get("source_crop_xyxy"):
        left, top, right, bottom = (
            int(value) for value in packet_line["evidence"]["source_crop_xyxy"]
        )
    else:
        boxes = [unit["bbox_source_xywh"] for unit in units]
        left = max(0, min(box[0] for box in boxes) - 60)
        top = max(0, min(box[1] for box in boxes) - 60)
        right = min(source.width, max(box[0] + box[2] for box in boxes) + 60)
        bottom = min(source.height, max(box[1] + box[3] for box in boxes) + 60)
    if units:
        left = max(0, min(left, min(unit["bbox_source_xywh"][0] for unit in units) - 40))
        top = max(0, min(top, min(unit["bbox_source_xywh"][1] for unit in units) - 40))
        right = min(source.width, max(right, max(unit["bbox_source_xywh"][0] + unit["bbox_source_xywh"][2] for unit in units) + 40))
        bottom = min(source.height, max(bottom, max(unit["bbox_source_xywh"][1] + unit["bbox_source_xywh"][3] for unit in units) + 40))
    crop = source.crop((left, top, right, bottom)).convert("RGB")
    red = candidate_union[top:bottom, left:right]
    orange = residual[top:bottom, left:right] | collided[top:bottom, left:right]
    body = _overlay(crop, red, orange)
    scale = min(1.0, 1800 / max(1, body.width))
    if scale != 1.0:
        body = body.resize((round(body.width * scale), round(body.height * scale)), Image.Resampling.LANCZOS)
    header = 82
    board = Image.new("RGB", (body.width, body.height + header), "#f4f1e9")
    board.paste(body, (0, header))
    draw = ImageDraw.Draw(board)
    draw.text((10, 7), f"{line['line_id']} — candidate ownership only", fill="#111111", font=font(20))
    draw.text((10, 36), "RED exclusive box-clipped candidate | ORANGE unresolved/collided | BLUE boxes use one neutral status style", fill="#333333", font=font(16))
    label_font = font(14)
    for unit in units:
        x, y, width, height = unit["bbox_source_xywh"]
        x0, y0 = round((x - left) * scale), round((y - top) * scale) + header
        x1, y1 = round((x + width - left) * scale), round((y + height - top) * scale) + header
        draw.rectangle((x0, y0, x1, y1), outline=BLUE, width=2)
        draw.text((x0 + 2, max(header, y0 - 18)), unit["unit_id"], fill=BLUE, font=label_font, stroke_width=2, stroke_fill="white")
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="PNG", compress_level=9, optimize=False)
    body.close()
    board.close()
    return {"source_crop_xyxy": [left, top, right, bottom], "scale": scale}


def _prepare_output(output_dir: Path) -> None:
    resolved = output_dir.resolve()
    if resolved in {Path("/").resolve(), ROOT.resolve(), TRIAL.resolve()}:
        raise RuntimeError(f"Refusing unsafe output directory: {output_dir}")
    if output_dir.is_symlink():
        raise RuntimeError("Refusing to replace a symlinked output directory")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=False)


def _output_meta(output_dir: Path, path: Path, *, role: str) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(output_dir)),
        "file_sha256": sha256_file(path),
        "role": role,
    }


def build(
    decision_path: Path,
    *,
    packet_path: Path | None = None,
    validation_path: Path | None = None,
    output_dir: Path | None = None,
) -> Path:
    decision_path = decision_path.resolve()
    page_hint = json.loads(decision_path.read_text(encoding="utf-8")).get("page_id")
    packet_path = (packet_path or TRIAL / str(page_hint) / "public/run-packet.json").resolve()
    validation_path = (validation_path or decision_path.with_name("validation.json")).resolve()
    output_dir = (output_dir or decision_path.parent / "ownership-knockout-v2").resolve()
    decision, packet, validation, source_path = _validate_bound_inputs(
        decision_path, packet_path, validation_path
    )
    _prepare_output(output_dir)

    page_id = decision["page_id"]
    with Image.open(source_path) as source_handle:
        source = source_handle.convert("RGB")
    ink, ink_record = _build_ink_proposal(page_id, packet, packet_path, source)
    mask_path = output_dir / "masks/ink-proposal.png"
    save_mask(mask_path, ink)
    ink_record["file"] = _output_meta(output_dir, mask_path, role="normalized_full_size_binary_ink_proposal")
    write_json(output_dir / "masks/ink-proposal-record.json", ink_record)

    lines = decision["lines"]
    units = [
        {**unit, "line_id": line["line_id"]}
        for line in lines
        for unit in line["visible_units"]
    ]
    owner_count = np.zeros(ink.shape, dtype=np.uint16)
    for unit in units:
        x0, y0, x1, y1 = _bbox_xyxy(unit["bbox_source_xywh"])
        owner_count[y0:y1, x0:x1] += ink[y0:y1, x0:x1].astype(np.uint16)
    collided = ink & (owner_count > 1)
    candidate_union = ink & (owner_count == 1)
    residual = ink & ~candidate_union

    labels, components = _component_inventory(ink)
    component_units: dict[int, list[str]] = defaultdict(list)
    component_inside_counts: dict[tuple[int, str], int] = {}
    unit_labels: dict[str, list[int]] = {}
    for unit in units:
        box = unit["bbox_source_xywh"]
        crop_labels = _box_mask_slice(labels, box)
        ids = sorted(int(value) for value in np.unique(crop_labels) if value)
        unit_labels[unit["unit_id"]] = ids
        for label in ids:
            count = int(np.count_nonzero(crop_labels == label))
            component_inside_counts[(label, unit["unit_id"])] = count
            component_units[label].append(unit["unit_id"])

    component_records: list[dict[str, Any]] = []
    risky_labels_by_unit: dict[str, set[int]] = defaultdict(set)
    for component in components:
        label = component["label"]
        claimed_units = sorted(set(component_units.get(label, [])))
        boundary_units = sorted(
            unit_id
            for unit_id in claimed_units
            if component_inside_counts[(label, unit_id)] < component["area_px"]
        )
        multiple = len(claimed_units) > 1
        if multiple or boundary_units:
            for unit_id in claimed_units:
                risky_labels_by_unit[unit_id].add(label)
        component_records.append(
            {
                key: value for key, value in component.items() if key != "label"
            }
            | {
                "intersecting_unit_ids": claimed_units,
                "crosses_multiple_unit_boxes": multiple,
                "crosses_box_boundary_unit_ids": boundary_units,
                "status": "collision_unassigned" if multiple else (
                    "boundary_crossing_candidate" if boundary_units else "contained_candidate"
                ),
            }
        )

    overlap_pairs: list[dict[str, Any]] = []
    for first_index, first in enumerate(units):
        ax0, ay0, ax1, ay1 = _bbox_xyxy(first["bbox_source_xywh"])
        first_raw = int(_box_mask_slice(ink, first["bbox_source_xywh"]).sum())
        for second in units[first_index + 1 :]:
            bx0, by0, bx1, by1 = _bbox_xyxy(second["bbox_source_xywh"])
            x0, y0, x1, y1 = max(ax0, bx0), max(ay0, by0), min(ax1, bx1), min(ay1, by1)
            if x0 >= x1 or y0 >= y1:
                continue
            overlap = int(ink[y0:y1, x0:x1].sum())
            if not overlap:
                continue
            second_raw = int(_box_mask_slice(ink, second["bbox_source_xywh"]).sum())
            exact_duplicate = overlap == first_raw == second_raw and overlap > 0
            overlap_pairs.append(
                {
                    "unit_ids": [first["unit_id"], second["unit_id"]],
                    "classification": "exact_duplicate_pixel_candidate" if exact_duplicate else "partial_pixel_overlap",
                    "overlap_pixels": overlap,
                    "first_candidate_overlap_fraction": round(overlap / max(1, first_raw), 6),
                    "second_candidate_overlap_fraction": round(overlap / max(1, second_raw), 6),
                    "intersection_bbox_source_xywh": [x0, y0, x1 - x0, y1 - y0],
                }
            )

    unit_records: list[dict[str, Any]] = []
    for unit in units:
        unit_id = unit["unit_id"]
        box = unit["bbox_source_xywh"]
        raw = _box_mask_slice(ink, box)
        exclusive = raw & (_box_mask_slice(owner_count, box) == 1)
        collision_crop = raw & (_box_mask_slice(owner_count, box) > 1)
        unit_dir = output_dir / "units" / _safe_name(unit_id)
        owned_path = unit_dir / "candidate-owned-mask.png"
        save_mask(owned_path, exclusive)
        collision_path = unit_dir / "withheld-collision-mask.png"
        save_mask(collision_path, collision_crop)
        component_ids = unit_labels[unit_id]
        risky = (
            unit.get("ownership_route") != "terra_box_mask"
            or unit.get("risk_flags") not in (None, [], ["none"])
            or bool(collision_crop.any())
            or bool(risky_labels_by_unit[unit_id])
        )
        board_meta = None
        if risky:
            board_path = unit_dir / "numbered-components.png"
            _render_component_board(
                source,
                labels,
                component_ids,
                box,
                board_path,
                f"{unit_id} — risky ownership candidate",
            )
            board_meta = _output_meta(output_dir, board_path, role="numbered_component_context_for_agent_review")
        unit_records.append(
            {
                "unit_id": unit_id,
                "line_id": unit["line_id"],
                "tentative_text": unit.get("tentative_text"),
                "bbox_source_xywh": box,
                "ownership_route": unit.get("ownership_route"),
                "risk_flags": unit.get("risk_flags", []),
                "component_ids": [f"C{label:06d}" for label in component_ids],
                "raw_box_clipped_ink_pixels": int(raw.sum()),
                "exclusive_candidate_pixels": int(exclusive.sum()),
                "withheld_collision_pixels": int(collision_crop.sum()),
                "candidate_owned_mask_pixel_sha256": mask_pixel_hash(exclusive),
                "withheld_collision_mask_pixel_sha256": mask_pixel_hash(collision_crop),
                "candidate_owned_mask": _output_meta(output_dir, owned_path, role="box_clipped_exclusive_owned_mask_candidate_never_approval"),
                "withheld_collision_mask": _output_meta(output_dir, collision_path, role="multi_box_pixels_never_silently_assigned"),
                "numbered_component_board": board_meta,
                "requires_agent_review": risky,
                "status": "candidate_not_approved",
                "warning": MASK_WARNING,
            }
        )

    selection_record = {
        "schema_version": SCHEMA_VERSION,
        "page_id": page_id,
        "warning": MASK_WARNING,
        "collision_policy": COLLISION_WARNING,
        "unit_count": len(unit_records),
        "units": unit_records,
        "pixel_overlap_pairs": overlap_pairs,
        "connected_components": component_records,
        "summary": {
            "ink_proposal_pixels": int(ink.sum()),
            "exclusive_candidate_union_pixels": int(candidate_union.sum()),
            "withheld_collided_pixels": int(collided.sum()),
            "residual_pixels": int(residual.sum()),
            "pixel_overlap_pair_count": len(overlap_pairs),
            "multi_box_component_count": sum(item["crosses_multiple_unit_boxes"] for item in component_records),
            "boundary_crossing_component_count": sum(bool(item["crosses_box_boundary_unit_ids"]) for item in component_records),
        },
    }
    selection_path = output_dir / "units/selection-records.json"
    write_json(selection_path, selection_record)

    for name, value in (
        ("candidate-owned-union", candidate_union),
        ("withheld-collisions", collided),
        ("exact-candidate-residual", residual),
    ):
        save_mask(output_dir / f"masks/{name}.png", value)

    packet_lines = {line["line_id"]: line for line in packet["lines"]}
    line_records: list[dict[str, Any]] = []
    for line in lines:
        board_path = output_dir / "line-boards" / f"{_safe_name(line['line_id'])}.png"
        geometry = _render_line_board(
            source,
            line,
            packet_lines[line["line_id"]],
            candidate_union,
            residual,
            collided,
            board_path,
        )
        line_records.append(
            {
                "line_id": line["line_id"],
                "line_status": line["line_status"],
                "board": _output_meta(output_dir, board_path, role="same_status_box_candidate_ownership_board"),
                **geometry,
            }
        )
    write_json(
        output_dir / "line-boards/index.json",
        {
            "schema_version": "full-page-ownership-line-boards.v2",
            "page_id": page_id,
            "legend": {"red": "exclusive_candidate_owned_ink", "orange": "unresolved_or_collided_ink", "blue_boxes": "neutral_same_status_candidate_boxes"},
            "warning": MASK_WARNING,
            "lines": line_records,
        },
    )

    analysis_window = _analysis_window(decision, packet, source.size)
    wx, wy, ww, wh = analysis_window
    residual_labels, residual_inventory = _component_inventory(residual)
    residual_candidates: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for component in residual_inventory:
        x, y, width, height = component["bbox_source_xywh"]
        cx, cy = component["centroid_source_xy"]
        reason = None
        if component["touches_source_border"]:
            reason = "review_hint_touches_source_border"
        elif not (wx <= cx < wx + ww and wy <= cy < wy + wh):
            reason = "review_hint_outside_packet_geometry_window"
        elif component["area_px"] < RESIDUAL_MIN_AREA:
            reason = "review_hint_tiny_component"
        if reason:
            excluded.append(
                {
                    "component_id": component["component_id"],
                    "bbox_source_xywh": component["bbox_source_xywh"],
                    "area_px": component["area_px"],
                    "reason": reason,
                }
            )
            continue
        label = component["label"]
        board_path = output_dir / "residual-candidates/boards" / f"{component['component_id']}.png"
        _render_component_board(
            source,
            residual_labels,
            [label],
            component["bbox_source_xywh"],
            board_path,
            f"Residual {component['component_id']} — candidate, not proof of a missed word",
        )
        residual_candidates.append(
            {
                "component_id": component["component_id"],
                "bbox_source_xywh": component["bbox_source_xywh"],
                "area_px": component["area_px"],
                "centroid_source_xy": component["centroid_source_xy"],
                "is_subset_of_normalized_ink_proposal": True,
                "board": _output_meta(output_dir, board_path, role="bounded_residual_component_review_crop"),
                "disposition": "unreviewed_residual_candidate",
            }
        )
    exclusion_counts = Counter(item["reason"] for item in excluded)
    residual_record = {
        "schema_version": "full-page-residual-candidates.v2",
        "page_id": page_id,
        "analysis_window_source_xywh": analysis_window,
        "analysis_window_role": "packet_geometry_expanded_12_percent_review_priority_hint_only;_never_terminal_disposition",
        "minimum_component_area_px": RESIDUAL_MIN_AREA,
        "warning": (
            "Residual components are software review candidates, not proof of missing words. "
            "excluded_components are excluded only from individual board rendering; they remain "
            "part of exact residual accounting and require an explicit grouped disposition."
        ),
        "candidate_count": len(residual_candidates),
        "excluded_count": len(excluded),
        "exclusion_counts": dict(sorted(exclusion_counts.items())),
        "candidates": residual_candidates,
        "excluded_components": excluded,
    }
    write_json(output_dir / "residual-candidates/residual-candidates.json", residual_record)

    diagnostics_dir = output_dir / "page-diagnostics"
    diagnostics_dir.mkdir(parents=True, exist_ok=True)
    low_source, scale = _fit_low_res(source)
    low_size = low_source.size
    low_candidate = _resize_mask(candidate_union, low_size)
    low_residual = _resize_mask(residual, low_size)
    low_collided = _resize_mask(collided, low_size)

    subtraction_array = np.full((low_size[1], low_size[0], 3), 250, dtype=np.uint8)
    subtraction_array[low_residual] = (30, 30, 32)
    subtraction_array[low_collided] = ORANGE
    subtraction = Image.fromarray(subtraction_array, mode="RGB")
    subtraction_path = diagnostics_dir / "exact-candidate-mask-subtraction.png"
    subtraction.save(subtraction_path, format="PNG", compress_level=9, optimize=False)

    coverage = _overlay(low_source, low_candidate, low_residual | low_collided)
    coverage_draw = ImageDraw.Draw(coverage)
    coverage_draw.rectangle(
        (round(wx * scale), round(wy * scale), round((wx + ww) * scale), round((wy + wh) * scale)),
        outline=BLUE,
        width=2,
    )
    coverage_path = diagnostics_dir / "coverage-overlay.png"
    coverage.save(coverage_path, format="PNG", compress_level=9, optimize=False)

    rgb = np.asarray(source, dtype=np.uint8).copy()
    for unit in units:
        box = unit["bbox_source_xywh"]
        x, y, width, height = box
        rgb[y : y + height, x : x + width] = _local_background(rgb, box, ink)
    box_fill_full = Image.fromarray(rgb, mode="RGB")
    box_fill, _ = _fit_low_res(box_fill_full)
    box_fill_path = diagnostics_dir / "background-box-fill.png"
    box_fill.save(box_fill_path, format="PNG", compress_level=9, optimize=False)
    write_json(
        diagnostics_dir / "diagnostics.json",
        {
            "schema_version": "full-page-knockout-diagnostics.v2",
            "page_id": page_id,
            "display_scale": scale,
            "display_size": list(low_size),
            "canonical_exactness_scope": "exact_only_relative_to_saved_exclusive_candidate_masks",
            "ground_truth_claim": False,
            "warning": MASK_WARNING,
            "files": {
                "exact_candidate_mask_subtraction": _output_meta(output_dir, subtraction_path, role="low_resolution_view_of_exact_candidate_mask_residual"),
                "background_box_fill": _output_meta(output_dir, box_fill_path, role="visual_missing_box_diagnostic_not_canonical_subtraction"),
                "coverage_overlay": _output_meta(output_dir, coverage_path, role="red_candidate_orange_residual_low_resolution_navigation"),
            },
        },
    )
    low_source.close()
    subtraction.close()
    coverage.close()
    box_fill_full.close()
    box_fill.close()
    source.close()

    # Bind every produced file except the manifest itself.  Relative paths make
    # byte-for-byte rebuild comparisons independent of the chosen output root.
    outputs = []
    for path in sorted(output_dir.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            outputs.append(
                {
                    "path": str(path.relative_to(output_dir)),
                    "file_sha256": sha256_file(path),
                    "bytes": path.stat().st_size,
                }
            )
    bound_inputs: dict[str, Any] = {
        "decision": {"file_sha256": sha256_file(decision_path), "canonical_sha256": canonical_hash(decision)},
        "validation": {"file_sha256": sha256_file(validation_path), "validation_sha256": validation["validation_sha256"], "status": "pass"},
        "public_packet": {"file_sha256": sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
        "source": {"file_sha256": sha256_file(source_path), "size": packet["source"]["size"]},
        "ink_proposal_pixel_sha256": ink_record["pixel_sha256"],
    }
    if page_id == "014-p04":
        prior_mask_path = _resolve_packet_path(
            packet_path, packet["ink_mask_input"]["path"]
        )
        bound_inputs["packet_bound_prior_ink_mask"] = {
            "file_sha256": sha256_file(prior_mask_path),
            "packet_claimed_file_sha256": packet["ink_mask_input"]["sha256"],
            "role": packet["ink_mask_input"].get("role"),
        }

    manifest: dict[str, Any] = {
        "schema_version": MANIFEST_VERSION,
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "warnings": [MASK_WARNING, COLLISION_WARNING],
        "inputs": bound_inputs,
        "summary": selection_record["summary"] | {
            "unit_count": len(unit_records),
            "line_count": len(line_records),
            "residual_candidate_count": len(residual_candidates),
            "excluded_residual_component_count": len(excluded),
        },
        "outputs": outputs,
    }
    manifest["manifest_sha256"] = canonical_hash(manifest)
    manifest_path = output_dir / "manifest.json"
    write_json(manifest_path, manifest)
    return manifest_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("decision_path", type=Path)
    parser.add_argument("--packet", type=Path)
    parser.add_argument("--validation", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    manifest = build(
        args.decision_path,
        packet_path=args.packet,
        validation_path=args.validation,
        output_dir=args.output_dir,
    )
    print(manifest)


if __name__ == "__main__":
    main()
