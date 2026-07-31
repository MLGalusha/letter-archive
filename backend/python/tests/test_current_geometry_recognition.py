from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

from PIL import Image

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from transcript_alignment.recognize_current_geometry import (
    EXPECTED_INFERENCE,
    ManifestValidationError,
    build_recognition_segmentations,
    canonical_json_checksum,
    load_and_validate_manifest,
    rgb8_raster_sha256,
    run_batch,
    segment_geometry_checksum,
    sha256_file,
)


MODEL_NAME = "McCATMuS_nfd_nofix_V1.mlmodel"


class FakeRecognitionModel:
    seg_type = "baselines"

    def __init__(self, *, skip_id: str | None = None) -> None:
        self.skip_id = skip_id
        self.predict_calls = 0

    def predict(self, _image, segmentation, _config):
        self.predict_calls += 1
        for line in segmentation.lines:
            if line.id == self.skip_id:
                continue
            yield SimpleNamespace(
                id=line.id,
                prediction=f"reading for {line.id}",
                confidences=[0.8, 0.9],
            )


def _profile(model_path: Path) -> dict:
    inference = dict(EXPECTED_INFERENCE)
    model_checksum = sha256_file(model_path)
    identity = {
        "engine": "kraken",
        "engineVersion": version("kraken"),
        "modelName": MODEL_NAME,
        "modelChecksumSha256": model_checksum,
        "inference": inference,
    }
    return {
        "profileChecksumSha256": canonical_json_checksum(identity),
        "engine": identity["engine"],
        "engineVersion": identity["engineVersion"],
        "modelName": identity["modelName"],
        "modelChecksumSha256": model_checksum,
        "configChecksumSha256": canonical_json_checksum(inference),
    }


def _segments(prefix: str) -> list[dict]:
    baseline = {
        "id": f"{prefix}:baseline",
        "geometryType": "baseline",
        "textDirection": "horizontal-lr",
        "bbox": [5, 5, 90, 30],
        "baseline": [[5, 25], [50, 23.5], [90, 25]],
        "boundary": [
            {"x": 5, "y": 5},
            {"x": 90, "y": 5},
            {"x": 90, "y": 30},
            {"x": 5, "y": 30},
        ],
    }
    bbox = {
        "id": f"{prefix}:bbox",
        "geometryType": "bbox",
        "textDirection": "vertical-lr",
        "bbox": [10, 40, 30, 90],
    }
    for segment in (baseline, bbox):
        segment["segmentGeometryChecksumSha256"] = (
            segment_geometry_checksum(segment)
        )
    return [baseline, bbox]


def _write_fixture(
    root: Path,
    *,
    page_count: int = 1,
) -> tuple[Path, Path, dict]:
    model_path = root / MODEL_NAME
    model_path.write_bytes(b"not-a-real-model-offline-contract-test")
    pages = []
    for index in range(page_count):
        source_path = root / f"source-{index}.bin"
        source_path.write_bytes(f"original-source-{index}".encode())
        raster_path = root / f"raster-{index}.png"
        image = Image.new("RGB", (100, 100), (240 - index, 241, 242))
        image.save(raster_path, format="PNG")
        pages.append({
            "pageId": str(UUID(int=index + 1)),
            "pageKey": f"test-page-{index + 1}",
            "source": {
                "primarySourceRevision": 2,
                "sourcePath": source_path.name,
                "sourceChecksumSha256": sha256_file(source_path),
                "rasterPath": raster_path.name,
                "rasterEncodedChecksumSha256": sha256_file(raster_path),
                "rasterChecksumAlgorithm": "sha256-rgb8-v1",
                "rasterChecksumSha256": rgb8_raster_sha256(image),
                "width": image.width,
                "height": image.height,
                "normalization": {
                    "operation": "exif-transpose-rgb-v1",
                    "applied": False,
                    "originalExifOrientation": None,
                    "exifReadError": False,
                    "original": {
                        "width": image.width,
                        "height": image.height,
                        "mode": "RGB",
                    },
                    "normalized": {
                        "width": image.width,
                        "height": image.height,
                        "mode": "RGB",
                    },
                },
            },
            "geometry": {
                "geometryRevision": 4,
                "geometryChecksumSha256": "a" * 64,
                "lineSegmentsChecksumSha256": "b" * 64,
                "alignmentSegmentInputChecksumSha256": "c" * 64,
            },
            "segments": _segments(f"page-{index + 1}"),
        })
    manifest = {
        "schemaVersion": 1,
        "kind": "current-page-recognition-batch",
        "runId": "offline-contract-test",
        "profile": _profile(model_path),
        "inference": dict(EXPECTED_INFERENCE),
        "pages": pages,
    }
    manifest_path = root / "recognition-input.v1.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest_path, model_path, manifest


