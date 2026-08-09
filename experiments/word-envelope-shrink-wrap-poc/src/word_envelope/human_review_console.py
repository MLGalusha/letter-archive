"""Local, human-friendly console around the sequential ownership supervisor.

The console is intentionally a thin sidecar.  Ownership state can move only
through :func:`sequential_ownership.apply_compact_action`; human observations
and interaction telemetry live in separate append-only, hash-chained logs.
No HTTP request is allowed to name an arbitrary filesystem path.
"""

from __future__ import annotations

import argparse
import copy
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
import subprocess
import sys
import tempfile
import threading
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, quote, unquote, urlsplit
import uuid

import numpy as np
from PIL import Image, ImageDraw, UnidentifiedImageError

from .engine import EnvelopeError, EnvelopeParams, map_polygon_to_source
from .io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from .masks import stable_components
from . import sequential_ownership as supervisor
from .sequential_ownership import COMPACT_ACTION_SCHEMA_VERSION


OBSERVATION_SCHEMA_VERSION = "human-review-observation-event.v1"
INTERACTION_SCHEMA_VERSION = "human-review-interaction-event.v1"
CSRF_HEADER_NAME = "X-Review-CSRF-Token"

NOTE_CATEGORIES = (
    "confusing_step",
    "missing_tool",
    "visual_evidence",
    "wrong_result",
    "time_waste",
    "idea",
    "observation",
)
NOTE_SEVERITIES = ("low", "medium", "high", "blocker")
TELEMETRY_EVENT_TYPES = (
    "packet_opened",
    "evidence_viewed",
    "selection_toggled",
    "selection_seeded",
    "selection_boxed",
    "envelope_previewed",
    "decision_recorded",
    "action_form_opened",
    "confirmation_opened",
    "action_cancelled",
    "action_failed",
    "action_succeeded",
    "note_opened",
    "note_saved",
)

MODEL_DECISION_SCHEMA_VERSION = "candidate-word-agent-decision.v1"
MODEL_CROP_STATES = (
    "one_complete_word",
    "clipped_word",
    "multiple_words",
    "partial_letters_only",
    "wrong_region",
    "shared_or_touching_ink",
    "uncertain",
)
MODEL_DIFFICULTIES = ("routine", "attention_needed", "hard", "blocked")
MODEL_STRUGGLE_FLAGS = (
    "crop_clips_target",
    "crop_contains_neighbor",
    "detached_mark_uncertain",
    "ink_touches_neighbor",
    "reading_uncertain",
    "orientation_difficult",
    "proposal_on_wrong_line",
    "insufficient_context",
    "tool_did_not_help",
)

MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
MAX_SCREENSHOT_WIDTH = 8192
MAX_SCREENSHOT_HEIGHT = 8192
MAX_SCREENSHOT_PIXELS = 40_000_000
MAX_NOTE_CHARS = 5_000
MAX_MULTIPART_BYTES = MAX_SCREENSHOT_BYTES + 256 * 1024
MAX_ACTION_JSON_BYTES = 128 * 1024
MAX_TELEMETRY_JSON_BYTES = 64 * 1024
MAX_TELEMETRY_DETAILS_BYTES = 16 * 1024
MAX_PACKET_JSON_BYTES = 24 * 1024 * 1024
MAX_EVENT_JSON_BYTES = 512 * 1024

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SAFE_ID = re.compile(r"^[0-9a-f]{32}$")
_UI_VERSION = re.compile(r"^[A-Za-z0-9._+:-]{1,64}$")
_EVENT_NAME = re.compile(r"^(\d{8})-([0-9a-f]{32})\.json$")
_ATTACHMENT_NAME = re.compile(r"^attachment-([0-9a-f]{32})\.(png|jpg|webp)$")
_STATIC_SUFFIXES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}
_IMAGE_FORMATS = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"),
}

_RUN_ACTION_LOCKS_GUARD = threading.Lock()
_RUN_ACTION_LOCKS: dict[str, threading.RLock] = {}


def _run_action_lock(run_dir: Path) -> threading.RLock:
    """Share one in-process action lock across consoles bound to the same run."""

    key = str(run_dir.resolve())
    with _RUN_ACTION_LOCKS_GUARD:
        lock = _RUN_ACTION_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _RUN_ACTION_LOCKS[key] = lock
        return lock


def _fit_envelope_isolated(
    selected: np.ndarray,
    excluded: np.ndarray,
    profiles: Sequence[tuple[str, EnvelopeParams]],
) -> dict[str, Any]:
    """Fit small word geometry outside the page-rendering server process.

    Full-page evidence intentionally keeps the current page available.  A
    short-lived worker prevents that retained page memory from weakening the
    envelope engine's independent 450 MiB fail-safe.
    """

    with tempfile.TemporaryDirectory(prefix="candidate-envelope-") as raw:
        root = Path(raw)
        selected_path = root / "selected.png"
        excluded_path = root / "excluded.png"
        Image.fromarray(np.where(selected, 255, 0).astype(np.uint8), mode="L").save(selected_path)
        Image.fromarray(np.where(excluded, 255, 0).astype(np.uint8), mode="L").save(excluded_path)
        request = {
            "selected_path": str(selected_path),
            "excluded_path": str(excluded_path),
            "profiles": [
                {"name": name, "params": params.as_record()}
                for name, params in profiles
            ],
        }
        try:
            completed = subprocess.run(
                [sys.executable, "-m", "word_envelope.envelope_preview_worker"],
                input=canonical_json_bytes(request),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=45,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ConsoleError(
                "envelope_worker_failed",
                "The isolated fitted-envelope worker did not finish safely",
                status=500,
            ) from error
        if completed.returncode != 0:
            raise ConsoleError(
                "envelope_worker_failed",
                "The isolated fitted-envelope worker failed safely",
                status=500,
                details={"worker_error": completed.stderr.decode("utf-8", errors="replace")[-1000:]},
            )
        try:
            value = json.loads(completed.stdout)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ConsoleError(
                "envelope_worker_failed",
                "The isolated fitted-envelope worker returned an invalid receipt",
                status=500,
            ) from error
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("successes"), list)
            or not isinstance(value.get("failures"), dict)
        ):
            raise ConsoleError(
                "envelope_worker_failed",
                "The isolated fitted-envelope worker returned an invalid receipt",
                status=500,
            )
        return value


class ConsoleError(Exception):
    """Expected request or integrity error with a stable public shape."""

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


