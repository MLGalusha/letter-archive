from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import line_finder


@unittest.skipUnless(
    os.environ.get("KRAKEN_REAL_MODEL_SMOKE") == "1",
    "real bundled-model smoke is opt-in outside CI",
)
class ActualKrakenModelSmokeTests(unittest.TestCase):
    def test_bundled_model_predicts_through_the_native_pipeline(self) -> None:
        image = Image.new("RGB", (512, 768), "white")
        draw = ImageDraw.Draw(image)
        for row in range(120, 620, 80):
            draw.line((60, row, 440, row + 8), fill="black", width=8)
            draw.line((80, row + 24, 390, row + 30), fill="black", width=5)
        encoded = io.BytesIO()
        image.save(encoded, format="PNG")

        _, layout = line_finder.process_image_bytes(
            encoded.getvalue(),
            source_name="ci-synthetic-page.png",
        )

        self.assertEqual(layout["schemaVersion"], 2)
        self.assertEqual(layout["kind"], "PageLayout")
        self.assertEqual(layout["producer"]["engineVersion"], "7.0.3")
        self.assertEqual(
            layout["producer"]["api"],
            "kraken.tasks.SegmentationTaskModel",
        )
        self.assertEqual(
            layout["producer"]["runtime"]["execution"]["resolvedDevice"],
            "cpu",
        )
        self.assertEqual(
            layout["producer"]["runtime"]["execution"]["resolutionSource"],
            "model-parameters",
        )
        self.assertEqual(
            layout["source"]["normalized"]["rasterChecksumAlgorithm"],
            "sha256-rgb8-v1",
        )
        self.assertIsInstance(layout["segmentation"]["lines"], list)


if __name__ == "__main__":
    unittest.main()
