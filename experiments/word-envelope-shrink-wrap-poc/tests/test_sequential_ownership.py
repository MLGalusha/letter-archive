from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw

from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import sha256_file, sha256_mask_pixels
from word_envelope.sequential_ownership import (
    COMPACT_ACTION_SCHEMA_VERSION,
    apply_compact_action,
    init_run,
    next_packet,
    requeue_review,
    requeue_tier,
    status,
)
from word_envelope import sequential_ownership as supervisor


def legacy_hash(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def make_inputs(
    root: Path,
    *,
    rotation: float = -25,
    directed_reading: str = "left_to_right",
    first_route: str = "terra_box_mask",
    second_kind: str = "word",
    second_route: str = "terra_box_mask",
) -> dict[str, Path]:
    source = root / "source.png"
    image = Image.new("RGB", (120, 80), "#eadfca")
    draw = ImageDraw.Draw(image)
    draw.rectangle((15, 25, 34, 30), fill="#171719")
    draw.rectangle((50, 25, 59, 31), fill="#171719")
    image.save(source, format="PNG")

    mask_array = np.zeros((80, 120), dtype=bool)
    mask_array[25:31, 15:35] = True
    mask_array[25:32, 50:60] = True
    knockout = root / "knockout"
    mask_path = knockout / "masks/ink-proposal.png"
    mask_path.parent.mkdir(parents=True)
    Image.fromarray(mask_array.astype(np.uint8) * 255, mode="L").save(
        mask_path, format="PNG"
    )

    packet = {
        "schema_version": "synthetic-public-packet.v1",
        "page_id": "007-p02",
        "source": {
            "path": str(source),
            "sha256": sha256_file(source),
            "size": [120, 80],
        },
        "lines": [],
    }
    packet["packet_sha256"] = legacy_hash(packet)
    packet_path = root / "packet.json"
    write_json(packet_path, packet)

    units = [
        {
            "unit_id": "U1",
            "reading_order": 1,
            "bbox_source_xywh": [10, 20, 25, 20],
            "tentative_text": "first",
            "unit_kind": "word",
            "ownership_route": first_route,
            "risk_flags": ["none"],
        },
        {
            "unit_id": "U2",
            "reading_order": 2,
            "bbox_source_xywh": [10, 20, 55, 20],
            "tentative_text": "second",
            "unit_kind": second_kind,
            "ownership_route": second_route,
            "risk_flags": ["none"],
        },
    ]
    decision = {
        "schema_version": "synthetic-pass1.v1",
        "page_id": "007-p02",
        "source_sha256": sha256_file(source),
        "public_packet_sha256": sha256_file(packet_path),
        "lines": [
            {
                "line_id": "line-01",
                "line_reading_order": 1,
                "upright_rotation_degrees": rotation,
                "directed_reading": directed_reading,
                "visible_units": units,
            }
        ],
    }
    decision_path = root / "pass1.json"
    write_json(decision_path, decision)

    manifest = {
        "schema_version": "full-page-ownership-knockout-manifest.v2",
        "page_id": "007-p02",
        "inputs": {
            "decision": {"file_sha256": sha256_file(decision_path)},
            "public_packet": {"file_sha256": sha256_file(packet_path)},
            "source": {"file_sha256": sha256_file(source), "size": [120, 80]},
            "ink_proposal_pixel_sha256": sha256_mask_pixels(mask_array),
        },
        "outputs": [
            {
                "path": "masks/ink-proposal.png",
                "file_sha256": sha256_file(mask_path),
            }
        ],
    }
    manifest["manifest_sha256"] = legacy_hash(manifest)
    manifest_path = knockout / "manifest.json"
    write_json(manifest_path, manifest)
    return {
        "source": source,
        "mask": mask_path,
        "packet": packet_path,
        "decision": decision_path,
        "manifest": manifest_path,
    }


def initialize(root: Path, inputs: dict[str, Path], **kwargs: object) -> Path:
    run = root / "run"
    init_run(
        pass1_decision_path=inputs["decision"],
        knockout_manifest_path=inputs["manifest"],
        public_packet_path=inputs["packet"],
        run_dir=run,
        work_padding_px=2,
        context_padding_px=5,
        **kwargs,
    )
    return run


def envelope(packet: dict[str, object], action: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": COMPACT_ACTION_SCHEMA_VERSION,
        "work_packet_sha256": packet["work_packet_sha256"],
        "action": action,
    }


def claim_action(component_id: int = 1) -> dict[str, object]:
    return {
        "type": "claim_select",
        "component_ids": [component_id],
        "confidence": "high",
        "reason_codes": ["same_word_body"],
    }


def manual_action() -> dict[str, object]:
    return {
        "type": "defer_manual",
        "disposition": "touching_or_overwritten_ink",
        "confidence": "low",
        "reason_codes": ["touching_words"],
    }


def reopen_action(
    bbox: list[int], *reason_codes: str
) -> dict[str, object]:
    return {
        "type": "reopen_bbox",
        "bbox_source_xywh": bbox,
        "confidence": "high",
        "reason_codes": list(reason_codes or ("wrong_line_registration",)),
    }


def make_sol_review_pass2(root: Path, unit_ids: list[str]) -> tuple[Path, Path]:
    pass2 = {
        "page_id": "007-p02",
        "lines": [
            {
                "unit_decisions": [
                    {
                        "unit_id": unit_id,
                        "action": "sol_review",
                        "reason": "exact candidate mask is not safe to preload",
                        "escalation": {"target": "sol"},
                    }
                    for unit_id in unit_ids
                ]
            }
        ],
        "missing_word_candidates": [],
        "residual_groups": [],
    }
    pass2_path = root / "pass2.json"
    residual_path = root / "residual.json"
    write_json(pass2_path, pass2)
    write_json(residual_path, {})
    return pass2_path, residual_path


class SequentialOwnershipTests(unittest.TestCase):
    def test_explicit_clean_and_high_recall_pair_is_bound_independently_of_knockout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            legacy = np.asarray(Image.open(inputs["mask"]).convert("L")) > 0
            clean = np.zeros_like(legacy)
            clean[25:31, 15:35] = True
            clean[42:47, 72:81] = True
            strong = clean.copy()
            strong[48:53, 76:87] = True
            clean_path = root / "v4-clean.png"
            strong_path = root / "v4-strong.png"
            Image.fromarray(clean.astype(np.uint8) * 255, mode="L").save(clean_path)
            Image.fromarray(strong.astype(np.uint8) * 255, mode="L").save(strong_path)
            run = initialize(
                root,
                inputs,
                clean_ink_mask_path=clean_path,
                high_recall_ink_mask_path=strong_path,
            )
            manifest = json.loads((run / "run-manifest.json").read_text())
            self.assertEqual(
                manifest["policy"]["ink_view_policy"],
                "explicit_clean_and_high_recall_pair",
            )
            self.assertEqual(
                manifest["input_bindings"]["clean_reference_ink_mask"]["pixel_sha256"],
                sha256_mask_pixels(clean),
            )
            self.assertEqual(
                manifest["input_bindings"]["normalized_global_ink_mask"]["pixel_sha256"],
                sha256_mask_pixels(strong),
            )
            self.assertEqual(
                manifest["input_bindings"]["upstream_knockout_ink_mask"]["pixel_sha256"],
                sha256_mask_pixels(legacy),
            )
            packet = next_packet(run)
            self.assertEqual(packet["ink_views"]["selection_component_universe"], "strong")
            self.assertTrue(packet["ink_views"]["same_crop_coordinates"])

    def test_explicit_clean_must_be_retained_by_high_recall(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            clean = np.asarray(Image.open(inputs["mask"]).convert("L")) > 0
            strong = clean.copy()
            strong[25, 15] = False
            clean_path = root / "clean.png"
            strong_path = root / "bad-strong.png"
            Image.fromarray(clean.astype(np.uint8) * 255, mode="L").save(clean_path)
            Image.fromarray(strong.astype(np.uint8) * 255, mode="L").save(strong_path)
            with self.assertRaisesRegex(EnvelopeError, "retain every pixel"):
                initialize(
                    root,
                    inputs,
                    clean_ink_mask_path=clean_path,
                    high_recall_ink_mask_path=strong_path,
                )

    def test_diagnostic_unit_subset_preserves_canonical_order_and_is_not_full_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            run = initialize(root, inputs, unit_ids=["U2", "U1"])
            manifest = json.loads((run / "run-manifest.json").read_text())
            self.assertEqual([unit["unit_id"] for unit in manifest["units"]], ["U1", "U2"])
            self.assertEqual(
                manifest["diagnostic_unit_subset"],
                {
                    "unit_ids": ["U1", "U2"],
                    "unit_count": 2,
                    "not_a_page_completeness_run": True,
                },
            )
            self.assertEqual(
                manifest["policy"]["unit_subset_policy"],
                "explicit_diagnostic_subset_in_canonical_page_order",
            )

    def test_diagnostic_unit_subset_rejects_unknown_and_duplicate_ids(self) -> None:
        for values, pattern in ((["missing"], "unknown"), (["U1", "U1"], "duplicate")):
            with self.subTest(values=values), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                inputs = make_inputs(root)
                with self.assertRaisesRegex(EnvelopeError, pattern):
                    initialize(root, inputs, unit_ids=values)

    def test_high_recall_claim_universe_keeps_clean_same_coordinate_view(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            clean = np.asarray(Image.open(inputs["mask"]).convert("L")) > 0
            strong = clean.copy()
            strong[24:33, 35:49] = True
            strong_path = root / "strong.png"
            Image.fromarray(strong.astype(np.uint8) * 255, mode="L").save(strong_path)
            run = initialize(root, inputs, high_recall_ink_mask_path=strong_path)
            packet = next_packet(run)
            self.assertGreater(packet["ink_views"]["strong"]["pixels"], packet["ink_views"]["clean"]["pixels"])
            self.assertTrue(packet["ink_views"]["same_crop_coordinates"])
            self.assertEqual(packet["ink_views"]["selection_component_universe"], "strong")
            self.assertEqual(
                packet["evidence"]["work_crop"]["size_wh"],
                packet["evidence"]["clean_ink_selection_crop"]["size_wh"],
            )
            self.assertEqual(
                packet["evidence"]["ink_selection_crop"]["size_wh"],
                packet["evidence"]["clean_ink_selection_crop"]["size_wh"],
            )

    def test_high_recall_mask_must_be_clean_superset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            clean = np.asarray(Image.open(inputs["mask"]).convert("L")) > 0
            strong = clean.copy()
            strong[25, 15] = False
            strong_path = root / "bad-strong.png"
            Image.fromarray(strong.astype(np.uint8) * 255, mode="L").save(strong_path)
            with self.assertRaisesRegex(EnvelopeError, "retain every pixel"):
                initialize(root, inputs, high_recall_ink_mask_path=strong_path)

    def test_pass2_sol_review_routine_fragmented_word_allows_interactive_terra(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            mask = np.asarray(Image.open(inputs["mask"]).convert("L")) > 0
            # Split U1's ink into two disconnected components.  Interactive
            # Terra may claim both even though pass 2 rejected automatic mask
            # preloading.
            mask[25:31, 24] = False
            Image.fromarray(mask.astype(np.uint8) * 255, mode="L").save(inputs["mask"])
            manifest = json.loads(inputs["manifest"].read_text())
            manifest["inputs"]["ink_proposal_pixel_sha256"] = sha256_mask_pixels(mask)
            manifest["outputs"][0]["file_sha256"] = sha256_file(inputs["mask"])
            manifest.pop("manifest_sha256")
            manifest["manifest_sha256"] = legacy_hash(manifest)
            write_json(inputs["manifest"], manifest)
            pass2_path, residual_path = make_sol_review_pass2(root, ["U1", "U2"])
            validation = {
                "status": "pass",
                "decision_file_sha256": sha256_file(pass2_path),
                "validation_sha256": "c" * 64,
                "action_counts": {"sol_review": 2},
            }
            with mock.patch.object(
                supervisor, "_call_frozen_pass2_validator", return_value=validation
            ):
                run = initialize(
                    root,
                    inputs,
                    pass2_decision_path=pass2_path,
                    residual_region_manifest_path=residual_path,
                )

            packet = next_packet(run)
            self.assertEqual(packet["current"]["interactive_required_model_tier"], "terra")
            self.assertEqual(packet["current"]["required_model_tier"], "terra")
            eligibility = packet["current"]["automatic_approval_eligibility"]
            self.assertFalse(eligibility["eligible"])
            self.assertEqual(eligibility["observed_pass2_action"], "sol_review")
            self.assertTrue(eligibility["independent_from_interactive_model_tier"])
            components = packet["current_unclaimed"]["components"]
            self.assertEqual(len(components), 2)
            legal = {item["type"] for item in packet["legal_actions"]}
            self.assertIn("claim_select", legal)
            self.assertIn("exclude", legal)
            self.assertNotIn("cut", legal)
            self.assertIn("defer_tier", legal)
            defer = next(item for item in packet["legal_actions"] if item["type"] == "defer_tier")
            self.assertEqual(defer["reason"], "agent_discovered_nonroutine_complexity")
            selected = [component["id"] for component in components]
            final = apply_compact_action(
                run,
                envelope(
                    packet,
                    {
                        "type": "claim_select",
                        "component_ids": selected,
                        "confidence": "high",
                        "reason_codes": ["same_word_body"],
                    },
                ),
            )
            self.assertEqual(final["progress"]["claimed_units"], 1)

    def test_shared_or_cut_risk_requires_sol_before_ownership_actions(self) -> None:
        base = {
            "unit_id": "U",
            "unit_kind": "word",
            "ownership_route": "terra_box_mask",
            "supervisor_route_priority": "sol_review",
            "pass2_action": "sol_review",
            "risk_flags": ["threshold_bridge"],
            "upright_rotation_degrees": 0,
        }
        tier, basis = supervisor._interactive_model_tier(base)
        self.assertEqual(tier, "sol")
        self.assertTrue(any("threshold_bridge" in item for item in basis))
        terra_legal = {
            item["type"]
            for item in supervisor._legal_actions(
                [{"id": 1}],
                [100, 40],
                active_model_tier="terra",
                required_model_tier=tier,
                ownership_conflict=False,
            )
        }
        self.assertEqual(
            terra_legal,
            {
                "reopen_bbox",
                "request_expanded_context",
                "defer_tier",
                "defer_manual",
            },
        )
        unreadable = dict(base, risk_flags=["unreadable"])
        self.assertEqual(supervisor._interactive_model_tier(unreadable)[0], "human")

    def test_real_007_dry_run_preserves_interactive_tier_distribution(self) -> None:
        project = Path(__file__).resolve().parents[1]
        pass1 = json.loads(
            (
                project
                / "artifacts/full-page-supervisor-trial-v2/007-p02/agent-sol-adjudication/decisions.json"
            ).read_text()
        )
        pass2 = json.loads(
            (
                project
                / "artifacts/full-page-supervisor-trial-v2/007-p02/agent-terra-pass2/decisions.json"
            ).read_text()
        )
        actions = {
            item["unit_id"]: item["action"]
            for line in pass2["lines"]
            for item in line["unit_decisions"]
        }
        counts: Counter[str] = Counter()
        for line in pass1["lines"]:
            for original in line["visible_units"]:
                pass2_action = actions[original["unit_id"]]
                if pass2_action == "approve_candidate_mask":
                    counts["preloaded"] += 1
                    continue
                unit = dict(original)
                unit["pass2_action"] = pass2_action
                unit["supervisor_route_priority"] = pass2_action
                unit["upright_rotation_degrees"] = line["upright_rotation_degrees"]
                tier, _ = supervisor._interactive_model_tier(unit)
                counts[tier] += 1
        self.assertEqual(
            counts,
            Counter({"terra": 58, "sol": 41, "human": 1, "preloaded": 1}),
        )

    def test_next_is_deterministic_and_claims_are_globally_disjoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            with self.assertRaisesRegex(EnvelopeError, "refusing overwrite"):
                init_run(
                    pass1_decision_path=root / "pass1.json",
                    knockout_manifest_path=root / "knockout/manifest.json",
                    public_packet_path=root / "packet.json",
                    run_dir=run,
                )
            first = next_packet(run)
            self.assertEqual(first, next_packet(run))
            self.assertGreater(
                np.prod(first["evidence"]["source_context"]["size_wh"]),
                np.prod(first["evidence"]["work_crop"]["size_wh"]),
            )
            apply_compact_action(run, envelope(first, claim_action()))

            second = next_packet(run)
            self.assertEqual(second["current"]["unit_id"], "U2")
            # The shared first component is red and absent from the inventory;
            # only U2's unclaimed component remains selectable.
            self.assertEqual(len(second["current_unclaimed"]["components"]), 1)
            apply_compact_action(run, envelope(second, claim_action()))
            head = json.loads((run / "commits/000002/checkpoint.json").read_text())
            masks = []
            for item in head["state"]["claimed_units"]:
                masks.append(np.asarray(Image.open(run / item["source_mask"]["path"])) > 0)
            self.assertFalse(np.any(masks[0] & masks[1]))
            self.assertEqual(status(run)["machine_status"], "complete")

    def test_stale_action_and_crash_do_not_advance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            packet = next_packet(run)
            action = envelope(packet, claim_action())
            with mock.patch.object(supervisor, "_publish_directory", side_effect=RuntimeError("crash")):
                with self.assertRaisesRegex(RuntimeError, "crash"):
                    apply_compact_action(run, action)
            self.assertEqual(status(run)["revision"], 0)
            apply_compact_action(run, action)
            self.assertEqual(status(run)["revision"], 1)
            with self.assertRaisesRegex(EnvelopeError, "stale"):
                apply_compact_action(run, action)
            self.assertEqual(status(run)["revision"], 1)

    def test_cut_and_exclude_each_require_a_fresh_same_unit_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(
                root,
                make_inputs(
                    root,
                    first_route="sol_shared_ink",
                    second_route="sol_shared_ink",
                ),
            )
            for expected in ("U1", "U2"):
                terra_packet = next_packet(run)
                self.assertEqual(terra_packet["current"]["unit_id"], expected)
                terra_legal = {item["type"] for item in terra_packet["legal_actions"]}
                self.assertEqual(
                    terra_legal,
                    {
                        "reopen_bbox",
                        "request_expanded_context",
                        "defer_tier",
                        "defer_manual",
                    },
                )
                apply_compact_action(
                    run,
                    envelope(
                        terra_packet,
                        {
                            "type": "defer_tier",
                            "target": "sol",
                            "reason": "non_routine_unit_requires_sol",
                        },
                    ),
                )
            requeue_tier(run, target="sol")
            packet = next_packet(run)
            self.assertIn("cut", {item["type"] for item in packet["legal_actions"]})
            cut = {
                "type": "cut",
                "bridge_component_id": 1,
                "cut": {
                    "kind": "line",
                    "points": [[17, 1], [17, 20]],
                    "width_px": 1,
                    "intent": "sever_observed_bridge",
                },
                "confidence": "medium",
                "reason_codes": ["threshold_bridge"],
            }
            result = apply_compact_action(run, envelope(packet, cut))
            self.assertEqual(result["current"]["unit_id"], "U1")
            self.assertEqual(result["current"]["unit_turn"], 1)
            after_cut = next_packet(run)
            self.assertEqual(len(after_cut["current_unclaimed"]["components"]), 2)
            exclude = {
                "type": "exclude",
                "component_ids": [2],
                "confidence": "high",
                "reason_codes": ["adjacent_word"],
            }
            result = apply_compact_action(run, envelope(after_cut, exclude))
            self.assertEqual(result["current"]["unit_id"], "U1")
            self.assertEqual(result["current"]["unit_turn"], 2)
            self.assertEqual(len(next_packet(run)["current_unclaimed"]["components"]), 1)

    def test_directed_minus_90_transform_is_not_folded_to_envelope_angle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(
                root,
                make_inputs(root, rotation=-90, directed_reading="top_to_bottom"),
            )
            packet = next_packet(run)
            transform = packet["directed_reading_transform"]
            self.assertEqual(transform["source_to_upright_rotation_degrees_ccw"], -90)
            self.assertEqual(transform["directed_reading"], "top_to_bottom")
            source_size = packet["evidence"]["source_context"]["size_wh"]
            upright_size = packet["evidence"]["upright_context"]["size_wh"]
            self.assertEqual(upright_size, list(reversed(source_size)))
            self.assertIn("must not be normalized modulo 180", transform["envelope_axis_relationship"])

    def test_prior_claim_swallowing_next_target_forces_human_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            decision = json.loads(inputs["decision"].read_text())
            # U2 is exactly U1's target, so U1's valid claim consumes it.
            decision["lines"][0]["visible_units"][1]["bbox_source_xywh"] = [10, 20, 25, 20]
            write_json(inputs["decision"], decision)
            manifest = json.loads(inputs["manifest"].read_text())
            manifest["inputs"]["decision"]["file_sha256"] = sha256_file(inputs["decision"])
            manifest.pop("manifest_sha256")
            manifest["manifest_sha256"] = legacy_hash(manifest)
            write_json(inputs["manifest"], manifest)
            run = initialize(root, inputs)
            first = next_packet(run)
            apply_compact_action(run, envelope(first, claim_action()))
            second = next_packet(run)
            self.assertTrue(second["ownership_conflict"]["blocked"])
            legal = {item["type"] for item in second["legal_actions"]}
            self.assertNotIn("claim_select", legal)
            self.assertIn("defer_manual", legal)
            final = apply_compact_action(run, envelope(second, manual_action()))
            self.assertEqual(final["production_status"], "blocked_manual_review")

    def test_terra_defer_requeue_sol_then_claim_preserves_prior_claims(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(
                root,
                make_inputs(root, second_route="sol_shared_ink"),
            )
            first = next_packet(run)
            apply_compact_action(run, envelope(first, claim_action()))
            sol_unit = next_packet(run)
            self.assertEqual(sol_unit["current"]["required_model_tier"], "sol")
            tier_action = {
                "type": "defer_tier",
                "target": "sol",
                "reason": "non_routine_unit_requires_sol",
            }
            waiting = apply_compact_action(run, envelope(sol_unit, tier_action))
            self.assertEqual(waiting["machine_status"], "awaiting_tier_requeue")
            reentered = requeue_tier(run, target="sol")
            self.assertEqual(reentered["current"]["unit_id"], "U2")
            self.assertEqual(reentered["current"]["active_model_tier"], "sol")
            with self.assertRaisesRegex(EnvelopeError, "current queue still has work"):
                requeue_tier(run, target="sol")
            sol_packet = next_packet(run)
            final = apply_compact_action(run, envelope(sol_packet, claim_action()))
            self.assertEqual(final["machine_status"], "complete")
            self.assertEqual(final["progress"]["claimed_units"], 2)

    def test_routine_terra_can_discover_complexity_then_sol_claim(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            first = next_packet(run)
            apply_compact_action(run, envelope(first, claim_action()))
            prior_claim_hash = status(run)["global_claimed_mask_pixel_sha256"]

            routine = next_packet(run)
            self.assertEqual(routine["current"]["required_model_tier"], "terra")
            legal = {item["type"] for item in routine["legal_actions"]}
            self.assertTrue(
                {"claim_select", "exclude", "request_expanded_context", "defer_tier"}
                <= legal
            )
            waiting = apply_compact_action(
                run,
                envelope(
                    routine,
                    {
                        "type": "defer_tier",
                        "target": "sol",
                        "reason": "agent_discovered_nonroutine_complexity",
                    },
                ),
            )
            self.assertEqual(waiting["machine_status"], "awaiting_tier_requeue")
            self.assertEqual(waiting["progress"]["claimed_units"], 1)
            self.assertEqual(
                waiting["global_claimed_mask_pixel_sha256"], prior_claim_hash
            )

            reentered = requeue_tier(run, target="sol")
            self.assertEqual(reentered["current"]["unit_id"], "U2")
            self.assertEqual(reentered["current"]["active_model_tier"], "sol")
            sol_packet = next_packet(run)
            self.assertNotIn(
                "defer_tier", {item["type"] for item in sol_packet["legal_actions"]}
            )
            final = apply_compact_action(run, envelope(sol_packet, claim_action()))
            self.assertEqual(final["machine_status"], "complete")
            self.assertEqual(final["production_status"], "ready_for_bound_residual_audit")
            self.assertEqual(final["progress"]["claimed_units"], 2)
            self.assertEqual(final["progress"]["tier_deferred_units"], 0)

    def test_two_eligible_manual_reviews_convert_to_sol_and_clear_blockers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            first = next_packet(run)
            apply_compact_action(run, envelope(first, manual_action()))
            second = next_packet(run)
            apply_compact_action(
                run,
                envelope(
                    second,
                    {
                        "type": "defer_manual",
                        "disposition": "unsafe_cut",
                        "confidence": "low",
                        "reason_codes": ["threshold_bridge"],
                    },
                ),
            )
            blocked = status(run)
            self.assertEqual(blocked["production_status"], "blocked_manual_review")
            self.assertEqual(blocked["progress"]["deferred_units"], 2)

            reentered = requeue_review(
                run, target="sol", unit_ids=["U2", "U1"]
            )
            self.assertEqual(reentered["current"]["unit_id"], "U1")
            self.assertEqual(reentered["current"]["active_model_tier"], "sol")
            self.assertEqual(reentered["progress"]["deferred_units"], 0)
            self.assertEqual(reentered["progress"]["tier_deferred_units"], 2)
            self.assertEqual(reentered["progress"]["page_completed_units"], 0)
            event = json.loads((run / "commits/000003/event.json").read_text())
            control = event["control_action"]
            self.assertEqual(control["type"], "requeue_review")
            self.assertEqual(control["requested_unit_ids"], ["U2", "U1"])
            self.assertEqual(control["queue_unit_ids"], ["U1", "U2"])
            self.assertEqual(len(control["conversions"]), 2)

            u1 = next_packet(run)
            apply_compact_action(run, envelope(u1, claim_action()))
            u2 = next_packet(run)
            final = apply_compact_action(run, envelope(u2, claim_action()))
            self.assertEqual(final["machine_status"], "complete")
            self.assertEqual(final["production_status"], "ready_for_bound_residual_audit")
            self.assertEqual(final["progress"]["deferred_units"], 0)
            self.assertEqual(final["progress"]["tier_deferred_units"], 0)
            self.assertEqual(final["progress"]["claimed_units"], 2)
            self.assertEqual(final["progress"]["page_completed_units"], 2)
            with self.assertRaisesRegex(EnvelopeError, "stale or not active"):
                requeue_review(run, target="sol", unit_ids=["U1"])

    def test_requeue_review_rejects_noneligible_unknown_duplicate_and_active_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            with self.assertRaisesRegex(EnvelopeError, "current queue still has work"):
                requeue_review(run, target="sol", unit_ids=["U1"])

            first = next_packet(run)
            apply_compact_action(
                run,
                envelope(
                    first,
                    {
                        "type": "defer_manual",
                        "disposition": "ambiguous_detached_mark",
                        "confidence": "low",
                        "reason_codes": ["uncertain_reading"],
                    },
                ),
            )
            second = next_packet(run)
            apply_compact_action(run, envelope(second, claim_action()))
            before = status(run)
            with self.assertRaisesRegex(EnvelopeError, "must not contain duplicates"):
                requeue_review(run, target="sol", unit_ids=["U1", "U1"])
            with self.assertRaisesRegex(EnvelopeError, "unknown unit IDs"):
                requeue_review(run, target="sol", unit_ids=["not-a-unit"])
            with self.assertRaisesRegex(EnvelopeError, "not eligible"):
                requeue_review(run, target="sol", unit_ids=["U1"])
            after = status(run)
            self.assertEqual(after["revision"], before["revision"])
            self.assertEqual(after["checkpoint_sha256"], before["checkpoint_sha256"])
            self.assertEqual(after["production_status"], "blocked_manual_review")

    def test_validated_pass2_preloads_approval_and_keeps_nonword_human(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root, second_kind="non_word_mark", second_route="human")
            approved = np.zeros((20, 25), dtype=bool)
            approved[5:11, 5:25] = True
            approved_path = inputs["manifest"].parent / "units/U1/candidate-owned-mask.png"
            approved_path.parent.mkdir(parents=True)
            Image.fromarray(approved.astype(np.uint8) * 255, mode="L").save(approved_path)
            pass2 = {
                "page_id": "007-p02",
                "lines": [{"unit_decisions": [
                    {
                        "unit_id": "U1", "action": "approve_candidate_mask", "reason": "safe",
                        "approved_candidate_mask": {
                            "path": "units/U1/candidate-owned-mask.png",
                            "file_sha256": sha256_file(approved_path),
                            "pixel_sha256": sha256_mask_pixels(approved),
                            "pixel_count": int(approved.sum()),
                        },
                    },
                    {
                        "unit_id": "U2", "action": "human_review", "reason": "possible I",
                        "escalation": {"target": "human"},
                    },
                ]}],
                "missing_word_candidates": [],
                "residual_groups": [],
            }
            pass2_path = root / "pass2.json"
            residual_path = root / "residual.json"
            write_json(pass2_path, pass2)
            write_json(residual_path, {})
            validation = {
                "status": "pass",
                "decision_file_sha256": sha256_file(pass2_path),
                "validation_sha256": "a" * 64,
                "action_counts": {"approve_candidate_mask": 1, "human_review": 1},
            }
            with mock.patch.object(
                supervisor, "_call_frozen_pass2_validator", return_value=validation
            ):
                run = initialize(
                    root,
                    inputs,
                    pass2_decision_path=pass2_path,
                    residual_region_manifest_path=residual_path,
                )
            packet = next_packet(run)
            self.assertEqual(packet["current"]["unit_id"], "U2")
            self.assertEqual(packet["current"]["unit_kind"], "non_word_mark")
            self.assertEqual(packet["current"]["required_model_tier"], "human")
            self.assertEqual(packet["global_claimed"]["pixels"], int(approved.sum()))
            legal = {item["type"] for item in packet["legal_actions"]}
            self.assertNotIn("claim_select", legal)
            final = apply_compact_action(run, envelope(packet, manual_action()))
            self.assertEqual(final["production_status"], "blocked_manual_review")

    def test_validated_pass2_reopen_bbox_replaces_active_target_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            approved = np.zeros((20, 25), dtype=bool)
            approved[5:11, 5:25] = True
            approved_path = inputs["manifest"].parent / "units/U1/candidate-owned-mask.png"
            approved_path.parent.mkdir(parents=True)
            Image.fromarray(approved.astype(np.uint8) * 255, mode="L").save(approved_path)
            reopened = [43, 20, 25, 20]
            follow = {
                "follow_up_id": "reopen-U2",
                "action": "regenerate_unit_candidate",
                "source_bbox_xywh": reopened,
                "target_unit_id": "U2",
                "target_line_id": "line-01",
                "evidence_group_ids": [],
                "evidence_note": "synthetic",
            }
            pass2 = {
                "page_id": "007-p02",
                "lines": [{"unit_decisions": [
                    {
                        "unit_id": "U1", "action": "approve_candidate_mask", "reason": "safe",
                        "approved_candidate_mask": {
                            "path": "units/U1/candidate-owned-mask.png",
                            "file_sha256": sha256_file(approved_path),
                            "pixel_sha256": sha256_mask_pixels(approved),
                            "pixel_count": int(approved.sum()),
                        },
                    },
                    {
                        "unit_id": "U2", "action": "reopen_bbox", "reason": "tight",
                        "reopen_bbox_source_xywh": reopened, "follow_up": follow,
                    },
                ]}],
                "missing_word_candidates": [], "residual_groups": [],
            }
            pass2_path, residual_path = root / "pass2.json", root / "residual.json"
            write_json(pass2_path, pass2)
            write_json(residual_path, {})
            validation = {
                "status": "pass", "decision_file_sha256": sha256_file(pass2_path),
                "validation_sha256": "b" * 64,
                "action_counts": {"approve_candidate_mask": 1, "reopen_bbox": 1},
            }
            with mock.patch.object(supervisor, "_call_frozen_pass2_validator", return_value=validation):
                run = initialize(
                    root, inputs, pass2_decision_path=pass2_path,
                    residual_region_manifest_path=residual_path,
                )
            packet = next_packet(run)
            self.assertEqual(packet["current"]["target_bbox_source_xywh"], reopened)
            self.assertEqual(packet["current"]["supervisor_route_priority"], "reopen_bbox")

    def test_live_wrong_line_reopen_regenerates_fresh_claimable_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs = make_inputs(root)
            decision = json.loads(inputs["decision"].read_text())
            # The second word is incorrectly registered to the already-owned
            # first word.  Its actual ink is the separate rectangle at x=50.
            decision["lines"][0]["visible_units"][1]["bbox_source_xywh"] = [
                10, 20, 25, 20
            ]
            write_json(inputs["decision"], decision)
            manifest = json.loads(inputs["manifest"].read_text())
            manifest["inputs"]["decision"]["file_sha256"] = sha256_file(
                inputs["decision"]
            )
            manifest.pop("manifest_sha256")
            manifest["manifest_sha256"] = legacy_hash(manifest)
            write_json(inputs["manifest"], manifest)
            run = initialize(root, inputs)

            first = next_packet(run)
            apply_compact_action(run, envelope(first, claim_action()))
            before_reopen = status(run)
            swallowed = next_packet(run)
            self.assertEqual(swallowed["ownership_conflict"]["target_unclaimed_pixels"], 0)
            self.assertTrue(swallowed["ownership_conflict"]["blocked"])
            self.assertEqual(
                swallowed["original_target_prior_claimants"][0]["claimant_unit_id"],
                "U1",
            )
            self.assertIn(
                "reopen_bbox", {item["type"] for item in swallowed["legal_actions"]}
            )

            reopened = apply_compact_action(
                run,
                envelope(
                    swallowed,
                    reopen_action(
                        [40, 20, 25, 20],
                        "wrong_line_registration",
                        "duplicate_geometry",
                        "visible_word_outside_target",
                    ),
                ),
            )
            self.assertEqual(reopened["current"]["unit_id"], "U2")
            self.assertEqual(reopened["current"]["unit_turn"], 1)
            self.assertEqual(
                reopened["global_claimed_mask_pixel_sha256"],
                before_reopen["global_claimed_mask_pixel_sha256"],
            )
            fresh = next_packet(run)
            self.assertEqual(fresh["current"]["original_target_bbox_source_xywh"], [10, 20, 25, 20])
            self.assertEqual(fresh["current"]["active_target_bbox_source_xywh"], [40, 20, 25, 20])
            self.assertGreater(fresh["current_unclaimed"]["pixels"], 0)
            self.assertEqual(len(fresh["current"]["registration_override_history"]), 1)

            manifest_unit = json.loads((run / "run-manifest.json").read_text())["units"][1]
            self.assertEqual(manifest_unit["bbox_source_xywh"], [10, 20, 25, 20])
            checkpoint = json.loads((run / "commits/000002/checkpoint.json").read_text())
            override = checkpoint["state"]["global_claimed_mask"][
                "registration_bbox_overrides"
            ]["U2"]
            self.assertEqual(override["original_bbox_source_xywh"], [10, 20, 25, 20])
            self.assertEqual(override["active_bbox_source_xywh"], [40, 20, 25, 20])

            component_id = fresh["current_unclaimed"]["components"][0]["id"]
            final = apply_compact_action(
                run, envelope(fresh, claim_action(component_id))
            )
            self.assertEqual(final["progress"]["claimed_units"], 2)
            head = json.loads((run / "commits/000003/checkpoint.json").read_text())
            claims = [
                np.asarray(Image.open(run / item["source_mask"]["path"])) > 0
                for item in head["state"]["claimed_units"]
            ]
            self.assertFalse(np.any(claims[0] & claims[1]))

    def test_reopen_rejects_crash_stale_noop_out_of_bounds_and_zero_ink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            packet = next_packet(run)

            with self.assertRaisesRegex(EnvelopeError, "no-op|materially"):
                apply_compact_action(
                    run, envelope(packet, reopen_action([10, 20, 25, 20]))
                )
            with self.assertRaisesRegex(EnvelopeError, "outside the bound source"):
                apply_compact_action(
                    run, envelope(packet, reopen_action([110, 70, 20, 20]))
                )
            with self.assertRaisesRegex(EnvelopeError, "zero normalized ink"):
                apply_compact_action(
                    run, envelope(packet, reopen_action([35, 20, 5, 5]))
                )
            valid = envelope(packet, reopen_action([40, 20, 25, 20]))
            with mock.patch.object(
                supervisor, "_publish_directory", side_effect=RuntimeError("crash")
            ):
                with self.assertRaisesRegex(RuntimeError, "crash"):
                    apply_compact_action(run, valid)
            self.assertEqual(status(run)["revision"], 0)
            apply_compact_action(run, valid)
            self.assertEqual(status(run)["revision"], 1)
            with self.assertRaisesRegex(EnvelopeError, "stale"):
                apply_compact_action(run, valid)
            self.assertEqual(status(run)["revision"], 1)

    def test_requeue_review_preserves_registration_override(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(root, make_inputs(root))
            packet = next_packet(run)
            apply_compact_action(
                run, envelope(packet, reopen_action([40, 20, 25, 20]))
            )
            corrected = next_packet(run)
            apply_compact_action(run, envelope(corrected, manual_action()))
            second = next_packet(run)
            apply_compact_action(run, envelope(second, manual_action()))

            requeue_review(run, target="sol", unit_ids=["U1"])
            reviewed = next_packet(run)
            self.assertEqual(reviewed["current"]["active_model_tier"], "sol")
            self.assertEqual(reviewed["current"]["original_target_bbox_source_xywh"], [10, 20, 25, 20])
            self.assertEqual(reviewed["current"]["active_target_bbox_source_xywh"], [40, 20, 25, 20])
            self.assertEqual(reviewed["current"]["work_bbox_source_xywh"], [38, 18, 29, 24])
            self.assertEqual(len(reviewed["current"]["registration_override_history"]), 1)

    def test_minus_90_reopen_preserves_directed_transform(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = initialize(
                root,
                make_inputs(root, rotation=-90, directed_reading="top_to_bottom"),
            )
            packet = next_packet(run)
            apply_compact_action(
                run, envelope(packet, reopen_action([40, 20, 25, 20]))
            )
            corrected = next_packet(run)
            self.assertEqual(
                corrected["directed_reading_transform"][
                    "source_to_upright_rotation_degrees_ccw"
                ],
                -90,
            )
            self.assertEqual(
                corrected["directed_reading_transform"]["directed_reading"],
                "top_to_bottom",
            )


if __name__ == "__main__":
    unittest.main()
