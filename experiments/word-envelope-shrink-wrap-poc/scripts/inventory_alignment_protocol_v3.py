#!/usr/bin/env python3
"""Two-turn, transcript-blind-first inventory/alignment protocol v3.

This module is deliberately isolated from the frozen v2/007 artifacts.  A builder
may read prior integrated geometry and text, but it immediately reduces that data
to untrusted line-level proposal nodes in private state.  Stage A public output is
rendered from the source image alone.  Stage B is emitted only after a valid Stage
A response has created stable visible-span IDs.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from jsonschema import Draft202012Validator
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
STAGE_A_SCHEMA = ROOT / "schemas/inventory-stage-a-decision-v3.schema.json"
STAGE_B_SCHEMA = ROOT / "schemas/alignment-stage-b-decision-v3.schema.json"
PUBLIC_PACKET_SCHEMA = ROOT / "schemas/inventory-alignment-public-packet-v3.schema.json"
PRIOR_TRIAL = ROOT / "artifacts/full-page-agent-trial-v1"

PROTOCOL_VERSION = "inventory-alignment-two-turn.v3"
STATE_SCHEMA_VERSION = "inventory-alignment-workflow-state.v3"
PACKET_SCHEMA_VERSION = "inventory-alignment-public-packet.v3"
STAGE_A = "stage_a_visible_inventory"
STAGE_B = "stage_b_graph_alignment"
COMPLETE = "complete"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TOKEN_RE = re.compile(r"[\w]+(?:['’][\w]+)*|[^\w\s]", re.UNICODE)

# The v2 014 crop used (55, 45).  v3 fails closed unless both axes are wider.
V2_014_CONTEXT_PADDING = (55, 45)
DEFAULT_V3_CONTEXT_PADDING = (180, 160)
MAX_INSERTED_SPANS_PER_LINE = 32
MAX_WORD_UNITS_PER_LINE = 128


PAGE_SPECS_V3: dict[str, dict[str, Any]] = {
    "014-p04": {
        "schema_version": "inventory-alignment-page-spec.v3",
        "trial_id": "full-page-inventory-alignment-trial-v3",
        "page_id": "014-p04",
        "source_path": (
            "/Users/masongalusha/Workspace/projects/letter-archive/backend/storage/"
            "collections/014/18780127/L01/014-18780127-L01-04.jpg"
        ),
        "source_sha256": (
            "a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69"
        ),
        "untrusted_prior_path": str(
            PRIOR_TRIAL / "final-integrated/014-p04/page-record.json"
        ),
        "untrusted_prior_sha256": (
            "adc437853eff19a82c1c6fbaf8740641fffb4f87629b2b395d7dadc949d3f53a"
        ),
        "line_order": [
            *[f"body-{index:02d}" for index in range(1, 24)],
            "closing-01",
            "signature-01",
            "signature-02",
            "signature-03",
            *[f"top-{index:02d}" for index in range(1, 10)],
        ],
        "stream_reading": {
            "main-body": {
                "source_to_upright_rotation_degrees": 0,
                "morphology_axis_degrees_undirected": 0,
            },
            "closing": {
                "source_to_upright_rotation_degrees": 0,
                "morphology_axis_degrees_undirected": 0,
            },
            "signatures": {
                "source_to_upright_rotation_degrees": 0,
                "morphology_axis_degrees_undirected": 0,
            },
            # PIL and this protocol use positive=counterclockwise.  The top
            # margin must rotate clockwise, hence -90.  Its semantic start is
            # the lower source-y end of the line.
            "top-margin": {
                "source_to_upright_rotation_degrees": -90,
                "morphology_axis_degrees_undirected": 90,
            },
        },
        "context_padding_source_px": list(DEFAULT_V3_CONTEXT_PADDING),
    }
}


class ProtocolV3Error(RuntimeError):
    """Fail-closed protocol or validation error."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


def _with_hash(value: Mapping[str, Any], field: str) -> dict[str, Any]:
    result = copy.deepcopy(dict(value))
    result.pop(field, None)
    result[field] = canonical_hash(result)
    return result


def _verify_hash(value: Mapping[str, Any], field: str, label: str) -> None:
    observed = value.get(field)
    if not isinstance(observed, str) or not SHA256_RE.fullmatch(observed):
        raise ProtocolV3Error(f"{label} has no valid {field}")
    basis = dict(value)
    basis.pop(field, None)
    if canonical_hash(basis) != observed:
        raise ProtocolV3Error(f"{label} {field} drift")


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ProtocolV3Error(f"Expected JSON object: {path}")
    return value


def _schema_validate(value: Mapping[str, Any], schema_path: Path, label: str) -> None:
    schema = _load_json(schema_path)
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(value),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        details = "\n".join(
            f"{list(error.absolute_path)}: {error.message}" for error in errors[:30]
        )
        raise ProtocolV3Error(f"{label} schema validation failed:\n{details}")


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


def _asset_meta(path: Path, workflow_root: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        size = list(image.size)
    return {
        "path": str(path.relative_to(workflow_root)),
        "sha256": sha256_file(path),
        "display_size": size,
    }


def _save_png(image: Image.Image, path: Path, workflow_root: Path) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="PNG", optimize=False)
    return _asset_meta(path, workflow_root)


