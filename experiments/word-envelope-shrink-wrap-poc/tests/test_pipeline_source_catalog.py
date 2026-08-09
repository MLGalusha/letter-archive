from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from PIL import Image

import word_envelope.pipeline_source_catalog as source_catalog
from word_envelope.pipeline_source_catalog import (
    CatalogItemNotFoundError,
    CatalogRevisionConflictError,
    CatalogValidationError,
    PipelineSourceCatalog,
    SourceIntegrityError,
    SourceSnapshotExistsError,
    UploadValidationError,
    discover_letter_archive_root,
    validate_upload_bytes,
)


REAL_007_ID = "007-19430411-L01-02"
REAL_014_ID = "014-18780127-L01-04"
REAL_007_SHA256 = "0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312"
REAL_014_SHA256 = "a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69"


def image_bytes(
    image_format: str = "PNG",
    *,
    size: tuple[int, int] = (32, 24),
    color: tuple[int, int, int] = (37, 82, 119),
) -> bytes:
    image = Image.new("RGB", size, color)
    try:
        output = BytesIO()
        image.save(output, format=image_format)
        return output.getvalue()
    finally:
        image.close()


def page_spec(
    *,
    collection: str,
    date_raw: str,
    image: bytes,
    page_number: int = 1,
    sequence: int = 1,
    filename: str | None = None,
    dimensions: tuple[int, int] = (32, 24),
    challenge_tags: tuple[str, ...] = ("clean-horizontal-control",),
) -> dict[str, object]:
    catalog_item_id = f"{collection}-{date_raw}-L{sequence:02d}-{page_number:02d}"
    return {
        "catalog_item_id": catalog_item_id,
        "collection": collection,
        "date_raw": date_raw,
        "sequence": sequence,
        "page_number": page_number,
        "filename": filename or f"{catalog_item_id}.png",
        "image": image,
        "width": dimensions[0],
        "height": dimensions[1],
        "challenge_tags": list(challenge_tags),
    }


def frozen_manifest(cohort_id: str, pages: list[dict[str, object]]) -> dict[str, object]:
    letters: list[dict[str, object]] = []
    for spec in pages:
        letters.append(
            {
                "identity": {
                    "collectionCode": spec["collection"],
                    "dateRaw": spec["date_raw"],
                    "type": "L",
                    "typeSequence": spec["sequence"],
                },
                "selection": {
                    "kind": "collection_coverage",
                    "reason": "isolated source catalog test fixture",
                },
                "pages": [
                    {
                        "pageNumber": spec["page_number"],
                        "originalFilename": spec["filename"],
                        "checksumSha256": hashlib.sha256(spec["image"]).hexdigest(),
                        "width": spec["width"],
                        "height": spec["height"],
                        "challengeTags": spec["challenge_tags"],
                    }
                ],
            }
        )
    return {
        "schemaVersion": 1,
        "cohortId": cohort_id,
        "createdAt": "2026-08-07",
        "description": "isolated source catalog test fixture",
        "sourceDimensionConvention": "encoded pixels before EXIF normalization",
        "preprocessingRequirements": {
            "applyExifOrientation": True,
            "recordPreparedInputChecksum": True,
            "recordPreparedInputDimensions": True,
        },
        "coverage": {
            "policy": "at-least-one-complete-L-record-per-collection",
            "collectionCodesAtSelection": [spec["collection"] for spec in pages],
            "letterCount": len(letters),
            "pageCount": len(pages),
        },
        # The implementation intentionally never follows or reads this field.
        "groundTruth": {
            "defaultStatus": "unannotated",
            "artifactDirectory": "never-read-by-source-catalog",
        },
        "letters": letters,
    }


