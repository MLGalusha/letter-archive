#!/usr/bin/env python3
"""Adapt a complete v3 inventory/alignment state into ownership seed artifacts.

The adapter is intentionally conservative: accepted v3 word units supply the
queue and rectangles supply only mask candidates.  Ink covered by more than one
rectangle is withheld from every exclusive candidate and remains residual.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from build_full_page_ownership_knockout_v2 import (
    COLLISION_WARNING,
    MASK_WARNING,
    _normalize_014_mask,
    canonical_hash,
    mask_pixel_hash,
    save_mask,
    sha256_file,
)
from inventory_alignment_protocol_v3 import (
    COMPLETE,
    PROTOCOL_VERSION,
    STATE_SCHEMA_VERSION,
    canonical_hash as v3_canonical_hash,
    directed_transform_v3,
)


MANIFEST_VERSION = "v3-alignment-ownership-knockout-manifest.v1"
DECISION_VERSION = "v3-alignment-ownership-seed-decision.v1"
PACKET_VERSION = "v3-alignment-ownership-public-packet.v1"
RECORD_VERSION = "v3-alignment-ownership-selection-record.v1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RED = np.array([222, 50, 42], dtype=np.uint8)
ORANGE = np.array([244, 139, 31], dtype=np.uint8)
BLUE = (8, 104, 172)


class AdapterError(RuntimeError):
    """A fail-closed state, input, or output error."""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"Cannot read JSON object {path}: {error}") from error
    if not isinstance(value, dict):
        raise AdapterError(f"Expected a JSON object: {path}")
    return value


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        + "\n",
        encoding="utf-8",
    )


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    return v3_canonical_hash(basis)


def _sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise AdapterError(f"{label} must be a lowercase SHA-256")
    return value


def _bbox(value: Any, source_size: Sequence[int], label: str) -> list[int]:
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(isinstance(item, bool) or not isinstance(item, int) for item in value)
    ):
        raise AdapterError(f"{label} must be an integer xywh bbox")
    x, y, width, height = value
    if x < 0 or y < 0 or width < 1 or height < 1:
        raise AdapterError(f"{label} is invalid")
    if x + width > source_size[0] or y + height > source_size[1]:
        raise AdapterError(f"{label} lies outside the source")
    return list(value)


def _unique(items: Sequence[Mapping[str, Any]], field: str, label: str) -> set[str]:
    values = [item.get(field) for item in items]
    if any(not isinstance(value, str) or not value for value in values):
        raise AdapterError(f"{label} IDs must be non-empty strings")
    if len(values) != len(set(values)):
        raise AdapterError(f"Duplicate {label} ID")
    return set(values)


def _edge_pairs(
    edges: Any, first: str, second: str, label: str
) -> tuple[list[Mapping[str, Any]], Counter[str], Counter[str]]:
    if not isinstance(edges, list) or any(not isinstance(edge, Mapping) for edge in edges):
        raise AdapterError(f"{label} edges must be a list of objects")
    pairs = [(edge.get(first), edge.get(second)) for edge in edges]
    if any(not isinstance(a, str) or not isinstance(b, str) for a, b in pairs):
        raise AdapterError(f"{label} edge IDs must be strings")
    if len(pairs) != len(set(pairs)):
        raise AdapterError(f"Duplicate {label} edge")
    return edges, Counter(a for a, _ in pairs), Counter(b for _, b in pairs)


def _validate_graph(
    line: Mapping[str, Any], source_size: Sequence[int]
) -> dict[str, Any]:
    graph = line.get("alignment_graph")
    if not isinstance(graph, Mapping):
        raise AdapterError(f"Line {line.get('line_id')} has no terminal alignment graph")
    base_spans = line.get("visible_spans")
    if not isinstance(base_spans, list) or not base_spans:
        raise AdapterError(f"Line {line.get('line_id')} has no accepted Stage A spans")
    inserted = graph.get("inserted_visible_spans")
    words = graph.get("word_units")
    if not isinstance(inserted, list) or not isinstance(words, list) or not words:
        raise AdapterError(f"Line {line.get('line_id')} graph is incomplete")
    spans = [*base_spans, *inserted]
    span_ids = _unique(spans, "span_id", "visible span")
    word_ids = _unique(words, "word_unit_id", "word unit")
    for span in spans:
        _bbox(span.get("bbox_source_xywh"), source_size, f"span {span.get('span_id')}")
    expected_order = list(range(1, len(words) + 1))
    if [word.get("order") for word in words] != expected_order:
        raise AdapterError(f"Line {line.get('line_id')} word order is not contiguous")
    for word in words:
        _bbox(word.get("bbox_source_xywh"), source_size, f"word {word.get('word_unit_id')}")

    visible_order = graph.get("visible_span_order")
    if not isinstance(visible_order, list) or len(visible_order) != len(set(visible_order)):
        raise AdapterError(f"Line {line.get('line_id')} visible span order is invalid")
    if set(visible_order) != span_ids:
        raise AdapterError(f"Line {line.get('line_id')} visible span accounting is incomplete")

    span_word, span_counts, word_span_counts = _edge_pairs(
        graph.get("span_word_edges"), "span_id", "word_unit_id", "span-word"
    )
    transcript_edges, word_transcript_counts, transcript_word_counts = _edge_pairs(
        graph.get("word_transcript_edges"),
        "word_unit_id",
        "transcript_node_id",
        "word-transcript",
    )
    proposal_edges, word_proposal_counts, proposal_word_counts = _edge_pairs(
        graph.get("word_proposal_edges"),
        "word_unit_id",
        "proposal_node_id",
        "word-proposal",
    )
    for edge in span_word:
        if edge["span_id"] not in span_ids or edge["word_unit_id"] not in word_ids:
            raise AdapterError("Orphan span-word edge")
    for edge in [*transcript_edges, *proposal_edges]:
        if edge["word_unit_id"] not in word_ids:
            raise AdapterError("Graph edge references an unknown word")
    if any(span_counts[span_id] < 1 for span_id in span_ids):
        raise AdapterError("Graph has an orphan visible span")
    if any(word_span_counts[word_id] != 1 for word_id in word_ids):
        raise AdapterError("Every word must belong to exactly one visible span")

    transcript_ids = {
        node.get("transcript_node_id")
        for node in line.get("private_rejectable_transcript_nodes", [])
    }
    proposal_ids = {
        node.get("proposal_node_id")
        for node in line.get("private_untrusted_proposal_nodes", [])
    }
    if any(edge["transcript_node_id"] not in transcript_ids for edge in transcript_edges):
        raise AdapterError("Orphan word-transcript edge")
    if any(edge["proposal_node_id"] not in proposal_ids for edge in proposal_edges):
        raise AdapterError("Orphan word-proposal edge")

    gaps = graph.get("explicit_gaps")
    if not isinstance(gaps, list) or any(not isinstance(gap, Mapping) for gap in gaps):
        raise AdapterError("Graph explicit_gaps must be a list of objects")
    gap_keys = [
        (gap.get("node_type"), gap.get("node_id"), gap.get("missing_relation"))
        for gap in gaps
    ]
    if len(gap_keys) != len(set(gap_keys)):
        raise AdapterError("Duplicate explicit graph gap")
    gap_counts = Counter(gap_keys)
    valid_domains = {
        ("word_unit", "transcript_node"): word_ids,
        ("word_unit", "proposal_node"): word_ids,
        ("transcript_node", "word_unit"): transcript_ids,
        ("proposal_node", "word_unit"): proposal_ids,
    }
    for node_type, node_id, relation in gap_keys:
        if node_id not in valid_domains.get((node_type, relation), set()):
            raise AdapterError("Orphan or illegal explicit graph gap")

    def require_edge_or_gap(edge_count: int, gap_count: int, label: str) -> None:
        if (edge_count > 0 and gap_count != 0) or (edge_count == 0 and gap_count != 1):
            raise AdapterError(f"Incomplete edge/gap accounting for {label}")

    for word_id in word_ids:
        require_edge_or_gap(
            word_transcript_counts[word_id],
            gap_counts[("word_unit", word_id, "transcript_node")],
            f"word/transcript {word_id}",
        )
        require_edge_or_gap(
            word_proposal_counts[word_id],
            gap_counts[("word_unit", word_id, "proposal_node")],
            f"word/proposal {word_id}",
        )
    for transcript_id in transcript_ids:
        require_edge_or_gap(
            transcript_word_counts[transcript_id],
            gap_counts[("transcript_node", transcript_id, "word_unit")],
            f"transcript/word {transcript_id}",
        )
    for proposal_id in proposal_ids:
        require_edge_or_gap(
            proposal_word_counts[proposal_id],
            gap_counts[("proposal_node", proposal_id, "word_unit")],
            f"proposal/word {proposal_id}",
        )

    span_by_id = {span["span_id"]: span for span in spans}
    word_span = {edge["word_unit_id"]: edge["span_id"] for edge in span_word}
    return {
        "graph": graph,
        "words": words,
        "span_by_id": span_by_id,
        "word_span": word_span,
        "span_counts": span_counts,
        "word_transcript_counts": word_transcript_counts,
        "word_proposal_counts": word_proposal_counts,
        "proposal_word_counts": proposal_word_counts,
        "gaps": gaps,
    }


def _validate_complete_state(state_path: Path) -> tuple[dict[str, Any], Path]:
    state = _read_json(state_path)
    if state.get("schema_version") != STATE_SCHEMA_VERSION:
        raise AdapterError("Wrong workflow state schema version")
    if state.get("protocol_version") != PROTOCOL_VERSION:
        raise AdapterError("Wrong workflow protocol version")
    if state.get("state_sha256") != _hash_without(state, "state_sha256"):
        raise AdapterError("Workflow state_sha256 is stale")
    if state.get("current_stage") != COMPLETE:
        raise AdapterError("Workflow state must be complete")

    source_info = state.get("source")
    if not isinstance(source_info, Mapping):
        raise AdapterError("Workflow source binding is missing")
    source_path = Path(str(source_info.get("path", ""))).resolve()
    if not source_path.is_file():
        raise AdapterError(f"Bound source is missing: {source_path}")
    if sha256_file(source_path) != _sha(source_info.get("sha256"), "source.sha256"):
        raise AdapterError("Bound source file hash changed")
    with Image.open(source_path) as source:
        source_size = list(source.size)
    if source_size != source_info.get("size"):
        raise AdapterError("Bound source dimensions changed")

    lines = state.get("lines")
    line_order = state.get("line_order")
    if not isinstance(lines, list) or not lines:
        raise AdapterError("Workflow has no lines")
    if line_order != [line.get("line_id") for line in lines]:
        raise AdapterError("Workflow line_order does not exactly match lines")
    if len(line_order) != len(set(line_order)):
        raise AdapterError("Workflow line IDs are not unique")
    if [line.get("line_reading_order") for line in lines] != list(range(1, len(lines) + 1)):
        raise AdapterError("Workflow line reading order is not contiguous")
    if state.get("current_line_index") != len(lines):
        raise AdapterError("Complete workflow cursor does not follow the final line")

    history = state.get("decision_history")
    if not isinstance(history, list) or state.get("state_revision") != len(history):
        raise AdapterError("Workflow revision/history length is inconsistent")
    if [entry.get("state_revision") for entry in history] != list(range(len(history))):
        raise AdapterError("Workflow decision history revisions are not contiguous")
    by_line: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for entry in history:
        if not isinstance(entry, Mapping):
            raise AdapterError("Workflow decision history entry is invalid")
        for field in ("packet_sha256", "decision_sha256", "validation_sha256"):
            _sha(entry.get(field), f"decision history {field}")
        by_line[str(entry.get("line_id"))].append(entry)
    if [entry.get("line_id") for entry in history[1::2]] != line_order:
        raise AdapterError("Workflow terminal history order does not match line order")

    for line in lines:
        line_id = line["line_id"]
        entries = by_line.get(line_id, [])
        if line.get("status") != "alignment_complete" or len(entries) != 2:
            raise AdapterError(f"Line {line_id} is not a two-stage terminal graph")
        if [entry.get("stage") for entry in entries] != [
            "stage_a_visible_inventory",
            "stage_b_graph_alignment",
        ]:
            raise AdapterError(f"Line {line_id} history stages are inconsistent")
        if [entry.get("action_type") for entry in entries] != [
            "submit_visible_inventory",
            "submit_alignment_graph",
        ]:
            raise AdapterError(f"Line {line_id} history actions are not terminal submissions")
        if line.get("stage_a_decision_sha256") != entries[0]["decision_sha256"]:
            raise AdapterError(f"Line {line_id} Stage A decision hash drift")
        if line.get("stage_b_decision_sha256") != entries[1]["decision_sha256"]:
            raise AdapterError(f"Line {line_id} Stage B decision hash drift")
        directed = line.get("directed_transform")
        if not isinstance(directed, Mapping):
            raise AdapterError(f"Line {line_id} lacks a directed transform")
        expected = directed_transform_v3(
            directed.get("source_crop_xyxy", []),
            directed.get("source_to_upright_rotation_degrees"),
        )
        if directed != expected:
            raise AdapterError(f"Line {line_id} directed transform is stale or inconsistent")
        _validate_graph(line, source_size)
    return state, source_path


def _directed_reading(rotation: int) -> str:
    return {0: "left_to_right", -90: "bottom_to_top", 90: "top_to_bottom", 180: "right_to_left"}[rotation]


def _route_unit(
    line: Mapping[str, Any], graph_info: Mapping[str, Any], word: Mapping[str, Any], *, collision: bool
) -> tuple[str, list[str], list[str]]:
    word_id = word["word_unit_id"]
    span_id = graph_info["word_span"][word_id]
    span = graph_info["span_by_id"][span_id]
    flags = {
        flag for flag in span.get("uncertainty_flags", []) if flag != "none"
    }
    gaps = [gap for gap in graph_info["gaps"] if gap.get("node_type") == "word_unit" and gap.get("node_id") == word_id]
    risks = set(flags)
    reasons: list[str] = []

    human_reasons = []
    if word.get("kind") == "unreadable" or span.get("visual_kind") == "unreadable" or "unreadable" in flags:
        human_reasons.append("unreadable_visible_unit")
    if any(gap.get("reason") in {"unreadable", "uncertain_alignment"} for gap in gaps):
        human_reasons.append("explicit_human_grade_alignment_gap")
    if human_reasons:
        risks.update(human_reasons)
        return "human_review", sorted(set(human_reasons)), sorted(risks)

    rotation = int(line["directed_transform"]["source_to_upright_rotation_degrees"])
    if rotation != 0 or line.get("stream_id") == "top-margin":
        reasons.append("rotated_vertical_or_top_margin")
        risks.add("rotated")
    if line.get("stream_id") == "signatures":
        reasons.append("signature_context_uncertainty")
        risks.add("signature_uncertainty")
    if word.get("kind") != "word" or span.get("visual_kind") in {"punctuation", "non_word_mark"}:
        reasons.append("punctuation_or_nonword_uncertainty")
        risks.add("punctuation_uncertain")
    difficult = flags & {"fold", "touching_neighbors", "fragmented", "rotation_uncertain"}
    if difficult:
        reasons.append("difficult_visible_uncertainty:" + ",".join(sorted(difficult)))
    if gaps:
        reasons.append("explicit_graph_gap")
        risks.update("graph_gap:" + str(gap.get("missing_relation")) for gap in gaps)
    if graph_info["span_counts"][span_id] > 1:
        reasons.append("one_visible_span_to_many_words")
        risks.add("one_span_many_words")
    if graph_info["word_proposal_counts"][word_id] > 1:
        reasons.append("many_proposals_to_one_word")
        risks.add("many_proposals_one_word")
    shared_proposals = {
        edge["proposal_node_id"]
        for edge in graph_info["graph"]["word_proposal_edges"]
        if edge["word_unit_id"] == word_id
        and graph_info["proposal_word_counts"][edge["proposal_node_id"]] > 1
    }
    if shared_proposals:
        reasons.append("shared_proposal_crossing")
        risks.add("shared_crossing")
    if graph_info["word_transcript_counts"][word_id] == 0:
        reasons.append("transcript_gap")
        risks.add("transcript_gap")
    if collision:
        reasons.append("multiply_boxed_ink_withheld")
        risks.add("shared_ink")
    if reasons or flags:
        if not reasons:
            reasons.append("visible_uncertainty:" + ",".join(sorted(flags)))
        return "sol_shared_ink", reasons, sorted(risks)
    return "terra_box_mask", ["ordinary_unrotated_word_without_visible_or_graph_ambiguity"], ["none"]


def _safe_name(value: str) -> str:
    return "".join(character if character.isalnum() or character in "-_." else "_" for character in value) or "unit"


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


def _overlay(source: Image.Image, candidate: np.ndarray, residual: np.ndarray) -> Image.Image:
    pixels = np.asarray(source.convert("RGB"), dtype=np.uint8).copy()
    pixels[candidate] = ((pixels[candidate].astype(np.uint16) + RED * 2) // 3).astype(np.uint8)
    orange = residual & ~candidate
    pixels[orange] = ((pixels[orange].astype(np.uint16) + ORANGE * 2) // 3).astype(np.uint8)
    return Image.fromarray(pixels, mode="RGB")


def _background_fill(source: Image.Image, ink: np.ndarray, boxes: Iterable[Sequence[int]]) -> Image.Image:
    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8).copy()
    height, width = ink.shape
    for x, y, box_width, box_height in boxes:
        pad = 8
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(width, x + box_width + pad), min(height, y + box_height + pad)
        ring = np.ones((y1 - y0, x1 - x0), dtype=bool)
        ring[y - y0 : y + box_height - y0, x - x0 : x + box_width - x0] = False
        ring &= ~ink[y0:y1, x0:x1]
        samples = rgb[y0:y1, x0:x1][ring]
        if samples.size == 0:
            samples = rgb[y0:y1, x0:x1].reshape(-1, 3)
        fill = np.median(samples, axis=0).round().astype(np.uint8)
        rgb[y : y + box_height, x : x + box_width] = fill
    return Image.fromarray(rgb, mode="RGB")


def _render_upright_board(
    source: Image.Image, lines: Sequence[Mapping[str, Any]], units_by_line: Mapping[str, Sequence[Mapping[str, Any]]]
) -> Image.Image:
    rotated_lines = [line for line in lines if line["directed_transform"]["source_to_upright_rotation_degrees"] != 0 or line.get("stream_id") == "top-margin"]
    if not rotated_lines:
        board = Image.new("RGB", (900, 90), "#f4f1e9")
        ImageDraw.Draw(board).text((12, 20), "No rotated/top-margin lines in this complete state.", fill="#111111", font=_font(20))
        return board
    panels: list[Image.Image] = []
    for line in rotated_lines:
        transform = line["directed_transform"]
        left, top, right, bottom = transform["source_crop_xyxy"]
        crop = source.crop((left, top, right, bottom)).convert("RGB")
        rotation = transform["source_to_upright_rotation_degrees"]
        transpose = {-90: Image.Transpose.ROTATE_270, 90: Image.Transpose.ROTATE_90, 180: Image.Transpose.ROTATE_180}
        upright = crop if rotation == 0 else crop.transpose(transpose[rotation])
        header = 62
        panel = Image.new("RGB", (upright.width, upright.height + header), "#f4f1e9")
        panel.paste(upright, (0, header))
        draw = ImageDraw.Draw(panel)
        draw.text((8, 6), f"{line['line_id']} — upright semantic order", fill="#111111", font=_font(18))
        draw.text((8, 32), "Order follows the directed transform, never raw source y.", fill="#333333", font=_font(14))
        affine = transform["source_to_upright_affine"]
        for unit in units_by_line[line["line_id"]]:
            x, y, width, height = unit["bbox_source_xywh"]
            corners = []
            for px, py in ((x, y), (x + width, y), (x, y + height), (x + width, y + height)):
                corners.append((affine[0] * px + affine[1] * py + affine[2], affine[3] * px + affine[4] * py + affine[5]))
            xs, ys = [point[0] for point in corners], [point[1] for point in corners]
            box = (min(xs), min(ys) + header, max(xs), max(ys) + header)
            draw.rectangle(box, outline=BLUE, width=2)
            draw.text((box[0] + 2, max(header, box[1] - 18)), f"{unit['unit_reading_order']}:{unit['unit_id']}", fill=BLUE, font=_font(13), stroke_width=2, stroke_fill="white")
        panels.append(panel)
    canvas = Image.new("RGB", (max(panel.width for panel in panels), sum(panel.height for panel in panels)), "white")
    cursor = 0
    for panel in panels:
        canvas.paste(panel, (0, cursor))
        cursor += panel.height
        panel.close()
    return canvas


def _output_meta(root: Path, path: Path, role: str) -> dict[str, Any]:
    return {"path": str(path.relative_to(root)), "file_sha256": sha256_file(path), "bytes": path.stat().st_size, "role": role}


def build(state_path: Path, ink_mask_path: Path, output_dir: Path) -> Path:
    state_path = Path(state_path).resolve()
    ink_mask_path = Path(ink_mask_path).resolve()
    output_dir = Path(output_dir).resolve()
    if output_dir.exists() or output_dir.is_symlink():
        raise AdapterError(f"Output directory already exists; refusing overwrite: {output_dir}")
    state, source_path = _validate_complete_state(state_path)
    if not ink_mask_path.is_file():
        raise AdapterError(f"Full-source ink mask is missing: {ink_mask_path}")

    parent = output_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.build-", dir=parent))
    try:
        with Image.open(source_path) as opened:
            source = opened.convert("RGB")
        ink, normalization = _normalize_014_mask(ink_mask_path, source)
        save_mask(temporary / "masks/ink-proposal.png", ink)
        normalization.update({
            "schema_version": "v3-alignment-014-mask-normalization.v1",
            "page_id": state["page_id"],
            "normalized_pixel_sha256": mask_pixel_hash(ink),
            "normalization_uses_proposal_boxes": False,
        })
        _write_json(temporary / "masks/ink-proposal-record.json", normalization)

        line_infos = {line["line_id"]: _validate_graph(line, state["source"]["size"]) for line in state["lines"]}
        raw_units: list[dict[str, Any]] = []
        for line in state["lines"]:
            for word in line_infos[line["line_id"]]["words"]:
                raw_units.append({"line": line, "word": word, "graph": line_infos[line["line_id"]]})
        owner_count = np.zeros(ink.shape, dtype=np.uint32)
        for item in raw_units:
            x, y, width, height = item["word"]["bbox_source_xywh"]
            owner_count[y : y + height, x : x + width] += ink[y : y + height, x : x + width].astype(np.uint32)
        collisions = ink & (owner_count > 1)
        exclusive_union = ink & (owner_count == 1)
        residual = ink & ~exclusive_union
        unboxed = ink & (owner_count == 0)
        if np.any(exclusive_union & residual) or not np.array_equal(ink, exclusive_union | residual):
            raise AdapterError("Exact residual partition failed")
        if not np.array_equal(residual, collisions | unboxed) or np.any(collisions & unboxed):
            raise AdapterError("Residual collision/unboxed accounting failed")
        save_mask(temporary / "masks/candidate-exclusive-union.png", exclusive_union)
        save_mask(temporary / "masks/collisions.png", collisions)
        save_mask(temporary / "masks/exact-residual.png", residual)
        save_mask(temporary / "masks/unboxed-residual.png", unboxed)

        units: list[dict[str, Any]] = []
        unit_records: list[dict[str, Any]] = []
        units_by_line: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in raw_units:
            line, word, graph = item["line"], item["word"], item["graph"]
            unit_id = word["word_unit_id"]
            x, y, width, height = word["bbox_source_xywh"]
            candidate_crop = ink[y : y + height, x : x + width]
            exclusive_crop = candidate_crop & (owner_count[y : y + height, x : x + width] == 1)
            collision_crop = candidate_crop & (owner_count[y : y + height, x : x + width] > 1)
            candidate = np.zeros_like(ink, dtype=bool)
            exclusive = np.zeros_like(ink, dtype=bool)
            withheld = np.zeros_like(ink, dtype=bool)
            candidate[y : y + height, x : x + width] = candidate_crop
            exclusive[y : y + height, x : x + width] = exclusive_crop
            withheld[y : y + height, x : x + width] = collision_crop
            unit_dir = temporary / "units" / _safe_name(unit_id)
            save_mask(unit_dir / "candidate-mask.png", candidate)
            save_mask(unit_dir / "exclusive-mask.png", exclusive)
            save_mask(unit_dir / "withheld-collision-mask.png", withheld)
            route, route_reasons, risks = _route_unit(line, graph, word, collision=bool(collision_crop.any()))
            rotation = int(line["directed_transform"]["source_to_upright_rotation_degrees"])
            unit = {
                "unit_id": unit_id,
                "reading_order": word["order"],
                "bbox_source_xywh": list(word["bbox_source_xywh"]),
                "tentative_text": word.get("text_guess"),
                "unit_kind": word["kind"],
                "ownership_route": route,
                "risk_flags": risks,
                "route_reasons": route_reasons,
                "v3_visible_span_id": graph["word_span"][unit_id],
            }
            units.append(unit | {"line_id": line["line_id"]})
            units_by_line[line["line_id"]].append(unit | {"unit_reading_order": word["order"]})
            unit_records.append({
                "unit_id": unit_id,
                "line_id": line["line_id"],
                "bbox_source_xywh": list(word["bbox_source_xywh"]),
                "candidate_pixels": int(candidate.sum()),
                "exclusive_pixels": int(exclusive.sum()),
                "withheld_collision_pixels": int(withheld.sum()),
                "candidate_pixel_sha256": mask_pixel_hash(candidate),
                "exclusive_pixel_sha256": mask_pixel_hash(exclusive),
                "withheld_collision_pixel_sha256": mask_pixel_hash(withheld),
                "ownership_route": route,
                "route_reasons": route_reasons,
                "risk_flags": risks,
                "files": {
                    "candidate": str((unit_dir / "candidate-mask.png").relative_to(temporary)),
                    "exclusive": str((unit_dir / "exclusive-mask.png").relative_to(temporary)),
                    "withheld_collision": str((unit_dir / "withheld-collision-mask.png").relative_to(temporary)),
                },
            })

        packet: dict[str, Any] = {
            "schema_version": PACKET_VERSION,
            "protocol_version": PROTOCOL_VERSION,
            "trial_id": state["trial_id"],
            "page_id": state["page_id"],
            "source": {"path": str(source_path), "sha256": state["source"]["sha256"], "size": state["source"]["size"]},
            "v3_complete_state": {"file_sha256": sha256_file(state_path), "state_sha256": state["state_sha256"]},
            "line_count": len(state["lines"]),
            "unit_count": len(units),
            "public_scope": "accepted_stage_a_spans_and_alignment_graph_word_units_only",
        }
        packet["packet_sha256"] = canonical_hash(packet)
        packet_path = temporary / "ownership-public-packet.json"
        _write_json(packet_path, packet)

        decision_lines = []
        for line in state["lines"]:
            rotation = int(line["directed_transform"]["source_to_upright_rotation_degrees"])
            line_units = []
            for unit in units:
                if unit["line_id"] == line["line_id"]:
                    line_units.append({key: value for key, value in unit.items() if key != "line_id"})
            decision_lines.append({
                "line_id": line["line_id"],
                "line_reading_order": line["line_reading_order"],
                "upright_rotation_degrees": rotation,
                "directed_reading": _directed_reading(rotation),
                "directed_transform": line["directed_transform"],
                "visible_units": line_units,
            })
        decision = {
            "schema_version": DECISION_VERSION,
            "protocol_version": PROTOCOL_VERSION,
            "trial_id": state["trial_id"],
            "page_id": state["page_id"],
            "source_sha256": state["source"]["sha256"],
            "public_packet_sha256": sha256_file(packet_path),
            "v3_complete_state_sha256": state["state_sha256"],
            "hidden_prior_answer_access": False,
            "unit_source_policy": "accepted_v3_alignment_graph_word_units_only",
            "candidate_policy": "bbox_intersection_with_normalized_ink; multiply-boxed_pixels_withheld",
            "lines": decision_lines,
        }
        decision_path = temporary / "ownership-seed-decision.json"
        _write_json(decision_path, decision)

        _write_json(temporary / "units/selection-records.json", {
            "schema_version": RECORD_VERSION,
            "page_id": state["page_id"],
            "warning": MASK_WARNING,
            "collision_warning": COLLISION_WARNING,
            "units": unit_records,
            "summary": {
                "ink_pixels": int(ink.sum()),
                "raw_candidate_memberships": int(sum(record["candidate_pixels"] for record in unit_records)),
                "exclusive_candidate_union_pixels": int(exclusive_union.sum()),
                "collision_pixels": int(collisions.sum()),
                "unboxed_residual_pixels": int(unboxed.sum()),
                "exact_residual_pixels": int(residual.sum()),
                "exact_equations": {
                    "ink_equals_exclusive_union_plus_residual": int(ink.sum()) == int(exclusive_union.sum()) + int(residual.sum()),
                    "residual_equals_collisions_plus_unboxed": int(residual.sum()) == int(collisions.sum()) + int(unboxed.sum()),
                },
            },
        })

        diagnostics_dir = temporary / "diagnostics"
        diagnostics_dir.mkdir(parents=True, exist_ok=True)
        subtraction = np.full((*ink.shape, 3), 250, dtype=np.uint8)
        subtraction[residual] = (30, 30, 32)
        subtraction[collisions] = ORANGE
        Image.fromarray(subtraction, mode="RGB").save(diagnostics_dir / "exact-mask-subtraction.png", format="PNG", compress_level=9, optimize=False)
        coverage = _overlay(source, exclusive_union, residual)
        coverage.save(diagnostics_dir / "coverage-overlay.png", format="PNG", compress_level=9, optimize=False)
        coverage.close()
        background = _background_fill(source, ink, [unit["bbox_source_xywh"] for unit in units])
        background.save(diagnostics_dir / "background-box-fill.png", format="PNG", compress_level=9, optimize=False)
        background.close()
        upright = _render_upright_board(source, state["lines"], units_by_line)
        upright.save(diagnostics_dir / "top-margin-upright-ordering.png", format="PNG", compress_level=9, optimize=False)
        upright.close()
        source.close()
        _write_json(diagnostics_dir / "diagnostics.json", {
            "schema_version": "v3-alignment-ownership-diagnostics.v1",
            "page_id": state["page_id"],
            "background_box_fill_role": "visual_erase_idea_only_never_mask_support_or_canonical_subtraction",
            "exact_mask_subtraction_role": "exact_normalized_ink_minus_exclusive_candidate_union",
            "coverage_legend": {"red": "exclusive_candidate", "orange": "exact_residual_including_collisions"},
            "top_margin_ordering_authority": "directed_source_to_upright_transform",
            "proposal_boxes_used_for_normalization": False,
        })

        outputs = []
        for path in sorted(temporary.rglob("*")):
            if path.is_file() and path.name != "manifest.json":
                outputs.append(_output_meta(temporary, path, "hash_bound_adapter_output"))
        manifest = {
            "schema_version": MANIFEST_VERSION,
            "trial_id": state["trial_id"],
            "page_id": state["page_id"],
            "warnings": [MASK_WARNING, COLLISION_WARNING],
            "inputs": {
                "state": {"file_sha256": sha256_file(state_path), "state_sha256": state["state_sha256"], "schema_version": state["schema_version"]},
                "decision": {"file_sha256": sha256_file(decision_path), "canonical_sha256": canonical_hash(decision)},
                "public_packet": {"file_sha256": sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
                "source": {"file_sha256": sha256_file(source_path), "size": state["source"]["size"]},
                "full_source_ink_mask": {"file_sha256": sha256_file(ink_mask_path), "size": state["source"]["size"]},
                "ink_proposal_pixel_sha256": mask_pixel_hash(ink),
            },
            "summary": {
                "line_count": len(state["lines"]),
                "unit_count": len(units),
                "ink_pixels": int(ink.sum()),
                "exclusive_candidate_union_pixels": int(exclusive_union.sum()),
                "collision_pixels": int(collisions.sum()),
                "exact_residual_pixels": int(residual.sum()),
            },
            "outputs": outputs,
        }
        manifest["manifest_sha256"] = canonical_hash(manifest)
        manifest_path = temporary / "manifest.json"
        _write_json(manifest_path, manifest)
        temporary.rename(output_dir)
        return output_dir / "manifest.json"
    except BaseException:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--ink-mask", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        manifest = build(args.state, args.ink_mask, args.output_dir)
    except AdapterError as error:
        parser.error(str(error))
        return
    print(manifest)


if __name__ == "__main__":
    main()
