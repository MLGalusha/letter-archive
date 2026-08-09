from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from word_envelope.agent_action_builder import (
    AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
    build_bound_action,
)
from word_envelope.agent_benchmark import evaluate_agent_action
from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
    validate_single_action,
)
from word_envelope.agent_packs import (
    AGENT_TASK_PACK_SCHEMA_VERSION,
    AGENT_TRUTH_SCHEMA_VERSION,
)
from word_envelope.agent_turns import generate_exclusion_followup_task
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import (
    CROP_SCHEMA_VERSION,
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import load_mask, save_mask, stable_components


class AgentFollowupTurnTests(unittest.TestCase):
    def test_safe_neighbor_exclusion_regenerates_a_valid_followup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            action = exclude_action(mask, inventory, task, [1])
            output = root / "generated-turn-one"

            result = generate_exclusion_followup_task(parent, action, output)

            self.assertEqual(result["task_id"], "w01-o-t1")
            self.assertEqual(result["turn"], 1)
            self.assertEqual(
                result["parent_transition"]["parent_task_pack_sha256"],
                task["task_pack_sha256"],
            )
            self.assertEqual(
                result["parent_transition"]["bound_action_sha256"],
                hashlib.sha256(canonical_json_bytes(action)).hexdigest(),
            )
            current = load_mask(output / "private/base-mask.png", polarity="bright")
            _, current_inventory = stable_components(current)
            self.assertEqual(
                result["components"],
                [component_reference(component) for component in current_inventory],
            )
            self.assertEqual(
                result["component_inventory_sha256"],
                component_inventory_sha256(current_inventory),
            )
            self.assertEqual(result["prior_owned_component_refs"], [])
            self.assertEqual(len(result["retired_component_history"]), 1)
            self.assertFalse(
                result["retired_component_history"][0]["accepted_as_current_ref"]
            )

    def test_target_damaging_exclusion_is_rejected_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            action = exclude_action(mask, inventory, task, [0])
            output = root / "unsafe-turn"

            with self.assertRaisesRegex(EnvelopeError, "frozen target pixels"):
                generate_exclusion_followup_task(parent, action, output)

            self.assertFalse(output.exists())

    def test_stale_binding_is_rejected_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            action = exclude_action(mask, inventory, task, [1])
            action["task_pack_sha256"] = "f" * 64
            output = root / "stale-turn"

            with self.assertRaisesRegex(EnvelopeError, "task_pack_sha256.*stale"):
                generate_exclusion_followup_task(parent, action, output)

            self.assertFalse(output.exists())

    def test_followup_bytes_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            action = exclude_action(mask, inventory, task, [1])
            first = root / "first-output"
            second = root / "second-output"

            first_record = generate_exclusion_followup_task(parent, action, first)
            second_record = generate_exclusion_followup_task(parent, action, second)

            self.assertEqual(first_record, second_record)
            self.assertEqual(snapshot(first), snapshot(second))

    def test_red_history_is_not_scoring_neighbor_or_current_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            retired_ref = copy.deepcopy(task["components"][1])
            action = exclude_action(mask, inventory, task, [1])
            output = root / "turn-one"

            generated = generate_exclusion_followup_task(parent, action, output)
            base = load_mask(output / "private/base-mask.png", polarity="bright")
            neighbor = load_mask(
                output / "private/truth-neighbor-mask.png", polarity="bright"
            )
            history = load_mask(
                output / "private/display-history-mask.png", polarity="bright"
            )

            self.assertFalse(neighbor.any())
            self.assertTrue(history[12, 32])
            self.assertFalse(base[12, 32])
            self.assertNotIn(retired_ref, generated["components"])
            self.assertEqual(
                generated["display_history"]["scoring_role"],
                "presentation_only; red history is not added to the private "
                "semantic-neighbor scoring denominator",
            )
            with Image.open(output / "public/ownership-state.png") as source:
                red_pixel = source.convert("RGB").getpixel((32, 12))
            self.assertGreater(red_pixel[0], red_pixel[1])
            self.assertGreater(red_pixel[0], red_pixel[2])

            stale_retired_action = exclude_action(
                base,
                stable_components(base)[1],
                generated,
                [0],
            )
            stale_retired_action["action"]["component_refs"] = [retired_ref]
            with self.assertRaisesRegex(EnvelopeError, "fingerprint does not match"):
                validate_single_action(stale_retired_action, base)

    def test_built_turn_one_claim_passes_strict_evaluation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            exclusion = exclude_action(mask, inventory, task, [1])
            output = root / "turn-one"
            followup = generate_exclusion_followup_task(parent, exclusion, output)
            current = load_mask(output / "private/base-mask.png", polarity="bright")
            decision = {
                "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
                "action": {
                    "type": "claim_select",
                    "component_ids": [1],
                    "confidence": "high",
                    "reason_codes": ["same_word_body"],
                },
            }

            claim = build_bound_action(followup, decision, current)
            evaluation = evaluate_agent_action(output, claim)

            self.assertEqual(claim["turn"], 1)
            self.assertTrue(evaluation["strict_pass"])
            self.assertEqual(evaluation["metrics"]["precision"], 1.0)
            self.assertEqual(evaluation["metrics"]["recall"], 1.0)
            self.assertEqual(evaluation["metrics"]["neighbor_contamination"], 0.0)

    def test_chaining_creates_t2_and_preserves_parent_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            first_action = exclude_action(mask, inventory, task, [1])
            turn_one = root / "turn-one"
            first_task = generate_exclusion_followup_task(
                parent, first_action, turn_one
            )
            turn_one_before = snapshot(turn_one)
            turn_one_mask = load_mask(
                turn_one / "private/base-mask.png", polarity="bright"
            )
            turn_one_inventory = stable_components(turn_one_mask)[1]
            second_action = exclude_action(
                turn_one_mask, turn_one_inventory, first_task, [1]
            )
            turn_two = root / "turn-two"

            second_task = generate_exclusion_followup_task(
                turn_one, second_action, turn_two
            )

            self.assertEqual(second_task["task_id"], "w01-o-t2")
            self.assertEqual(second_task["turn"], 2)
            self.assertEqual(len(second_task["transition_lineage"]), 2)
            self.assertEqual(len(second_task["retired_component_history"]), 2)
            self.assertEqual(turn_one_before, snapshot(turn_one))
            history = load_mask(
                turn_two / "private/display-history-mask.png", polarity="bright"
            )
            self.assertTrue(history[12, 32])
            self.assertTrue(history[29, 61])

    def test_existing_or_symlink_destination_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent, mask, inventory, task = make_parent(root / "w01-o")
            action = exclude_action(mask, inventory, task, [1])
            existing = root / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "overwrite"):
                generate_exclusion_followup_task(parent, action, existing)

            symlink = root / "linked"
            symlink.symlink_to(existing, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                generate_exclusion_followup_task(parent, action, symlink)


def make_parent(
    root: Path,
) -> tuple[Path, np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    public = root / "public"
    private = root / "private"
    public.mkdir(parents=True)
    private.mkdir(parents=True)
    mask = np.zeros((40, 80), dtype=bool)
    mask[10:20, 8:20] = True  # target
    mask[10:20, 30:42] = True  # semantic neighbor / prior-owned ink
    mask[28:31, 60:64] = True  # unrelated debris
    labels, inventory = stable_components(mask)
    target = labels == inventory[0]["id"]
    neighbor = labels == inventory[1]["id"]

    save_mask(private / "base-mask.png", mask)
    save_mask(private / "truth-target-mask.png", target)
    save_mask(private / "truth-neighbor-mask.png", neighbor)
    prompt = public / "prompt.md"
    prompt.write_text("Choose exactly one strict ownership action.\n", "utf-8")
    work_crop = Image.new("RGB", (80, 40), "white")
    work_crop.save(public / "work-crop.png", format="PNG", compress_level=9)
    context_original = Image.new("RGB", (140, 100), "white")
    context_original.save(
        private / "context-original.png", format="PNG", compress_level=9
    )
    context_original.save(public / "context.png", format="PNG", compress_level=9)
    for name in ("board.png", "components.png", "ownership-state.png", "reading-view.png"):
        work_crop.save(public / name, format="PNG", compress_level=9)

    context_record = {
        "schema_version": CROP_SCHEMA_VERSION,
        "source": {
            "path": "/sealed/fixture/source.png",
            "sha256": "d" * 64,
            "width_px": 500,
            "height_px": 500,
        },
        "crop": {
            "path": str((private / "context-original.png").resolve()),
            "sha256": sha256_file(private / "context-original.png"),
            "pixel_sha256": sha256_image_pixels(context_original),
            "x": 0,
            "y": 0,
            "width_px": 140,
            "height_px": 100,
            "requested_box_xywh": [28, 40, 12, 10],
            "padding_px": 40,
        },
        "transform": {
            "type": "crop-edge-translation-v1",
            "crop_to_source": {"translate_x": 0, "translate_y": 0},
            "source_to_crop": {"translate_x": 0, "translate_y": 0},
        },
    }
    write_json(private / "context.json", context_record)
    public_assets = {
        "prompt": {"path": "prompt.md", "sha256": sha256_file(prompt)},
        "board": {
            "path": "board.png",
            "sha256": sha256_file(public / "board.png"),
        },
        "context": {
            "path": "context.png",
            "sha256": sha256_file(public / "context.png"),
        },
        "work_crop": {
            "path": "work-crop.png",
            "sha256": sha256_file(public / "work-crop.png"),
        },
        "components": {
            "path": "components.png",
            "sha256": sha256_file(public / "components.png"),
        },
        "ownership_state": {
            "path": "ownership-state.png",
            "sha256": sha256_file(public / "ownership-state.png"),
        },
        "reading_view": {
            "path": "reading-view.png",
            "sha256": sha256_file(public / "reading-view.png"),
        },
    }
    task_basis: dict[str, Any] = {
        "schema_version": AGENT_TASK_PACK_SCHEMA_VERSION,
        "task_id": "w01-o",
        "turn": 0,
        "target_transcript": "target",
        "target_unit": "single_word",
        "orientation_degrees": 0,
        "variant": "prior-owned",
        "prior_owned_ink_visible": True,
        "prior_owned_component_refs_exposed": True,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "work_size_wh": [80, 40],
        "active_target_box_work_xywh": [8, 10, 12, 10],
        "components": [component_reference(component) for component in inventory],
        "prior_owned_component_refs": [component_reference(inventory[1])],
        "software_preprocessing": {
            "kind": "declared-crop-perimeter-cuts-v1",
            "operation_count": 0,
            "provenance": "fixture",
            "output_state_sha256": sha256_mask_pixels(mask),
        },
        "reading_view": {
            "purpose": "reading_only",
            "source_asset": "ownership_state",
            "applied_rotation_degrees": 0.0,
            "coordinates_valid": False,
            "instruction": "fixture",
        },
        "allowed_action_schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "public_assets": public_assets,
    }
    task_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    task = {**task_basis, "task_pack_sha256": task_hash}
    write_json(public / "task.json", task)
    truth_record = {
        "schema_version": AGENT_TRUTH_SCHEMA_VERSION,
        "task_id": "w01-o",
        "case_id": "sealed-fixture",
        "pilot_tier": "routine",
        "input_assessment": {"status": "evaluable"},
        "stress_manifest_path": "/sealed/fixture/manifest.json",
        "stress_manifest_sha256": "e" * 64,
        "task_pack_sha256": task_hash,
        "prompt_sha256": sha256_file(prompt),
        "base_mask_pixel_sha256": sha256_mask_pixels(mask),
        "truth_target_mask_pixel_sha256": sha256_mask_pixels(target),
        "truth_neighbor_mask_pixel_sha256": sha256_mask_pixels(neighbor),
        "semantic_neighbor_pixels_excluded_outside_base": 0,
        "truth_target_component_refs": [component_reference(inventory[0])],
        "semantic_neighbor_available": True,
        "preprocessing_log": [],
        "context": context_record,
    }
    write_json(private / "truth.json", truth_record)
    return root, mask, inventory, task


def exclude_action(
    mask: np.ndarray,
    inventory: list[dict[str, Any]],
    task: dict[str, Any],
    component_indexes: list[int],
) -> dict[str, Any]:
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "task_pack_sha256": task["task_pack_sha256"],
        "turn": task["turn"],
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": {
            "type": "exclude",
            "component_refs": [
                component_reference(inventory[index]) for index in component_indexes
            ],
            "confidence": "high",
            "reason_codes": ["adjacent_word"],
        },
    }


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }
