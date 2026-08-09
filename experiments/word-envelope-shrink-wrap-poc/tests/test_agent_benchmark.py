from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from word_envelope.agent_benchmark import (
    aggregate_agent_results,
    evaluate_agent_action,
)
from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    component_inventory_sha256,
    component_reference,
)
from word_envelope.agent_packs import (
    AGENT_TASK_PACK_SCHEMA_VERSION,
    AGENT_TRUTH_SCHEMA_VERSION,
)
from word_envelope.io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import save_mask, stable_components


class AgentBenchmarkTests(unittest.TestCase):
    def test_exact_claim_is_a_strict_pass_and_saves_replay_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(Path(temporary))
            action = claim_action(mask, inventory, task, [0])
            action_path = root / "exact-action.json"
            write_json(action_path, action)
            output_dir = root / "evaluation"

            result = evaluate_agent_action(root, action_path, output_dir=output_dir)

            self.assertTrue(result["action_valid"])
            self.assertTrue(result["replay_valid"])
            self.assertTrue(result["claimed_subset_of_raw"])
            self.assertTrue(result["strict_pass"])
            self.assertFalse(result["false_accept"])
            self.assertEqual(result["metrics"]["precision"], 1.0)
            self.assertEqual(result["metrics"]["recall"], 1.0)
            self.assertEqual(
                result["metrics"]["minimum_target_component_recall"], 1.0
            )
            self.assertEqual(
                result["metrics"]["macro_target_component_recall"], 1.0
            )
            self.assertEqual(
                result["metrics"]["wholly_missed_target_component_count"], 0
            )
            self.assertEqual(result["metrics"]["generic_debris_fraction"], 0.0)
            self.assertTrue((output_dir / "claimed-mask.png").is_file())
            self.assertTrue((output_dir / "scoring-overlay.png").is_file())
            self.assertEqual(read_json(output_dir / "result.json"), result)

    def test_complete_claim_that_includes_neighbor_is_false_accept(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(Path(temporary))
            action = claim_action(mask, inventory, task, [0, 1])

            result = evaluate_agent_action(root, action)

            self.assertTrue(result["completed_claim"])
            self.assertFalse(result["strict_pass"])
            self.assertTrue(result["false_accept"])
            self.assertEqual(result["metrics"]["neighbor_contamination"], 1.0)
            self.assertIn(
                "neighbor_contamination", result["strict_gate"]["failed_checks"]
            )
            self.assertIn("precision", result["strict_gate"]["failed_checks"])

    def test_invalid_input_manual_abstention_is_correct(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(
                Path(temporary), assessment_status="invalid_input"
            )
            action = action_record(
                mask,
                inventory,
                task,
                {
                    "type": "defer_manual",
                    "disposition": "clipped_target",
                    "confidence": "high",
                    "reason_codes": ["clipped_ink"],
                },
            )

            result = evaluate_agent_action(root, action)

            self.assertTrue(result["expected_invalid_input"])
            self.assertTrue(result["correct_human_or_invalid_deferral"])
            self.assertTrue(result["correct_invalid_deferral"])
            self.assertFalse(result["unnecessary_deferral"])
            self.assertEqual(result["disposition"], "correct_invalid_deferral")

    def test_nonterminal_exclusion_is_scored_for_target_damage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(Path(temporary))
            safe = action_record(
                mask,
                inventory,
                task,
                {
                    "type": "exclude",
                    "component_refs": [component_reference(inventory[1])],
                    "confidence": "high",
                    "reason_codes": ["adjacent_word"],
                },
            )
            unsafe = action_record(
                mask,
                inventory,
                task,
                {
                    "type": "exclude",
                    "component_refs": [component_reference(inventory[0])],
                    "confidence": "high",
                    "reason_codes": ["adjacent_word"],
                },
            )

            safe_result = evaluate_agent_action(root, safe)
            unsafe_result = evaluate_agent_action(root, unsafe)

            self.assertTrue(safe_result["safe_nonterminal_action"])
            self.assertFalse(safe_result["unsafe_tool_action"])
            self.assertEqual(safe_result["disposition"], "requires_later_turn")
            self.assertEqual(
                safe_result["tool_action_metrics"]["removed_target_pixels"], 0
            )
            self.assertGreater(
                safe_result["tool_action_metrics"]["removed_neighbor_pixels"], 0
            )
            self.assertFalse(unsafe_result["safe_nonterminal_action"])
            self.assertTrue(unsafe_result["unsafe_tool_action"])
            self.assertEqual(unsafe_result["disposition"], "unsafe_tool_action")
            self.assertGreater(
                unsafe_result["tool_action_metrics"]["removed_target_pixels"], 0
            )

    def test_stale_task_pack_binding_is_a_replay_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(Path(temporary))
            action = claim_action(mask, inventory, task, [0])
            action["task_pack_sha256"] = "f" * 64

            result = evaluate_agent_action(root, action)

            self.assertFalse(result["action_valid"])
            self.assertFalse(result["replay_valid"])
            self.assertFalse(result["completed_claim"])
            self.assertEqual(result["disposition"], "invalid_action")
            self.assertIn("task_pack_sha256", result["error"]["message"])

    def test_neighbor_truth_outside_base_mask_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, _, _, _ = make_task(Path(temporary))
            neighbor_path = root / "private/truth-neighbor-mask.png"
            neighbor = np.zeros((16, 26), dtype=bool)
            neighbor[0, 0] = True
            save_mask(neighbor_path, neighbor)
            truth_path = root / "private/truth.json"
            truth = read_json(truth_path)
            truth["truth_neighbor_mask_pixel_sha256"] = sha256_mask_pixels(neighbor)
            write_json(truth_path, truth)

            with self.assertRaisesRegex(
                Exception, "Neighbor truth mask must be contained"
            ):
                evaluate_agent_action(root, root / "missing-action.json")

    def test_repeated_deferral_removes_stale_claim_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root, mask, inventory, task = make_task(Path(temporary))
            output = root / "evaluation"
            evaluate_agent_action(
                root, claim_action(mask, inventory, task, [0]), output_dir=output
            )
            self.assertTrue((output / "claimed-mask.png").exists())

            deferral = action_record(
                mask,
                inventory,
                task,
                {
                    "type": "defer_manual",
                    "disposition": "ambiguous_ownership",
                    "confidence": "low",
                    "reason_codes": ["uncertain_reading"],
                },
            )
            evaluate_agent_action(root, deferral, output_dir=output)

            self.assertFalse((output / "claimed-mask.png").exists())
            self.assertFalse((output / "scoring-overlay.png").exists())
            self.assertTrue((output / "result.json").exists())

    def test_aggregate_counts_outcomes_and_summarizes_claim_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            exact_root, mask, inventory, task = make_task(base / "exact")
            exact = evaluate_agent_action(
                exact_root, claim_action(mask, inventory, task, [0])
            )
            false_root, mask, inventory, task = make_task(base / "false")
            false_accept = evaluate_agent_action(
                false_root, claim_action(mask, inventory, task, [0, 1])
            )
            invalid_root, mask, inventory, task = make_task(
                base / "invalid", assessment_status="invalid_input"
            )
            invalid_defer = evaluate_agent_action(
                invalid_root,
                action_record(
                    mask,
                    inventory,
                    task,
                    {
                        "type": "defer_manual",
                        "disposition": "insufficient_visual_evidence",
                        "confidence": "high",
                        "reason_codes": ["uncertain_reading"],
                    },
                ),
            )
            defer_root, mask, inventory, task = make_task(base / "unnecessary")
            unnecessary_defer = evaluate_agent_action(
                defer_root,
                action_record(
                    mask,
                    inventory,
                    task,
                    {
                        "type": "defer_manual",
                        "disposition": "ambiguous_ownership",
                        "confidence": "low",
                        "reason_codes": ["uncertain_reading"],
                    },
                ),
            )
            stale_root, mask, inventory, task = make_task(base / "stale")
            stale = claim_action(mask, inventory, task, [0])
            stale["task_pack_sha256"] = "e" * 64
            replay_failure = evaluate_agent_action(stale_root, stale)
            result_path = base / "exact-result.json"
            write_json(result_path, exact)

            aggregate = aggregate_agent_results(
                [
                    result_path,
                    false_accept,
                    invalid_defer,
                    unnecessary_defer,
                    replay_failure,
                ]
            )

            self.assertEqual(aggregate["result_count"], 5)
            self.assertEqual(aggregate["valid_actions"], 4)
            self.assertEqual(aggregate["invalid_actions"], 1)
            self.assertEqual(aggregate["strict_passes"], 1)
            self.assertEqual(aggregate["false_accepts"], 1)
            self.assertEqual(
                aggregate["correct_human_or_invalid_deferrals"], 1
            )
            self.assertEqual(aggregate["unnecessary_deferrals"], 1)
            self.assertEqual(
                aggregate["metric_summaries"]["precision"]["count"], 2
            )
            self.assertEqual(
                aggregate["rates"]["strict_pass_rate_per_evaluable_claim"], 0.5
            )


def make_task(
    root: Path, *, assessment_status: str = "evaluable"
) -> tuple[Path, np.ndarray, list[dict[str, object]], dict[str, object]]:
    public = root / "public"
    private = root / "private"
    public.mkdir(parents=True)
    private.mkdir(parents=True)
    mask = np.zeros((16, 26), dtype=bool)
    mask[2:7, 2:7] = True  # target, 25 px
    mask[2:7, 12:17] = True  # semantic neighbor, 25 px
    mask[11:13, 21:23] = True  # generic debris, 4 px
    labels, inventory = stable_components(mask)
    truth_target = labels == inventory[0]["id"]
    truth_neighbor = labels == inventory[1]["id"]
    save_mask(private / "base-mask.png", mask)
    save_mask(private / "truth-target-mask.png", truth_target)
    save_mask(private / "truth-neighbor-mask.png", truth_neighbor)
    work_crop = public / "work-crop.png"
    Image.new("RGB", (mask.shape[1], mask.shape[0]), "white").save(work_crop)
    task_basis: dict[str, object] = {
        "schema_version": AGENT_TASK_PACK_SCHEMA_VERSION,
        "task_id": f"fixture-{root.name}",
        "turn": 0,
        "variant": "test",
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "work_size_wh": [mask.shape[1], mask.shape[0]],
        "components": [component_reference(item) for item in inventory],
        "public_assets": {
            "work_crop": {
                "path": "work-crop.png",
                "sha256": sha256_file(work_crop),
            }
        },
    }
    task_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    task = {**task_basis, "task_pack_sha256": task_hash}
    write_json(public / "task.json", task)
    assessment: dict[str, str] = {
        "status": assessment_status,
        "notes": "frozen test assessment",
    }
    if assessment_status == "invalid_input":
        assessment["reason_code"] = "target_crop_clipped"
    truth = {
        "schema_version": AGENT_TRUTH_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "case_id": f"case-{root.name}",
        "task_pack_sha256": task_hash,
        "input_assessment": assessment,
        "base_mask_pixel_sha256": sha256_mask_pixels(mask),
        "truth_target_mask_pixel_sha256": sha256_mask_pixels(truth_target),
        "truth_neighbor_mask_pixel_sha256": sha256_mask_pixels(truth_neighbor),
        "truth_target_component_refs": [component_reference(inventory[0])],
        "semantic_neighbor_available": True,
    }
    write_json(private / "truth.json", truth)
    return root, mask, inventory, task


def claim_action(
    mask: np.ndarray,
    inventory: list[dict[str, object]],
    task: dict[str, object],
    component_indexes: list[int],
) -> dict[str, object]:
    return action_record(
        mask,
        inventory,
        task,
        {
            "type": "claim_select",
            "target_component_refs": [
                component_reference(inventory[index]) for index in component_indexes
            ],
            "confidence": "high",
            "reason_codes": ["same_word_body"],
        },
    )


def action_record(
    mask: np.ndarray,
    inventory: list[dict[str, object]],
    task: dict[str, object],
    action: dict[str, object],
) -> dict[str, object]:
    return {
        "schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "task_pack_sha256": task["task_pack_sha256"],
        "turn": task["turn"],
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "action": copy.deepcopy(action),
    }


if __name__ == "__main__":
    unittest.main()
