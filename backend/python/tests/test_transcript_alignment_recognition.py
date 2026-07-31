from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import line_finder
from kraken.containers import BBoxLine, BaselineLine, Region, Segmentation
from transcript_alignment.recognize_layout import (
    build_segmentation,
    sha256_file,
    verify_layout_image,
)


def native_page_layout(
    image: Image.Image,
    segmentation: Segmentation,
    *,
    encoded_sha256: str = "b" * 64,
) -> dict:
    return line_finder.build_page_layout(
        segmentation,
        image,
        source={
            "name": "page.png",
            "coordinateSpace": "normalized-image-pixels",
            "original": {
                "sha256": "a" * 64,
                "width": image.width,
                "height": image.height,
                "mode": image.mode,
                "exifOrientation": 1,
            },
            "normalized": {
                "sha256": encoded_sha256,
                "width": image.width,
                "height": image.height,
                "mode": "RGB",
                "format": "PNG",
            },
            "normalization": {
                "operation": "identity",
                "applied": False,
                "exifReadError": False,
            },
        },
        model_provenance={
            "name": "blla.mlmodel",
            "kind": "test",
            "sha256": "c" * 64,
            "sizeBytes": 123,
        },
        inference_config={
            "accelerator": "cpu",
            "device": 1,
            "precision": "32-true",
            "batchSize": 1,
            "raiseOnError": True,
            "numThreads": 1,
            "inputPadding": 0,
            "textDirection": segmentation.text_direction,
            "effective": {},
        },
    )


class TranscriptAlignmentRecognitionAdapterTests(unittest.TestCase):
    def test_preserves_curved_baselines_and_reading_order(self) -> None:
        layout = {
            "schemaVersion": 1,
            "lines": [
                {
                    "id": "line-b",
                    "baseline": [{"x": 8, "y": 80}, {"x": 92, "y": 82}],
                    "boundary": [
                        {"x": 6, "y": 68},
                        {"x": 94, "y": 68},
                        {"x": 94, "y": 92},
                        {"x": 6, "y": 92},
                    ],
                    "readingOrder": {"index": 1},
                    "provenance": {
                        "attributes": {
                            "baseDirection": "L",
                            "language": ["eng"],
                            "regions": ["body"],
                            "segmentationType": "baselines",
                            "textDirection": "horizontal-lr",
                        },
                    },
                },
                {
                    "id": "line-a",
                    "baseline": [
                        {"x": 10, "y": 30},
                        {"x": 50, "y": 35},
                        {"x": 90, "y": 28},
                    ],
                    "boundary": [
                        {"x": 8, "y": 18},
                        {"x": 92, "y": 16},
                        {"x": 94, "y": 44},
                        {"x": 7, "y": 45},
                    ],
                    "readingOrder": {"index": 0},
                    "provenance": {
                        "attributes": {
                            "segmentationType": "baselines",
                            "textDirection": "horizontal-lr",
                        },
                    },
                },
            ],
        }

        segmentation = build_segmentation(layout, Path("page.png"))

        self.assertEqual([line.id for line in segmentation.lines], ["line-a", "line-b"])
        self.assertEqual(
            segmentation.lines[0].baseline,
            [(10, 30), (50, 35), (90, 28)],
        )
        self.assertEqual(
            segmentation.lines[0].boundary[0],
            segmentation.lines[0].boundary[-1],
        )
        self.assertEqual(segmentation.lines[1].regions, ["body"])
        self.assertEqual(segmentation.lines[1].language, ["eng"])

    def test_supports_page_layout_v2_without_rectangularizing_geometry(self) -> None:
        image = Image.new("RGB", (100, 80), "white")
        segmentation = Segmentation(
            type="baselines",
            imagename="page.png",
            text_direction="horizontal-lr",
            script_detection=True,
            lines=[
                BaselineLine(
                    id="provider-1",
                    base_dir="L",
                    baseline=[(5, 20), (80, 20)],
                    boundary=[(3, 10), (82, 10), (82, 30), (3, 30)],
                    regions=["provider-region"],
                ),
                BaselineLine(
                    id="provider-2",
                    base_dir="R",
                    baseline=[(5, 50), (40, 54), (80, 49)],
                    boundary=[(3, 38), (82, 36), (82, 64), (3, 65)],
                ),
            ],
            regions={
                "TextRegion": [
                    Region(
                        id="provider-region",
                        boundary=[(0, 0), (99, 0), (99, 79), (0, 79)],
                    ),
                ],
            },
            line_orders=[[1, 0]],
            language=["eng"],
        )
        layout = native_page_layout(image, segmentation)
        native_lines = layout["segmentation"]["lines"]

        segmentation = build_segmentation(layout, Path("page.png"))

        self.assertEqual(
            [line.id for line in segmentation.lines],
            [native_lines[0]["id"], native_lines[1]["id"]],
        )
        self.assertEqual(
            segmentation.lines[1].baseline,
            [(5, 50), (40, 54), (80, 49)],
        )
        self.assertEqual(segmentation.lines[1].base_dir, "R")
        self.assertEqual(
            segmentation.lines[0].regions,
            native_lines[0]["regionIds"],
        )
        self.assertTrue(segmentation.script_detection)
        self.assertEqual(segmentation.language, ["eng"])
        self.assertEqual(segmentation.line_orders, [[1, 0]])

    def test_page_layout_v2_rejects_wrong_raster_hash_and_size(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "page.png"
            image = Image.new("RGB", (100, 80), "white")
            image.save(image_path, format="PNG")
            segmentation = Segmentation(
                type="baselines",
                imagename=str(image_path),
                text_direction="horizontal-lr",
                script_detection=False,
                lines=[
                    BaselineLine(
                        id="provider-1",
                        baseline=[(5, 20), (80, 20)],
                        boundary=[(3, 10), (82, 10), (82, 30), (3, 30)],
                    ),
                ],
            )
            layout = native_page_layout(
                image,
                segmentation,
                encoded_sha256=sha256_file(image_path),
            )

            with Image.open(image_path) as source_image:
                verified = source_image.convert("RGB")
                self.assertEqual(
                    verify_layout_image(layout, image_path, verified),
                    sha256_file(image_path),
                )

                wrong_raster = copy.deepcopy(layout)
                wrong_raster["source"]["normalized"]["rasterSha256"] = "f" * 64
                with self.assertRaisesRegex(
                    ValueError,
                    "Decoded RGB raster SHA-256",
                ):
                    verify_layout_image(wrong_raster, image_path, verified)

                wrong_size = copy.deepcopy(layout)
                wrong_size["source"]["normalized"]["width"] += 1
                with self.assertRaisesRegex(ValueError, "Image size"):
                    verify_layout_image(wrong_size, image_path, verified)

    def test_page_layout_v2_rejects_bbox_geometry_explicitly(self) -> None:
        image = Image.new("RGB", (100, 80), "white")
        layout = native_page_layout(
            image,
            Segmentation(
                type="bbox",
                imagename="page.png",
                text_direction="horizontal-lr",
                script_detection=False,
                lines=[
                    BBoxLine(
                        id="provider-box",
                        bbox=[3, 10, 82, 30],
                    ),
                ],
            ),
        )

        with self.assertRaisesRegex(
            ValueError,
            "unsupported geometry type bbox",
        ):
            build_segmentation(layout, Path("page.png"))


if __name__ == "__main__":
    unittest.main()
