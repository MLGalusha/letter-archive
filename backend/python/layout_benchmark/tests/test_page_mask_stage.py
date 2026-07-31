from __future__ import annotations

import hashlib
import json
import tempfile
import unittest

from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

from layout_benchmark.engines import EngineAdapter
from layout_benchmark.page_mask_input import MASK_COORDINATE_SPACE
from layout_benchmark.page_mask_stage import (
    ENGINE_INPUT_FILENAME,
    attach_page_mask_evidence,
    normalized_page_boundary_from_input_stage,
    prepare_eynollah_page_mask_stage,
)
from layout_benchmark.preparation import rgb8_raster_sha256
from layout_benchmark.util import (
    BenchmarkError,
    canonical_json_bytes,
    sha256_file,
    write_json,
)


PAGE_KEY = "014-18780127-L01-02"
SOURCE_RUN_ID = "eynollah-source-run"
SOURCE_ENGINE_ID = "eynollah-v091"
MANIFEST_SHA256 = "a" * 64
SOURCE_SHA256 = "b" * 64


def _config(padding_pixels: int = 0) -> dict:
    return {
        "engineId": "kraken7-eyno-mask-p0",
        "inputStage": {
            "type": "eynollah-page-mask",
            "paddingPixels": padding_pixels,
            "paddingMetric": "chebyshev",
            "controlProjection": {
                "geometryPreference": [
                    "native-baseline",
                    "native-boundary",
                ],
                "sampleSpacingPixels": 4,
                "insideRatioThresholdExclusive": 0.5,
                "pointOnBoundaryCountsInside": True,
                "coordinateTransform": "identity",
            },
        },
    }


class PageMaskConfigTests(unittest.TestCase):
    def test_four_profiles_pin_expected_padding_rotation_and_sources(
        self,
    ) -> None:
        expected = {
            "kraken7-eyno-mask-p0": (0, None),
            "kraken7-eyno-mask-p16": (16, None),
            "kraken7-rot3-eyno-mask-p0": (0, [0, 90, 270]),
            "kraken7-rot3-eyno-mask-p16": (16, [0, 90, 270]),
        }
        for engine_id, (padding, rotations) in expected.items():
            with self.subTest(engine_id=engine_id):
                adapter = EngineAdapter(engine_id)
                self.assertTrue(adapter.has_eynollah_page_mask)
                self.assertEqual(
                    adapter.config["inputStage"]["paddingPixels"],
                    padding,
                )
                self.assertEqual(
                    adapter.config["parameters"].get("rotationsDegrees"),
                    rotations,
                )
                self.assertEqual(
                    adapter.config["sourceRuns"]["lineGeometry"]["runId"],
                    "kraken7-blla-v2-full-20260728",
                )
                self.assertEqual(
                    adapter.config["sourceRuns"]["lineGeometry"][
                        "manifestSha256"
                    ],
                    "a7a6b87d4b006479e0aedb08ca45e8b560f43866c3f5c2aeca7e3c44fadb017c",
                )
                self.assertEqual(
                    adapter.config["sourceRuns"]["pageBoundary"]["runId"],
                    "eynollah-v091-full-no-cl-cloud-20260728",
                )
                self.assertEqual(
                    adapter.config["sourceRuns"]["pageBoundary"][
                        "manifestSha256"
                    ],
                    "43b53de12cf5a1406788ff68d52f50c2948bb6d5a97393a9757f9328f519cc0e",
                )
                self.assertIs(
                    adapter.config["diagnostic"]["rankable"],
                    False,
                )

    def test_masked_rotation_projections_declare_exact_artifact_inheritance(
        self,
    ) -> None:
        for engine_id in (
            "kraken7-rot3-eyno-mask-p0-safe-zones",
            "kraken7-rot3-eyno-mask-p16-safe-zones",
        ):
            with self.subTest(engine_id=engine_id):
                adapter = EngineAdapter(engine_id)
                self.assertFalse(adapter.has_eynollah_page_mask)
                self.assertEqual(
                    adapter.config["sourceEvidence"],
                    {"pageMaskArtifacts": "copy-and-bind-v1"},
                )
                with tempfile.TemporaryDirectory() as temporary:
                    artifacts = adapter.additional_page_artifacts(
                        Path(temporary)
                    )
                self.assertEqual(
                    {kind: path.name for kind, path in artifacts.items()},
                    {
                        "pageMask": "page-mask.png",
                        "engineInput": "engine-input.png",
                        "inputStage": "input-stage.v1.json",
                    },
                )


