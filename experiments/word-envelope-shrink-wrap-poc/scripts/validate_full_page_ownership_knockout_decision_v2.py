#!/usr/bin/env python3
"""Fail-closed validator for page-complete pass-2 ownership adjudication.

Every software fact is re-read from hash-bound files.  A valid model decision
is machine-complete, but this validator never promotes it to production.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator
from PIL import Image
from skimage import measure


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schemas/full-page-ownership-knockout-decision-v2.schema.json"


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
    """Builder-compatible row-major, little-bit-order binary pixel hash."""
    binary = np.asarray(mask, dtype=bool)
    digest = hashlib.sha256()
    digest.update(
        f"{binary.shape[1]}x{binary.shape[0]}:row-major-bitpack-v1\n".encode()
    )
    digest.update(np.packbits(binary, axis=None, bitorder="little").tobytes())
    return digest.hexdigest()


def fail(message: str) -> None:
    raise RuntimeError(message)


def _load_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        fail(f"{label} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"{label} is not JSON: {error}")
    if not isinstance(value, dict):
        fail(f"{label} must be a JSON object")
    return value


def _canonical_claim(value: dict[str, Any], key: str, label: str) -> str:
    unsigned = dict(value)
    claim = unsigned.pop(key, None)
    if not isinstance(claim, str) or claim != canonical_hash(unsigned):
        fail(f"{label} has a stale {key}")
    return claim


def _safe_relative(value: str, label: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        fail(f"{label} is not a safe POSIX relative path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        fail(f"{label} is absolute or contains traversal")
    return relative


def _resolve_beneath(base: Path, value: str, label: str) -> Path:
    relative = _safe_relative(value, label)
    root = base.resolve()
    path = root.joinpath(*relative.parts).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        fail(f"{label} resolves outside its evidence root")
    if not path.is_file():
        fail(f"{label} is missing: {path}")
    return path


def _verify_file_ref(
    supplied: dict[str, Any], expected_path: str, expected_hash: str, actual_path: Path, label: str
) -> None:
    _safe_relative(str(supplied.get("path", "")), f"{label} attested path")
    if supplied.get("path") != expected_path:
        fail(f"{label} path does not bind the authoritative evidence")
    if supplied.get("file_sha256") != expected_hash:
        fail(f"{label} hash does not copy the authoritative binding")
    if sha256_file(actual_path) != expected_hash:
        fail(f"{label} current file hash changed")


def _inside_source(bbox: list[int], size: list[int], label: str) -> None:
    x, y, width, height = bbox
    source_width, source_height = size
    if x + width > source_width or y + height > source_height:
        fail(f"{label} leaves source bounds")


def _inside(container: list[int], subject: list[int]) -> bool:
    x, y, width, height = container
    sx, sy, sw, sh = subject
    return x <= sx and y <= sy and sx + sw <= x + width and sy + sh <= y + height


def _decode_binary_png(path: Path, expected_size: list[int], label: str) -> tuple[np.ndarray, dict[str, Any]]:
    with Image.open(path) as handle:
        if handle.format != "PNG":
            fail(f"{label} must be a PNG")
        if list(handle.size) != expected_size:
            fail(f"{label} dimensions do not match {expected_size}")
        if handle.mode == "1":
            binary = np.asarray(handle, dtype=bool)
        elif handle.mode == "L":
            values = np.asarray(handle, dtype=np.uint8)
            unique = set(int(item) for item in np.unique(values))
            if not unique.issubset({0, 255}):
                fail(f"{label} is not a strict binary 0/255 mask")
            binary = values == 255
        else:
            fail(f"{label} has non-binary image mode {handle.mode}")
    return binary, {
        "size": expected_size,
        "pixel_count": int(binary.sum()),
        "connected_component_count": int(measure.label(binary, connectivity=2).max()),
        "pixel_sha256": mask_pixel_hash(binary),
        "file_sha256": sha256_file(path),
    }


def _validate_schema(decision: dict[str, Any]) -> None:
    schema = _load_json(SCHEMA, "Pass-2 schema")
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(decision),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        detail = "\n".join(
            f"{list(error.absolute_path)}: {error.message}" for error in errors[:30]
        )
        fail(f"JSON Schema validation failed:\n{detail}")


def _validate_manifest_outputs(manifest_path: Path, manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    records = manifest.get("outputs")
    if not isinstance(records, list) or not records:
        fail("Knockout manifest outputs are missing")
    outputs: dict[str, dict[str, Any]] = {}
    for item in records:
        relative = item.get("path")
        claimed_hash = item.get("file_sha256")
        if not isinstance(relative, str) or relative in outputs:
            fail("Knockout manifest has a missing or duplicate output path")
        path = _resolve_beneath(manifest_path.parent, relative, f"manifest output {relative}")
        if not isinstance(claimed_hash, str) or sha256_file(path) != claimed_hash:
            fail(f"Knockout manifest output hash changed: {relative}")
        outputs[relative] = {**item, "absolute_path": path}
    return outputs


def _resolve_public_evidence(packet_path: Path, value: str, label: str) -> Path:
    relative = _safe_relative(value, label)
    # Generated packets use ROOT-relative artifact paths.  Synthetic and future
    # packets may use packet-relative evidence paths.  Both remain contained.
    bases = [ROOT, packet_path.parent]
    matches: list[Path] = []
    for base in bases:
        try:
            candidate = _resolve_beneath(base, str(relative), label)
        except RuntimeError:
            continue
        if candidate not in matches:
            matches.append(candidate)
    if len(matches) != 1:
        fail(f"{label} must resolve to exactly one contained evidence file")
    return matches[0]


def _bound_inputs(
    decision: dict[str, Any], pass1_path: Path, manifest_path: Path, packet_path: Path
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, dict[str, Any]]]:
    pass1 = _load_json(pass1_path, "Bound pass-1 decision")
    manifest = _load_json(manifest_path, "Bound knockout manifest")
    packet = _load_json(packet_path, "Bound public packet")
    if manifest.get("schema_version") != "full-page-ownership-knockout-manifest.v2":
        fail("Bound knockout manifest has an unexpected schema version")
    manifest_claim = _canonical_claim(manifest, "manifest_sha256", "Bound knockout manifest")
    packet_claim = _canonical_claim(packet, "packet_sha256", "Bound public packet")
    page_id = decision["page_id"]
    if page_id != pass1.get("page_id") or page_id != manifest.get("page_id") or page_id != packet.get("page_id"):
        fail("Decision, pass-1, knockout, and public packet page IDs must match")
    if decision["pass1_decision_file_sha256"] != sha256_file(pass1_path):
        fail("pass1_decision_file_sha256 does not bind the exact pass-1 decision file")
    if decision["pass1_decision_canonical_sha256"] != canonical_hash(pass1):
        fail("pass1_decision_canonical_sha256 does not bind the exact pass-1 decision")
    if decision["knockout_manifest_file_sha256"] != sha256_file(manifest_path):
        fail("knockout_manifest_file_sha256 does not bind the exact knockout manifest file")
    if decision["knockout_manifest_sha256"] != manifest_claim:
        fail("knockout_manifest_sha256 does not bind the manifest canonical hash")
    inputs = manifest.get("inputs", {})
    if inputs.get("decision", {}).get("file_sha256") != sha256_file(pass1_path) or inputs.get("decision", {}).get("canonical_sha256") != canonical_hash(pass1):
        fail("Knockout manifest was not built from this exact pass-1 decision")
    if inputs.get("validation", {}).get("status") != "pass":
        fail("Knockout manifest does not bind a passing pass-1 validation")
    if inputs.get("public_packet", {}).get("file_sha256") != sha256_file(packet_path) or inputs.get("public_packet", {}).get("packet_sha256") != packet_claim:
        fail("Knockout manifest does not bind this exact public packet")
    if pass1.get("public_packet_sha256") not in (None, sha256_file(packet_path)):
        fail("Pass-1 decision does not bind this exact public packet")
    source = packet.get("source", {})
    source_path = Path(str(source.get("path", "")))
    if not source_path.is_absolute() or not source_path.is_file():
        fail("Public packet source must be an existing absolute bound source")
    if sha256_file(source_path) != source.get("sha256") or decision["source_sha256"] != source.get("sha256"):
        fail("Bound source file hash changed or decision source hash is stale")
    with Image.open(source_path) as image:
        if list(image.size) != source.get("size"):
            fail("Bound source dimensions changed")
    if inputs.get("source", {}).get("file_sha256") != source.get("sha256") or inputs.get("source", {}).get("size") != source.get("size"):
        fail("Knockout manifest source binding disagrees with the public packet")
    outputs = _validate_manifest_outputs(manifest_path, manifest)
    return pass1, manifest, packet, outputs


def _required_output(outputs: dict[str, dict[str, Any]], relative: str) -> dict[str, Any]:
    if relative not in outputs:
        fail(f"Knockout manifest does not bind required output: {relative}")
    return outputs[relative]


def _expected_units(pass1: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    lines = pass1.get("lines")
    if not isinstance(lines, list) or not lines:
        fail("Bound pass-1 decision has no lines")
    unit_by_id: dict[str, dict[str, Any]] = {}
    for line in lines:
        for unit in line.get("visible_units", []):
            unit_id = unit.get("unit_id")
            if not isinstance(unit_id, str) or not unit_id or unit_id in unit_by_id:
                fail("Bound pass-1 unit IDs must be nonempty and page-unique")
            unit_by_id[unit_id] = {**unit, "line_id": line.get("line_id")}
    return lines, unit_by_id


def _selection_maps(
    selection: dict[str, Any], outputs: dict[str, dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    units = {item.get("unit_id"): item for item in selection.get("units", [])}
    if None in units or len(units) != len(selection.get("units", [])):
        fail("Selection record contains missing or duplicate unit IDs")
    components = {item.get("component_id"): item for item in selection.get("connected_components", [])}
    if None in components or len(components) != len(selection.get("connected_components", [])):
        fail("Selection record contains missing or duplicate component IDs")
    computed: dict[str, dict[str, Any]] = {}
    for unit_id, unit in units.items():
        mask = unit.get("candidate_owned_mask", {})
        relative = mask.get("path")
        output = _required_output(outputs, relative)
        if mask.get("file_sha256") != output.get("file_sha256"):
            fail(f"Candidate mask binding disagrees with manifest for {unit_id}")
        bbox = unit.get("bbox_source_xywh")
        if not isinstance(bbox, list) or len(bbox) != 4:
            fail(f"Selection unit {unit_id} has no candidate bbox")
        _, facts = _decode_binary_png(
            output["absolute_path"], [bbox[2], bbox[3]], f"candidate mask for {unit_id}"
        )
        if facts["file_sha256"] != output["file_sha256"]:
            fail(f"Candidate mask current file hash changed for {unit_id}")
        if facts["pixel_count"] != unit.get("exclusive_candidate_pixels"):
            fail(f"Candidate mask decoded pixel count disagrees for {unit_id}")
        if facts["pixel_sha256"] != unit.get("candidate_owned_mask_pixel_sha256"):
            fail(f"Candidate mask decoded pixel hash disagrees for {unit_id}")
        computed[unit_id] = {**facts, "path": relative}
    return units, components, computed


def _approval_is_legal(
    unit_id: str,
    pass1_unit: dict[str, Any],
    selected: dict[str, Any],
    components: dict[str, dict[str, Any]],
    computed: dict[str, Any],
    supplied: dict[str, Any],
) -> None:
    illegal: list[str] = []
    if pass1_unit.get("ownership_route") != "terra_box_mask":
        illegal.append("prior route is not routine terra_box_mask")
    if pass1_unit.get("risk_flags") not in (None, [], ["none"]):
        illegal.append("pass-1 risk flags are present")
    if selected.get("requires_agent_review") is not False:
        illegal.append("selection record requires agent review")
    if computed["pixel_count"] <= 0:
        illegal.append("candidate has zero decoded pixels")
    if int(selected.get("withheld_collision_pixels", 0)) != 0:
        illegal.append("candidate has withheld collision pixels")
    component_ids = selected.get("component_ids", [])
    if len(component_ids) != 1 or computed["connected_component_count"] != 1:
        illegal.append("fragmented or component-unbound candidate is non-routine")
    for component_id in component_ids:
        component = components.get(component_id)
        if component is None:
            illegal.append(f"selection refers to unknown component {component_id}")
        elif component.get("crosses_multiple_unit_boxes") or component.get("crosses_box_boundary_unit_ids"):
            illegal.append(f"component {component_id} crosses a boundary or multiple boxes")
    exact = {
        "path": computed["path"], "file_sha256": computed["file_sha256"],
        "pixel_sha256": computed["pixel_sha256"], "pixel_count": computed["pixel_count"],
    }
    for key, expected in exact.items():
        if supplied.get(key) != expected:
            illegal.append(f"approved mask {key} is not the exact decoded candidate")
    if illegal:
        fail(f"{unit_id} cannot approve candidate ownership: {'; '.join(illegal)}")


def _line_status(actions: list[str]) -> str:
    if "human_review" in actions:
        return "pending_human"
    if "sol_review" in actions:
        return "pending_sol"
    if "reopen_bbox" in actions:
        return "pending_reopen"
    return "routine_masks_approved_pending_production"


def _register_follow_up(
    follow_ups: dict[str, dict[str, Any]], follow_up: dict[str, Any], source_size: list[int], label: str
) -> None:
    _inside_source(follow_up["source_bbox_xywh"], source_size, f"{label} follow-up bbox")
    follow_up_id = follow_up["follow_up_id"]
    if follow_up_id in follow_ups and follow_ups[follow_up_id] != follow_up:
        fail(f"Follow-up ID {follow_up_id} is reused with conflicting instructions")
    follow_ups[follow_up_id] = follow_up


def _require_unit_action_shape(
    item: dict[str, Any], pass1_unit: dict[str, Any], source_size: list[int], follow_ups: dict[str, dict[str, Any]]
) -> None:
    unit_id, action = item["unit_id"], item["action"]
    has_mask, has_bbox = "approved_candidate_mask" in item, "reopen_bbox_source_xywh" in item
    has_escalation, has_follow = "escalation" in item, "follow_up" in item
    if action == "approve_candidate_mask":
        if not has_mask or has_bbox or has_escalation or has_follow:
            fail(f"{unit_id} approval must contain only an approved candidate mask")
    elif action == "reopen_bbox":
        if not has_bbox or has_mask or has_escalation or not has_follow:
            fail(f"{unit_id} reopen_bbox requires a structured follow-up and cannot approve/escalate")
        _inside_source(item["reopen_bbox_source_xywh"], source_size, f"{unit_id} reopened bbox")
        follow = item["follow_up"]
        if follow["action"] != "regenerate_unit_candidate" or follow.get("target_unit_id") != unit_id or follow.get("target_line_id") != pass1_unit["line_id"] or follow["source_bbox_xywh"] != item["reopen_bbox_source_xywh"] or "escalation" in follow:
            fail(f"{unit_id} reopen follow-up must regenerate this unit on this line and exact bbox")
        _register_follow_up(follow_ups, follow, source_size, unit_id)
    else:
        target = "sol" if action == "sol_review" else "human"
        if not has_escalation or has_mask or has_bbox or has_follow or item["escalation"].get("target") != target:
            fail(f"{unit_id} {action} must carry an explicit {target} escalation only")


def _component_inventory(mask: np.ndarray) -> list[dict[str, Any]]:
    labels = measure.label(mask, connectivity=2)
    result: list[dict[str, Any]] = []
    for region in measure.regionprops(labels):
        y0, x0, y1, x1 = region.bbox
        result.append({
            "component_id": f"C{int(region.label):06d}",
            "area_px": int(region.area),
            "bbox_source_xywh": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
        })
    return result


def _residual_universe(
    manifest: dict[str, Any], outputs: dict[str, dict[str, Any]], source_size: list[int]
) -> dict[str, dict[str, Any]]:
    record_output = _required_output(outputs, "residual-candidates/residual-candidates.json")
    record = _load_json(record_output["absolute_path"], "Residual component record")
    mask_output = _required_output(outputs, "masks/exact-candidate-residual.png")
    residual, facts = _decode_binary_png(mask_output["absolute_path"], source_size, "exact candidate residual mask")
    listed = list(record.get("candidates", [])) + list(record.get("excluded_components", []))
    ids = [item.get("component_id") for item in listed]
    if any(not isinstance(item, str) for item in ids) or len(ids) != len(set(ids)):
        fail("Residual candidates plus excluded_components have missing or duplicate IDs")
    computed_list = _component_inventory(residual)
    computed = {item["component_id"]: item for item in computed_list}
    listed_by_id = {item["component_id"]: item for item in listed}
    if set(computed) != set(listed_by_id):
        fail("Residual candidates plus excluded_components do not cover the exact residual mask")
    for component_id, expected in computed.items():
        supplied = listed_by_id[component_id]
        if supplied.get("bbox_source_xywh") != expected["bbox_source_xywh"] or int(supplied.get("area_px", -1)) != expected["area_px"]:
            fail(f"Residual component geometry disagrees with decoded mask: {component_id}")
    if record.get("candidate_count") not in (None, len(record.get("candidates", []))) or record.get("excluded_count") not in (None, len(record.get("excluded_components", []))):
        fail("Residual candidate/excluded summary counts are stale")
    if facts["pixel_count"] != sum(item["area_px"] for item in computed_list):
        fail("Residual connected components do not partition every decoded residual pixel")
    if manifest.get("summary", {}).get("residual_pixels") != facts["pixel_count"]:
        fail("Knockout manifest residual pixel summary is stale")
    return {
        component_id: {
            **computed[component_id],
            "inventory_class": "candidate" if supplied in record.get("candidates", []) else "excluded",
            "legacy_hint": "candidate" if supplied in record.get("candidates", []) else supplied.get("reason", "excluded_without_reason"),
        }
        for component_id, supplied in listed_by_id.items()
    }


def _validate_region_manifest(
    decision: dict[str, Any], region_manifest_path: Path, knockout_manifest_path: Path,
    packet_path: Path, universe: dict[str, dict[str, Any]], source_size: list[int]
) -> tuple[dict[str, dict[str, Any]], dict[str, set[str]]]:
    region_manifest = _load_json(region_manifest_path, "Residual review-region manifest")
    if region_manifest.get("schema_version") != "residual-review-regions.v2" or region_manifest.get("page_id") != decision["page_id"]:
        fail("Residual review-region manifest schema/page mismatch")
    region_claim = _canonical_claim(region_manifest, "manifest_sha256", "Residual review-region manifest")
    if decision["residual_region_manifest_file_sha256"] != sha256_file(region_manifest_path) or decision["residual_region_manifest_sha256"] != region_claim:
        fail("Decision does not bind the exact residual review-region manifest")
    inputs = region_manifest.get("inputs", {})
    if inputs.get("knockout_manifest", {}).get("file_sha256") != sha256_file(knockout_manifest_path) or inputs.get("knockout_manifest", {}).get("manifest_sha256") != decision["knockout_manifest_sha256"]:
        fail("Residual regions were not built from this exact knockout manifest")
    if inputs.get("public_packet", {}).get("file_sha256") != sha256_file(packet_path):
        fail("Residual regions were not built from this exact public packet")
    if inputs.get("source", {}).get("file_sha256") != decision["source_sha256"] or inputs.get("source", {}).get("size") != source_size:
        fail("Residual region source binding is stale")
    if region_manifest.get("component_count") != len(universe) or region_manifest.get("normalized_residual_pixel_count") != sum(item["area_px"] for item in universe.values()):
        fail("Residual region component/pixel totals are stale")
    if region_manifest.get("component_ids_canonical_sha256") != canonical_hash(sorted(universe)):
        fail("Residual region canonical component-ID binding is stale")
    regions: dict[str, dict[str, Any]] = {}
    component_regions: dict[str, set[str]] = {component_id: set() for component_id in universe}
    flattened: list[str] = []
    for region in region_manifest.get("regions", []):
        region_id = region.get("region_id")
        if not isinstance(region_id, str) or not region_id or region_id in regions:
            fail("Residual review-region IDs must be nonempty and unique")
        component_ids = region.get("component_ids", [])
        bboxes = region.get("component_bboxes_source_xywh", [])
        if region.get("component_count") != len(component_ids) or len(bboxes) != len(component_ids):
            fail(f"Residual region {region_id} aligned component arrays are stale")
        for component_id, bbox in zip(component_ids, bboxes, strict=True):
            if component_id not in universe or bbox != universe[component_id]["bbox_source_xywh"]:
                fail(f"Residual region {region_id} component binding is stale: {component_id}")
            if not _inside(region["bbox_source_xywh"], bbox):
                fail(f"Residual region {region_id} does not spatially contain {component_id}")
            component_regions[component_id].add(region_id)
        if region.get("component_area_px_total") != sum(universe[item]["area_px"] for item in component_ids):
            fail(f"Residual region {region_id} pixel total is stale")
        board = region.get("board", {})
        board_path = _resolve_beneath(region_manifest_path.parent, board.get("path", ""), f"region board {region_id}")
        if sha256_file(board_path) != board.get("file_sha256"):
            fail(f"Residual region board hash changed: {region_id}")
        regions[region_id] = region
        flattened.extend(component_ids)
    if len(flattened) != len(set(flattened)) or set(flattened) != set(universe):
        fail("Residual review regions do not partition the exact component universe once")
    if region_manifest.get("region_count") != len(regions):
        fail("Residual review-region count is stale")
    return regions, component_regions


def _validate_line_evidence(
    decision_lines: list[dict[str, Any]], packet: dict[str, Any], packet_path: Path,
    pass1_lines: list[dict[str, Any]], outputs: dict[str, dict[str, Any]]
) -> None:
    index_output = _required_output(outputs, "line-boards/index.json")
    index = _load_json(index_output["absolute_path"], "Line-board index")
    board_lines = {item.get("line_id"): item for item in index.get("lines", [])}
    packet_lines = {item.get("line_id"): item for item in packet.get("lines", [])}
    expected_ids = [item.get("line_id") for item in pass1_lines]
    if list(board_lines) != expected_ids or list(packet_lines) != expected_ids:
        fail("Line evidence indexes do not exactly match pass-1 line order")
    diagnostic_paths = {
        "exact_subtraction": "page-diagnostics/exact-candidate-mask-subtraction.png",
        "box_fill": "page-diagnostics/background-box-fill.png",
        "coverage_overlay": "page-diagnostics/coverage-overlay.png",
    }
    for actual in decision_lines:
        line_id = actual["line_id"]
        evidence = actual["inspection_evidence"]
        source_meta = packet_lines[line_id].get("evidence", {}).get("source_plain", {})
        source_path = _resolve_public_evidence(packet_path, source_meta.get("path", ""), f"source crop for {line_id}")
        _verify_file_ref(evidence["source_crop"], source_meta["path"], source_meta.get("sha256"), source_path, f"source crop for {line_id}")
        board_meta = board_lines[line_id].get("board", {})
        board_output = _required_output(outputs, board_meta.get("path"))
        if board_meta.get("file_sha256") != board_output.get("file_sha256"):
            fail(f"Line-board index hash is stale for {line_id}")
        _verify_file_ref(evidence["ownership_board"], board_meta["path"], board_meta["file_sha256"], board_output["absolute_path"], f"ownership board for {line_id}")
        for field, relative in diagnostic_paths.items():
            output = _required_output(outputs, relative)
            _verify_file_ref(evidence[field], relative, output["file_sha256"], output["absolute_path"], f"{field} for {line_id}")


def _validate_follow_evidence(follow_ups: dict[str, dict[str, Any]], group_ids: set[str]) -> None:
    for follow_up_id, follow in follow_ups.items():
        unknown = set(follow["evidence_group_ids"]) - group_ids
        if unknown:
            fail(f"Follow-up {follow_up_id} references unknown evidence groups: {sorted(unknown)}")


def validate(
    decision_path: Path, *, pass1_decision_path: Path, knockout_manifest_path: Path,
    public_packet_path: Path, residual_region_manifest_path: Path
) -> dict[str, Any]:
    decision = _load_json(decision_path, "Pass-2 decision")
    _validate_schema(decision)
    pass1, manifest, packet, outputs = _bound_inputs(
        decision, pass1_decision_path, knockout_manifest_path, public_packet_path
    )
    expected_lines, pass1_units = _expected_units(pass1)
    source_size = manifest["inputs"]["source"]["size"]
    selection_output = _required_output(outputs, "units/selection-records.json")
    selection = _load_json(selection_output["absolute_path"], "Knockout selection record")
    selected_units, components, computed_masks = _selection_maps(selection, outputs)
    if set(pass1_units) != set(selected_units):
        fail("Pass-1 visible units and selection-record units are not exactly the same")
    universe = _residual_universe(manifest, outputs, source_size)
    regions, component_regions = _validate_region_manifest(
        decision, residual_region_manifest_path, knockout_manifest_path,
        public_packet_path, universe, source_size
    )

    actual_lines = decision["lines"]
    if [line["line_id"] for line in actual_lines] != [line.get("line_id") for line in expected_lines]:
        fail("Pass-2 line IDs are missing, duplicated, or out of supervisor order")
    if [line["line_reading_order"] for line in actual_lines] != list(range(1, len(expected_lines) + 1)):
        fail("Pass-2 line_reading_order is not the exact supervisor sequence")
    _validate_line_evidence(actual_lines, packet, public_packet_path, expected_lines, outputs)

    seen_units: set[str] = set()
    decision_by_unit: dict[str, dict[str, Any]] = {}
    action_counts: Counter[str] = Counter()
    follow_ups: dict[str, dict[str, Any]] = {}
    for expected_line, actual_line in zip(expected_lines, actual_lines, strict=True):
        expected_ids = [unit["unit_id"] for unit in expected_line.get("visible_units", [])]
        got_ids = [item["unit_id"] for item in actual_line["unit_decisions"]]
        if got_ids != expected_ids:
            fail(f"Unit decisions for {actual_line['line_id']} must exactly replay pass-1 unit order")
        actions: list[str] = []
        for item in actual_line["unit_decisions"]:
            unit_id = item["unit_id"]
            if unit_id in seen_units:
                fail(f"Unit {unit_id} is adjudicated more than once")
            seen_units.add(unit_id)
            decision_by_unit[unit_id] = item
            _require_unit_action_shape(item, pass1_units[unit_id], source_size, follow_ups)
            action = item["action"]
            actions.append(action)
            action_counts[action] += 1
            if action == "approve_candidate_mask":
                _approval_is_legal(
                    unit_id, pass1_units[unit_id], selected_units[unit_id],
                    components, computed_masks[unit_id], item["approved_candidate_mask"]
                )
        expected_status = _line_status(actions)
        if actual_line["line_status"] != expected_status:
            fail(f"line_status for {actual_line['line_id']} must be {expected_status}")
    if set(decision_by_unit) != set(pass1_units):
        fail("Every pass-1 visible unit must be adjudicated exactly once")

    group_by_id: dict[str, dict[str, Any]] = {}
    claimed_components: Counter[str] = Counter()
    cited_regions: Counter[str] = Counter()
    route_actions: list[str] = list(action_counts.elements())
    for group in decision["residual_groups"]:
        group_id = group["group_id"]
        if group_id in group_by_id:
            fail(f"Residual group ID is duplicated: {group_id}")
        group_by_id[group_id] = group
        _inside_source(group["bbox_source_xywh"], source_size, f"Residual group {group_id}")
        source_regions = group["source_region_ids"]
        unknown_regions = set(source_regions) - set(regions)
        if unknown_regions:
            fail(f"Residual group {group_id} cites unknown review regions: {sorted(unknown_regions)}")
        allowed_components = {
            component_id for region_id in source_regions
            for component_id in regions[region_id]["component_ids"]
        }
        for region_id in source_regions:
            cited_regions[region_id] += 1
        selector = group["selector"]
        if "component_ids" in selector:
            component_ids = selector["component_ids"]
        else:
            maximum = selector["all_components_with_area_at_most_px"]
            if group["group_kind"] != "software_speck_group" or group["disposition"] != "software_speck_policy":
                fail(f"Residual group {group_id} automatic selector is not a software-speck policy")
            component_ids = sorted(
                component_id for component_id in allowed_components
                if universe[component_id]["area_px"] <= maximum
            )
            if not component_ids:
                fail(f"Software-speck policy {group_id} selects no components")
        if not set(component_ids).issubset(allowed_components):
            fail(f"Residual group {group_id} selects components outside its cited review regions")
        for component_id in component_ids:
            if component_id not in universe:
                fail(f"Residual group {group_id} references unknown component {component_id}")
            if not _inside(group["bbox_source_xywh"], universe[component_id]["bbox_source_xywh"]):
                fail(f"Residual group {group_id} does not spatially contain {component_id}")
            claimed_components[component_id] += 1

        kind, disposition = group["group_kind"], group["disposition"]
        if kind == "likely_missing_word" and disposition != "add_missing_word_candidate":
            fail(f"Likely missing-word group {group_id} must create a missing-word candidate")
        if kind == "detached_target_ink" and disposition not in ("reopen_existing_unit", "sol_review", "human_review"):
            fail(f"Detached target ink group {group_id} must reopen or escalate")
        if kind == "non_text_artifact" and disposition not in ("non_text_keep_residual", "sol_review", "human_review"):
            fail(f"Non-text group {group_id} must remain residual or escalate")
        if kind == "non_text_artifact" and disposition == "non_text_keep_residual" and decision["model_tier"] != "sol":
            fail(f"Terra cannot terminally dismiss non-speck residual group {group_id} as non-text")
        if kind == "unresolved_ink" and disposition not in ("sol_review", "human_review"):
            fail(f"Unresolved residual group {group_id} must route to Sol or human")
        if kind == "software_speck_group":
            limit = group.get("software_speck_max_area_px")
            allowed_hints = {"small_speck_below_area_filter", "review_hint_tiny_component"}
            if (
                disposition != "software_speck_policy" or limit is None
                or any(universe[item]["area_px"] > limit for item in component_ids)
                or any(universe[item]["inventory_class"] != "excluded" for item in component_ids)
                or any(universe[item]["legacy_hint"] not in allowed_hints for item in component_ids)
            ):
                fail(f"Software-speck group {group_id} exceeds its bounded area policy")
        if disposition in ("sol_review", "human_review"):
            target = "sol" if disposition == "sol_review" else "human"
            if group.get("escalation", {}).get("target") != target:
                fail(f"Residual group {group_id} lacks explicit {target} escalation")
            route_actions.append(disposition)
        elif disposition == "reopen_existing_unit":
            target = group.get("target_unit_id")
            if target not in decision_by_unit or decision_by_unit[target]["action"] != "reopen_bbox":
                fail(f"Residual group {group_id} must link to a unit reopened in this decision")
            route_actions.append("reopen_bbox")
        elif disposition == "add_missing_word_candidate" and not group.get("missing_word_candidate_ids"):
            fail(f"Missing-word residual group {group_id} must name its candidate")

    missing_components = sorted(set(universe) - set(claimed_components))
    duplicated_components = sorted(item for item, count in claimed_components.items() if count != 1)
    if missing_components or duplicated_components:
        fail("Every residual component, including legacy exclusions, must be covered exactly once; "
             f"missing={missing_components[:20]}, duplicate={duplicated_components[:20]}")
    uncited_regions = sorted(set(regions) - set(cited_regions))
    if uncited_regions:
        fail(f"Every software review region must be cited by a decision group: {uncited_regions}")

    valid_line_ids = {line["line_id"] for line in actual_lines}
    missing_ids: set[str] = set()
    for candidate in decision["missing_word_candidates"]:
        candidate_id = candidate["candidate_id"]
        if candidate_id in missing_ids:
            fail(f"Missing-word candidate ID is duplicated: {candidate_id}")
        missing_ids.add(candidate_id)
        _inside_source(candidate["source_bbox_xywh"], source_size, f"Missing-word candidate {candidate_id}")
        for group_id in candidate["origin_group_ids"]:
            group = group_by_id.get(group_id)
            if group is None or group["disposition"] != "add_missing_word_candidate" or candidate_id not in group.get("missing_word_candidate_ids", []):
                fail(f"Missing-word candidate {candidate_id} is not linked to its evidence group")
        follow = candidate["follow_up"]
        if set(follow["evidence_group_ids"]) != set(candidate["origin_group_ids"]) or follow["source_bbox_xywh"] != candidate["source_bbox_xywh"] or follow.get("target_line_id") not in valid_line_ids or "target_unit_id" in follow:
            fail(f"Missing-word candidate {candidate_id} follow-up has stale evidence/geometry/target")
        if candidate["route"] == "reopen_bbox":
            if follow["action"] != "create_unit_candidate" or "escalation" in follow:
                fail(f"Missing-word candidate {candidate_id} reopen route must create a unit candidate")
        else:
            target = "sol" if candidate["route"] == "sol_review" else "human"
            if follow["action"] != candidate["route"] or follow.get("escalation", {}).get("target") != target:
                fail(f"Missing-word candidate {candidate_id} lacks structured {target} escalation")
        _register_follow_up(follow_ups, follow, source_size, candidate_id)
        route_actions.append(candidate["route"])
    for group in decision["residual_groups"]:
        if group["disposition"] == "add_missing_word_candidate":
            expected = set(group.get("missing_word_candidate_ids", []))
            actual = {item["candidate_id"] for item in decision["missing_word_candidates"] if group["group_id"] in item["origin_group_ids"]}
            if expected != actual:
                fail(f"Missing-word group {group['group_id']} does not have exact candidate linkage")

    reopening_ids: set[str] = set()
    for reopening in decision["detached_target_ink_reopenings"]:
        reopening_id, unit_id = reopening["reopening_id"], reopening["unit_id"]
        if reopening_id in reopening_ids:
            fail(f"Detached reopening ID is duplicated: {reopening_id}")
        reopening_ids.add(reopening_id)
        if unit_id not in decision_by_unit:
            fail(f"Detached reopening {reopening_id} names unknown unit {unit_id}")
        _inside_source(reopening["source_bbox_xywh"], source_size, f"Detached reopening {reopening_id}")
        unit_action = decision_by_unit[unit_id]["action"]
        if unit_action != reopening["route"]:
            fail(f"Detached reopening {reopening_id} route differs from unit action")
        origin_groups = [group_by_id.get(group_id) for group_id in reopening["origin_group_ids"]]
        if any(group is None or group["group_kind"] != "detached_target_ink" or group.get("target_unit_id") != unit_id for group in origin_groups):
            fail(f"Detached reopening {reopening_id} is not linked to target-ink groups for its unit")
        expected_disposition = "reopen_existing_unit" if reopening["route"] == "reopen_bbox" else reopening["route"]
        if any(group["disposition"] != expected_disposition or not _inside(reopening["source_bbox_xywh"], group["bbox_source_xywh"]) for group in origin_groups):
            fail(f"Detached reopening {reopening_id} route or spatial containment disagrees with its groups")
        follow = reopening["follow_up"]
        if set(follow["evidence_group_ids"]) != set(reopening["origin_group_ids"]) or follow["source_bbox_xywh"] != reopening["source_bbox_xywh"] or follow.get("target_unit_id") != unit_id or follow.get("target_line_id") != pass1_units[unit_id]["line_id"]:
            fail(f"Detached reopening {reopening_id} follow-up linkage is stale")
        if reopening["route"] == "reopen_bbox":
            unit_follow = decision_by_unit[unit_id]["follow_up"]
            if follow != unit_follow or follow["action"] != "regenerate_unit_candidate":
                fail(f"Detached reopening {reopening_id} must reuse the unit's regenerate follow-up")
        else:
            target = "sol" if reopening["route"] == "sol_review" else "human"
            if follow["action"] != reopening["route"] or follow.get("escalation", {}).get("target") != target:
                fail(f"Detached reopening {reopening_id} lacks structured {target} follow-up")
        _register_follow_up(follow_ups, follow, source_size, reopening_id)
        route_actions.append(reopening["route"])
    for group in decision["residual_groups"]:
        if group["group_kind"] == "detached_target_ink":
            matching = [item for item in decision["detached_target_ink_reopenings"] if group["group_id"] in item["origin_group_ids"]]
            if len(matching) != 1:
                fail(f"Detached target-ink group {group['group_id']} needs exactly one reopening record")

    _validate_follow_evidence(follow_ups, set(group_by_id))
    if "human_review" in route_actions:
        derived_reason = "pending_human_review"
    elif "sol_review" in route_actions:
        derived_reason = "pending_sol_review"
    elif "reopen_bbox" in route_actions:
        derived_reason = "pending_bbox_reopen"
    else:
        derived_reason = "pending_production_gate"
    if decision["production_pending_reason"] != derived_reason:
        fail(f"production_pending_reason must be {derived_reason}; completion is fail-closed")

    result: dict[str, Any] = {
        "schema_version": "full-page-ownership-knockout-validation.v2",
        "trial_id": decision["trial_id"], "page_id": decision["page_id"],
        "status": "pass", "machine_status": "machine_complete",
        "production_status": "not_production_complete",
        "production_pending_reason": derived_reason,
        "decision_file_sha256": sha256_file(decision_path),
        "decision_canonical_sha256": canonical_hash(decision),
        "pass1_decision_file_sha256": decision["pass1_decision_file_sha256"],
        "knockout_manifest_file_sha256": decision["knockout_manifest_file_sha256"],
        "residual_region_manifest_file_sha256": decision["residual_region_manifest_file_sha256"],
        "unit_count": len(pass1_units), "residual_component_count": len(universe),
        "residual_region_count": len(regions), "follow_up_count": len(follow_ups),
        "action_counts": dict(sorted(action_counts.items())),
        "invariants": {
            "exact_input_and_evidence_hashes_current": True,
            "candidate_pngs_independently_decoded": True,
            "pass1_units_accounted_exactly_once": True,
            "approvals_are_exact_safe_single_component_masks": True,
            "all_required_line_views_attested_and_current": True,
            "residual_mask_independently_relabelled": True,
            "candidate_and_legacy_excluded_residuals_accounted_once": True,
            "software_regions_reviewed_and_components_partitioned": True,
            "reopen_and_missing_word_follow_ups_terminal": True,
            "model_proposals_not_software_facts": True,
            "machine_complete_but_not_production_complete": True,
        },
    }
    result["validation_sha256"] = canonical_hash(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("decision_path", type=Path)
    parser.add_argument("--pass1-decision", required=True, type=Path)
    parser.add_argument("--knockout-manifest", required=True, type=Path)
    parser.add_argument("--public-packet", required=True, type=Path)
    parser.add_argument("--residual-region-manifest", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate(
        args.decision_path,
        pass1_decision_path=args.pass1_decision,
        knockout_manifest_path=args.knockout_manifest,
        public_packet_path=args.public_packet,
        residual_region_manifest_path=args.residual_region_manifest,
    )
    output = args.output or args.decision_path.with_name("validation.json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