def apply_affine(matrix: Sequence[float], point: Sequence[float]) -> list[float]:
    """Apply a row-major 3x3 affine matrix to a source/upright point."""

    if len(matrix) != 9 or len(point) != 2:
        raise ProtocolV3Error("Affine matrix/point has wrong shape")
    x, y = float(point[0]), float(point[1])
    denominator = matrix[6] * x + matrix[7] * y + matrix[8]
    if abs(denominator) < 1e-12:
        raise ProtocolV3Error("Affine point maps to infinity")
    return [
        (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
        (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
    ]


def directed_transform_v3(
    crop_xyxy: Sequence[int], rotation_degrees: int
) -> dict[str, Any]:
    """Return an exact source<->upright transform and semantic anchors.

    Only right-angle transforms are accepted so source boxes can be round-tripped
    without a resampling-dependent geometric convention.  The transform is
    directed.  The separately recorded morphology axis never determines order.
    """

    if len(crop_xyxy) != 4:
        raise ProtocolV3Error("Crop must be xyxy")
    left, top, right, bottom = map(int, crop_xyxy)
    if left < 0 or top < 0 or right <= left or bottom <= top:
        raise ProtocolV3Error("Invalid transform crop")
    if rotation_degrees not in (0, -90, 90, 180):
        raise ProtocolV3Error("v3 supports only 0, -90, +90, or 180 degree views")

    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    if rotation_degrees == 0:
        forward = [1, 0, -left, 0, 1, -top, 0, 0, 1]
        inverse = [1, 0, left, 0, 1, top, 0, 0, 1]
        upright_size = [right - left, bottom - top]
        start, end = [left, center_y], [right, center_y]
        start_edge = "min_source_x"
    elif rotation_degrees == -90:
        # Clockwise: x_upright = bottom - y_source, y_upright = x_source - left.
        forward = [0, -1, bottom, 1, 0, -left, 0, 0, 1]
        inverse = [0, 1, left, -1, 0, bottom, 0, 0, 1]
        upright_size = [bottom - top, right - left]
        start, end = [center_x, bottom], [center_x, top]
        start_edge = "max_source_y"
    elif rotation_degrees == 90:
        forward = [0, 1, -top, -1, 0, right, 0, 0, 1]
        inverse = [0, -1, right, 1, 0, top, 0, 0, 1]
        upright_size = [bottom - top, right - left]
        start, end = [center_x, top], [center_x, bottom]
        start_edge = "min_source_y"
    else:
        forward = [-1, 0, right, 0, -1, bottom, 0, 0, 1]
        inverse = [-1, 0, right, 0, -1, bottom, 0, 0, 1]
        upright_size = [right - left, bottom - top]
        start, end = [right, center_y], [left, center_y]
        start_edge = "max_source_x"

    transform = {
        "schema_version": "directed-source-upright-transform.v3",
        "source_crop_xyxy": [left, top, right, bottom],
        "source_to_upright_rotation_degrees": rotation_degrees,
        "rotation_convention": "positive_counterclockwise_negative_clockwise",
        "source_to_upright_affine": forward,
        "upright_to_source_affine": inverse,
        "upright_size": upright_size,
        "upright_direction": "left_to_right",
        "semantic_start_anchor_source_xy": start,
        "semantic_end_anchor_source_xy": end,
        "semantic_start_source_edge": start_edge,
    }
    transform["directed_transform_sha256"] = canonical_hash(transform)
    return transform


def transform_source_bbox_to_upright_v3(
    bbox_xywh: Sequence[int], transform: Mapping[str, Any]
) -> list[float]:
    if len(bbox_xywh) != 4:
        raise ProtocolV3Error("BBox must be xywh")
    x, y, width, height = map(float, bbox_xywh)
    corners = [
        apply_affine(transform["source_to_upright_affine"], point)
        for point in ((x, y), (x + width, y), (x, y + height), (x + width, y + height))
    ]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]


def _rotate_plain(image: Image.Image, rotation_degrees: int) -> Image.Image:
    if rotation_degrees == 0:
        return image.copy()
    if rotation_degrees == -90:
        return image.transpose(Image.Transpose.ROTATE_270)
    if rotation_degrees == 90:
        return image.transpose(Image.Transpose.ROTATE_90)
    if rotation_degrees == 180:
        return image.transpose(Image.Transpose.ROTATE_180)
    raise ProtocolV3Error("Unsupported plain-image rotation")


def _bbox_inside_source(bbox: Sequence[int], source_size: Sequence[int]) -> bool:
    if len(bbox) != 4 or len(source_size) != 2:
        return False
    x, y, width, height = bbox
    source_width, source_height = source_size
    return (
        all(isinstance(value, int) and not isinstance(value, bool) for value in bbox)
        and x >= 0
        and y >= 0
        and width >= 1
        and height >= 1
        and x + width <= source_width
        and y + height <= source_height
    )


def _bbox_intersects_xyxy(bbox: Sequence[int], bounds: Sequence[int]) -> bool:
    x, y, width, height = bbox
    left, top, right, bottom = bounds
    return x < right and x + width > left and y < bottom and y + height > top


def _union_bounds(
    boxes: Iterable[Sequence[int]], source_size: Sequence[int], padding: Sequence[int]
) -> list[int]:
    values = [list(map(int, box)) for box in boxes]
    if not values:
        raise ProtocolV3Error("A line needs at least one untrusted proposal locator")
    pad_x, pad_y = map(int, padding)
    source_width, source_height = map(int, source_size)
    return [
        max(0, min(box[0] for box in values) - pad_x),
        max(0, min(box[1] for box in values) - pad_y),
        min(source_width, max(box[0] + box[2] for box in values) + pad_x),
        min(source_height, max(box[1] + box[3] for box in values) + pad_y),
    ]


def _tokenize_rejectable_transcript(text_fragments: Sequence[str], line_id: str) -> list[dict[str, Any]]:
    # Fragment boundaries are intentionally discarded before tokenization.  No
    # transcript node retains or implies a proposal-node binding.
    line_text = " ".join(fragment.strip() for fragment in text_fragments if fragment.strip())
    tokens = TOKEN_RE.findall(line_text)
    return [
        {
            "transcript_node_id": f"{line_id}-T{index:03d}",
            "transcript_order": index,
            "text": token,
            "kind": "word" if any(character.isalnum() for character in token) else "punctuation",
        }
        for index, token in enumerate(tokens, start=1)
    ]


def _center(bbox: Sequence[int]) -> list[float]:
    return [bbox[0] + bbox[2] / 2.0, bbox[1] + bbox[3] / 2.0]


def _sanitize_prior_inputs_v3(spec: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Read only permitted proposal fields and discard all prior review state."""

    source_path = Path(spec["source_path"])
    prior_path = Path(spec["untrusted_prior_path"])
    if sha256_file(source_path) != spec["source_sha256"]:
        raise ProtocolV3Error("Source hash drift")
    if sha256_file(prior_path) != spec["untrusted_prior_sha256"]:
        raise ProtocolV3Error("Untrusted prior file hash drift")
    with Image.open(source_path) as source:
        source_size = list(source.size)
    prior = _load_json(prior_path)
    if not isinstance(prior.get("units"), list):
        raise ProtocolV3Error("Untrusted prior has no unit list")

    permitted: list[dict[str, Any]] = []
    for unit in prior["units"]:
        if not isinstance(unit, dict):
            raise ProtocolV3Error("Malformed untrusted prior unit")
        copied = {
            "line_id": unit.get("line_id"),
            "stream_id": unit.get("stream_id"),
            "source_axis_aligned_bbox_xywh": unit.get(
                "source_axis_aligned_bbox_xywh"
            ),
            "transcript": unit.get("transcript"),
        }
        if (
            not isinstance(copied["line_id"], str)
            or not isinstance(copied["stream_id"], str)
            or not isinstance(copied["transcript"], str)
            or not _bbox_inside_source(
                copied["source_axis_aligned_bbox_xywh"], source_size
            )
        ):
            raise ProtocolV3Error("Malformed permitted prior proposal field")
        permitted.append(copied)
    return {
        "path": str(source_path),
        "sha256": spec["source_sha256"],
        "size": source_size,
    }, permitted


def _build_private_lines_v3(
    spec: Mapping[str, Any], source: Mapping[str, Any], permitted_units: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    padding = tuple(spec.get("context_padding_source_px", DEFAULT_V3_CONTEXT_PADDING))
    if len(padding) != 2 or any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in padding
    ):
        raise ProtocolV3Error("Invalid v3 context padding")
    if any(v3 <= v2 for v3, v2 in zip(padding, V2_014_CONTEXT_PADDING, strict=True)):
        raise ProtocolV3Error(
            "v3 Stage A context must be wider than the v2 014 crop on both axes"
        )

    configured_lines = list(spec["line_order"])
    actual_lines = {unit["line_id"] for unit in permitted_units}
    if actual_lines != set(configured_lines):
        raise ProtocolV3Error(
            f"Configured/untrusted line mismatch: missing={sorted(set(configured_lines)-actual_lines)}, "
            f"unexpected={sorted(actual_lines-set(configured_lines))}"
        )

    lines: list[dict[str, Any]] = []
    for reading_order, line_id in enumerate(configured_lines, start=1):
        raw_line = [unit for unit in permitted_units if unit["line_id"] == line_id]
        stream_ids = {unit["stream_id"] for unit in raw_line}
        if len(stream_ids) != 1:
            raise ProtocolV3Error(f"Mixed streams in {line_id}")
        stream_id = next(iter(stream_ids))
        try:
            stream_reading = spec["stream_reading"][stream_id]
        except KeyError as error:
            raise ProtocolV3Error(f"Missing directed transform for {stream_id}") from error
        rotation = stream_reading["source_to_upright_rotation_degrees"]
        wide_bounds = _union_bounds(
            [unit["source_axis_aligned_bbox_xywh"] for unit in raw_line],
            source["size"],
            padding,
        )
        directed = directed_transform_v3(wide_bounds, rotation)

        # Proposal identities are geometric and independent of transcript token
        # identities.  Sorting is in directed upright order, never raw source y.
        proposal_geometries = [
            list(unit["source_axis_aligned_bbox_xywh"]) for unit in raw_line
        ]
        proposal_geometries.sort(
            key=lambda bbox: (
                apply_affine(directed["source_to_upright_affine"], _center(bbox))[0],
                apply_affine(directed["source_to_upright_affine"], _center(bbox))[1],
            )
        )
        proposal_nodes = [
            {
                "proposal_node_id": f"{line_id}-P{index:03d}",
                "proposal_display_order": index,
                "bbox_source_xywh": bbox,
                "role": "untrusted_detector_region_not_a_word_claim",
            }
            for index, bbox in enumerate(proposal_geometries, start=1)
        ]
        transcript_nodes = _tokenize_rejectable_transcript(
            [unit["transcript"] for unit in raw_line], line_id
        )
        lines.append(
            {
                "line_id": line_id,
                "line_reading_order": reading_order,
                "stream_id": stream_id,
                "wide_source_crop_xyxy": wide_bounds,
                "context_padding_source_px": list(padding),
                "directed_transform": directed,
                "morphology_axis": {
                    "schema_version": "undirected-morphology-axis.v3",
                    "axis_degrees": stream_reading[
                        "morphology_axis_degrees_undirected"
                    ],
                    "directed_reading_authority": False,
                    "warning": "This undirected axis cannot set or reverse semantic order.",
                },
                "private_untrusted_proposal_nodes": proposal_nodes,
                "private_rejectable_transcript_nodes": transcript_nodes,
                "visible_spans": None,
                "stage_a_decision_sha256": None,
                "alignment_graph": None,
                "status": "pending_stage_a",
            }
        )
    return lines


def initialize_workflow_v3(spec: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    """Create private state and emit only the first line's public Stage A packet."""

    output_dir = output_dir.resolve()
    state_path = output_dir / "private/workflow-state-v3.json"
    if state_path.exists():
        raise ProtocolV3Error(f"Refusing to overwrite existing v3 state: {state_path}")
    if spec.get("schema_version") != "inventory-alignment-page-spec.v3":
        raise ProtocolV3Error("Wrong v3 page spec version")
    source, permitted_units = _sanitize_prior_inputs_v3(spec)
    lines = _build_private_lines_v3(spec, source, permitted_units)
    state: dict[str, Any] = {
        "schema_version": STATE_SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "trial_id": spec["trial_id"],
        "page_id": spec["page_id"],
        "source": source,
        "untrusted_builder_input": {
            "path": str(Path(spec["untrusted_prior_path"])),
            "sha256": spec["untrusted_prior_sha256"],
            "permitted_fields": [
                "line_id",
                "stream_id",
                "source_axis_aligned_bbox_xywh",
                "transcript",
            ],
            "forbidden_public_stage_a_fields": [
                "transcript",
                "detector_word_boxes",
                "prior_status",
                "ground_truth",
            ],
        },
        "state_revision": 0,
        "current_stage": STAGE_A,
        "current_line_index": 0,
        "line_order": [line["line_id"] for line in lines],
        "lines": lines,
        "decision_history": [],
    }
    state = _with_hash(state, "state_sha256")
    _write_json(state_path, state)
    packet_path = emit_current_packet_v3(state, output_dir)
    return {"state_path": state_path, "packet_path": packet_path, "state": state}


def initialize_builtin_workflow_v3(page_id: str, output_dir: Path) -> dict[str, Any]:
    try:
        spec = copy.deepcopy(PAGE_SPECS_V3[page_id])
    except KeyError as error:
        raise ProtocolV3Error(f"No v3 page spec for {page_id}") from error
    return initialize_workflow_v3(spec, output_dir)


def load_state_v3(path: Path) -> dict[str, Any]:
    state = _load_json(path)
    if state.get("schema_version") != STATE_SCHEMA_VERSION:
        raise ProtocolV3Error("Wrong workflow state schema version")
    _verify_hash(state, "state_sha256", "workflow state")
    return state


def load_packet_v3(path: Path) -> dict[str, Any]:
    packet = _load_json(path)
    if packet.get("schema_version") != PACKET_SCHEMA_VERSION:
        raise ProtocolV3Error("Wrong public packet schema version")
    _verify_hash(packet, "packet_sha256", "public packet")
    _schema_validate(packet, PUBLIC_PACKET_SCHEMA, "public packet")
    return packet


def _public_source(state: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "page_id": state["page_id"],
        "sha256": state["source"]["sha256"],
        "size": state["source"]["size"],
    }


def _packet_base(state: Mapping[str, Any], line: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": PACKET_SCHEMA_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "trial_id": state["trial_id"],
        "page_id": state["page_id"],
        "state_revision": state["state_revision"],
        "state_sha256": state["state_sha256"],
        "current": {
            "stage": state["current_stage"],
            "line_id": line["line_id"],
            "line_reading_order": line["line_reading_order"],
        },
        "source": _public_source(state),
    }


def _render_stage_a_assets_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], workflow_root: Path, turn_dir: Path
) -> dict[str, Any]:
    """Render Stage A from source pixels only: no transcript or word rectangles."""

    source_path = Path(state["source"]["path"])
    bounds = line["wide_source_crop_xyxy"]
    rotation = line["directed_transform"]["source_to_upright_rotation_degrees"]
    with Image.open(source_path) as opened:
        source = opened.convert("RGB")
        crop = source.crop(tuple(bounds))
        upright = _rotate_plain(crop, rotation)

        locator = source.copy()
        locator.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
        scale_x = locator.width / source.width
        scale_y = locator.height / source.height
        draw = ImageDraw.Draw(locator)
        left, top, right, bottom = bounds
        draw.rectangle(
            (
                round(left * scale_x),
                round(top * scale_y),
                round(right * scale_x),
                round(bottom * scale_y),
            ),
            outline="#d98b00",
            width=5,
        )

        wide_meta = _save_png(crop, turn_dir / "wide-source-plain-v3.png", workflow_root)
        upright_meta = _save_png(
            upright, turn_dir / "upright-plain-v3.png", workflow_root
        )
        locator_meta = _save_png(
            locator, turn_dir / "line-locator-v3.png", workflow_root
        )
        crop.close()
        upright.close()
        locator.close()
        source.close()
    return {
        "line_locator": {
            **locator_meta,
            "located_wide_context_source_xyxy": list(bounds),
            "role": "line_level_locator_only_not_word_boxes",
        },
        "wide_source_plain": {
            **wide_meta,
            "source_crop_xyxy": list(bounds),
            "lossless_unannotated_source_pixels": True,
        },
        "upright_plain": {
            **upright_meta,
            "lossless_unannotated_source_pixels": True,
        },
    }