def write_fixture_archive(
    root: Path,
    *,
    discovery_pages: list[dict[str, object]] | None = None,
    holdout_pages: list[dict[str, object]] | None = None,
) -> dict[str, Path]:
    first_image = image_bytes()
    discovery = discovery_pages or [
        page_spec(collection="001", date_raw="19000101", image=first_image)
    ]
    holdout = holdout_pages or [
        page_spec(
            collection="002",
            date_raw="19020202",
            image=image_bytes(color=(95, 41, 71)),
        )
    ]
    benchmark_dir = root / "backend" / "benchmarks" / "layout"
    collection_dir = root / "backend" / "storage" / "collections"
    benchmark_dir.mkdir(parents=True)
    collection_dir.mkdir(parents=True)

    source_paths: dict[str, Path] = {}
    for spec in [*discovery, *holdout]:
        source_path = (
            collection_dir
            / str(spec["collection"])
            / str(spec["date_raw"])
            / f"L{int(spec['sequence']):02d}"
            / str(spec["filename"])
        )
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(spec["image"])
        source_paths[str(spec["catalog_item_id"])] = source_path

    (benchmark_dir / "cohort.v1.json").write_text(
        json.dumps(frozen_manifest("fixture-discovery", discovery)),
        encoding="utf-8",
    )
    (benchmark_dir / "rotated-holdout.v1.json").write_text(
        json.dumps(frozen_manifest("fixture-holdout", holdout)),
        encoding="utf-8",
    )
    return source_paths


class RealFrozenCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = PipelineSourceCatalog()

    def test_discovers_sibling_real_repository_and_loads_all_frozen_pages(self) -> None:
        discovered = discover_letter_archive_root(Path(__file__).resolve())
        self.assertEqual(discovered.name, "letter-archive")
        for relative, expected_count in (
            ("backend/benchmarks/layout/cohort.v1.json", 66),
            ("backend/benchmarks/layout/rotated-holdout.v1.json", 14),
        ):
            frozen = json.loads((discovered / relative).read_text(encoding="utf-8"))
            self.assertEqual(frozen["coverage"]["pageCount"], expected_count)
        self.assertEqual(self.catalog.count, 80)
        listing = self.catalog.public_listing()
        self.assertEqual(listing["count"], 80)
        self.assertEqual(len(listing["items"]), 80)
        self.assertEqual(len({item["catalog_item_id"] for item in listing["items"]}), 80)

    def test_007_and_014_are_bound_to_the_frozen_hashes_and_dimensions(self) -> None:
        expected = {
            REAL_007_ID: (REAL_007_SHA256, (3000, 4000), "JPEG"),
            # This historical .jpg filename is WebP-encoded. Decode truth, not
            # the extension, is intentionally preserved in the private binding.
            REAL_014_ID: (REAL_014_SHA256, (1200, 1600), "WEBP"),
        }
        for item_id, (checksum, size, image_format) in expected.items():
            with self.subTest(item_id=item_id):
                resolved = self.catalog.resolve_catalog_source(item_id)
                self.assertEqual(resolved.file_sha256, checksum)
                self.assertEqual((resolved.item.width, resolved.item.height), size)
                self.assertEqual(resolved.image_format, image_format)

    def test_public_listing_has_only_the_explicit_browser_safe_shape(self) -> None:
        listing = self.catalog.public_listing()
        self.assertEqual(
            set(listing),
            {"schema_version", "catalog_revision", "count", "items"},
        )
        for item in listing["items"]:
            self.assertEqual(
                set(item),
                {
                    "catalog_item_id",
                    "identity",
                    "dimensions",
                    "challenge_tags",
                    "thumbnail_available",
                },
            )
            self.assertEqual(
                set(item["identity"]),
                {
                    "collection_code",
                    "date_raw",
                    "letter_sequence",
                    "page_number",
                    "original_filename",
                },
            )
            self.assertEqual(set(item["dimensions"]), {"width", "height"})

        serialized = json.dumps(listing).lower()
        self.assertNotIn(str(self.catalog.letter_archive_root).lower(), serialized)
        self.assertNotIn("backend/storage", serialized)
        self.assertNotIn("checksum", serialized)
        self.assertNotIn("transcript", serialized)
        self.assertNotIn("groundtruth", serialized)
        self.assertNotIn("ground_truth", serialized)
        self.assertNotIn(REAL_007_SHA256, serialized)
        self.assertNotIn(REAL_014_SHA256, serialized)

    def test_malformed_traversal_and_unknown_ids_are_indistinguishable(self) -> None:
        invalid_ids = (
            "../../etc/passwd",
            f"{REAL_007_ID}/../secret",
            f"{REAL_007_ID}\x00",
            "999-19000101-L01-01",
            "007-19430411-C01-02",
        )
        for item_id in invalid_ids:
            with self.subTest(item_id=item_id):
                with self.assertRaises(CatalogItemNotFoundError):
                    self.catalog.public_item(item_id)