def _rewrite_manifest(path: Path, manifest: dict) -> None:
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


class CurrentGeometryRecognitionTests(unittest.TestCase):
    def test_preserves_baselines_and_uses_explicit_kraken_bbox_adapter(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, model_path, _ = _write_fixture(Path(directory))

            batch = load_and_validate_manifest(manifest_path, model_path)
            segmentations = build_recognition_segmentations(batch.pages[0])

            self.assertEqual(
                [segmentation.text_direction for segmentation in segmentations],
                ["horizontal-lr", "vertical-lr"],
            )
            self.assertEqual(
                segmentations[0].lines[0].baseline,
                [(5, 25), (50, 24), (90, 25)],
            )
            # Kraken 7 BBoxLine.to_baseline(topline=False) puts a vertical-lr
            # baseline at the left-side quarter and preserves downward order.
            self.assertEqual(
                segmentations[1].lines[0].baseline,
                [(15, 40), (15, 90)],
            )
            self.assertEqual(
                segmentations[1].lines[0].boundary,
                [
                    (10, 40),
                    (30, 40),
                    (30, 90),
                    (10, 90),
                    (10, 40),
                ],
            )

    def test_bbox_direction_must_be_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, model_path, manifest = _write_fixture(
                Path(directory),
            )
            del manifest["pages"][0]["segments"][1]["textDirection"]
            _rewrite_manifest(manifest_path, manifest)

            with self.assertRaisesRegex(
                ManifestValidationError,
                "missing required keys.*textDirection",
            ):
                load_and_validate_manifest(manifest_path, model_path)

    def test_legacy_collection_011_shapes_use_explicit_safe_adapters(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, manifest = _write_fixture(root)
            with_boundary = manifest["pages"][0]["segments"][0]
            del with_boundary["geometryType"]
            with_boundary["segmentGeometryChecksumSha256"] = (
                segment_geometry_checksum(with_boundary)
            )

            without_boundary = manifest["pages"][0]["segments"][1]
            del without_boundary["geometryType"]
            without_boundary["textDirection"] = "horizontal-lr"
            without_boundary["baseline"] = [[10, 80], [30, 80]]
            without_boundary["segmentGeometryChecksumSha256"] = (
                segment_geometry_checksum(without_boundary)
            )
            _rewrite_manifest(manifest_path, manifest)

            batch = load_and_validate_manifest(manifest_path, model_path)
            self.assertEqual(
                [
                    segment.recognition_adapter
                    for segment in batch.pages[0].segments
                ],
                [
                    "direct-baseline",
                    "legacy-baseline-bbox-boundary-v1",
                ],
            )
            segmentation = build_recognition_segmentations(batch.pages[0])[0]
            self.assertEqual(
                segmentation.lines[1].baseline,
                [(10, 80), (30, 80)],
            )
            self.assertEqual(
                segmentation.lines[1].boundary,
                [
                    (10, 40),
                    (30, 40),
                    (30, 90),
                    (10, 90),
                    (10, 40),
                ],
            )

            output_root = root / "output"
            result = run_batch(
                manifest_path=manifest_path,
                model_path=model_path,
                output_root=output_root,
                model_loader=lambda _path: FakeRecognitionModel(),
            )
            self.assertEqual(result["state"], "completed")
            artifact = json.loads(
                (
                    output_root
                    / "pages"
                    / manifest["pages"][0]["pageId"]
                    / "recognition.v1.json"
                ).read_text(encoding="utf-8"),
            )
            self.assertEqual(
                [
                    record["binding"]["adapter"]
                    for record in artifact["records"]
                ],
                [
                    "direct-baseline",
                    "legacy-baseline-bbox-boundary-v1",
                ],
            )

    def test_legacy_geometry_type_cannot_be_inferred_without_baseline(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, model_path, manifest = _write_fixture(
                Path(directory),
            )
            segment = manifest["pages"][0]["segments"][1]
            del segment["geometryType"]
            segment["segmentGeometryChecksumSha256"] = (
                segment_geometry_checksum(segment)
            )
            _rewrite_manifest(manifest_path, manifest)

            with self.assertRaisesRegex(
                ManifestValidationError,
                "only when a stored legacy baseline exists",
            ):
                load_and_validate_manifest(manifest_path, model_path)

    def test_rejects_geometry_checksum_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, model_path, manifest = _write_fixture(
                Path(directory),
            )
            manifest["pages"][0]["segments"][0]["baseline"][0][1] += 1
            _rewrite_manifest(manifest_path, manifest)

            with self.assertRaisesRegex(
                ManifestValidationError,
                "geometry checksum mismatch",
            ):
                load_and_validate_manifest(manifest_path, model_path)

    def test_rejects_source_byte_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, _ = _write_fixture(root)
            (root / "source-0.bin").write_bytes(b"changed-after-export")

            with self.assertRaisesRegex(
                ManifestValidationError,
                "source byte checksum mismatch",
            ):
                load_and_validate_manifest(manifest_path, model_path)

    def test_loads_model_once_and_outputs_exact_current_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, manifest = _write_fixture(
                root,
                page_count=2,
            )
            model = FakeRecognitionModel()
            load_count = 0

            def loader(received_path: Path):
                nonlocal load_count
                load_count += 1
                self.assertEqual(received_path, model_path.resolve())
                return model

            output_root = root / "output"
            result = run_batch(
                manifest_path=manifest_path,
                model_path=model_path,
                output_root=output_root,
                model_loader=loader,
            )

            self.assertEqual(load_count, 1)
            self.assertEqual(model.predict_calls, 4)
            self.assertEqual(result["state"], "completed")
            self.assertEqual(
                result["summary"]["recognizedSegmentCount"],
                4,
            )
            for raw_page in manifest["pages"]:
                output = json.loads(
                    (
                        output_root
                        / "pages"
                        / raw_page["pageId"]
                        / "recognition.v1.json"
                    ).read_text(encoding="utf-8"),
                )
                self.assertEqual(
                    set(output),
                    {
                        "schemaVersion",
                        "kind",
                        "pageId",
                        "source",
                        "profile",
                        "evidence",
                        "state",
                        "records",
                        "createdAt",
                    },
                )
                self.assertEqual(output["schemaVersion"], 2)
                self.assertEqual(output["kind"], "page-line-recognition")
                self.assertEqual(output["state"], "completed")
                self.assertEqual(
                    output["evidence"]["runId"],
                    manifest["runId"],
                )
                self.assertEqual(
                    output["evidence"]["normalization"],
                    raw_page["source"]["normalization"],
                )
                self.assertEqual(
                    [record["segmentId"] for record in output["records"]],
                    [
                        segment["id"]
                        for segment in raw_page["segments"]
                    ],
                )
                self.assertEqual(
                    [
                        record["binding"]["adapter"]
                        for record in output["records"]
                    ],
                    ["direct-baseline", "bbox-to-baseline-v1"],
                )
                self.assertEqual(
                    [record["textDirection"] for record in output["records"]],
                    ["horizontal-lr", "vertical-lr"],
                )

    def test_missing_model_record_fails_page_instead_of_guessing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, manifest = _write_fixture(root)
            missing_id = manifest["pages"][0]["segments"][1]["id"]

            output_root = root / "output"
            result = run_batch(
                manifest_path=manifest_path,
                model_path=model_path,
                output_root=output_root,
                model_loader=lambda _path: FakeRecognitionModel(
                    skip_id=missing_id,
                ),
            )

            self.assertEqual(result["state"], "completed-with-failures")
            self.assertEqual(result["summary"]["failedPageCount"], 1)
            self.assertIn(
                missing_id,
                result["failures"][0]["message"],
            )
            self.assertFalse(
                (
                    output_root
                    / "pages"
                    / manifest["pages"][0]["pageId"]
                    / "recognition.v1.json"
                ).exists(),
            )
            self.assertTrue((output_root / "run.v1.json").is_file())

    def test_validate_only_cli_does_not_load_dummy_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, _ = _write_fixture(root)

            completed = subprocess.run(
                [
                    sys.executable,
                    str(
                        PYTHON_ROOT
                        / "transcript_alignment"
                        / "recognize_current_geometry.py"
                    ),
                    "--manifest",
                    str(manifest_path),
                    "--model",
                    str(model_path),
                    "--validate-only",
                ],
                check=True,
                capture_output=True,
                text=True,
                env={
                    **os.environ,
                    "PYTHONPATH": str(PYTHON_ROOT),
                },
            )
            result = json.loads(completed.stdout)

            self.assertEqual(result["state"], "valid")
            self.assertFalse(result["modelLoaded"])
            self.assertEqual(result["segmentCount"], 2)

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, model_path, _ = _write_fixture(root)
            content = manifest_path.read_text(encoding="utf-8")
            manifest_path.write_text(
                content.replace(
                    '"schemaVersion": 1,',
                    '"schemaVersion": 1, "schemaVersion": 1,',
                    1,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ManifestValidationError,
                "Duplicate JSON object key: schemaVersion",
            ):
                load_and_validate_manifest(manifest_path, model_path)

if __name__ == "__main__":
    unittest.main()