def _render_stage_b_board_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], workflow_root: Path, turn_dir: Path
) -> dict[str, Any]:
    source_path = Path(state["source"]["path"])
    left, top, right, bottom = line["wide_source_crop_xyxy"]
    header_height = 118
    with Image.open(source_path) as opened:
        crop = opened.convert("RGB").crop((left, top, right, bottom))
    scale = min(1.0, 1800 / crop.width)
    if scale != 1.0:
        display = crop.resize(
            (round(crop.width * scale), round(crop.height * scale)),
            Image.Resampling.LANCZOS,
        )
    else:
        display = crop.copy()
    board = Image.new("RGB", (display.width, display.height + header_height), "#f4f1e9")
    board.paste(display, (0, header_height))
    draw = ImageDraw.Draw(board)
    transcript = " ".join(
        node["text"] for node in line["private_rejectable_transcript_nodes"]
    )
    draw.text(
        (12, 8),
        f"{line['line_id']} — STAGE B / graph alignment",
        fill="#111111",
        font=_font(22),
    )
    draw.text(
        (12, 40),
        f"Rejectable transcript: {transcript}",
        fill="#111111",
        font=_font(19),
    )
    draw.text(
        (12, 73),
        "Green = stable Stage A spans; blue = untrusted detector regions. Re-open wide/internal boundaries.",
        fill="#333333",
        font=_font(17),
    )

    def board_box(bbox: Sequence[int]) -> tuple[int, int, int, int]:
        x, y, width, height = bbox
        return (
            round((x - left) * scale),
            round((y - top) * scale) + header_height,
            round((x + width - left) * scale),
            round((y + height - top) * scale) + header_height,
        )

    for span in line["visible_spans"]:
        x0, y0, x1, y1 = board_box(span["bbox_source_xywh"])
        draw.rectangle((x0, y0, x1, y1), outline="#17823b", width=4)
        draw.text(
            (x0 + 2, max(header_height, y0 - 21)),
            span["span_id"].rsplit("-", 1)[-1],
            fill="#17823b",
            font=_font(17),
            stroke_width=2,
            stroke_fill="white",
        )
    for proposal in line["private_untrusted_proposal_nodes"]:
        x0, y0, x1, y1 = board_box(proposal["bbox_source_xywh"])
        draw.rectangle((x0, y0, x1, y1), outline="#0868ac", width=3)
        draw.text(
            (x1 - 48, max(header_height, y1 - 22)),
            proposal["proposal_node_id"].rsplit("-", 1)[-1],
            fill="#0868ac",
            font=_font(16),
            stroke_width=2,
            stroke_fill="white",
        )
    meta = _save_png(board, turn_dir / "alignment-graph-board-v3.png", workflow_root)
    crop.close()
    display.close()
    board.close()
    return meta


