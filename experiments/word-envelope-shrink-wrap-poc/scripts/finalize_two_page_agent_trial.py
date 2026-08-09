#!/usr/bin/env python3
"""Bind the two-page agent trial into immutable reviewed candidate records.

This intentionally separates three questions:

1. Does a rectangle plausibly contain one complete visible unit?
2. Is the transcript-to-ink alignment trustworthy?
3. Did deterministic envelope replay accept a shrink-wrap polygon?

The output is an audit package, not production ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
TRIAL = ROOT / "artifacts/full-page-agent-trial-v1"
OUTPUT = TRIAL / "final-integrated"

STAGE_11_007 = (
    TRIAL
    / "worker/stage-11-transcript-bound-007-final/007-p02/semantic-page-record.json"
)
SPECIALIST_007 = (
    TRIAL
    / "sol-escalation/main-body-specialist-v1/007-p02/specialist-box-record.json"
)
V6_007 = TRIAL / "sol-escalation/corrected-v6-007/007-p02/page-record.json"
XHIGH_007_V1 = TRIAL / "sol-xhigh-lower-island/page-record.json"
REVIEW_MANIFEST_007 = (
    TRIAL
    / "integration/stage-12-serial-line-review/007-p02/line-review-manifest.json"
)
REVIEW_DECISIONS_007 = (
    TRIAL
    / "integration/stage-12-serial-line-review/007-p02/box-review-decisions.json"
)

CANONICAL_014 = TRIAL / "sol-escalation/corrected-v2/014-p04/page-record.json"
REVIEW_MANIFEST_014 = (
    TRIAL / "integration/014-semantic-line-review/014-p04/review-manifest.json"
)
REVIEW_DECISIONS_014 = (
    TRIAL / "integration/014-semantic-line-review/014-p04/review-decisions.json"
)

OBSERVER_AUDIT = TRIAL / "observer/coverage-risk-audit.json"
OBSERVER_PAIN_POINTS = TRIAL / "observer/pain-points.json"

REVIEWED_TERRA_LINES_007 = {
    "body-01",
    "body-02",
    "body-08",
    "body-11",
    "body-12",
    "body-13",
}
SPECIALIST_LINES_007 = {"body-03", "body-04", "body-05", "body-07"}
KNOWN_TRANSCRIPT_MISMATCH_LINES_007 = {
    "body-06",
    "body-09",
    "body-10",
    "body-14",
}

STATUS_COLORS = {
    "reviewed_candidate": "#00a46c",
    "specialist_reviewed_candidate": "#00a6c8",
    "specialist_candidate": "#e58b13",
    "hint_assisted_candidate": "#e58b13",
    "blind_xhigh_candidate": "#e58b13",
    "known_transcript_mismatch": "#d62f2f",
    "human_review_required": "#b020c0",
    "needs_specialist": "#b020c0",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT.resolve()))


def file_binding(path: Path) -> dict:
    return {"path": relative(path), "sha256": sha256_file(path)}


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


def polygon_status(unit: dict) -> tuple[str, list[list[float]] | None]:
    polygon = unit.get("source_envelope_polygon")
    replay = unit.get("envelope_replay") or {}
    if polygon and (not replay or replay.get("status") == "pass"):
        return "accepted", polygon
    return "deferred", None


def normalize_unit(
    source: dict,
    *,
    status: str,
    status_reason: str,
    provenance: dict,
    unit_id: str | None = None,
    transcript: str | None = None,
    bbox: list[int] | None = None,
    line_id: str | None = None,
    stream_id: str | None = None,
    unit_type: str | None = None,
    confidence: float | None = None,
    flags: Iterable[str] = (),
) -> dict:
    bubble_status, polygon = polygon_status(source)
    resolved_bbox = bbox or source.get("source_axis_aligned_bbox_xywh") or source.get(
        "bbox_xywh"
    )
    if resolved_bbox is None:
        raise ValueError(f"No source bbox for {source.get('id')}")
    resolved_transcript = transcript
    if resolved_transcript is None:
        resolved_transcript = source.get("transcript", source.get("text"))
    resolved_flags = sorted(
        set(source.get("flags", []))
        | set(source.get("review_flags", []))
        | set(flags)
    )
    return {
        "id": unit_id or source["id"],
        "transcript": resolved_transcript,
        "unit_type": unit_type
        or source.get("unit_type")
        or source.get("annotation_type")
        or "word_or_punctuation",
        "stream_id": stream_id or source.get("stream_id", "unknown"),
        "line_id": line_id
        or source.get("line_id")
        or source.get("line_island_id")
        or source.get("line_or_island_id")
        or "unknown",
        "source_axis_aligned_bbox_xywh": [int(round(value)) for value in resolved_bbox],
        "confidence": confidence
        if confidence is not None
        else source.get("confidence"),
        "word_box_status": status,
        "status_reason": status_reason,
        "bubble_status": bubble_status,
        "source_envelope_polygon": polygon,
        "flags": resolved_flags,
        "provenance": provenance,
    }


def flatten_units(record: dict) -> list[dict]:
    if isinstance(record.get("tokens"), list):
        return list(record["tokens"])
    if isinstance(record.get("units"), list):
        return list(record["units"])
    flattened = []
    for line in record.get("lines", []):
        for unit in line.get("units", line.get("tokens", [])):
            merged = dict(unit)
            merged.setdefault("line_id", line.get("line_id"))
            flattened.append(merged)
    return flattened


def validate_007_review_binding(manifest: dict, decisions: dict) -> dict:
    manifest_lines = {item["line_id"]: item for item in manifest["line_records"]}
    decision_lines = {item["line_id"]: item for item in decisions["line_decisions"]}
    board_mismatches = []
    geometry_mismatches = []
    transcript_mismatches = []
    for line_id, manifest_line in manifest_lines.items():
        decision = decision_lines.get(line_id)
        if decision is None:
            board_mismatches.append(line_id)
            continue
        if decision["review_board_sha256"] != manifest_line["review_board"]["sha256"]:
            board_mismatches.append(line_id)
        if decision["unit_geometry_sha256"] != manifest_line["unit_geometry_sha256"]:
            geometry_mismatches.append(line_id)
        if decision["exact_line_transcript"] != manifest_line["exact_line_transcript"]:
            transcript_mismatches.append(line_id)
    missing_manifest_lines = sorted(set(decision_lines) - set(manifest_lines))
    result = {
        "manifest_line_count": len(manifest_lines),
        "decision_line_count": len(decision_lines),
        "board_hash_mismatches": board_mismatches,
        "geometry_hash_mismatches": geometry_mismatches,
        "transcript_mismatches": transcript_mismatches,
        "decisions_without_manifest_line": missing_manifest_lines,
    }
    result["status"] = (
        "pass"
        if not any(
            result[key]
            for key in (
                "board_hash_mismatches",
                "geometry_hash_mismatches",
                "transcript_mismatches",
                "decisions_without_manifest_line",
            )
        )
        and len(manifest_lines) == len(decision_lines) == 14
        else "fail"
    )
    return result


def validate_014_review_binding(manifest: dict, decisions: dict) -> dict:
    manifest_boards = {item["board_id"]: item for item in manifest["boards"]}
    decision_boards = {item["board_id"]: item for item in decisions["boards"]}
    board_mismatches = []
    geometry_mismatches = []
    for board_id, manifest_board in manifest_boards.items():
        decision = decision_boards.get(board_id)
        if decision is None:
            board_mismatches.append(board_id)
            continue
        if decision["review_board_sha256"] != manifest_board["review_board"]["sha256"]:
            board_mismatches.append(board_id)
        if decision["unit_geometry_sha256"] != manifest_board["unit_geometry_sha256"]:
            geometry_mismatches.append(board_id)
    missing_manifest_boards = sorted(set(decision_boards) - set(manifest_boards))
    result = {
        "manifest_board_count": len(manifest_boards),
        "decision_board_count": len(decision_boards),
        "board_hash_mismatches": board_mismatches,
        "geometry_hash_mismatches": geometry_mismatches,
        "decisions_without_manifest_board": missing_manifest_boards,
        "declared_binding_validation": decisions.get("binding_validation"),
    }
    result["status"] = (
        "pass"
        if not board_mismatches
        and not geometry_mismatches
        and not missing_manifest_boards
        and len(manifest_boards) == len(decision_boards) == 26
        else "fail"
    )
    return result


def make_007_record(xhigh_path: Path) -> dict:
    stage_11 = load_json(STAGE_11_007)
    specialist = load_json(SPECIALIST_007)
    v6 = load_json(V6_007)
    xhigh = load_json(xhigh_path)

    source = stage_11["source"]
    stage_units_by_line: dict[str, list[dict]] = {}
    for unit in stage_11["units"]:
        stage_units_by_line.setdefault(unit["line_island_id"], []).append(unit)
    for units in stage_units_by_line.values():
        units.sort(key=lambda item: item["reading_order"])

    specialist_units_by_line = {
        line["line_id"]: line["units"] for line in specialist["lines"]
    }
    normalized: list[dict] = []
    for line_record in stage_11["line_records"]:
        line_id = line_record["line_id"]
        if line_id in SPECIALIST_LINES_007 | {"body-09", "body-10"}:
            input_units = specialist_units_by_line[line_id]
            source_kind = "sol_specialist_repartition"
        else:
            input_units = stage_units_by_line[line_id]
            source_kind = "terra_transcript_bound"

        if line_id in REVIEWED_TERRA_LINES_007:
            status = "reviewed_candidate"
            reason = "Independent geometry review approved; sealed transcript audit found no contradiction."
        elif line_id in SPECIALIST_LINES_007:
            status = "specialist_reviewed_candidate"
            reason = "Sol specialist repartition visually checked after independent review rejected inherited geometry."
        elif line_id in KNOWN_TRANSCRIPT_MISMATCH_LINES_007:
            status = "known_transcript_mismatch"
            reason = "Post-freeze sealed audit contradicted the frozen transcript-to-ink alignment; human adjudication required."
        else:
            raise RuntimeError(f"Unresolved 007 main-body line status: {line_id}")

        for unit in input_units:
            normalized.append(
                normalize_unit(
                    unit,
                    status=status,
                    status_reason=reason,
                    provenance={
                        "geometry_source": source_kind,
                        "line_id": line_id,
                        "model": "terra" if source_kind.startswith("terra") else "sol",
                    },
                    line_id=line_id,
                    stream_id="main-body",
                    flags=(
                        ["sealed_transcript_alignment_conflict"]
                        if status == "known_transcript_mismatch"
                        else []
                    ),
                )
            )

    closing = [token for token in v6["tokens"] if token["stream_id"] == "closing-signature"]
    for token in closing:
        normalized.append(
            normalize_unit(
                token,
                status="specialist_candidate",
                status_reason="Sol high specialist candidate; visually plausible but not independently line-reviewed.",
                provenance={"geometry_source": "sol_high_corrected_v6", "model": "sol"},
                line_id=token["line_or_island_id"],
            )
        )

    xhigh_hint_assisted = xhigh_path.resolve() != XHIGH_007_V1.resolve()
    xhigh_status = "hint_assisted_candidate" if xhigh_hint_assisted else "blind_xhigh_candidate"
    for token in flatten_units(xhigh):
        normalized.append(
            normalize_unit(
                token,
                unit_id=f"007-p02-xhigh-{token['id']}",
                status=xhigh_status,
                status_reason=(
                    "Sol-xhigh post-freeze correction visually verified after a coverage hint."
                    if xhigh_hint_assisted
                    else "Blind Sol-xhigh candidate; post-freeze audit found a missing leading I and topology mismatch."
                ),
                provenance={
                    "geometry_source": "sol_xhigh_lower_island",
                    "model": "sol-xhigh",
                    "blind": not xhigh_hint_assisted,
                    "input_record": relative(xhigh_path),
                },
                transcript=token.get("text", token.get("transcript")),
                bbox=token.get("bbox_xywh") or token.get("source_axis_aligned_bbox_xywh"),
                line_id=token.get("line_id"),
                stream_id=token.get("stream_id"),
                confidence=token.get("confidence"),
                flags=["axis_aligned_box_on_oblique_text"],
            )
        )

    for index, unit in enumerate(normalized, start=1):
        unit["display_index"] = index

    signoff_words = [
        unit["transcript"].strip().lower()
        for unit in normalized
        if unit["stream_id"] == "ps-lower-signoff"
    ]
    limitations = [
        "The four red main-body lines have transcript-to-ink conflicts even where rectangles look clean.",
        "Shrink-wrap success is not semantic proof; only reviewed, transcript-consistent units count as accepted.",
        "Oblique lower-island annotations are axis-aligned rectangles and therefore include extra background.",
    ]
    if signoff_words != ["i", "love", "you"]:
        limitations.append(
            "The lower signoff is incomplete relative to the post-freeze audit: expected I / love / you."
        )

    counts = count_units(normalized)
    counts.update(
        {
            "main_body_units": sum(unit["stream_id"] == "main-body" for unit in normalized),
            "closing_signature_units": len(closing),
            "lower_island_units": len(flatten_units(xhigh)),
            "known_transcript_mismatch_units": sum(
                unit["word_box_status"] == "known_transcript_mismatch" for unit in normalized
            ),
            "reviewed_main_body_units_without_known_sealed_contradiction": sum(
                unit["stream_id"] == "main-body"
                and unit["word_box_status"]
                in {"reviewed_candidate", "specialist_reviewed_candidate"}
                for unit in normalized
            ),
        }
    )
    record = {
        "schema_version": "two-page-agent-trial.reviewed-candidate.v1",
        "page_id": "007-p02",
        "source": source,
        "scope": "all visible word/mark candidates on the selected page",
        "status": "candidate_annotations_not_ground_truth",
        "counts": counts,
        "known_limitations": limitations,
        "units": normalized,
    }
    record["record_sha256"] = canonical_sha256(record)
    return record


def specialist_014_map(path: Path | None) -> tuple[dict[str, dict], dict | None]:
    if path is None:
        return {}, None
    record = load_json(path)
    units = flatten_units(record)
    mapping = {unit["id"]: unit for unit in units}
    return mapping, record


def make_014_record(specialist_path: Path | None) -> dict:
    canonical = load_json(CANONICAL_014)
    review_manifest = load_json(REVIEW_MANIFEST_014)
    review_decisions = load_json(REVIEW_DECISIONS_014)
    specialist_by_id, specialist_record = specialist_014_map(specialist_path)

    board_for_unit = {}
    for board in review_manifest["boards"]:
        for geometry in board["unit_geometry"]:
            board_for_unit[geometry["id"]] = board["board_id"]
    decision_by_board = {item["board_id"]: item for item in review_decisions["boards"]}

    normalized = []
    specialist_replacements = 0
    for token in sorted(canonical["tokens"], key=lambda item: item["reading_order"]):
        board_id = board_for_unit[token["id"]]
        review_status = decision_by_board[board_id]["word_box_status"]
        replacement = specialist_by_id.get(token["id"])
        if review_status == "approved":
            source_token = token
            status = "reviewed_candidate"
            reason = "Independent geometry review approved the complete visible unit box."
            provenance = {
                "geometry_source": "sol_canonical_corrected_v2",
                "model": "sol",
                "review_board": board_id,
            }
        elif replacement is not None:
            source_token = dict(token)
            replacement_bbox = replacement.get("source_axis_aligned_bbox_xywh") or replacement.get(
                "bbox_xywh"
            )
            if replacement_bbox is None:
                raise RuntimeError(f"014 specialist replacement lacks bbox: {token['id']}")
            source_token["source_axis_aligned_bbox_xywh"] = replacement_bbox
            source_token["confidence"] = replacement.get(
                "confidence", source_token.get("confidence")
            )
            source_token["source_envelope_polygon"] = None
            source_token["envelope_replay"] = {"status": "not_attempted_after_repartition"}
            status = (
                "human_review_required"
                if replacement.get("status")
                in {
                    "human_review_required",
                    "needs_human",
                    "deferred",
                    "uncertain",
                }
                else "specialist_reviewed_candidate"
            )
            reason = (
                "Sol specialist repartition supplied after the aggregate vertical/signature board failed independent review."
                if status == "specialist_reviewed_candidate"
                else "Specialist could not establish separable word ownership; human review remains required."
            )
            provenance = {
                "geometry_source": "sol_014_specialist_v1",
                "model": "sol",
                "review_board": board_id,
                "input_record": relative(specialist_path),
                "specialist_status": replacement.get("status"),
                "specialist_ownership_note": replacement.get("ownership_note"),
            }
            specialist_replacements += 1
        else:
            source_token = token
            status = "needs_specialist"
            reason = "Independent review rejected the aggregate board; no specialist replacement was bound."
            provenance = {
                "geometry_source": "sol_canonical_corrected_v2",
                "model": "sol",
                "review_board": board_id,
            }
        normalized.append(
            normalize_unit(
                source_token,
                status=status,
                status_reason=reason,
                provenance=provenance,
                line_id=token["line_or_island_id"],
                stream_id=token["stream_id"],
                unit_type="word_or_punctuation",
            )
        )

    for index, unit in enumerate(normalized, start=1):
        unit["display_index"] = index

    counts = count_units(normalized)
    counts.update(
        {
            "canonical_units": len(canonical["tokens"]),
            "specialist_replacements": specialist_replacements,
            "shared_component_cut_flags": sum(
                "semantic_cut_through_shared_component" in token.get("flags", [])
                for token in canonical["tokens"]
            ),
        }
    )
    record = {
        "schema_version": "two-page-agent-trial.reviewed-candidate.v1",
        "page_id": "014-p04",
        "source": canonical["source"],
        "scope": "all visible word/mark candidates on the selected page",
        "status": "candidate_annotations_not_ground_truth",
        "counts": counts,
        "known_limitations": [
            "The 160 horizontal/closing boxes passed independent geometry review; transcription was not independently adjudicated.",
            "Nearly every canonical unit required a deterministic cut through a shared connected component, so topology alone cannot prove ownership.",
            "Any specialist vertical/signature replacement has no post-repartition shrink-wrap polygon yet.",
        ],
        "units": normalized,
    }
    if specialist_record is not None:
        record["specialist_record_summary"] = specialist_record.get(
            "summary", specialist_record.get("counts")
        )
    record["record_sha256"] = canonical_sha256(record)
    return record


def count_units(units: list[dict]) -> dict:
    statuses = Counter(unit["word_box_status"] for unit in units)
    bubbles = Counter(unit["bubble_status"] for unit in units)
    return {
        "total_units": len(units),
        "word_box_statuses": dict(sorted(statuses.items())),
        "bubble_statuses": dict(sorted(bubbles.items())),
        "geometry_reviewed_units": sum(
            unit["word_box_status"]
            in {"reviewed_candidate", "specialist_reviewed_candidate"}
            for unit in units
        ),
        "accepted_bubbles_on_geometry_reviewed_units": sum(
            unit["bubble_status"] == "accepted"
            and unit["word_box_status"]
            in {"reviewed_candidate", "specialist_reviewed_candidate"}
            for unit in units
        ),
    }


def validate_page(record: dict) -> dict:
    source_path = Path(record["source"]["path"])
    source_sha = sha256_file(source_path)
    with Image.open(source_path) as image:
        width, height = image.size
    ids = [unit["id"] for unit in record["units"]]
    bad_boxes = []
    for unit in record["units"]:
        x, y, box_width, box_height = unit["source_axis_aligned_bbox_xywh"]
        if (
            x < 0
            or y < 0
            or box_width <= 0
            or box_height <= 0
            or x + box_width > width
            or y + box_height > height
        ):
            bad_boxes.append({"id": unit["id"], "bbox_xywh": [x, y, box_width, box_height]})
    duplicate_ids = sorted(identifier for identifier, count in Counter(ids).items() if count > 1)
    result = {
        "source_size": [width, height],
        "expected_source_sha256": record["source"]["sha256"],
        "actual_source_sha256": source_sha,
        "source_hash_matches": source_sha == record["source"]["sha256"],
        "unit_count": len(record["units"]),
        "duplicate_ids": duplicate_ids,
        "out_of_bounds_or_nonpositive_boxes": bad_boxes,
        "record_internal_sha256_matches": canonical_sha256(
            {key: value for key, value in record.items() if key != "record_sha256"}
        )
        == record["record_sha256"],
    }
    result["status"] = (
        "pass"
        if result["source_hash_matches"]
        and not duplicate_ids
        and not bad_boxes
        and result["record_internal_sha256_matches"]
        else "fail"
    )
    return result


def boxes_overlap(first: list[int], second: list[int]) -> bool:
    first_x, first_y, first_width, first_height = first
    second_x, second_y, second_width, second_height = second
    return (
        max(first_x, second_x) < min(first_x + first_width, second_x + second_width)
        and max(first_y, second_y)
        < min(first_y + first_height, second_y + second_height)
    )


def validate_xhigh_package(xhigh_path: Path) -> dict:
    record = load_json(xhigh_path)
    tokens = sorted(flatten_units(record), key=lambda item: item.get("reading_order", 0))
    signoff = [
        token.get("text", token.get("transcript"))
        for token in tokens
        if token.get("stream_id") == "ps-lower-signoff"
    ]
    result = {
        "record_path": relative(xhigh_path),
        "record_file_sha256": sha256_file(xhigh_path),
        "source_hash_matches": record["source"]["sha256"]
        == "0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312",
        "unit_count": len(tokens),
        "line_count": len(record.get("lines", [])),
        "deferred_region_count": len(record.get("deferred_regions", [])),
        "signoff_transcript": signoff,
        "post_freeze_hint_assisted": xhigh_path.resolve() != XHIGH_007_V1.resolve(),
    }
    if result["post_freeze_hint_assisted"]:
        freeze_path = xhigh_path.parent / "FREEZE-MANIFEST.json"
        freeze = load_json(freeze_path)
        result["freeze_manifest"] = {
            "path": relative(freeze_path),
            "record_hash_matches": freeze["files"].get(xhigh_path.name)
            == result["record_file_sha256"],
            "preserved_v1_hash_matches": freeze["preserved_v1_record_sha256"]
            == sha256_file(XHIGH_007_V1),
            "status": freeze.get("status"),
        }
    else:
        result["freeze_manifest"] = None
    result["status"] = (
        "pass"
        if result["source_hash_matches"]
        and (
            not result["post_freeze_hint_assisted"]
            or (
                result["unit_count"] == 17
                and result["line_count"] == 6
                and result["deferred_region_count"] == 0
                and [str(value).lower() for value in signoff] == ["i", "love", "you"]
                and result["freeze_manifest"]["record_hash_matches"]
                and result["freeze_manifest"]["preserved_v1_hash_matches"]
            )
        )
        else "fail"
    )
    return result


def validate_014_specialist_package(path: Path | None) -> dict:
    if path is None:
        return {"status": "not_present"}
    record = load_json(path)
    units = flatten_units(record)
    canonical = load_json(CANONICAL_014)
    expected_units = [
        token
        for token in canonical["tokens"]
        if token["stream_id"] in {"top-margin", "signatures"}
    ]
    validation_path = path.parent / "validation-summary.json"
    declared = load_json(validation_path)
    overlap_pairs = []
    for index, first in enumerate(units):
        first_box = first.get("source_axis_aligned_bbox_xywh") or first.get("bbox_xywh")
        for second in units[index + 1 :]:
            second_box = second.get("source_axis_aligned_bbox_xywh") or second.get("bbox_xywh")
            if boxes_overlap(first_box, second_box):
                overlap_pairs.append([first["id"], second["id"]])
    statuses = Counter(unit.get("status") for unit in units)
    result = {
        "record_path": relative(path),
        "record_file_sha256": sha256_file(path),
        "declared_validation_path": relative(validation_path),
        "declared_validation_status": declared.get("overall_status"),
        "all_declared_checks_pass": all(declared.get("checks", {}).values()),
        "record_hash_matches_declared_validation": declared.get("specialist_record", {}).get(
            "sha256"
        )
        == sha256_file(path),
        "unit_count": len(units),
        "exact_expected_ids": {unit["id"] for unit in units}
        == {unit["id"] for unit in expected_units},
        "status_counts": dict(sorted(statuses.items(), key=lambda item: str(item[0]))),
        "overlap_pairs": overlap_pairs,
    }
    result["status"] = (
        "pass"
        if result["declared_validation_status"] == "pass"
        and result["all_declared_checks_pass"]
        and result["record_hash_matches_declared_validation"]
        and result["unit_count"] == 17
        and result["exact_expected_ids"]
        and statuses == Counter({"box_reviewed": 15, "needs_human": 2})
        and not overlap_pairs
        else "fail"
    )
    return result


def render_overlay(record: dict, destination: Path) -> None:
    source_path = Path(record["source"]["path"])
    with Image.open(source_path) as opened:
        source = opened.convert("RGB")
    target_width = min(1500, source.width)
    scale = target_width / source.width
    target_height = round(source.height * scale)
    image = source.resize((target_width, target_height), Image.Resampling.LANCZOS)
    source.close()

    header_height = 132
    board = Image.new("RGB", (target_width, target_height + header_height), "#f3efe6")
    board.paste(image, (0, header_height))
    image.close()
    draw = ImageDraw.Draw(board, "RGBA")
    draw.text(
        (16, 10),
        f"{record['page_id']} — agent word-box trial (candidate annotations, not ground truth)",
        fill="#111111",
        font=font(25),
    )
    status_counts = record["counts"]["word_box_statuses"]
    summary = "  |  ".join(f"{key}: {value}" for key, value in status_counts.items())
    draw.text((16, 44), summary, fill="#333333", font=font(15))
    legend = [
        ("#00a46c", "independently reviewed"),
        ("#00a6c8", "specialist reviewed"),
        ("#e58b13", "specialist candidate"),
        ("#d62f2f", "known transcript mismatch"),
        ("#b020c0", "human/specialist review"),
        ("#5a78ff", "accepted shrink-wrap fill"),
    ]
    x_cursor = 16
    for color, label in legend:
        draw.rectangle((x_cursor, 79, x_cursor + 16, 95), fill=color, outline="#ffffff")
        draw.text((x_cursor + 21, 77), label, fill="#222222", font=font(13))
        x_cursor += 21 + max(105, round(draw.textlength(label, font=font(13))))
        if x_cursor > target_width - 180:
            break
    draw.text(
        (16, 106),
        "Numbers map to units in page-record.json. Blue translucent polygons are deterministic envelopes.",
        fill="#444444",
        font=font(14),
    )

    for unit in record["units"]:
        polygon = unit.get("source_envelope_polygon")
        if polygon and unit["word_box_status"] in {
            "reviewed_candidate",
            "specialist_reviewed_candidate",
        }:
            points = [
                (round(x * scale), round(y * scale) + header_height) for x, y in polygon
            ]
            if len(points) >= 3:
                draw.polygon(points, fill=(90, 120, 255, 48), outline=(65, 90, 220, 170))

    line_width = max(2, round(4 * scale))
    label_font = font(max(10, round(17 * min(1.0, scale + 0.25))))
    for unit in record["units"]:
        x, y, width, height = unit["source_axis_aligned_bbox_xywh"]
        x0 = round(x * scale)
        y0 = round(y * scale) + header_height
        x1 = round((x + width) * scale)
        y1 = round((y + height) * scale) + header_height
        color = STATUS_COLORS.get(unit["word_box_status"], "#b020c0")
        draw.rectangle((x0, y0, x1, y1), outline=color, width=line_width)
        label = str(unit["display_index"])
        text_box = draw.textbbox((x0 + 1, y0 + 1), label, font=label_font, stroke_width=2)
        draw.rectangle(text_box, fill=(255, 255, 255, 210))
        draw.text(
            (x0 + 1, y0 + 1),
            label,
            fill=color,
            font=label_font,
            stroke_width=1,
            stroke_fill="#ffffff",
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="JPEG", quality=92, optimize=True)
    board.close()


def find_xhigh_record(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    candidates = [
        TRIAL / "sol-xhigh-lower-island-corrected-v2/page-record-corrected-v2.json",
        TRIAL / "sol-xhigh-lower-island/corrected-v2/page-record.json",
        TRIAL / "sol-xhigh-lower-island/corrected-v2-page-record.json",
        TRIAL / "sol-xhigh-lower-island/page-record-v2.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return XHIGH_007_V1


def find_014_specialist(explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit).resolve()
    root = TRIAL / "sol-escalation/014-specialist-v1"
    candidates = [
        root / "page-record.json",
        root / "specialist-box-record.json",
        root / "014-p04/page-record.json",
        root / "014-p04/specialist-box-record.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xhigh-record")
    parser.add_argument("--specialist-014-record")
    args = parser.parse_args()

    xhigh_path = find_xhigh_record(args.xhigh_record)
    specialist_014_path = find_014_specialist(args.specialist_014_record)

    required_inputs = [
        STAGE_11_007,
        SPECIALIST_007,
        V6_007,
        XHIGH_007_V1,
        xhigh_path,
        REVIEW_MANIFEST_007,
        REVIEW_DECISIONS_007,
        CANONICAL_014,
        REVIEW_MANIFEST_014,
        REVIEW_DECISIONS_014,
        OBSERVER_AUDIT,
        OBSERVER_PAIN_POINTS,
    ]
    if specialist_014_path is not None:
        required_inputs.append(specialist_014_path)
        specialist_validation = specialist_014_path.parent / "validation-summary.json"
        if specialist_validation.exists():
            required_inputs.append(specialist_validation)
    xhigh_freeze = xhigh_path.parent / "FREEZE-MANIFEST.json"
    if xhigh_path != XHIGH_007_V1 and xhigh_freeze.exists():
        required_inputs.append(xhigh_freeze)
    missing = [str(path) for path in required_inputs if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing trial inputs: {missing}")

    manifest_007 = load_json(REVIEW_MANIFEST_007)
    decisions_007 = load_json(REVIEW_DECISIONS_007)
    manifest_014 = load_json(REVIEW_MANIFEST_014)
    decisions_014 = load_json(REVIEW_DECISIONS_014)
    binding_007 = validate_007_review_binding(manifest_007, decisions_007)
    binding_014 = validate_014_review_binding(manifest_014, decisions_014)
    if binding_007["status"] != "pass" or binding_014["status"] != "pass":
        raise RuntimeError(
            f"Review binding failed: 007={binding_007['status']} 014={binding_014['status']}"
        )

    record_007 = make_007_record(xhigh_path)
    record_014 = make_014_record(specialist_014_path)
    validation_007 = validate_page(record_007)
    validation_014 = validate_page(record_014)
    xhigh_validation = validate_xhigh_package(xhigh_path)
    specialist_014_validation = validate_014_specialist_package(specialist_014_path)
    if (
        validation_007["status"] != "pass"
        or validation_014["status"] != "pass"
        or xhigh_validation["status"] != "pass"
        or specialist_014_validation["status"] not in {"pass", "not_present"}
    ):
        raise RuntimeError("Integrated page validation failed")

    path_007 = OUTPUT / "007-p02/page-record.json"
    path_014 = OUTPUT / "014-p04/page-record.json"
    write_json(path_007, record_007)
    write_json(path_014, record_014)
    render_overlay(record_007, OUTPUT / "007-p02/word-box-status.jpg")
    render_overlay(record_014, OUTPUT / "014-p04/word-box-status.jpg")

    validation = {
        "schema_version": "two-page-agent-trial.validation.v1",
        "status": "pass",
        "007-p02": validation_007,
        "014-p04": validation_014,
        "review_binding": {"007-p02": binding_007, "014-p04": binding_014},
        "specialist_packages": {
            "007-lower-island": xhigh_validation,
            "014-vertical-and-signatures": specialist_014_validation,
        },
    }
    write_json(OUTPUT / "validation.json", validation)

    inputs = {relative(path): file_binding(path) for path in required_inputs}
    reviewed_manifest = {
        "schema_version": "two-page-agent-trial.reviewed-manifest.v1",
        "status": "candidate_annotations_not_ground_truth",
        "immutability_policy": "Base agent and reviewer records were not mutated; this manifest binds their file hashes and resolved statuses.",
        "review_contract": {
            "word_box": "A plausible complete visible unit rectangle.",
            "transcript_alignment": "Separately rejectable even when box geometry looks clean.",
            "bubble": "Deterministic replay acceptance only; never semantic proof.",
        },
        "inputs": inputs,
        "outputs": {
            "007-p02": {**file_binding(path_007), "record_sha256": record_007["record_sha256"]},
            "014-p04": {**file_binding(path_014), "record_sha256": record_014["record_sha256"]},
        },
        "resolved_statuses": {
            "007-p02": record_007["counts"],
            "014-p04": record_014["counts"],
        },
        "validation": validation,
    }
    reviewed_manifest["manifest_sha256"] = canonical_sha256(reviewed_manifest)
    write_json(OUTPUT / "reviewed-manifest.json", reviewed_manifest)

    results = f"""# Two-page agent word-box trial

Status: **candidate annotations, not production ground truth**.

## 007-p02

- {record_007['counts']['total_units']} boxed units in the integrated record.
- {record_007['counts']['reviewed_main_body_units_without_known_sealed_contradiction']} main-body units are geometry-reviewed and free of a known sealed transcript contradiction.
- {record_007['counts']['known_transcript_mismatch_units']} units remain red because their line transcript-to-ink alignment is known to be wrong.
- {record_007['counts']['lower_island_units']} lower-island units came from the Sol-xhigh pass (`{'hint-assisted correction' if xhigh_path != XHIGH_007_V1 else 'blind v1'}`).
- {record_007['counts']['accepted_bubbles_on_geometry_reviewed_units']} deterministic shrink-wrap polygons survive on geometry-reviewed units; the rest remain box-only.

## 014-p04

- {record_014['counts']['total_units']} boxed units in the integrated record.
- {record_014['counts']['word_box_statuses'].get('reviewed_candidate', 0)} horizontal/closing units passed independent geometry review.
- {record_014['counts']['word_box_statuses'].get('specialist_reviewed_candidate', 0)} vertical/signature units passed focused specialist review; {record_014['counts']['word_box_statuses'].get('human_review_required', 0)} crossing-flourish signatures still need a person.
- {record_014['counts']['accepted_bubbles_on_geometry_reviewed_units']} deterministic shrink-wrap polygons survive after specialist repartition; the rest remain box-only.
- {record_014['counts']['shared_component_cut_flags']} canonical units cut through a shared connected component; topology therefore cannot prove ownership.

