"""Deterministic whole-page ownership prefill from disposable word proposals."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
from jsonschema import Draft202012Validator

from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes, sha256_file
from .simple_page_agent import _hash_record, _write_new


PREFILL_VERSION = "batch-word-prefill.v1"
LINE_PACKET_VERSION = "line-batch-word-packet.v1"


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ConsoleError("invalid_prefill_input", f"{path.name} must contain an object")
    return value


def _load_binary(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    if not path.is_file() or path.is_symlink():
        raise ConsoleError("integrity_error", "The clean ink mask is missing")
    with Image.open(path) as image:
        if image.size != size_wh:
            raise ConsoleError("integrity_error", "The clean ink dimensions changed")
        values = np.asarray(image.convert("L"), dtype=np.uint8)
    if not set(int(value) for value in np.unique(values)).issubset({0, 255}):
        raise ConsoleError("integrity_error", "The clean ink mask is not binary")
    return values > 0


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def build_batch_word_prefill(
    selector_dir: Path | str,
    proposal_record_path: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    """Project proposal rectangles onto exact clean-ink components.

    Components touched by exactly one proposal become that proposal's candidate
    ownership. Components touched by multiple proposals are withheld as shared
    ink. Untouched components remain residual. Nothing is committed.
    """

    selector = Path(selector_dir).resolve()
    proposal_path = Path(proposal_record_path).resolve()
    output = Path(output_dir).resolve()
    if output.exists() or output.is_symlink():
        raise ConsoleError("prefill_exists", "The batch prefill output already exists", status=409)

    manifest = _read_object(selector / "manifest.json")
    layers = _read_object(selector / "ink-layers.json")
    proposals = _read_object(proposal_path)
    if layers.get("bound_manifest_sha256") != manifest.get("manifest_sha256"):
        raise ConsoleError("integrity_error", "The ink layers do not bind the selector")
    width, height = (int(value) for value in manifest["source"]["size_wh"])
    size_wh = (width, height)
    source_path = selector / manifest["source"]["working_path"]
    clean_entry = layers["layers"]["clean"]
    clean_path = selector / clean_entry["mask_path"]
    if sha256_file(source_path) != manifest["source"]["working_file_sha256"]:
        raise ConsoleError("integrity_error", "The source image changed")
    if sha256_file(clean_path) != clean_entry["mask_file_sha256"]:
        raise ConsoleError("integrity_error", "The clean ink mask changed")
    clean = _load_binary(clean_path, size_wh)
    labels, component_count = ndimage.label(
        clean,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    labels = labels.astype(np.int32, copy=False)

    raw_units = proposals.get("units")
    if not isinstance(raw_units, list) or not raw_units:
        raise ConsoleError("invalid_prefill_input", "The proposal record has no units")
    units: list[dict[str, Any]] = []
    component_touchers: list[set[int]] = [set() for _ in range(component_count + 1)]
    box_coverage = np.zeros(clean.shape, dtype=np.uint16)
    for index, raw in enumerate(raw_units):
        if not isinstance(raw, Mapping):
            raise ConsoleError("invalid_prefill_input", "Every proposal must be an object")
        bbox = raw.get("source_axis_aligned_bbox_xywh")
        if (
            not isinstance(bbox, list)
            or len(bbox) != 4
            or any(not isinstance(value, (int, float)) for value in bbox)
        ):
            raise ConsoleError("invalid_prefill_input", "Every proposal needs one source bbox")
        x, y, box_width, box_height = (round(float(value)) for value in bbox)
        x0 = max(0, min(width, x))
        y0 = max(0, min(height, y))
        x1 = max(x0, min(width, x + max(1, box_width)))
        y1 = max(y0, min(height, y + max(1, box_height)))
        touched = sorted(
            int(value)
            for value in np.unique(labels[y0:y1, x0:x1])
            if int(value) > 0
        )
        unit = {
            "proposal_index": index + 1,
            "proposal_id": str(raw.get("id", f"proposal-{index + 1:04d}")),
            "stream_id": str(raw.get("stream_id", "unknown")),
            "line_id": str(raw.get("line_id", "unknown")),
            "source_bbox_xywh": [x0, y0, x1 - x0, y1 - y0],
            "touched_component_ids": touched,
        }
        units.append(unit)
        box_coverage[y0:y1, x0:x1] += np.uint16(1)
        for component_id in touched:
            component_touchers[component_id].add(index)

    shared_component_ids = {
        component_id
        for component_id in range(1, component_count + 1)
        if len(component_touchers[component_id]) > 1
    }
    candidate_owner = np.full(labels.shape, -1, dtype=np.int32)
    for component_id in range(1, component_count + 1):
        touchers = component_touchers[component_id]
        if len(touchers) == 1:
            candidate_owner[labels == component_id] = next(iter(touchers))
    shared = np.isin(labels, list(shared_component_ids)) if shared_component_ids else np.zeros_like(clean)
    assigned = candidate_owner >= 0
    residual = clean & ~assigned & ~shared
    clipped_assigned = clean & (box_coverage == 1)
    clipped_collision = clean & (box_coverage > 1)
    clipped_residual = clean & (box_coverage == 0)

    for index, unit in enumerate(units):
        owned = candidate_owner == index
        x, y, box_width, box_height = unit["source_bbox_xywh"]
        touched_shared = [
            component_id
            for component_id in unit["touched_component_ids"]
            if component_id in shared_component_ids
        ]
        unit.update(
            {
                "candidate_component_ids": [
                    component_id
                    for component_id in unit["touched_component_ids"]
                    if component_id not in shared_component_ids
                ],
                "candidate_component_count": len(
                    set(unit["touched_component_ids"]) - shared_component_ids
                ),
                "candidate_pixels": int(owned.sum()),
                "shared_component_ids": touched_shared,
                "shared_pixels": int(np.count_nonzero(shared & np.isin(labels, touched_shared))),
                "clipped_candidate_pixels": int(
                    np.count_nonzero(clean[y : y + box_height, x : x + box_width])
                ),
                "clipped_collision_pixels": int(
                    np.count_nonzero(
                        clipped_collision[y : y + box_height, x : x + box_width]
                    )
                ),
                "status": (
                    "empty"
                    if not np.any(owned) and not touched_shared
                    else "shared_ink_review"
                    if touched_shared
                    else "candidate_ready"
                ),
            }
        )

    output.mkdir(parents=True)
    mask_dir = output / "masks"
    mask_dir.mkdir()
    for name, mask in (
        ("component-assigned", assigned),
        ("component-shared", shared),
        ("component-residual", residual),
        ("clipped-assigned", clipped_assigned),
        ("clipped-collision", clipped_collision),
        ("clipped-residual", clipped_residual),
    ):
        Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L").save(
            mask_dir / f"{name}.png", format="PNG"
        )

    with Image.open(source_path) as image:
        source = np.asarray(image.convert("RGB"), dtype=np.uint8)
    original_overlay = source.copy()
    original_overlay[clipped_assigned] = (
        original_overlay[clipped_assigned].astype(np.uint16) * 35 // 100
        + np.array([210, 47, 47], dtype=np.uint16) * 65 // 100
    ).astype(np.uint8)
    original_overlay[clipped_collision] = (
        original_overlay[clipped_collision].astype(np.uint16) * 30 // 100
        + np.array([245, 139, 31], dtype=np.uint16) * 70 // 100
    ).astype(np.uint8)
    ink_panel = np.full((*clean.shape, 3), 250, dtype=np.uint8)
    ink_panel[clipped_residual] = (25, 25, 25)
    ink_panel[clipped_assigned] = (210, 47, 47)
    ink_panel[clipped_collision] = (245, 139, 31)

    preview_wh = (900, 1200)
    original_preview = Image.fromarray(original_overlay, mode="RGB").resize(
        preview_wh, Image.Resampling.LANCZOS
    )
    ink_preview = Image.fromarray(ink_panel, mode="RGB").resize(
        preview_wh, Image.Resampling.NEAREST
    )
    locator = Image.fromarray(source, mode="RGB").resize(preview_wh, Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(locator)
    scale_x = preview_wh[0] / width
    scale_y = preview_wh[1] / height
    label_font = _font(12)
    for unit in units:
        x, y, box_width, box_height = unit["source_bbox_xywh"]
        box = (
            round(x * scale_x),
            round(y * scale_y),
            round((x + box_width) * scale_x),
            round((y + box_height) * scale_y),
        )
        color = (245, 139, 31) if unit["shared_component_ids"] else (12, 118, 128)
        draw.rectangle(box, outline=color, width=2)
        draw.text((box[0] + 2, box[1] + 1), str(unit["proposal_index"]), fill=color, font=label_font)

    gutter = 14
    header = 48
    collage = Image.new("RGB", (preview_wh[0] * 3 + gutter * 2, preview_wh[1] + header), (248, 243, 233))
    collage.paste(original_preview, (0, header))
    collage.paste(ink_preview, (preview_wh[0] + gutter, header))
    collage.paste(locator, ((preview_wh[0] + gutter) * 2, header))
    collage_draw = ImageDraw.Draw(collage)
    title_font = _font(24)
    for x, title in (
        (10, "Original + proposed ownership"),
        (preview_wh[0] + gutter + 10, "Clean ink clipped by proposals: red assigned, orange overlap, black residual"),
        ((preview_wh[0] + gutter) * 2 + 10, "Software proposal IDs (disposable)"),
    ):
        collage_draw.text((x, 10), title, fill=(40, 40, 40), font=title_font)
    collage_path = output / "batch-review-collage.png"
    collage.save(collage_path, format="PNG", optimize=True)

    packet: dict[str, Any] = {
        "schema_version": PREFILL_VERSION,
        "source": {
            "selector_manifest_sha256": manifest["manifest_sha256"],
            "source_file_sha256": sha256_file(source_path),
            "clean_mask_file_sha256": sha256_file(clean_path),
            "proposal_record_file_sha256": sha256_file(proposal_path),
            "size_wh": [width, height],
        },
        "semantics": {
            "proposal_boxes_are_truth": False,
            "transcript_is_truth": False,
            "candidate_rule": "whole clean-ink component touched by exactly one proposal",
            "shared_rule": "whole component touched by multiple proposals is withheld",
            "nothing_is_committed": True,
        },
        "counts": {
            "proposals": len(units),
            "clean_components": int(component_count),
            "clean_pixels": int(clean.sum()),
            "assigned_pixels": int(assigned.sum()),
            "shared_components": len(shared_component_ids),
            "shared_pixels": int(shared.sum()),
            "residual_pixels": int(residual.sum()),
            "clipped_assigned_pixels": int(clipped_assigned.sum()),
            "clipped_collision_pixels": int(clipped_collision.sum()),
            "clipped_residual_pixels": int(clipped_residual.sum()),
            "empty_proposals": sum(unit["status"] == "empty" for unit in units),
            "shared_review_proposals": sum(
                unit["status"] == "shared_ink_review" for unit in units
            ),
        },
        "units": units,
        "evidence": {
            "collage_path": collage_path.name,
            "collage_file_sha256": sha256_file(collage_path),
            "component_assigned_mask_path": "masks/component-assigned.png",
            "component_assigned_mask_file_sha256": sha256_file(mask_dir / "component-assigned.png"),
            "component_shared_mask_path": "masks/component-shared.png",
            "component_shared_mask_file_sha256": sha256_file(mask_dir / "component-shared.png"),
            "component_residual_mask_path": "masks/component-residual.png",
            "component_residual_mask_file_sha256": sha256_file(mask_dir / "component-residual.png"),
            "clipped_assigned_mask_path": "masks/clipped-assigned.png",
            "clipped_assigned_mask_file_sha256": sha256_file(mask_dir / "clipped-assigned.png"),
            "clipped_collision_mask_path": "masks/clipped-collision.png",
            "clipped_collision_mask_file_sha256": sha256_file(mask_dir / "clipped-collision.png"),
            "clipped_residual_mask_path": "masks/clipped-residual.png",
            "clipped_residual_mask_file_sha256": sha256_file(mask_dir / "clipped-residual.png"),
        },
    }
    packet["prefill_sha256"] = _hash_record(packet, "prefill_sha256")
    _write_new(output / "batch-prefill.json", canonical_json_bytes(packet) + b"\n")
    return packet


def build_line_batch_packets(
    selector_dir: Path | str,
    proposal_record_path: Path | str,
    output_dir: Path | str,
    *,
    padding_px: int = 120,
) -> dict[str, Any]:
    """Render one large two-panel crop and positional packet per proposal line."""

    selector = Path(selector_dir).resolve()
    proposal_path = Path(proposal_record_path).resolve()
    output = Path(output_dir).resolve()
    if output.exists() or output.is_symlink():
        raise ConsoleError("line_batch_exists", "The line batch output already exists", status=409)
    if padding_px < 0 or padding_px > 1000:
        raise ConsoleError("invalid_line_batch", "Line padding is out of range")

    manifest = _read_object(selector / "manifest.json")
    layers = _read_object(selector / "ink-layers.json")
    record = _read_object(proposal_path)
    if layers.get("bound_manifest_sha256") != manifest.get("manifest_sha256"):
        raise ConsoleError("integrity_error", "The ink layers do not bind the selector")
    width, height = (int(value) for value in manifest["source"]["size_wh"])
    source_path = selector / manifest["source"]["working_path"]
    clean_entry = layers["layers"]["clean"]
    clean_path = selector / clean_entry["mask_path"]
    if sha256_file(source_path) != manifest["source"]["working_file_sha256"]:
        raise ConsoleError("integrity_error", "The source image changed")
    if sha256_file(clean_path) != clean_entry["mask_file_sha256"]:
        raise ConsoleError("integrity_error", "The clean ink mask changed")
    clean = _load_binary(clean_path, (width, height))
    with Image.open(source_path) as image:
        source = image.convert("RGB")

    grouped: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
    ordered_keys: list[tuple[str, str]] = []
    for raw in record.get("units", []):
        if not isinstance(raw, Mapping):
            raise ConsoleError("invalid_line_batch", "Every proposal must be an object")
        key = (str(raw.get("stream_id", "unknown")), str(raw.get("line_id", "unknown")))
        if key not in grouped:
            grouped[key] = []
            ordered_keys.append(key)
        grouped[key].append(raw)

    root = Path(__file__).resolve().parents[2]
    prompt_source = root / "prompts/line-batch-word-selector-v1.md"
    schema_source = root / "schemas/line-batch-word-selection-v1.schema.json"
    output.mkdir(parents=True)
    protocol = output / "protocol"
    protocol.mkdir()
    _write_new(protocol / "prompt.md", prompt_source.read_bytes())
    _write_new(protocol / "response-schema.json", schema_source.read_bytes())
    line_entries: list[dict[str, Any]] = []

    for line_order, key in enumerate(ordered_keys, start=1):
        stream_id, line_id = key
        raw_units = grouped[key]
        boxes: list[tuple[int, int, int, int]] = []
        for raw in raw_units:
            bbox = raw.get("source_axis_aligned_bbox_xywh")
            if not isinstance(bbox, list) or len(bbox) != 4:
                raise ConsoleError("invalid_line_batch", "Every proposal needs one bbox")
            x, y, box_width, box_height = (round(float(value)) for value in bbox)
            boxes.append((x, y, max(1, box_width), max(1, box_height)))
        crop_x0 = max(0, min(x for x, _, _, _ in boxes) - padding_px)
        crop_y0 = max(0, min(y for _, y, _, _ in boxes) - padding_px)
        crop_x1 = min(width, max(x + box_width for x, _, box_width, _ in boxes) + padding_px)
        crop_y1 = min(height, max(y + box_height for _, y, _, box_height in boxes) + padding_px)
        crop_width = max(1, crop_x1 - crop_x0)
        crop_height = max(1, crop_y1 - crop_y0)
        scale = min(1.0, 1400.0 / crop_width, 650.0 / crop_height)
        panel_wh = (max(1, round(crop_width * scale)), max(1, round(crop_height * scale)))

        original = source.crop((crop_x0, crop_y0, crop_x1, crop_y1)).resize(
            panel_wh, Image.Resampling.LANCZOS
        )
        clean_crop = clean[crop_y0:crop_y1, crop_x0:crop_x1]
        ink_rgb = np.full((*clean_crop.shape, 3), 250, dtype=np.uint8)
        ink_rgb[clean_crop] = (20, 20, 20)
        ink_panel = Image.fromarray(ink_rgb, mode="RGB").resize(
            panel_wh, Image.Resampling.NEAREST
        )
        draw = ImageDraw.Draw(ink_panel)
        label_font = _font(15)
        public_units: list[dict[str, Any]] = []
        for proposal_order, (raw, bbox) in enumerate(zip(raw_units, boxes), start=1):
            x, y, box_width, box_height = bbox
            local_box = [
                round((x - crop_x0) * scale),
                round((y - crop_y0) * scale),
                max(1, round(box_width * scale)),
                max(1, round(box_height * scale)),
            ]
            bx, by, bw, bh = local_box
            draw.rectangle((bx, by, bx + bw, by + bh), outline=(12, 118, 128), width=2)
            proposal_id = str(raw.get("id", f"{line_id}-{proposal_order:02d}"))
            draw.text((bx + 2, by + 1), str(proposal_order), fill=(12, 118, 128), font=label_font)
            public_units.append(
                {
                    "proposal_order": proposal_order,
                    "proposal_id": proposal_id,
                    "reference_text": str(raw.get("transcript", "")),
                    "source_bbox_xywh": list(bbox),
                    "clean_panel_bbox_xywh": local_box,
                }
            )

        header = 46
        gutter = 12
        collage = Image.new("RGB", (panel_wh[0] * 2 + gutter, panel_wh[1] + header), (248, 243, 233))
        collage.paste(original, (0, header))
        collage.paste(ink_panel, (panel_wh[0] + gutter, header))
        collage_draw = ImageDraw.Draw(collage)
        title_font = _font(22)
        collage_draw.text((8, 10), "Original context", fill=(35, 35, 35), font=title_font)
        collage_draw.text(
            (panel_wh[0] + gutter + 8, 10),
            "Clean selectable ink + disposable software proposals",
            fill=(35, 35, 35),
            font=title_font,
        )
        line_dir = output / f"line-{line_order:03d}-{line_id}"
        line_dir.mkdir()
        collage_path = line_dir / "collage.png"
        collage.save(collage_path, format="PNG", optimize=True)
        packet: dict[str, Any] = {
            "schema_version": LINE_PACKET_VERSION,
            "line_order": line_order,
            "line_id": line_id,
            "stream_id": stream_id,
            "content_order": ["prompt", "packet", "response_schema", "collage"],
            "prompt": {
                "path": "../protocol/prompt.md",
                "file_sha256": sha256_file(protocol / "prompt.md"),
            },
            "response_schema": {
                "path": "../protocol/response-schema.json",
                "file_sha256": sha256_file(protocol / "response-schema.json"),
            },
            "coordinate_space": {
                "origin": "clean_ink_panel_content_top_left",
                "size_wh": list(panel_wh),
                "units": "integer_preview_pixels",
                "source_crop_xywh": [crop_x0, crop_y0, crop_width, crop_height],
                "preview_to_source_scale": 1.0 / scale,
            },
            "reference": {
                "fallible_not_truth": True,
                "proposal_count": len(public_units),
                "proposal_words": [unit["reference_text"] for unit in public_units],
            },
            "proposals": public_units,
            "collage": {
                "path": collage_path.name,
                "file_sha256": sha256_file(collage_path),
                "size_wh": list(collage.size),
                "panel_content_size_wh": list(panel_wh),
            },
        }
        packet["line_packet_sha256"] = _hash_record(packet, "line_packet_sha256")
        _write_new(line_dir / "packet.json", canonical_json_bytes(packet) + b"\n")
        line_entries.append(
            {
                "line_order": line_order,
                "line_id": line_id,
                "stream_id": stream_id,
                "proposal_count": len(public_units),
                "packet_path": str((line_dir / "packet.json").relative_to(output)),
                "packet_file_sha256": sha256_file(line_dir / "packet.json"),
                "line_packet_sha256": packet["line_packet_sha256"],
            }
        )

    session: dict[str, Any] = {
        "schema_version": "line-batch-word-session.v1",
        "source": {
            "selector_manifest_sha256": manifest["manifest_sha256"],
            "proposal_record_file_sha256": sha256_file(proposal_path),
            "source_file_sha256": sha256_file(source_path),
            "clean_mask_file_sha256": sha256_file(clean_path),
        },
        "protocol": {
            "prompt_file_sha256": sha256_file(protocol / "prompt.md"),
            "response_schema_file_sha256": sha256_file(protocol / "response-schema.json"),
        },
        "line_count": len(line_entries),
        "lines": line_entries,
    }
    session["session_sha256"] = _hash_record(session, "session_sha256")
    _write_new(output / "session.json", canonical_json_bytes(session) + b"\n")
    return session


def validate_line_batch_decision(
    selector_dir: Path | str,
    line_packet_path: Path | str,
    decision_path: Path | str,
) -> dict[str, Any]:
    """Resolve one batched seed decision into exact component ownership evidence."""

    selector = Path(selector_dir).resolve()
    packet_path = Path(line_packet_path).resolve()
    choice_path = Path(decision_path).resolve()
    packet = _read_object(packet_path)
    decision = _read_object(choice_path)
    if packet.get("schema_version") != LINE_PACKET_VERSION or packet.get(
        "line_packet_sha256"
    ) != _hash_record(packet, "line_packet_sha256"):
        raise ConsoleError("integrity_error", "The line packet changed")
    schema_path = packet_path.parent.parent / "protocol/response-schema.json"
    if sha256_file(schema_path) != packet["response_schema"]["file_sha256"]:
        raise ConsoleError("integrity_error", "The line response schema changed")
    schema = _read_object(schema_path)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(decision),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        raise ConsoleError("invalid_line_decision", errors[0].message)
    if decision["line_id"] != packet["line_id"]:
        raise ConsoleError("invalid_line_decision", "The decision targets another line")
    words = decision["visible_words"]
    if [word["word_order"] for word in words] != list(range(1, len(words) + 1)):
        raise ConsoleError("invalid_line_decision", "Word order must be consecutive")
    allowed_proposals = {unit["proposal_id"] for unit in packet["proposals"]}
    cited = [proposal_id for word in words for proposal_id in word["proposal_ids"]]
    if not set(cited).issubset(allowed_proposals):
        raise ConsoleError("invalid_line_decision", "The decision cites an unknown proposal")

    manifest = _read_object(selector / "manifest.json")
    layers = _read_object(selector / "ink-layers.json")
    width, height = (int(value) for value in manifest["source"]["size_wh"])
    clean_entry = layers["layers"]["clean"]
    clean_path = selector / clean_entry["mask_path"]
    if sha256_file(clean_path) != clean_entry["mask_file_sha256"]:
        raise ConsoleError("integrity_error", "The clean ink mask changed")
    clean = _load_binary(clean_path, (width, height))
    labels, component_count = ndimage.label(
        clean,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    labels = labels.astype(np.int32, copy=False)
    panel_width, panel_height = packet["coordinate_space"]["size_wh"]
    crop_x, crop_y, crop_width, crop_height = packet["coordinate_space"][
        "source_crop_xywh"
    ]
    source_scale = float(packet["coordinate_space"]["preview_to_source_scale"])
    component_words: dict[int, set[int]] = {}
    proposal_by_id = {unit["proposal_id"]: unit for unit in packet["proposals"]}
    snap_radius_preview_px = 36
    uncited_snap_radius_preview_px = 60
    snap_radius_source_px = max(1, round(snap_radius_preview_px * source_scale))
    proposal_y0 = min(unit["source_bbox_xywh"][1] for unit in packet["proposals"])
    proposal_y1 = max(
        unit["source_bbox_xywh"][1] + unit["source_bbox_xywh"][3]
        for unit in packet["proposals"]
    )
    results: list[dict[str, Any]] = []
    for word in words:
        component_ids: set[int] = set()
        resolved_points: list[list[int]] = []
        snapped_points: list[list[int]] = []
        missed_points: list[list[int]] = []
        for point_x, point_y in word["seed_points_xy"]:
            if point_x >= panel_width or point_y >= panel_height:
                raise ConsoleError("invalid_line_decision", "A seed point is outside the clean panel")
            source_x = min(width - 1, max(0, crop_x + round(point_x * source_scale)))
            source_y = min(height - 1, max(0, crop_y + round(point_y * source_scale)))
            component_id = int(labels[source_y, source_x])
            if not component_id:
                point_radius_preview = (
                    snap_radius_preview_px
                    if word["proposal_ids"]
                    else uncited_snap_radius_preview_px
                )
                point_radius_source = max(1, round(point_radius_preview * source_scale))
                search_x0 = max(0, source_x - point_radius_source)
                search_y0 = max(0, source_y - point_radius_source)
                search_x1 = min(width, source_x + point_radius_source + 1)
                search_y1 = min(height, source_y + point_radius_source + 1)
                if word["proposal_ids"]:
                    proposal_boxes = [
                        proposal_by_id[proposal_id]["source_bbox_xywh"]
                        for proposal_id in word["proposal_ids"]
                    ]
                    allowed_x0 = max(0, min(box[0] for box in proposal_boxes))
                    allowed_y0 = max(0, min(box[1] for box in proposal_boxes))
                    allowed_x1 = min(
                        width,
                        max(box[0] + box[2] for box in proposal_boxes),
                    )
                    allowed_y1 = min(
                        height,
                        max(box[1] + box[3] for box in proposal_boxes),
                    )
                    search_x0 = max(search_x0, allowed_x0)
                    search_y0 = max(search_y0, allowed_y0)
                    search_x1 = min(search_x1, allowed_x1)
                    search_y1 = min(search_y1, allowed_y1)
                else:
                    # A newly discovered word has no proposal box. Keep the
                    # generous click tolerance inside the proposal-derived line
                    # band so it cannot jump into a neighboring context line.
                    line_margin = max(2, round(12 * source_scale))
                    search_y0 = max(search_y0, proposal_y0 - line_margin)
                    search_y1 = min(search_y1, proposal_y1 + line_margin)
                window = clean[search_y0:search_y1, search_x0:search_x1]
                if np.any(window):
                    ys, xs = np.nonzero(window)
                    squared = (xs + search_x0 - source_x) ** 2 + (
                        ys + search_y0 - source_y
                    ) ** 2
                    nearest = int(np.argmin(squared))
                    snapped_x = int(xs[nearest] + search_x0)
                    snapped_y = int(ys[nearest] + search_y0)
                    if int(squared[nearest]) <= point_radius_source**2:
                        component_id = int(labels[snapped_y, snapped_x])
                        snapped_points.append(
                            [
                                point_x,
                                point_y,
                                source_x,
                                source_y,
                                snapped_x,
                                snapped_y,
                                component_id,
                            ]
                        )
            if component_id:
                component_ids.add(component_id)
                component_words.setdefault(component_id, set()).add(word["word_order"])
                resolved_points.append([point_x, point_y, source_x, source_y, component_id])
            else:
                missed_points.append([point_x, point_y, source_x, source_y])
        mask = np.isin(labels, list(component_ids)) if component_ids else np.zeros_like(clean)
        ys, xs = np.nonzero(mask)
        bbox = (
            [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
            if len(xs)
            else None
        )
        results.append(
            {
                "word_order": word["word_order"],
                "proposal_ids": word["proposal_ids"],
                "seed_points_xy": word["seed_points_xy"],
                "resolved_seed_points": resolved_points,
                "snapped_seed_points": snapped_points,
                "missed_seed_points": missed_points,
                "component_ids": sorted(component_ids),
                "component_count": len(component_ids),
                "selected_pixels": int(mask.sum()),
                "source_bbox_xywh": bbox,
            }
        )
    shared_ids = {
        component_id
        for component_id, word_orders in component_words.items()
        if len(word_orders) > 1
    }
    assigned = np.zeros_like(clean)
    shared = np.zeros_like(clean)
    for result in results:
        unique_ids = set(result["component_ids"]) - shared_ids
        result["shared_component_ids"] = sorted(set(result["component_ids"]) & shared_ids)
        result["status"] = (
            "missed_seed"
            if result["missed_seed_points"]
            else "empty"
            if not result["component_ids"]
            else "shared_component_conflict"
            if result["shared_component_ids"]
            else "candidate_ready"
        )
        if unique_ids:
            assigned |= np.isin(labels, list(unique_ids))
    if shared_ids:
        shared = np.isin(labels, list(shared_ids))

    crop = clean[crop_y : crop_y + crop_height, crop_x : crop_x + crop_width]
    assigned_crop = assigned[crop_y : crop_y + crop_height, crop_x : crop_x + crop_width]
    shared_crop = shared[crop_y : crop_y + crop_height, crop_x : crop_x + crop_width]
    display = np.full((*crop.shape, 3), 250, dtype=np.uint8)
    display[crop] = (20, 20, 20)
    display[assigned_crop] = (210, 47, 47)
    display[shared_crop] = (245, 139, 31)
    review = Image.fromarray(display, mode="RGB").resize(
        (panel_width, panel_height), Image.Resampling.NEAREST
    )
    draw = ImageDraw.Draw(review)
    for result in results:
        for point_x, point_y in result["seed_points_xy"]:
            color = (245, 139, 31) if result["shared_component_ids"] else (12, 118, 128)
            draw.ellipse((point_x - 4, point_y - 4, point_x + 4, point_y + 4), fill=color)
            draw.text((point_x + 5, point_y - 8), str(result["word_order"]), fill=color, font=_font(14))
    review_path = packet_path.parent / "selection-review-snap-v4.png"
    if review_path.exists() or review_path.is_symlink():
        raise ConsoleError("line_result_exists", "The line result already exists", status=409)
    review.save(review_path, format="PNG", optimize=True)
    result_record: dict[str, Any] = {
        "schema_version": "line-batch-word-result.v1",
        "line_packet_sha256": packet["line_packet_sha256"],
        "decision_file_sha256": sha256_file(choice_path),
        "line_id": packet["line_id"],
        "seed_snap": {
            "radius_preview_px": snap_radius_preview_px,
            "uncited_radius_preview_px": uncited_snap_radius_preview_px,
            "radius_source_px": snap_radius_source_px,
            "bounded_to_cited_proposals": True,
        },
        "counts": {
            "visible_words": len(results),
            "candidate_ready": sum(result["status"] == "candidate_ready" for result in results),
            "needs_review": sum(result["status"] != "candidate_ready" for result in results),
            "selected_pixels": int(assigned.sum()),
            "shared_pixels": int(shared.sum()),
            "crop_clean_pixels": int(crop.sum()),
            "crop_remaining_pixels": int(np.count_nonzero(crop & ~assigned_crop & ~shared_crop)),
        },
        "words": results,
        "review": {
            "path": review_path.name,
            "file_sha256": sha256_file(review_path),
        },
    }
    result_record["result_sha256"] = _hash_record(result_record, "result_sha256")
    _write_new(
        packet_path.parent / "software-result-snap-v4.json",
        canonical_json_bytes(result_record) + b"\n",
    )
    return result_record


def build_region_fill_knockout(
    selector_dir: Path | str,
    line_session_dir: Path | str,
    output_dir: Path | str,
) -> dict[str, Any]:
    """Turn frozen line decisions into a public page-wide region-fill knockout."""

    selector = Path(selector_dir).resolve()
    line_root = Path(line_session_dir).resolve()
    output = Path(output_dir).resolve()
    if output.exists() or output.is_symlink():
        raise ConsoleError("knockout_exists", "The region-fill knockout already exists", status=409)
    manifest = _read_object(selector / "manifest.json")
    layers = _read_object(selector / "ink-layers.json")
    session = _read_object(line_root / "session.json")
    if session.get("session_sha256") != _hash_record(session, "session_sha256"):
        raise ConsoleError("integrity_error", "The line batch session changed")
    width, height = (int(value) for value in manifest["source"]["size_wh"])
    clean_entry = layers["layers"]["clean"]
    clean_path = selector / clean_entry["mask_path"]
    source_path = selector / manifest["source"]["working_path"]
    if sha256_file(clean_path) != clean_entry["mask_file_sha256"]:
        raise ConsoleError("integrity_error", "The clean ink changed")
    if sha256_file(source_path) != manifest["source"]["working_file_sha256"]:
        raise ConsoleError("integrity_error", "The source image changed")
    clean = _load_binary(clean_path, (width, height))

    words: list[dict[str, Any]] = []
    for line_entry in session["lines"]:
        packet_path = line_root / line_entry["packet_path"]
        packet = _read_object(packet_path)
        decision_path = packet_path.parent / "decision.json"
        if not decision_path.is_file() or decision_path.is_symlink():
            raise ConsoleError("incomplete_line_batch", f"Missing decision for {packet['line_id']}")
        decision = _read_object(decision_path)
        schema_path = line_root / "protocol/response-schema.json"
        errors = sorted(
            Draft202012Validator(_read_object(schema_path)).iter_errors(decision),
            key=lambda error: list(error.absolute_path),
        )
        if errors or decision.get("line_id") != packet["line_id"]:
            raise ConsoleError("invalid_line_decision", f"Invalid decision for {packet['line_id']}")
        proposal_by_id = {item["proposal_id"]: item for item in packet["proposals"]}
        crop_x, crop_y, _, _ = packet["coordinate_space"]["source_crop_xywh"]
        scale = float(packet["coordinate_space"]["preview_to_source_scale"])
        for decision_word in decision["visible_words"]:
            source_points = [
                [crop_x + round(point[0] * scale), crop_y + round(point[1] * scale)]
                for point in decision_word["seed_points_xy"]
            ]
            words.append(
                {
                    "word_id": f"{packet['line_id']}:W{decision_word['word_order']:02d}",
                    "line_id": packet["line_id"],
                    "word_order": decision_word["word_order"],
                    "proposal_ids": decision_word["proposal_ids"],
                    "source_seed_points": source_points,
                    "source_seed_center_xy": [
                        round(sum(point[0] for point in source_points) / len(source_points)),
                        round(sum(point[1] for point in source_points) / len(source_points)),
                    ],
                    "cited_source_bboxes_xywh": [
                        proposal_by_id[proposal_id]["source_bbox_xywh"]
                        for proposal_id in decision_word["proposal_ids"]
                    ],
                    "line_source_crop_xywh": packet["coordinate_space"]["source_crop_xywh"],
                }
            )

    line_groups: dict[str, list[dict[str, Any]]] = {}
    for word in words:
        line_groups.setdefault(word["line_id"], []).append(word)
    geometry: dict[str, tuple[np.ndarray, np.ndarray, float]] = {}
    for line_id, line_words in line_groups.items():
        line_words.sort(key=lambda value: value["word_order"])
        first = np.asarray(line_words[0]["source_seed_center_xy"], dtype=np.float64)
        last = np.asarray(line_words[-1]["source_seed_center_xy"], dtype=np.float64)
        axis = last - first
        norm = float(np.linalg.norm(axis))
        axis = axis / norm if norm >= 1.0 else np.array([1.0, 0.0], dtype=np.float64)
        normal = np.array([-axis[1], axis[0]], dtype=np.float64)
        heights = [
            bbox[3]
            for word in line_words
            for bbox in word["cited_source_bboxes_xywh"]
        ]
        half_band = max(55.0, float(np.median(heights)) * 0.65 + 20.0) if heights else 90.0
        geometry[line_id] = (axis, normal, half_band)

    owner = np.zeros((height, width), dtype=np.uint16)
    best_distance = np.full((height, width), np.inf, dtype=np.float32)
    for label, word in enumerate(words, start=1):
        center = np.asarray(word["source_seed_center_xy"], dtype=np.float64)
        cited = word["cited_source_bboxes_xywh"]
        use_cited = False
        if cited:
            ux0 = min(bbox[0] for bbox in cited)
            uy0 = min(bbox[1] for bbox in cited)
            ux1 = max(bbox[0] + bbox[2] for bbox in cited)
            uy1 = max(bbox[1] + bbox[3] for bbox in cited)
            use_cited = ux0 - 40 <= center[0] <= ux1 + 40 and uy0 - 40 <= center[1] <= uy1 + 40
        if use_cited:
            pad_x = max(18, round((ux1 - ux0) * 0.12))
            pad_y = max(18, round((uy1 - uy0) * 0.25))
            x0, y0 = max(0, ux0 - pad_x), max(0, uy0 - pad_y)
            x1, y1 = min(width, ux1 + pad_x), min(height, uy1 + pad_y)
            yy, xx = np.ogrid[y0:y1, x0:x1]
            candidate = clean[y0:y1, x0:x1]
        else:
            line_words = line_groups[word["line_id"]]
            position = next(index for index, item in enumerate(line_words) if item["word_id"] == word["word_id"])
            axis, normal, half_band = geometry[word["line_id"]]
            projections = [
                float(np.dot(np.asarray(item["source_seed_center_xy"]) - center, axis))
                for item in line_words
            ]
            left = (
                (projections[position - 1] + projections[position]) / 2.0
                if position > 0
                else -max(90.0, abs(projections[position + 1]) / 2.0 + 35.0)
                if len(line_words) > 1
                else -140.0
            )
            right = (
                (projections[position] + projections[position + 1]) / 2.0
                if position + 1 < len(line_words)
                else max(90.0, abs(projections[position - 1]) / 2.0 + 35.0)
                if len(line_words) > 1
                else 140.0
            )
            x0, y0, crop_width, crop_height = word["line_source_crop_xywh"]
            x1, y1 = x0 + crop_width, y0 + crop_height
            yy, xx = np.ogrid[y0:y1, x0:x1]
            dx, dy = xx - center[0], yy - center[1]
            along = dx * axis[0] + dy * axis[1]
            across = dx * normal[0] + dy * normal[1]
            candidate = clean[y0:y1, x0:x1] & (along >= min(left, right)) & (
                along <= max(left, right)
            ) & (np.abs(across) <= half_band)
        distance = (xx - center[0]) ** 2 + (yy - center[1]) ** 2
        local_best = best_distance[y0:y1, x0:x1]
        replace = candidate & (distance < local_best)
        local_best[replace] = distance[replace]
        owner[y0:y1, x0:x1][replace] = label

    counts = np.bincount(owner.ravel(), minlength=len(words) + 1)
    for label, word in enumerate(words, start=1):
        word["selected_pixels"] = int(counts[label])
        ys, xs = np.nonzero(owner == label)
        word["source_bbox_xywh"] = (
            [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
            if len(xs)
            else None
        )
    assigned = owner > 0
    residual = clean & ~assigned
    output.mkdir(parents=True)
    Image.fromarray(owner).save(output / "word-owner-labels.png", format="PNG")
    for name, mask in (("assigned", assigned), ("residual", residual)):
        Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L").save(
            output / f"{name}.mask.png", format="PNG"
        )
    with Image.open(source_path) as image:
        source = np.asarray(image.convert("RGB"), dtype=np.uint8)
    background = np.asarray(
        Image.fromarray(source, mode="RGB").filter(ImageFilter.GaussianBlur(radius=9)),
        dtype=np.uint8,
    )
    erased = source.copy()
    erased[assigned] = background[assigned]
    erased[residual] = (
        erased[residual].astype(np.uint16) * 35 // 100
        + np.array([210, 47, 47], dtype=np.uint16) * 65 // 100
    ).astype(np.uint8)
    residual_panel = np.full((*clean.shape, 3), 250, dtype=np.uint8)
    residual_panel[residual] = (20, 20, 20)
    preview_wh = (900, 1200)
    left = Image.fromarray(erased, mode="RGB").resize(preview_wh, Image.Resampling.LANCZOS)
    right = Image.fromarray(residual_panel, mode="RGB").resize(preview_wh, Image.Resampling.NEAREST)
    collage = Image.new("RGB", (1814, 1248), (248, 243, 233))
    collage.paste(left, (0, 48))
    collage.paste(right, (914, 48))
    draw = ImageDraw.Draw(collage)
    draw.text((10, 10), "Original with handled ink erased; remaining ink red", fill=(35, 35, 35), font=_font(22))
    draw.text((924, 10), "Clean residual only", fill=(35, 35, 35), font=_font(22))
    collage.save(output / "residual-knockout-collage.png", format="PNG", optimize=True)
    record: dict[str, Any] = {
        "schema_version": "line-batch-region-fill-knockout.v1",
        "semantics": {
            "acting_agent_inputs_only": True,
            "human_benchmark_used": False,
            "transcript_is_truth": False,
            "proposal_boxes_are_truth": False,
            "assigned_pixels_are_candidate_not_truth": True,
        },
        "bindings": {
            "selector_manifest_sha256": manifest["manifest_sha256"],
            "line_session_sha256": session["session_sha256"],
            "source_file_sha256": sha256_file(source_path),
            "clean_mask_file_sha256": sha256_file(clean_path),
        },
        "counts": {
            "words": len(words),
            "nonempty_words": sum(word["selected_pixels"] > 0 for word in words),
            "clean_pixels": int(clean.sum()),
            "assigned_pixels": int(assigned.sum()),
            "residual_pixels": int(residual.sum()),
        },
        "words": words,
        "evidence": {},
    }
    for key, filename in (
        ("owner_labels", "word-owner-labels.png"),
        ("assigned_mask", "assigned.mask.png"),
        ("residual_mask", "residual.mask.png"),
        ("residual_collage", "residual-knockout-collage.png"),
    ):
        record["evidence"][key] = {
            "path": filename,
            "file_sha256": sha256_file(output / filename),
        }
    record["knockout_sha256"] = _hash_record(record, "knockout_sha256")
    _write_new(output / "knockout.json", canonical_json_bytes(record) + b"\n")
    return record