def _stage_a_packet_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], workflow_root: Path, turn_dir: Path
) -> dict[str, Any]:
    assets = _render_stage_a_assets_v3(state, line, workflow_root, turn_dir)
    packet = {
        **_packet_base(state, line),
        "legal_actions": ["submit_visible_inventory", "defer_line"],
        "stage_contract": {
            "turn": "A_of_two",
            "transcript_access": False,
            "detector_word_box_access": False,
            "stable_ids_allocated_by_software_after_acceptance": True,
            "instruction": (
                "Inventory visible spans in semantic order from the wide plain source. "
                "Return rough source boxes, word-count ranges, internal-boundary uncertainty, "
                "punctuation, and a line note. Challenge every apparently single wide span."
            ),
            "response_schema": str(STAGE_A_SCHEMA.relative_to(ROOT)),
        },
        "withheld_from_acting_stage": {
            "rejectable_line_text": "physically_absent_from_packet_and_stage_a_images",
            "detector_word_rectangles": "physically_absent_from_packet_and_stage_a_images",
            "prior_review_state": "never_copied_to_public_workflow",
        },
        "evidence": {
            **assets,
            "directed_transform": line["directed_transform"],
            "morphology_axis": line["morphology_axis"],
        },
    }
    return _with_hash(packet, "packet_sha256")


