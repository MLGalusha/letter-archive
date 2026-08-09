"""Complete collection → letter → page catalog for the human selector.

The frozen benchmark catalog intentionally covers only research cohorts.  Human
ground-truth work needs every real L-page, so this catalog scans archive storage
without exposing filesystem paths to the browser and rechecks each source before
the established selector snapshots it into an append-only run.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from typing import Any

from PIL import Image, ImageOps

from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes
from .pipeline_source_catalog import discover_letter_archive_root


CATALOG_SCHEMA = "simple-selector-archive-catalog.v1"
SOURCE_RE = re.compile(
    r"^(?P<collection>[0-9]{3})-(?P<date>[0-9X]{8})-"
    r"L(?P<sequence>[0-9]{2})(?:-(?P<page>[0-9]{2}))?"
    r"\.(?:jpe?g|png|webp)$",
    re.IGNORECASE,
)
LETTER_RE = re.compile(r"^L(?P<sequence>[0-9]{2})$")
PAGE_ID_RE = re.compile(r"^[0-9]{3}-[0-9X]{8}-L[0-9]{2}-[0-9]{2}$")


@dataclass(frozen=True)
class ArchiveSourcePage:
    catalog_item_id: str
    collection_code: str
    date_raw: str
    letter_sequence: int
    page_number: int
    original_filename: str
    absolute_path: Path
    relative_path: str
    width: int
    height: int
    size_bytes: int
    mtime_ns: int

    def public_record(self) -> dict[str, Any]:
        return {
            "catalog_item_id": self.catalog_item_id,
            "identity": {
                "collection_code": self.collection_code,
                "date_raw": self.date_raw,
                "letter_sequence": self.letter_sequence,
                "page_number": self.page_number,
                "original_filename": self.original_filename,
            },
            "dimensions": {"width": self.width, "height": self.height},
            "challenge_tags": [],
            "thumbnail_available": True,
        }


class ArchiveSourceCatalog:
    """Deterministic inventory of every real letter page in archive storage."""

    def __init__(self, letter_archive_root: Path | None = None) -> None:
        self.letter_archive_root = (
            discover_letter_archive_root()
            if letter_archive_root is None
            else Path(letter_archive_root).resolve(strict=True)
        )
        self.collections_root = (
            self.letter_archive_root / "backend" / "storage" / "collections"
        ).resolve(strict=True)
        self._items = self._scan()
        revision_basis = [
            {
                "catalog_item_id": page.catalog_item_id,
                "relative_path": page.relative_path,
                "size_bytes": page.size_bytes,
                "mtime_ns": page.mtime_ns,
                "size_wh": [page.width, page.height],
            }
            for page in self._items.values()
        ]
        self.catalog_revision = hashlib.sha256(
            canonical_json_bytes(revision_basis)
        ).hexdigest()

    def _scan(self) -> dict[str, ArchiveSourcePage]:
        pages: dict[str, ArchiveSourcePage] = {}
        for collection_dir in sorted(self.collections_root.iterdir()):
            if (
                collection_dir.is_symlink()
                or not collection_dir.is_dir()
                or re.fullmatch(r"[0-9]{3}", collection_dir.name) is None
            ):
                continue
            for date_dir in sorted(collection_dir.iterdir()):
                if (
                    date_dir.is_symlink()
                    or not date_dir.is_dir()
                    or re.fullmatch(r"[0-9X]{8}", date_dir.name) is None
                ):
                    continue
                for letter_dir in sorted(date_dir.iterdir()):
                    letter_match = LETTER_RE.fullmatch(letter_dir.name)
                    if letter_dir.is_symlink() or not letter_dir.is_dir() or letter_match is None:
                        continue
                    for source in sorted(letter_dir.iterdir()):
                        if source.is_symlink() or not source.is_file():
                            continue
                        source_match = SOURCE_RE.fullmatch(source.name)
                        if source_match is None:
                            continue
                        sequence = int(source_match.group("sequence"))
                        page_number = int(source_match.group("page") or "1")
                        if (
                            source_match.group("collection") != collection_dir.name
                            or source_match.group("date") != date_dir.name
                            or sequence != int(letter_match.group("sequence"))
                        ):
                            continue
                        page_id = (
                            f"{collection_dir.name}-{date_dir.name}-"
                            f"L{sequence:02d}-{page_number:02d}"
                        )
                        if page_id in pages:
                            raise ConsoleError(
                                "archive_invalid",
                                f"Duplicate letter page identity: {page_id}",
                            )
                        try:
                            with Image.open(source) as image:
                                upright = ImageOps.exif_transpose(image)
                                upright.load()
                                width, height = upright.size
                        except Exception as error:
                            raise ConsoleError(
                                "archive_invalid",
                                f"Unreadable source image: {source.name}",
                            ) from error
                        stat = source.stat()
                        pages[page_id] = ArchiveSourcePage(
                            catalog_item_id=page_id,
                            collection_code=collection_dir.name,
                            date_raw=date_dir.name,
                            letter_sequence=sequence,
                            page_number=page_number,
                            original_filename=source.name,
                            absolute_path=source.resolve(strict=True),
                            relative_path=source.relative_to(self.letter_archive_root).as_posix(),
                            width=width,
                            height=height,
                            size_bytes=stat.st_size,
                            mtime_ns=stat.st_mtime_ns,
                        )
        if not pages:
            raise ConsoleError("archive_empty", "No Letter Archive letter pages were found")
        return dict(sorted(pages.items()))

    @property
    def count(self) -> int:
        return len(self._items)

    def page(self, page_id: str) -> ArchiveSourcePage:
        if not isinstance(page_id, str) or PAGE_ID_RE.fullmatch(page_id) is None:
            raise ConsoleError("page_not_found", "That letter page does not exist", status=404)
        try:
            return self._items[page_id]
        except KeyError as error:
            raise ConsoleError("page_not_found", "That letter page does not exist", status=404) from error

    def public_listing(self) -> dict[str, Any]:
        return {
            "schema_version": CATALOG_SCHEMA,
            "catalog_revision": self.catalog_revision,
            "count": self.count,
            "items": [page.public_record() for page in self._items.values()],
        }

    def resolve_catalog_source(self, page_id: str) -> ArchiveSourcePage:
        page = self.page(page_id)
        try:
            stat = page.absolute_path.lstat()
        except OSError as error:
            raise ConsoleError("source_missing", "That archive page is unavailable") from error
        if page.absolute_path.is_symlink() or not page.absolute_path.is_file():
            raise ConsoleError("source_unsafe", "That archive page is not a regular file")
        if stat.st_size != page.size_bytes or stat.st_mtime_ns != page.mtime_ns:
            raise ConsoleError(
                "stale_library",
                "That archive page changed after the library opened; reopen the library",
                status=409,
            )
        try:
            with Image.open(page.absolute_path) as image:
                upright = ImageOps.exif_transpose(image)
                upright.load()
                if upright.size != (page.width, page.height):
                    raise ConsoleError("source_changed", "That archive page changed dimensions")
        except ConsoleError:
            raise
        except Exception as error:
            raise ConsoleError("source_invalid", "That archive page is unreadable") from error
        return page
