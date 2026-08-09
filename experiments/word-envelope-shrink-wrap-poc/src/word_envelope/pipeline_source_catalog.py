"""Safe source selection for standalone human pipeline experiments.

The module deliberately exposes only the frozen, letter-only layout cohorts from
the real Letter Archive repository.  Filesystem paths and source checksums stay
server-side.  A selected source is copied into a new session staging directory
and decoded into a deterministic, metadata-free RGB working raster before any
pipeline state may bind to it.

This is a storage/service layer only.  It does not provide HTTP routes, choose an
active browser session, or initialize any downstream agent workflow.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
from typing import Any, Mapping
import warnings

from PIL import Image, UnidentifiedImageError


CATALOG_SCHEMA_VERSION = "pipeline-source-catalog.v1"
SOURCE_MANIFEST_SCHEMA_VERSION = "pipeline-source-manifest.v1"

CATALOG_MANIFEST_RELATIVE_PATHS = (
    PurePosixPath("backend/benchmarks/layout/cohort.v1.json"),
    PurePosixPath("backend/benchmarks/layout/rotated-holdout.v1.json"),
)

MAX_MANIFEST_BYTES = 5 * 1024 * 1024
MAX_CATALOG_SOURCE_BYTES = 100 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_IMAGE_EDGE = 8192
MAX_IMAGE_PIXELS = 40_000_000

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_COLLECTION_RE = re.compile(r"^[0-9]{3}$")
_DATE_RE = re.compile(r"^[0-9X]{8}$")
_CATALOG_ITEM_ID_RE = re.compile(r"^[0-9]{3}-[0-9X]{8}-L[0-9]{2}-[0-9]{2}$")
_CHALLENGE_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_SAFE_DISPLAY_CHARACTER_RE = re.compile(r"[^A-Za-z0-9._ -]+")

# This is the public, non-transcriptive vocabulary frozen by the layout-cohort
# schema.  Do not pass through an arbitrary future manifest string merely
# because it happens to look syntactically safe.
_CATALOG_SAFE_CHALLENGE_TAGS = frozenset(
    {
        "adjacent-page-text",
        "background-clutter",
        "background-text",
        "bleed-through",
        "blue-ink",
        "clean-horizontal-control",
        "clean-negative-control",
        "correction-caret",
        "cropped-text",
        "curved-lines",
        "dense-body-text",
        "dense-handwriting",
        "detached-postscript",
        "exif-orientation",
        "faint-ink",
        "folded-paper",
        "low-contrast",
        "low-resolution",
        "marginalia",
        "mixed-image-and-text",
        "multi-column",
        "multi-script-print",
        "ordinary-horizontal",
        "printed-letterhead",
        "ruled-paper",
        "sideways-text",
        "skewed-page",
        "sparse-page",
        "strikeovers",
        "typed-text",
        "vertical-marginalia",
        "vertical-text",
    }
)

_FORMAT_TO_MEDIA_EXTENSION = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


class PipelineSourceError(RuntimeError):
    """Base error for safe source catalog and import operations."""


class CatalogDiscoveryError(PipelineSourceError):
    """The real Letter Archive repository could not be located safely."""


class CatalogValidationError(PipelineSourceError):
    """A frozen catalog manifest is malformed or internally inconsistent."""


class CatalogItemNotFoundError(PipelineSourceError):
    """A catalog item identifier is malformed or absent."""


class CatalogRevisionConflictError(PipelineSourceError):
    """The browser selected an older catalog revision."""


class SourceIntegrityError(PipelineSourceError):
    """A catalog source is missing, unsafe, or no longer matches its binding."""


class SourceSnapshotExistsError(PipelineSourceError):
    """The session staging directory already contains a source snapshot."""


class UploadValidationError(PipelineSourceError):
    """An uploaded source is not a supported bounded still image."""


@dataclass(frozen=True)
class CatalogItem:
    """Private catalog record.  ``expected_sha256`` must never reach the UI."""

    catalog_item_id: str
    collection_code: str
    date_raw: str
    letter_sequence: int
    page_number: int
    original_filename: str
    width: int
    height: int
    challenge_tags: tuple[str, ...]
    expected_sha256: str
    source_relative_path: PurePosixPath
    catalog_manifest_name: str

    def public_record(self, *, thumbnail_available: bool) -> dict[str, Any]:
        """Return the complete and intentionally narrow browser-safe shape."""

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
            "challenge_tags": list(self.challenge_tags),
            "thumbnail_available": bool(thumbnail_available),
        }


@dataclass(frozen=True)
class ResolvedCatalogSource:
    """Server-only verified source binding; do not serialize this object."""

    item: CatalogItem
    absolute_path: Path
    media_type: str
    image_format: str
    size_bytes: int
    file_sha256: str


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _canonical_hash(value: object) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = dict(value)
    basis.pop(field, None)
    return _canonical_hash(basis)


def _json_without_duplicate_keys(raw: bytes, *, label: str) -> dict[str, Any]:
    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise CatalogValidationError(f"{label} contains a duplicate JSON key")
            result[key] = value
        return result

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs)
    except CatalogValidationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CatalogValidationError(f"{label} is not valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise CatalogValidationError(f"{label} must contain one JSON object")
    return value


def _path_is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def _regular_file_inside(root: Path, relative: PurePosixPath, *, label: str) -> Path:
    """Resolve one regular file while rejecting traversal and descendant symlinks."""

    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise SourceIntegrityError(f"{label} has an unsafe relative path")
    try:
        canonical_root = root.resolve(strict=True)
    except OSError as error:
        raise SourceIntegrityError(f"{label} root is unavailable") from error
    if not canonical_root.is_dir():
        raise SourceIntegrityError(f"{label} root is not a directory")

    current = canonical_root
    for index, part in enumerate(relative.parts):
        current = current / part
        try:
            entry_stat = current.lstat()
        except OSError as error:
            raise SourceIntegrityError(f"{label} is unavailable") from error
        if stat.S_ISLNK(entry_stat.st_mode):
            raise SourceIntegrityError(f"{label} may not traverse a symbolic link")
        if index < len(relative.parts) - 1 and not stat.S_ISDIR(entry_stat.st_mode):
            raise SourceIntegrityError(f"{label} parent is not a directory")

    try:
        resolved = current.resolve(strict=True)
    except OSError as error:
        raise SourceIntegrityError(f"{label} is unavailable") from error
    if not _path_is_inside(canonical_root, resolved) or resolved != current:
        raise SourceIntegrityError(f"{label} escapes its allowed root")
    try:
        final_stat = resolved.stat()
    except OSError as error:
        raise SourceIntegrityError(f"{label} is unavailable") from error
    if not stat.S_ISREG(final_stat.st_mode):
        raise SourceIntegrityError(f"{label} is not a regular file")
    return resolved


def _read_bounded_regular_file(path: Path, *, maximum: int, label: str) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise SourceIntegrityError(f"{label} could not be opened safely") from error
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > maximum:
            raise SourceIntegrityError(f"{label} is not a bounded regular file")
        chunks: list[bytes] = []
        observed = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, maximum + 1 - observed))
            if not chunk:
                break
            observed += len(chunk)
            if observed > maximum:
                raise SourceIntegrityError(f"{label} exceeds its size limit")
            chunks.append(chunk)
        after = os.fstat(descriptor)
        if (
            after.st_dev != file_stat.st_dev
            or after.st_ino != file_stat.st_ino
            or after.st_size != file_stat.st_size
            or after.st_mtime_ns != file_stat.st_mtime_ns
        ):
            raise SourceIntegrityError(f"{label} changed while it was being read")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _looks_like_letter_archive_root(candidate: Path) -> bool:
    try:
        root = candidate.resolve(strict=True)
    except OSError:
        return False
    if not root.is_dir() or candidate.is_symlink():
        return False
    for relative in CATALOG_MANIFEST_RELATIVE_PATHS:
        path = root.joinpath(*relative.parts)
        try:
            if path.is_symlink() or not path.is_file():
                return False
        except OSError:
            return False
    return (root / "backend/storage/collections").is_dir()


def discover_letter_archive_root(start: Path | None = None) -> Path:
    """Find the real repository from an override, a caller path, cwd, or siblings."""

    override = os.environ.get("LETTER_ARCHIVE_REPO_ROOT")
    if override:
        candidate = Path(override).expanduser()
        if not _looks_like_letter_archive_root(candidate):
            raise CatalogDiscoveryError("LETTER_ARCHIVE_REPO_ROOT is not a valid repository")
        return candidate.resolve(strict=True)

    seeds = [
        Path(start) if start is not None else Path.cwd(),
        Path(__file__).resolve(),
        Path.cwd(),
    ]
    candidates: list[Path] = []
    seen: set[str] = set()
    for seed in seeds:
        base = seed if seed.is_dir() else seed.parent
        for ancestor in (base, *base.parents):
            for candidate in (
                ancestor,
                ancestor / "letter-archive",
                ancestor.parent / "letter-archive",
            ):
                key = str(candidate)
                if key not in seen:
                    candidates.append(candidate)
                    seen.add(key)
    for candidate in candidates:
        if _looks_like_letter_archive_root(candidate):
            return candidate.resolve(strict=True)
    raise CatalogDiscoveryError("Could not locate the real Letter Archive repository")


def _required_mapping(value: Any, *, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CatalogValidationError(f"{label} must be an object")
    return value


def _required_list(value: Any, *, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise CatalogValidationError(f"{label} must be an array")
    return value


def _positive_int(value: Any, *, label: str, maximum: int | None = None) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise CatalogValidationError(f"{label} must be a positive integer")
    if maximum is not None and value > maximum:
        raise CatalogValidationError(f"{label} exceeds its supported maximum")
    return value


def _catalog_item_from_page(
    identity: Mapping[str, Any],
    page: Mapping[str, Any],
    *,
    manifest_name: str,
) -> CatalogItem:
    collection = identity.get("collectionCode")
    date_raw = identity.get("dateRaw")
    letter_type = identity.get("type")
    sequence = identity.get("typeSequence")
    page_number = page.get("pageNumber")
    filename = page.get("originalFilename")
    checksum = page.get("checksumSha256")
    if not isinstance(collection, str) or not _COLLECTION_RE.fullmatch(collection):
        raise CatalogValidationError("Catalog collectionCode is invalid")
    if not isinstance(date_raw, str) or not _DATE_RE.fullmatch(date_raw):
        raise CatalogValidationError("Catalog dateRaw is invalid")
    if letter_type != "L":
        raise CatalogValidationError("The standalone source catalog accepts only L pages")
    sequence = _positive_int(sequence, label="typeSequence", maximum=99)
    page_number = _positive_int(page_number, label="pageNumber", maximum=99)
    catalog_item_id = f"{collection}-{date_raw}-L{sequence:02d}-{page_number:02d}"
    if not _CATALOG_ITEM_ID_RE.fullmatch(catalog_item_id):
        raise CatalogValidationError("Catalog page identity is invalid")
    if not isinstance(filename, str):
        raise CatalogValidationError("Catalog originalFilename is invalid")
    # The archive's frozen filename grammar permits page one to omit ``-01``.
    # The catalog ID is always explicit even when the physical filename is not.
    filename_pattern = re.compile(
        rf"^{re.escape(collection)}-{re.escape(date_raw)}-L{sequence:02d}"
        rf"(?:-([0-9]{{2}}))?\.(?:jpg|jpeg|png|webp)$",
        re.IGNORECASE,
    )
    filename_match = filename_pattern.fullmatch(filename)
    filename_page_number = (
        int(filename_match.group(1))
        if filename_match is not None and filename_match.group(1) is not None
        else 1
    )
    if (
        filename_match is None
        or filename_page_number != page_number
        or Path(filename).name != filename
    ):
        raise CatalogValidationError("Catalog filename does not match its page identity")
    if not isinstance(checksum, str) or not _SHA256_RE.fullmatch(checksum):
        raise CatalogValidationError("Catalog checksumSha256 is invalid")
    width = _positive_int(page.get("width"), label="page width", maximum=MAX_IMAGE_EDGE)
    height = _positive_int(page.get("height"), label="page height", maximum=MAX_IMAGE_EDGE)
    if width * height > MAX_IMAGE_PIXELS:
        raise CatalogValidationError("Catalog page exceeds the supported pixel limit")
    raw_tags = _required_list(page.get("challengeTags"), label="challengeTags")
    tags: list[str] = []
    for tag in raw_tags:
        if (
            not isinstance(tag, str)
            or not _CHALLENGE_TAG_RE.fullmatch(tag)
            or tag not in _CATALOG_SAFE_CHALLENGE_TAGS
        ):
            raise CatalogValidationError("Catalog challenge tag is not display-safe")
        if tag in tags:
            raise CatalogValidationError("Catalog challenge tags contain a duplicate")
        tags.append(tag)
    if len(tags) > 64:
        raise CatalogValidationError("Catalog page has too many challenge tags")

    relative = PurePosixPath(
        "backend",
        "storage",
        "collections",
        collection,
        date_raw,
        f"L{sequence:02d}",
        filename,
    )
    return CatalogItem(
        catalog_item_id=catalog_item_id,
        collection_code=collection,
        date_raw=date_raw,
        letter_sequence=sequence,
        page_number=page_number,
        original_filename=filename,
        width=width,
        height=height,
        challenge_tags=tuple(tags),
        expected_sha256=checksum,
        source_relative_path=relative,
        catalog_manifest_name=manifest_name,
    )


def _load_catalog_manifest(root: Path, relative: PurePosixPath) -> tuple[list[CatalogItem], str]:
    try:
        path = _regular_file_inside(root, relative, label="Catalog manifest")
        raw = _read_bounded_regular_file(
            path, maximum=MAX_MANIFEST_BYTES, label="Catalog manifest"
        )
    except SourceIntegrityError as error:
        raise CatalogValidationError(str(error)) from error
    manifest = _json_without_duplicate_keys(raw, label=relative.name)
    if manifest.get("schemaVersion") != 1:
        raise CatalogValidationError(f"{relative.name} has an unsupported schemaVersion")
    letters = _required_list(manifest.get("letters"), label=f"{relative.name}.letters")
    items: list[CatalogItem] = []
    for letter_index, raw_letter in enumerate(letters):
        letter = _required_mapping(raw_letter, label=f"letter {letter_index}")
        identity = _required_mapping(letter.get("identity"), label="letter identity")
        pages = _required_list(letter.get("pages"), label="letter pages")
        if not pages:
            raise CatalogValidationError("Every frozen catalog letter needs at least one page")
        for raw_page in pages:
            page = _required_mapping(raw_page, label="catalog page")
            items.append(
                _catalog_item_from_page(
                    identity,
                    page,
                    manifest_name=relative.name,
                )
            )
    coverage = _required_mapping(manifest.get("coverage"), label="catalog coverage")
    if coverage.get("pageCount") != len(items) or coverage.get("letterCount") != len(letters):
        raise CatalogValidationError(f"{relative.name} coverage counts are stale")
    return items, hashlib.sha256(raw).hexdigest()


def _inspect_image_bytes(
    data: bytes,
    *,
    declared_media_type: str | None,
    expected_size: tuple[int, int] | None,
    expected_format: str | None,
    upload: bool,
) -> tuple[str, str, str, int, int]:
    error_type = UploadValidationError if upload else SourceIntegrityError
    if not data:
        raise error_type("The source image is empty")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                image_format = image.format
                width, height = image.size
                frames = int(getattr(image, "n_frames", 1))
                if image_format not in _FORMAT_TO_MEDIA_EXTENSION:
                    raise error_type("Only JPEG, PNG, and WebP source images are supported")
                media_type, extension = _FORMAT_TO_MEDIA_EXTENSION[image_format]
                if frames != 1:
                    raise error_type("Animated or multi-frame source images are not supported")
                if (
                    width < 1
                    or height < 1
                    or width > MAX_IMAGE_EDGE
                    or height > MAX_IMAGE_EDGE
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise error_type("The source image dimensions exceed the pipeline limits")
                if declared_media_type is not None:
                    declared = declared_media_type.split(";", 1)[0].strip().lower()
                    if declared != media_type:
                        raise error_type("The source bytes do not match the declared media type")
                if expected_size is not None and (width, height) != expected_size:
                    raise error_type("The source dimensions do not match the frozen catalog")
                if expected_format is not None and image_format != expected_format:
                    raise error_type("The source encoding does not match its frozen filename")
                image.verify()
    except error_type:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise error_type("The source is not a valid supported still image") from error
    return image_format, media_type, extension, width, height


def _safe_staging_directory(value: Path) -> Path:
    staging = Path(value)
    if staging.is_symlink():
        raise SourceIntegrityError("The session staging directory may not be a symlink")
    try:
        resolved = staging.resolve(strict=True)
        entry_stat = staging.lstat()
    except OSError as error:
        raise SourceIntegrityError("The session staging directory is unavailable") from error
    if not stat.S_ISDIR(entry_stat.st_mode) or not resolved.is_dir():
        raise SourceIntegrityError("The session staging path is not a directory")
    return resolved


def _write_new_file(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        view = memoryview(data)
        written = 0
        while written < len(view):
            written += os.write(descriptor, view[written:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _sync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        try:
            os.fsync(descriptor)
        except OSError:
            pass
    finally:
        os.close(descriptor)


def _pixel_sha256(image: Image.Image) -> str:
    digest = hashlib.sha256()
    digest.update(b"RGB\0")
    digest.update(f"{image.width}x{image.height}\0".encode("ascii"))
    rows = 256
    for top in range(0, image.height, rows):
        strip = image.crop((0, top, image.width, min(image.height, top + rows)))
        try:
            digest.update(strip.tobytes())
        finally:
            strip.close()
    return digest.hexdigest()


def _write_working_raster(original_path: Path, working_path: Path) -> tuple[str, str]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(working_path, flags, 0o600)
    try:
        with Image.open(original_path) as opened:
            opened.load()
            rgb = opened.convert("RGB")
        try:
            pixel_sha256 = _pixel_sha256(rgb)
            with os.fdopen(descriptor, "wb", closefd=False) as handle:
                rgb.save(
                    handle,
                    format="PNG",
                    optimize=False,
                    compress_level=9,
                )
                handle.flush()
                os.fsync(handle.fileno())
        finally:
            rgb.close()
    finally:
        os.close(descriptor)
    return hashlib.sha256(working_path.read_bytes()).hexdigest(), pixel_sha256


def _safe_upload_display_name(display_name: str, extension: str) -> str:
    raw = display_name if isinstance(display_name, str) else ""
    basename = raw.replace("\\", "/").rsplit("/", 1)[-1]
    basename = "".join(character for character in basename if ord(character) >= 32)
    basename = _SAFE_DISPLAY_CHARACTER_RE.sub("_", basename).strip(" .")
    stem = basename.rsplit(".", 1)[0].strip(" .") if "." in basename else basename
    stem = stem[: 180 - len(extension) - 1].rstrip(" .")
    if not stem or stem in {".", ".."}:
        stem = "uploaded-image"
    return f"{stem}.{extension}"


def _materialize_snapshot(
    *,
    staging_dir: Path,
    original_bytes: bytes,
    image_format: str,
    media_type: str,
    extension: str,
    width: int,
    height: int,
    origin: Mapping[str, Any],
    identity: Mapping[str, Any] | None,
) -> dict[str, Any]:
    staging = _safe_staging_directory(staging_dir)
    source_dir = staging / "source"
    if source_dir.exists() or source_dir.is_symlink():
        raise SourceSnapshotExistsError("The session staging directory already has a source")
    try:
        source_dir.mkdir(mode=0o700)
    except FileExistsError as error:
        raise SourceSnapshotExistsError("The session staging directory already has a source") from error

    try:
        original_name = f"original.{extension}"
        original_path = source_dir / original_name
        _write_new_file(original_path, original_bytes)
        original_sha256 = hashlib.sha256(original_bytes).hexdigest()
        working_path = source_dir / "working.png"
        working_sha256, pixel_sha256 = _write_working_raster(
            original_path, working_path
        )
        manifest: dict[str, Any] = {
            "schema_version": SOURCE_MANIFEST_SCHEMA_VERSION,
            "source_id": original_sha256,
            "origin": dict(origin),
            "identity": None if identity is None else dict(identity),
            "original": {
                "path": f"source/{original_name}",
                "display_name": origin.get("display_name"),
                "image_format": image_format,
                "media_type": media_type,
                "size_bytes": len(original_bytes),
                "size_wh": [width, height],
                "file_sha256": original_sha256,
                "coordinate_space": "encoded_source_pixels",
            },
            "working_raster": {
                "path": "source/working.png",
                "image_format": "PNG",
                "media_type": "image/png",
                "size_bytes": working_path.stat().st_size,
                "size_wh": [width, height],
                "file_sha256": working_sha256,
                "pixel_sha256": pixel_sha256,
                "coordinate_space": "encoded_source_pixels",
                "original_to_working_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
                "orientation_policy": "identity_no_exif_transpose",
                "metadata_policy": "rgb_pixels_only_no_source_metadata",
            },
        }
        manifest["source_manifest_sha256"] = _hash_without(
            manifest, "source_manifest_sha256"
        )
        manifest_bytes = json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        ).encode("utf-8") + b"\n"
        _write_new_file(source_dir / "source-manifest.json", manifest_bytes)
        _sync_directory(source_dir)
        _sync_directory(staging)
        return manifest
    except BaseException:
        shutil.rmtree(source_dir, ignore_errors=True)
        raise


class PipelineSourceCatalog:
    """Validated, frozen, letter-only archive source catalog."""

    def __init__(self, letter_archive_root: Path | None = None) -> None:
        if letter_archive_root is None:
            self.letter_archive_root = discover_letter_archive_root()
        else:
            try:
                self.letter_archive_root = Path(letter_archive_root).resolve(strict=True)
            except OSError as error:
                raise CatalogDiscoveryError(
                    "The configured Letter Archive root is unavailable"
                ) from error
        if not _looks_like_letter_archive_root(self.letter_archive_root):
            raise CatalogDiscoveryError("The configured Letter Archive root is invalid")

        items: list[CatalogItem] = []
        manifest_bindings: list[dict[str, str]] = []
        for relative in CATALOG_MANIFEST_RELATIVE_PATHS:
            loaded, file_sha256 = _load_catalog_manifest(
                self.letter_archive_root, relative
            )
            items.extend(loaded)
            manifest_bindings.append(
                {"name": relative.name, "file_sha256": file_sha256}
            )
        by_id: dict[str, CatalogItem] = {}
        for item in items:
            if item.catalog_item_id in by_id:
                raise CatalogValidationError(
                    f"Duplicate catalog item ID: {item.catalog_item_id}"
                )
            by_id[item.catalog_item_id] = item
        self._items = dict(sorted(by_id.items()))
        revision_basis = {
            "schema_version": CATALOG_SCHEMA_VERSION,
            "manifests": manifest_bindings,
            "items": [
                {
                    "catalog_item_id": item.catalog_item_id,
                    "expected_sha256": item.expected_sha256,
                    "width": item.width,
                    "height": item.height,
                    "challenge_tags": list(item.challenge_tags),
                }
                for item in self._items.values()
            ],
        }
        self.catalog_revision = _canonical_hash(revision_basis)

    @property
    def count(self) -> int:
        return len(self._items)

    def _item(self, catalog_item_id: str) -> CatalogItem:
        if (
            not isinstance(catalog_item_id, str)
            or not _CATALOG_ITEM_ID_RE.fullmatch(catalog_item_id)
        ):
            raise CatalogItemNotFoundError("The catalog item ID is invalid")
        try:
            return self._items[catalog_item_id]
        except KeyError as error:
            raise CatalogItemNotFoundError("The catalog item does not exist") from error

    def _safe_source_path(self, item: CatalogItem) -> Path:
        return _regular_file_inside(
            self.letter_archive_root,
            item.source_relative_path,
            label=f"Catalog source {item.catalog_item_id}",
        )

    def _thumbnail_available(self, item: CatalogItem) -> bool:
        try:
            self._safe_source_path(item)
        except SourceIntegrityError:
            return False
        return True

    def public_listing(self) -> dict[str, Any]:
        return {
            "schema_version": CATALOG_SCHEMA_VERSION,
            "catalog_revision": self.catalog_revision,
            "count": self.count,
            "items": [
                item.public_record(
                    thumbnail_available=self._thumbnail_available(item)
                )
                for item in self._items.values()
            ],
        }

    def public_item(self, catalog_item_id: str) -> dict[str, Any]:
        item = self._item(catalog_item_id)
        return item.public_record(
            thumbnail_available=self._thumbnail_available(item)
        )

    def resolve_catalog_source(self, catalog_item_id: str) -> ResolvedCatalogSource:
        """Verify a source from its server-side ID and frozen private binding."""

        item = self._item(catalog_item_id)
        source_path = self._safe_source_path(item)
        raw = _read_bounded_regular_file(
            source_path,
            maximum=MAX_CATALOG_SOURCE_BYTES,
            label=f"Catalog source {item.catalog_item_id}",
        )
        observed_sha256 = hashlib.sha256(raw).hexdigest()
        if observed_sha256 != item.expected_sha256:
            raise SourceIntegrityError("The catalog source checksum has changed")
        image_format, media_type, _, width, height = _inspect_image_bytes(
            raw,
            declared_media_type=None,
            expected_size=(item.width, item.height),
            # Frozen archive sources include historically mislabeled extensions;
            # the checksum and decoded dimensions are the authoritative binding.
            expected_format=None,
            upload=False,
        )
        return ResolvedCatalogSource(
            item=item,
            absolute_path=source_path,
            media_type=media_type,
            image_format=image_format,
            size_bytes=len(raw),
            file_sha256=observed_sha256,
        )

    def create_source_snapshot(
        self,
        catalog_item_id: str,
        catalog_revision: str,
        session_staging_dir: Path,
    ) -> dict[str, Any]:
        if catalog_revision != self.catalog_revision:
            raise CatalogRevisionConflictError(
                "The source catalog changed after this selection was shown"
            )
        resolved = self.resolve_catalog_source(catalog_item_id)
        raw = _read_bounded_regular_file(
            resolved.absolute_path,
            maximum=MAX_CATALOG_SOURCE_BYTES,
            label=f"Catalog source {resolved.item.catalog_item_id}",
        )
        if hashlib.sha256(raw).hexdigest() != resolved.file_sha256:
            raise SourceIntegrityError("The catalog source changed during snapshot creation")
        _, extension = _FORMAT_TO_MEDIA_EXTENSION[resolved.image_format]
        identity = {
            "catalog_item_id": resolved.item.catalog_item_id,
            "collection_code": resolved.item.collection_code,
            "date_raw": resolved.item.date_raw,
            "letter_sequence": resolved.item.letter_sequence,
            "page_number": resolved.item.page_number,
            "original_filename": resolved.item.original_filename,
        }
        return _materialize_snapshot(
            staging_dir=session_staging_dir,
            original_bytes=raw,
            image_format=resolved.image_format,
            media_type=resolved.media_type,
            extension=extension,
            width=resolved.item.width,
            height=resolved.item.height,
            origin={
                "kind": "archive_catalog",
                "catalog_item_id": resolved.item.catalog_item_id,
                "catalog_revision": self.catalog_revision,
                "display_name": resolved.item.original_filename,
            },
            identity=identity,
        )


def create_source_snapshot(
    catalog_item_id: str,
    catalog_revision: str,
    session_staging_dir: Path,
    *,
    catalog: PipelineSourceCatalog | None = None,
    letter_archive_root: Path | None = None,
) -> dict[str, Any]:
    """Convenience wrapper used by a future HTTP/session service."""

    selected_catalog = catalog or PipelineSourceCatalog(letter_archive_root)
    return selected_catalog.create_source_snapshot(
        catalog_item_id, catalog_revision, session_staging_dir
    )


def validate_upload_bytes(
    display_name: str,
    data: bytes,
    content_type: str,
    staging_dir: Path,
) -> dict[str, Any]:
    """Validate one uploaded still image and create an isolated source snapshot."""

    if not isinstance(data, bytes):
        raise UploadValidationError("Uploaded source data must be bytes")
    if len(data) < 1 or len(data) > MAX_UPLOAD_BYTES:
        raise UploadValidationError("The uploaded source exceeds the 50 MB limit")
    if not isinstance(content_type, str):
        raise UploadValidationError("The uploaded source needs a media type")
    image_format, media_type, extension, width, height = _inspect_image_bytes(
        data,
        declared_media_type=content_type,
        expected_size=None,
        expected_format=None,
        upload=True,
    )
    safe_display_name = _safe_upload_display_name(display_name, extension)
    return _materialize_snapshot(
        staging_dir=staging_dir,
        original_bytes=data,
        image_format=image_format,
        media_type=media_type,
        extension=extension,
        width=width,
        height=height,
        origin={
            "kind": "upload",
            "display_name": safe_display_name,
        },
        identity=None,
    )


__all__ = [
    "CATALOG_SCHEMA_VERSION",
    "SOURCE_MANIFEST_SCHEMA_VERSION",
    "MAX_IMAGE_EDGE",
    "MAX_IMAGE_PIXELS",
    "MAX_UPLOAD_BYTES",
    "CatalogDiscoveryError",
    "CatalogItemNotFoundError",
    "CatalogRevisionConflictError",
    "CatalogValidationError",
    "PipelineSourceCatalog",
    "PipelineSourceError",
    "ResolvedCatalogSource",
    "SourceIntegrityError",
    "SourceSnapshotExistsError",
    "UploadValidationError",
    "create_source_snapshot",
    "discover_letter_archive_root",
    "validate_upload_bytes",
]
