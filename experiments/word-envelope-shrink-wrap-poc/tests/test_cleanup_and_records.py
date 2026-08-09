from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from word_envelope.engine import EnvelopeError, EnvelopeParams
from word_envelope.io_utils import (
    CLEANUP_SCHEMA_VERSION,
    CROP_SCHEMA_VERSION,
    sha256_file,
    sha256_image_pixels,
    sha256_mask_pixels,
    write_json,
)
from word_envelope.masks import (
    apply_cleanup_operations,
    create_bounded_crop,
    load_mask,
    save_mask,
    stable_components,
)
from word_envelope.records import build_example


class CleanupTests(unittest.TestCase):
    def test_stable_component_inventory(self) -> None:
        mask = np.zeros((40, 80), dtype=bool)
        mask[20:25, 50:55] = True
        mask[5:8, 8:12] = True
        labels, inventory = stable_components(mask, include_pixels=True)
        self.assertEqual([item["id"] for item in inventory], [1, 2])
        self.assertEqual(inventory[0]["bbox"], {"x": 8, "y": 5, "width": 4, "height": 3})
        self.assertEqual(labels[5, 8], 1)
        self.assertIn([8, 5], inventory[0]["coordinates"])

    def test_keep_remove_and_restore_replay_hashes(self) -> None:
        raw = np.zeros((50, 100), dtype=bool)
        raw[20:30, 10:25] = True
        raw[20:30, 70:85] = True
        operations = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "keep_components",
                    "ids": [1],
                    "expected_input_mask_pixel_sha256": sha256_mask_pixels(raw),
                },
                {
                    "type": "restore_scribble",
                    "points": [[25, 25], [35, 25]],
                    "width_px": 3,
                },
            ],
        }
        cleaned, log = apply_cleanup_operations(raw, operations)
        self.assertTrue(cleaned[25, 15])
        self.assertFalse(cleaned[25, 75])
        self.assertTrue(cleaned[25, 30])
        self.assertEqual(log[0]["input_mask_pixel_sha256"], sha256_mask_pixels(raw))
        self.assertEqual(log[-1]["output_mask_pixel_sha256"], sha256_mask_pixels(cleaned))

    def test_touching_words_cut_then_keep(self) -> None:
        raw = np.zeros((60, 140), dtype=bool)
        raw[24:36, 10:60] = True
        raw[24:36, 60:125] = True
        cut_record = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "cut",
                    "points": [[69, 15], [69, 45]],
                    "width_px": 5,
                    "expected_input_mask_pixel_sha256": sha256_mask_pixels(raw),
                }
            ],
        }
        cut, _ = apply_cleanup_operations(raw, cut_record)
        _, inventory = stable_components(cut)
        self.assertEqual(len(inventory), 2)
        record = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                cut_record["operations"][0],
                {
                    "type": "keep_components",
                    "ids": [1],
                    "expected_input_mask_pixel_sha256": sha256_mask_pixels(cut),
                },
            ],
        }
        cleaned, _ = apply_cleanup_operations(raw, record)
        self.assertTrue(cleaned[30, 20])
        self.assertFalse(cleaned[30, 100])

    def test_operation_hash_mismatch_fails(self) -> None:
        mask = np.zeros((20, 20), dtype=bool)
        mask[5:10, 5:10] = True
        record = {
            "schema_version": CLEANUP_SCHEMA_VERSION,
            "operations": [
                {
                    "type": "remove_components",
                    "ids": [1],
                    "expected_input_mask_pixel_sha256": "0" * 64,
                }
            ],
        }
        with self.assertRaisesRegex(EnvelopeError, "expected input mask"):
            apply_cleanup_operations(mask, record)

    def test_constant_mask_respects_explicit_polarity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            white = root / "white.png"
            black = root / "black.png"
            Image.new("L", (8, 8), 255).save(white)
            Image.new("L", (8, 8), 0).save(black)
            self.assertFalse(load_mask(white, polarity="dark").any())
            self.assertTrue(load_mask(white, polarity="bright").all())
            self.assertTrue(load_mask(black, polarity="dark").all())
            self.assertFalse(load_mask(black, polarity="bright").any())


