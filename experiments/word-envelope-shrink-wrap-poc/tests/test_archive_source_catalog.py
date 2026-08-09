from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from PIL import Image

from word_envelope.archive_source_catalog import ArchiveSourceCatalog
from word_envelope.human_review_console import ConsoleError


class ArchiveSourceCatalogTests(unittest.TestCase):
    @staticmethod
    def _page(root: Path, collection: str, date: str, sequence: int, page: int) -> Path:
        directory = (
            root
            / "backend"
            / "storage"
            / "collections"
            / collection
            / date
            / f"L{sequence:02d}"
        )
        directory.mkdir(parents=True, exist_ok=True)
        suffix = "" if page == 1 else f"-{page:02d}"
        source = directory / f"{collection}-{date}-L{sequence:02d}{suffix}.jpg"
        Image.new("RGB", (120, 80), (240, 229, 202)).save(source, format="JPEG")
        return source

    def test_scans_every_letter_page_in_archive_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._page(root, "002", "19100203", 1, 1)
            self._page(root, "001", "19000102", 1, 2)
            self._page(root, "001", "19000102", 1, 1)
            catalog = ArchiveSourceCatalog(root)
            listing = catalog.public_listing()
            self.assertEqual(listing["count"], 3)
            self.assertEqual(
                [item["catalog_item_id"] for item in listing["items"]],
                [
                    "001-19000102-L01-01",
                    "001-19000102-L01-02",
                    "002-19100203-L01-01",
                ],
            )
            self.assertEqual(
                catalog.resolve_catalog_source("001-19000102-L01-02").page_number,
                2,
            )

    def test_rejects_a_source_changed_after_catalog_creation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._page(root, "001", "19000102", 1, 1)
            catalog = ArchiveSourceCatalog(root)
            source.write_bytes(source.read_bytes() + b"changed")
            with self.assertRaisesRegex(ConsoleError, "changed"):
                catalog.resolve_catalog_source("001-19000102-L01-01")

    def test_reports_display_dimensions_after_exif_orientation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._page(root, "001", "19000102", 1, 1)
            with Image.open(source) as opened:
                pixels = opened.convert("RGB")
            exif = Image.Exif()
            exif[274] = 6
            pixels.save(source, format="JPEG", exif=exif)

            item = ArchiveSourceCatalog(root).public_listing()["items"][0]

            self.assertEqual(item["dimensions"], {"width": 80, "height": 120})


if __name__ == "__main__":
    unittest.main()
