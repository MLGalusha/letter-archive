#!/usr/bin/env python3
"""Build bounded, spatial-only residual review regions for pass 2.

The regions in this file are a *software grouping proposal*.  They are not a
reading, a semantic classification, or an ownership decision.  Their only job
is to make the exact residual connected-component inventory reviewable without
dropping, duplicating, or silently merging component identities.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage import measure


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = "residual-review-regions.v2"
WARNING = (
    "Regions are deterministic software spatial grouping proposals only; they "
    "are not semantic classification, ownership, transcription, or ground truth."
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _safe_name(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in value)
    return cleaned or "region"


def _resolve_packet_path(packet_path: Path, value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    from_root = ROOT / candidate
    return from_root if from_root.exists() else packet_path.parent / candidate


def _box_xyxy(box: Iterable[int]) -> tuple[int, int, int, int]:
    x, y, width, height = (int(value) for value in box)
    return x, y, x + width, y + height


def _box_xywh(left: int, top: int, right: int, bottom: int) -> list[int]:
    return [left, top, right - left, bottom - top]


def _union_box(boxes: Iterable[Iterable[int]]) -> list[int]:
    xyxy = [_box_xyxy(box) for box in boxes]
    if not xyxy:
        raise RuntimeError("A spatial region needs at least one box")
    return _box_xywh(
        min(item[0] for item in xyxy), min(item[1] for item in xyxy),
        max(item[2] for item in xyxy), max(item[3] for item in xyxy),
    )


def _intersects(first: list[int], second: list[int]) -> bool:
    ax0, ay0, ax1, ay1 = _box_xyxy(first)
    bx0, by0, bx1, by1 = _box_xyxy(second)
    return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1


def _expanded(box: list[int], pad_x: int, pad_y: int, size: tuple[int, int]) -> list[int]:
    x0, y0, x1, y1 = _box_xyxy(box)
    return _box_xywh(max(0, x0 - pad_x), max(0, y0 - pad_y), min(size[0], x1 + pad_x), min(size[1], y1 + pad_y))


def _point_gap(point: tuple[float, float], box: list[int]) -> tuple[float, float]:
    x, y = point
    x0, y0, x1, y1 = _box_xyxy(box)
    return max(float(x0) - x, 0.0, x - float(x1)), max(float(y0) - y, 0.0, y - float(y1))


def _component_inventory(mask: np.ndarray) -> list[dict[str, Any]]:
    labels = measure.label(np.asarray(mask, dtype=bool), connectivity=2)
    result: list[dict[str, Any]] = []
    for item in measure.regionprops(labels):
        y0, x0, y1, x1 = item.bbox
        result.append({
            "component_id": f"C{int(item.label):06d}",
            "area_px": int(item.area),
            "bbox_source_xywh": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
            "centroid_source_xy": [round(float(item.centroid[1]), 3), round(float(item.centroid[0]), 3)],
            "touches_source_border": bool(x0 == 0 or y0 == 0 or x1 == mask.shape[1] or y1 == mask.shape[0]),
        })
    return result


def _scale_config(size: tuple[int, int]) -> dict[str, int | float | list[int]]:
    """Scale against the 3000x4000 reference, preserving behavior at 1200x1600."""
    width, height = size
    scale = min(width / 3000.0, height / 4000.0)
    # Deliberately retain a modest minimum for small synthetic pages.
    def px(reference: int, minimum: int) -> int:
        return max(minimum, round(reference * scale))

    return {
        "reference_source_size": [3000, 4000],
        "source_scale": round(scale, 6),
        "line_association_pad_x_px": px(90, 24),
        "line_association_pad_y_px": px(95, 24),
        "region_crop_pad_x_px": px(90, 24),
        "region_crop_pad_y_px": px(75, 20),
        "max_region_component_count": 24,
        "max_region_source_width_px": min(width, px(1200, 320)),
        "max_region_source_height_px": min(height, px(760, 220)),
        "max_board_display_width_px": 1400,
        "max_board_display_height_px": 1100,
    }


def _validate_manifest_outputs(manifest_path: Path, manifest: dict[str, Any]) -> dict[str, Path]:
    claim = manifest.get("manifest_sha256")
    unsigned = dict(manifest)
    unsigned.pop("manifest_sha256", None)
    if not isinstance(claim, str) or claim != canonical_hash(unsigned):
        raise RuntimeError("Knockout manifest_sha256 is stale")
    outputs = manifest.get("outputs")
    if not isinstance(outputs, list):
        raise RuntimeError("Knockout manifest outputs are missing")
    found: dict[str, Path] = {}
    for item in outputs:
        relative = item.get("path") if isinstance(item, dict) else None
        expected = item.get("file_sha256") if isinstance(item, dict) else None
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise RuntimeError("Knockout manifest has an invalid output binding")
        path = manifest_path.parent / relative
        if not path.is_file() or sha256_file(path) != expected:
            raise RuntimeError(f"Knockout output hash changed: {relative}")
        found[relative] = path
    required = {"residual-candidates/residual-candidates.json", "masks/exact-candidate-residual.png"}
    missing = sorted(required - found.keys())
    if missing:
        raise RuntimeError(f"Knockout package is missing required bound outputs: {', '.join(missing)}")
    return found


def _validate_inputs(knockout_manifest_path: Path, packet_path: Path) -> tuple[dict[str, Any], dict[str, Any], Path, dict[str, Path], Image.Image]:
    if not knockout_manifest_path.is_file() or not packet_path.is_file():
        raise RuntimeError("Knockout manifest and public packet must both exist")
    manifest = json.loads(knockout_manifest_path.read_text(encoding="utf-8"))
    packet = json.loads(packet_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "full-page-ownership-knockout-manifest.v2":
        raise RuntimeError("Unexpected knockout manifest schema")
    if manifest.get("page_id") != packet.get("page_id"):
        raise RuntimeError("Knockout manifest and public packet page IDs do not match")
    outputs = _validate_manifest_outputs(knockout_manifest_path, manifest)
    packet_claim = packet.get("packet_sha256")
    unsigned_packet = dict(packet)
    unsigned_packet.pop("packet_sha256", None)
    if not isinstance(packet_claim, str) or packet_claim != canonical_hash(unsigned_packet):
        raise RuntimeError("Public packet packet_sha256 is stale")
    inputs = manifest.get("inputs", {})
    packet_input = inputs.get("public_packet", {})
    if packet_input.get("file_sha256") != sha256_file(packet_path):
        raise RuntimeError("Knockout manifest does not bind this exact public packet")
    if packet_input.get("packet_sha256") != packet_claim:
        raise RuntimeError("Knockout manifest packet internal hash does not match")
    source_info = packet.get("source", {})
    source_path = _resolve_packet_path(packet_path, source_info.get("path", ""))
    if not source_path.is_file():
        raise RuntimeError("Packet-bound source is missing")
    if sha256_file(source_path) != source_info.get("sha256"):
        raise RuntimeError("Packet-bound source hash changed")
    source_binding = inputs.get("source", {})
    if source_binding.get("file_sha256") != source_info.get("sha256"):
        raise RuntimeError("Knockout manifest source hash does not match packet")
    source = Image.open(source_path).convert("RGB")
    if list(source.size) != source_info.get("size") or list(source.size) != source_binding.get("size"):
        source.close()
        raise RuntimeError("Packet-bound source dimensions changed")
    return manifest, packet, source_path, outputs, source


def _load_exact_components(outputs: dict[str, Path], size: tuple[int, int], page_id: str) -> tuple[np.ndarray, list[dict[str, Any]]]:
    record = json.loads(outputs["residual-candidates/residual-candidates.json"].read_text(encoding="utf-8"))
    if record.get("page_id") != page_id:
        raise RuntimeError("Residual candidate record page ID does not match")
    with Image.open(outputs["masks/exact-candidate-residual.png"]) as image:
        residual = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    if tuple(residual.shape[::-1]) != size:
        raise RuntimeError("Exact residual mask dimensions do not match source")
    components = list(record.get("candidates", [])) + list(record.get("excluded_components", []))
    expected_inventory = _component_inventory(residual)
    expected_by_id = {item["component_id"]: item for item in expected_inventory}
    ids = [item.get("component_id") for item in components]
    if any(not isinstance(item, str) for item in ids) or len(ids) != len(set(ids)):
        raise RuntimeError("Residual component IDs are missing or duplicated in knockout package")
    if set(ids) != set(expected_by_id):
        raise RuntimeError("Residual component record does not cover the exact residual mask once")
    candidates = record.get("candidates", [])
    excluded = record.get("excluded_components", [])
    normalized: list[dict[str, Any]] = []
    for item in components:
        expected = expected_by_id[item["component_id"]]
        if item.get("bbox_source_xywh") != expected["bbox_source_xywh"] or int(item.get("area_px", -1)) != expected["area_px"]:
            raise RuntimeError(f"Residual component geometry changed: {item['component_id']}")
        normalized.append({
            "component_id": item["component_id"],
            "bbox_source_xywh": expected["bbox_source_xywh"],
            "area_px": expected["area_px"],
            "centroid_source_xy": expected["centroid_source_xy"],
            "knockout_inventory_class": "candidate" if item in candidates else "excluded",
            # A previous exclusion is a triage hint only.  It cannot remove a
            # component from this exact pass-2 review partition.
            "legacy_hint": "candidate" if item in candidates else str(item.get("reason", "excluded_without_reason")),
        })
    return residual, sorted(normalized, key=lambda item: item["component_id"])


def _line_geometries(packet: dict[str, Any], size: tuple[int, int]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for order, line in enumerate(packet.get("lines", []), start=1):
        boxes = [item.get("source_axis_aligned_bbox_xywh") for item in line.get("box_proposals", [])]
        boxes = [box for box in boxes if isinstance(box, list) and len(box) == 4]
        evidence = line.get("evidence", {}).get("source_crop_xyxy")
        if boxes:
            core = _union_box(boxes)
        elif isinstance(evidence, list) and len(evidence) == 4:
            left, top, right, bottom = (int(value) for value in evidence)
            core = _box_xywh(left, top, right, bottom)
        else:
            continue
        if core[2] <= 0 or core[3] <= 0:
            continue
        lines.append({"line_id": str(line.get("line_id", f"line-{order:02d}")), "line_order": order, "core_bbox_source_xywh": core})
    return lines


def _associate_components(components: list[dict[str, Any]], lines: list[dict[str, Any]], size: tuple[int, int], config: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    pad_x, pad_y = int(config["line_association_pad_x_px"]), int(config["line_association_pad_y_px"])
    for component in components:
        centroid = tuple(component["centroid_source_xy"])
        possible: list[tuple[float, int, str]] = []
        for line in lines:
            expanded = _expanded(line["core_bbox_source_xywh"], pad_x, pad_y, size)
            if not _intersects(component["bbox_source_xywh"], expanded):
                continue
            gap_x, gap_y = _point_gap(centroid, line["core_bbox_source_xywh"])
            # Vertical proximity dominates line association; this is geometry,
            # not an inference about what the mark represents.
            score = gap_y / max(1, pad_y) + gap_x / max(1, pad_x * 2)
            possible.append((score, line["line_order"], line["line_id"]))
        if possible:
            _, _, line_id = min(possible)
            result[f"line:{line_id}"].append(component)
        else:
            result["outside-line"].append(component)
    return result


def _spatial_groups(components: list[dict[str, Any]], config: dict[str, Any]) -> list[list[dict[str, Any]]]:
    """Greedily keep each exact-ID group inside a bounded source crop."""
    if not components:
        return []
    maximum_count = int(config["max_region_component_count"])
    maximum_width = int(config["max_region_source_width_px"])
    maximum_height = int(config["max_region_source_height_px"])
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    # Outside-line marks use top-to-bottom ordering; line-associated marks use
    # left-to-right ordering.  The caller supplies an already spatially coherent
    # association bucket, so this is deterministic and deliberately nonsemantic.
    for component in sorted(components, key=lambda item: (item["bbox_source_xywh"][0], item["bbox_source_xywh"][1], item["component_id"])):
        proposed = current + [component]
        box = _union_box(item["bbox_source_xywh"] for item in proposed)
        if current and (len(proposed) > maximum_count or box[2] > maximum_width or box[3] > maximum_height):
            groups.append(current)
            current = [component]
        else:
            current = proposed
    if current:
        groups.append(current)
    return groups


def _render_board(source: Image.Image, residual: np.ndarray, region: dict[str, Any], destination: Path, config: dict[str, Any]) -> dict[str, Any]:
    pad_x, pad_y = int(config["region_crop_pad_x_px"]), int(config["region_crop_pad_y_px"])
    crop_box = _expanded(region["bbox_source_xywh"], pad_x, pad_y, source.size)
    left, top, right, bottom = _box_xyxy(crop_box)
    crop = source.crop((left, top, right, bottom)).convert("RGB")
    array = np.asarray(crop, dtype=np.uint8).copy()
    selected = residual[top:bottom, left:right]
    orange = np.array([244, 139, 31], dtype=np.uint8)
    array[selected] = ((array[selected].astype(np.uint16) + orange * 2) // 3).astype(np.uint8)
    body = Image.fromarray(array, mode="RGB")
    display_scale = min(
        1.0,
        int(config["max_board_display_width_px"]) / max(1, body.width),
        (int(config["max_board_display_height_px"]) - 64) / max(1, body.height),
    )
    if display_scale != 1.0:
        body = body.resize((max(1, round(body.width * display_scale)), max(1, round(body.height * display_scale))), Image.Resampling.LANCZOS)
    board = Image.new("RGB", (body.width, body.height + 64), "#f4f1e9")
    board.paste(body, (0, 64))
    draw = ImageDraw.Draw(board)
    draw.text((9, 7), f"{region['region_id']} | {region['association']['kind']}", fill="#111111", font=_font(17))
    draw.text((9, 32), "ORANGE = exact residual ink; labels are component IDs; grouping proposes no answer.", fill="#333333", font=_font(12))
    label_font = _font(14)
    for component_id, bbox in zip(region["component_ids"], region["component_bboxes_source_xywh"]):
        x, y, _, _ = bbox
        draw.text((round((x - left) * display_scale), 64 + round((y - top) * display_scale)), component_id, fill="white", font=label_font, stroke_width=2, stroke_fill="black")
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="PNG", compress_level=9, optimize=False)
    display_size = list(board.size)
    body.close()
    board.close()
    crop.close()
    return {"path": str(destination.name), "file_sha256": sha256_file(destination), "source_crop_xyxy": [left, top, right, bottom], "display_size": display_size}


def build(knockout_manifest_path: Path, *, packet_path: Path, output_dir: Path) -> Path:
    """Build a new immutable residual-region package and return its manifest."""
    knockout_manifest_path, packet_path, output_dir = knockout_manifest_path.resolve(), packet_path.resolve(), output_dir.resolve()
    if output_dir.exists() or output_dir.is_symlink():
        raise RuntimeError(f"Refusing to overwrite residual review output: {output_dir}")
    manifest, packet, source_path, outputs, source = _validate_inputs(knockout_manifest_path, packet_path)
    try:
        residual, components = _load_exact_components(outputs, source.size, str(manifest["page_id"]))
        config = _scale_config(source.size)
        lines = _line_geometries(packet, source.size)
        association = _associate_components(components, lines, source.size, config)
        regions: list[dict[str, Any]] = []
        line_order = {item["line_id"]: item["line_order"] for item in lines}
        for key in sorted(association, key=lambda item: (item == "outside-line", line_order.get(item.removeprefix("line:"), 10**9), item)):
            groups = _spatial_groups(association[key], config)
            for index, group in enumerate(groups, start=1):
                line_id = key.removeprefix("line:") if key.startswith("line:") else None
                prefix = f"line-{_safe_name(line_id)}" if line_id else "outside-line"
                region_id = f"{prefix}-r{index:03d}"
                bbox = _union_box(item["bbox_source_xywh"] for item in group)
                regions.append({
                    "region_id": region_id,
                    "region_kind": "line_associated_spatial_group" if line_id else "unassigned_outside_line_spatial_group",
                    "association": {
                        "kind": "software_line_geometry_proposal_not_truth" if line_id else "software_unassigned_outside_line_not_truth",
                        "line_id": line_id,
                    },
                    "bbox_source_xywh": bbox,
                    "component_count": len(group),
                    "component_ids": [item["component_id"] for item in group],
                    "component_bboxes_source_xywh": [item["bbox_source_xywh"] for item in group],
                    "component_legacy_hints": [item["legacy_hint"] for item in group],
                    "component_area_px_total": sum(item["area_px"] for item in group),
                    "knockout_inventory_classes": sorted({item["knockout_inventory_class"] for item in group}),
                    "warning": WARNING,
                })
        flattened = [component_id for region in regions for component_id in region["component_ids"]]
        expected = [item["component_id"] for item in components]
        if len(flattened) != len(set(flattened)) or set(flattened) != set(expected):
            raise RuntimeError("Internal error: review regions did not retain every residual component exactly once")
        output_dir.mkdir(parents=True, exist_ok=False)
        for region in regions:
            board = _render_board(source, residual, region, output_dir / "boards" / f"{region['region_id']}.png", config)
            board["path"] = f"boards/{board['path']}"
            region["board"] = board
        result: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "page_id": manifest["page_id"],
            "warning": WARNING,
            "inputs": {
                "knockout_manifest": {"file_sha256": sha256_file(knockout_manifest_path), "manifest_sha256": manifest["manifest_sha256"]},
                "public_packet": {"file_sha256": sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
                "source": {"path": str(source_path), "file_sha256": sha256_file(source_path), "size": list(source.size)},
                "exact_residual_mask": {"knockout_relative_path": "masks/exact-candidate-residual.png", "file_sha256": sha256_file(outputs["masks/exact-candidate-residual.png"])},
                "residual_component_record": {"knockout_relative_path": "residual-candidates/residual-candidates.json", "file_sha256": sha256_file(outputs["residual-candidates/residual-candidates.json"])},
            },
            "configuration": config,
            "line_geometry_count": len(lines),
            "component_count": len(components),
            "normalized_residual_pixel_count": int(sum(item["area_px"] for item in components)),
            "normalized_residual_component_counts_by_legacy_hint": {
                hint: sum(item["legacy_hint"] == hint for item in components)
                for hint in sorted({item["legacy_hint"] for item in components})
            },
            "normalized_residual_pixel_counts_by_legacy_hint": {
                hint: sum(item["area_px"] for item in components if item["legacy_hint"] == hint)
                for hint in sorted({item["legacy_hint"] for item in components})
            },
            "component_ids_canonical_sha256": canonical_hash(expected),
            "region_count": len(regions),
            "has_unassigned_outside_line_region": any(region["association"]["line_id"] is None for region in regions),
            "regions": regions,
        }
        result["manifest_sha256"] = canonical_hash(result)
        manifest_path = output_dir / "manifest.json"
        write_json(manifest_path, result)
        return manifest_path
    finally:
        source.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("knockout_manifest", type=Path)
    parser.add_argument("--packet", required=True, type=Path, help="Bound public pass-1 packet")
    parser.add_argument("--output-dir", required=True, type=Path, help="New output directory; it must not exist")
    args = parser.parse_args()
    print(build(args.knockout_manifest, packet_path=args.packet, output_dir=args.output_dir))


if __name__ == "__main__":
    main()
