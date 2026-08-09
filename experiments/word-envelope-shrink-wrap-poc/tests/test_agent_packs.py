from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from word_envelope.agent_packs import (
    AGENT_BENCHMARK_SCHEMA_VERSION,
    generate_agent_task_packs,
    stage_public_task_packs,
)
from word_envelope.io_utils import (
    CLEANUP_SCHEMA_VERSION,
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import (
    apply_cleanup_operations,
    load_mask,
    save_mask,
    stable_components,
)


class AgentTaskPackTests(unittest.TestCase):
    def test_public_pack_is_blinded_bound_and_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            output = root / "agent-packs"

            first = generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                output,
                prompt_path=prompt_path,
            )
            first_snapshot = _snapshot(output)
            second = generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                output,
                prompt_path=prompt_path,
            )

            self.assertEqual(first, second)
            self.assertEqual(first_snapshot, _snapshot(output))
            self.assertEqual(first["task_count"], 3)
            self.assertEqual(first["prompt_sha256"], sha256_file(prompt_path))

            for task_id in ("w01-c", "w01-r", "w01-o"):
                task_dir = output / task_id
                public = task_dir / "public"
                task = read_json(public / "task.json")
                task_hash = task.pop("task_pack_sha256")
                self.assertEqual(
                    task_hash,
                    hashlib.sha256(canonical_json_bytes(task)).hexdigest(),
                )
                for asset in task["public_assets"].values():
                    self.assertEqual(
                        asset["sha256"], sha256_file(public / asset["path"])
                    )
                self.assertEqual(
                    task["public_assets"]["prompt"]["sha256"],
                    sha256_file(prompt_path),
                )
                self.assertEqual(
                    (public / "prompt.md").read_text("utf-8"),
                    prompt_path.read_text("utf-8"),
                )
                self.assertEqual(task["reading_view"]["purpose"], "reading_only")
                self.assertFalse(task["reading_view"]["coordinates_valid"])

                public_text = "\n".join(
                    path.read_text("utf-8")
                    for path in public.rglob("*.json")
                )
                self.assertNotIn("secret-source-case", public_text)
                self.assertNotIn("pilot_tier", public_text)
                self.assertNotIn("input_assessment", public_text)
                self.assertNotIn("truth_target", public_text)
                self.assertFalse((public / "truth.json").exists())
                self.assertTrue((task_dir / "private/truth.json").exists())
                truth = read_json(task_dir / "private/truth.json")
                self.assertEqual(truth["prompt_sha256"], sha256_file(prompt_path))

            context_only = read_json(output / "w01-c/public/task.json")
            red_only = read_json(output / "w01-r/public/task.json")
            assisted = read_json(output / "w01-o/public/task.json")
            self.assertFalse(context_only["prior_owned_ink_visible"])
            self.assertEqual(context_only["prior_owned_component_refs"], [])
            self.assertTrue(red_only["prior_owned_ink_visible"])
            self.assertFalse(red_only["prior_owned_component_refs_exposed"])
            self.assertEqual(red_only["prior_owned_component_refs"], [])
            self.assertTrue(assisted["prior_owned_ink_visible"])
            self.assertTrue(assisted["prior_owned_component_refs_exposed"])
            self.assertEqual(len(assisted["prior_owned_component_refs"]), 1)
            self.assertEqual(
                red_only["public_assets"]["ownership_state"]["sha256"],
                assisted["public_assets"]["ownership_state"]["sha256"],
            )
            self.assertEqual(
                red_only["public_assets"]["context"]["sha256"],
                assisted["public_assets"]["context"]["sha256"],
            )
            for invariant_asset in (
                "prompt",
                "context",
                "work_crop",
                "components",
                "ownership_state",
                "reading_view",
            ):
                self.assertEqual(
                    red_only["public_assets"][invariant_asset]["sha256"],
                    assisted["public_assets"][invariant_asset]["sha256"],
                )

    def test_prompt_and_target_transcript_are_required_before_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            empty_prompt = root / "empty.md"
            empty_prompt.write_text("  \n", "utf-8")
            for invalid_prompt in (root / "missing.md", empty_prompt):
                with self.subTest(prompt=invalid_prompt.name):
                    with self.assertRaisesRegex(ValueError, "prompt"):
                        generate_agent_task_packs(
                            pilot_path,
                            manifest_path,
                            artifacts,
                            root / f"output-{invalid_prompt.stem}",
                            prompt_path=invalid_prompt,
                        )

            pilot = read_json(pilot_path)
            pilot["cases"][0]["public_target_transcript"] = " \t"
            write_json(pilot_path, pilot)
            output = root / "missing-transcript-output"
            with self.assertRaisesRegex(ValueError, "target transcript"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    output,
                    prompt_path=prompt_path,
                )
            self.assertFalse(output.exists())

    def test_effective_neighbor_truth_is_clipped_to_preprocessed_base(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            manifest = read_json(manifest_path)
            case = manifest["cases"][0]
            raw = load_mask(
                artifacts / "secret-source-case/extraction/raw-mask.png",
                polarity="bright",
            )
            raw_hash = sha256_mask_pixels(raw)
            _, raw_inventory = stable_components(raw)
            cut = {
                "type": "cut",
                "points": [[44, 0], [44, raw.shape[0] - 1]],
                "width_px": 1,
                "expected_input_mask_pixel_sha256": raw_hash,
            }
            cut_record = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [cut],
            }
            cut_mask, _ = apply_cleanup_operations(raw, cut_record)
            cut_hash = sha256_mask_pixels(cut_mask)
            cut_labels, _ = stable_components(cut_mask)
            target_id = int(cut_labels[16, 16])
            case["target_operations"] = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [
                    cut,
                    {
                        "type": "keep_components",
                        "ids": [target_id],
                        "expected_input_mask_pixel_sha256": cut_hash,
                    },
                ],
            }
            case["semantic_neighbor_operations"] = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [
                    {
                        "type": "keep_components",
                        "ids": [raw_inventory[1]["id"]],
                        "expected_input_mask_pixel_sha256": raw_hash,
                    }
                ],
            }
            write_json(manifest_path, manifest)
            pilot = read_json(pilot_path)
            pilot["cases"][0]["preprocessing"] = {
                "operation_count": 1,
                "provenance": "fixture-right-perimeter-cut-v1",
            }
            write_json(pilot_path, pilot)

            output = root / "neighbor-packs"
            generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                output,
                prompt_path=prompt_path,
            )

            private = output / "w01-o/private"
            base = load_mask(private / "base-mask.png", polarity="bright")
            neighbor = load_mask(
                private / "truth-neighbor-mask.png", polarity="bright"
            )
            truth = read_json(private / "truth.json")
            task = read_json(output / "w01-o/public/task.json")
            self.assertFalse(np.any(neighbor & ~base))
            self.assertEqual(
                truth["semantic_neighbor_pixels_excluded_outside_base"], 8
            )
            self.assertEqual(
                truth["truth_neighbor_mask_pixel_sha256"],
                sha256_mask_pixels(neighbor),
            )
            self.assertEqual(task["software_preprocessing"]["operation_count"], 1)
            self.assertEqual(
                task["software_preprocessing"]["provenance"],
                "fixture-right-perimeter-cut-v1",
            )

    def test_preprocessing_is_explicit_validated_and_never_inferred(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            pilot = read_json(pilot_path)
            pilot["cases"][0].pop("preprocessing")
            write_json(pilot_path, pilot)
            with self.assertRaisesRegex(ValueError, "preprocessing config"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    root / "missing-config",
                    prompt_path=prompt_path,
                )

            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            pilot = read_json(pilot_path)
            pilot["cases"][0]["preprocessing"]["operation_count"] = 1
            write_json(pilot_path, pilot)
            with self.assertRaisesRegex(ValueError, "must be a cut"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    root / "non-cut",
                    prompt_path=prompt_path,
                )

            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            pilot = read_json(pilot_path)
            pilot["cases"][0]["preprocessing"]["operation_count"] = 2
            write_json(pilot_path, pilot)
            with self.assertRaisesRegex(ValueError, "exceeds"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    root / "excess-count",
                    prompt_path=prompt_path,
                )

            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            manifest = read_json(manifest_path)
            case = manifest["cases"][0]
            raw_path = artifacts / "secret-source-case/extraction/raw-mask.png"
            raw = load_mask(raw_path, polarity="bright")
            raw_hash = sha256_mask_pixels(raw)
            internal_cut = {
                "type": "cut",
                "points": [[30, 0], [30, raw.shape[0] - 1]],
                "width_px": 1,
                "expected_input_mask_pixel_sha256": raw_hash,
            }
            case["target_operations"]["operations"].insert(0, internal_cut)
            write_json(manifest_path, manifest)
            pilot = read_json(pilot_path)
            pilot["cases"][0]["preprocessing"]["operation_count"] = 1
            write_json(pilot_path, pilot)
            with self.assertRaisesRegex(ValueError, "edge corridor"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    root / "internal-cut",
                    prompt_path=prompt_path,
                )

            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            manifest = read_json(manifest_path)
            case = manifest["cases"][0]
            raw_path = artifacts / "secret-source-case/extraction/raw-mask.png"
            raw = load_mask(raw_path, polarity="bright")
            raw[5:35, 4] = True
            save_mask(raw_path, raw)
            raw_hash = sha256_mask_pixels(raw)
            case["raw_mask_pixel_sha256"] = raw_hash
            _, raw_inventory = stable_components(raw)
            perimeter_cut = {
                "type": "cut",
                "points": [[4, 0], [4, raw.shape[0] - 1]],
                "width_px": 1,
                "expected_input_mask_pixel_sha256": raw_hash,
            }
            cut_mask, _ = apply_cleanup_operations(
                raw,
                {
                    "schema_version": CLEANUP_SCHEMA_VERSION,
                    "operations": [perimeter_cut],
                },
            )
            cut_hash = sha256_mask_pixels(cut_mask)
            cut_labels, _ = stable_components(cut_mask)
            target_id = int(cut_labels[16, 16])
            case["target_operations"] = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [
                    perimeter_cut,
                    {
                        "type": "keep_components",
                        "ids": [target_id],
                        "expected_input_mask_pixel_sha256": cut_hash,
                    },
                ],
            }
            neighbor_id = next(
                component["id"]
                for component in raw_inventory
                if component["bbox"]["x"] == 38
            )
            case["semantic_neighbor_operations"] = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [
                    {
                        "type": "keep_components",
                        "ids": [neighbor_id],
                        "expected_input_mask_pixel_sha256": raw_hash,
                    }
                ],
            }
            write_json(manifest_path, manifest)
            output = root / "declared-zero"
            generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                output,
                prompt_path=prompt_path,
            )
            task = read_json(output / "w01-c/public/task.json")
            self.assertEqual(task["software_preprocessing"]["operation_count"], 0)
            self.assertEqual(task["input_state_sha256"], raw_hash)
            self.assertEqual(len(task["components"]), 3)

    def test_reading_view_rotates_but_coordinates_stay_in_work_space(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            manifest = read_json(manifest_path)
            manifest["cases"][0]["angle_degrees"] = 90
            write_json(manifest_path, manifest)
            output = root / "vertical-packs"
            generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                output,
                prompt_path=prompt_path,
            )
            public = output / "w01-c/public"
            task = read_json(public / "task.json")
            with Image.open(public / "ownership-state.png") as ownership:
                ownership_size = ownership.size
            with Image.open(public / "reading-view.png") as reading:
                reading_size = reading.size
            self.assertEqual(reading_size, ownership_size[::-1])
            self.assertEqual(
                task["reading_view"]["applied_rotation_degrees"], -90.0
            )
            self.assertEqual(task["work_size_wh"], list(ownership_size))
            self.assertIn("unrotated", task["reading_view"]["instruction"])

    def test_public_stage_is_verified_deterministic_and_public_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            packs = root / "agent-packs"
            generate_agent_task_packs(
                pilot_path,
                manifest_path,
                artifacts,
                packs,
                prompt_path=prompt_path,
            )
            (packs / "w01-c/public/unlisted-secret.txt").write_text(
                "secret-source-case", "utf-8"
            )
            stage = root / "public-stage"
            first = stage_public_task_packs(packs, stage)
            first_snapshot = _snapshot(stage)
            second = stage_public_task_packs(packs, stage)
            self.assertEqual(first, second)
            self.assertEqual(first_snapshot, _snapshot(stage))
            self.assertEqual(first["task_count"], 3)
            self.assertFalse((stage / "summary.json").exists())
            self.assertFalse((stage / "managed-tasks.json").exists())
            self.assertNotIn(
                "secret-source-case",
                (stage / "stage-summary.json").read_text("utf-8"),
            )
            for task_id in first["task_ids"]:
                staged_task_dir = stage / task_id
                self.assertTrue((staged_task_dir / "task.json").is_file())
                self.assertFalse((staged_task_dir / "public").exists())
                self.assertFalse((staged_task_dir / "private").exists())
                self.assertFalse((staged_task_dir / "unlisted-secret.txt").exists())
                task = read_json(staged_task_dir / "task.json")
                expected_files = {
                    "task.json",
                    *(asset["path"] for asset in task["public_assets"].values()),
                }
                actual_files = {
                    str(path.relative_to(staged_task_dir))
                    for path in staged_task_dir.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(actual_files, expected_files)
                for asset in task["public_assets"].values():
                    self.assertEqual(
                        sha256_file(staged_task_dir / asset["path"]),
                        asset["sha256"],
                    )

            unmanaged = stage / "user-data"
            unmanaged.mkdir()
            (unmanaged / "keep.txt").write_text("keep", "utf-8")
            subset = stage_public_task_packs(packs, stage, task_ids=["w01-c"])
            self.assertEqual(subset["task_ids"], ["w01-c"])
            self.assertTrue((stage / "w01-c").is_dir())
            self.assertFalse((stage / "w01-r").exists())
            self.assertFalse((stage / "w01-o").exists())
            self.assertEqual((unmanaged / "keep.txt").read_text("utf-8"), "keep")

    def test_variant_cannot_expose_hidden_prior_references(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pilot_path, manifest_path, artifacts, prompt_path = _fixture(root)
            pilot = read_json(pilot_path)
            pilot["variants"][0]["expose_prior_component_refs"] = True
            write_json(pilot_path, pilot)
            with self.assertRaisesRegex(ValueError, "without showing"):
                generate_agent_task_packs(
                    pilot_path,
                    manifest_path,
                    artifacts,
                    root / "invalid-variant",
                    prompt_path=prompt_path,
                )


def _fixture(root: Path) -> tuple[Path, Path, Path, Path]:
    prompt_path = root / "prompt.md"
    prompt_path.write_text("Assign ink safely. Return one JSON action.\n", "utf-8")
    source = Image.new("RGB", (100, 80), "white")
    draw = ImageDraw.Draw(source)
    draw.rectangle((24, 30, 31, 37), fill="black")
    draw.rectangle((48, 30, 55, 37), fill="black")
    source_path = root / "source.png"
    source.save(source_path)

    crop = source.crop((10, 15, 70, 55))
    artifacts = root / "stress-artifacts"
    case_dir = artifacts / "secret-source-case"
    crop_path = case_dir / "inputs/crop.png"
    crop_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(crop_path)

    raw = np.zeros((40, 60), dtype=bool)
    raw[15:23, 14:22] = True
    raw[15:23, 38:46] = True
    raw_path = case_dir / "extraction/raw-mask.png"
    save_mask(raw_path, raw)
    _, inventory = stable_components(raw)
    state_hash = sha256_mask_pixels(raw)

    def keep(component_id: int) -> dict[str, object]:
        return {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "keep_components",
                    "ids": [component_id],
                    "expected_input_mask_pixel_sha256": state_hash,
                }
            ],
        }

    manifest = {
        "cases": [
            {
                "id": "secret-source-case",
                "label": "Target",
                "source_path": str(source_path),
                "source_target_box_xywh": [20, 26, 18, 16],
                "crop": {
                    "origin_xy": [10, 15],
                    "size_wh": [60, 40],
                    "sha256": sha256_file(crop_path),
                },
                "extraction_profile": "blue-fixture",
                "angle_degrees": 0,
                "raw_mask_pixel_sha256": state_hash,
                "target_operations": keep(inventory[0]["id"]),
                "semantic_neighbor_operations": keep(inventory[1]["id"]),
                "input_assessment": {
                    "status": "evaluable",
                    "notes": "hidden evaluator note",
                },
            }
        ]
    }
    manifest_path = root / "manifest.json"
    write_json(manifest_path, manifest)

    pilot = {
        "schema_version": AGENT_BENCHMARK_SCHEMA_VERSION,
        "suite_id": "fixture-pilot",
        "variants": [
            {
                "id": "context-only",
                "opaque_suffix": "c",
                "show_prior_owned_ink": False,
                "expose_prior_component_refs": False,
            },
            {
                "id": "oracle-red-only",
                "opaque_suffix": "r",
                "show_prior_owned_ink": True,
                "expose_prior_component_refs": False,
            },
            {
                "id": "prior-owned",
                "opaque_suffix": "o",
                "show_prior_owned_ink": True,
                "expose_prior_component_refs": True,
            },
        ],
        "cases": [
            {
                "case_id": "secret-source-case",
                "opaque_id": "w01",
                "pilot_tier": "routine",
                "preprocessing": {
                    "operation_count": 0,
                    "provenance": "fixture-no-preprocessing-v1",
                },
            }
        ],
        "context": {
            "large_blue_padding_px": 20,
            "small_gray_padding_px": 10,
            "maximum_pixels": 100_000,
        },
    }
    pilot_path = root / "pilot.json"
    write_json(pilot_path, pilot)
    return pilot_path, manifest_path, artifacts, prompt_path


def _snapshot(root: Path) -> list[tuple[str, str]]:
    return [
        (str(path.relative_to(root)), sha256_file(path))
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


if __name__ == "__main__":
    unittest.main()
