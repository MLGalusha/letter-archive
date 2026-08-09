#!/usr/bin/env python3
"""Production-style, bounded full-page word-envelope trial.

This deliberately does not read benchmark labels or review artifacts.  It uses
only the two frozen source pages and creates an auditable candidate-token
ledger.  A candidate token is a connected ink group proposed by the page
segmenter; it is marked ``[unreadable]`` unless an independent transcription
pass can bind it one-to-one.  This is preferable to silently inventing text.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage import filters, measure

from word_envelope.engine import EnvelopeError, EnvelopeParams, wrap_envelope
from word_envelope.io_utils import sha256_file, sha256_mask_pixels, write_json
from word_envelope.masks import stable_components
from word_envelope.render import save_envelope_overlay


RUN_SCHEMA = "word-envelope-full-page-agent-trial.v1"
MAX_PAGE_PREVIEW_PIXELS = 2_000_000
FONT = ImageFont.load_default()


@dataclass(frozen=True)
class PageSpec:
    page_id: str
    source_path: str
    source_sha256: str
    source_box_xywh: tuple[int, int, int, int]
    scale: float
    ink_profile: Literal["blue", "dark"]
    horizontal_regions: tuple[tuple[int, int, int, int], ...]
    vertical_regions: tuple[tuple[int, int, int, int], ...]


PAGES = (
    PageSpec(
        page_id="007-p02",
        source_path=(
            "/Users/masongalusha/Workspace/projects/letter-archive/backend/"
            "storage/collections/007/19430411/L01/007-19430411-L01-02.jpg"
        ),
        source_sha256="0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312",
        # Letter paper only.  The source itself is never copied into this run.
        source_box_xywh=(230, 650, 2500, 3200),
        scale=0.5,
        ink_profile="blue",
        horizontal_regions=((0, 0, 1260, 2050),),
        vertical_regions=((0, 1970, 600, 320),),
    ),
    PageSpec(
        page_id="014-p04",
        source_path=(
            "/Users/masongalusha/Workspace/projects/letter-archive/backend/"
            "storage/collections/014/18780127/L01/014-18780127-L01-04.jpg"
        ),
        source_sha256="a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69",
        source_box_xywh=(150, 40, 970, 1510),
        scale=1.0,
        ink_profile="dark",
        horizontal_regions=((20, 180, 930, 1110), (20, 1160, 930, 320)),
        vertical_regions=((25, 10, 560, 190),),
    ),
)

# Source-coordinate coverage regions are frozen before the candidate pass.  They
# intentionally overlap slightly at stream boundaries so a word on a boundary is
# audited twice rather than lost.
STREAMS: dict[str, tuple[dict[str, Any], ...]] = {
    "007-p02": (
        {"id": "main-body", "orientation": "horizontal", "source_bounds_xywh": [350, 900, 2150, 1950]},
        {"id": "closing", "orientation": "horizontal", "source_bounds_xywh": [1450, 2700, 1250, 600]},
        {"id": "postscript-island", "orientation": "oblique", "source_bounds_xywh": [250, 2800, 1200, 950]},
        {"id": "bottom-margin", "orientation": "oblique", "source_bounds_xywh": [250, 3450, 1750, 380]},
    ),
    "014-p04": (
        {"id": "top-margin", "orientation": "vertical", "source_bounds_xywh": [150, 40, 600, 230]},
        {"id": "main-body", "orientation": "horizontal", "source_bounds_xywh": [180, 210, 900, 1040]},
        {"id": "lower-body", "orientation": "horizontal", "source_bounds_xywh": [180, 1050, 870, 280]},
        {"id": "signatures", "orientation": "horizontal", "source_bounds_xywh": [150, 1240, 950, 310]},
    ),
}


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _write_log(path: Path, message: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(message.rstrip() + "\n")


def _page_image(spec: PageSpec) -> Image.Image:
    source = Path(spec.source_path)
    observed = sha256_file(source)
    if observed != spec.source_sha256:
        raise RuntimeError(f"Source hash drift for {spec.page_id}: {observed}")
    x, y, w, h = spec.source_box_xywh
    with Image.open(source) as raw:
        cropped = raw.convert("RGB").crop((x, y, x + w, y + h))
    if spec.scale != 1.0:
        cropped = cropped.resize(
            (round(cropped.width * spec.scale), round(cropped.height * spec.scale)),
            Image.Resampling.LANCZOS,
        )
    if cropped.width * cropped.height > MAX_PAGE_PREVIEW_PIXELS:
        raise RuntimeError(f"Bounded page image exceeds limit for {spec.page_id}")
    return cropped


def _extract_page_ink(image: Image.Image, profile: str) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float64)
    gray = np.asarray(image.convert("L"), dtype=np.float64) / 255.0
    if profile == "blue":
        # 007 is blue ink on warm paper.  Channel separation removes folds.
        mask = ((rgb[:, :, 2] - rgb[:, :, 0]) > 6.0) & (gray < 0.78)
    else:
        threshold = filters.threshold_sauvola(gray, window_size=51, k=0.18)
        mask = gray < threshold
    labels = measure.label(mask, connectivity=2)
    output = np.zeros_like(mask, dtype=bool)
    for region in measure.regionprops(labels):
        if region.area >= 5:
            output[tuple(region.coords.T)] = True
    return output


def _in_regions(x: float, y: float, regions: tuple[tuple[int, int, int, int], ...]) -> bool:
    return any(left <= x < left + width and top <= y < top + height for left, top, width, height in regions)


def _candidate_groups(
    mask: np.ndarray,
    *,
    orientation: Literal["horizontal", "vertical"],
    regions: tuple[tuple[int, int, int, int], ...],
    bridge_shape: tuple[int, int],
) -> list[dict[str, int | str]]:
    # Small directional closing binds letters and punctuation but deliberately
    # avoids a large bridge that would erase word boundaries.
    vertical, horizontal = bridge_shape
    structure = np.ones(
        (vertical, horizontal) if orientation == "horizontal" else (horizontal, vertical),
        dtype=bool,
    )
    dilated = ndimage.binary_dilation(mask, structure=structure)
    labels = measure.label(dilated, connectivity=2)
    groups: list[dict[str, int | str]] = []
    for region in measure.regionprops(labels):
        top, left, bottom, right = region.bbox
        width, height = right - left, bottom - top
        if not _in_regions((left + right) / 2, (top + bottom) / 2, regions):
            continue
        ink = int(mask[top:bottom, left:right].sum())
        if ink < 24:
            continue
        if orientation == "horizontal":
            if width < 5 or height < 3 or width > 220 or height > 100:
                continue
        else:
            if height < 5 or width < 3 or height > 220 or width > 100:
                continue
        groups.append({"x": left, "y": top, "width": width, "height": height, "orientation": orientation})
    groups.sort(key=lambda item: (int(item["y"]), int(item["x"])))
    return groups


def _ids_for_group(labels: np.ndarray, group: dict[str, int | str]) -> set[int]:
    x, y, width, height = (int(group[key]) for key in ("x", "y", "width", "height"))
    return {int(value) for value in np.unique(labels[y:y + height, x:x + width]) if value}


def _annotate_bridge_stability(
    labels: np.ndarray,
    nominal: list[dict[str, int | str]],
    variants: list[list[dict[str, int | str]]],
) -> tuple[list[dict[str, int | str]], list[dict[str, Any]]]:
    """Keep the middle bridge as a *candidate*, with all merge/split instability explicit."""
    variant_sets = [[_ids_for_group(labels, group) for group in groups] for groups in variants]
    rows: list[dict[str, Any]] = []
    for group in nominal:
        candidate_ids = _ids_for_group(labels, group)
        best_scores = []
        exact = []
        for sets in variant_sets:
            scores = [len(candidate_ids & other) / len(candidate_ids | other) for other in sets if candidate_ids | other]
            best = max(scores, default=0.0)
            best_scores.append(round(best, 4))
            exact.append(any(candidate_ids == other for other in sets))
        unstable = not all(exact)
        group["bridge_stable"] = not unstable
        group["bridge_similarity_by_variant"] = best_scores
        rows.append({
            "candidate_component_ids": sorted(candidate_ids),
            "bridge_stable": not unstable,
            "exact_group_match_by_variant": exact,
            "best_component_jaccard_by_variant": best_scores,
        })
    return nominal, rows


def _component_assignments(mask: np.ndarray, groups: list[dict[str, int | str]]) -> tuple[np.ndarray, list[dict[str, Any]], list[dict[str, Any]]]:
    labels, inventory = stable_components(mask)
    # Map each raw component to one proposed group using its centroid.  A component
    # is never duplicated: ties go to the nearest group center and are flagged.
    assignments: list[list[int]] = [[] for _ in groups]
    orphan_ids: list[int] = []
    for component in inventory:
        centroid = component["centroid"]
        x, y = float(centroid["x"]), float(centroid["y"])
        candidates = []
        for index, group in enumerate(groups):
            left, top = int(group["x"]), int(group["y"])
            right, bottom = left + int(group["width"]), top + int(group["height"])
            if left <= x < right and top <= y < bottom:
                cx, cy = (left + right) / 2, (top + bottom) / 2
                candidates.append(((x - cx) ** 2 + (y - cy) ** 2, index))
        if not candidates:
            orphan_ids.append(int(component["id"]))
            continue
        candidates.sort()
        assignments[candidates[0][1]].append(int(component["id"]))
    return labels, [{"component_ids": item} for item in assignments] + [{"orphan_component_ids": orphan_ids}], inventory


def _word_record(
    *,
    spec: PageSpec,
    image: Image.Image,
    mask: np.ndarray,
    labels: np.ndarray,
    group: dict[str, int | str],
    bridge_row: dict[str, Any],
    component_ids: list[int],
    index: int,
    output_dir: Path,
) -> dict[str, Any]:
    x, y, width, height = (int(group[key]) for key in ("x", "y", "width", "height"))
    pad = 10
    left, top = max(0, x - pad), max(0, y - pad)
    right, bottom = min(image.width, x + width + pad), min(image.height, y + height + pad)
    selected = np.isin(labels[top:bottom, left:right], component_ids)
    selected_pixels = int(selected.sum())
    flags: list[str] = ["unreadable_transcript", "machine_grouped_candidate_not_confirmed_word"]
    if not bool(group.get("bridge_stable", False)):
        flags.append("bridge_instability_merge_or_split")
    if str(group["orientation"]) == "vertical":
        flags.append("vertical_text")
    if width > 130 or height > 75:
        flags.append("likely_multiword_or_connected")
    if selected_pixels < 80:
        flags.append("low_ink_support")
    touches = bool(left == 0 or top == 0 or right == image.width or bottom == image.height)
    if touches:
        flags.append("context_crop_touches_page_boundary")
    action_history = [{
        "turn": 0,
        "type": "claim_components",
        "component_ids": component_ids,
        "input_mask_pixel_sha256": sha256_mask_pixels(mask[top:bottom, left:right]),
        "output_mask_pixel_sha256": sha256_mask_pixels(selected),
        "decision_source": "page_segmenter_v1_middle_bridge_candidate",
    }]
    # These envelopes are software proposals only.  The action remains reversible
    # because the component ids and exact mask hashes are stored above.
    params = EnvelopeParams(
        angle_degrees=90.0 if group["orientation"] == "vertical" else 0.0,
        along_bridge_px=10.0,
        cross_bridge_px=4.0,
        padding_px=3.0,
        smooth_iterations=1,
        simplify_tolerance_px=0.8,
        soft_threshold=0.20,
        maximum_envelope_fraction=0.9,
        maximum_envelope_to_ink_area_ratio=30.0,
        maximum_excluded_contamination=1.0,
        maximum_excluded_component_contamination=1.0,
        allow_border_touching_ink=False,
    )
    polygon_local: list[list[float]] | None = None
    envelope: dict[str, Any] | None = None
    envelope_error: str | None = None
    try:
        result = wrap_envelope(
            selected,
            params,
            method="soft_union",
            rough_box=(0.0, 0.0, float(selected.shape[1]), float(selected.shape[0])),
        )
        polygon_local = [[round(float(px), 3), round(float(py), 3)] for px, py in result.polygon]
        envelope = result.as_record()
        overlay = output_dir / "token-overlays" / f"{index:04d}.png"
        save_envelope_overlay(overlay, image.crop((left, top, right, bottom)), polygon_local)
    except EnvelopeError as error:
        envelope_error = str(error)
        flags.append("envelope_failed_review_required")
    scale = 1.0 / spec.scale
    source_x = spec.source_box_xywh[0] + round(left * scale)
    source_y = spec.source_box_xywh[1] + round(top * scale)
    source_w = round((right - left) * scale)
    source_h = round((bottom - top) * scale)
    source_polygon = (
        [[round(spec.source_box_xywh[0] + (left + px) * scale, 3), round(spec.source_box_xywh[1] + (top + py) * scale, 3)] for px, py in polygon_local]
        if polygon_local is not None else None
    )
    # A source-coordinate axis-aligned bounding box is always derived from the
    # owned-ink context crop.  The envelope remains the preferred annotation.
    record = {
        "id": f"{spec.page_id}-token-{index:04d}",
        "transcript": "[unreadable]",
        "transcript_status": "unreadable_pending_human_or_independent_ocr",
        "reading_orientation": str(group["orientation"]),
        "reading_order": index,
        "confidence": round(min(0.65, 0.18 + min(selected_pixels, 800) / 1700), 3),
        "flags": flags,
        "processing_context_box_xywh": [left, top, right - left, bottom - top],
        "source_context_box_xywh": [source_x, source_y, source_w, source_h],
        "source_axis_aligned_bbox_xywh": [source_x, source_y, source_w, source_h],
        "source_envelope_polygon": source_polygon,
        "owned_component_ids": component_ids,
        "owned_ink_pixel_sha256": sha256_mask_pixels(selected),
        "owned_ink_pixels": selected_pixels,
        "bridge_stability": bridge_row,
        "action_history": action_history,
        "envelope": envelope,
        "envelope_error": envelope_error,
    }
    return record


def _draw_page_preview(image: Image.Image, records: list[dict[str, Any]], path: Path) -> None:
    output = image.convert("RGB").copy()
    draw = ImageDraw.Draw(output)
    for record in records:
        x, y, w, h = record["processing_context_box_xywh"]
        color = (
            (230, 45, 45) if "envelope_failed_review_required" in record["flags"]
            else (245, 145, 20) if "bridge_instability_merge_or_split" in record["flags"]
            else (0, 165, 225)
        )
        draw.rectangle((x, y, x + w, y + h), outline=color, width=2)
        draw.text((x + 1, max(0, y - 10)), record["id"].rsplit("-", 1)[-1], fill=color, font=FONT, stroke_width=1, stroke_fill=(255, 255, 255))
    output.save(path, quality=90, optimize=True)


def _save_review_sheets(image: Image.Image, records: list[dict[str, Any]], path: Path) -> list[str]:
    emitted: list[str] = []
    path.mkdir(parents=True, exist_ok=True)
    per_sheet = 24
    thumb_w, thumb_h = 210, 115
    for start in range(0, len(records), per_sheet):
        batch = records[start:start + per_sheet]
        sheet = Image.new("RGB", (thumb_w * 4, (thumb_h + 20) * 6), (246, 244, 239))
        draw = ImageDraw.Draw(sheet)
        for offset, record in enumerate(batch):
            row, col = divmod(offset, 4)
            x, y, w, h = record["processing_context_box_xywh"]
            crop = image.crop((x, y, x + w, y + h)).convert("RGB")
            crop.thumbnail((thumb_w - 8, thumb_h - 8), Image.Resampling.LANCZOS)
            pos_x, pos_y = col * thumb_w + 4, row * (thumb_h + 20) + 18
            sheet.paste(crop, (pos_x, pos_y))
            label = record["id"].rsplit("-", 1)[-1]
            if "envelope_failed_review_required" in record["flags"]:
                label += " !"
            draw.text((pos_x, pos_y - 14), label, fill=(15, 15, 15), font=FONT)
        destination = path / f"review-{start // per_sheet + 1:02d}.jpg"
        sheet.save(destination, quality=88, optimize=True)
        emitted.append(str(destination.name))
    return emitted


def _run_page(spec: PageSpec, root: Path, log: Path) -> dict[str, Any]:
    started = time.monotonic()
    page_dir = root / spec.page_id
    if page_dir.exists():
        raise RuntimeError(f"Refusing to overwrite existing trial page: {page_dir}")
    page_dir.mkdir(parents=True)
    image = _page_image(spec)
    image.save(page_dir / "page-preview.jpg", quality=90, optimize=True)
    mask = _extract_page_ink(image, spec.ink_profile)
    Image.fromarray(mask.astype(np.uint8) * 255, mode="L").save(page_dir / "ink-mask.png", optimize=True)
    labels, _ = stable_components(mask)
    bridge_shapes = ((3, 9), (3, 13), (5, 17))
    horizontal_variants = [
        _candidate_groups(mask, orientation="horizontal", regions=spec.horizontal_regions, bridge_shape=shape)
        for shape in bridge_shapes
    ]
    vertical_variants = [
        _candidate_groups(mask, orientation="vertical", regions=spec.vertical_regions, bridge_shape=shape)
        for shape in bridge_shapes
    ]
    horizontal_groups, horizontal_stability = _annotate_bridge_stability(labels, horizontal_variants[1], horizontal_variants)
    vertical_groups, vertical_stability = _annotate_bridge_stability(labels, vertical_variants[1], vertical_variants)
    groups = horizontal_groups + vertical_groups
    stability_rows = horizontal_stability + vertical_stability
    groups.sort(key=lambda item: (int(item["y"]), int(item["x"]), str(item["orientation"])))
    # Sorting the candidates requires sorting their corresponding stability rows.
    stability_by_ids = {tuple(row["candidate_component_ids"]): row for row in stability_rows}
    labels, assigned, inventory = _component_assignments(mask, groups)
    assignment_rows = assigned[:-1]
    orphans = assigned[-1]["orphan_component_ids"]
    records = []
    for index, (group, row) in enumerate(zip(groups, assignment_rows), start=1):
        component_ids = row["component_ids"]
        if not component_ids:
            continue
        bridge_row = stability_by_ids.get(tuple(component_ids), {
            "candidate_component_ids": component_ids,
            "bridge_stable": False,
            "exact_group_match_by_variant": [False, False, False],
            "best_component_jaccard_by_variant": [0.0, 0.0, 0.0],
        })
        (page_dir / "token-overlays").mkdir(exist_ok=True)
        records.append(_word_record(spec=spec, image=image, mask=mask, labels=labels, group=group, bridge_row=bridge_row, component_ids=component_ids, index=index, output_dir=page_dir))
    _draw_page_preview(image, records, page_dir / "numbered-token-preview.jpg")
    sheet_names = _save_review_sheets(image, records, page_dir / "review-sheets")
    assigned_ids = {component_id for record in records for component_id in record["owned_component_ids"]}
    component_by_id = {int(component["id"]): component for component in inventory}
    residual_rows = []
    for component_id in orphans:
        component = component_by_id[component_id]
        bbox = component["bbox"]
        scale = 1.0 / spec.scale
        residual_rows.append({
            "component_id": component_id,
            "classification": "review_nonword_or_unassigned_ink",
            "source_bbox_xywh": [
                spec.source_box_xywh[0] + round(int(bbox["x"]) * scale),
                spec.source_box_xywh[1] + round(int(bbox["y"]) * scale),
                round(int(bbox["width"]) * scale),
                round(int(bbox["height"]) * scale),
            ],
            "area_px": component["area_px"],
        })
    def overlaps(box_a: list[int], box_b: list[int]) -> bool:
        ax, ay, aw, ah = box_a
        bx, by, bw, bh = box_b
        return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah
    streams = []
    for stream in STREAMS[spec.page_id]:
        bounds = list(stream["source_bounds_xywh"])
        token_ids = [record["id"] for record in records if overlaps(record["source_context_box_xywh"], bounds)]
        residual_ids = [row["component_id"] for row in residual_rows if overlaps(row["source_bbox_xywh"], bounds)]
        streams.append({
            **stream,
            "token_candidate_ids": token_ids,
            "residual_component_ids": residual_ids,
            "coverage_status": "covered_with_review_residuals" if token_ids else "no_token_candidates_review_required",
        })
    write_json(page_dir / "residual-unexplained-ink-audit.json", {
        "schema_version": "word-envelope-residual-ink-audit.v1",
        "page_id": spec.page_id,
        "assigned_component_count": len(assigned_ids),
        "residual_component_count": len(residual_rows),
        "residual_components": residual_rows,
        "streams": streams,
        "rule": "Every in-stream component is represented by a token candidate or a review/non-word residual; this is coverage accounting, not an accuracy claim.",
    })
    page_record = {
        "schema_version": RUN_SCHEMA,
        "page_id": spec.page_id,
        "source": {
            "path": spec.source_path,
            "sha256": spec.source_sha256,
            "used_box_xywh": list(spec.source_box_xywh),
            "scale": spec.scale,
            "source_copy_created": False,
        },
        "workflow": {
            "mode": "production_style_unblinded_to_truth",
            "transcription_policy": "Do not guess a word from its ink group; use explicit unreadable token until independently resolved.",
            "ownership_policy": "Assign each raw ink component to at most one directional candidate group; keep component ids and mask hashes.",
            "envelope_policy": "Deterministic soft union after component claim; failures stay flagged, never silently replaced by a hand polygon.",
        },
        "ink_mask_pixel_sha256": sha256_mask_pixels(mask),
        "raw_component_count": int(labels.max()),
        "candidate_group_count": len(groups),
        "bridge_variants": {
            "horizontal_shapes": [list(shape) for shape in bridge_shapes],
            "horizontal_candidate_counts": [len(groups) for groups in horizontal_variants],
            "vertical_candidate_counts": [len(groups) for groups in vertical_variants],
            "stable_candidate_count": sum(bool(record["bridge_stability"]["bridge_stable"]) for record in records),
            "unstable_candidate_count": sum(not bool(record["bridge_stability"]["bridge_stable"]) for record in records),
        },
        "token_count": len(records),
        "orphan_component_count": len(orphans),
        "orphan_component_ids": orphans,
        "review_sheet_files": sheet_names,
        "reading_streams": streams,
        "residual_unexplained_ink": {
            "audit_file": "residual-unexplained-ink-audit.json",
            "component_count": len(residual_rows),
        },
        "tokens": records,
        "elapsed_seconds": round(time.monotonic() - started, 3),
    }
    page_record["record_sha256"] = _sha256_bytes(_canonical_json(page_record).encode())
    write_json(page_dir / "bridge-instability.json", {
        "schema_version": "word-envelope-bridge-instability.v1",
        "page_id": spec.page_id,
        "horizontal_bridge_shapes": [list(shape) for shape in bridge_shapes],
        "horizontal_candidate_counts": [len(groups) for groups in horizontal_variants],
        "vertical_candidate_counts": [len(groups) for groups in vertical_variants],
        "candidate_rows": [record["bridge_stability"] for record in records],
        "interpretation": "Orange boxes in numbered-token-preview.jpg changed membership under one or more bridge settings. They are review candidates, not confirmed words.",
    })
    write_json(page_dir / "page-record.json", page_record)
    _write_log(log, f"[{spec.page_id}] bridge settings horizontal={(3, 9), (3, 13), (5, 17)} counts={page_record['bridge_variants']['horizontal_candidate_counts']}; vertical counts={page_record['bridge_variants']['vertical_candidate_counts']}")
    _write_log(log, f"[{spec.page_id}] completed {len(records)} candidate groups; envelopes failed={sum(item['envelope'] is None for item in records)}; orphan components={len(orphans)}; residual audit={len(residual_rows)}; record_sha256={page_record['record_sha256']}; elapsed={page_record['elapsed_seconds']}s")
    return page_record


def main() -> None:
    root = Path("artifacts/full-page-agent-trial-v1/worker")
    if root.exists() and any(root.iterdir()):
        # Only the append-only log can pre-exist from kickoff.  A rerun must use
        # another run directory so no agent can overwrite a decision history.
        permitted = {"worker-log.md", "page-previews", "reading-stream-inventory.json"}
        unexpected = [item.name for item in root.iterdir() if item.name not in permitted]
        if unexpected:
            raise RuntimeError(f"Refusing to overwrite existing run files: {unexpected}")
    root.mkdir(parents=True, exist_ok=True)
    log = root / "worker-log.md"
    _write_log(log, "# Full-page annotation worker log")
    _write_log(log, "No benchmark truth or human-review artifacts were read.  Source pages only.")
    pages = [_run_page(spec, root, log) for spec in PAGES]
    summary = {
        "schema_version": RUN_SCHEMA,
        "run_id": "full-page-agent-trial-v1",
        "pages": [{
            "page_id": item["page_id"],
            "source_sha256": item["source"]["sha256"],
            "token_count": item["token_count"],
            "failed_envelope_count": sum(token["envelope"] is None for token in item["tokens"]),
            "unreadable_token_count": sum(token["transcript"] == "[unreadable]" for token in item["tokens"]),
            "orphan_component_count": item["orphan_component_count"],
            "page_record_sha256": item["record_sha256"],
        } for item in pages],
        "not_an_accuracy_evaluation": True,
        "next_gate": "Independent transcription/ownership review before any production acceptance.",
    }
    summary["summary_sha256"] = _sha256_bytes(_canonical_json(summary).encode())
    write_json(root / "summary.json", summary)
    _write_log(log, f"[run] wrote immutable summary sha256={summary['summary_sha256']}")


if __name__ == "__main__":
    main()