class FixtureCatalogSecurityTests(unittest.TestCase):
    def test_duplicate_page_identity_across_manifests_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            duplicate = page_spec(
                collection="001", date_raw="19000101", image=image_bytes()
            )
            write_fixture_archive(
                root,
                discovery_pages=[duplicate],
                holdout_pages=[duplicate],
            )
            with self.assertRaisesRegex(CatalogValidationError, "Duplicate catalog item"):
                PipelineSourceCatalog(root)

    def test_manifest_filename_traversal_is_rejected_before_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            paths = write_fixture_archive(root)
            manifest_path = root / "backend/benchmarks/layout/cohort.v1.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["letters"][0]["pages"][0]["originalFilename"] = "../escape.png"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertTrue(paths)
            with self.assertRaisesRegex(CatalogValidationError, "filename"):
                PipelineSourceCatalog(root)

    def test_non_catalog_safe_challenge_tag_is_not_passed_to_the_browser(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            private_tag = page_spec(
                collection="001",
                date_raw="19000101",
                image=image_bytes(),
                challenge_tags=("transcript-secret",),
            )
            write_fixture_archive(root, discovery_pages=[private_tag])
            with self.assertRaisesRegex(CatalogValidationError, "display-safe"):
                PipelineSourceCatalog(root)

    def test_stale_catalog_revision_fails_before_creating_any_source_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            write_fixture_archive(root)
            catalog = PipelineSourceCatalog(root)
            staging = Path(directory) / "session"
            staging.mkdir()
            with self.assertRaises(CatalogRevisionConflictError):
                catalog.create_source_snapshot(
                    "001-19000101-L01-01", "0" * 64, staging
                )
            self.assertFalse((staging / "source").exists())

    def test_source_hash_drift_fails_closed_without_partial_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            paths = write_fixture_archive(root)
            catalog = PipelineSourceCatalog(root)
            paths["001-19000101-L01-01"].write_bytes(
                image_bytes(color=(200, 10, 25))
            )
            staging = Path(directory) / "session"
            staging.mkdir()
            with self.assertRaisesRegex(SourceIntegrityError, "checksum"):
                catalog.create_source_snapshot(
                    "001-19000101-L01-01", catalog.catalog_revision, staging
                )
            self.assertFalse((staging / "source").exists())

    def test_source_dimension_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            wrong_dimensions = page_spec(
                collection="001",
                date_raw="19000101",
                image=image_bytes(size=(31, 24)),
                dimensions=(32, 24),
            )
            write_fixture_archive(root, discovery_pages=[wrong_dimensions])
            catalog = PipelineSourceCatalog(root)
            with self.assertRaisesRegex(SourceIntegrityError, "dimensions"):
                catalog.resolve_catalog_source("001-19000101-L01-01")

    def test_source_symlink_is_never_resolved_or_previewed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            paths = write_fixture_archive(root)
            target = Path(directory) / "external.png"
            target.write_bytes(image_bytes())
            source = paths["001-19000101-L01-01"]
            source.unlink()
            source.symlink_to(target)
            catalog = PipelineSourceCatalog(root)
            self.assertFalse(
                catalog.public_item("001-19000101-L01-01")["thumbnail_available"]
            )
            with self.assertRaisesRegex(SourceIntegrityError, "symbolic link"):
                catalog.resolve_catalog_source("001-19000101-L01-01")

    def test_snapshots_are_deterministic_isolated_and_session_relative(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            paths = write_fixture_archive(root)
            original = paths["001-19000101-L01-01"].read_bytes()
            catalog = PipelineSourceCatalog(root)
            session_a = Path(directory) / "session-a"
            session_b = Path(directory) / "session-b"
            session_a.mkdir()
            session_b.mkdir()

            manifest_a = catalog.create_source_snapshot(
                "001-19000101-L01-01", catalog.catalog_revision, session_a
            )
            manifest_b = catalog.create_source_snapshot(
                "001-19000101-L01-01", catalog.catalog_revision, session_b
            )

            self.assertEqual(manifest_a, manifest_b)
            self.assertEqual(
                (session_a / manifest_a["original"]["path"]).read_bytes(), original
            )
            self.assertEqual(
                (session_b / manifest_b["original"]["path"]).read_bytes(), original
            )
            self.assertEqual(
                manifest_a["working_raster"]["file_sha256"],
                manifest_b["working_raster"]["file_sha256"],
            )
            manifest_hash_basis = dict(manifest_a)
            manifest_hash_basis.pop("source_manifest_sha256")
            self.assertEqual(
                manifest_a["source_manifest_sha256"],
                hashlib.sha256(
                    json.dumps(
                        manifest_hash_basis,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ).hexdigest(),
            )
            for section in ("original", "working_raster"):
                self.assertFalse(Path(manifest_a[section]["path"]).is_absolute())
            serialized_manifest = (session_a / "source/source-manifest.json").read_text()
            self.assertNotIn(str(root), serialized_manifest)

            (session_a / manifest_a["original"]["path"]).write_bytes(b"changed")
            self.assertEqual(
                (session_b / manifest_b["original"]["path"]).read_bytes(), original
            )

    def test_existing_snapshot_is_immutable_and_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            write_fixture_archive(root)
            catalog = PipelineSourceCatalog(root)
            staging = Path(directory) / "session"
            staging.mkdir()
            catalog.create_source_snapshot(
                "001-19000101-L01-01", catalog.catalog_revision, staging
            )
            manifest_path = staging / "source/source-manifest.json"
            before = manifest_path.read_bytes()
            with self.assertRaises(SourceSnapshotExistsError):
                catalog.create_source_snapshot(
                    "001-19000101-L01-01", catalog.catalog_revision, staging
                )
            self.assertEqual(manifest_path.read_bytes(), before)

    def test_concurrent_snapshot_writers_have_one_atomic_winner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "letter-archive"
            write_fixture_archive(root)
            catalog = PipelineSourceCatalog(root)
            staging = Path(directory) / "session"
            staging.mkdir()

            def attempt() -> str:
                try:
                    catalog.create_source_snapshot(
                        "001-19000101-L01-01", catalog.catalog_revision, staging
                    )
                except SourceSnapshotExistsError:
                    return "already_exists"
                return "created"

            with ThreadPoolExecutor(max_workers=2) as executor:
                outcomes = list(executor.map(lambda _: attempt(), range(2)))
            self.assertCountEqual(outcomes, ["created", "already_exists"])
            stored = json.loads(
                (staging / "source/source-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(stored["source_id"], stored["original"]["file_sha256"])


class UploadImportSecurityTests(unittest.TestCase):
    def test_upload_limits_are_the_declared_pipeline_contract(self) -> None:
        self.assertEqual(source_catalog.MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
        self.assertEqual(source_catalog.MAX_IMAGE_EDGE, 8192)
        self.assertEqual(source_catalog.MAX_IMAGE_PIXELS, 40_000_000)

    def test_jpeg_png_and_webp_uploads_create_exact_and_decoded_bindings(self) -> None:
        for image_format, content_type, extension in (
            ("JPEG", "image/jpeg", "jpg"),
            ("PNG", "image/png", "png"),
            ("WEBP", "image/webp", "webp"),
        ):
            with self.subTest(image_format=image_format):
                with tempfile.TemporaryDirectory() as directory:
                    staging = Path(directory) / "session"
                    staging.mkdir()
                    raw = image_bytes(image_format)
                    manifest = validate_upload_bytes(
                        f"letter.{extension}", raw, content_type, staging
                    )
                    original_path = staging / manifest["original"]["path"]
                    working_path = staging / manifest["working_raster"]["path"]
                    self.assertEqual(original_path.read_bytes(), raw)
                    self.assertEqual(original_path.suffix, f".{extension}")
                    self.assertEqual(manifest["original"]["file_sha256"], hashlib.sha256(raw).hexdigest())
                    self.assertTrue(working_path.is_file())
                    with Image.open(working_path) as working:
                        self.assertEqual(working.format, "PNG")
                        self.assertEqual(working.mode, "RGB")
                        self.assertEqual(working.size, (32, 24))

    def test_declared_mime_must_match_decoded_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory) / "session"
            staging.mkdir()
            with self.assertRaisesRegex(UploadValidationError, "media type"):
                validate_upload_bytes(
                    "misleading.png", image_bytes("JPEG"), "image/png", staging
                )
            self.assertFalse((staging / "source").exists())

    def test_animated_webp_is_rejected(self) -> None:
        first = Image.new("RGB", (16, 12), (255, 0, 0))
        second = Image.new("RGB", (16, 12), (0, 0, 255))
        try:
            output = BytesIO()
            try:
                first.save(
                    output,
                    format="WEBP",
                    save_all=True,
                    append_images=[second],
                    duration=100,
                    loop=0,
                )
            except OSError as error:
                self.skipTest(f"Pillow build has no animated WebP encoder: {error}")
            with tempfile.TemporaryDirectory() as directory:
                staging = Path(directory) / "session"
                staging.mkdir()
                with self.assertRaisesRegex(UploadValidationError, "multi-frame"):
                    validate_upload_bytes(
                        "animation.webp", output.getvalue(), "image/webp", staging
                    )
        finally:
            first.close()
            second.close()

    def test_byte_edge_and_pixel_limits_fail_before_materialization(self) -> None:
        cases = (
            ("MAX_UPLOAD_BYTES", 16, b"x" * 17, "image/png", "limit"),
            ("MAX_IMAGE_EDGE", 10, image_bytes(size=(11, 2)), "image/png", "dimensions"),
            ("MAX_IMAGE_PIXELS", 20, image_bytes(size=(6, 4)), "image/png", "dimensions"),
        )
        for constant, limit, raw, content_type, message in cases:
            with self.subTest(constant=constant):
                with tempfile.TemporaryDirectory() as directory:
                    staging = Path(directory) / "session"
                    staging.mkdir()
                    with mock.patch.object(source_catalog, constant, limit):
                        with self.assertRaisesRegex(UploadValidationError, message):
                            validate_upload_bytes(
                                "oversized.png", raw, content_type, staging
                            )
                    self.assertFalse((staging / "source").exists())

    def test_malicious_filename_never_controls_a_path_or_displayed_extension(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            staging = base / "session"
            staging.mkdir()
            raw = image_bytes("PNG")
            manifest = validate_upload_bytes(
                "../../outside/..\\evil.php\x00.png", raw, "image/png", staging
            )
            self.assertEqual(manifest["origin"]["display_name"], "evil.php.png")
            self.assertEqual(manifest["original"]["path"], "source/original.png")
            self.assertFalse((base / "outside").exists())
            self.assertEqual(
                (staging / "source/original.png").resolve().parent,
                (staging / "source").resolve(),
            )

    def test_upload_refuses_to_replace_an_existing_source_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory) / "session"
            staging.mkdir()
            raw = image_bytes()
            validate_upload_bytes("first.png", raw, "image/png", staging)
            before = (staging / "source/source-manifest.json").read_bytes()
            with self.assertRaises(SourceSnapshotExistsError):
                validate_upload_bytes("second.png", raw, "image/png", staging)
            self.assertEqual(
                (staging / "source/source-manifest.json").read_bytes(), before
            )


if __name__ == "__main__":
    unittest.main()
