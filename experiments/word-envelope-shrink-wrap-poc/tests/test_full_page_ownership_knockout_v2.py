from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build_full_page_ownership_knockout_v2.py"
SPEC = importlib.util.spec_from_file_location("ownership_knockout_v2", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)

AUDIT_SCRIPT = ROOT / "scripts/validate_full_page_ownership_knockout_decision_v2.py"
AUDIT_SPEC = importlib.util.spec_from_file_location("ownership_knockout_audit_v2", AUDIT_SCRIPT)
assert AUDIT_SPEC is not None and AUDIT_SPEC.loader is not None
audit = importlib.util.module_from_spec(AUDIT_SPEC)
AUDIT_SPEC.loader.exec_module(audit)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def make_bound_inputs(
    root: Path,
    *,
    page_id: str = "007-p02",
    overlapping: bool = True,
) -> tuple[Path, Path, Path]:
    source_path = root / "source.png"
    image = Image.new("RGB", (100, 70), (225, 210, 180))
    draw = ImageDraw.Draw(image)
    draw.rectangle((15, 24, 60, 31), fill=(40, 70, 145))
    draw.rectangle((76, 48, 88, 54), fill=(40, 70, 145))
    draw.point((5, 5), fill=(40, 70, 145))  # deterministic small-speck removal
    image.save(source_path, format="PNG")

    boxes = [[10, 18, 38, 22], [30, 18, 38, 22]] if overlapping else [[10, 18, 20, 22], [40, 18, 28, 22]]
    mask_input = None
    if page_id == "014-p04":
        mask_input = root / "prior-mask.png"
        mask = Image.new("L", image.size, 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rectangle((15, 24, 60, 31), fill=255)
        mask_draw.rectangle((76, 48, 88, 54), fill=255)
        mask.save(mask_input, format="PNG")

    packet = {
        "schema_version": "test-packet",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "source": {
            "path": str(source_path),
            "sha256": builder.sha256_file(source_path),
            "size": [100, 70],
        },
        "page_run_order": 1 if page_id == "007-p02" else 2,
        "ink_mask_input": (
            {
                "path": str(mask_input),
                "sha256": builder.sha256_file(mask_input),
                "role": "prior_binary_ink_proposal_for_residual_diagnostics",
            }
            if mask_input
            else {"path": "ignored-for-007", "sha256": "0" * 64, "role": "ignored"}
        ),
        "lines": [
            {
                "line_id": "line-01",
                "box_proposals": [
                    {"proposal_id": "P01", "source_axis_aligned_bbox_xywh": boxes[0]},
                    {"proposal_id": "P02", "source_axis_aligned_bbox_xywh": boxes[1]},
                ],
                "evidence": {"source_crop_xyxy": [5, 8, 72, 45]},
            }
        ],
    }
    packet["packet_sha256"] = builder.canonical_hash(packet)
    packet_path = root / "run-packet.json"
    write_json(packet_path, packet)
    packet_file_sha256 = builder.sha256_file(packet_path)

    units = []
    for index, box in enumerate(boxes, start=1):
        units.append(
            {
                "unit_id": f"u-{index}",
                "reading_order": index,
                "bbox_source_xywh": box,
                "tentative_text": f"word{index}",
                "unit_kind": "word",
                "source_proposal_ids": [f"P0{index}"],
                "proposal_action": "accept",
                "alignment_status": "matched",
                "ownership_route": "terra_box_mask",
                "risk_flags": ["none"],
                "evidence_note": "synthetic visible unit",
            }
        )
    decision = {
        "schema_version": "full-page-supervisor-pass1-decision.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "page_run_order": packet["page_run_order"],
        "model_tier": "terra",
        "source_sha256": packet["source"]["sha256"],
        "public_packet_sha256": packet_file_sha256,
        "hidden_prior_answer_access": False,
        "lines": [
            {
                "line_id": "line-01",
                "line_reading_order": 1,
                "registration_status": "approved",
                "upright_rotation_degrees": 0,
                "directed_reading": "left_to_right",
                "context_status": "sufficient",
                "transcript_proposal_disposition": "accepted",
                "final_tentative_transcript": ["word1", "word2"],
                "visible_units": units,
                "dropped_proposals": [],
                "line_status": "ready_for_ownership",
                "line_evidence_note": "synthetic line",
            }
        ],
    }
    decision_path = root / "decisions.json"
    write_json(decision_path, decision)

    validation = {
        "schema_version": "full-page-supervisor-pass1-validation.v2",
        "trial_id": "full-page-supervisor-trial-v2",
        "page_id": page_id,
        "status": "pass",
        "source_sha256": packet["source"]["sha256"],
        "public_packet_sha256": packet_file_sha256,
        "public_packet_internal_sha256": packet["packet_sha256"],
        "decision_file_sha256": builder.sha256_file(decision_path),
        "decision_canonical_sha256": builder.canonical_hash(decision),
    }
    validation["validation_sha256"] = builder.canonical_hash(validation)
    validation_path = root / "validation.json"
    write_json(validation_path, validation)
    return decision_path, packet_path, validation_path


class FullPageOwnershipKnockoutTests(unittest.TestCase):
    def test_007_build_withholds_collisions_and_removes_small_blue_speck(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, packet, validation = make_bound_inputs(root)
            output = root / "out"

            manifest_path = builder.build(
                decision,
                packet_path=packet,
                validation_path=validation,
                output_dir=output,
            )

            manifest = json.loads(manifest_path.read_text())
            selections = json.loads((output / "units/selection-records.json").read_text())
            mask_record = json.loads((output / "masks/ink-proposal-record.json").read_text())
            self.assertEqual(manifest["summary"]["unit_count"], 2)
            self.assertGreater(manifest["summary"]["withheld_collided_pixels"], 0)
            self.assertGreater(len(selections["pixel_overlap_pairs"]), 0)
            self.assertGreater(selections["summary"]["multi_box_component_count"], 0)
            self.assertGreater(selections["summary"]["boundary_crossing_component_count"], 0)
            self.assertEqual(mask_record["method"], "explicit_blue_rgb_rule_v1")
            self.assertEqual(mask_record["small_speck_pixels_removed"], 1)
            self.assertEqual(mask_record["role"], "binary_ink_proposal_never_truth")

            collision = np.asarray(Image.open(output / "masks/withheld-collisions.png")) > 0
            candidate = np.asarray(Image.open(output / "masks/candidate-owned-union.png")) > 0
            residual = np.asarray(Image.open(output / "masks/exact-candidate-residual.png")) > 0
            self.assertFalse(np.any(collision & candidate))
            self.assertTrue(np.all(residual[collision]))
            self.assertTrue((output / "line-boards/line-01.png").is_file())
            self.assertTrue((output / "page-diagnostics/background-box-fill.png").is_file())
            self.assertTrue((output / "residual-candidates/residual-candidates.json").is_file())

    def test_014_explicitly_detects_and_normalizes_bright_foreground(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, packet, validation = make_bound_inputs(root, page_id="014-p04")
            output = root / "out"

            builder.build(
                decision,
                packet_path=packet,
                validation_path=validation,
                output_dir=output,
            )

            record = json.loads((output / "masks/ink-proposal-record.json").read_text())
            self.assertEqual(record["selected_polarity"], "bright_foreground")
            self.assertEqual(record["method"], "packet_bound_mask_explicit_otsu_polarity_v1")
            normalized = np.asarray(Image.open(output / "masks/ink-proposal.png")) > 0
            self.assertTrue(normalized[25, 20])
            self.assertFalse(normalized[0, 0])

    def test_rebuild_is_deterministic_in_two_output_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, packet, validation = make_bound_inputs(root)
            first = root / "first"
            second = root / "second"

            first_manifest = json.loads(
                builder.build(
                    decision,
                    packet_path=packet,
                    validation_path=validation,
                    output_dir=first,
                ).read_text()
            )
            second_manifest = json.loads(
                builder.build(
                    decision,
                    packet_path=packet,
                    validation_path=validation,
                    output_dir=second,
                ).read_text()
            )

            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(
                first_manifest["manifest_sha256"], second_manifest["manifest_sha256"]
            )

    def test_refuses_failed_or_stale_pass1_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, packet, validation_path = make_bound_inputs(root)
            validation = json.loads(validation_path.read_text())
            validation["status"] = "fail"
            validation.pop("validation_sha256")
            validation["validation_sha256"] = builder.canonical_hash(validation)
            write_json(validation_path, validation)
            with self.assertRaisesRegex(RuntimeError, "status must be exactly 'pass'"):
                builder.build(
                    decision,
                    packet_path=packet,
                    validation_path=validation_path,
                    output_dir=root / "failed",
                )

            decision, packet, validation_path = make_bound_inputs(root)
            stale = json.loads(decision.read_text())
            stale["model_tier"] = "sol"
            write_json(decision, stale)
            with self.assertRaisesRegex(RuntimeError, "decision_file_sha256"):
                builder.build(
                    decision,
                    packet_path=packet,
                    validation_path=validation_path,
                    output_dir=root / "stale",
                )


def write_audit_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def refresh_audit_bindings(root: Path) -> tuple[Path, Path, Path, Path, Path]:
    pass1_path = root / "pass1.json"
    packet_path = root / "public/run-packet.json"
    knockout_manifest_path = root / "knockout/manifest.json"
    region_manifest_path = root / "regions/manifest.json"
    decision_path = root / "pass2.json"
    pass1 = json.loads(pass1_path.read_text())
    packet = json.loads(packet_path.read_text())
    manifest = json.loads(knockout_manifest_path.read_text())
    manifest["inputs"]["decision"] = {
        "file_sha256": audit.sha256_file(pass1_path), "canonical_sha256": audit.canonical_hash(pass1)
    }
    manifest["inputs"]["public_packet"] = {
        "file_sha256": audit.sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]
    }
    for output in manifest["outputs"]:
        output["file_sha256"] = audit.sha256_file(knockout_manifest_path.parent / output["path"])
    manifest.pop("manifest_sha256", None)
    manifest["manifest_sha256"] = audit.canonical_hash(manifest)
    write_audit_json(knockout_manifest_path, manifest)
    region = json.loads(region_manifest_path.read_text())
    region["inputs"]["knockout_manifest"] = {
        "file_sha256": audit.sha256_file(knockout_manifest_path), "manifest_sha256": manifest["manifest_sha256"]
    }
    region["inputs"]["public_packet"] = {
        "file_sha256": audit.sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]
    }
    region["inputs"]["exact_residual_mask"]["file_sha256"] = audit.sha256_file(root / "knockout/masks/exact-candidate-residual.png")
    region["inputs"]["residual_component_record"]["file_sha256"] = audit.sha256_file(root / "knockout/residual-candidates/residual-candidates.json")
    region.pop("manifest_sha256", None)
    region["manifest_sha256"] = audit.canonical_hash(region)
    write_audit_json(region_manifest_path, region)
    decision = json.loads(decision_path.read_text())
    decision.update({
        "pass1_decision_file_sha256": audit.sha256_file(pass1_path),
        "pass1_decision_canonical_sha256": audit.canonical_hash(pass1),
        "knockout_manifest_file_sha256": audit.sha256_file(knockout_manifest_path),
        "knockout_manifest_sha256": manifest["manifest_sha256"],
        "residual_region_manifest_file_sha256": audit.sha256_file(region_manifest_path),
        "residual_region_manifest_sha256": region["manifest_sha256"],
    })
    write_audit_json(decision_path, decision)
    return decision_path, pass1_path, knockout_manifest_path, packet_path, region_manifest_path


def make_pass2_audit_fixture(root: Path) -> tuple[Path, Path, Path, Path, Path]:
    """Make a tiny fully bound packet, knockout, and residual-region package."""
    root.mkdir(parents=True, exist_ok=True)
    source_path = root / "source.png"
    Image.new("RGB", (100, 80), (230, 220, 195)).save(source_path, format="PNG")
    source_crop_path = root / "public/line-evidence/source.png"
    source_crop_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (80, 30), (230, 220, 195)).save(source_crop_path, format="PNG")
    packet = {
        "page_id": "007-p02",
        "source": {"path": str(source_path), "sha256": audit.sha256_file(source_path), "size": [100, 80]},
        "lines": [{"line_id": "line-01", "evidence": {"source_plain": {
            "path": "line-evidence/source.png", "sha256": audit.sha256_file(source_crop_path)
        }}}],
    }
    packet["packet_sha256"] = audit.canonical_hash(packet)
    packet_path = root / "public/run-packet.json"
    write_audit_json(packet_path, packet)
    pass1 = {
        "page_id": "007-p02", "public_packet_sha256": audit.sha256_file(packet_path),
        "lines": [{"line_id": "line-01", "visible_units": [{
            "unit_id": "U01", "bbox_source_xywh": [10, 10, 20, 12],
            "ownership_route": "terra_box_mask", "risk_flags": ["none"],
        }]}],
    }
    pass1_path = root / "pass1.json"
    write_audit_json(pass1_path, pass1)
    knockout = root / "knockout"
    candidate_path = knockout / "units/U01/candidate-owned-mask.png"
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("L", (20, 12), 255).save(candidate_path, format="PNG")
    candidate_pixels = np.ones((12, 20), dtype=bool)
    selection = {
        "page_id": "007-p02",
        "units": [{
            "unit_id": "U01", "line_id": "line-01", "bbox_source_xywh": [10, 10, 20, 12],
            "component_ids": ["I000001"], "exclusive_candidate_pixels": 240,
            "withheld_collision_pixels": 0,
            "candidate_owned_mask_pixel_sha256": audit.mask_pixel_hash(candidate_pixels),
            "candidate_owned_mask": {"path": "units/U01/candidate-owned-mask.png", "file_sha256": audit.sha256_file(candidate_path)},
            "requires_agent_review": False,
        }],
        "connected_components": [{
            "component_id": "I000001", "crosses_multiple_unit_boxes": False,
            "crosses_box_boundary_unit_ids": [],
        }],
    }
    write_audit_json(knockout / "units/selection-records.json", selection)
    residual_mask = np.zeros((80, 100), dtype=np.uint8)
    residual_mask[30, 40:43] = 255
    (knockout / "masks").mkdir(parents=True, exist_ok=True)
    Image.fromarray(residual_mask, mode="L").save(knockout / "masks/exact-candidate-residual.png", format="PNG")
    residual = {
        "page_id": "007-p02", "candidate_count": 0, "excluded_count": 1,
        "candidates": [],
        "excluded_components": [{"component_id": "C000001", "area_px": 3, "bbox_source_xywh": [40, 30, 3, 1], "reason": "review_hint_tiny_component"}],
    }
    write_audit_json(knockout / "residual-candidates/residual-candidates.json", residual)
    line_board_path = knockout / "line-boards/line-01.png"
    line_board_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (30, 20), (240, 230, 210)).save(line_board_path, format="PNG")
    line_index = {"lines": [{"line_id": "line-01", "board": {
        "path": "line-boards/line-01.png", "file_sha256": audit.sha256_file(line_board_path)
    }}]}
    write_audit_json(knockout / "line-boards/index.json", line_index)
    diagnostic_paths = [
        "page-diagnostics/exact-candidate-mask-subtraction.png",
        "page-diagnostics/background-box-fill.png", "page-diagnostics/coverage-overlay.png",
    ]
    for relative in diagnostic_paths:
        path = knockout / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (10, 8), (250, 250, 250)).save(path, format="PNG")
    output_paths = [
        "units/U01/candidate-owned-mask.png", "units/selection-records.json",
        "masks/exact-candidate-residual.png", "residual-candidates/residual-candidates.json",
        "line-boards/line-01.png", "line-boards/index.json", *diagnostic_paths,
    ]
    manifest = {
        "schema_version": "full-page-ownership-knockout-manifest.v2", "page_id": "007-p02",
        "inputs": {
            "source": {"file_sha256": audit.sha256_file(source_path), "size": [100, 80]},
            "decision": {"file_sha256": audit.sha256_file(pass1_path), "canonical_sha256": audit.canonical_hash(pass1)},
            "validation": {"status": "pass"},
            "public_packet": {"file_sha256": audit.sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
        },
        "summary": {"residual_pixels": 3},
        "outputs": [{"path": relative, "file_sha256": audit.sha256_file(knockout / relative)} for relative in output_paths],
    }
    manifest["manifest_sha256"] = audit.canonical_hash(manifest)
    manifest_path = knockout / "manifest.json"
    write_audit_json(manifest_path, manifest)
    region_board = root / "regions/boards/RR001.png"
    region_board.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), (245, 235, 215)).save(region_board, format="PNG")
    region = {
        "schema_version": "residual-review-regions.v2", "page_id": "007-p02",
        "inputs": {
            "knockout_manifest": {"file_sha256": audit.sha256_file(manifest_path), "manifest_sha256": manifest["manifest_sha256"]},
            "public_packet": {"file_sha256": audit.sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
            "source": {"file_sha256": audit.sha256_file(source_path), "size": [100, 80]},
            "exact_residual_mask": {"file_sha256": audit.sha256_file(knockout / "masks/exact-candidate-residual.png")},
            "residual_component_record": {"file_sha256": audit.sha256_file(knockout / "residual-candidates/residual-candidates.json")},
        },
        "component_count": 1, "normalized_residual_pixel_count": 3,
        "component_ids_canonical_sha256": audit.canonical_hash(["C000001"]),
        "region_count": 1,
        "regions": [{
            "region_id": "RR001", "bbox_source_xywh": [40, 30, 3, 1],
            "component_count": 1, "component_ids": ["C000001"],
            "component_bboxes_source_xywh": [[40, 30, 3, 1]], "component_area_px_total": 3,
            "board": {"path": "boards/RR001.png", "file_sha256": audit.sha256_file(region_board)},
        }],
    }
    region["manifest_sha256"] = audit.canonical_hash(region)
    region_path = root / "regions/manifest.json"
    write_audit_json(region_path, region)
    decision = {
        "schema_version": "full-page-ownership-knockout-decision.v2",
        "trial_id": "full-page-supervisor-trial-v2", "page_id": "007-p02", "model_tier": "terra",
        "source_sha256": audit.sha256_file(source_path),
        "pass1_decision_file_sha256": audit.sha256_file(pass1_path),
        "pass1_decision_canonical_sha256": audit.canonical_hash(pass1),
        "knockout_manifest_file_sha256": audit.sha256_file(manifest_path),
        "knockout_manifest_sha256": manifest["manifest_sha256"],
        "residual_region_manifest_file_sha256": audit.sha256_file(region_path),
        "residual_region_manifest_sha256": region["manifest_sha256"],
        "hidden_prior_answer_access": False, "machine_status": "machine_complete",
        "production_status": "not_production_complete", "production_pending_reason": "pending_production_gate",
        "lines": [{
            "line_id": "line-01", "line_reading_order": 1,
            "inspection_evidence": {
                "claim_scope": "model_attestation_not_software_fact", "source_crop_reviewed": True,
                "ownership_board_reviewed": True, "exact_subtraction_reviewed": True,
                "box_fill_reviewed": True, "coverage_overlay_reviewed": True,
                "source_crop": {"path": "line-evidence/source.png", "file_sha256": audit.sha256_file(source_crop_path)},
                "ownership_board": {"path": "line-boards/line-01.png", "file_sha256": audit.sha256_file(line_board_path)},
                "exact_subtraction": {"path": diagnostic_paths[0], "file_sha256": audit.sha256_file(knockout / diagnostic_paths[0])},
                "box_fill": {"path": diagnostic_paths[1], "file_sha256": audit.sha256_file(knockout / diagnostic_paths[1])},
                "coverage_overlay": {"path": diagnostic_paths[2], "file_sha256": audit.sha256_file(knockout / diagnostic_paths[2])},
                "evidence_note": "all five bound views reviewed",
            },
            "unit_decisions": [{
                "unit_id": "U01", "action": "approve_candidate_mask",
                "claim_scope": "model_proposal_not_software_fact", "reason": "routine separated ink",
                "approved_candidate_mask": {
                    "path": "units/U01/candidate-owned-mask.png", "file_sha256": audit.sha256_file(candidate_path),
                    "pixel_sha256": audit.mask_pixel_hash(candidate_pixels), "pixel_count": 240,
                },
            }],
            "line_status": "routine_masks_approved_pending_production", "line_evidence_note": "complete model review",
        }],
        "residual_groups": [{
            "group_id": "G01", "claim_scope": "model_proposal_not_software_fact",
            "source_region_ids": ["RR001"], "bbox_source_xywh": [40, 30, 3, 1],
            "selector": {"component_ids": ["C000001"]}, "group_kind": "software_speck_group",
            "disposition": "software_speck_policy", "software_speck_max_area_px": 3,
            "evidence_note": "three-pixel legacy software-excluded speck",
        }],
        "missing_word_candidates": [], "detached_target_ink_reopenings": [],
    }
    write_audit_json(root / "pass2.json", decision)
    return refresh_audit_bindings(root)


class FullPageOwnershipKnockoutAuditTests(unittest.TestCase):
    def test_accepts_only_exact_safe_candidate_mask_and_stays_non_production(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(Path(directory))
            result = audit.validate(
                decision, pass1_decision_path=pass1, knockout_manifest_path=manifest,
                public_packet_path=packet, residual_region_manifest_path=regions,
            )
            self.assertEqual(result["status"], "pass")
            self.assertEqual(result["production_status"], "not_production_complete")
            self.assertEqual(result["production_pending_reason"], "pending_production_gate")

    def test_recomputes_candidate_png_pixel_count_and_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision_path, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            candidate_path = root / "knockout/units/U01/candidate-owned-mask.png"
            pixels = np.zeros((12, 20), dtype=np.uint8)
            pixels[0, 0] = 255
            Image.fromarray(pixels, mode="L").save(candidate_path, format="PNG")
            selection_path = manifest.parent / "units/selection-records.json"
            selection = json.loads(selection_path.read_text())
            selection["units"][0]["candidate_owned_mask"]["file_sha256"] = audit.sha256_file(candidate_path)
            write_audit_json(selection_path, selection)
            decision_path, pass1, manifest, packet, regions = refresh_audit_bindings(root)
            with self.assertRaisesRegex(RuntimeError, "decoded pixel count"):
                audit.validate(decision_path, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_legacy_excluded_residual_component_cannot_disappear(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            mask_path = root / "knockout/masks/exact-candidate-residual.png"
            mask = np.asarray(Image.open(mask_path)).copy()
            mask[60, 60] = 255
            Image.fromarray(mask, mode="L").save(mask_path, format="PNG")
            record_path = root / "knockout/residual-candidates/residual-candidates.json"
            record = json.loads(record_path.read_text())
            record["excluded_count"] = 2
            record["excluded_components"].append({"component_id": "C000002", "area_px": 1, "bbox_source_xywh": [60, 60, 1, 1], "reason": "small_speck_below_area_filter"})
            write_audit_json(record_path, record)
            manifest_data = json.loads(manifest.read_text())
            manifest_data["summary"]["residual_pixels"] = 4
            write_audit_json(manifest, manifest_data)
            region_board = root / "regions/boards/RR002.png"
            Image.new("RGB", (4, 4), (245, 235, 215)).save(region_board, format="PNG")
            region = json.loads(regions.read_text())
            region.update({
                "component_count": 2, "normalized_residual_pixel_count": 4,
                "component_ids_canonical_sha256": audit.canonical_hash(["C000001", "C000002"]), "region_count": 2,
            })
            region["regions"].append({
                "region_id": "RR002", "bbox_source_xywh": [60, 60, 1, 1], "component_count": 1,
                "component_ids": ["C000002"], "component_bboxes_source_xywh": [[60, 60, 1, 1]],
                "component_area_px_total": 1, "board": {"path": "boards/RR002.png", "file_sha256": audit.sha256_file(region_board)},
            })
            write_audit_json(regions, region)
            decision, pass1, manifest, packet, regions = refresh_audit_bindings(root)
            with self.assertRaisesRegex(RuntimeError, "including legacy exclusions"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_terra_cannot_terminally_dismiss_non_speck_as_non_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            payload["residual_groups"][0].update({"group_kind": "non_text_artifact", "disposition": "non_text_keep_residual"})
            payload["residual_groups"][0].pop("software_speck_max_area_px")
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "Terra cannot terminally dismiss"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_reopen_bbox_cannot_dead_end_without_structured_follow_up(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            payload["lines"][0]["unit_decisions"][0] = {
                "unit_id": "U01", "action": "reopen_bbox", "claim_scope": "model_proposal_not_software_fact",
                "reason": "bbox too tight", "reopen_bbox_source_xywh": [9, 9, 22, 14],
            }
            payload["lines"][0]["line_status"] = "pending_reopen"
            payload["production_pending_reason"] = "pending_bbox_reopen"
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "requires a structured follow-up"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_fragmented_multi_component_unit_cannot_be_exactly_approved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            candidate_path = root / "knockout/units/U01/candidate-owned-mask.png"
            pixels = np.zeros((12, 20), dtype=np.uint8)
            pixels[1:4, 1:4] = 255
            pixels[8:11, 16:19] = 255
            Image.fromarray(pixels, mode="L").save(candidate_path, format="PNG")
            selection_path = root / "knockout/units/selection-records.json"
            selection = json.loads(selection_path.read_text())
            selection["units"][0]["exclusive_candidate_pixels"] = 18
            selection["units"][0]["candidate_owned_mask_pixel_sha256"] = audit.mask_pixel_hash(pixels > 0)
            selection["units"][0]["candidate_owned_mask"]["file_sha256"] = audit.sha256_file(candidate_path)
            write_audit_json(selection_path, selection)
            payload = json.loads(decision.read_text())
            payload["lines"][0]["unit_decisions"][0]["approved_candidate_mask"].update({
                "file_sha256": audit.sha256_file(candidate_path),
                "pixel_sha256": audit.mask_pixel_hash(pixels > 0), "pixel_count": 18,
            })
            write_audit_json(decision, payload)
            decision, pass1, manifest, packet, regions = refresh_audit_bindings(root)
            with self.assertRaisesRegex(RuntimeError, "fragmented or component-unbound"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_attested_evidence_blocks_path_traversal_and_detects_current_hash_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            payload["lines"][0]["inspection_evidence"]["source_crop"]["path"] = "../source.png"
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "traversal"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root / "tamper")
            Image.new("RGB", (30, 20), (1, 2, 3)).save(manifest.parent / "line-boards/line-01.png", format="PNG")
            with self.assertRaisesRegex(RuntimeError, "output hash changed"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_missing_word_reopen_requires_create_unit_follow_up(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            payload["residual_groups"][0].update({
                "group_kind": "likely_missing_word", "disposition": "add_missing_word_candidate",
                "missing_word_candidate_ids": ["MW01"],
            })
            payload["residual_groups"][0].pop("software_speck_max_area_px")
            payload["missing_word_candidates"] = [{
                "candidate_id": "MW01", "claim_scope": "model_proposal_not_software_fact",
                "source_bbox_xywh": [40, 30, 3, 1], "tentative_text": "[word]", "origin_group_ids": ["G01"],
                "route": "reopen_bbox", "follow_up": {
                    "follow_up_id": "F-MW01", "action": "sol_review", "source_bbox_xywh": [40, 30, 3, 1],
                    "target_line_id": "line-01", "evidence_group_ids": ["G01"], "evidence_note": "wrong dead-end route",
                }, "evidence_note": "visible missing-word proposal",
            }]
            payload["production_pending_reason"] = "pending_bbox_reopen"
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "must create a unit candidate"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_detached_group_route_must_match_reopening_and_unit_action(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            unit_follow = {
                "follow_up_id": "F-U01", "action": "regenerate_unit_candidate", "source_bbox_xywh": [9, 9, 35, 25],
                "target_unit_id": "U01", "target_line_id": "line-01", "evidence_group_ids": ["G01"], "evidence_note": "regenerate with detached ink",
            }
            payload["lines"][0]["unit_decisions"][0] = {
                "unit_id": "U01", "action": "reopen_bbox", "claim_scope": "model_proposal_not_software_fact",
                "reason": "detached ink", "reopen_bbox_source_xywh": [9, 9, 35, 25], "follow_up": unit_follow,
            }
            payload["lines"][0]["line_status"] = "pending_reopen"
            payload["production_pending_reason"] = "pending_sol_review"
            payload["residual_groups"][0].update({
                "group_kind": "detached_target_ink", "disposition": "reopen_existing_unit", "target_unit_id": "U01",
            })
            payload["residual_groups"][0].pop("software_speck_max_area_px")
            payload["detached_target_ink_reopenings"] = [{
                "reopening_id": "DR01", "claim_scope": "model_proposal_not_software_fact", "unit_id": "U01",
                "origin_group_ids": ["G01"], "source_bbox_xywh": [9, 9, 35, 25], "route": "sol_review",
                "follow_up": {
                    "follow_up_id": "F-DR01", "action": "sol_review", "source_bbox_xywh": [9, 9, 35, 25],
                    "target_unit_id": "U01", "target_line_id": "line-01", "evidence_group_ids": ["G01"],
                    "escalation": {"target": "sol", "issue": "route mismatch", "requested_decision": "choose ink"},
                    "evidence_note": "bad route",
                }, "reason": "deliberate mismatch",
            }]
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "route differs from unit action"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)

    def test_pending_residual_state_is_unreachable_by_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decision, pass1, manifest, packet, regions = make_pass2_audit_fixture(root)
            payload = json.loads(decision.read_text())
            payload["lines"][0]["line_status"] = "pending_residual"
            write_audit_json(decision, payload)
            with self.assertRaisesRegex(RuntimeError, "JSON Schema validation failed"):
                audit.validate(decision, pass1_decision_path=pass1, knockout_manifest_path=manifest, public_packet_path=packet, residual_region_manifest_path=regions)


if __name__ == "__main__":
    unittest.main()