class CropAndRecordTests(unittest.TestCase):
    def test_bounded_crop_records_exact_pixels_and_translation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            array = np.arange(100 * 120 * 3, dtype=np.uint32).reshape(100, 120, 3)
            source = Image.fromarray((array % 256).astype(np.uint8), mode="RGB")
            source_path = root / "source.png"
            source.save(source_path)
            crop_path = root / "crop.png"
            metadata_path = root / "crop.json"
            record = create_bounded_crop(
                source_path,
                box_xywh=(30, 20, 40, 30),
                padding=5,
                output_path=crop_path,
                metadata_path=metadata_path,
            )
            self.assertEqual((record["crop"]["x"], record["crop"]["y"]), (25, 15))
            self.assertEqual(
                (record["crop"]["width_px"], record["crop"]["height_px"]),
                (50, 40),
            )
            with Image.open(crop_path) as actual:
                expected = source.crop((25, 15, 75, 55))
                self.assertEqual(actual.tobytes(), expected.tobytes())
                self.assertEqual(record["crop"]["pixel_sha256"], sha256_image_pixels(actual))

    def test_full_source_copy_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            Image.new("RGB", (20, 20), "white").save(source_path)
            with self.assertRaisesRegex(EnvelopeError, "full-resolution"):
                create_bounded_crop(
                    source_path,
                    box_xywh=(0, 0, 20, 20),
                    padding=0,
                    output_path=root / "crop.png",
                    metadata_path=root / "crop.json",
                )

    def test_crop_refuses_to_overwrite_source_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            Image.new("RGB", (40, 40), "white").save(source_path)
            original_hash = sha256_file(source_path)
            with self.assertRaisesRegex(EnvelopeError, "paths must be distinct"):
                create_bounded_crop(
                    source_path,
                    box_xywh=(5, 5, 20, 20),
                    padding=0,
                    output_path=source_path,
                    metadata_path=root / "crop.json",
                )
            self.assertEqual(sha256_file(source_path), original_hash)

    def test_crop_pixel_limit_cannot_exceed_poc_cap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / "source.png"
            Image.new("RGB", (40, 40), "white").save(source_path)
            with self.assertRaisesRegex(EnvelopeError, "max_pixels"):
                create_bounded_crop(
                    source_path,
                    box_xywh=(5, 5, 20, 20),
                    padding=0,
                    output_path=root / "crop.png",
                    metadata_path=root / "crop.json",
                    max_pixels=1_500_001,
                )

    def test_build_rejects_crop_that_does_not_match_source_region(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            array = np.arange(100 * 120 * 3, dtype=np.uint32).reshape(100, 120, 3)
            source_path = root / "source.png"
            Image.fromarray((array % 256).astype(np.uint8), mode="RGB").save(
                source_path
            )
            crop_path = root / "crop.png"
            metadata_path = root / "crop.json"
            create_bounded_crop(
                source_path,
                box_xywh=(30, 20, 40, 30),
                padding=5,
                output_path=crop_path,
                metadata_path=metadata_path,
            )
            replacement = Image.new("RGB", (50, 40), "white")
            replacement.save(crop_path)
            metadata = json.loads(metadata_path.read_text())
            metadata["crop"]["sha256"] = sha256_file(crop_path)
            metadata["crop"]["pixel_sha256"] = sha256_image_pixels(replacement)
            write_json(metadata_path, metadata)
            mask = np.zeros((40, 50), dtype=bool)
            mask[16:24, 15:35] = True
            raw_path = root / "raw.png"
            cleaned_path = root / "cleaned.png"
            save_mask(raw_path, mask)
            save_mask(cleaned_path, mask)
            with self.assertRaisesRegex(EnvelopeError, "recorded source region"):
                build_example(
                    example_id="mismatched-source-crop",
                    crop_path=crop_path,
                    raw_mask_path=raw_path,
                    cleaned_mask_path=cleaned_path,
                    metadata_path=metadata_path,
                    operations_path=None,
                    excluded_mask_path=None,
                    params=EnvelopeParams(
                        angle_degrees=0,
                        maximum_envelope_fraction=0.95,
                    ),
                    method="morphological",
                    output_dir=root / "result",
                )

    def test_polygon_json_is_byte_identical_on_repeated_build(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = Image.new("RGB", (180, 60), "white")
            crop_path = root / "crop.png"
            crop.save(crop_path)
            mask = np.zeros((60, 180), dtype=bool)
            for x in (15, 50, 85, 120, 155):
                mask[24:37, x : x + 14] = True
            raw_path = root / "raw.png"
            cleaned_path = root / "cleaned.png"
            excluded_path = root / "excluded.png"
            save_mask(raw_path, mask)
            save_mask(cleaned_path, mask)
            save_mask(excluded_path, np.zeros_like(mask))
            operations_path = root / "operations.json"
            write_json(
                operations_path,
                {"schema_version": CLEANUP_SCHEMA_VERSION, "operations": []},
            )
            metadata_path = root / "crop.json"
            write_json(
                metadata_path,
                {
                    "schema_version": CROP_SCHEMA_VERSION,
                    "source": {
                        "path": str(crop_path),
                        "sha256": sha256_file(crop_path),
                        "width_px": 180,
                        "height_px": 60,
                    },
                    "crop": {
                        "path": str(crop_path),
                        "sha256": sha256_file(crop_path),
                        "pixel_sha256": sha256_image_pixels(crop),
                        "x": 0,
                        "y": 0,
                        "width_px": 180,
                        "height_px": 60,
                        "requested_box_xywh": [0, 0, 180, 60],
                        "padding_px": 0,
                    },
                },
            )
            params = EnvelopeParams(
                angle_degrees=0,
                along_bridge_px=22,
                cross_bridge_px=5,
                padding_px=4,
                maximum_envelope_fraction=0.95,
            )
            outputs = []
            for name in ("first", "second"):
                output = root / name
                build_example(
                    example_id="repeat",
                    crop_path=crop_path,
                    raw_mask_path=raw_path,
                    cleaned_mask_path=cleaned_path,
                    metadata_path=metadata_path,
                    operations_path=operations_path,
                    excluded_mask_path=excluded_path,
                    params=params,
                    method="morphological",
                    output_dir=output,
                )
                outputs.append((output / "polygon.crop.json").read_bytes())
            self.assertEqual(outputs[0], outputs[1])

    def test_failed_rebuild_removes_stale_success_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = Image.new("RGB", (180, 60), "white")
            crop_path = root / "crop.png"
            crop.save(crop_path)
            mask = np.zeros((60, 180), dtype=bool)
            for x in (15, 50, 85, 120, 155):
                mask[24:37, x : x + 14] = True
            raw_path = root / "raw.png"
            cleaned_path = root / "cleaned.png"
            excluded_path = root / "excluded.png"
            save_mask(raw_path, mask)
            save_mask(cleaned_path, mask)
            save_mask(excluded_path, np.zeros_like(mask))
            operations_path = root / "operations.json"
            write_json(
                operations_path,
                {"schema_version": CLEANUP_SCHEMA_VERSION, "operations": []},
            )
            metadata_path = root / "crop.json"
            write_json(
                metadata_path,
                {
                    "schema_version": CROP_SCHEMA_VERSION,
                    "source": {
                        "path": str(crop_path),
                        "sha256": sha256_file(crop_path),
                        "width_px": 180,
                        "height_px": 60,
                    },
                    "crop": {
                        "path": str(crop_path),
                        "sha256": sha256_file(crop_path),
                        "pixel_sha256": sha256_image_pixels(crop),
                        "x": 0,
                        "y": 0,
                        "width_px": 180,
                        "height_px": 60,
                        "requested_box_xywh": [0, 0, 180, 60],
                        "padding_px": 0,
                    },
                },
            )
            output = root / "result"
            common = {
                "example_id": "state-reset",
                "crop_path": crop_path,
                "raw_mask_path": raw_path,
                "cleaned_mask_path": cleaned_path,
                "metadata_path": metadata_path,
                "operations_path": operations_path,
                "excluded_mask_path": excluded_path,
                "params": EnvelopeParams(
                    angle_degrees=0,
                    along_bridge_px=22,
                    cross_bridge_px=5,
                    padding_px=4,
                    maximum_envelope_fraction=0.95,
                ),
                "method": "morphological",
                "output_dir": output,
            }
            build_example(**common)
            self.assertTrue((output / "diagnostic.json").exists())
            with self.assertRaisesRegex(EnvelopeError, "Rough box"):
                build_example(**common, rough_box=(0, 0, 10, 10))
            for name in (
                "comparison.png",
                "diagnostic.json",
                "overlay.png",
                "polygon.crop.json",
                "polygon.source.json",
            ):
                self.assertFalse((output / name).exists(), name)

            changed = mask.copy()
            changed[24:37, 15:29] = False
            save_mask(cleaned_path, changed)
            without_operations = {**common, "operations_path": None}
            with self.assertRaisesRegex(EnvelopeError, "no cleanup operations"):
                build_example(**without_operations)


if __name__ == "__main__":
    unittest.main()