class PageMaskStageTests(unittest.TestCase):
    def test_stage_persists_bound_artifacts_and_normalizes_source_boundary(
        self,
    ) -> None:
        image = Image.new("RGB", (5, 4))
        image.putdata(
            [
                (index, index + 1, index + 2)
                for index in range(image.width * image.height)
            ]
        )
        boundary = [
            {"x": 0, "y": 0},
            {"x": 4, "y": 0},
            {"x": 4, "y": 3},
            {"x": 0, "y": 3},
        ]
        raster_sha256 = rgb8_raster_sha256(
            image.width,
            image.height,
            image.tobytes(),
        )

        with tempfile.TemporaryDirectory() as temporary:
            page_directory = Path(temporary) / PAGE_KEY
            page_directory.mkdir()
            prepared_path = page_directory / "prepared.png"
            image.save(prepared_path, format="PNG")
            prepared_sha256 = sha256_file(prepared_path)
            normalized_layout = {
                "schemaVersion": 1,
                "pageKey": PAGE_KEY,
                "runId": SOURCE_RUN_ID,
                "engineId": SOURCE_ENGINE_ID,
                "image": {
                    "width": 5,
                    "height": 4,
                    "coordinateSpace": MASK_COORDINATE_SPACE,
                    "sourceSha256": SOURCE_SHA256,
                    "preparedSha256": prepared_sha256,
                },
                "pageBoundary": boundary,
                "regions": [],
                "lines": [],
                "warnings": [],
            }
            normalized_bytes = canonical_json_bytes(normalized_layout)
            normalized_path = Path(temporary) / "source-normalized.json"
            normalized_path.write_bytes(normalized_bytes)
            normalized_sha256 = hashlib.sha256(
                normalized_bytes
            ).hexdigest()
            page_binding = {
                "role": "page-boundary",
                "runId": SOURCE_RUN_ID,
                "engineId": SOURCE_ENGINE_ID,
                "manifest": {
                    "sha256": MANIFEST_SHA256,
                },
                "normalizedLayout": {
                    "artifact": (
                        f"pages/{PAGE_KEY}/normalized-layout.v1.json"
                    ),
                    "backendPath": "ignored/source-normalized.json",
                    "sha256": normalized_sha256,
                },
                "prepared": {
                    "encodedSha256": prepared_sha256,
                    "width": 5,
                    "height": 4,
                    "rasterFingerprint": {
                        "algorithm": "sha256-rgb8-v1",
                        "sha256": raster_sha256,
                    },
                },
            }
            control_evidence = {
                "sourceBindings": {
                    "lineGeometry": {
                        "role": "line-geometry",
                        "runId": "kraken-control",
                    },
                    "pageBoundary": page_binding,
                },
                "sourceLayouts": {
                    "lineGeometry": {
                        "pageKey": PAGE_KEY,
                        "lines": [],
                    },
                    "pageBoundary": normalized_layout,
                },
            }

            with (
                patch(
                    "layout_benchmark.page_mask_stage.compose_page_evidence",
                    return_value=control_evidence,
                ),
                patch(
                    "layout_benchmark.page_mask_stage.resolve_backend_relative",
                    return_value=normalized_path,
                ),
            ):
                stage = prepare_eynollah_page_mask_stage(
                    Mock(),
                    _config(),
                    page_key=PAGE_KEY,
                    prepared_path=prepared_path,
                )

            for filename in (
                "page-mask.png",
                ENGINE_INPUT_FILENAME,
                "input-stage.v1.json",
            ):
                self.assertTrue((page_directory / filename).is_file())

            raw_path = page_directory / "raw.json"
            write_json(
                raw_path,
                {
                    "image": {
                        "filename": ENGINE_INPUT_FILENAME,
                        "width": 5,
                        "height": 4,
                        "mode": "RGB",
                    },
                    "segmentation": {
                        "type": "baselines",
                        "textDirection": "horizontal-lr",
                        "scriptDetection": False,
                        "lineOrders": [],
                        "language": None,
                        "regions": {},
                        "lines": [],
                    },
                },
            )
            original_engine_input = stage.engine_input_path.read_bytes()
            stage.engine_input_path.write_bytes(b"changed-after-preparation")
            with self.assertRaises(BenchmarkError) as changed:
                attach_page_mask_evidence(raw_path, stage)
            self.assertEqual(
                changed.exception.code,
                "PAGE_MASK_ARTIFACT_CHANGED",
            )
            stage.engine_input_path.write_bytes(original_engine_input)
            attach_page_mask_evidence(raw_path, stage)
            raw = json.loads(raw_path.read_bytes())
            projected = normalized_page_boundary_from_input_stage(
                raw,
                page_key=PAGE_KEY,
                width=5,
                height=4,
                source_sha256=SOURCE_SHA256,
                prepared_sha256=prepared_sha256,
            )
            self.assertEqual(projected, boundary)
            self.assertEqual(
                raw["inputStage"]["provenance"]["includeMask"][
                    "includedPixelCount"
                ],
                20,
            )
            self.assertEqual(
                set(raw["inputStage"]["controlEvidence"]["sourceLayouts"]),
                {"lineGeometry", "pageBoundary"},
            )

            raw["inputStage"]["artifacts"]["engineInput"]["sha256"] = (
                "f" * 64
            )
            with self.assertRaisesRegex(
                BenchmarkError,
                "artifact binding",
            ):
                normalized_page_boundary_from_input_stage(
                    raw,
                    page_key=PAGE_KEY,
                    width=5,
                    height=4,
                    source_sha256=SOURCE_SHA256,
                    prepared_sha256=prepared_sha256,
                )


if __name__ == "__main__":
    unittest.main()
