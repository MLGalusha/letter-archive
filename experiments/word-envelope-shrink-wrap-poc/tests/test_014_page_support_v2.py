from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build_full_page_ownership_knockout_v2.py"
SPEC = importlib.util.spec_from_file_location("ownership_knockout_014_support_v2", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def synthetic_source() -> Image.Image:
    """A page with faint marginal ink on a visually distinct wood surround."""
    source = Image.new("RGB", (180, 140), (105, 48, 18))
    draw = ImageDraw.Draw(source)
    draw.rectangle((30, 14, 149, 126), fill=(202, 198, 188))
    # Source-visible page ink: faint top vertical writing and lower signatures.
    draw.line((42, 18, 42, 34), fill=(150, 146, 140), width=1)
    draw.line((87, 110, 120, 119), fill=(100, 96, 91), width=2)
    return source


class PageSupport014Tests(unittest.TestCase):
    def test_keeps_marginal_page_ink_and_suppresses_table_foreground(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mask_path = Path(directory) / "packet-mask.png"
            mask = Image.new("L", (180, 140), 0)
            draw = ImageDraw.Draw(mask)
            draw.line((42, 18, 42, 34), fill=255, width=1)  # faint top vertical text
            draw.line((87, 110, 120, 119), fill=255, width=2)  # signature
            draw.rectangle((2, 42, 18, 69), fill=255)  # table false positive
            mask.save(mask_path, format="PNG")

            normalized, record = builder._normalize_014_mask(mask_path, synthetic_source())

            self.assertEqual(record["normalization_method"], "source_derived_paper_support_v2")
            self.assertTrue(normalized[18:35, 42].all())
            self.assertTrue(normalized[110:120, 87:121].any())
            self.assertFalse(normalized[42:70, 2:19].any())
            self.assertEqual(record["suppressed_outside_paper_pixels"], 17 * 28)
            self.assertEqual(
                record["raw_foreground_pixels"],
                record["retained_within_paper_pixels"] + record["suppressed_outside_paper_pixels"],
            )
            self.assertEqual(record["paper_support"]["parameters"]["component_policy"], "largest_8_connected_then_fill_holes")

    def test_support_is_deterministic_and_does_not_depend_on_proposal_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mask_path = Path(directory) / "packet-mask.png"
            mask = np.zeros((140, 180), dtype=np.uint8)
            mask[20:24, 37:42] = 255
            mask[50:70, 0:10] = 255
            Image.fromarray(mask, mode="L").save(mask_path, format="PNG")

            first, first_record = builder._normalize_014_mask(mask_path, synthetic_source())
            second, second_record = builder._normalize_014_mask(mask_path, synthetic_source())

            self.assertTrue(np.array_equal(first, second))
            self.assertEqual(first_record["paper_support_pixel_sha256"], second_record["paper_support_pixel_sha256"])
            self.assertEqual(first_record["suppressed_outside_paper_pixels"], 200)
            self.assertNotIn("packet_geometry", first_record)

    def test_fails_closed_when_packet_mask_does_not_bind_source_dimensions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            mask_path = Path(directory) / "packet-mask.png"
            Image.new("L", (50, 40), 255).save(mask_path, format="PNG")
            source = Image.new("RGB", (51, 40), (130, 30, 10))
            with self.assertRaisesRegex(RuntimeError, "dimensions"):
                builder._normalize_014_mask(mask_path, source)


if __name__ == "__main__":
    unittest.main()
