from __future__ import annotations

import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from word_envelope.agent_benchmark import AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION
from word_envelope.agent_cohort import (
    AGENT_COHORT_COMPARISON_SCHEMA_VERSION,
    AGENT_COHORT_INDEX_SCHEMA_VERSION,
    MANAGED_RESULTS_SCHEMA_VERSION,
    compare_agent_cohorts,
    evaluate_agent_cohort,
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
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import save_mask, stable_components


class AgentCohortTests(unittest.TestCase):
    def test_missing_extra_and_duplicate_action_sets_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tasks = root / "tasks"
            actions = root / "actions"
            actions.mkdir()
            first = make_task(tasks / "one", "w01-c")
            second = make_task(tasks / "two", "w02-c")
            write_json(actions / "w01-c.json", exact_claim(*first))

            with self.assertRaisesRegex(EnvelopeError, "missing actions"):
                evaluate_agent_cohort(tasks, actions, root / "results")

            write_json(actions / "w02-c.json", exact_claim(*second))
            write_json(actions / "stray.json", exact_claim(*first))
            with self.assertRaisesRegex(EnvelopeError, "extra action"):
                evaluate_agent_cohort(tasks, actions, root / "results")

            (actions / "duplicate").mkdir()
            write_json(actions / "duplicate/w01-c.json", exact_claim(*first))
            with self.assertRaisesRegex(EnvelopeError, "duplicate actions"):
                evaluate_agent_cohort(
                    tasks,
                    actions,
                    root / "results",
                    allow_extra_actions=True,
                )

    def test_rerun_is_deterministic_and_prunes_only_managed_stale_results(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tasks = root / "tasks"
            actions = root / "actions"
            actions.mkdir()
            first = make_task(tasks / "one", "w01-c")
            second = make_task(tasks / "two", "w02-c")
            write_json(actions / "w01-c.json", exact_claim(*first))
            write_json(actions / "w02-c.json", exact_claim(*second))
            output = root / "results"

            evaluate_agent_cohort(tasks, actions, output)
            unrelated = output / "user-notes"
            unrelated.mkdir()
            (unrelated / "keep.txt").write_text("keep me", encoding="utf-8")

            evaluate_agent_cohort(
                tasks,
                actions,
                output,
                task_ids=["w01-c"],
                allow_extra_actions=True,
            )
            self.assertFalse((output / "w02-c").exists())
            self.assertEqual((unrelated / "keep.txt").read_text("utf-8"), "keep me")
            snapshot = file_snapshot(output)

            evaluate_agent_cohort(
                tasks,
                actions,
                output,
                task_ids=["w01-c"],
                allow_extra_actions=True,
            )
            self.assertEqual(snapshot, file_snapshot(output))
            self.assertEqual(
                read_json(output / "managed-results.json"),
                {
                    "schema_version": MANAGED_RESULTS_SCHEMA_VERSION,
                    "task_ids": ["w01-c"],
                },
            )

    def test_writes_aggregate_and_per_task_index(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tasks = root / "tasks"
            actions = root / "actions"
            actions.mkdir()
            exact = make_task(tasks / "exact", "w01-c")
            invalid = make_task(
                tasks / "invalid", "w02-c", assessment_status="invalid_input"
            )
            write_json(actions / "w01-c.json", exact_claim(*exact))
            write_json(actions / "w02-c.json", manual_deferral(*invalid))

            cohort = evaluate_agent_cohort(tasks, actions, root / "results")

            aggregate = cohort["aggregate"]
            index = cohort["index"]
            self.assertEqual(
                aggregate["schema_version"],
                AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION,
            )
            self.assertEqual(aggregate["result_count"], 2)
            self.assertEqual(aggregate["strict_passes"], 1)
            self.assertEqual(aggregate["correct_invalid_deferrals"], 1)
            self.assertEqual(
                read_json(root / "results/summary.json"), aggregate
            )
            self.assertEqual(
                index["schema_version"], AGENT_COHORT_INDEX_SCHEMA_VERSION
            )
            self.assertEqual(index["evaluated_task_ids"], ["w01-c", "w02-c"])
            self.assertEqual(index["tasks"][0]["disposition"], "accepted")
            self.assertIsNotNone(index["tasks"][0]["metrics"])
            self.assertEqual(
                index["tasks"][1]["disposition"], "correct_invalid_deferral"
            )
            self.assertIsNone(index["tasks"][1]["metrics"])

    def test_matched_comparison_reports_outcomes_without_fake_deferral_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            left_tasks = root / "left-tasks"
            right_tasks = root / "right-tasks"
            left_actions = root / "left-actions"
            right_actions = root / "right-actions"
            left_actions.mkdir()
            right_actions.mkdir()
            left = make_task(left_tasks / "one", "w01-c", case_id="same-case")
            right = make_task(right_tasks / "one", "w01-o", case_id="same-case")
            write_json(left_actions / "w01-c.json", exact_claim(*left))
            write_json(right_actions / "w01-o.json", manual_deferral(*right))
            left_output = root / "left-results"
            right_output = root / "right-results"
            evaluate_agent_cohort(left_tasks, left_actions, left_output)
            evaluate_agent_cohort(right_tasks, right_actions, right_output)

            comparison = compare_agent_cohorts(
                left_output,
                right_output,
                left_label="context",
                right_label="assisted",
            )

            self.assertEqual(
                comparison["schema_version"],
                AGENT_COHORT_COMPARISON_SCHEMA_VERSION,
            )
            self.assertEqual(comparison["matched_task_base_ids"], ["w01"])
            self.assertEqual(
                comparison["matched_counts"]["deltas"]["strict_pass"], -1
            )
            self.assertEqual(
                comparison["matched_counts"]["deltas"]["deferrals"], 1
            )
            pair = comparison["tasks"][0]
            self.assertEqual(pair["left"]["disposition"], "accepted")
            self.assertEqual(pair["right"]["disposition"], "unnecessary_deferral")
            self.assertFalse(pair["pixel_metric_comparison"]["comparable"])
            self.assertNotIn("metrics", pair["pixel_metric_comparison"])

    def test_matched_comparison_separates_tool_progress_from_deferral(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            left_tasks = root / "left-tasks"
            right_tasks = root / "right-tasks"
            left_actions = root / "left-actions"
            right_actions = root / "right-actions"
            left_actions.mkdir()
            right_actions.mkdir()
            left = make_task(left_tasks / "one", "w01-c", case_id="same-case")
            right = make_task(right_tasks / "one", "w01-o", case_id="same-case")
            write_json(left_actions / "w01-c.json", exact_claim(*left))
            write_json(right_actions / "w01-o.json", exclude_neighbor(*right))
            left_output = root / "left-results"
            right_output = root / "right-results"
            evaluate_agent_cohort(left_tasks, left_actions, left_output)
            evaluate_agent_cohort(right_tasks, right_actions, right_output)

            comparison = compare_agent_cohorts(left_output, right_output)

            right_counts = comparison["matched_counts"]["right"]
            self.assertEqual(right_counts["deferrals"], 0)
            self.assertEqual(right_counts["manual_deferrals"], 0)
            self.assertEqual(right_counts["nonterminal_actions"], 1)
            right_outcome = comparison["tasks"][0]["right"]
            self.assertFalse(right_outcome["deferred"])
            self.assertTrue(right_outcome["nonterminal_action"])


def make_task(
    root: Path,
    task_id: str,
    *,
    assessment_status: str = "evaluable",
    case_id: str | None = None,
) -> tuple[np.ndarray, list[dict[str, object]], dict[str, object]]:
    public = root / "public"
    private = root / "private"
    public.mkdir(parents=True)
    private.mkdir(parents=True)
    mask = np.zeros((14, 22), dtype=bool)
    mask[2:7, 2:7] = True
    mask[2:7, 13:18] = True
    labels, inventory = stable_components(mask)
    target = labels == inventory[0]["id"]
    neighbor = labels == inventory[1]["id"]
    save_mask(private / "base-mask.png", mask)
    save_mask(private / "truth-target-mask.png", target)
    save_mask(private / "truth-neighbor-mask.png", neighbor)
    work_crop = public / "work-crop.png"
    Image.new("RGB", (mask.shape[1], mask.shape[0]), "white").save(work_crop)
    task_basis: dict[str, object] = {
        "schema_version": AGENT_TASK_PACK_SCHEMA_VERSION,
        "task_id": task_id,
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
        "notes": "test assessment",
    }
    if assessment_status == "invalid_input":
        assessment["reason_code"] = "target_crop_clipped"
    truth = {
        "schema_version": AGENT_TRUTH_SCHEMA_VERSION,
        "task_id": task_id,
        "case_id": case_id or f"case-{task_id}",
        "task_pack_sha256": task_hash,
        "input_assessment": assessment,
        "base_mask_pixel_sha256": sha256_mask_pixels(mask),
        "truth_target_mask_pixel_sha256": sha256_mask_pixels(target),
        "truth_neighbor_mask_pixel_sha256": sha256_mask_pixels(neighbor),
        "truth_target_component_refs": [component_reference(inventory[0])],
        "semantic_neighbor_available": True,
    }
    write_json(private / "truth.json", truth)
    return mask, inventory, task


def exact_claim(
    mask: np.ndarray,
    inventory: list[dict[str, object]],
    task: dict[str, object],
) -> dict[str, object]:
    return action_record(
        mask,
        inventory,
        task,
        {
            "type": "claim_select",
            "target_component_refs": [component_reference(inventory[0])],
            "confidence": "high",
            "reason_codes": ["same_word_body"],
        },
    )


def manual_deferral(
    mask: np.ndarray,
    inventory: list[dict[str, object]],
    task: dict[str, object],
) -> dict[str, object]:
    return action_record(
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


def exclude_neighbor(
    mask: np.ndarray,
    inventory: list[dict[str, object]],
    task: dict[str, object],
) -> dict[str, object]:
    return action_record(
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


def file_snapshot(root: Path) -> list[tuple[str, str]]:
    return [
        (path.relative_to(root).as_posix(), sha256_file(path))
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


if __name__ == "__main__":
    unittest.main()