def _stage_b_packet_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], workflow_root: Path, turn_dir: Path
) -> dict[str, Any]:
    board = _render_stage_b_board_v3(state, line, workflow_root, turn_dir)
    inserted_ids = [
        f"{line['line_id']}-VS{index:03d}"
        for index in range(
            len(line["visible_spans"]) + 1,
            len(line["visible_spans"]) + MAX_INSERTED_SPANS_PER_LINE + 1,
        )
    ]
    word_ids = [
        f"{line['line_id']}-W{index:03d}"
        for index in range(1, MAX_WORD_UNITS_PER_LINE + 1)
    ]
    packet = {
        **_packet_base(state, line),
        "legal_actions": ["submit_alignment_graph", "defer_line"],
        "stage_contract": {
            "turn": "B_of_two",
            "transcript_status": "revealed_rejectable_not_ground_truth",
            "detector_status": "revealed_untrusted_regions_not_word_nodes",
            "instruction": (
                "Build the typed many-to-many graph. Split spans into word units when needed; "
                "one proposal may serve several words and several proposals may serve one word. "
                "Preserve punctuation, add visibly omitted spans, and represent every missing "
                "relation as an explicit gap."
            ),
            "boundary_challenge": (
                "Re-open every internal word boundary, especially wide Stage A spans and wide "
                "detector regions; neither is evidence of one-box/one-word cardinality."
            ),
            "response_schema": str(STAGE_B_SCHEMA.relative_to(ROOT)),
        },
        "stage_a_binding": {
            "decision_sha256": line["stage_a_decision_sha256"],
            "stable_visible_spans": line["visible_spans"],
        },
        "revealed_rejectable_transcript": {
            "nodes": line["private_rejectable_transcript_nodes"],
            "warning": "Token order is a rejectable line-level proposal; there is no per-box binding.",
        },
        "revealed_untrusted_detector": {
            "proposal_nodes": line["private_untrusted_proposal_nodes"],
            "warning": "Proposal regions are graph nodes, not word boxes and not truth.",
        },
        "software_allocated_ids": {
            "inserted_visible_span_ids_in_order": inserted_ids,
            "word_unit_ids_in_order": word_ids,
        },
        "evidence": {
            "alignment_graph_board": board,
            "wide_source_plain": _asset_meta(
                workflow_root
                / f"public/turn-{state['state_revision'] - 1:03d}-{line['line_id']}-stage-a-v3/wide-source-plain-v3.png",
                workflow_root,
            ),
            "upright_plain": _asset_meta(
                workflow_root
                / f"public/turn-{state['state_revision'] - 1:03d}-{line['line_id']}-stage-a-v3/upright-plain-v3.png",
                workflow_root,
            ),
            "directed_transform": line["directed_transform"],
            "morphology_axis": line["morphology_axis"],
        },
        "exact_accounting_policy": {
            "visible_span": "exactly_one_or_more_span_word_edges",
            "word_unit_to_span": "exactly_one_span_word_edge",
            "word_unit_to_transcript": "one_or_more_edges_or_one_explicit_gap",
            "word_unit_to_proposal": "one_or_more_edges_or_one_explicit_gap",
            "transcript_node": "one_or_more_edges_or_one_explicit_gap",
            "proposal_node": "one_or_more_edges_or_one_explicit_gap",
            "duplicate_edges": "rejected",
            "orphan_references": "rejected",
        },
    }
    return _with_hash(packet, "packet_sha256")


def emit_current_packet_v3(state: Mapping[str, Any], workflow_root: Path) -> Path:
    _verify_hash(state, "state_sha256", "workflow state")
    if state["current_stage"] == COMPLETE:
        raise ProtocolV3Error("Workflow is complete; no public packet remains")
    line_index = state["current_line_index"]
    try:
        line = state["lines"][line_index]
    except (IndexError, TypeError) as error:
        raise ProtocolV3Error("Current line cursor is invalid") from error
    stage_suffix = "stage-a-v3" if state["current_stage"] == STAGE_A else "stage-b-v3"
    turn_dir = (
        workflow_root
        / f"public/turn-{state['state_revision']:03d}-{line['line_id']}-{stage_suffix}"
    )
    if state["current_stage"] == STAGE_A:
        packet = _stage_a_packet_v3(state, line, workflow_root, turn_dir)
    elif state["current_stage"] == STAGE_B:
        packet = _stage_b_packet_v3(state, line, workflow_root, turn_dir)
    else:
        raise ProtocolV3Error(f"Unknown workflow stage: {state['current_stage']}")
    _schema_validate(packet, PUBLIC_PACKET_SCHEMA, "emitted public packet")
    packet_path = turn_dir / "run-packet-v3.json"
    _write_json(packet_path, packet)
    return packet_path


def _validate_common_binding_v3(
    state: Mapping[str, Any], packet: Mapping[str, Any], decision: Mapping[str, Any]
) -> Mapping[str, Any]:
    if state["current_stage"] == COMPLETE:
        raise ProtocolV3Error("Workflow is already complete")
    line = state["lines"][state["current_line_index"]]
    expected = {
        "trial_id": state["trial_id"],
        "page_id": state["page_id"],
        "line_id": line["line_id"],
        "stage": state["current_stage"],
        "state_revision": state["state_revision"],
        "state_sha256": state["state_sha256"],
        "packet_sha256": packet["packet_sha256"],
    }
    for key, value in expected.items():
        if decision.get(key) != value:
            raise ProtocolV3Error(
                f"stale or non-current decision binding for {key}: expected {value!r}"
            )
    if packet["state_revision"] != state["state_revision"] or packet[
        "state_sha256"
    ] != state["state_sha256"]:
        raise ProtocolV3Error("stale public packet state binding")
    if packet["current"] != {
        "stage": state["current_stage"],
        "line_id": line["line_id"],
        "line_reading_order": line["line_reading_order"],
    }:
        raise ProtocolV3Error("public packet cursor drift")
    action = decision.get("action")
    if not isinstance(action, dict) or action.get("type") not in packet["legal_actions"]:
        raise ProtocolV3Error("action is illegal for the current software-owned stage")
    return line


def _validate_span_shape_v3(
    span: Mapping[str, Any], source_size: Sequence[int], wide_bounds: Sequence[int]
) -> None:
    if not _bbox_inside_source(span["bbox_source_xywh"], source_size):
        raise ProtocolV3Error("visible span bbox is outside source")
    if not _bbox_intersects_xyxy(span["bbox_source_xywh"], wide_bounds):
        raise ProtocolV3Error("visible span bbox does not intersect shown wide context")
    minimum = span["estimated_word_count_min"]
    maximum = span["estimated_word_count_max"]
    if minimum > maximum:
        raise ProtocolV3Error("visible span word-count range is reversed")
    kind = span["visual_kind"]
    if kind == "word_like" and minimum < 1:
        raise ProtocolV3Error("word-like span must estimate at least one word")
    if kind in ("punctuation", "non_word_mark") and (minimum != 0 or maximum != 0):
        raise ProtocolV3Error("punctuation/non-word spans must use a zero word count")
    if span["internal_boundary_status"] == "clear_single" and (
        minimum != 1 or maximum != 1
    ):
        raise ProtocolV3Error("clear_single span must have a 1..1 word estimate")


def _validate_stage_a_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], decision: Mapping[str, Any]
) -> dict[str, Any]:
    action = decision["action"]
    if action["type"] == "defer_line":
        return {"action_type": "defer_line", "visible_span_count": 0}
    spans = action["spans"]
    if action["visible_span_count"] != len(spans):
        raise ProtocolV3Error("visible_span_count does not equal spans length")
    orders = [span["order"] for span in spans]
    if orders != list(range(1, len(spans) + 1)):
        raise ProtocolV3Error("Stage A span order must be contiguous and serialized")
    for span in spans:
        _validate_span_shape_v3(
            span, state["source"]["size"], line["wide_source_crop_xyxy"]
        )
    return {
        "action_type": "submit_visible_inventory",
        "visible_span_count": len(spans),
        "uncertain_internal_boundary_count": sum(
            span["internal_boundary_status"]
            in ("possible_multiword", "likely_multiword", "unknown")
            for span in spans
        ),
    }


def _unique_ids(items: Sequence[Mapping[str, Any]], field: str, label: str) -> set[str]:
    values = [item[field] for item in items]
    duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
    if duplicates:
        raise ProtocolV3Error(f"duplicate {label} IDs: {duplicates}")
    return set(values)


def _validate_edge_table(
    edges: Sequence[Mapping[str, Any]], fields: tuple[str, str], label: str
) -> None:
    pairs = [tuple(edge[field] for field in fields) for edge in edges]
    if len(pairs) != len(set(pairs)):
        raise ProtocolV3Error(f"duplicate {label} edge")


def _edge_counts(
    edges: Sequence[Mapping[str, Any]], field: str
) -> Counter[str]:
    return Counter(edge[field] for edge in edges)


def _gap_count(
    gaps: Sequence[Mapping[str, Any]], node_type: str, node_id: str, relation: str
) -> int:
    return sum(
        gap["node_type"] == node_type
        and gap["node_id"] == node_id
        and gap["missing_relation"] == relation
        for gap in gaps
    )


def _require_edge_or_gap(
    *, edge_count: int, gap_count: int, label: str
) -> None:
    if edge_count > 0 and gap_count != 0:
        raise ProtocolV3Error(f"{label} has both edges and a gap")
    if edge_count == 0 and gap_count != 1:
        raise ProtocolV3Error(f"{label} needs exactly one explicit gap")


