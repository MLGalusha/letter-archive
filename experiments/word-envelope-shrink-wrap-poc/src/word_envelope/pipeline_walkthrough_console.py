"""Local source-to-stage walkthrough console.

The browser never receives an archive path or private prepared input.  A source
selection creates a new isolated container with a byte-for-byte source snapshot,
then the truthful :mod:`pipeline_walkthrough` core owns stage advancement.  This
module only normalizes that state for a human UI, serves hash-bound evidence, and
stores notes/telemetry as sidecars.
"""

from __future__ import annotations

import argparse
import base64
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
import fcntl
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import threading
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid

from PIL import Image, UnidentifiedImageError

from .human_review_console import (
    CSRF_HEADER_NAME,
    MAX_NOTE_CHARS,
    MAX_SCREENSHOT_BYTES,
    NOTE_CATEGORIES,
    NOTE_SEVERITIES,
    ObservationStore,
    ScreenshotUpload,
    _validated_image,
)
from .io_utils import canonical_json_bytes, sha256_file
from .pipeline_source_catalog import (
    CatalogItemNotFoundError,
    CatalogRevisionConflictError,
    PipelineSourceCatalog,
    PipelineSourceError,
    SourceIntegrityError,
)
from . import pipeline_walkthrough as walkthrough


CONSOLE_SESSION_SCHEMA_VERSION = "pipeline-walkthrough-console-session.v1"
UI_VERSION = "pipeline-console.v1"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_MULTIPART_BYTES = MAX_SCREENSHOT_BYTES + 512 * 1024
MAX_TELEMETRY_BYTES = 128 * 1024
MAX_STATIC_BYTES = 8 * 1024 * 1024
MAX_EVIDENCE_BYTES = 100 * 1024 * 1024
MAX_TELEMETRY_STAGE_GROUPS = 32
MAX_TELEMETRY_ITEM_GROUPS = 512

_SESSION_ID = re.compile(r"^[0-9a-f]{32}$")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_STATIC_SUFFIXES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}
_IMAGE_MEDIA = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

PREPARED_CATALOG_ITEM = "014-18780127-L01-04"
LEGACY_CATALOG_ITEM = "007-19430411-L01-02"

PIPELINE_NOTE_EVENTS = (
    "packet_opened",
    "stage_opened",
    "evidence_viewed",
    "instructions_viewed",
    "inspector_viewed",
    "rectangle_drawn",
    "rectangle_edited",
    "graph_link_changed",
    "action_form_opened",
    "confirmation_opened",
    "action_cancelled",
    "action_submitted",
    "action_failed",
    "action_succeeded",
    "note_opened",
    "note_saved",
    "blocked_stage_viewed",
)

_LOCKS_GUARD = threading.Lock()
_SESSION_LOCKS: dict[str, threading.RLock] = {}