class ScreenshotUpload:
    """One bounded multipart image upload."""

    def __init__(self, data: bytes, media_type: str, filename: str = "") -> None:
        self.data = data
        self.media_type = media_type
        self.filename = filename


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def _json_object(raw: bytes, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConsoleError("invalid_json", f"{label} must be valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ConsoleError("invalid_json", f"{label} must be a JSON object")
    return value


def _safe_relative_path(value: Any, *, prefix: str | None = None) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ConsoleError("invalid_reference", "The file reference is invalid")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ConsoleError("invalid_reference", "The file reference is invalid")
    if prefix is not None and (not path.parts or path.parts[0] != prefix):
        raise ConsoleError("invalid_reference", "The file reference is outside its allowlist")
    return path


def _contained_file(root: Path, relative: PurePosixPath) -> Path:
    candidate = root.joinpath(*relative.parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise ConsoleError("missing_file", "The requested file is unavailable", status=404) from error
    try:
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise ConsoleError("invalid_reference", "The requested file is outside its allowlist") from error
    if not resolved.is_file():
        raise ConsoleError("missing_file", "The requested file is unavailable", status=404)
    return resolved


def _read_bounded(path: Path, limit: int, *, label: str) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise ConsoleError("missing_file", f"{label} is unavailable", status=404) from error
    if size > limit:
        raise ConsoleError("integrity_error", f"{label} exceeds its size limit", status=500)
    try:
        return path.read_bytes()
    except OSError as error:
        raise ConsoleError("missing_file", f"{label} is unavailable", status=404) from error


def _validated_image(
    data: bytes,
    declared_media_type: str,
) -> tuple[str, str, list[int], str]:
    """Decode and MIME-sniff an uploaded image without trusting its filename."""

    if not data:
        raise ConsoleError("invalid_upload", "The screenshot is empty")
    if len(data) > MAX_SCREENSHOT_BYTES:
        raise ConsoleError(
            "upload_too_large",
            "The screenshot exceeds the 8 MB limit",
            status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        )
    declared = declared_media_type.split(";", 1)[0].strip().lower()
    try:
        with Image.open(BytesIO(data)) as image:
            image_format = image.format
            width, height = image.size
            frames = int(getattr(image, "n_frames", 1))
            if image_format not in _IMAGE_FORMATS:
                raise ConsoleError(
                    "unsupported_upload_type", "Only PNG, JPEG, and WebP screenshots are allowed"
                )
            actual_media_type, extension = _IMAGE_FORMATS[image_format]
            if declared != actual_media_type:
                raise ConsoleError(
                    "mime_mismatch",
                    "The screenshot contents do not match its declared image type",
                )
            if (
                width < 1
                or height < 1
                or width > MAX_SCREENSHOT_WIDTH
                or height > MAX_SCREENSHOT_HEIGHT
                or width * height > MAX_SCREENSHOT_PIXELS
            ):
                raise ConsoleError(
                    "invalid_image_dimensions",
                    "The screenshot dimensions exceed the console limits",
                )
            if frames != 1:
                raise ConsoleError("animated_upload", "Animated screenshots are not allowed")
            image.verify()
    except ConsoleError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise ConsoleError("invalid_upload", "The screenshot is not a valid supported image") from error
    return actual_media_type, extension, [width, height], hashlib.sha256(data).hexdigest()


def parse_multipart_form(
    content_type: str,
    body: bytes,
) -> tuple[dict[str, str], ScreenshotUpload | None]:
    """Parse one already-capped multipart request using the stdlib email parser."""

    if len(body) > MAX_MULTIPART_BYTES:
        raise ConsoleError(
            "request_too_large",
            "The note request exceeds the upload limit",
            status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        )
    if not content_type.lower().startswith("multipart/form-data"):
        raise ConsoleError("unsupported_media_type", "Notes require multipart/form-data", status=415)
    header = content_type.encode("ascii", "strict")
    try:
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + header + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
        )
    except (UnicodeEncodeError, ValueError) as error:
        raise ConsoleError("malformed_multipart", "The multipart request is malformed") from error
    if (
        message.defects
        or not message.is_multipart()
        or message.get_content_subtype() != "form-data"
    ):
        raise ConsoleError("malformed_multipart", "The multipart boundary is missing or malformed")

    allowed_fields = {
        "text",
        "category",
        "severity",
        "work_packet_sha256",
        "evidence_ref",
        "note_id",
    }
    fields: dict[str, str] = {}
    screenshot: ScreenshotUpload | None = None
    parts = list(message.iter_parts())
    if len(parts) > len(allowed_fields) + 1:
        raise ConsoleError("malformed_multipart", "The note contains too many multipart fields")
    for part in parts:
        if part.defects or part.is_multipart():
            raise ConsoleError("malformed_multipart", "A multipart section is malformed")
        if part.get_content_disposition() != "form-data":
            raise ConsoleError("malformed_multipart", "Every multipart section must be form-data")
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if not isinstance(name, str) or not isinstance(payload, bytes):
            raise ConsoleError("malformed_multipart", "A multipart field is malformed")
        if name == "screenshot":
            if screenshot is not None or not isinstance(filename, str):
                raise ConsoleError("malformed_multipart", "Only one named screenshot file is allowed")
            screenshot = ScreenshotUpload(payload, part.get_content_type(), filename)
            continue
        if filename is not None or name not in allowed_fields or name in fields:
            raise ConsoleError("malformed_multipart", "The note contains an unsupported or duplicate field")
        if len(payload) > 80_000:
            raise ConsoleError("field_too_large", f"The {name} field is too large")
        try:
            fields[name] = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ConsoleError("malformed_multipart", f"The {name} field is not UTF-8") from error
    return fields, screenshot


class _AppendOnlyChain:
    """Small cross-thread/process append-only JSON chain."""

    def __init__(self, directory: Path, schema_version: str) -> None:
        self.directory = directory
        self.schema_version = schema_version
        self._thread_lock = threading.RLock()
        self._prepare_directory()

    def _prepare_directory(self) -> None:
        parent = self.directory.parent
        if parent.is_symlink():
            raise ConsoleError("unsafe_storage", "Observation storage may not be a symlink", status=500)
        parent.mkdir(parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise ConsoleError("unsafe_storage", "Observation log may not be a symlink", status=500)
        self.directory.mkdir(mode=0o700, exist_ok=True)

    @property
    def lock_path(self) -> Path:
        return self.directory.parent / f".{self.directory.name}.append.lock"

    def load(self) -> list[dict[str, Any]]:
        entries: list[tuple[int, str, Path]] = []
        for path in self.directory.iterdir():
            if path.is_symlink():
                raise ConsoleError("integrity_error", "An append-only event may not be a symlink", status=500)
            match = _EVENT_NAME.fullmatch(path.name)
            if match:
                entries.append((int(match.group(1)), match.group(2), path))
        entries.sort()
        events: list[dict[str, Any]] = []
        previous: str | None = None
        for expected_sequence, (sequence, event_id, path) in enumerate(entries, start=1):
            if sequence != expected_sequence:
                raise ConsoleError("integrity_error", "The append-only event sequence has a gap", status=500)
            value = _json_object(_read_bounded(path, MAX_EVENT_JSON_BYTES, label="Event"), label="Event")
            if value.get("schema_version") != self.schema_version:
                raise ConsoleError("integrity_error", "An append-only event has the wrong schema", status=500)
            if value.get("sequence") != sequence or value.get("event_id") != event_id:
                raise ConsoleError("integrity_error", "An append-only event identity is stale", status=500)
            if value.get("previous_event_sha256") != previous:
                raise ConsoleError("integrity_error", "The append-only event chain is broken", status=500)
            claimed = value.get("event_sha256")
            if not isinstance(claimed, str) or claimed != _hash_without(value, "event_sha256"):
                raise ConsoleError("integrity_error", "An append-only event hash is stale", status=500)
            previous = claimed
            events.append(value)
        return events

    def append(self, value: Mapping[str, Any]) -> dict[str, Any]:
        with self._thread_lock:
            self.lock_path.parent.mkdir(parents=True, exist_ok=True)
            lock_flags = os.O_CREAT | os.O_RDWR
            if hasattr(os, "O_NOFOLLOW"):
                lock_flags |= os.O_NOFOLLOW
            try:
                lock_descriptor = os.open(self.lock_path, lock_flags, 0o600)
            except OSError as error:
                raise ConsoleError(
                    "unsafe_storage",
                    "The append-only event log could not be locked safely",
                    status=500,
                ) from error
            with os.fdopen(lock_descriptor, "a+b") as lock_handle:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                events = self.load()
                sequence = len(events) + 1
                event_id = uuid.uuid4().hex
                event = copy.deepcopy(dict(value))
                event.update(
                    {
                        "schema_version": self.schema_version,
                        "sequence": sequence,
                        "event_id": event_id,
                        "previous_event_sha256": (
                            events[-1]["event_sha256"] if events else None
                        ),
                    }
                )
                event["event_sha256"] = _hash_without(event, "event_sha256")
                destination = self.directory / f"{sequence:08d}-{event_id}.json"
                payload = canonical_json_bytes(event) + b"\n"
                try:
                    with destination.open("xb") as handle:
                        handle.write(payload)
                        handle.flush()
                        os.fsync(handle.fileno())
                except FileExistsError as error:  # practically impossible, still never overwrite
                    raise ConsoleError("append_conflict", "Could not append the event", status=409) from error
                return event


class ObservationStore:
    """Append-only notes, attachments, and interaction telemetry."""

    def __init__(self, run_dir: Path) -> None:
        self.root = run_dir / "human-observations"
        if self.root.is_symlink():
            raise ConsoleError("unsafe_storage", "Observation storage may not be a symlink", status=500)
        self.root.mkdir(mode=0o700, exist_ok=True)
        self.attachments = self.root / "attachments"
        if self.attachments.is_symlink():
            raise ConsoleError("unsafe_storage", "Attachment storage may not be a symlink", status=500)
        self.attachments.mkdir(mode=0o700, exist_ok=True)
        self.previews = self.root / "envelope-previews"
        if self.previews.is_symlink():
            raise ConsoleError("unsafe_storage", "Preview storage may not be a symlink", status=500)
        self.previews.mkdir(mode=0o700, exist_ok=True)
        self.notes_chain = _AppendOnlyChain(self.root / "events", OBSERVATION_SCHEMA_VERSION)
        self.interactions_chain = _AppendOnlyChain(
            self.root / "interactions", INTERACTION_SCHEMA_VERSION
        )

    def _write_attachment(self, upload: ScreenshotUpload) -> dict[str, Any]:
        media_type, extension, dimensions, digest = _validated_image(
            upload.data, upload.media_type
        )
        attachment_id = uuid.uuid4().hex
        filename = f"attachment-{attachment_id}.{extension}"
        path = self.attachments / filename
        try:
            with path.open("xb") as handle:
                handle.write(upload.data)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError as error:
            raise ConsoleError("append_conflict", "Could not store the screenshot", status=409) from error
        return {
            "attachment_id": attachment_id,
            "filename": filename,
            "media_type": media_type,
            "bytes": len(upload.data),
            "size_wh": dimensions,
            "file_sha256": digest,
        }

    def list_notes(self) -> list[dict[str, Any]]:
        events = self.notes_chain.load()
        notes: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        for event in events:
            snapshot = event.get("note")
            if not isinstance(snapshot, dict):
                raise ConsoleError("integrity_error", "A note event is malformed", status=500)
            note_id = snapshot.get("note_id")
            if not isinstance(note_id, str) or not _SAFE_ID.fullmatch(note_id):
                raise ConsoleError("integrity_error", "A note ID is malformed", status=500)
            event_type = event.get("event_type")
            if event_type == "note_created":
                if note_id in notes:
                    raise ConsoleError("integrity_error", "A note was created twice", status=500)
                order.append(note_id)
            elif event_type == "note_edited":
                if note_id not in notes:
                    raise ConsoleError("integrity_error", "A note edit has no original", status=500)
            else:
                raise ConsoleError("integrity_error", "A note event type is unsupported", status=500)
            public = copy.deepcopy(snapshot)
            public["event_sha256"] = event["event_sha256"]
            public["version"] = 1 + int(notes.get(note_id, {}).get("version", 0))
            if public.get("attachment"):
                attachment_id = public["attachment"]["attachment_id"]
                public["attachment"]["url"] = (
                    "/api/attachments?id=" + quote(attachment_id, safe="")
                )
            if public.get("evidence"):
                public["evidence"]["url"] = (
                    "/api/evidence?ref=" + quote(public["evidence"]["ref"], safe="")
                )
            notes[note_id] = public
        return [notes[note_id] for note_id in reversed(order)]

    def create_or_edit_note(
        self,
        *,
        text: str,
        category: str,
        severity: str,
        binding: Mapping[str, Any],
        evidence: Mapping[str, Any] | None,
        upload: ScreenshotUpload | None,
        note_id: str | None,
    ) -> dict[str, Any]:
        existing_by_id = {item["note_id"]: item for item in self.list_notes()}
        if note_id is None:
            note_id = uuid.uuid4().hex
            event_type = "note_created"
            created_at = _utc_now()
            prior = None
        else:
            if not _SAFE_ID.fullmatch(note_id) or note_id not in existing_by_id:
                raise ConsoleError("unknown_note", "The note to edit does not exist", status=404)
            event_type = "note_edited"
            prior = existing_by_id[note_id]
            created_at = prior["created_at"]

        attachment = self._write_attachment(upload) if upload is not None else None
        newly_written_attachment = attachment is not None
        event_committed = False
        try:
            if prior is not None:
                if attachment is None:
                    attachment = copy.deepcopy(prior.get("attachment"))
                    if attachment:
                        attachment.pop("url", None)
                if evidence is None:
                    evidence = copy.deepcopy(prior.get("evidence"))
                    if evidence:
                        evidence.pop("url", None)

            now = _utc_now()
            snapshot = {
                "note_id": note_id,
                "text": text,
                "category": category,
                "severity": severity,
                "created_at": created_at,
                "updated_at": now,
                "created_binding": (
                    copy.deepcopy(prior["created_binding"])
                    if prior is not None
                    else copy.deepcopy(dict(binding))
                ),
                "latest_binding": copy.deepcopy(dict(binding)),
                "attachment": attachment,
                "evidence": copy.deepcopy(dict(evidence)) if evidence is not None else None,
            }
            self.notes_chain.append(
                {
                    "event_type": event_type,
                    "occurred_at": now,
                    "binding": copy.deepcopy(dict(binding)),
                    "supersedes_event_sha256": prior.get("event_sha256") if prior else None,
                    "note": snapshot,
                }
            )
            event_committed = True
        except BaseException:
            if newly_written_attachment and not event_committed and attachment is not None:
                filename = attachment.get("filename")
                if isinstance(filename, str) and _ATTACHMENT_NAME.fullmatch(filename):
                    try:
                        (self.attachments / filename).unlink(missing_ok=True)
                    except OSError:
                        pass
            raise
        return {item["note_id"]: item for item in self.list_notes()}[note_id]

    def evidence_allowlist(self) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for event in self.notes_chain.load():
            note = event.get("note", {})
            evidence = note.get("evidence") if isinstance(note, dict) else None
            if isinstance(evidence, dict):
                values.append(evidence)
        return values

    def read_attachment(self, attachment_id: str) -> tuple[bytes, str, str]:
        if not _SAFE_ID.fullmatch(attachment_id):
            raise ConsoleError("invalid_reference", "The attachment reference is invalid")
        match: dict[str, Any] | None = None
        for event in self.notes_chain.load():
            note = event.get("note", {})
            attachment = note.get("attachment") if isinstance(note, dict) else None
            if isinstance(attachment, dict) and attachment.get("attachment_id") == attachment_id:
                match = attachment
        if match is None:
            raise ConsoleError("missing_file", "The attachment is unavailable", status=404)
        filename = match.get("filename")
        if not isinstance(filename, str) or not _ATTACHMENT_NAME.fullmatch(filename):
            raise ConsoleError("integrity_error", "The attachment record is malformed", status=500)
        path = _contained_file(self.attachments, PurePosixPath(filename))
        if sha256_file(path) != match.get("file_sha256"):
            raise ConsoleError("integrity_error", "The attachment hash is stale", status=500)
        return _read_bounded(path, MAX_SCREENSHOT_BYTES, label="Attachment"), match["media_type"], match["file_sha256"]

    def append_interaction(
        self,
        *,
        binding: Mapping[str, Any],
        event_type: str,
        details: Mapping[str, Any],
        client_elapsed_ms: int | None,
        ui_version: str,
    ) -> dict[str, Any]:
        return self.interactions_chain.append(
            {
                "event_type": event_type,
                "occurred_at": _utc_now(),
                "binding": copy.deepcopy(dict(binding)),
                "details": copy.deepcopy(dict(details)),
                "client_elapsed_ms": client_elapsed_ms,
                "ui_version": ui_version,
            }
        )

    def telemetry_summary(self) -> dict[str, Any]:
        events = self.interactions_chain.load()
        counts = {name: 0 for name in TELEMETRY_EVENT_TYPES}
        packet_counts: dict[str, int] = {}
        elapsed: list[int] = []
        for event in events:
            event_type = event.get("event_type")
            if event_type not in counts:
                raise ConsoleError("integrity_error", "A telemetry event type is invalid", status=500)
            counts[event_type] += 1
            binding = event.get("binding", {})
            packet_hash = binding.get("work_packet_sha256") if isinstance(binding, dict) else None
            if isinstance(packet_hash, str):
                packet_counts[packet_hash] = packet_counts.get(packet_hash, 0) + 1
            value = event.get("client_elapsed_ms")
            if isinstance(value, int):
                elapsed.append(value)
        return {
            "total_events": len(events),
            "counts_by_type": counts,
            "events_by_work_packet": packet_counts,
            "total_client_elapsed_ms": sum(elapsed),
            "mean_client_elapsed_ms": (round(sum(elapsed) / len(elapsed), 2) if elapsed else None),
            "failed_actions": counts["action_failed"],
            "successful_actions": counts["action_succeeded"],
        }


class HumanReviewConsole:
    """Bound application service used by both HTTP handlers and unit tests."""

    def __init__(self, run_dir: Path, static_dir: Path | None = None) -> None:
        supplied = Path(run_dir)
        if not supplied.exists() or not supplied.is_dir():
            raise ConsoleError("invalid_run", "The configured ownership run does not exist")
        self.run_dir = supplied.resolve()
        initial = self._supervisor_status_unbound()
        self.run_id = initial["run_id"]
        self.page_id = initial["page_id"]
        default_static = Path(__file__).resolve().parents[2] / "review_console"
        self.static_dir = Path(static_dir or default_static).resolve()
        self.store = ObservationStore(self.run_dir)
        self._action_thread_lock = _run_action_lock(self.run_dir)
        self._action_lock_path = self.store.root / ".ownership-action.lock"

    def _supervisor_status_unbound(self) -> dict[str, Any]:
        try:
            return supervisor.status(self.run_dir)
        except (EnvelopeError, OSError, ValueError) as error:
            raise ConsoleError("invalid_run", "The configured ownership run is invalid", status=500) from error

    def supervisor_status(self) -> dict[str, Any]:
        value = self._supervisor_status_unbound()
        if value.get("run_id") != self.run_id or value.get("page_id") != self.page_id:
            raise ConsoleError("run_binding_changed", "The configured run binding changed", status=500)
        return value

    def _packet_is_valid(self, packet: Mapping[str, Any]) -> bool:
        try:
            return (
                packet.get("run_id") == self.run_id
                and packet.get("page_id") == self.page_id
                and isinstance(packet.get("work_packet_sha256"), str)
                and packet["work_packet_sha256"] == supervisor._work_packet_hash(packet)
                and packet.get("compact_action_contract", {}).get("work_packet_sha256")
                == packet["work_packet_sha256"]
            )
        except (KeyError, TypeError, AttributeError):
            return False

    def current_packet(self) -> dict[str, Any] | None:
        current_status = self.supervisor_status()
        if current_status.get("current") is None:
            return None
        try:
            packet = supervisor.next_packet(self.run_dir)
        except (EnvelopeError, OSError, ValueError) as error:
            raise ConsoleError("invalid_run", "The current work packet is unavailable", status=500) from error
        if not self._packet_is_valid(packet):
            raise ConsoleError("integrity_error", "The current work packet hash is stale", status=500)
        return packet

    def find_packet(self, work_packet_sha256: str) -> dict[str, Any]:
        if not isinstance(work_packet_sha256, str) or not _SHA256.fullmatch(work_packet_sha256):
            raise ConsoleError("unknown_packet", "The work packet reference is invalid", status=404)
        current = self.current_packet()
        if current is not None and current["work_packet_sha256"] == work_packet_sha256:
            return current
        packets_root = self.run_dir / "packets"
        if packets_root.is_symlink() or not packets_root.is_dir():
            raise ConsoleError("integrity_error", "The packet cache is unavailable", status=500)
        for packet_dir in sorted(packets_root.iterdir()):
            if packet_dir.is_symlink() or not packet_dir.is_dir():
                continue
            packet_file = packet_dir / "work-packet.json"
            if not packet_file.is_file() or packet_file.is_symlink():
                continue
            raw = _read_bounded(packet_file, MAX_PACKET_JSON_BYTES, label="Work packet")
            packet = _json_object(raw, label="Work packet")
            if packet.get("work_packet_sha256") != work_packet_sha256:
                continue
            if not self._packet_is_valid(packet):
                raise ConsoleError("integrity_error", "The work packet hash is stale", status=500)
            return packet
        raise ConsoleError("unknown_packet", "That exact work packet is not part of this run", status=404)

    @staticmethod
    def packet_binding(packet: Mapping[str, Any]) -> dict[str, Any]:
        current = packet["current"]
        return {
            "run_id": packet["run_id"],
            "page_id": packet["page_id"],
            "revision": packet["revision"],
            "checkpoint_sha256": packet["checkpoint_sha256"],
            "work_packet_sha256": packet["work_packet_sha256"],
            "unit_id": current["unit_id"],
            "tentative_text": current.get("tentative_text"),
            "unit_kind": current.get("unit_kind"),
            "line_id": current["line_id"],
            "cursor": current["cursor"],
            "unit_turn": current["unit_turn"],
        }

    def _evidence_for_packet(self, packet: Mapping[str, Any], ref: str) -> dict[str, Any]:
        _safe_relative_path(ref, prefix="packets")
        for name, evidence in packet.get("evidence", {}).items():
            if isinstance(evidence, dict) and evidence.get("path") == ref:
                digest = evidence.get("file_sha256")
                if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
                    raise ConsoleError("integrity_error", "The evidence hash is malformed", status=500)
                return {
                    "ref": ref,
                    "evidence_key": name,
                    "file_sha256": digest,
                    "work_packet_sha256": packet["work_packet_sha256"],
                    "size_wh": copy.deepcopy(evidence.get("size_wh")),
                    "role": evidence.get("role"),
                }
        raise ConsoleError("invalid_evidence", "The evidence reference is not in that work packet")

    def _read_evidence_record(self, record: Mapping[str, Any]) -> tuple[bytes, str, str]:
        ref = record.get("ref")
        relative = _safe_relative_path(ref, prefix="packets")
        path = _contained_file(self.run_dir, relative)
        digest = record.get("file_sha256")
        if not isinstance(digest, str) or sha256_file(path) != digest:
            raise ConsoleError("integrity_error", "The evidence image hash is stale", status=500)
        suffix = path.suffix.lower()
        media_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(suffix)
        if media_type is None:
            raise ConsoleError("invalid_evidence", "Only image evidence can be served")
        data = _read_bounded(path, MAX_PACKET_JSON_BYTES, label="Evidence image")
        try:
            with Image.open(BytesIO(data)) as image:
                if _IMAGE_FORMATS.get(image.format, (None,))[0] != media_type:
                    raise ConsoleError("integrity_error", "The evidence image type is stale", status=500)
                image.verify()
        except ConsoleError:
            raise
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise ConsoleError("integrity_error", "The evidence image cannot be decoded", status=500) from error
        return data, media_type, digest

    def read_evidence(self, ref: str) -> tuple[bytes, str, str]:
        _safe_relative_path(ref, prefix="packets")
        current = self.current_packet()
        if current is not None:
            try:
                record = self._evidence_for_packet(current, ref)
            except ConsoleError as error:
                if error.code != "invalid_evidence":
                    raise
            else:
                return self._read_evidence_record(record)
        for record in self.store.evidence_allowlist():
            if record.get("ref") == ref:
                return self._read_evidence_record(record)
        raise ConsoleError("missing_file", "The evidence reference is not allowlisted", status=404)

    def evidence_urls(self, packet: Mapping[str, Any] | None) -> dict[str, str]:
        if packet is None:
            return {}
        return {
            name: "/api/evidence?ref=" + quote(evidence["path"], safe="")
            for name, evidence in packet.get("evidence", {}).items()
            if isinstance(evidence, dict) and isinstance(evidence.get("path"), str)
        }

    def agent_contract(self) -> dict[str, Any]:
        """Return the exact new-session prompt and structured decision vocabulary."""

        prompt_path = Path(__file__).resolve().parents[2] / "prompts/candidate-word-ownership-v3.md"
        try:
            prompt = prompt_path.read_text(encoding="utf-8")
        except OSError as error:
            raise ConsoleError("missing_prompt", "The candidate-word prompt is unavailable", status=500) from error
        return {
            "prompt": {
                "text": prompt,
                "file_sha256": sha256_file(prompt_path),
                "status": "verified_for_this_new_console_session",
            },
            "content_order": [
                "prompt",
                "decision_collage",
                "work_packet",
                "legal_actions",
                "response_schema",
            ],
            "response_schema": {
                "schema_version": MODEL_DECISION_SCHEMA_VERSION,
                "crop_state": list(MODEL_CROP_STATES),
                "difficulty": list(MODEL_DIFFICULTIES),
                "struggle_flags": list(MODEL_STRUGGLE_FLAGS),
                "required_fields": [
                    "schema_version",
                    "crop_state",
                    "difficulty",
                    "struggle_flags",
                    "evidence_used",
                    "decision_summary",
                    "confidence",
                    "action",
                ],
                "additional_properties": False,
            },
            "reasoning_policy": (
                "Store a concise decision summary and explicit struggle signals; "
                "do not request or store private hidden chain-of-thought."
            ),
        }

    def _current_local_labels(
        self, packet: Mapping[str, Any]
    ) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
        run, checkpoint = supervisor._load_head(self.run_dir)
        if checkpoint.get("checkpoint_sha256") != packet.get("checkpoint_sha256"):
            raise ConsoleError("stale_action", "The word changed before the selection was read", status=409)
        local = supervisor._load_artifact_mask(
            self.run_dir, checkpoint["state"]["current_local_mask"]
        )
        labels, inventory = stable_components(local)
        expected = packet.get("current_unclaimed", {}).get("component_inventory_sha256")
        observed = supervisor.component_inventory_sha256(inventory)
        if expected != observed:
            raise ConsoleError("integrity_error", "The component hit map is stale", status=500)
        return local, labels, inventory

    def seed_selection(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "work_packet_sha256",
            "x",
            "y",
        }:
            raise ConsoleError("invalid_seed", "A seed requires packet, x, and y")
        packet = self.current_packet()
        if packet is None or payload.get("work_packet_sha256") != packet["work_packet_sha256"]:
            raise ConsoleError("stale_action", "The word changed before the seed was applied", status=409)
        x, y = payload.get("x"), payload.get("y")
        if any(not isinstance(value, int) or isinstance(value, bool) for value in (x, y)):
            raise ConsoleError("invalid_seed", "Seed coordinates must be integers")
        local, labels, inventory = self._current_local_labels(packet)
        if not 0 <= x < local.shape[1] or not 0 <= y < local.shape[0]:
            raise ConsoleError("invalid_seed", "The seed lies outside the extracted-ink crop")
        component_id = int(labels[y, x])
        if component_id == 0:
            # A model/human click can land between anti-aliased strokes.  Search
            # only a tiny local radius and report the exact snap distance.
            best: tuple[int, int, int] | None = None
            for radius in range(1, 9):
                left, right = max(0, x - radius), min(local.shape[1], x + radius + 1)
                top, bottom = max(0, y - radius), min(local.shape[0], y + radius + 1)
                ys, xs = np.nonzero(labels[top:bottom, left:right])
                if len(xs):
                    candidates = []
                    for py, px in zip(ys + top, xs + left):
                        distance = int((int(px) - x) ** 2 + (int(py) - y) ** 2)
                        candidates.append((distance, int(py), int(px)))
                    best = min(candidates)
                    component_id = int(labels[best[1], best[2]])
                    break
            if component_id == 0:
                raise ConsoleError(
                    "seed_missed_ink",
                    "That point did not touch extracted ink. Choose a visible red stroke.",
                    status=422,
                )
        if component_id not in {int(item["id"]) for item in inventory}:
            raise ConsoleError("integrity_error", "The selected component is not in this packet", status=500)
        self.store.append_interaction(
            binding=self.packet_binding(packet),
            event_type="selection_seeded",
            details={"component_id": component_id, "x": x, "y": y},
            client_elapsed_ms=None,
            ui_version="candidate-word-console.v1",
        )
        return {"component_id": component_id, "snapped": int(labels[y, x]) == 0}

    def box_selection(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "work_packet_sha256",
            "bbox_xywh",
        }:
            raise ConsoleError("invalid_selection_box", "A rough selection requires a packet and box")
        packet = self.current_packet()
        if packet is None or payload.get("work_packet_sha256") != packet["work_packet_sha256"]:
            raise ConsoleError("stale_action", "The word changed before the rough selection was applied", status=409)
        bbox = payload.get("bbox_xywh")
        if (
            not isinstance(bbox, list)
            or len(bbox) != 4
            or any(not isinstance(value, int) or isinstance(value, bool) for value in bbox)
        ):
            raise ConsoleError("invalid_selection_box", "The rough selection box must contain four integers")
        x, y, width, height = bbox
        local, labels, inventory = self._current_local_labels(packet)
        if x < 0 or y < 0 or width < 1 or height < 1 or x + width > local.shape[1] or y + height > local.shape[0]:
            raise ConsoleError("invalid_selection_box", "The rough selection box lies outside the ink crop")
        inside = labels[y : y + height, x : x + width]
        overlap_counts = np.bincount(inside.ravel(), minlength=len(inventory) + 1)
        selected: list[int] = []
        matches: list[dict[str, Any]] = []
        for item in inventory:
            component_id = int(item["id"])
            overlap = int(overlap_counts[component_id]) if component_id < len(overlap_counts) else 0
            if overlap == 0:
                continue
            area = int(item["area_px"])
            anchor = item["anchor"]
            anchor_inside = x <= int(anchor["x"]) < x + width and y <= int(anchor["y"]) < y + height
            fraction = overlap / max(1, area)
            admitted = anchor_inside or fraction >= 0.15 or overlap >= 32
            matches.append(
                {
                    "component_id": component_id,
                    "overlap_pixels": overlap,
                    "overlap_fraction": round(fraction, 6),
                    "anchor_inside": anchor_inside,
                    "selected": admitted,
                }
            )
            if admitted:
                selected.append(component_id)
        self.store.append_interaction(
            binding=self.packet_binding(packet),
            event_type="selection_boxed",
            details={"bbox_xywh": bbox, "component_ids": selected, "candidate_count": len(matches)},
            client_elapsed_ms=None,
            ui_version="candidate-word-console.v2",
        )
        return {"component_ids": selected, "matches": matches, "selection_rule": "anchor_inside_or_15_percent_or_32_pixels"}

    def preview_envelope(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or set(payload) != {
            "work_packet_sha256",
            "component_ids",
        }:
            raise ConsoleError("invalid_preview", "An envelope preview needs a packet and component IDs")
        packet = self.current_packet()
        if packet is None or payload.get("work_packet_sha256") != packet["work_packet_sha256"]:
            raise ConsoleError("stale_action", "The word changed before the envelope was fitted", status=409)
        raw_ids = payload.get("component_ids")
        if (
            not isinstance(raw_ids, list)
            or not raw_ids
            or any(not isinstance(value, int) or isinstance(value, bool) for value in raw_ids)
            or len(set(raw_ids)) != len(raw_ids)
        ):
            raise ConsoleError("invalid_preview", "Choose one or more unique ink components")
        component_ids = sorted(raw_ids)
        local, labels, inventory = self._current_local_labels(packet)
        allowed = {int(item["id"]) for item in inventory}
        if any(value not in allowed for value in component_ids):
            raise ConsoleError("invalid_preview", "A selected component is not available in this word")
        selected = np.isin(labels, component_ids)
        excluded = local & ~selected
        work_width, work_height = local.shape[1], local.shape[0]
        params = EnvelopeParams(
            along_bridge_px=max(14.0, min(46.0, work_width * 0.075)),
            cross_bridge_px=max(5.0, min(14.0, work_height * 0.045)),
            padding_px=max(3.0, min(7.0, min(work_width, work_height) * 0.018)),
            maximum_envelope_fraction=0.9,
            maximum_envelope_to_ink_area_ratio=18.0,
        )
        ys, xs = np.nonzero(selected)
        points = np.column_stack((xs, ys)).astype(np.float64)
        center = points.mean(axis=0)
        _u, _s, axes = np.linalg.svd(points - center, full_matrices=False)
        direction = axes[0]
        if direction[0] < 0:
            direction = -direction
        projection = (points - center) @ direction
        centerline = (
            tuple((center + direction * float(projection.min())).tolist()),
            tuple((center + direction * float(projection.max())).tolist()),
        )
        angle = float(np.degrees(np.arctan2(direction[1], direction[0])))
        selected_height = int(ys.max() - ys.min() + 1)
        selected_width = int(xs.max() - xs.min() + 1)
        profiles = [
            ("standard", params),
            (
                "fragmented_word",
                EnvelopeParams(
                    angle_degrees=angle,
                    centerline=centerline,
                    along_bridge_px=max(
                        params.along_bridge_px,
                        min(72.0, max(24.0, selected_width * 0.16)),
                    ),
                    cross_bridge_px=max(
                        params.cross_bridge_px,
                        min(30.0, max(18.0, selected_height * 0.28)),
                    ),
                    padding_px=params.padding_px,
                    maximum_envelope_fraction=0.9,
                    maximum_envelope_to_ink_area_ratio=22.0,
                ),
            ),
            (
                "detached_mark",
                EnvelopeParams(
                    angle_degrees=angle,
                    centerline=centerline,
                    along_bridge_px=max(
                        params.along_bridge_px,
                        min(96.0, max(32.0, selected_width * 0.22)),
                    ),
                    cross_bridge_px=max(
                        params.cross_bridge_px,
                        min(42.0, max(24.0, selected_height * 0.40)),
                    ),
                    padding_px=params.padding_px,
                    maximum_envelope_fraction=0.9,
                    maximum_envelope_to_ink_area_ratio=24.0,
                ),
            ),
        ]
        worker = _fit_envelope_isolated(selected, excluded, profiles)
        successes = worker["successes"]
        failures: dict[str, str] = worker["failures"]
        if not successes:
            self.store.append_interaction(
                binding=self.packet_binding(packet),
                event_type="envelope_previewed",
                details={"passed": False, "component_ids": component_ids, "failures": failures},
                client_elapsed_ms=None,
                ui_version="candidate-word-console.v1",
            )
            raise ConsoleError(
                "envelope_rejected",
                "The fitted envelope failed its safety gates. Adjust the crop or ink selection.",
                status=422,
                details={"method_failures": failures},
            )
        profile_order = {name: index for index, (name, _params) in enumerate(profiles)}
        result = min(
            successes,
            key=lambda item: (
                item["envelope_area_px2"],
                profile_order.get(item.get("profile"), 999),
                item["method"],
            ),
        )
        work_ref = packet["evidence"]["work_crop"]["path"]
        work_path = _contained_file(self.run_dir, _safe_relative_path(work_ref, prefix="packets"))
        with Image.open(work_path) as handle:
            work = handle.convert("RGB")
        rgb = np.asarray(work, dtype=np.uint8).copy()
        rgb[excluded] = ((rgb[excluded].astype(np.uint16) * 35 + np.array((201, 55, 48), dtype=np.uint16) * 65) // 100).astype(np.uint8)
        rgb[selected] = ((rgb[selected].astype(np.uint16) * 25 + np.array((34, 158, 92), dtype=np.uint16) * 75) // 100).astype(np.uint8)
        overlay = Image.fromarray(rgb, mode="RGB")
        draw = ImageDraw.Draw(overlay)
        polygon = result["polygon"]
        draw.line([tuple(point) for point in polygon], fill=(0, 136, 190), width=4, joint="curve")
        work_x, work_y, _, _ = packet["current"]["work_bbox_source_xywh"]
        source_polygon = map_polygon_to_source(polygon, crop_x=work_x, crop_y=work_y)
        basis = {
            "schema_version": "candidate-word-envelope-preview.v1",
            "work_packet_sha256": packet["work_packet_sha256"],
            "component_ids": component_ids,
            "selected_mask_pixel_sha256": sha256_mask_pixels(selected),
            "excluded_mask_pixel_sha256": sha256_mask_pixels(excluded),
            "result": result,
            "source_polygon": [list(point) for point in source_polygon],
            "failures": failures,
        }
        preview_sha256 = hashlib.sha256(canonical_json_bytes(basis)).hexdigest()
        png_path = self.store.previews / f"{preview_sha256}.png"
        json_path = self.store.previews / f"{preview_sha256}.json"
        if not png_path.exists():
            temporary = self.store.previews / f".{preview_sha256}-{uuid.uuid4().hex}.png"
            overlay.save(temporary, format="PNG", optimize=False, compress_level=9)
            os.rename(temporary, png_path)
        basis["preview_id"] = preview_sha256
        basis["preview_image"] = {
            "path": f"human-observations/envelope-previews/{preview_sha256}.png",
            "file_sha256": sha256_file(png_path),
            "size_wh": [work_width, work_height],
        }
        basis["manifest_sha256"] = _hash_without(basis, "manifest_sha256")
        if not json_path.exists():
            with json_path.open("xb") as handle:
                handle.write(canonical_json_bytes(basis) + b"\n")
        self.store.append_interaction(
            binding=self.packet_binding(packet),
            event_type="envelope_previewed",
            details={
                "passed": True,
                "preview_sha256": preview_sha256,
                "component_ids": component_ids,
                "method": result["method"],
                "profile": result.get("profile"),
                "selected_ink_pixels": result["selected_ink_pixels"],
                "excluded_contamination": result["excluded_ink_contamination"],
            },
            client_elapsed_ms=None,
            ui_version="candidate-word-console.v1",
        )
        return {
            "preview_sha256": preview_sha256,
            "image_url": f"/api/envelope-preview?id={preview_sha256}",
            "component_ids": component_ids,
            "method": result["method"],
            "profile": result.get("profile"),
            "fitting_trials": worker.get("trials", []),
            "metrics": {
                "selected_ink_pixels": result["selected_ink_pixels"],
                "selected_ink_coverage": result["selected_ink_coverage"],
                "excluded_ink_contamination": result["excluded_ink_contamination"],
                "envelope_area_px2": result["envelope_area_px2"],
                "envelope_to_ink_area_ratio": result["envelope_to_ink_area_ratio"],
                "polygon_vertex_count": result["polygon_vertex_count"],
            },
            "method_failures": failures,
        }

    def read_envelope_preview(self, preview_id: str) -> tuple[bytes, str, str]:
        if not isinstance(preview_id, str) or not _SHA256.fullmatch(preview_id):
            raise ConsoleError("invalid_reference", "The envelope preview reference is invalid")
        manifest_path = self.store.previews / f"{preview_id}.json"
        image_path = self.store.previews / f"{preview_id}.png"
        if manifest_path.is_symlink() or image_path.is_symlink() or not manifest_path.is_file() or not image_path.is_file():
            raise ConsoleError("missing_file", "The envelope preview is unavailable", status=404)
        manifest = _json_object(_read_bounded(manifest_path, MAX_EVENT_JSON_BYTES, label="Envelope preview"), label="Envelope preview")
        if (
            manifest.get("preview_id") != preview_id
            or manifest.get("manifest_sha256") != _hash_without(manifest, "manifest_sha256")
        ):
            raise ConsoleError("integrity_error", "The envelope preview receipt changed", status=500)
        if manifest.get("work_packet_sha256") not in {
            item.get("work_packet_sha256") for item in [self.current_packet() or {}]
        }:
            # Historical previews remain viewable only when a note or recorded
            # decision preserves their packet binding.  The current UI needs
            # only the active preview, which keeps this allowlist narrow.
            raise ConsoleError("missing_file", "The envelope preview is no longer current", status=404)
        digest = manifest.get("preview_image", {}).get("file_sha256")
        if not isinstance(digest, str) or sha256_file(image_path) != digest:
            raise ConsoleError("integrity_error", "The envelope preview image changed", status=500)
        return _read_bounded(image_path, MAX_PACKET_JSON_BYTES, label="Envelope preview"), "image/png", digest

    def bootstrap(self) -> dict[str, Any]:
        current_status = self.supervisor_status()
        packet = self.current_packet()
        return {
            "run": {
                "run_id": self.run_id,
                "page_id": self.page_id,
                "display_name": self.run_dir.name,
            },
            "status": current_status,
            "packet": packet,
            "evidence_urls": self.evidence_urls(packet),
            "notes": self.store.list_notes(),
            "note_options": {
                "categories": list(NOTE_CATEGORIES),
                "severities": list(NOTE_SEVERITIES),
            },
            "upload_limits": {
                "accepted_media_types": [value[0] for value in _IMAGE_FORMATS.values()],
                "max_bytes": MAX_SCREENSHOT_BYTES,
                "max_width_px": MAX_SCREENSHOT_WIDTH,
                "max_height_px": MAX_SCREENSHOT_HEIGHT,
                "max_pixels": MAX_SCREENSHOT_PIXELS,
                "max_note_characters": MAX_NOTE_CHARS,
            },
            "telemetry": {
                "event_types": list(TELEMETRY_EVENT_TYPES),
                "max_details_bytes": MAX_TELEMETRY_DETAILS_BYTES,
            },
            "agent_contract": self.agent_contract(),
            "experience_summary": self.store.telemetry_summary(),
        }

    def apply_action(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {
            "work_packet_sha256",
            "action",
            "decision_trace",
            "envelope_preview_sha256",
        }
        if (
            not isinstance(payload, Mapping)
            or not {"work_packet_sha256", "action"}.issubset(payload)
            or any(key not in allowed for key in payload)
        ):
            raise ConsoleError(
                "invalid_action",
                "An action requires a packet, one legal action, and only supported decision evidence",
            )
        with self._action_thread_lock:
            lock_flags = os.O_CREAT | os.O_RDWR
            if hasattr(os, "O_NOFOLLOW"):
                lock_flags |= os.O_NOFOLLOW
            try:
                descriptor = os.open(self._action_lock_path, lock_flags, 0o600)
            except OSError as error:
                raise ConsoleError(
                    "action_lock_unavailable",
                    "The review run could not be locked safely. Nothing was applied.",
                    status=500,
                ) from error
            with os.fdopen(descriptor, "a+b") as lock_handle:
                try:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                except OSError as error:
                    raise ConsoleError(
                        "action_lock_unavailable",
                        "The review run could not be locked safely. Nothing was applied.",
                        status=500,
                    ) from error
                return self._apply_action_locked(payload)

    def _apply_action_locked(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        packet_hash = payload.get("work_packet_sha256")
        packet = self.current_packet()
        if packet is None:
            if isinstance(packet_hash, str) and _SHA256.fullmatch(packet_hash):
                try:
                    self.find_packet(packet_hash)
                except ConsoleError as error:
                    if error.code != "unknown_packet":
                        raise
                else:
                    raise ConsoleError(
                        "stale_action",
                        "The page advanced after this screen loaded. Your draft was not applied.",
                        status=409,
                        details={"current_work_packet_sha256": None},
                    )
            raise ConsoleError("machine_complete", "There is no current word to review", status=409)
        if packet_hash != packet["work_packet_sha256"]:
            raise ConsoleError(
                "stale_action",
                "The page advanced after this screen loaded. Your draft was not applied.",
                status=409,
                details={"current_work_packet_sha256": packet["work_packet_sha256"]},
            )
        if not isinstance(payload.get("action"), Mapping):
            raise ConsoleError("invalid_action", "action must be an object")
        decision_trace = self._validated_decision_trace(payload.get("decision_trace"))
        action_value = payload["action"]
        preview_id = payload.get("envelope_preview_sha256")
        if action_value.get("type") == "claim_select":
            component_ids = action_value.get("component_ids")
            if not isinstance(component_ids, list):
                raise ConsoleError("invalid_action", "A claim must name selected ink components")
            if preview_id is None:
                preview = self.preview_envelope(
                    {
                        "work_packet_sha256": packet_hash,
                        "component_ids": component_ids,
                    }
                )
                preview_id = preview["preview_sha256"]
            self._validate_preview_binding(packet, preview_id, component_ids)
        elif preview_id is not None:
            raise ConsoleError("invalid_action", "Only a final ink claim may cite an envelope preview")
        compact = {
            "schema_version": COMPACT_ACTION_SCHEMA_VERSION,
            "work_packet_sha256": packet_hash,
            "action": copy.deepcopy(dict(payload["action"])),
        }
        try:
            result = supervisor.apply_compact_action(self.run_dir, compact)
        except (EnvelopeError, OSError, ValueError) as error:
            message = str(error)
            lowered = message.lower()
            stale = any(
                marker in lowered
                for marker in (
                    "stale",
                    "next revision already exists",
                    "refusing to overwrite published directory",
                    "directory not empty",
                )
            )
            if not stale:
                try:
                    latest = self.current_packet()
                except ConsoleError:
                    latest = packet
                stale = (
                    latest is None
                    or latest.get("work_packet_sha256") != packet["work_packet_sha256"]
                )
            if stale:
                try:
                    latest = self.current_packet()
                except ConsoleError:
                    latest = None
                current_hash = latest.get("work_packet_sha256") if latest is not None else None
                raise ConsoleError(
                    "stale_action",
                    "The page advanced after this screen loaded. Your draft was not applied.",
                    status=409,
                    details={"current_work_packet_sha256": current_hash},
                ) from error
            if isinstance(error, OSError):
                raise ConsoleError(
                    "action_io_error",
                    "The action could not be applied safely. Nothing was changed.",
                    status=500,
                ) from error
            raise ConsoleError(
                "invalid_action",
                message,
                status=400,
            ) from error
        self.store.append_interaction(
            binding=self.packet_binding(packet),
            event_type="decision_recorded",
            details={
                "action_type": action_value.get("type"),
                "decision_trace": decision_trace,
                "envelope_preview_sha256": preview_id,
                "result_revision": result.get("revision"),
            },
            client_elapsed_ms=None,
            ui_version="candidate-word-console.v1",
        )
        return {
            "result": result,
            "decision_record": {
                "trace": decision_trace,
                "envelope_preview_sha256": preview_id,
            },
            "current": self.bootstrap(),
        }

    def _validated_decision_trace(self, value: Any) -> dict[str, Any]:
        if value is None:
            return {
                "schema_version": MODEL_DECISION_SCHEMA_VERSION,
                "crop_state": "uncertain",
                "difficulty": "attention_needed",
                "struggle_flags": [],
                "evidence_used": [],
                "decision_summary": "No human-readable decision summary was supplied by this API caller.",
                "confidence": "low",
            }
        required = {
            "schema_version",
            "crop_state",
            "difficulty",
            "struggle_flags",
            "evidence_used",
            "decision_summary",
            "confidence",
        }
        if not isinstance(value, Mapping) or set(value) != required:
            raise ConsoleError("invalid_decision_trace", "The model decision record fields are invalid")
        if value.get("schema_version") != MODEL_DECISION_SCHEMA_VERSION:
            raise ConsoleError("invalid_decision_trace", "The model decision record version is invalid")
        if value.get("crop_state") not in MODEL_CROP_STATES:
            raise ConsoleError("invalid_decision_trace", "Choose a supported crop state")
        if value.get("difficulty") not in MODEL_DIFFICULTIES:
            raise ConsoleError("invalid_decision_trace", "Choose a supported difficulty")
        flags = value.get("struggle_flags")
        evidence = value.get("evidence_used")
        if (
            not isinstance(flags, list)
            or len(set(flags)) != len(flags)
            or any(item not in MODEL_STRUGGLE_FLAGS for item in flags)
        ):
            raise ConsoleError("invalid_decision_trace", "Struggle flags are invalid")
        if (
            not isinstance(evidence, list)
            or len(set(evidence)) != len(evidence)
            or any(not isinstance(item, str) or not item or len(item) > 80 for item in evidence)
        ):
            raise ConsoleError("invalid_decision_trace", "Evidence-used values are invalid")
        summary = value.get("decision_summary")
        if not isinstance(summary, str) or not summary.strip() or len(summary) > 500 or "\x00" in summary:
            raise ConsoleError("invalid_decision_trace", "Add a concise decision summary under 500 characters")
        if value.get("confidence") not in {"high", "medium", "low"}:
            raise ConsoleError("invalid_decision_trace", "Decision confidence is invalid")
        return copy.deepcopy(dict(value))

    def _validate_preview_binding(
        self,
        packet: Mapping[str, Any],
        preview_id: Any,
        component_ids: Sequence[Any],
    ) -> dict[str, Any]:
        if not isinstance(preview_id, str) or not _SHA256.fullmatch(preview_id):
            raise ConsoleError("invalid_preview", "A fitted-envelope receipt is required")
        path = self.store.previews / f"{preview_id}.json"
        if path.is_symlink() or not path.is_file():
            raise ConsoleError("invalid_preview", "The fitted-envelope receipt is unavailable")
        manifest = _json_object(
            _read_bounded(path, MAX_EVENT_JSON_BYTES, label="Envelope preview"),
            label="Envelope preview",
        )
        if manifest.get("manifest_sha256") != _hash_without(manifest, "manifest_sha256"):
            raise ConsoleError("integrity_error", "The fitted-envelope receipt changed", status=500)
        if (
            manifest.get("preview_id") != preview_id
            or manifest.get("work_packet_sha256") != packet.get("work_packet_sha256")
            or manifest.get("component_ids") != sorted(component_ids)
        ):
            raise ConsoleError("invalid_preview", "The fitted envelope does not match this exact selection")
        return manifest

    def create_note(
        self,
        fields: Mapping[str, str],
        upload: ScreenshotUpload | None,
    ) -> dict[str, Any]:
        allowed = {
            "text",
            "category",
            "severity",
            "work_packet_sha256",
            "evidence_ref",
            "note_id",
        }
        if not isinstance(fields, Mapping) or any(key not in allowed for key in fields):
            raise ConsoleError("invalid_note", "The note contains unsupported fields")
        text = fields.get("text", "")
        if not isinstance(text, str) or len(text) > MAX_NOTE_CHARS or "\x00" in text:
            raise ConsoleError("invalid_note", "The note text is invalid or too long")
        category = fields.get("category")
        severity = fields.get("severity")
        if category not in NOTE_CATEGORIES:
            raise ConsoleError("invalid_note", "Choose a supported note category")
        if severity not in NOTE_SEVERITIES:
            raise ConsoleError("invalid_note", "Choose a supported note severity")
        packet_hash = fields.get("work_packet_sha256")
        packet = self.find_packet(packet_hash) if isinstance(packet_hash, str) else None
        if packet is None:  # keeps type check explicit
            raise ConsoleError("unknown_packet", "The note needs an exact work packet", status=404)
        evidence: dict[str, Any] | None = None
        evidence_ref = fields.get("evidence_ref")
        if evidence_ref:
            evidence = self._evidence_for_packet(packet, evidence_ref)
            self._read_evidence_record(evidence)
        if not text.strip() and upload is None and evidence is None:
            raise ConsoleError("empty_note", "Add text, a screenshot, or an evidence image")
        if upload is not None:
            _validated_image(upload.data, upload.media_type)  # validate before any append
        note_id = fields.get("note_id") or None
        note = self.store.create_or_edit_note(
            text=text,
            category=category,
            severity=severity,
            binding=self.packet_binding(packet),
            evidence=evidence,
            upload=upload,
            note_id=note_id,
        )
        return {"note": note, "notes": self.store.list_notes()}

    def record_telemetry(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {
            "work_packet_sha256",
            "event_type",
            "details",
            "client_elapsed_ms",
            "ui_version",
        }
        if not isinstance(payload, Mapping) or any(key not in allowed for key in payload):
            raise ConsoleError("invalid_telemetry", "Telemetry contains unsupported fields")
        required = {"work_packet_sha256", "event_type", "ui_version"}
        if any(key not in payload for key in required):
            raise ConsoleError("invalid_telemetry", "Telemetry is missing required fields")
        event_type = payload["event_type"]
        if event_type not in TELEMETRY_EVENT_TYPES:
            raise ConsoleError("invalid_telemetry", "Telemetry event_type is unsupported")
        ui_version = payload["ui_version"]
        if not isinstance(ui_version, str) or not _UI_VERSION.fullmatch(ui_version):
            raise ConsoleError("invalid_telemetry", "Telemetry ui_version is invalid")
        details = payload.get("details", {})
        if not isinstance(details, Mapping):
            raise ConsoleError("invalid_telemetry", "Telemetry details must be an object")
        try:
            details_bytes = canonical_json_bytes(details)
        except (TypeError, ValueError) as error:
            raise ConsoleError("invalid_telemetry", "Telemetry details are not JSON-safe") from error
        if len(details_bytes) > MAX_TELEMETRY_DETAILS_BYTES:
            raise ConsoleError("telemetry_too_large", "Telemetry details exceed 16 KB", status=413)
        elapsed = payload.get("client_elapsed_ms")
        if elapsed is not None and (
            not isinstance(elapsed, int)
            or isinstance(elapsed, bool)
            or elapsed < 0
            or elapsed > 86_400_000
        ):
            raise ConsoleError("invalid_telemetry", "client_elapsed_ms must be between 0 and 86400000")
        packet_hash = payload["work_packet_sha256"]
        packet = self.find_packet(packet_hash) if isinstance(packet_hash, str) else None
        if packet is None:
            raise ConsoleError("unknown_packet", "Telemetry needs an exact work packet", status=404)
        event = self.store.append_interaction(
            binding=self.packet_binding(packet),
            event_type=event_type,
            details=details,
            client_elapsed_ms=elapsed,
            ui_version=ui_version,
        )
        return {"accepted": True, "event_sha256": event["event_sha256"]}

    def static_file(self, request_path: str) -> tuple[bytes, str]:
        if request_path in {"", "/"}:
            request_path = "/index.html"
        decoded = unquote(request_path)
        relative = _safe_relative_path(decoded.lstrip("/"))
        suffix = relative.suffix.lower()
        media_type = _STATIC_SUFFIXES.get(suffix)
        if media_type is None:
            raise ConsoleError("missing_file", "Static file not found", status=404)
        if not self.static_dir.is_dir() or self.static_dir.is_symlink():
            raise ConsoleError("missing_ui", "The review console UI is not installed", status=404)
        path = _contained_file(self.static_dir, relative)
        return _read_bounded(path, 8 * 1024 * 1024, label="Static file"), media_type


class ReviewConsoleHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], console: HumanReviewConsole) -> None:
        self.console = console
        self.csrf_token = secrets.token_urlsafe(32)
        super().__init__(server_address, ReviewConsoleHandler)
        port = int(self.server_address[1])
        self.allowed_host_headers = {
            f"127.0.0.1:{port}",
            f"localhost:{port}",
        }
        if port == 80:
            self.allowed_host_headers.update({"127.0.0.1", "localhost"})

    def bootstrap(self) -> dict[str, Any]:
        value = self.console.bootstrap()
        value["csrf_token"] = self.csrf_token
        return value

    def apply_action(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        value = self.console.apply_action(payload)
        current = value.get("current")
        if isinstance(current, dict):
            current["csrf_token"] = self.csrf_token
        return value


class ReviewConsoleHandler(BaseHTTPRequestHandler):
    """Same-origin HTTP interface; all filesystem resolution stays in the service."""

    server: ReviewConsoleHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _headers(self, status: int, media_type: str, length: int, *, digest: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; "
            "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'",
        )
        if digest is not None:
            self.send_header("ETag", f'"{digest}"')
        self.end_headers()

    def _send_json(self, status: int, value: Mapping[str, Any]) -> None:
        payload = canonical_json_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(payload))
        self.wfile.write(payload)

    def _ok(self, data: Any, status: int = 200) -> None:
        self._send_json(status, {"ok": True, "data": data})

    def _error(self, error: ConsoleError) -> None:
        self._send_json(
            error.status,
            {
                "ok": False,
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "details": error.details,
                },
            },
        )

    def _content_length(self, maximum: int) -> int:
        raw = self.headers.get("Content-Length")
        try:
            length = int(raw) if raw is not None else -1
        except ValueError as error:
            raise ConsoleError("invalid_length", "Content-Length is invalid") from error
        if length < 0:
            raise ConsoleError("length_required", "Content-Length is required", status=411)
        if length > maximum:
            raise ConsoleError("request_too_large", "The request is too large", status=413)
        return length

    def _read_body(self, maximum: int) -> bytes:
        return self.rfile.read(self._content_length(maximum))

    def _require_local_host(self) -> str:
        values = self.headers.get_all("Host", [])
        host = values[0].strip().lower() if len(values) == 1 else ""
        if host not in self.server.allowed_host_headers:
            raise ConsoleError(
                "untrusted_host",
                "The review console accepts only its exact localhost address.",
                status=403,
            )
        return host

    def _require_same_origin(self, host: str) -> None:
        origin = self.headers.get("Origin")
        if not origin:
            return
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "http"
            or parsed.netloc.lower() != host
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ConsoleError("cross_origin_denied", "Cross-origin writes are not allowed", status=403)

    def _require_csrf_token(self) -> None:
        supplied = self.headers.get(CSRF_HEADER_NAME, "")
        if not isinstance(supplied, str) or not secrets.compare_digest(
            supplied, self.server.csrf_token
        ):
            raise ConsoleError(
                "csrf_denied",
                "The review session token is missing or invalid.",
                status=403,
            )

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._require_local_host()
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query, keep_blank_values=True)
            if parsed.path == "/api/bootstrap" or parsed.path == "/api/current":
                self._ok(self.server.bootstrap())
            elif parsed.path == "/api/status":
                self._ok(self.server.console.supervisor_status())
            elif parsed.path == "/api/packet":
                packet = self.server.console.current_packet()
                self._ok(
                    {
                        "packet": packet,
                        "evidence_urls": self.server.console.evidence_urls(packet),
                    }
                )
            elif parsed.path == "/api/notes":
                self._ok({"notes": self.server.console.store.list_notes()})
            elif parsed.path == "/api/telemetry/summary":
                self._ok(self.server.console.store.telemetry_summary())
            elif parsed.path == "/api/envelope-preview":
                ids = query.get("id", [])
                if len(ids) != 1:
                    raise ConsoleError("invalid_reference", "Exactly one envelope preview id is required")
                data, media_type, digest = self.server.console.read_envelope_preview(ids[0])
                self._headers(200, media_type, len(data), digest=digest)
                self.wfile.write(data)
            elif parsed.path == "/api/evidence":
                refs = query.get("ref", [])
                if len(refs) != 1:
                    raise ConsoleError("invalid_reference", "Exactly one evidence ref is required")
                data, media_type, digest = self.server.console.read_evidence(refs[0])
                self._headers(200, media_type, len(data), digest=digest)
                self.wfile.write(data)
            elif parsed.path == "/api/attachments":
                ids = query.get("id", [])
                if len(ids) != 1:
                    raise ConsoleError("invalid_reference", "Exactly one attachment id is required")
                data, media_type, digest = self.server.console.store.read_attachment(ids[0])
                self._headers(200, media_type, len(data), digest=digest)
                self.wfile.write(data)
            elif parsed.path.startswith("/api/"):
                raise ConsoleError("not_found", "API endpoint not found", status=404)
            else:
                data, media_type = self.server.console.static_file(parsed.path)
                self._headers(200, media_type, len(data))
                self.wfile.write(data)
        except ConsoleError as error:
            if error.code == "untrusted_host":
                self.close_connection = True
            self._error(error)
        except Exception:
            self._error(ConsoleError("internal_error", "The review console encountered an error", status=500))

    def do_POST(self) -> None:  # noqa: N802
        try:
            host = self._require_local_host()
            self._require_same_origin(host)
            self._require_csrf_token()
            parsed = urlsplit(self.path)
            if parsed.path == "/api/actions":
                content_type = self.headers.get_content_type()
                if content_type != "application/json":
                    raise ConsoleError("unsupported_media_type", "Actions require application/json", status=415)
                payload = _json_object(self._read_body(MAX_ACTION_JSON_BYTES), label="Action")
                self._ok(self.server.apply_action(payload))
            elif parsed.path == "/api/selection-seed":
                if self.headers.get_content_type() != "application/json":
                    raise ConsoleError("unsupported_media_type", "Selection seeds require application/json", status=415)
                payload = _json_object(self._read_body(MAX_ACTION_JSON_BYTES), label="Selection seed")
                self._ok(self.server.console.seed_selection(payload))
            elif parsed.path == "/api/selection-box":
                if self.headers.get_content_type() != "application/json":
                    raise ConsoleError("unsupported_media_type", "Rough selections require application/json", status=415)
                payload = _json_object(self._read_body(MAX_ACTION_JSON_BYTES), label="Rough selection")
                self._ok(self.server.console.box_selection(payload))
            elif parsed.path == "/api/envelope-preview":
                if self.headers.get_content_type() != "application/json":
                    raise ConsoleError("unsupported_media_type", "Envelope previews require application/json", status=415)
                payload = _json_object(self._read_body(MAX_ACTION_JSON_BYTES), label="Envelope preview")
                self._ok(self.server.console.preview_envelope(payload))
            elif parsed.path == "/api/notes":
                body = self._read_body(MAX_MULTIPART_BYTES)
                fields, upload = parse_multipart_form(self.headers.get("Content-Type", ""), body)
                self._ok(self.server.console.create_note(fields, upload), status=201)
            elif parsed.path == "/api/telemetry":
                if self.headers.get_content_type() != "application/json":
                    raise ConsoleError("unsupported_media_type", "Telemetry requires application/json", status=415)
                payload = _json_object(self._read_body(MAX_TELEMETRY_JSON_BYTES), label="Telemetry")
                self._ok(self.server.console.record_telemetry(payload), status=201)
            else:
                raise ConsoleError("not_found", "API endpoint not found", status=404)
        except ConsoleError as error:
            if error.code in {"untrusted_host", "cross_origin_denied", "csrf_denied"}:
                self.close_connection = True
            self._error(error)
        except Exception:
            self._error(ConsoleError("internal_error", "The review console encountered an error", status=500))


def build_server(
    *,
    run_dir: Path,
    static_dir: Path | None = None,
    host: str = "127.0.0.1",
    port: int = 8765,
) -> ReviewConsoleHTTPServer:
    if host not in {"127.0.0.1", "localhost"}:
        raise ConsoleError("nonlocal_bind_denied", "The review console may bind only to localhost")
    if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
        raise ConsoleError("invalid_port", "Port must be between 0 and 65535")
    return ReviewConsoleHTTPServer((host, port), HumanReviewConsole(run_dir, static_dir))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local human review console")
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--static-dir", type=Path)
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost"])
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    try:
        server = build_server(
            run_dir=args.run_dir,
            static_dir=args.static_dir,
            host=args.host,
            port=args.port,
        )
    except ConsoleError as error:
        parser.exit(2, f"error: {error.message}\n")
    host, port = server.server_address[:2]
    print(f"Human review console: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
