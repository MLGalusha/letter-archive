from __future__ import annotations

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from word_envelope.io_utils import (
    CLEANUP_SCHEMA_VERSION,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import (
    create_bounded_crop,
    extract_ink_mask,
    save_mask,
    stable_components,
)
from word_envelope.real_stress import (
    STRESS_SCHEMA_VERSION,
    _validate_manifest,
    generate_real_stress_suite,
)


class RealStressManifestTests(unittest.TestCase):
    def test_missing_required_case_is_rejected(self) -> None:
        manifest = minimal_validation_manifest()
        manifest["required_case_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "Missing required"):
            _validate_manifest(manifest)

    def test_unknown_profile_and_inline_override_are_rejected(self) -> None:
        manifest = minimal_validation_manifest()
        manifest["cases"][0]["envelope_profile"] = "missing"
        with self.assertRaisesRegex(ValueError, "Unknown envelope profile"):
            _validate_manifest(manifest)

        manifest = minimal_validation_manifest()
        manifest["cases"][0]["parameters"] = {"padding_px": 99}
        with self.assertRaisesRegex(ValueError, "Unknown keys"):
            _validate_manifest(manifest)

        manifest = minimal_validation_manifest()
        manifest["cases"][0]["assessment"] = {
            "morphological": {"status": "maybe", "notes": "invalid enum"}
        }
        with self.assertRaisesRegex(ValueError, "assessment status"):
            _validate_manifest(manifest)

    def test_input_assessment_is_required(self) -> None:
        manifest = minimal_validation_manifest()
        del manifest["cases"][0]["input_assessment"]
        with self.assertRaisesRegex(ValueError, "Missing input assessment"):
            _validate_manifest(manifest)


class RealStressReplayTests(unittest.TestCase):
    def test_replay_is_deterministic_and_preserves_method_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=2, fail_soft_union=True)
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)
            output = root / "output"

            first = generate_real_stress_suite(manifest_path, output)
            first_summary = (output / "summary.json").read_bytes()
            first_polygon = (
                output
                / "fixture-1/results/morphological/polygon.crop.json"
            ).read_bytes()
            second = generate_real_stress_suite(manifest_path, output)

            self.assertEqual(first, second)
            self.assertEqual(first_summary, (output / "summary.json").read_bytes())
            self.assertEqual(
                first_polygon,
                (
                    output
                    / "fixture-1/results/morphological/polygon.crop.json"
                ).read_bytes(),
            )
            self.assertEqual(second["case_count"], 2)
            self.assertEqual(second["geometry_success_count"], 2)
            self.assertEqual(second["geometry_failure_count"], 2)
            self.assertEqual(second["input_assessment_counts"], {
                "evaluable": 2,
                "invalid_input": 0,
            })
            self.assertEqual(second["evaluated_method_attempt_count"], 4)
            self.assertEqual(second["evaluated_geometry_success_count"], 2)
            self.assertEqual(second["evaluated_geometry_failure_count"], 2)
            self.assertTrue(
                (output / "fixture-2/results/soft_union/failure.json").exists()
            )

    def test_invalid_input_is_visible_but_excluded_from_evaluation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=1, fail_soft_union=False)
            manifest["required_case_ids"] = []
            manifest["cases"][0]["input_assessment"] = {
                "status": "invalid_input",
                "reason_code": "target_crop_clipped",
                "notes": "Synthetic diagnostic-only fixture.",
            }
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)

            summary = generate_real_stress_suite(manifest_path, root / "output")

            self.assertEqual(summary["method_attempt_count"], 2)
            self.assertEqual(summary["evaluated_method_attempt_count"], 0)
            self.assertEqual(summary["evaluated_geometry_success_count"], 0)
            self.assertEqual(summary["input_assessment_counts"], {
                "evaluable": 0,
                "invalid_input": 1,
            })
            case = summary["cases"][0]
            self.assertIsNone(case["display_method"])
            self.assertIsNotNone(case["diagnostic_display_method"])
            self.assertTrue(
                all(
                    not result["counted_in_evaluation"]
                    for result in case["methods"].values()
                )
            )

    def test_raw_mask_hash_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=1, fail_soft_union=False)
            manifest["cases"][0]["raw_mask_pixel_sha256"] = "0" * 64
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)
            with self.assertRaisesRegex(ValueError, "Raw-mask pixel hash drift"):
                generate_real_stress_suite(manifest_path, root / "output")

    def test_target_neighbor_overlap_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=1, fail_soft_union=False)
            case = manifest["cases"][0]
            case["semantic_neighbor_operations"] = deepcopy(
                case["target_operations"]
            )
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)
            output = root / "output"
            write_json(output / "summary.json", {"stale": True})

            with self.assertRaisesRegex(
                ValueError, "Target/semantic-neighbor mask overlap"
            ):
                generate_real_stress_suite(manifest_path, output)
            self.assertFalse((output / "summary.json").exists())

    def test_unexpected_method_error_aborts_suite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=1, fail_soft_union=False)
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)

            with patch(
                "word_envelope.real_stress.build_example",
                side_effect=RuntimeError("programming bug"),
            ):
                with self.assertRaisesRegex(RuntimeError, "programming bug"):
                    generate_real_stress_suite(manifest_path, root / "output")
            self.assertFalse((root / "output/summary.json").exists())

    def test_geometry_failure_overrides_stale_success_assessment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=1, fail_soft_union=True)
            manifest["cases"][0]["assessment"]["soft_union"] = {
                "status": "success",
                "notes": "Deliberately stale expected result.",
            }
            manifest_path = root / "manifest.json"
            write_json(manifest_path, manifest)

            summary = generate_real_stress_suite(manifest_path, root / "output")

            result = summary["cases"][0]["methods"]["soft_union"]
            self.assertEqual(result["geometry_status"], "failure")
            self.assertEqual(result["assessment_status"], "failure")
            self.assertEqual(result["declared_assessment_status"], "success")
            self.assertEqual(
                summary["evaluated_assessment_counts"],
                {"success": 1, "partial": 0, "failure": 1, "unreviewed": 0},
            )

    def test_changed_manifest_prunes_stale_case_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=2, fail_soft_union=False)
            raw_hash = manifest["cases"][0]["raw_mask_pixel_sha256"]
            all_component_ids = manifest["cases"][0]["target_operations"][
                "operations"
            ][0]["ids"]
            manifest["cases"][0]["semantic_neighbor_operations"] = {
                "schema_version": CLEANUP_SCHEMA_VERSION,
                "operations": [
                    {
                        "type": "remove_components",
                        "ids": all_component_ids,
                        "expected_input_mask_pixel_sha256": raw_hash,
                    }
                ],
            }
            manifest_path = root / "manifest.json"
            output = root / "output"
            write_json(manifest_path, manifest)
            generate_real_stress_suite(manifest_path, output)
            optional_path = (
                output
                / "fixture-1/inputs/semantic-neighbor-operations.json"
            )
            self.assertTrue(optional_path.exists())
            self.assertTrue((output / "fixture-2").exists())

            manifest["cases"] = manifest["cases"][:1]
            manifest["cases"][0]["semantic_neighbor_operations"] = None
            write_json(manifest_path, manifest)
            generate_real_stress_suite(manifest_path, output)

            self.assertFalse(optional_path.exists())
            self.assertFalse((output / "fixture-2").exists())
            completed_snapshot = snapshot_tree(output)
            generate_real_stress_suite(manifest_path, output)
            self.assertEqual(completed_snapshot, snapshot_tree(output))
            fresh_output = root / "fresh-output"
            generate_real_stress_suite(manifest_path, fresh_output)
            self.assertEqual(
                [path for path, _ in snapshot_tree(output)],
                [path for path, _ in snapshot_tree(fresh_output)],
            )

    def test_changed_manifest_prunes_outputs_from_aborted_replay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture_manifest(root, case_count=2, fail_soft_union=False)
            manifest_path = root / "manifest.json"
            output = root / "output"
            write_json(manifest_path, manifest)

            with patch(
                "word_envelope.real_stress.save_contact_sheet",
                side_effect=RuntimeError("gallery failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "gallery failure"):
                    generate_real_stress_suite(manifest_path, output)
            self.assertFalse((output / "summary.json").exists())
            self.assertTrue((output / "fixture-1").exists())
            self.assertTrue((output / "fixture-2").exists())
            self.assertTrue((output / "managed-cases.json").exists())

            manifest["cases"] = manifest["cases"][:1]
            manifest["cases"][0]["id"] = "fixture-3"
            manifest["cases"][0]["label"] = "Fixture 3"
            manifest["required_case_ids"] = ["fixture-3"]
            write_json(manifest_path, manifest)
            generate_real_stress_suite(manifest_path, output)

            self.assertFalse((output / "fixture-1").exists())
            self.assertFalse((output / "fixture-2").exists())
            self.assertTrue((output / "fixture-3").exists())
            self.assertTrue((output / "summary.json").exists())


def minimal_validation_manifest() -> dict:
    parameters = {
        "along_bridge_px": 18,
        "cross_bridge_px": 5,
        "padding_px": 4,
        "maximum_envelope_fraction": 0.95,
    }
    return {
        "schema_version": STRESS_SCHEMA_VERSION,
        "suite_id": "validation-only",
        "required_case_ids": ["fixture"],
        "extraction_profiles": {"fixture": {}},
        "envelope_profiles": {
            "fixture": {
                "morphological": parameters,
                "soft_union": parameters,
            }
        },
        "cases": [
            {
                "id": "fixture",
                "label": "Fixture",
                "source_path": "/tmp/not-read-by-validator.png",
                "source_sha256": "0" * 64,
                "source_target_box_xywh": [1, 1, 2, 2],
                "crop": {},
                "extraction_profile": "fixture",
                "envelope_profile": "fixture",
                "angle_degrees": 0,
                "rough_box_crop_xywh": [0, 0, 10, 10],
                "raw_mask_sha256": "0" * 64,
                "raw_mask_pixel_sha256": "0" * 64,
                "target_operations": {
                    "schema_version": CLEANUP_SCHEMA_VERSION,
                    "operations": [],
                },
                "semantic_neighbor_operations": None,
                "input_assessment": {
                    "status": "evaluable",
                    "notes": "Validation fixture.",
                },
                "preferred_method": "morphological",
            }
        ],
    }


def fixture_manifest(
    root: Path, *, case_count: int, fail_soft_union: bool
) -> dict:
    source = Image.new("RGB", (240, 140), "white")
    draw = ImageDraw.Draw(source)
    for x in (60, 90, 120, 150, 180):
        draw.rectangle((x, 65, x + 14, 78), fill="black")
    source_path = root / "source.png"
    source.save(source_path)

    probe = root / "probe"
    crop_path = probe / "crop.png"
    crop_metadata = probe / "crop.json"
    crop_record = create_bounded_crop(
        source_path,
        box_xywh=(50, 50, 150, 45),
        padding=10,
        output_path=crop_path,
        metadata_path=crop_metadata,
    )
    with Image.open(crop_path) as crop_source:
        crop = crop_source.convert("RGB")
    raw = extract_ink_mask(
        crop,
        window_size=31,
        k=0.16,
        minimum_component_area=2,
    )
    _, inventory = stable_components(raw)
    raw_path = probe / "raw-mask.png"
    save_mask(raw_path, raw)
    operations = {
        "schema_version": CLEANUP_SCHEMA_VERSION,
        "operations": [
            {
                "type": "keep_components",
                "ids": [component["id"] for component in inventory],
                "expected_input_mask_pixel_sha256": sha256_mask_pixels(raw),
            }
        ],
    }
    common = {
        "along_bridge_px": 18,
        "cross_bridge_px": 5,
        "padding_px": 4,
        "maximum_envelope_fraction": 0.95,
    }
    soft = (
        {
            "along_bridge_px": 1,
            "cross_bridge_px": 1,
            "padding_px": 1,
            "maximum_envelope_fraction": 0.95,
        }
        if fail_soft_union
        else common
    )
    case_template = {
        "label": "Fixture",
        "source_path": str(source_path),
        "source_sha256": sha256_file(source_path),
        "source_target_box_xywh": [50, 50, 150, 45],
        "crop": {
            "requested_box_xywh": [50, 50, 150, 45],
            "padding_px": 10,
            "origin_xy": [crop_record["crop"]["x"], crop_record["crop"]["y"]],
            "size_wh": [
                crop_record["crop"]["width_px"],
                crop_record["crop"]["height_px"],
            ],
            "sha256": sha256_file(crop_path),
        },
        "extraction_profile": "fixture",
        "envelope_profile": "fixture",
        "angle_degrees": 0,
        "rough_box_crop_xywh": [0, 0, crop.width, crop.height],
        "raw_mask_sha256": sha256_file(raw_path),
        "raw_mask_pixel_sha256": sha256_mask_pixels(raw),
        "target_operations": operations,
        "semantic_neighbor_operations": None,
        "input_assessment": {
            "status": "evaluable",
            "notes": "Synthetic replay fixture.",
        },
        "preferred_method": "morphological",
        "assessment": {
            "morphological": {"status": "success", "notes": "test fixture"},
            "soft_union": {"status": "unreviewed", "notes": "test fixture"},
        },
        "tags": ["fixture"],
    }
    cases = []
    for index in range(1, case_count + 1):
        case = deepcopy(case_template)
        case["id"] = f"fixture-{index}"
        case["label"] = f"Fixture {index}"
        cases.append(case)
    return {
        "schema_version": STRESS_SCHEMA_VERSION,
        "suite_id": "fixture-suite",
        "required_case_ids": ["fixture-1"],
        "extraction_profiles": {
            "fixture": {
                "window_size": 31,
                "k": 0.16,
                "offset": 0.0,
                "minimum_component_area": 2,
            }
        },
        "envelope_profiles": {
            "fixture": {
                "morphological": common,
                "soft_union": soft,
            }
        },
        "cases": cases,
    }


def snapshot_tree(root: Path) -> list[tuple[str, str]]:
    return [
        (str(path.relative_to(root)), sha256_file(path))
        for path in sorted(path for path in root.rglob("*") if path.is_file())
    ]


if __name__ == "__main__":
    unittest.main()
