from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from word_envelope.engine import EnvelopeError
from word_envelope.ink_variants import build_high_recall_union


class InkVariantBundleTests(unittest.TestCase):
    def _inputs(self, root: Path) -> tuple[Path, Path, Path]:
        source = root / "source.png"
        clean_path = root / "clean.png"
        possible_path = root / "possible.png"
        Image.new("RGB", (12, 8), "white").save(source)
        clean = np.zeros((8, 12), dtype=np.uint8)
        clean[2:4, 2:5] = 255
        possible = np.zeros_like(clean)
        possible[3:5, 4:9] = 255
        Image.fromarray(clean, mode="L").save(clean_path)
        Image.fromarray(possible, mode="L").save(possible_path)
        return source, clean_path, possible_path

    def test_publishes_exact_clean_union_and_additions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, clean, possible = self._inputs(root)
            output = root / "bundle"
            manifest = build_high_recall_union(
                source_path=source,
                clean_mask_path=clean,
                possible_ink_mask_path=possible,
                output_dir=output,
                research_reference="synthetic-test",
            )
            clean_pixels = np.asarray(Image.open(output / "clean.mask.png")) > 0
            strong_pixels = np.asarray(Image.open(output / "strong.mask.png")) > 0
            additions = np.asarray(Image.open(output / "strong-additions.mask.png")) > 0
            possible_pixels = np.asarray(Image.open(possible)) > 0
            self.assertTrue(np.array_equal(strong_pixels, clean_pixels | possible_pixels))
            self.assertTrue(np.array_equal(additions, strong_pixels & ~clean_pixels))
            self.assertEqual(manifest, json.loads((output / "manifest.json").read_text()))
            self.assertEqual(
                manifest["inputs"]["possible_ink"]["semantic_status"],
                "high_recall_possible_ink_not_pixel_truth",
            )

    def test_refuses_overwrite_and_nonbinary_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, clean, possible = self._inputs(root)
            output = root / "bundle"
            kwargs = dict(
                source_path=source,
                clean_mask_path=clean,
                possible_ink_mask_path=possible,
                output_dir=output,
                research_reference="synthetic-test",
            )
            build_high_recall_union(**kwargs)
            with self.assertRaises(EnvelopeError):
                build_high_recall_union(**kwargs)

            bad = np.zeros((8, 12), dtype=np.uint8)
            bad[1, 1] = 127
            Image.fromarray(bad, mode="L").save(root / "bad.png")
            kwargs["possible_ink_mask_path"] = root / "bad.png"
            kwargs["output_dir"] = root / "bad-bundle"
            with self.assertRaisesRegex(EnvelopeError, "exact binary"):
                build_high_recall_union(**kwargs)

    def test_requires_high_recall_input_to_add_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, clean, _ = self._inputs(root)
            with self.assertRaisesRegex(EnvelopeError, "adds no"):
                build_high_recall_union(
                    source_path=source,
                    clean_mask_path=clean,
                    possible_ink_mask_path=clean,
                    output_dir=root / "bundle",
                    research_reference="synthetic-test",
                )


if __name__ == "__main__":
    unittest.main()