def _validate_stage_b_v3(
    state: Mapping[str, Any], line: Mapping[str, Any], packet: Mapping[str, Any], decision: Mapping[str, Any]
) -> dict[str, Any]:
    action = decision["action"]
    if action["type"] == "defer_line":
        return {"action_type": "defer_line", "word_unit_count": 0}
    graph = action["graph"]
    inserted = graph["inserted_visible_spans"]
    expected_inserted = packet["software_allocated_ids"][
        "inserted_visible_span_ids_in_order"
    ][: len(inserted)]
    if [span["span_id"] for span in inserted] != expected_inserted:
        raise ProtocolV3Error("inserted span IDs are not the software-allocated prefix")
    for span in inserted:
        _validate_span_shape_v3(
            span, state["source"]["size"], line["wide_source_crop_xyxy"]
        )
    base_span_ids = {span["span_id"] for span in line["visible_spans"]}
    inserted_span_ids = _unique_ids(inserted, "span_id", "inserted span")
    all_span_ids = base_span_ids | inserted_span_ids
    visible_span_order = graph["visible_span_order"]
    if len(visible_span_order) != len(set(visible_span_order)):
        raise ProtocolV3Error("duplicate node in visible_span_order")
    if set(visible_span_order) != all_span_ids:
        raise ProtocolV3Error("visible_span_order omits or invents span nodes")

    words = graph["word_units"]
    word_ids = _unique_ids(words, "word_unit_id", "word unit")
    expected_word_ids = packet["software_allocated_ids"]["word_unit_ids_in_order"][
        : len(words)
    ]
    if [word["word_unit_id"] for word in words] != expected_word_ids:
        raise ProtocolV3Error("word-unit IDs are not the software-allocated prefix")
    if [word["order"] for word in words] != list(range(1, len(words) + 1)):
        raise ProtocolV3Error("word-unit order must be contiguous and serialized")
    for word in words:
        if not _bbox_inside_source(word["bbox_source_xywh"], state["source"]["size"]):
            raise ProtocolV3Error(f"word-unit bbox outside source: {word['word_unit_id']}")

    transcript_ids = {
        node["transcript_node_id"]
        for node in line["private_rejectable_transcript_nodes"]
    }
    proposal_ids = {
        node["proposal_node_id"]
        for node in line["private_untrusted_proposal_nodes"]
    }
    span_word = graph["span_word_edges"]
    word_transcript = graph["word_transcript_edges"]
    word_proposal = graph["word_proposal_edges"]
    _validate_edge_table(span_word, ("span_id", "word_unit_id"), "span-word")
    _validate_edge_table(
        word_transcript, ("word_unit_id", "transcript_node_id"), "word-transcript"
    )
    _validate_edge_table(
        word_proposal, ("word_unit_id", "proposal_node_id"), "word-proposal"
    )
    for edge in span_word:
        if edge["span_id"] not in all_span_ids or edge["word_unit_id"] not in word_ids:
            raise ProtocolV3Error("orphan node reference in span-word edge")
    for edge in word_transcript:
        if edge["word_unit_id"] not in word_ids or edge["transcript_node_id"] not in transcript_ids:
            raise ProtocolV3Error("orphan node reference in word-transcript edge")
    for edge in word_proposal:
        if edge["word_unit_id"] not in word_ids or edge["proposal_node_id"] not in proposal_ids:
            raise ProtocolV3Error("orphan node reference in word-proposal edge")

    span_counts = _edge_counts(span_word, "span_id")
    word_span_counts = _edge_counts(span_word, "word_unit_id")
    for span_id in all_span_ids:
        if span_counts[span_id] < 1:
            raise ProtocolV3Error(f"orphan visible span node: {span_id}")
    for word_id in word_ids:
        if word_span_counts[word_id] != 1:
            raise ProtocolV3Error(
                f"word unit must belong to exactly one visible span: {word_id}"
            )

    gaps = graph["explicit_gaps"]
    gap_keys = [
        (gap["node_type"], gap["node_id"], gap["missing_relation"])
        for gap in gaps
    ]
    if len(gap_keys) != len(set(gap_keys)):
        raise ProtocolV3Error("duplicate explicit gap")
    valid_gap_domains = {
        ("word_unit", "transcript_node"): word_ids,
        ("word_unit", "proposal_node"): word_ids,
        ("transcript_node", "word_unit"): transcript_ids,
        ("proposal_node", "word_unit"): proposal_ids,
    }
    for gap in gaps:
        domain = valid_gap_domains.get((gap["node_type"], gap["missing_relation"]))
        if domain is None or gap["node_id"] not in domain:
            raise ProtocolV3Error("orphan or illegal explicit gap reference")

    word_transcript_counts = _edge_counts(word_transcript, "word_unit_id")
    transcript_word_counts = _edge_counts(word_transcript, "transcript_node_id")
    word_proposal_counts = _edge_counts(word_proposal, "word_unit_id")
    proposal_word_counts = _edge_counts(word_proposal, "proposal_node_id")
    for word_id in word_ids:
        _require_edge_or_gap(
            edge_count=word_transcript_counts[word_id],
            gap_count=_gap_count(gaps, "word_unit", word_id, "transcript_node"),
            label=f"word/transcript accounting for {word_id}",
        )
        _require_edge_or_gap(
            edge_count=word_proposal_counts[word_id],
            gap_count=_gap_count(gaps, "word_unit", word_id, "proposal_node"),
            label=f"word/proposal accounting for {word_id}",
        )
    for transcript_id in transcript_ids:
        _require_edge_or_gap(
            edge_count=transcript_word_counts[transcript_id],
            gap_count=_gap_count(
                gaps, "transcript_node", transcript_id, "word_unit"
            ),
            label=f"transcript/word accounting for {transcript_id}",
        )
    for proposal_id in proposal_ids:
        _require_edge_or_gap(
            edge_count=proposal_word_counts[proposal_id],
            gap_count=_gap_count(gaps, "proposal_node", proposal_id, "word_unit"),
            label=f"proposal/word accounting for {proposal_id}",
        )

    one_proposal_to_many_words = any(
        count > 1 for count in proposal_word_counts.values()
    )
    many_proposals_to_one_word = any(count > 1 for count in word_proposal_counts.values())
    one_span_to_many_words = any(count > 1 for count in span_counts.values())
    return {
        "action_type": "submit_alignment_graph",
        "visible_span_count": len(all_span_ids),
        "inserted_visible_span_count": len(inserted),
        "word_unit_count": len(word_ids),
        "transcript_node_count": len(transcript_ids),
        "proposal_node_count": len(proposal_ids),
        "explicit_gap_count": len(gaps),
        "cardinality_features": {
            "one_span_to_many_words": one_span_to_many_words,
            "one_proposal_to_many_words": one_proposal_to_many_words,
            "many_proposals_to_one_word": many_proposals_to_one_word,
        },
    }