class PipelineConsoleError(RuntimeError):
    """Expected public error with a stable code and status."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = HTTPStatus.BAD_REQUEST,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = int(status)
        self.details = dict(details or {})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _canonical_hash(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    return _canonical_hash(basis)


def _catalog_manifest_hash_without(value: Mapping[str, Any], field: str) -> str:
    """Reproduce the source catalog's compact manifest hash contract."""

    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    payload = json.dumps(
        basis,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _write_json_exclusive(path: Path, value: Mapping[str, Any]) -> None:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False
    ).encode("utf-8") + b"\n"
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        directory_flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            directory_flags |= os.O_DIRECTORY
        directory_descriptor = os.open(path.parent, directory_flags)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _load_json(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise PipelineConsoleError("session_integrity_error", f"{label} is unavailable", status=500)
    try:
        value = json.loads(path.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineConsoleError("session_integrity_error", f"{label} is invalid", status=500) from error
    if not isinstance(value, dict):
        raise PipelineConsoleError("session_integrity_error", f"{label} is invalid", status=500)
    return value


def _safe_session_id(value: Any) -> str:
    if not isinstance(value, str) or not _SESSION_ID.fullmatch(value):
        raise PipelineConsoleError("unknown_session", "The walkthrough session is invalid", status=404)
    return value


def _safe_relative(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise PipelineConsoleError("invalid_reference", "The evidence reference is invalid")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise PipelineConsoleError("invalid_reference", "The evidence reference is invalid")
    return relative


def _contained_regular_file(root: Path, value: Any) -> Path:
    relative = _safe_relative(value)
    root = root.resolve(strict=True)
    current = root
    for part in relative.parts:
        current = current / part
        try:
            entry = current.lstat()
        except OSError as error:
            raise PipelineConsoleError("missing_file", "The requested file is unavailable", status=404) from error
        if stat.S_ISLNK(entry.st_mode):
            raise PipelineConsoleError("invalid_reference", "Evidence may not traverse a symbolic link")
    resolved = current.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise PipelineConsoleError("invalid_reference", "The requested file is outside this session") from error
    if not resolved.is_file():
        raise PipelineConsoleError("missing_file", "The requested file is unavailable", status=404)
    return resolved


def _read_contained_regular_file_once(
    root: Path,
    value: Any,
    *,
    maximum: int,
) -> tuple[bytes, PurePosixPath]:
    """Read one contained regular file from a single no-follow descriptor.

    Each directory component is opened relative to its already-open parent.
    A concurrent rename therefore cannot turn a validated session reference
    into a read outside the session between validation, hashing, and serving.
    """

    relative = _safe_relative(value)
    root = root.resolve(strict=True)
    directory_flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        directory_flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        directory_flags |= os.O_NOFOLLOW
    file_flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        file_flags |= os.O_NOFOLLOW

    descriptor = os.open(root, directory_flags)
    try:
        for part in relative.parts[:-1]:
            next_descriptor = os.open(part, directory_flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        file_descriptor = os.open(relative.parts[-1], file_flags, dir_fd=descriptor)
    except OSError as error:
        raise PipelineConsoleError(
            "missing_file", "The requested file is unavailable", status=404
        ) from error
    finally:
        os.close(descriptor)

    try:
        metadata = os.fstat(file_descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise PipelineConsoleError(
                "invalid_reference", "The requested file is not a regular file"
            )
        if metadata.st_size > maximum:
            raise PipelineConsoleError(
                "file_too_large", "The requested file is too large", status=413
            )
        chunks: list[bytes] = []
        remaining = maximum + 1
        while remaining > 0:
            chunk = os.read(file_descriptor, min(1024 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        if len(data) > maximum or os.read(file_descriptor, 1):
            raise PipelineConsoleError(
                "file_too_large", "The requested file is too large", status=413
            )
        return data, relative
    finally:
        os.close(file_descriptor)


def _session_lock(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _LOCKS_GUARD:
        return _SESSION_LOCKS.setdefault(key, threading.RLock())


def _friendly_date(raw: str) -> str:
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    return raw


def _capability_for(catalog_item_id: str) -> dict[str, str]:
    if catalog_item_id == PREPARED_CATALOG_ITEM:
        return {
            "mode": "prepared_live",
            "label": "Fresh prepared protocol",
            "detail": "Can start a new, prompt-bound 014 visible-inventory and alignment run after the source gate.",
        }
    if catalog_item_id == LEGACY_CATALOG_ITEM:
        return {
            "mode": "recorded_legacy_available",
            "label": "Fresh source stops at preparation",
            "detail": "A separate recorded 007 ownership experiment exists, but it is not spliced into this fresh run.",
        }
    return {
        "mode": "source_only",
        "label": "Fresh source intake",
        "detail": "Selection is real; the current pipeline stops at the missing page-structure preparation stage.",
    }


def _public_catalog(catalog: PipelineSourceCatalog) -> dict[str, Any]:
    listing = catalog.public_listing()
    items: list[dict[str, Any]] = []
    for record in listing["items"]:
        identity = record["identity"]
        catalog_id = record["catalog_item_id"]
        items.append(
            {
                "id": catalog_id,
                "display_name": (
                    f"Collection {identity['collection_code']} · "
                    f"{_friendly_date(identity['date_raw'])} · page {identity['page_number']}"
                ),
                "subtitle": identity["original_filename"],
                "size_wh": [record["dimensions"]["width"], record["dimensions"]["height"]],
                "challenge_tags": copy.deepcopy(record["challenge_tags"]),
                "thumbnail_url": f"/api/catalog/{quote(catalog_id, safe='')}/thumbnail",
                "thumbnail_available": record["thumbnail_available"],
                "capability": _capability_for(catalog_id),
            }
        )
    priority = {PREPARED_CATALOG_ITEM: 0, LEGACY_CATALOG_ITEM: 1}
    items.sort(key=lambda item: (priority.get(item["id"], 2), item["id"]))
    return {
        "revision_sha256": listing["catalog_revision"],
        "count": listing["count"],
        "items": items,
    }


def _source_descriptor(
    container: Path,
    source_manifest: Mapping[str, Any],
    catalog_item_id: str,
) -> dict[str, Any]:
    original = source_manifest["original"]
    if catalog_item_id == PREPARED_CATALOG_ITEM:
        # The prepared v3 spec is cryptographically bound to the original
        # custody bytes.  Its rendered protocol evidence remains derived from
        # that source, while the browser's full-page view uses working_raster.
        source_path = _contained_regular_file(container, original["path"])
        spec = copy.deepcopy(walkthrough.protocol_v3.PAGE_SPECS_V3[walkthrough.PREPARED_PAGE_ID])
        spec["source_path"] = str(source_path)
        spec["source_sha256"] = original["file_sha256"]
        return {
            "schema_version": walkthrough.SOURCE_DESCRIPTOR_SCHEMA_VERSION,
            "page_id": walkthrough.PREPARED_PAGE_ID,
            "source": {
                "path": str(source_path),
                "sha256": original["file_sha256"],
                "size": copy.deepcopy(original["size_wh"]),
            },
            "prepared_protocol": {
                "kind": walkthrough.PREPARED_PROTOCOL_KIND,
                "spec": spec,
            },
        }
    working = source_manifest["working_raster"]
    source_path = _contained_regular_file(container, working["path"])
    return {
        "schema_version": walkthrough.SOURCE_DESCRIPTOR_SCHEMA_VERSION,
        "page_id": catalog_item_id,
        "source": {
            "path": str(source_path),
            "sha256": working["file_sha256"],
            "size": copy.deepcopy(working["size_wh"]),
        },
    }


class PipelineWalkthroughConsole:
    """Application service shared by HTTP and tests."""

    def __init__(
        self,
        workspace_dir: Path,
        *,
        static_dir: Path | None = None,
        letter_archive_root: Path | None = None,
    ) -> None:
        supplied = Path(workspace_dir)
        if supplied.is_symlink():
            raise PipelineConsoleError("unsafe_workspace", "The walkthrough workspace may not be a symlink")
        supplied.mkdir(parents=True, exist_ok=True)
        self.workspace = supplied.resolve(strict=True)
        self.sessions_root = self.workspace / "sessions"
        self.staging_root = self.workspace / ".staging"
        for directory in (self.sessions_root, self.staging_root):
            if directory.is_symlink():
                raise PipelineConsoleError("unsafe_workspace", "Walkthrough storage may not be a symlink")
            directory.mkdir(mode=0o700, exist_ok=True)
        default_static = Path(__file__).resolve().parents[2] / "pipeline_console"
        self.static_dir = Path(static_dir or default_static).resolve()
        self.catalog = PipelineSourceCatalog(letter_archive_root)
        self._creation_thread_lock = threading.RLock()
        self._creation_lock_path = self.workspace / ".session-create.lock"

    def _session_dir(self, session_id: Any) -> Path:
        safe = _safe_session_id(session_id)
        path = self.sessions_root / safe
        if path.is_symlink() or not path.is_dir():
            raise PipelineConsoleError("unknown_session", "The walkthrough session does not exist", status=404)
        return path.resolve(strict=True)

    def _metadata(self, session_dir: Path) -> dict[str, Any]:
        value = _load_json(session_dir / "console-session.json", "Console session")
        if value.get("schema_version") != CONSOLE_SESSION_SCHEMA_VERSION:
            raise PipelineConsoleError("session_integrity_error", "Console session schema drift", status=500)
        claimed = value.get("console_session_sha256")
        if not isinstance(claimed, str) or claimed != _hash_without(value, "console_session_sha256"):
            raise PipelineConsoleError("session_integrity_error", "Console session hash drift", status=500)
        if value.get("session_id") != session_dir.name:
            raise PipelineConsoleError("session_integrity_error", "Console session identity drift", status=500)
        source_manifest = _contained_regular_file(session_dir, value.get("source_manifest_path"))
        if sha256_file(source_manifest) != value.get("source_manifest_file_sha256"):
            raise PipelineConsoleError("session_integrity_error", "Source manifest file drift", status=500)
        source = _load_json(source_manifest, "Source manifest")
        if source.get("source_manifest_sha256") != value.get("source_manifest_sha256"):
            raise PipelineConsoleError("session_integrity_error", "Source manifest binding drift", status=500)
        if source.get("source_manifest_sha256") != _catalog_manifest_hash_without(
            source, "source_manifest_sha256"
        ):
            raise PipelineConsoleError("session_integrity_error", "Source manifest hash drift", status=500)
        return value

    def _core(self, session_dir: Path) -> walkthrough.PipelineWalkthroughSession:
        try:
            return walkthrough.open_session(session_dir / "pipeline")
        except walkthrough.WalkthroughError as error:
            raise PipelineConsoleError(error.code, "The walkthrough session failed its integrity check", status=500) from error

    def _anchored_core_current(
        self,
        session_dir: Path,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[walkthrough.PipelineWalkthroughSession, dict[str, Any]]:
        metadata = self._metadata(session_dir) if metadata is None else metadata
        core = self._core(session_dir)
        try:
            current = core.current()
        except walkthrough.WalkthroughError as error:
            raise PipelineConsoleError(
                error.code,
                "The walkthrough session failed its integrity check",
                status=500,
            ) from error
        if (
            current.get("session_id") != metadata.get("pipeline_session_id")
            or current.get("session_manifest_sha256")
            != metadata.get("pipeline_session_manifest_sha256")
        ):
            raise PipelineConsoleError(
                "session_integrity_error",
                "The walkthrough session identity no longer matches its console anchor",
                status=500,
            )
        return core, current

    @contextmanager
    def _session_write_guard(self, session_dir: Path):
        manager = walkthrough.session_write_lock(session_dir / "pipeline")
        try:
            manager.__enter__()
        except walkthrough.WalkthroughError as error:
            raise PipelineConsoleError(
                error.code, "The walkthrough session could not be locked safely", status=500
            ) from error
        try:
            yield
        finally:
            manager.__exit__(None, None, None)

    def _creation_lock(self):
        class _Context:
            def __init__(inner, outer: "PipelineWalkthroughConsole") -> None:
                inner.outer = outer
                inner.handle = None

            def __enter__(inner):
                inner.outer._creation_thread_lock.acquire()
                flags = os.O_CREAT | os.O_RDWR
                if hasattr(os, "O_NOFOLLOW"):
                    flags |= os.O_NOFOLLOW
                try:
                    descriptor = os.open(inner.outer._creation_lock_path, flags, 0o600)
                    inner.handle = os.fdopen(descriptor, "a+b")
                    fcntl.flock(inner.handle.fileno(), fcntl.LOCK_EX)
                except BaseException:
                    inner.outer._creation_thread_lock.release()
                    raise
                return inner

            def __exit__(inner, exc_type, exc, traceback):
                if inner.handle is not None:
                    inner.handle.close()
                inner.outer._creation_thread_lock.release()
                return False

        return _Context(self)

    def _session_summaries(self) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for path in sorted(self.sessions_root.iterdir()):
            if not path.is_dir() or path.is_symlink() or not _SESSION_ID.fullmatch(path.name):
                continue
            try:
                with self._session_write_guard(path):
                    metadata = self._metadata(path)
                    _, current = self._anchored_core_current(path, metadata)
            except PipelineConsoleError:
                continue
            identity = metadata["source_identity"]
            values.append(
                {
                    "session_id": path.name,
                    "display_name": metadata["display_name"],
                    "source_identity": copy.deepcopy(identity),
                    "created_at": metadata["created_at"],
                    "stage_id": current["stage"],
                    "revision": current["revision"],
                    "status": current["status"],
                    "capability": copy.deepcopy(metadata["capability"]),
                    "open_url": f"/?session={path.name}",
                }
            )
        values.sort(key=lambda value: value["created_at"], reverse=True)
        return values

    def global_bootstrap(self) -> dict[str, Any]:
        return {
            "catalog": _public_catalog(self.catalog),
            "sessions": self._session_summaries(),
            "product_truth": {
                "arbitrary_source_status": "blocked_missing_source_preparation",
                "prepared_live_source_ids": [PREPARED_CATALOG_ITEM],
                "legacy_recording_source_ids": [LEGACY_CATALOG_ITEM],
                "historical_exact_prompt_guarantee": False,
                "new_session_prompt_binding": "verified_for_this_new_session",
            },
        }

    def create_session(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "catalog_item_id",
            "catalog_revision_sha256",
            "client_request_id",
        }:
            raise PipelineConsoleError("invalid_session_request", "Source selection fields are invalid")
        catalog_item_id = payload.get("catalog_item_id")
        revision = payload.get("catalog_revision_sha256")
        request_id = payload.get("client_request_id")
        if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
            raise PipelineConsoleError("invalid_session_request", "client_request_id is invalid")
        if not isinstance(catalog_item_id, str) or not isinstance(revision, str):
            raise PipelineConsoleError("invalid_session_request", "A catalog source and revision are required")

        with self._creation_lock():
            for candidate in sorted(self.sessions_root.iterdir()):
                if (
                    candidate.is_symlink()
                    or not candidate.is_dir()
                    or not _SESSION_ID.fullmatch(candidate.name)
                ):
                    continue
                metadata = self._metadata(candidate)
                if metadata.get("client_request_id") == request_id:
                    if (
                        metadata.get("catalog_item_id") != catalog_item_id
                        or metadata.get("catalog_revision_sha256") != revision
                    ):
                        raise PipelineConsoleError(
                            "idempotency_conflict",
                            "That creation request was already bound to a different source selection",
                            status=409,
                        )
                    return self.session_bootstrap(candidate.name)

            session_id = uuid.uuid4().hex
            staging = self.staging_root / f"{session_id}.creating"
            final = self.sessions_root / session_id
            staging.mkdir(mode=0o700)
            published = False
            try:
                source_manifest = self.catalog.create_source_snapshot(
                    catalog_item_id, revision, staging
                )
                staging.rename(final)
                published = True
                descriptor = _source_descriptor(final, source_manifest, catalog_item_id)
                core = walkthrough.create_session(final / "pipeline", descriptor)
                core_current = core.current()
                public_item = self.catalog.public_item(catalog_item_id)
                identity = source_manifest.get("identity") or {
                    "catalog_item_id": catalog_item_id,
                    "original_filename": source_manifest["original"]["display_name"],
                }
                metadata: dict[str, Any] = {
                    "schema_version": CONSOLE_SESSION_SCHEMA_VERSION,
                    "session_id": session_id,
                    "created_at": _utc_now(),
                    "client_request_id": request_id,
                    "catalog_item_id": catalog_item_id,
                    "catalog_revision_sha256": revision,
                    "display_name": public_item["identity"]["original_filename"],
                    "source_identity": copy.deepcopy(identity),
                    "source_manifest_path": "source/source-manifest.json",
                    "source_manifest_file_sha256": sha256_file(final / "source/source-manifest.json"),
                    "source_manifest_sha256": source_manifest["source_manifest_sha256"],
                    "source_original_file_sha256": source_manifest["original"]["file_sha256"],
                    "source_working_file_sha256": source_manifest["working_raster"][
                        "file_sha256"
                    ],
                    "source_size_wh": copy.deepcopy(
                        source_manifest["working_raster"]["size_wh"]
                    ),
                    "capability": _capability_for(catalog_item_id),
                    "pipeline_session_id": core_current["session_id"],
                    "pipeline_session_manifest_sha256": core_current["session_manifest_sha256"],
                }
                metadata["console_session_sha256"] = _hash_without(
                    metadata, "console_session_sha256"
                )
                _write_json_exclusive(final / "console-session.json", metadata)
                created_bootstrap = self.session_bootstrap(session_id)
            except BaseException:
                target = final if published else staging
                if target.exists() and target.parent in {self.sessions_root, self.staging_root}:
                    shutil.rmtree(target, ignore_errors=True)
                raise
        return created_bootstrap

    def _source_evidence(self, session_dir: Path, metadata: Mapping[str, Any]) -> dict[str, Any]:
        source_manifest = _load_json(
            _contained_regular_file(session_dir, metadata["source_manifest_path"]),
            "Source manifest",
        )
        working = source_manifest["working_raster"]
        return {
            "key": "full_source",
            "label": "Selected full source",
            "ref": working["path"],
            "url": (
                f"/api/sessions/{session_dir.name}/evidence?ref="
                + quote(working["path"], safe="")
            ),
            "sha256": working["file_sha256"],
            "size_wh": copy.deepcopy(working["size_wh"]),
            "role": "metadata_free_working_raster",
        }

    def _agent_turn_view(
        self,
        session_dir: Path,
        turn: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            prompt_text = base64.b64decode(turn["prompt"]["bytes_base64"], validate=True).decode("utf-8")
        except (KeyError, TypeError, ValueError, UnicodeDecodeError) as error:
            raise PipelineConsoleError("session_integrity_error", "Agent prompt snapshot is invalid", status=500) from error
        packet = copy.deepcopy(turn["public_packet"]["json"])
        evidence: list[dict[str, Any]] = []
        for index, item in enumerate(turn["evidence"]["files"], start=1):
            path = f"pipeline/protocol-v3/{item['path']}"
            evidence.append(
                {
                    "key": item["packet_pointer"].rsplit("/", 1)[-1] or f"evidence_{index}",
                    "label": item["packet_pointer"].replace("/evidence/", "").replace("_", " ").title(),
                    "ref": path,
                    "url": f"/api/sessions/{session_dir.name}/evidence?ref=" + quote(path, safe=""),
                    "sha256": item["observed_file_sha256"],
                    "size_wh": None,
                    "role": item.get("provenance_status"),
                    "packet_pointer": item["packet_pointer"],
                }
            )
        content_order = copy.deepcopy(turn.get("content_order"))
        if not isinstance(content_order, list):
            content_order = ["prompt", "public_packet", "response_schema", *[f"evidence:{item['key']}" for item in evidence]]
        return {
            "agent_turn_sha256": turn["agent_turn_sha256"],
            "content_order": content_order,
            "prompt": {
                "text": prompt_text,
                "sha256": turn["prompt"]["sha256"],
                "status": turn["prompt"]["provenance_status"],
            },
            "response_schema": {
                "value": copy.deepcopy(turn["response_schema"]["json"]),
                "sha256": turn["response_schema"]["sha256"],
                "status": turn["response_schema"]["provenance_status"],
            },
            "packet": {
                "value": packet,
                "sha256": turn["public_packet"]["packet_sha256"],
                "file_sha256": turn["public_packet"]["file_sha256"],
                "status": turn["public_packet"]["provenance_status"],
            },
            "evidence": evidence,
            "withheld": [
                {
                    "field": key,
                    "label": key.replace("_", " ").title(),
                    "detail": f"{key}: {value}",
                    "status": value,
                }
                for key, value in packet.get("withheld_from_acting_stage", {}).items()
            ],
            "congruence": copy.deepcopy(turn["legal_action_congruence"]),
            "actor_runtime": {
                "status": "human_walkthrough",
                "label": "You are occupying this turn; no model call is being made.",
                "recorded_model": copy.deepcopy(turn.get("actor_runtime")),
            },
        }

    def _current_view(
        self,
        session_dir: Path,
        metadata: Mapping[str, Any],
        current: Mapping[str, Any],
    ) -> dict[str, Any]:
        stage = current["stage"]
        source = self._source_evidence(session_dir, metadata)
        stage_names = {
            "source_intake": "Source preparation check",
            walkthrough.protocol_v3.STAGE_A: "Visible-span inventory",
            walkthrough.protocol_v3.STAGE_B: "Many-to-many alignment",
            "ownership_knockout": "Ownership preparation",
        }
        provenance = current["provenance_status"]
        raw_blocker = current.get("blocker")
        if isinstance(raw_blocker, Mapping) and raw_blocker.get("status") == "blocked_missing_transition":
            provenance = "blocked_missing_transition"
        turn_view = None
        action_type = "blocked"
        item_label = metadata["display_name"]
        next_effect = "No transition is available. Document what this missing stage needs."
        if isinstance(current.get("agent_turn"), Mapping):
            turn_view = self._agent_turn_view(session_dir, current["agent_turn"])
            packet = turn_view["packet"]["value"]
            item_label = packet["current"]["line_id"]
            if stage == walkthrough.protocol_v3.STAGE_A:
                action_type = "visible_inventory"
                next_effect = "A valid inventory opens alignment for this same line."
            else:
                action_type = "alignment_graph"
                next_effect = "A valid graph advances to the next line's blind inventory."
        elif stage == "source_intake" and current["legal_actions"]:
            action_type = "source_start"
            next_effect = "Start a fresh prepared 014 protocol at its first transcript-blind line."

        blocker = copy.deepcopy(raw_blocker)
        blockers: list[dict[str, Any]] = []
        if blocker is not None:
            blockers.append(
                {
                    **blocker,
                    "detail": blocker.get("message") or blocker.get("detail") or blocker.get("code"),
                }
            )
            for capability in blocker.get("missing_capabilities", []):
                if isinstance(capability, dict):
                    blockers.append(
                        {
                            "code": capability.get("id"),
                            "label": capability.get("label"),
                            "detail": capability.get("label"),
                            "status": "blocked_missing_transition",
                        }
                    )
        return {
            "stage_id": stage,
            "stage_name": stage_names.get(stage, stage.replace("_", " ").title()),
            "provenance": {
                "code": provenance,
                "label": provenance.replace("_", " ").title(),
                "detail": (
                    blocker.get("message")
                    if blocker
                    else "This screen is generated and hash-bound inside this new walkthrough session."
                ),
            },
            "revision": current["revision"],
            "current_sha256": current["current_sha256"],
            "item_label": item_label,
            "next_effect": next_effect,
            "kind": action_type,
            "status": current["status"],
            "legal_actions": copy.deepcopy(current["legal_actions"]),
            "blockers": blockers,
            "source_evidence": source,
            "agent_turn": turn_view,
            "action_ui": {
                "type": action_type,
                "legal_actions": copy.deepcopy(current["legal_actions"]),
                "title": (
                    "Start the prepared 014 protocol"
                    if action_type == "source_start"
                    else stage_names.get(stage, stage.replace("_", " ").title())
                ),
                "detail": (
                    "This explicit software transition creates a fresh transcript-blind Stage A. It does not replay the old 014 decisions."
                    if action_type == "source_start"
                    else None
                ),
                "actions": (
                    [
                        {
                            "type": "begin_prepared_protocol",
                            "label": "Begin fresh Stage A",
                            "description": "Create the first new, prompt-bound line inventory turn.",
                            "submit_label": "Begin prepared protocol",
                            "fields": [],
                        }
                    ]
                    if action_type == "source_start"
                    else []
                ),
                "defer_warning": (
                    "Defer advances this line but the downstream adapter cannot resolve or requeue it."
                    if stage in {walkthrough.protocol_v3.STAGE_A, walkthrough.protocol_v3.STAGE_B}
                    else None
                ),
            },
            "stage_graph": copy.deepcopy(current["stage_graph"]),
            "latest_transition": copy.deepcopy(current.get("latest_transition")),
        }

    def _notes(self, session_dir: Path) -> list[dict[str, Any]]:
        notes = ObservationStore(session_dir).list_notes()
        for note in notes:
            attachment = note.get("attachment")
            if isinstance(attachment, dict):
                attachment["url"] = f"/api/sessions/{session_dir.name}/attachments?id=" + quote(
                    attachment["attachment_id"], safe=""
                )
            evidence = note.get("evidence")
            if isinstance(evidence, dict):
                evidence["url"] = f"/api/sessions/{session_dir.name}/evidence?ref=" + quote(
                    evidence["ref"], safe=""
                )
        return notes

    def _record_server_action_success(
        self,
        session_dir: Path,
        commit: Mapping[str, Any],
        *,
        base_binding_override: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Idempotently mirror a durable transition as server-owned telemetry."""

        transition_sha256 = commit.get("transition_sha256")
        base = (
            base_binding_override
            if base_binding_override is not None
            else commit.get("base_binding")
        )
        result = commit.get("result")
        if (
            not isinstance(transition_sha256, str)
            or not _SHA256.fullmatch(transition_sha256)
            or not isinstance(base, Mapping)
            or not isinstance(result, Mapping)
        ):
            raise PipelineConsoleError(
                "session_integrity_error", "The committed action receipt is malformed", status=500
            )
        store = ObservationStore(session_dir)
        for event in store.interactions_chain.load():
            details = event.get("details")
            if (
                event.get("event_type") == "action_succeeded"
                and isinstance(details, dict)
                and details.get("recorded_by") == "pipeline_console_server"
                and details.get("transition_sha256") == transition_sha256
            ):
                return event

        revision = base.get("state_revision")
        stage_id = base.get("protocol_stage")
        item_label = base.get("item_label")
        current_sha256 = base.get("current_sha256")
        agent_turn_sha256 = base.get("agent_turn_sha256")
        # Receipts created by the immediately preceding POC build did not yet
        # include the three presentation-only base fields.  Their immutable
        # action/current bindings still let us reconcile one safe generic item.
        if not isinstance(revision, int) or isinstance(revision, bool):
            result_revision = result.get("state_revision")
            revision = (
                max(0, result_revision - 1)
                if isinstance(result_revision, int) and not isinstance(result_revision, bool)
                else None
            )
        if not isinstance(stage_id, str) or not stage_id:
            result_stage = result.get("protocol_stage")
            if commit.get("action_type") == "begin_prepared_protocol":
                stage_id = "source_intake"
            elif result_stage == walkthrough.protocol_v3.STAGE_B:
                stage_id = walkthrough.protocol_v3.STAGE_A
            else:
                stage_id = walkthrough.protocol_v3.STAGE_B
        if not isinstance(item_label, str) or not item_label:
            item_label = f"revision-{revision}" if isinstance(revision, int) else "unknown"
        if (
            not isinstance(revision, int)
            or isinstance(revision, bool)
            or revision < 0
            or not isinstance(stage_id, str)
            or not stage_id
            or not isinstance(item_label, str)
            or not item_label
            or not isinstance(current_sha256, str)
            or not _SHA256.fullmatch(current_sha256)
            or (
                agent_turn_sha256 is not None
                and (
                    not isinstance(agent_turn_sha256, str)
                    or not _SHA256.fullmatch(agent_turn_sha256)
                )
            )
        ):
            raise PipelineConsoleError(
                "session_integrity_error", "The committed action base binding is malformed", status=500
            )
        return store.append_interaction(
            binding={
                "session_id": session_dir.name,
                "pipeline_revision": revision,
                "current_sha256": current_sha256,
                "stage_id": stage_id,
                "item_label": item_label,
                "agent_turn_sha256": agent_turn_sha256,
            },
            event_type="action_succeeded",
            details={
                "recorded_by": "pipeline_console_server",
                "transition_sha256": transition_sha256,
                "transition_sequence": commit.get("sequence"),
                "action_type": commit.get("action_type"),
                "result_stage": result.get("protocol_stage"),
                "result_revision": result.get("state_revision"),
            },
            client_elapsed_ms=None,
            ui_version=UI_VERSION,
        )

    def _pipeline_telemetry_summary(self, session_dir: Path) -> dict[str, Any]:
        """Summarize pipeline events without exposing free-form client details."""

        try:
            events = ObservationStore(session_dir).interactions_chain.load()
        except Exception as error:
            raise PipelineConsoleError(
                "session_integrity_error", "Pipeline telemetry could not be verified", status=500
            ) from error
        counts = {name: 0 for name in PIPELINE_NOTE_EVENTS}
        stage_groups: dict[str, dict[str, Any]] = {}
        item_groups: dict[tuple[str, int | None, str], dict[str, Any]] = {}
        overflow_stage = {"total_events": 0, "client_elapsed_ms": 0}
        overflow_item = {"total_events": 0, "client_elapsed_ms": 0}
        total_elapsed = 0
        elapsed_count = 0

        def increment(group: dict[str, Any], event_type: str, elapsed: int | None) -> None:
            group["total_events"] = int(group.get("total_events", 0)) + 1
            by_type = group.setdefault("counts_by_type", {})
            by_type[event_type] = int(by_type.get(event_type, 0)) + 1
            if elapsed is not None:
                group["client_elapsed_ms"] = int(group.get("client_elapsed_ms", 0)) + elapsed

        for event in events:
            event_type = event.get("event_type")
            if event_type not in counts:
                raise PipelineConsoleError(
                    "session_integrity_error",
                    "Pipeline telemetry contains an unsupported event",
                    status=500,
                )
            counts[event_type] += 1
            elapsed = event.get("client_elapsed_ms")
            if not (
                isinstance(elapsed, int)
                and not isinstance(elapsed, bool)
                and 0 <= elapsed <= 86_400_000
            ):
                elapsed = None
            if elapsed is not None:
                total_elapsed += elapsed
                elapsed_count += 1
            binding = event.get("binding")
            binding = binding if isinstance(binding, dict) else {}
            stage_id = binding.get("stage_id")
            if not isinstance(stage_id, str) or not stage_id or len(stage_id) > 128:
                stage_id = "unknown"
            revision = binding.get("pipeline_revision")
            if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
                revision = None
            item_label = binding.get("item_label")
            if not isinstance(item_label, str) or not item_label or len(item_label) > 256:
                item_label = "unknown"

            stage_group = stage_groups.get(stage_id)
            if stage_group is None and len(stage_groups) < MAX_TELEMETRY_STAGE_GROUPS:
                stage_group = {
                    "stage_id": stage_id,
                    "total_events": 0,
                    "client_elapsed_ms": 0,
                }
                stage_groups[stage_id] = stage_group
            if stage_group is not None:
                increment(stage_group, event_type, elapsed)
            else:
                overflow_stage["total_events"] += 1
                overflow_stage["client_elapsed_ms"] += elapsed or 0

            item_key = (stage_id, revision, item_label)
            item_group = item_groups.get(item_key)
            if item_group is None and len(item_groups) < MAX_TELEMETRY_ITEM_GROUPS:
                item_group = {
                    "stage_id": stage_id,
                    "pipeline_revision": revision,
                    "item_label": item_label,
                    "total_events": 0,
                    "client_elapsed_ms": 0,
                }
                item_groups[item_key] = item_group
            if item_group is not None:
                increment(item_group, event_type, elapsed)
            else:
                overflow_item["total_events"] += 1
                overflow_item["client_elapsed_ms"] += elapsed or 0

        by_stage_values = sorted(
            stage_groups.values(), key=lambda item: (-item["total_events"], item["stage_id"])
        )
        by_item = sorted(
            item_groups.values(),
            key=lambda item: (
                -item["total_events"],
                item["stage_id"],
                item["pipeline_revision"] if item["pipeline_revision"] is not None else -1,
                item["item_label"],
            ),
        )
        by_stage_output: dict[str, dict[str, Any]] = {}
        for item in by_stage_values:
            group = {
                key: copy.deepcopy(value)
                for key, value in item.items()
                if key != "stage_id"
            }
            group["total"] = item["total_events"]
            by_stage_output[item["stage_id"]] = group
        return {
            "schema_version": "pipeline-walkthrough-telemetry-summary.v1",
            "total_events": len(events),
            "counts": copy.deepcopy(counts),
            "counts_by_type": counts,
            "failed_actions": counts["action_failed"],
            "successful_actions": counts["action_succeeded"],
            "action_failed": counts["action_failed"],
            "action_succeeded": counts["action_succeeded"],
            "retry_count": max(
                0,
                counts["action_submitted"]
                - counts["action_succeeded"]
                - counts["action_failed"],
            ),
            "note_count": counts["note_saved"],
            "total_client_elapsed_ms": total_elapsed,
            "mean_client_elapsed_ms": (
                round(total_elapsed / elapsed_count, 2) if elapsed_count else None
            ),
            "by_stage": by_stage_output,
            "by_item_binding": by_item,
            "overflow": {
                "stage_groups": overflow_stage,
                "item_groups": overflow_item,
            },
        }

    def session_bootstrap(self, session_id: Any) -> dict[str, Any]:
        session_dir = self._session_dir(session_id)
        with self._session_write_guard(session_dir):
            metadata = self._metadata(session_dir)
            _, current = self._anchored_core_current(session_dir, metadata)
            latest_transition = current.get("latest_transition")
            if isinstance(latest_transition, Mapping):
                try:
                    self._record_server_action_success(session_dir, latest_transition)
                except PipelineConsoleError:
                    raise
                except Exception as error:
                    raise PipelineConsoleError(
                        "action_success_telemetry_failed",
                        "A committed action could not be reconciled into session telemetry",
                        status=500,
                    ) from error
            result = {
                "session": {
                    "id": session_dir.name,
                    "session_id": session_dir.name,
                    "display_name": metadata["display_name"],
                    "created_at": metadata["created_at"],
                    "source_identity": copy.deepcopy(metadata["source_identity"]),
                    "source_size_wh": copy.deepcopy(metadata["source_size_wh"]),
                    "capability": copy.deepcopy(metadata["capability"]),
                    "pipeline_session_manifest_sha256": metadata[
                        "pipeline_session_manifest_sha256"
                    ],
                },
                "stage_graph": copy.deepcopy(current["stage_graph"]),
                "current": self._current_view(session_dir, metadata, current),
                "notes": self._notes(session_dir),
                "telemetry_summary": self._pipeline_telemetry_summary(session_dir),
                "note_options": {
                    "categories": list(NOTE_CATEGORIES),
                    "severities": list(NOTE_SEVERITIES),
                    "telemetry_event_types": list(PIPELINE_NOTE_EVENTS),
                },
                "upload_limits": {
                    "accepted_media_types": ["image/png", "image/jpeg", "image/webp"],
                    "max_bytes": MAX_SCREENSHOT_BYTES,
                    "max_note_characters": MAX_NOTE_CHARS,
                },
            }
        return result

    def apply_action(self, session_id: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "pipeline_revision",
            "agent_turn_sha256",
            "action",
        }:
            raise PipelineConsoleError("invalid_action", "Action fields are invalid")
        session_dir = self._session_dir(session_id)
        with self._session_write_guard(session_dir):
            metadata = self._metadata(session_dir)
            core, current = self._anchored_core_current(session_dir, metadata)
            if payload.get("pipeline_revision") != current["revision"]:
                raise PipelineConsoleError(
                    "stale_action",
                    "This stage advanced after the screen loaded. Nothing was applied.",
                    status=409,
                    details={"current_revision": current["revision"]},
                )
            action = payload.get("action")
            if not isinstance(action, Mapping):
                raise PipelineConsoleError("invalid_action", "action must be an object")
            successor: dict[str, Any] | None = None
            commit: dict[str, Any] | None = None
            try:
                if current["stage"] == "source_intake":
                    if payload.get("agent_turn_sha256") is not None:
                        raise PipelineConsoleError("invalid_action", "Source intake has no agent turn")
                    successor = core.apply_source_action(
                        {
                            "schema_version": walkthrough.SOURCE_ACTION_SCHEMA_VERSION,
                            "current_sha256": current["current_sha256"],
                            "action": copy.deepcopy(dict(action)),
                        }
                    )
                else:
                    turn = current.get("agent_turn")
                    if not isinstance(turn, dict) or payload.get("agent_turn_sha256") != turn["agent_turn_sha256"]:
                        raise PipelineConsoleError("stale_action", "The agent turn is stale. Nothing was applied.", status=409)
                    packet = turn["public_packet"]["json"]
                    schema_version = (
                        "inventory-stage-a-decision.v3"
                        if current["stage"] == walkthrough.protocol_v3.STAGE_A
                        else "alignment-stage-b-decision.v3"
                    )
                    decision = {
                        "schema_version": schema_version,
                        "trial_id": packet["trial_id"],
                        "page_id": packet["page_id"],
                        "line_id": packet["current"]["line_id"],
                        "stage": packet["current"]["stage"],
                        "state_revision": packet["state_revision"],
                        "state_sha256": packet["state_sha256"],
                        "packet_sha256": packet["packet_sha256"],
                        "action": copy.deepcopy(dict(action)),
                    }
                    successor = core.apply_v3_decision(
                        {
                            "schema_version": walkthrough.V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                            "current_sha256": current["current_sha256"],
                            "agent_turn_sha256": turn["agent_turn_sha256"],
                            "decision": decision,
                        }
                    )
            except PipelineConsoleError:
                raise
            except walkthrough.WalkthroughError as error:
                if error.committed:
                    candidate = error.details.get("action_commit")
                    if isinstance(candidate, dict):
                        commit = copy.deepcopy(candidate)
                    else:  # fail closed, but still state that mutation may have committed
                        return {
                            "committed": True,
                            "refresh_failed": True,
                            "action_commit": None,
                            "action_success_telemetry_recorded": False,
                            "refresh_error": {
                                "code": "committed_receipt_unavailable",
                                "message": "The action committed, but its durable receipt could not be displayed. Refresh this session before continuing.",
                            },
                        }
                else:
                    status = 409 if error.code in {"stale_current", "stale_agent_turn"} else 400
                    message = (
                        "This stage advanced after the screen loaded. Nothing was applied."
                        if status == 409
                        else "The current workflow rejected that decision. Review the highlighted requirements."
                    )
                    raise PipelineConsoleError(error.code, message, status=status) from error

            if commit is None:
                latest = successor.get("latest_transition") if isinstance(successor, dict) else None
                if not isinstance(latest, dict) or latest.get("committed") is not True:
                    return {
                        "committed": True,
                        "refresh_failed": True,
                        "action_commit": None,
                        "action_success_telemetry_recorded": False,
                        "refresh_error": {
                            "code": "committed_receipt_unavailable",
                            "message": "The action was accepted, but its durable receipt could not be displayed. Refresh this session before continuing.",
                        },
                    }
                commit = copy.deepcopy(latest)

            telemetry_recorded = False
            try:
                current_turn = current.get("agent_turn")
                self._record_server_action_success(
                    session_dir,
                    commit,
                    base_binding_override={
                        "current_sha256": current["current_sha256"],
                        "agent_turn_sha256": (
                            current_turn["agent_turn_sha256"]
                            if isinstance(current_turn, dict)
                            else None
                        ),
                        "protocol_stage": current["stage"],
                        "state_revision": current["revision"],
                        "item_label": (
                            current_turn["protocol"]["line_id"]
                            if isinstance(current_turn, dict)
                            else metadata["display_name"]
                        ),
                    },
                )
                telemetry_recorded = True
            except Exception:
                # The transition receipt is already durable.  A later bootstrap
                # retries this idempotent telemetry reconciliation.
                telemetry_recorded = False

            try:
                return self.session_bootstrap(session_dir.name)
            except Exception:
                return {
                    "committed": True,
                    "refresh_failed": True,
                    "action_commit": commit,
                    "action_success_telemetry_recorded": telemetry_recorded,
                    "refresh_error": {
                        "code": "action_committed_refresh_failed",
                        "message": "The action committed, but the next screen could not be refreshed. Reload this session before continuing.",
                    },
                }

    def _current_evidence_records(
        self, session_dir: Path, bootstrap: Mapping[str, Any]
    ) -> list[dict[str, Any]]:
        current = bootstrap["current"]
        records = [copy.deepcopy(current["source_evidence"])]
        turn = current.get("agent_turn")
        if isinstance(turn, dict):
            records.extend(copy.deepcopy(turn["evidence"]))
        return records

    def _note_evidence_records(self, session_dir: Path) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for note in ObservationStore(session_dir).list_notes():
            evidence = note.get("evidence")
            if isinstance(evidence, dict):
                records.append(copy.deepcopy(evidence))
        return records

    def read_evidence(self, session_id: Any, ref: str) -> tuple[bytes, str, str]:
        session_dir = self._session_dir(session_id)
        relative_ref = _safe_relative(ref)
        if relative_ref.parts[0] == "source" and str(relative_ref) != "source/working.png":
            raise PipelineConsoleError(
                "invalid_evidence",
                "Original custody bytes are never browser evidence",
                status=404,
            )
        allowed = self._current_evidence_records(
            session_dir, self.session_bootstrap(session_dir.name)
        ) + self._note_evidence_records(session_dir)
        record = next((item for item in allowed if item.get("ref") == ref), None)
        if record is None:
            raise PipelineConsoleError("invalid_evidence", "That file is not evidence for this session", status=404)
        data, relative = _read_contained_regular_file_once(
            session_dir, ref, maximum=MAX_EVIDENCE_BYTES
        )
        digest = hashlib.sha256(data).hexdigest()
        if digest != record.get("sha256") and digest != record.get("file_sha256"):
            raise PipelineConsoleError("session_integrity_error", "Evidence hash drift", status=500)
        media_type = _IMAGE_MEDIA.get(relative.suffix.lower())
        if media_type is None:
            raise PipelineConsoleError("invalid_evidence", "Only image evidence can be served")
        try:
            with Image.open(BytesIO(data)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise PipelineConsoleError("session_integrity_error", "Evidence image cannot be decoded", status=500) from error
        return data, media_type, digest

    def read_attachment(self, session_id: Any, attachment_id: str) -> tuple[bytes, str, str]:
        session_dir = self._session_dir(session_id)
        if not isinstance(attachment_id, str) or not _SESSION_ID.fullmatch(attachment_id):
            raise PipelineConsoleError("invalid_reference", "The attachment reference is invalid")
        with self._session_write_guard(session_dir):
            match: Mapping[str, Any] | None = None
            for note in ObservationStore(session_dir).list_notes():
                attachment = note.get("attachment")
                if (
                    isinstance(attachment, Mapping)
                    and attachment.get("attachment_id") == attachment_id
                ):
                    match = attachment
            if match is None:
                raise PipelineConsoleError(
                    "missing_file", "The attachment is unavailable", status=404
                )
            filename = match.get("filename")
            if not isinstance(filename, str) or not re.fullmatch(
                r"attachment-[0-9a-f]{32}\.(?:png|jpe?g|webp)", filename
            ):
                raise PipelineConsoleError(
                    "session_integrity_error", "The attachment record is malformed", status=500
                )
            data, _ = _read_contained_regular_file_once(
                session_dir,
                f"human-observations/attachments/{filename}",
                maximum=MAX_SCREENSHOT_BYTES,
            )
            digest = hashlib.sha256(data).hexdigest()
            media_type = match.get("media_type")
            if digest != match.get("file_sha256") or media_type not in {
                "image/png",
                "image/jpeg",
                "image/webp",
            }:
                raise PipelineConsoleError(
                    "session_integrity_error", "The attachment hash is stale", status=500
                )
            return data, media_type, digest

    def create_note(
        self,
        session_id: Any,
        fields: Mapping[str, str],
        upload: ScreenshotUpload | None,
    ) -> dict[str, Any]:
        session_dir = self._session_dir(session_id)
        allowed = {
            "text",
            "category",
            "severity",
            "current_sha256",
            "agent_turn_sha256",
            "evidence_ref",
        }
        if set(fields) - allowed:
            raise PipelineConsoleError("invalid_note", "The note fields are invalid")
        text = fields.get("text", "").strip()
        category = fields.get("category")
        severity = fields.get("severity")
        if len(text) > MAX_NOTE_CHARS or (
            not text and upload is None and not fields.get("evidence_ref")
        ):
            raise PipelineConsoleError(
                "invalid_note",
                "Add note text, current evidence, or a screenshot (maximum 5,000 text characters)",
            )
        if category not in NOTE_CATEGORIES or severity not in NOTE_SEVERITIES:
            raise PipelineConsoleError("invalid_note", "The note category or severity is invalid")
        with self._session_write_guard(session_dir):
            return self._create_note_locked(
                session_dir,
                fields=fields,
                upload=upload,
                text=text,
                category=category,
                severity=severity,
            )

    def _create_note_locked(
        self,
        session_dir: Path,
        *,
        fields: Mapping[str, str],
        upload: ScreenshotUpload | None,
        text: str,
        category: str,
        severity: str,
    ) -> dict[str, Any]:
        bootstrap = self.session_bootstrap(session_dir.name)
        current = bootstrap["current"]
        if fields.get("current_sha256") != current["current_sha256"]:
            raise PipelineConsoleError("stale_note", "This note is bound to a different screen. Save or copy its draft before refreshing.", status=409)
        current_turn = current.get("agent_turn")
        expected_turn = current_turn["agent_turn_sha256"] if isinstance(current_turn, dict) else ""
        if fields.get("agent_turn_sha256", "") != expected_turn:
            raise PipelineConsoleError("stale_note", "This note is bound to a different agent turn.", status=409)
        evidence = None
        evidence_ref = fields.get("evidence_ref", "")
        if evidence_ref:
            record = next(
                (
                    item
                    for item in self._current_evidence_records(session_dir, bootstrap)
                    if item.get("ref") == evidence_ref or item.get("key") == evidence_ref
                ),
                None,
            )
            if record is None:
                raise PipelineConsoleError("invalid_evidence", "The selected evidence is not on this screen")
            evidence = {
                "ref": record["ref"],
                "file_sha256": record["sha256"],
                "evidence_key": record["key"],
                "size_wh": copy.deepcopy(record.get("size_wh")),
                "role": record.get("role"),
            }
        binding = {
            "session_id": session_dir.name,
            "pipeline_session_manifest_sha256": bootstrap["session"][
                "pipeline_session_manifest_sha256"
            ],
            "pipeline_revision": current["revision"],
            "current_sha256": current["current_sha256"],
            "stage_id": current["stage_id"],
            "item_label": current["item_label"],
            "agent_turn_sha256": expected_turn or None,
            "prompt_sha256": (
                current_turn["prompt"]["sha256"] if isinstance(current_turn, dict) else None
            ),
        }
        try:
            note = ObservationStore(session_dir).create_or_edit_note(
                text=text,
                category=category,
                severity=severity,
                binding=binding,
                evidence=evidence,
                upload=upload,
                note_id=None,
            )
        except Exception as error:
            if isinstance(error, PipelineConsoleError):
                raise
            raise PipelineConsoleError("note_failed", "The note could not be saved", status=500) from error
        return {"note": note, "notes": self._notes(session_dir)}

    def record_telemetry(self, session_id: Any, payload: Mapping[str, Any]) -> dict[str, Any]:
        session_dir = self._session_dir(session_id)
        expected = {
            "current_sha256",
            "agent_turn_sha256",
            "pipeline_revision",
            "event_type",
            "details",
            "client_elapsed_ms",
            "ui_version",
        }
        if not isinstance(payload, Mapping) or set(payload) != expected:
            raise PipelineConsoleError("invalid_telemetry", "Telemetry fields are invalid")
        event_type = payload.get("event_type")
        if event_type not in PIPELINE_NOTE_EVENTS:
            raise PipelineConsoleError("invalid_telemetry", "Telemetry event type is unsupported")
        with self._session_write_guard(session_dir):
            return self._record_telemetry_locked(session_dir, payload, event_type)

    def _record_telemetry_locked(
        self,
        session_dir: Path,
        payload: Mapping[str, Any],
        event_type: str,
    ) -> dict[str, Any]:
        current = self.session_bootstrap(session_dir.name)["current"]
        if payload.get("current_sha256") != current["current_sha256"]:
            raise PipelineConsoleError("stale_telemetry", "Telemetry is not bound to the current screen", status=409)
        expected_turn = (
            current["agent_turn"]["agent_turn_sha256"]
            if isinstance(current.get("agent_turn"), dict)
            else None
        )
        if (
            payload.get("pipeline_revision") != current["revision"]
            or payload.get("agent_turn_sha256") != expected_turn
        ):
            raise PipelineConsoleError(
                "stale_telemetry",
                "Telemetry is not bound to the current stage revision",
                status=409,
            )
        details = payload.get("details")
        elapsed = payload.get("client_elapsed_ms")
        ui_version = payload.get("ui_version")
        if not isinstance(details, Mapping) or len(canonical_json_bytes(details)) > 32 * 1024:
            raise PipelineConsoleError("invalid_telemetry", "Telemetry details are invalid")
        if elapsed is not None and (
            not isinstance(elapsed, int) or isinstance(elapsed, bool) or not 0 <= elapsed <= 86_400_000
        ):
            raise PipelineConsoleError("invalid_telemetry", "Telemetry elapsed time is invalid")
        if ui_version != UI_VERSION:
            raise PipelineConsoleError("invalid_telemetry", "Telemetry UI version is invalid")
        event = ObservationStore(session_dir).append_interaction(
            binding={
                "session_id": session_dir.name,
                "pipeline_revision": current["revision"],
                "current_sha256": current["current_sha256"],
                "stage_id": current["stage_id"],
                "item_label": current["item_label"],
                "agent_turn_sha256": (
                    current["agent_turn"]["agent_turn_sha256"]
                    if isinstance(current.get("agent_turn"), dict)
                    else None
                ),
            },
            event_type=event_type,
            details=details,
            client_elapsed_ms=elapsed,
            ui_version=ui_version,
        )
        return {"accepted": True, "event_sha256": event["event_sha256"]}

    def catalog_thumbnail(self, catalog_item_id: str) -> tuple[bytes, str, str]:
        try:
            resolved = self.catalog.resolve_catalog_source(catalog_item_id)
            raw, _ = _read_contained_regular_file_once(
                resolved.absolute_path.parent,
                resolved.absolute_path.name,
                maximum=MAX_EVIDENCE_BYTES,
            )
        except PipelineSourceError as error:
            raise PipelineConsoleError("unknown_catalog_item", "That catalog image is unavailable", status=404) from error
        if hashlib.sha256(raw).hexdigest() != resolved.file_sha256:
            raise PipelineConsoleError("source_integrity_error", "Catalog source changed", status=500)
        try:
            with Image.open(BytesIO(raw)) as opened:
                opened.load()
                image = opened.convert("RGB")
            try:
                image.thumbnail((420, 420), Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format="JPEG", quality=82, optimize=True)
            finally:
                image.close()
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise PipelineConsoleError("source_integrity_error", "Catalog image cannot be decoded", status=500) from error
        data = output.getvalue()
        return data, "image/jpeg", hashlib.sha256(data).hexdigest()

    def static_file(self, request_path: str) -> tuple[bytes, str]:
        if request_path in {"", "/"}:
            request_path = "/index.html"
        relative = _safe_relative(unquote(request_path).lstrip("/"))
        media_type = _STATIC_SUFFIXES.get(relative.suffix.lower())
        if media_type is None:
            raise PipelineConsoleError("missing_file", "Static file not found", status=404)
        try:
            data, _ = _read_contained_regular_file_once(
                self.static_dir, str(relative), maximum=MAX_STATIC_BYTES
            )
        except PipelineConsoleError as error:
            if error.code == "file_too_large":
                raise PipelineConsoleError(
                    "missing_file", "Static file is too large", status=404
                ) from error
            raise
        return data, media_type


def _parse_note_multipart(content_type: str, body: bytes) -> tuple[dict[str, str], ScreenshotUpload | None]:
    if len(body) > MAX_MULTIPART_BYTES:
        raise PipelineConsoleError("request_too_large", "The note request is too large", status=413)
    if not content_type.lower().startswith("multipart/form-data"):
        raise PipelineConsoleError("unsupported_media_type", "Notes require multipart/form-data", status=415)
    try:
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii", "strict") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
        )
    except (UnicodeEncodeError, ValueError) as error:
        raise PipelineConsoleError("malformed_multipart", "The note upload is malformed") from error
    if message.defects or not message.is_multipart():
        raise PipelineConsoleError("malformed_multipart", "The multipart boundary is invalid")
    allowed = {
        "text",
        "category",
        "severity",
        "current_sha256",
        "agent_turn_sha256",
        "evidence_ref",
    }
    fields: dict[str, str] = {}
    upload: ScreenshotUpload | None = None
    for part in message.iter_parts():
        if part.defects or part.is_multipart() or part.get_content_disposition() != "form-data":
            raise PipelineConsoleError("malformed_multipart", "A note section is malformed")
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        value = part.get_payload(decode=True)
        if not isinstance(name, str) or not isinstance(value, bytes):
            raise PipelineConsoleError("malformed_multipart", "A note field is malformed")
        if name == "screenshot":
            if upload is not None or not isinstance(filename, str):
                raise PipelineConsoleError("malformed_multipart", "Only one screenshot is allowed")
            upload = ScreenshotUpload(value, part.get_content_type(), filename)
            continue
        if filename is not None or name not in allowed or name in fields or len(value) > 80_000:
            raise PipelineConsoleError("malformed_multipart", "A note field is unsupported")
        try:
            fields[name] = value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise PipelineConsoleError("malformed_multipart", "A note field is not UTF-8") from error
    if upload is not None:
        try:
            _validated_image(upload.data, upload.media_type)
        except Exception as error:
            raise PipelineConsoleError("invalid_upload", "The screenshot is not a supported still image") from error
    return fields, upload


class PipelineConsoleHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], console: PipelineWalkthroughConsole):
        self.console = console
        self.csrf_token = secrets.token_urlsafe(32)
        super().__init__(address, PipelineConsoleHandler)
        port = int(self.server_address[1])
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            self.allowed_hosts.update({"127.0.0.1", "localhost"})


class PipelineConsoleHandler(BaseHTTPRequestHandler):
    server: PipelineConsoleHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _headers(self, status: int, media_type: str, length: int, digest: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; "
            "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'",
        )
        if digest:
            self.send_header("ETag", f'"{digest}"')
        self.end_headers()

    def _json(self, status: int, value: Mapping[str, Any]) -> None:
        data = canonical_json_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _ok(self, data: Any, status: int = 200) -> None:
        self._json(status, {"ok": True, "data": data})

    def _error(self, error: PipelineConsoleError) -> None:
        self._json(
            error.status,
            {"ok": False, "error": {"code": error.code, "message": error.message, "details": error.details}},
        )

    def _host(self) -> str:
        values = self.headers.get_all("Host", [])
        host = values[0].strip().lower() if len(values) == 1 else ""
        if host not in self.server.allowed_hosts:
            raise PipelineConsoleError("untrusted_host", "This console accepts only its exact localhost address", status=403)
        return host

    def _write_guard(self, host: str) -> None:
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != "http" or parsed.netloc.lower() != host or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                raise PipelineConsoleError("cross_origin_denied", "Cross-origin writes are not allowed", status=403)
        token = self.headers.get(CSRF_HEADER_NAME, "")
        if not secrets.compare_digest(token, self.server.csrf_token):
            raise PipelineConsoleError("csrf_denied", "The walkthrough token is missing or invalid", status=403)

    def _body(self, maximum: int) -> bytes:
        raw = self.headers.get("Content-Length")
        try:
            length = int(raw) if raw is not None else -1
        except ValueError as error:
            raise PipelineConsoleError("invalid_length", "Content-Length is invalid") from error
        if length < 0:
            raise PipelineConsoleError("length_required", "Content-Length is required", status=411)
        if length > maximum:
            raise PipelineConsoleError("request_too_large", "The request is too large", status=413)
        return self.rfile.read(length)

    def _json_body(self, maximum: int) -> dict[str, Any]:
        if self.headers.get_content_type() != "application/json":
            raise PipelineConsoleError("unsupported_media_type", "This endpoint requires application/json", status=415)
        try:
            value = json.loads(self._body(maximum).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PipelineConsoleError("invalid_json", "The request body is invalid JSON") from error
        if not isinstance(value, dict):
            raise PipelineConsoleError("invalid_json", "The request body must be an object")
        return value

    @staticmethod
    def _session_route(path: str, suffix: str) -> str | None:
        match = re.fullmatch(rf"/api/sessions/([0-9a-f]{{32}})/{suffix}", path)
        return match.group(1) if match else None

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._host()
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query, keep_blank_values=True)
            if parsed.path == "/api/bootstrap":
                data = self.server.console.global_bootstrap()
                data["csrf_token"] = self.server.csrf_token
                self._ok(data)
                return
            match = re.fullmatch(r"/api/catalog/([^/]+)/thumbnail", parsed.path)
            if match:
                data, media_type, digest = self.server.console.catalog_thumbnail(unquote(match.group(1)))
                self._headers(200, media_type, len(data), digest)
                self.wfile.write(data)
                return
            session_id = self._session_route(parsed.path, "bootstrap")
            if session_id:
                data = self.server.console.session_bootstrap(session_id)
                data["csrf_token"] = self.server.csrf_token
                self._ok(data)
                return
            session_id = self._session_route(parsed.path, "evidence")
            if session_id:
                refs = query.get("ref", [])
                if len(refs) != 1:
                    raise PipelineConsoleError("invalid_reference", "Exactly one evidence reference is required")
                data, media_type, digest = self.server.console.read_evidence(session_id, refs[0])
                self._headers(200, media_type, len(data), digest)
                self.wfile.write(data)
                return
            session_id = self._session_route(parsed.path, "attachments")
            if session_id:
                ids = query.get("id", [])
                if len(ids) != 1:
                    raise PipelineConsoleError("invalid_reference", "Exactly one attachment reference is required")
                data, media_type, digest = self.server.console.read_attachment(session_id, ids[0])
                self._headers(200, media_type, len(data), digest)
                self.wfile.write(data)
                return
            if parsed.path.startswith("/api/"):
                raise PipelineConsoleError("not_found", "API endpoint not found", status=404)
            data, media_type = self.server.console.static_file(parsed.path)
            self._headers(200, media_type, len(data))
            self.wfile.write(data)
        except PipelineConsoleError as error:
            self._error(error)
        except Exception:
            self._error(PipelineConsoleError("internal_error", "The walkthrough console encountered an error", status=500))

    def do_POST(self) -> None:  # noqa: N802
        try:
            host = self._host()
            self._write_guard(host)
            parsed = urlsplit(self.path)
            if parsed.path == "/api/sessions":
                self._ok(self.server.console.create_session(self._json_body(MAX_JSON_BYTES)), status=201)
                return
            session_id = self._session_route(parsed.path, "actions")
            if session_id:
                self._ok(self.server.console.apply_action(session_id, self._json_body(MAX_JSON_BYTES)))
                return
            session_id = self._session_route(parsed.path, "notes")
            if session_id:
                fields, upload = _parse_note_multipart(
                    self.headers.get("Content-Type", ""), self._body(MAX_MULTIPART_BYTES)
                )
                self._ok(self.server.console.create_note(session_id, fields, upload), status=201)
                return
            session_id = self._session_route(parsed.path, "telemetry")
            if session_id:
                self._ok(
                    self.server.console.record_telemetry(
                        session_id, self._json_body(MAX_TELEMETRY_BYTES)
                    ),
                    status=201,
                )
                return
            raise PipelineConsoleError("not_found", "API endpoint not found", status=404)
        except PipelineConsoleError as error:
            self._error(error)
        except (CatalogItemNotFoundError, CatalogRevisionConflictError, SourceIntegrityError) as error:
            status = 409 if isinstance(error, CatalogRevisionConflictError) else 400
            self._error(PipelineConsoleError("source_selection_failed", str(error), status=status))
        except PipelineSourceError:
            self._error(PipelineConsoleError("source_selection_failed", "The selected source could not be imported"))
        except Exception:
            self._error(PipelineConsoleError("internal_error", "The walkthrough console encountered an error", status=500))


def build_server(
    *,
    workspace_dir: Path,
    static_dir: Path | None = None,
    letter_archive_root: Path | None = None,
    host: str = "127.0.0.1",
    port: int = 8766,
) -> PipelineConsoleHTTPServer:
    if host not in {"127.0.0.1", "localhost"}:
        raise PipelineConsoleError("nonlocal_bind_denied", "The walkthrough may bind only to localhost")
    if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
        raise PipelineConsoleError("invalid_port", "Port must be between 0 and 65535")
    console = PipelineWalkthroughConsole(
        workspace_dir,
        static_dir=static_dir,
        letter_archive_root=letter_archive_root,
    )
    return PipelineConsoleHTTPServer((host, port), console)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local full-pipeline walkthrough console")
    parser.add_argument("--workspace-dir", type=Path, required=True)
    parser.add_argument("--static-dir", type=Path)
    parser.add_argument("--letter-archive-root", type=Path)
    parser.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    try:
        server = build_server(
            workspace_dir=args.workspace_dir,
            static_dir=args.static_dir,
            letter_archive_root=args.letter_archive_root,
            host=args.host,
            port=args.port,
        )
    except PipelineConsoleError as error:
        parser.exit(2, f"error: {error.message}\n")
    host, port = server.server_address[:2]
    print(f"Letter pipeline walkthrough: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "CONSOLE_SESSION_SCHEMA_VERSION",
    "PIPELINE_NOTE_EVENTS",
    "PipelineConsoleError",
    "PipelineWalkthroughConsole",
    "PipelineConsoleHTTPServer",
    "build_server",
    "main",
]