## What the observer found

The largest time loss came from operating on whole-page masks before transcript-to-ink alignment was stable. The highest-value software change is a hash-bound, many-to-many alignment graph reviewed on upright line/island boards before any bubble generation. This would catch omitted words, merged words, non-word marks, and transcript hallucinations before expensive ink cleanup.

Other concrete pain points:

- Whole-page component boards created hundreds of low-value crops and hit the memory guard; serial line/island boards were faster to judge.
- Rotation solved difficult vertical/sideways reading, but four 014 two-word rows were briefly reversed. Orientation-aware views need an explicit reading-direction check.
- A good rectangle and a successful shrink-wrap polygon are separate outcomes. Bubble failure must not erase a good box, and bubble success must not certify a bad transcript.
- Connected handwriting makes one-to-one token boxes impossible in places. The record must support many words to one ink group, one word to several polygons, punctuation-only units, and human review.
- Every edit/cut/select action needs before/after versions and hash-bound approval so the agent can compare alternatives without silently losing ink.

## Binding

`reviewed-manifest.json` hashes every base record, reviewer decision file, specialist record, observer audit, and final page record. The base artifacts remain untouched.
"""
    (OUTPUT / "RESULTS.md").write_text(results)

    print(
        json.dumps(
            {
                "status": "pass",
                "output": relative(OUTPUT),
                "007_units": record_007["counts"]["total_units"],
                "014_units": record_014["counts"]["total_units"],
                "xhigh_record": relative(xhigh_path),
                "specialist_014_record": (
                    relative(specialist_014_path) if specialist_014_path else None
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