def validate_decision_v3(
    state: Mapping[str, Any], packet: Mapping[str, Any], decision: Mapping[str, Any]
) -> dict[str, Any]:
    _verify_hash(state, "state_sha256", "workflow state")
    _verify_hash(packet, "packet_sha256", "public packet")
    stage = state["current_stage"]
    line = _validate_common_binding_v3(state, packet, decision)
    if stage == STAGE_A:
        _schema_validate(decision, STAGE_A_SCHEMA, "Stage A decision")
    elif stage == STAGE_B:
        _schema_validate(decision, STAGE_B_SCHEMA, "Stage B decision")
    else:
        raise ProtocolV3Error("No decision is legal after workflow completion")
    if stage == STAGE_A:
        details = _validate_stage_a_v3(state, line, decision)
    else:
        details = _validate_stage_b_v3(state, line, packet, decision)
    result = {
        "schema_version": "inventory-alignment-decision-validation.v3",
        "protocol_version": PROTOCOL_VERSION,
        "trial_id": state["trial_id"],
        "page_id": state["page_id"],
        "line_id": line["line_id"],
        "stage": stage,
        "state_revision": state["state_revision"],
        "state_sha256": state["state_sha256"],
        "packet_sha256": packet["packet_sha256"],
        "decision_sha256": canonical_hash(decision),
        "status": "pass",
        "software_owned_invariants": {
            "current_cursor_exact": True,
            "current_stage_exact": True,
            "legal_action_exact": True,
            "state_and_packet_not_stale": True,
        },
        "details": details,
    }
    result["validation_sha256"] = canonical_hash(result)
    return result


def validate_decision_files_v3(
    state_path: Path, packet_path: Path, decision_path: Path
) -> dict[str, Any]:
    state = load_state_v3(state_path)
    packet = load_packet_v3(packet_path)
    decision = _load_json(decision_path)
    return validate_decision_v3(state, packet, decision)


def _advance_after_line_v3(state: dict[str, Any]) -> None:
    state["current_line_index"] += 1
    if state["current_line_index"] >= len(state["lines"]):
        state["current_stage"] = COMPLETE
    else:
        state["current_stage"] = STAGE_A


def apply_decision_files_v3(
    state_path: Path, packet_path: Path, decision_path: Path, workflow_root: Path
) -> dict[str, Any]:
    """Validate, apply one current action, and emit at most one next packet."""

    state = load_state_v3(state_path)
    packet = load_packet_v3(packet_path)
    decision = _load_json(decision_path)
    validation = validate_decision_v3(state, packet, decision)
    line = state["lines"][state["current_line_index"]]
    action = decision["action"]
    decision_hash = canonical_hash(decision)
    state["decision_history"].append(
        {
            "state_revision": state["state_revision"],
            "stage": state["current_stage"],
            "line_id": line["line_id"],
            "action_type": action["type"],
            "packet_sha256": packet["packet_sha256"],
            "decision_sha256": decision_hash,
            "validation_sha256": validation["validation_sha256"],
        }
    )
    if action["type"] == "defer_line":
        line["status"] = "deferred_for_review"
        line["defer_reason"] = action["reason"]
        _advance_after_line_v3(state)
    elif state["current_stage"] == STAGE_A:
        line["visible_spans"] = [
            {
                "span_id": f"{line['line_id']}-VS{index:03d}",
                **copy.deepcopy(span),
            }
            for index, span in enumerate(action["spans"], start=1)
        ]
        line["stage_a_decision_sha256"] = decision_hash
        line["status"] = "pending_stage_b"
        state["current_stage"] = STAGE_B
    elif state["current_stage"] == STAGE_B:
        line["alignment_graph"] = copy.deepcopy(action["graph"])
        line["stage_b_decision_sha256"] = decision_hash
        line["status"] = "alignment_complete"
        _advance_after_line_v3(state)
    else:
        raise ProtocolV3Error("Decision reached impossible stage transition")

    state["state_revision"] += 1
    state = _with_hash(state, "state_sha256")
    _write_json(state_path, state)
    next_packet_path = None
    if state["current_stage"] != COMPLETE:
        next_packet_path = emit_current_packet_v3(state, workflow_root.resolve())
    return {
        "validation": validation,
        "state": state,
        "state_path": state_path,
        "next_packet_path": next_packet_path,
    }


__all__ = [
    "COMPLETE",
    "DEFAULT_V3_CONTEXT_PADDING",
    "PACKET_SCHEMA_VERSION",
    "PAGE_SPECS_V3",
    "PROTOCOL_VERSION",
    "ProtocolV3Error",
    "STAGE_A",
    "STAGE_B",
    "apply_affine",
    "apply_decision_files_v3",
    "canonical_hash",
    "directed_transform_v3",
    "emit_current_packet_v3",
    "initialize_builtin_workflow_v3",
    "initialize_workflow_v3",
    "load_packet_v3",
    "load_state_v3",
    "sha256_file",
    "transform_source_bbox_to_upright_v3",
    "validate_decision_files_v3",
    "validate_decision_v3",
]
