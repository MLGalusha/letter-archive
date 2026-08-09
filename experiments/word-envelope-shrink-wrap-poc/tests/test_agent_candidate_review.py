from __future__ import annotations

import copy
import hashlib
import inspect
import tempfile
import unittest
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from word_envelope.agent_action_builder import build_bound_action
from word_envelope.agent_candidate_review import (
    AGENT_CANDIDATE_REVIEW_SCHEMA_VERSION,
    generate_candidate_review_pack,
    generate_exclusion_review_pack,
)
from word_envelope.agent_ownership import (
    AGENT_OWNERSHIP_SCHEMA_VERSION,
    apply_single_action,
    component_inventory_sha256,
    component_reference,
)
from word_envelope.engine import EnvelopeError
from word_envelope.io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import stable_components
from word_envelope.render import save_component_overlay


class AgentCandidateReviewTests(unittest.TestCase):
    def test_generates_deterministic_public_review_and_replayable_choices(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, mask, task, claim = make_public_fixture(root / "source")
            private = root / "source/private"
            private.mkdir()
            write_json(
                private / "truth.json",
                {"truth_target_mask": "PRIVATE-SENTINEL-MUST-NOT-LEAK"},
            )

            first = generate_candidate_review_pack(
                task,
                mask,
                claim,
                public,
                root / "review-a",
                maximum_counterfactuals=4,
            )
            second = generate_candidate_review_pack(
                task,
                mask,
                claim,
                public,
                root / "review-b",
                maximum_counterfactuals=4,
            )

            self.assertEqual(first, second)
            self.assertEqual(snapshot(root / "review-a"), snapshot(root / "review-b"))
            self.assertEqual(
                first["schema_version"], AGENT_CANDIDATE_REVIEW_SCHEMA_VERSION
            )
            self.assertEqual(first["selected_component_ids"], [1, 2])
            self.assertEqual(first["task_binding"]["task_pack_sha256"], task["task_pack_sha256"])
            review_basis = copy.deepcopy(first)
            review_hash = review_basis.pop("review_pack_sha256")
            self.assertEqual(
                review_hash,
                hashlib.sha256(canonical_json_bytes(review_basis)).hexdigest(),
            )

            required = {
                "large_context",
                "numbered_components",
                "task_reading_view",
                "selection_overlay",
                "selection_reading_view",
                "counterfactuals",
                "review_board",
                "critic_instructions",
            }
            self.assertEqual(set(first["review_assets"]), required)
            for asset in first["review_assets"].values():
                path = root / "review-a" / asset["path"]
                self.assertTrue(path.is_file())
                self.assertEqual(asset["sha256"], sha256_file(path))

            edits = {item["edit"] for item in first["counterfactuals"]}
            self.assertEqual(edits, {"add", "remove"})
            for item in first["counterfactuals"]:
                preview = root / "review-a" / item["preview"]["path"]
                self.assertTrue(preview.is_file())
                self.assertEqual(item["preview"]["sha256"], sha256_file(preview))
                rebound = build_bound_action(
                    task,
                    item["compact_decision"],
                    current_mask=mask,
                )
                if rebound["action"]["type"] == "claim_select":
                    self.assertEqual(
                        [
                            ref["id"]
                            for ref in rebound["action"]["target_component_refs"]
                        ],
                        item["resulting_component_ids"],
                    )

            manual = first["critic_response"]["defer_manual_example"]
            self.assertEqual(
                build_bound_action(task, manual, current_mask=mask)["action"]["type"],
                "defer_manual",
            )
            self.assertEqual(first, read_json(root / "review-a/review.json"))
            public_text = "\n".join(
                path.read_text("utf-8")
                for path in (root / "review-a").rglob("*")
                if path.is_file() and path.suffix in {".json", ".md"}
            )
            self.assertNotIn("PRIVATE-SENTINEL-MUST-NOT-LEAK", public_text)
            self.assertNotIn("truth_target", public_text)
            self.assertFalse((root / "review-a/private").exists())

    def test_public_apis_have_no_truth_or_private_inputs(self) -> None:
        for function in (
            generate_candidate_review_pack,
            generate_exclusion_review_pack,
        ):
            parameter_names = set(inspect.signature(function).parameters)
            self.assertFalse(
                {
                    "truth",
                    "truth_mask",
                    "truth_target",
                    "truth_neighbor",
                    "private_dir",
                    "case_id",
                    "pilot_tier",
                    "input_assessment",
                }
                & parameter_names
            )

    def test_previews_exclusion_before_commit_with_approve_or_rollback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, mask, task, _ = make_public_fixture(root / "source")
            compact_exclusion = {
                "schema_version": "word-ink-ownership-decision.v1",
                "action": {
                    "type": "exclude",
                    "component_ids": [1],
                    "confidence": "medium",
                    "reason_codes": ["adjacent_word"],
                },
            }
            bound_exclusion = build_bound_action(
                task, compact_exclusion, current_mask=mask
            )
            before_hash = sha256_mask_pixels(mask)

            review = generate_exclusion_review_pack(
                task,
                mask,
                bound_exclusion,
                public,
                root / "exclude-review",
            )

            self.assertEqual(review["review_kind"], "exclude_before_commit")
            self.assertEqual(review["proposed_excluded_component_ids"], [1])
            self.assertEqual(sha256_mask_pixels(mask), before_hash)
            simulated = apply_single_action(bound_exclusion, mask)
            self.assertEqual(
                review["proposed_output_state_sha256"],
                simulated.output_mask_pixel_sha256,
            )
            for name in (
                "exclude_before",
                "exclude_after",
                "removed_ink",
                "exclude_before_reading",
                "exclude_after_reading",
                "exclude_review_board",
            ):
                asset = review["review_assets"][name]
                self.assertEqual(
                    asset["sha256"],
                    sha256_file(root / "exclude-review" / asset["path"]),
                )

            approve = review["critic_response"]["approve_exact_proposal"]
            self.assertEqual(
                build_bound_action(task, approve, current_mask=mask),
                bound_exclusion,
            )
            rollback = review["critic_response"]["rollback_keep_current_state"]
            self.assertEqual(
                build_bound_action(task, rollback, current_mask=mask)["action"][
                    "type"
                ],
                "defer_manual",
            )

            with Image.open(
                root / "exclude-review" / review["review_assets"]["exclude_before"]["path"]
            ) as source:
                before_pixel = source.convert("RGB").getpixel((16, 22))
            with Image.open(
                root / "exclude-review" / review["review_assets"]["exclude_after"]["path"]
            ) as source:
                after_pixel = source.convert("RGB").getpixel((16, 22))
            self.assertGreater(before_pixel[0], before_pixel[1] * 2)
            self.assertGreater(min(after_pixel), 240)

    def test_rejects_task_asset_mask_and_bound_claim_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, mask, task, claim = make_public_fixture(root / "source")

            stale_task = copy.deepcopy(task)
            stale_task["target_transcript"] = "tampered"
            with self.assertRaisesRegex(EnvelopeError, "task_pack_sha256"):
                generate_candidate_review_pack(
                    stale_task,
                    mask,
                    claim,
                    public,
                    root / "stale-task",
                )

            private_task = copy.deepcopy(task)
            private_task["truth_target_mask"] = "forbidden"
            private_task.pop("task_pack_sha256")
            private_task["task_pack_sha256"] = hashlib.sha256(
                canonical_json_bytes(private_task)
            ).hexdigest()
            with self.assertRaisesRegex(EnvelopeError, "private task field"):
                generate_candidate_review_pack(
                    private_task,
                    mask,
                    claim,
                    public,
                    root / "private-task",
                )

            stale_mask = mask.copy()
            stale_mask[1, 1] = True
            with self.assertRaisesRegex(EnvelopeError, "input_state_sha256"):
                generate_candidate_review_pack(
                    task,
                    stale_mask,
                    claim,
                    public,
                    root / "stale-mask",
                )

            stale_claim = copy.deepcopy(claim)
            stale_claim["task_pack_sha256"] = "f" * 64
            with self.assertRaisesRegex(EnvelopeError, "does not exactly match"):
                generate_candidate_review_pack(
                    task,
                    mask,
                    stale_claim,
                    public,
                    root / "stale-claim",
                )

            context = public / task["public_assets"]["context"]["path"]
            Image.new("RGB", (240, 140), "black").save(
                context, format="PNG", compress_level=9, optimize=False
            )
            with self.assertRaisesRegex(EnvelopeError, "asset hash drift"):
                generate_candidate_review_pack(
                    task,
                    mask,
                    claim,
                    public,
                    root / "stale-asset",
                )

            for name in (
                "stale-task",
                "private-task",
                "stale-mask",
                "stale-claim",
                "stale-asset",
            ):
                self.assertFalse((root / name).exists())

    def test_refuses_overwrite_symlink_and_source_containment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, mask, task, claim = make_public_fixture(root / "source")
            existing = root / "existing"
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, "overwrite"):
                generate_candidate_review_pack(
                    task, mask, claim, public, existing
                )

            linked = root / "linked"
            linked.symlink_to(existing, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                generate_candidate_review_pack(task, mask, claim, public, linked)

            with self.assertRaisesRegex(ValueError, "contain"):
                generate_candidate_review_pack(
                    task,
                    mask,
                    claim,
                    public,
                    public / "nested-review",
                )

    def test_rejects_symlinked_or_hash_drifted_public_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public, mask, task, claim = make_public_fixture(root / "source")
            context = public / task["public_assets"]["context"]["path"]
            real_context = root / "context-copy.png"
            real_context.write_bytes(context.read_bytes())
            context.unlink()
            context.symlink_to(real_context)

            with self.assertRaisesRegex(EnvelopeError, "safe public asset|escapes"):
                generate_candidate_review_pack(
                    task,
                    mask,
                    claim,
                    public,
                    root / "linked-asset-review",
                )


def make_public_fixture(
    root: Path,
) -> tuple[Path, np.ndarray, dict[str, Any], dict[str, Any]]:
    public = root / "public"
    public.mkdir(parents=True)
    mask = np.zeros((60, 120), dtype=bool)
    mask[18:30, 12:28] = True
    mask[18:30, 38:54] = True
    mask[18:30, 76:94] = True
    mask[43:48, 35:41] = True
    labels, inventory = stable_components(mask)

    pixels = np.full((60, 120, 3), 248, dtype=np.uint8)
    pixels[mask] = (30, 28, 27)
    work_crop = Image.fromarray(pixels, mode="RGB")
    work_crop.save(
        public / "work-crop.png", format="PNG", compress_level=9, optimize=False
    )

    ownership = work_crop.convert("RGBA")
    tint = np.zeros((60, 120, 4), dtype=np.uint8)
    tint[mask] = (235, 157, 40, 80)
    tint[labels == 3] = (225, 55, 65, 200)
    ownership = Image.alpha_composite(
        ownership, Image.fromarray(tint, mode="RGBA")
    ).convert("RGB")
    ownership.save(
        public / "ownership-state.png",
        format="PNG",
        compress_level=9,
        optimize=False,
    )

    context = Image.new("RGB", (240, 140), (244, 241, 235))
    context.paste(ownership, (60, 40))
    context.save(
        public / "context.png", format="PNG", compress_level=9, optimize=False
    )
    reading = ownership.rotate(
        -90,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(255, 255, 255),
    )
    reading.save(
        public / "reading-view.png",
        format="PNG",
        compress_level=9,
        optimize=False,
    )
    save_component_overlay(public / "components.png", work_crop, mask)

    public_assets = {
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
        "schema_version": "word-ink-agent-task-pack.v1",
        "task_id": "candidate-review-fixture",
        "turn": 0,
        "target_transcript": "target word",
        "target_unit": "multi_word_phrase",
        "orientation_degrees": 90,
        "variant": "prior-owned-red-and-refs",
        "prior_owned_ink_visible": True,
        "prior_owned_component_refs_exposed": True,
        "input_state_sha256": sha256_mask_pixels(mask),
        "component_inventory_sha256": component_inventory_sha256(inventory),
        "work_size_wh": [mask.shape[1], mask.shape[0]],
        "active_target_box_work_xywh": [8, 14, 52, 22],
        "components": [component_reference(item) for item in inventory],
        "prior_owned_component_refs": [component_reference(inventory[2])],
        "reading_view": {
            "purpose": "reading_only",
            "source_asset": "ownership_state",
            "applied_rotation_degrees": -90.0,
            "coordinates_valid": False,
            "instruction": "Use only for reading.",
        },
        "allowed_action_schema_version": AGENT_OWNERSHIP_SCHEMA_VERSION,
        "public_assets": public_assets,
    }
    task = {
        **task_basis,
        "task_pack_sha256": hashlib.sha256(
            canonical_json_bytes(task_basis)
        ).hexdigest(),
    }
    write_json(public / "task.json", task)
    compact = {
        "schema_version": "word-ink-ownership-decision.v1",
        "action": {
            "type": "claim_select",
            "component_ids": [1, 2],
            "confidence": "medium",
            "reason_codes": ["same_word_body"],
        },
    }
    claim = build_bound_action(task, compact, current_mask=mask)
    return public, mask, task, claim


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


if __name__ == "__main__":
    unittest.main()
