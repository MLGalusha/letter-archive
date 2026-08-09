"""Truthful, append-only session core for the pipeline walkthrough.

This module deliberately does not pretend that an arbitrary letter image can
already enter the inventory/alignment protocol.  Every selected source starts at
``source_intake``.  An unprepared source stops there with an explicit capability
report.  A hash-bound prepared Collection 014 descriptor can, after an explicit
action, initialize a fresh instance of the existing v3 two-turn protocol.

The session core is catalog-independent and has no HTTP, UI, note, screenshot,
or model-execution concerns.  Its public surface is:

* :meth:`PipelineWalkthroughSession.create`
* :meth:`PipelineWalkthroughSession.open`
* :meth:`PipelineWalkthroughSession.current`
* :meth:`PipelineWalkthroughSession.apply_source_action`
* :meth:`PipelineWalkthroughSession.apply_v3_decision`

All durable session records are created once.  The imported v3 protocol retains
its own software-owned state file, while this wrapper adds immutable source,
agent-turn, decision, and hash-chained transition records around every mutation.
"""

from __future__ import annotations

import base64
import copy
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence

from PIL import Image


POC_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = POC_ROOT / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import inventory_alignment_protocol_v3 as protocol_v3  # noqa: E402


SOURCE_DESCRIPTOR_SCHEMA_VERSION = "pipeline-walkthrough-source-descriptor.v1"
SOURCE_INTAKE_SCHEMA_VERSION = "pipeline-walkthrough-source-intake.v1"
SESSION_SCHEMA_VERSION = "pipeline-walkthrough-session.v1"
SOURCE_ACTION_SCHEMA_VERSION = "pipeline-walkthrough-source-action.v1"
V3_DECISION_ENVELOPE_SCHEMA_VERSION = "pipeline-walkthrough-v3-decision-envelope.v1"
AGENT_TURN_SCHEMA_VERSION = "pipeline-walkthrough-agent-turn.v1"
TRANSITION_SCHEMA_VERSION = "pipeline-walkthrough-transition.v1"
PREPARED_PROTOCOL_KIND = "inventory_alignment_protocol_v3"
PREPARED_PAGE_ID = "014-p04"
AGENT_CONTENT_ORDER = ("prompt", "public_packet", "response_schema", "evidence")
SESSION_WRITE_LOCK_FILENAME = ".pipeline-walkthrough.write.lock"

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID_RE = re.compile(r"[^A-Za-z0-9._-]+")


MISSING_SOURCE_PREPARATION_CAPABILITIES: tuple[dict[str, str], ...] = (
    {
        "id": "page_paper_bounds_and_excluded_surround",
        "label": "Page/paper bounds and excluded surround",
    },
    {
        "id": "writing_islands_and_line_bands",
        "label": "Every writing island and line band, including marginal and diagonal text",
    },
    {
        "id": "directed_line_and_reading_order",
        "label": "Directed line order and directed reading order",
    },
    {
        "id": "source_to_upright_transforms",
        "label": "Source-to-upright transforms",
    },
    {
        "id": "rejectable_transcript_or_transcription_result",
        "label": "Rejectable transcript proposals or a transcription-stage result",
    },
    {
        "id": "generic_full_page_ink_proposal",
        "label": "Generic full-page ink proposal with exact retained/suppressed accounting",
    },
)


STAGE_RESOURCES: dict[str, tuple[Path, Path]] = {
    protocol_v3.STAGE_A: (
        POC_ROOT / "prompts/visible-span-inventory-stage-a-v3.md",
        POC_ROOT / "schemas/inventory-stage-a-decision-v3.schema.json",
    ),
    protocol_v3.STAGE_B: (
        POC_ROOT / "prompts/many-to-many-alignment-stage-b-v3.md",
        POC_ROOT / "schemas/alignment-stage-b-decision-v3.schema.json",
    ),
}


_LOCKS_GUARD = threading.Lock()
_SESSION_LOCKS: dict[str, threading.RLock] = {}
_SESSION_WRITE_STATE = threading.local()


class WalkthroughError(RuntimeError):
    """Fail-closed walkthrough error with a stable machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: Mapping[str, Any] | None = None,
        committed: bool = False,
    ):
        super().__init__(message)
        self.code = code
        self.details = copy.deepcopy(dict(details or {}))
        self.committed = bool(committed)


def _session_lock(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _LOCKS_GUARD:
        return _SESSION_LOCKS.setdefault(key, threading.RLock())


@contextmanager
def session_write_lock(session_dir: Path | str):
    """Serialize one session's mutations across threads and server processes.

    The context is re-entrant in one thread so the HTTP console can hold the
    same lock across stale validation, a core action, and observation logging
    while the core independently protects direct callers.
    """

    raw = Path(session_dir).expanduser()
    if raw.is_symlink():
        raise WalkthroughError("unsafe_path", "Session directory cannot be a symbolic link")
    try:
        root = raw.resolve(strict=True)
    except OSError as error:
        raise WalkthroughError("missing_session", "Session directory is unavailable") from error
    if not root.is_dir():
        raise WalkthroughError("missing_session", "Session directory is unavailable")

    key = str(root)
    thread_lock = _session_lock(root)
    thread_lock.acquire()
    states = getattr(_SESSION_WRITE_STATE, "states", None)
    if states is None:
        states = {}
        _SESSION_WRITE_STATE.states = states
    state = states.get(key)
    try:
        if state is None:
            lock_path = root / SESSION_WRITE_LOCK_FILENAME
            flags = os.O_CREAT | os.O_RDWR
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor: int | None = None
            handle = None
            try:
                descriptor = os.open(lock_path, flags, 0o600)
                handle = os.fdopen(descriptor, "a+b")
                descriptor = None  # ownership transferred to ``handle``
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            except BaseException as error:
                if handle is not None:
                    handle.close()
                elif descriptor is not None:
                    os.close(descriptor)
                if isinstance(error, OSError):
                    raise WalkthroughError(
                        "unsafe_lock", "Session write lock is unavailable"
                    ) from error
                raise
            state = {"depth": 1, "handle": handle}
            states[key] = state
        else:
            state["depth"] += 1
        yield
    finally:
        current = states.get(key)
        if current is not None:
            current["depth"] -= 1
            if current["depth"] == 0:
                current["handle"].close()
                states.pop(key, None)
        thread_lock.release()


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise WalkthroughError("invalid_json_value", "Value is not finite JSON") from error


def _canonical_hash(value: object) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hashed(value: Mapping[str, Any], field: str) -> dict[str, Any]:
    result = copy.deepcopy(dict(value))
    result.pop(field, None)
    result[field] = _canonical_hash(result)
    return result


def _verify_hash(value: Mapping[str, Any], field: str, label: str) -> None:
    observed = value.get(field)
    if not isinstance(observed, str) or not SHA256_RE.fullmatch(observed):
        raise WalkthroughError("session_integrity_error", f"{label} has no valid {field}")
    basis = dict(value)
    basis.pop(field, None)
    if _canonical_hash(basis) != observed:
        raise WalkthroughError("session_integrity_error", f"{label} {field} drift")


def _commit_receipt_view(receipt: Mapping[str, Any]) -> dict[str, Any]:
    """Return the durable, browser-safe identity of one committed transition."""

    result = receipt.get("result")
    safe_result = result if isinstance(result, Mapping) else {}
    return {
        "committed": True,
        "sequence": receipt.get("sequence"),
        "transition_sha256": receipt.get("transition_sha256"),
        "transition_kind": receipt.get("transition_kind"),
        "action_type": (
            receipt.get("action", {}).get("type")
            if isinstance(receipt.get("action"), Mapping)
            else receipt.get("decision", {}).get("action_type")
            if isinstance(receipt.get("decision"), Mapping)
            else None
        ),
        "base_binding": {
            "current_sha256": receipt.get("base_current_sha256"),
            "agent_turn_sha256": receipt.get("base_agent_turn_sha256"),
            "protocol_stage": receipt.get("base_protocol_stage"),
            "state_revision": receipt.get("base_state_revision"),
            "item_label": receipt.get("base_item_label"),
        },
        "result": {
            "protocol_stage": safe_result.get("protocol_stage"),
            "state_revision": safe_result.get("state_revision"),
            "state_sha256": safe_result.get("state_sha256"),
            "agent_turn_sha256": safe_result.get("agent_turn_sha256"),
            "packet_sha256": safe_result.get("packet_sha256"),
        },
    }


def _json_bytes(value: object) -> bytes:
    try:
        return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    except (TypeError, ValueError) as error:
        raise WalkthroughError("invalid_json_value", "Value is not finite JSON") from error


def _sync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_bytes_exclusive(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise WalkthroughError("refusing_overwrite", f"Refusing to overwrite {path}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        _sync_directory(path.parent)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _write_json_exclusive(path: Path, value: Mapping[str, Any]) -> None:
    _write_bytes_exclusive(path, _json_bytes(value))


def _replace_bytes_atomic(path: Path, value: bytes) -> None:
    """Replace the protocol's one mutable state file during rollback only."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.rollback-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _load_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise WalkthroughError("session_integrity_error", f"Missing or unsafe {label}: {path}")
    try:
        value = json.loads(path.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise WalkthroughError("session_integrity_error", f"Invalid {label}: {path}") from error
    if not isinstance(value, dict):
        raise WalkthroughError("session_integrity_error", f"{label} must be a JSON object")
    return value


def _strict_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise WalkthroughError(
            "invalid_action_envelope",
            f"{label} fields differ: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}",
        )


def _normal_json_object(value: Mapping[str, Any], label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise WalkthroughError("invalid_json_value", f"{label} must be an object")
    try:
        normalized = json.loads(_json_bytes(dict(value)))
    except json.JSONDecodeError as error:  # pragma: no cover - encoder output is valid
        raise WalkthroughError("invalid_json_value", f"{label} is invalid JSON") from error
    if not isinstance(normalized, dict):  # pragma: no cover - guaranteed by Mapping input
        raise WalkthroughError("invalid_json_value", f"{label} must be an object")
    return normalized


def _require_regular_file(path: Path, label: str) -> Path:
    expanded = path.expanduser()
    if expanded.is_symlink():
        raise WalkthroughError("unsafe_path", f"{label} cannot be a symbolic link")
    resolved = expanded.resolve()
    if not resolved.is_file():
        raise WalkthroughError("missing_file", f"Missing {label}: {resolved}")
    return resolved


def _contained_file(root: Path, value: str | Path, label: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise WalkthroughError("unsafe_path", f"{label} must be a contained relative path")
    root = root.resolve()
    raw = root / candidate
    if raw.is_symlink():
        raise WalkthroughError("unsafe_path", f"{label} cannot be a symbolic link")
    resolved = raw.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise WalkthroughError("unsafe_path", f"{label} escapes its root") from error
    if not resolved.is_file():
        raise WalkthroughError("missing_file", f"Missing {label}: {resolved}")
    return resolved


def _relative_contained_file(root: Path, path: Path, label: str) -> str:
    root = root.resolve()
    if path.is_symlink():
        raise WalkthroughError("unsafe_path", f"{label} cannot be a symbolic link")
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(root)
    except ValueError as error:
        raise WalkthroughError("unsafe_path", f"{label} escapes its root") from error
    if not resolved.is_file():
        raise WalkthroughError("missing_file", f"Missing {label}: {resolved}")
    return str(relative)


def _image_size(path: Path) -> list[int]:
    try:
        with Image.open(path) as image:
            return [int(image.width), int(image.height)]
    except (OSError, ValueError) as error:
        raise WalkthroughError("invalid_source_image", f"Cannot read source image: {path}") from error


def _safe_id(value: str) -> str:
    safe = SAFE_ID_RE.sub("-", value).strip("-.")
    if not safe:
        raise WalkthroughError("session_integrity_error", "Unsafe empty identifier")
    return safe


def _extract_action_consts(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        properties = value.get("properties")
        if isinstance(properties, dict):
            type_schema = properties.get("type")
            if isinstance(type_schema, dict) and isinstance(type_schema.get("const"), str):
                found.add(type_schema["const"])
        for child in value.values():
            found.update(_extract_action_consts(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_extract_action_consts(child))
    return found


def _source_blocker() -> dict[str, Any]:
    return {
        "code": "missing_source_preparation",
        "status": "blocked_missing_transition",
        "message": "This selected source has no reviewed, versioned preparation output.",
        "missing_capabilities": copy.deepcopy(list(MISSING_SOURCE_PREPARATION_CAPABILITIES)),
    }


def _normalize_source_descriptor(descriptor: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    value = _normal_json_object(descriptor, "source descriptor")
    allowed = {"schema_version", "page_id", "source", "prepared_protocol"}
    if set(value) - allowed or not {"schema_version", "page_id", "source"}.issubset(value):
        raise WalkthroughError("invalid_source_descriptor", "Source descriptor fields are invalid")
    if value.get("schema_version") != SOURCE_DESCRIPTOR_SCHEMA_VERSION:
        raise WalkthroughError("invalid_source_descriptor", "Wrong source descriptor schema version")
    page_id = value.get("page_id")
    source = value.get("source")
    if not isinstance(page_id, str) or not page_id.strip() or not isinstance(source, dict):
        raise WalkthroughError("invalid_source_descriptor", "page_id and source are required")
    if set(source) - {"path", "sha256", "size"} or not isinstance(source.get("path"), str):
        raise WalkthroughError("invalid_source_descriptor", "source.path is required")
    source_path = _require_regular_file(Path(source["path"]), "selected source image")
    observed_hash = _sha256_file(source_path)
    observed_size = _image_size(source_path)
    claimed_hash = source.get("sha256")
    claimed_size = source.get("size")
    if claimed_hash is not None and claimed_hash != observed_hash:
        raise WalkthroughError("source_hash_drift", "Selected source hash does not match its descriptor")
    if claimed_size is not None and claimed_size != observed_size:
        raise WalkthroughError("source_dimension_drift", "Selected source dimensions do not match")

    normalized = {
        "schema_version": SOURCE_DESCRIPTOR_SCHEMA_VERSION,
        "page_id": page_id,
        "source": {
            "path": str(source_path),
            "sha256": observed_hash,
            "size": observed_size,
        },
        "prepared_protocol": None,
    }
    prepared = value.get("prepared_protocol")
    if prepared is None:
        return normalized, None
    if not isinstance(prepared, dict) or set(prepared) != {"kind", "spec"}:
        raise WalkthroughError("invalid_source_descriptor", "prepared_protocol must contain kind and spec")
    if prepared.get("kind") != PREPARED_PROTOCOL_KIND or not isinstance(prepared.get("spec"), dict):
        raise WalkthroughError("invalid_source_descriptor", "Unsupported prepared protocol")
    if page_id != PREPARED_PAGE_ID:
        raise WalkthroughError(
            "unsupported_prepared_source",
            "The current prepared walkthrough is explicitly limited to 014-p04",
        )
    spec = copy.deepcopy(prepared["spec"])
    if spec.get("schema_version") != "inventory-alignment-page-spec.v3":
        raise WalkthroughError("invalid_prepared_protocol", "Prepared spec is not v3")
    if spec.get("page_id") != page_id:
        raise WalkthroughError("invalid_prepared_protocol", "Prepared spec page does not match source")
    if not isinstance(spec.get("source_path"), str) or not isinstance(
        spec.get("untrusted_prior_path"), str
    ):
        raise WalkthroughError("invalid_prepared_protocol", "Prepared spec paths are missing")
    spec_source = _require_regular_file(Path(spec["source_path"]), "prepared source")
    if _sha256_file(spec_source) != observed_hash or spec.get("source_sha256") != observed_hash:
        raise WalkthroughError("invalid_prepared_protocol", "Prepared spec source binding differs")
    prior_path = _require_regular_file(Path(spec["untrusted_prior_path"]), "untrusted prior")
    prior_hash = _sha256_file(prior_path)
    if spec.get("untrusted_prior_sha256") != prior_hash:
        raise WalkthroughError("invalid_prepared_protocol", "Prepared prior hash drift")
    # A secure intake layer may have copied the selected bytes into an isolated
    # session snapshot.  Byte identity, not the old filesystem location, is the
    # authority; make the fresh protocol render from the selected snapshot.
    spec["source_path"] = str(source_path)
    spec["untrusted_prior_path"] = str(prior_path)
    normalized["prepared_protocol"] = {
        "kind": PREPARED_PROTOCOL_KIND,
        "spec_sha256": _canonical_hash(spec),
    }
    return normalized, spec


class PipelineWalkthroughSession:
    """A selected-source walkthrough session with append-only audit records."""

    def __init__(self, session_dir: Path | str):
        raw = Path(session_dir).expanduser()
        if raw.is_symlink():
            raise WalkthroughError("unsafe_path", "Session directory cannot be a symbolic link")
        self.root = raw.resolve()
        self._lock = _session_lock(self.root)

    @classmethod
    def create(
        cls, session_dir: Path | str, source_descriptor: Mapping[str, Any]
    ) -> "PipelineWalkthroughSession":
        raw = Path(session_dir).expanduser()
        if raw.exists() or raw.is_symlink():
            raise WalkthroughError("refusing_overwrite", f"Session path already exists: {raw}")
        normalized, spec = _normalize_source_descriptor(source_descriptor)
        parent = raw.parent.resolve()
        parent.mkdir(parents=True, exist_ok=True)
        target = parent / raw.name
        try:
            target.mkdir(mode=0o700)
        except FileExistsError as error:
            raise WalkthroughError("refusing_overwrite", f"Session path already exists: {target}") from error
        try:
            (target / "agent-turns").mkdir()
            (target / "decisions").mkdir()
            (target / "transitions").mkdir()
            (target / "private").mkdir()
            source_intake = _hashed(
                {
                    "schema_version": SOURCE_INTAKE_SCHEMA_VERSION,
                    "page_id": normalized["page_id"],
                    "source": normalized["source"],
                    "prepared_protocol": normalized["prepared_protocol"],
                    "starting_stage": "source_intake",
                    "provenance_status": "live_same_run",
                },
                "source_intake_sha256",
            )
            _write_json_exclusive(target / "source-intake.json", source_intake)
            prepared_manifest: dict[str, Any] | None = None
            if spec is not None:
                spec_path = target / "private/prepared-protocol-spec-v3.json"
                _write_json_exclusive(spec_path, spec)
                prepared_manifest = {
                    "kind": PREPARED_PROTOCOL_KIND,
                    "spec_path": str(spec_path.relative_to(target)),
                    "spec_file_sha256": _sha256_file(spec_path),
                    "spec_canonical_sha256": _canonical_hash(spec),
                    "provenance_status": "prepared_bound_external_input",
                }
            manifest = _hashed(
                {
                    "schema_version": SESSION_SCHEMA_VERSION,
                    "session_id": uuid.uuid4().hex,
                    "storage_contract": "append_only_receipts_around_software_owned_v3_state",
                    "source_intake_path": "source-intake.json",
                    "source_intake_sha256": source_intake["source_intake_sha256"],
                    "prepared_protocol": prepared_manifest,
                },
                "session_manifest_sha256",
            )
            _write_json_exclusive(target / "session-manifest.json", manifest)
        except BaseException:
            shutil.rmtree(target)
            raise
        return cls(target)

    @classmethod
    def open(cls, session_dir: Path | str) -> "PipelineWalkthroughSession":
        session = cls(session_dir)
        session._load_manifest_and_intake()
        return session

    @property
    def _workflow_root(self) -> Path:
        return self.root / "protocol-v3"

    @property
    def _state_path(self) -> Path:
        return self._workflow_root / "private/workflow-state-v3.json"

    def _load_manifest_and_intake(self) -> tuple[dict[str, Any], dict[str, Any]]:
        if not self.root.is_dir() or self.root.is_symlink():
            raise WalkthroughError("missing_session", f"Missing session: {self.root}")
        manifest = _load_json_object(self.root / "session-manifest.json", "session manifest")
        if manifest.get("schema_version") != SESSION_SCHEMA_VERSION:
            raise WalkthroughError("session_integrity_error", "Wrong session schema version")
        _verify_hash(manifest, "session_manifest_sha256", "session manifest")
        intake_path = _contained_file(self.root, manifest.get("source_intake_path", ""), "source intake")
        intake = _load_json_object(intake_path, "source intake")
        if intake.get("schema_version") != SOURCE_INTAKE_SCHEMA_VERSION:
            raise WalkthroughError("session_integrity_error", "Wrong source intake schema")
        _verify_hash(intake, "source_intake_sha256", "source intake")
        if manifest.get("source_intake_sha256") != intake["source_intake_sha256"]:
            raise WalkthroughError("session_integrity_error", "Manifest/source intake binding drift")
        source = intake.get("source")
        if not isinstance(source, dict) or not isinstance(source.get("path"), str):
            raise WalkthroughError("session_integrity_error", "Malformed selected source binding")
        source_path = _require_regular_file(Path(source["path"]), "selected source image")
        if _sha256_file(source_path) != source.get("sha256"):
            raise WalkthroughError("source_hash_drift", "Selected source changed after intake")
        if _image_size(source_path) != source.get("size"):
            raise WalkthroughError("source_dimension_drift", "Selected source dimensions changed")
        prepared = manifest.get("prepared_protocol")
        if prepared is not None:
            if not isinstance(prepared, dict) or prepared.get("kind") != PREPARED_PROTOCOL_KIND:
                raise WalkthroughError("session_integrity_error", "Malformed prepared protocol binding")
            spec_path = _contained_file(self.root, prepared.get("spec_path", ""), "prepared spec")
            if _sha256_file(spec_path) != prepared.get("spec_file_sha256"):
                raise WalkthroughError("session_integrity_error", "Prepared spec file drift")
            spec = _load_json_object(spec_path, "prepared spec")
            if _canonical_hash(spec) != prepared.get("spec_canonical_sha256"):
                raise WalkthroughError("session_integrity_error", "Prepared spec content drift")
        return manifest, intake

    def _read_receipts(self, manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
        transition_dir = self.root / "transitions"
        if transition_dir.is_symlink() or not transition_dir.is_dir():
            raise WalkthroughError("session_integrity_error", "Missing transition directory")
        paths = sorted(transition_dir.glob("*.json"))
        receipts: list[dict[str, Any]] = []
        previous: str | None = None
        for expected_sequence, path in enumerate(paths, start=1):
            if path.name != f"{expected_sequence:08d}.json":
                raise WalkthroughError("session_integrity_error", "Non-contiguous transition sequence")
            receipt = _load_json_object(path, "transition receipt")
            if receipt.get("schema_version") != TRANSITION_SCHEMA_VERSION:
                raise WalkthroughError("session_integrity_error", "Wrong transition schema")
            _verify_hash(receipt, "transition_sha256", "transition receipt")
            if receipt.get("sequence") != expected_sequence:
                raise WalkthroughError("session_integrity_error", "Transition sequence drift")
            if receipt.get("previous_transition_sha256") != previous:
                raise WalkthroughError("session_integrity_error", "Transition hash chain drift")
            if receipt.get("session_manifest_sha256") != manifest["session_manifest_sha256"]:
                raise WalkthroughError("session_integrity_error", "Transition/session binding drift")
            transition_kind = receipt.get("transition_kind")
            if transition_kind == "source_action":
                action = receipt.get("action")
                if not isinstance(action, dict) or action != {
                    "type": "begin_prepared_protocol"
                }:
                    raise WalkthroughError(
                        "session_integrity_error", "Source action receipt is malformed"
                    )
                reconstructed = {
                    "schema_version": SOURCE_ACTION_SCHEMA_VERSION,
                    "current_sha256": receipt.get("base_current_sha256"),
                    "action": action,
                }
                if receipt.get("action_envelope_sha256") != _canonical_hash(reconstructed):
                    raise WalkthroughError(
                        "session_integrity_error", "Source action receipt binding drift"
                    )
            elif transition_kind == "v3_decision":
                decision_record = receipt.get("decision")
                if not isinstance(decision_record, dict):
                    raise WalkthroughError(
                        "session_integrity_error", "Decision receipt is malformed"
                    )
                decision_path = _contained_file(
                    self.root, decision_record.get("path", ""), "accepted decision"
                )
                decision_bytes = decision_path.read_bytes()
                if _sha256_bytes(decision_bytes) != decision_record.get(
                    "file_sha256"
                ):
                    raise WalkthroughError(
                        "session_integrity_error", "Accepted decision file drift"
                    )
                decision = _load_json_object(decision_path, "accepted decision")
                decision_action = decision.get("action")
                if (
                    _canonical_hash(decision)
                    != decision_record.get("canonical_sha256")
                    or not isinstance(decision_action, dict)
                    or decision_action.get("type")
                    != decision_record.get("action_type")
                ):
                    raise WalkthroughError(
                        "session_integrity_error", "Accepted decision content drift"
                    )
                reconstructed = {
                    "schema_version": V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                    "current_sha256": receipt.get("base_current_sha256"),
                    "agent_turn_sha256": receipt.get("base_agent_turn_sha256"),
                    "decision": decision,
                }
                if receipt.get("decision_envelope_sha256") != _canonical_hash(
                    reconstructed
                ):
                    raise WalkthroughError(
                        "session_integrity_error", "Decision envelope receipt drift"
                    )
            else:
                raise WalkthroughError(
                    "session_integrity_error", "Unsupported transition kind"
                )

            result = receipt.get("result")
            if not isinstance(result, dict) or result.get("status") != "accepted":
                raise WalkthroughError(
                    "session_integrity_error", "Transition result is malformed"
                )
            expected_revision = expected_sequence - 1
            if result.get("state_revision") != expected_revision:
                raise WalkthroughError(
                    "session_integrity_error", "Transition result revision drift"
                )
            turn_path = result.get("agent_turn_path")
            if turn_path is None:
                if transition_kind == "source_action" or any(
                    result.get(field) is not None
                    for field in (
                        "agent_turn_sha256",
                        "packet_sha256",
                        "packet_file_sha256",
                    )
                ):
                    raise WalkthroughError(
                        "session_integrity_error", "Transition successor turn is malformed"
                    )
                if result.get("protocol_stage") != protocol_v3.COMPLETE:
                    raise WalkthroughError(
                        "session_integrity_error", "Transition successor stage is malformed"
                    )
            elif isinstance(turn_path, str):
                turn = self._load_and_verify_agent_turn(turn_path)
                protocol = turn.get("protocol")
                packet = turn.get("public_packet")
                if (
                    not isinstance(protocol, dict)
                    or not isinstance(packet, dict)
                    or turn.get("session_id") != manifest.get("session_id")
                    or turn.get("session_manifest_sha256")
                    != manifest.get("session_manifest_sha256")
                    or turn.get("agent_turn_sha256")
                    != result.get("agent_turn_sha256")
                    or packet.get("packet_sha256") != result.get("packet_sha256")
                    or packet.get("file_sha256") != result.get("packet_file_sha256")
                    or protocol.get("stage") != result.get("protocol_stage")
                    or protocol.get("state_revision") != result.get("state_revision")
                    or protocol.get("state_sha256") != result.get("state_sha256")
                    or protocol.get("state_file_sha256")
                    != result.get("state_file_sha256")
                ):
                    raise WalkthroughError(
                        "session_integrity_error", "Transition successor turn binding drift"
                    )
            else:
                raise WalkthroughError(
                    "session_integrity_error", "Transition successor path is malformed"
                )
            previous = receipt["transition_sha256"]
            receipts.append(receipt)
        if self._state_path.exists() and not receipts:
            raise WalkthroughError("session_integrity_error", "v3 state exists without a begin receipt")
        return receipts

    def _prepared_spec(self, manifest: Mapping[str, Any]) -> dict[str, Any] | None:
        prepared = manifest.get("prepared_protocol")
        if prepared is None:
            return None
        spec_path = _contained_file(self.root, prepared["spec_path"], "prepared spec")
        spec = _load_json_object(spec_path, "prepared spec")
        source_path = _require_regular_file(Path(spec["source_path"]), "prepared source")
        prior_path = _require_regular_file(Path(spec["untrusted_prior_path"]), "untrusted prior")
        if _sha256_file(source_path) != spec.get("source_sha256"):
            raise WalkthroughError("source_hash_drift", "Prepared source hash drift")
        if _sha256_file(prior_path) != spec.get("untrusted_prior_sha256"):
            raise WalkthroughError("prepared_input_hash_drift", "Prepared prior hash drift")
        return spec

    def _stage_graph(
        self,
        *,
        prepared: bool,
        begun: bool,
        protocol_stage: str | None,
        current_line_id: str | None = None,
        current_line_index: int | None = None,
        line_count: int | None = None,
    ) -> dict[str, Any]:
        v3_complete = protocol_stage == protocol_v3.COMPLETE

        def stage_status(stage: str) -> str:
            if stage == "source_intake":
                # Reaching this core means selection and immutable intake already
                # succeeded.  Preparation may be blocked, but selection is not.
                return "complete"
            if stage == "source_preparation":
                return "satisfied_by_bound_input" if prepared else "blocked"
            if stage == protocol_v3.STAGE_A:
                if protocol_stage == protocol_v3.STAGE_A:
                    return "current"
                if protocol_stage == protocol_v3.STAGE_B or v3_complete:
                    return "complete"
                return "available_not_started" if prepared else "blocked_upstream"
            if stage == protocol_v3.STAGE_B:
                if protocol_stage == protocol_v3.STAGE_B:
                    return "current"
                if v3_complete:
                    return "complete"
                return "available_not_started" if prepared else "blocked_upstream"
            if stage == "claimed_mask_to_envelope_handoff":
                return "blocked_missing_transition"
            if stage == "envelope_geometry":
                return "available_but_disconnected"
            return "available_not_started" if v3_complete else "blocked_upstream"

        nodes = [
            {
                "id": "source_intake",
                "label": "Source selection",
                "status": stage_status("source_intake"),
                "provenance_status": "live_same_run",
            },
            {
                "id": "source_preparation",
                "label": "Source preparation",
                "status": stage_status("source_preparation"),
                "provenance_status": (
                    "prepared_bound_external_input" if prepared else "blocked_missing_transition"
                ),
            },
            {
                "id": protocol_v3.STAGE_A,
                "label": "Visible-span inventory",
                "status": stage_status(protocol_v3.STAGE_A),
                "provenance_status": "live_same_run" if begun else "available_not_started",
                "scope": "current_line_loop",
                "current_line_status": (
                    "complete"
                    if protocol_stage == protocol_v3.STAGE_B
                    else "current"
                    if protocol_stage == protocol_v3.STAGE_A
                    else "complete"
                    if v3_complete
                    else "not_started"
                ),
                "detail": (
                    "Completed for the current line; Stage B is acting now."
                    if protocol_stage == protocol_v3.STAGE_B
                    else (
                        "All line inventories are complete."
                        if v3_complete
                        else (
                            "Current line inventory; the A/B pair repeats for every line."
                            if protocol_stage == protocol_v3.STAGE_A
                            else "Available after the prepared protocol begins."
                            if prepared
                            else "Waiting for source preparation."
                        )
                    )
                ),
            },
            {
                "id": protocol_v3.STAGE_B,
                "label": "Many-to-many alignment",
                "status": stage_status(protocol_v3.STAGE_B),
                "provenance_status": "live_same_run" if begun else "available_not_started",
                "scope": "current_line_loop",
                "current_line_status": (
                    "current"
                    if protocol_stage == protocol_v3.STAGE_B
                    else "next"
                    if protocol_stage == protocol_v3.STAGE_A
                    else "complete"
                    if v3_complete
                    else "not_started"
                ),
                "detail": (
                    "Current line alignment."
                    if protocol_stage == protocol_v3.STAGE_B
                    else (
                        "All line alignments are complete."
                        if v3_complete
                        else (
                            "Next for the current line; earlier lines may already be complete."
                            if protocol_stage == protocol_v3.STAGE_A
                            else "Available after the current line inventory is submitted."
                            if prepared
                            else "Waiting for source preparation."
                        )
                    )
                ),
            },
            {
                "id": "ownership_knockout",
                "label": "Ownership knockout",
                "status": stage_status("ownership_knockout"),
                "provenance_status": "available_not_started",
            },
            {
                "id": "per_word_ownership_cleanup",
                "label": "Per-word ownership/cleanup",
                "status": stage_status("per_word_ownership_cleanup"),
                "provenance_status": "available_not_started",
            },
            {
                "id": "fresh_residual_audit",
                "label": "Fresh residual audit",
                "status": stage_status("fresh_residual_audit"),
                "provenance_status": "available_not_started",
            },
            {
                "id": "claimed_mask_to_envelope_handoff",
                "label": "Claimed-mask to envelope handoff",
                "status": stage_status("claimed_mask_to_envelope_handoff"),
                "provenance_status": "blocked_missing_transition",
            },
            {
                "id": "envelope_geometry",
                "label": "Envelope geometry",
                "status": stage_status("envelope_geometry"),
                "provenance_status": "available_but_disconnected",
            },
        ]
        upstream = "ready_by_explicit_action" if prepared else "blocked_missing_transition"
        edges = [
            {
                "from": "source_intake",
                "to": "source_preparation",
                "status": "satisfied_by_bound_input" if prepared else "blocked",
                "blocker_code": None if prepared else "missing_source_preparation",
            },
            {
                "from": "source_preparation",
                "to": protocol_v3.STAGE_A,
                "status": upstream,
                "blocker_code": None if prepared else "missing_source_preparation",
            },
            {
                "from": protocol_v3.STAGE_A,
                "to": protocol_v3.STAGE_B,
                "status": "implemented_live_v3_transition",
                "blocker_code": None,
            },
            {
                "from": protocol_v3.STAGE_B,
                "to": "ownership_knockout",
                "status": "available_external_not_invoked" if v3_complete else "blocked_upstream",
                "blocker_code": None if v3_complete else "inventory_alignment_incomplete",
            },
            {
                "from": "ownership_knockout",
                "to": "per_word_ownership_cleanup",
                "status": "implemented_external_not_invoked",
                "blocker_code": "missing_walkthrough_downstream_orchestration",
            },
            {
                "from": "per_word_ownership_cleanup",
                "to": "fresh_residual_audit",
                "status": "implemented_external_not_invoked",
                "blocker_code": "missing_walkthrough_downstream_orchestration",
            },
            {
                "from": "fresh_residual_audit",
                "to": "claimed_mask_to_envelope_handoff",
                "status": "blocked",
                "blocker_code": "missing_claimed_mask_to_envelope_handoff",
            },
            {
                "from": "claimed_mask_to_envelope_handoff",
                "to": "envelope_geometry",
                "status": "blocked",
                "blocker_code": "missing_claimed_mask_to_envelope_handoff",
            },
        ]
        return {
            "schema_version": "pipeline-walkthrough-stage-graph.v1",
            "loop": {
                "kind": "per_line_two_stage_loop",
                "stage_ids": [protocol_v3.STAGE_A, protocol_v3.STAGE_B],
                "current_line_id": current_line_id,
                "current_line_index": current_line_index,
                "line_count": line_count,
                "completed_line_count": (
                    line_count
                    if v3_complete and line_count is not None
                    else current_line_index
                ),
            },
            "nodes": nodes,
            "edges": edges,
        }

    def _append_receipt(
        self,
        manifest: Mapping[str, Any],
        receipts: Sequence[Mapping[str, Any]],
        body: Mapping[str, Any],
    ) -> dict[str, Any]:
        sequence = len(receipts) + 1
        receipt = _hashed(
            {
                "schema_version": TRANSITION_SCHEMA_VERSION,
                "sequence": sequence,
                "previous_transition_sha256": (
                    receipts[-1]["transition_sha256"] if receipts else None
                ),
                "session_manifest_sha256": manifest["session_manifest_sha256"],
                **copy.deepcopy(dict(body)),
            },
            "transition_sha256",
        )
        _write_json_exclusive(self.root / f"transitions/{sequence:08d}.json", receipt)
        return receipt

    @staticmethod
    def _child_names(directory: Path) -> set[str]:
        if not directory.exists():
            return set()
        if directory.is_symlink() or not directory.is_dir():
            raise WalkthroughError("session_integrity_error", f"Unsafe session directory: {directory}")
        return {child.name for child in directory.iterdir()}

    @staticmethod
    def _remove_new_children(directory: Path, before: set[str]) -> None:
        """Remove only artifacts created by an uncommitted transition."""

        if not directory.exists():
            return
        for child in directory.iterdir():
            if child.name in before:
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)

    def _legal_action_congruence(
        self,
        *,
        prompt_bytes: bytes,
        response_schema: Mapping[str, Any],
        packet: Mapping[str, Any],
    ) -> dict[str, Any]:
        prompt_text = prompt_bytes.decode("utf-8")
        packet_actions = list(packet["legal_actions"])
        schema_actions = sorted(_extract_action_consts(response_schema))
        prompt_mentions = {action: action in prompt_text for action in packet_actions}
        schema_path = packet["stage_contract"]["response_schema"]
        schema_delegation = schema_path in prompt_text
        schema_match = set(packet_actions) == set(schema_actions)
        literal_coverage = all(prompt_mentions.values())
        effective_match = schema_match and (literal_coverage or schema_delegation)
        return {
            "schema_version": "prompt-packet-legal-action-congruence.v1",
            "scope": (
                "Legal-action vocabulary only; this report does not claim semantic equality "
                "between prompt prose, JSON Schema, and packet."
            ),
            "packet_legal_action_types": packet_actions,
            "response_schema_action_types": schema_actions,
            "response_schema_exact_set_match": schema_match,
            "prompt_literal_mentions": prompt_mentions,
            "prompt_literal_coverage": literal_coverage,
            "prompt_delegates_exact_output_to_bound_response_schema": schema_delegation,
            "effective_instruction_contract_match": effective_match,
            "status": "pass" if effective_match else "fail",
        }

    def _collect_evidence_hashes(
        self, packet: Mapping[str, Any], workflow_root: Path
    ) -> tuple[list[dict[str, Any]], str]:
        evidence = packet.get("evidence")
        if not isinstance(evidence, dict):
            raise WalkthroughError("session_integrity_error", "Packet evidence is malformed")
        files: list[dict[str, Any]] = []

        def visit(value: object, pointer: str) -> None:
            if isinstance(value, dict):
                if isinstance(value.get("path"), str) and isinstance(value.get("sha256"), str):
                    path = _contained_file(workflow_root, value["path"], f"evidence {pointer}")
                    observed = _sha256_file(path)
                    if observed != value["sha256"]:
                        raise WalkthroughError("evidence_hash_drift", f"Evidence hash drift at {pointer}")
                    files.append(
                        {
                            "packet_pointer": pointer,
                            "path": value["path"],
                            "packet_claimed_sha256": value["sha256"],
                            "observed_file_sha256": observed,
                            "byte_length": path.stat().st_size,
                            "provenance_status": "rendered_for_this_new_session",
                        }
                    )
                for key, child in value.items():
                    visit(child, f"{pointer}/{key}")
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    visit(child, f"{pointer}/{index}")

        visit(evidence, "/evidence")
        return files, _canonical_hash(evidence)

    def _snapshot_agent_turn(
        self,
        *,
        manifest: Mapping[str, Any],
        state: Mapping[str, Any],
        packet_path: Path,
    ) -> dict[str, Any]:
        stage = state.get("current_stage")
        if stage not in STAGE_RESOURCES:
            raise WalkthroughError("session_integrity_error", f"No agent resource mapping for {stage}")
        workflow_root = self._workflow_root.resolve()
        packet_relative = _relative_contained_file(workflow_root, packet_path, "public packet")
        try:
            packet = protocol_v3.load_packet_v3(packet_path)
        except protocol_v3.ProtocolV3Error as error:
            raise WalkthroughError("session_integrity_error", str(error)) from error
        if packet.get("state_revision") != state.get("state_revision") or packet.get(
            "state_sha256"
        ) != state.get("state_sha256"):
            raise WalkthroughError("session_integrity_error", "Packet/state binding drift")
        prompt_path, schema_path = STAGE_RESOURCES[stage]
        prompt_path = _require_regular_file(prompt_path, "stage prompt")
        schema_path = _require_regular_file(schema_path, "response schema")
        prompt_bytes = prompt_path.read_bytes()
        schema_bytes = schema_path.read_bytes()
        packet_bytes = packet_path.read_bytes()
        try:
            response_schema = json.loads(schema_bytes)
        except json.JSONDecodeError as error:
            raise WalkthroughError("session_integrity_error", "Response schema is invalid JSON") from error
        if not isinstance(response_schema, dict):
            raise WalkthroughError("session_integrity_error", "Response schema is not an object")
        evidence_files, structured_evidence_hash = self._collect_evidence_hashes(
            packet, workflow_root
        )
        revision = state["state_revision"]
        line_id = packet["current"]["line_id"]
        turn_name = f"{revision:06d}-{_safe_id(line_id)}-{_safe_id(stage)}"
        final_dir = self.root / "agent-turns" / turn_name
        if final_dir.exists() or final_dir.is_symlink():
            raise WalkthroughError("refusing_overwrite", f"Agent turn already exists: {final_dir}")
        temporary_dir = Path(
            tempfile.mkdtemp(prefix=f".{turn_name}.creating-", dir=self.root / "agent-turns")
        )
        try:
            _write_bytes_exclusive(temporary_dir / "prompt.md", prompt_bytes)
            _write_bytes_exclusive(temporary_dir / "response-schema.json", schema_bytes)
            _write_bytes_exclusive(temporary_dir / "public-packet.json", packet_bytes)
            relative_turn_dir = str(final_dir.relative_to(self.root))
            congruence = self._legal_action_congruence(
                prompt_bytes=prompt_bytes,
                response_schema=response_schema,
                packet=packet,
            )
            if congruence["status"] != "pass":
                raise WalkthroughError(
                    "legal_action_contract_mismatch",
                    "Prompt/schema/packet legal-action contract does not pass",
                )
            record = _hashed(
                {
                    "schema_version": AGENT_TURN_SCHEMA_VERSION,
                    "session_id": manifest["session_id"],
                    "session_manifest_sha256": manifest["session_manifest_sha256"],
                    "content_order": list(AGENT_CONTENT_ORDER),
                    "protocol": {
                        "name": protocol_v3.PROTOCOL_VERSION,
                        "stage": stage,
                        "state_revision": revision,
                        "state_sha256": state["state_sha256"],
                        "state_file_sha256": _sha256_file(self._state_path),
                        "line_id": line_id,
                    },
                    "source_binding": packet["source"],
                    "prompt": {
                        "provenance_status": "verified_for_this_new_session",
                        "repository_source_path": str(prompt_path.relative_to(POC_ROOT)),
                        "immutable_copy_path": f"{relative_turn_dir}/prompt.md",
                        "byte_length": len(prompt_bytes),
                        "sha256": _sha256_bytes(prompt_bytes),
                        "bytes_base64": base64.b64encode(prompt_bytes).decode("ascii"),
                    },
                    "response_schema": {
                        "provenance_status": "verified_for_this_new_session",
                        "repository_source_path": str(schema_path.relative_to(POC_ROOT)),
                        "immutable_copy_path": f"{relative_turn_dir}/response-schema.json",
                        "byte_length": len(schema_bytes),
                        "sha256": _sha256_bytes(schema_bytes),
                        "bytes_base64": base64.b64encode(schema_bytes).decode("ascii"),
                        "json": response_schema,
                    },
                    "public_packet": {
                        "provenance_status": "live_public_packet_for_this_new_session",
                        "protocol_source_path": packet_relative,
                        "immutable_copy_path": f"{relative_turn_dir}/public-packet.json",
                        "byte_length": len(packet_bytes),
                        "file_sha256": _sha256_bytes(packet_bytes),
                        "packet_sha256": packet["packet_sha256"],
                        "bytes_base64": base64.b64encode(packet_bytes).decode("ascii"),
                        "json": packet,
                    },
                    "evidence": {
                        "provenance_status": "rendered_for_this_new_session",
                        "structured_evidence_sha256": structured_evidence_hash,
                        "files": evidence_files,
                    },
                    "actor_runtime": {
                        "status": "not_selected_by_session_core",
                        "model": None,
                        "service_tier": None,
                    },
                    "tool_action_contract": {
                        "tool": "apply_v3_decision",
                        "envelope_schema_version": V3_DECISION_ENVELOPE_SCHEMA_VERSION,
                        "required_envelope_fields": [
                            "schema_version",
                            "current_sha256",
                            "agent_turn_sha256",
                            "decision",
                        ],
                        "decision_binding_fields": [
                            "trial_id",
                            "page_id",
                            "line_id",
                            "stage",
                            "state_revision",
                            "state_sha256",
                            "packet_sha256",
                        ],
                        "legal_action_types": packet["legal_actions"],
                        "fail_closed_on_stale_or_hash_mismatch": True,
                    },
                    "legal_action_congruence": congruence,
                    "provenance": {
                        "overall_status": "live_same_run",
                        "historical_prompt_claim": False,
                        "future_or_withheld_values_injected": False,
                    },
                },
                "agent_turn_sha256",
            )
            _write_json_exclusive(temporary_dir / "agent-turn.json", record)
            temporary_dir.rename(final_dir)
            _sync_directory(final_dir.parent)
        except BaseException:
            shutil.rmtree(temporary_dir, ignore_errors=True)
            raise
        return record

    def _load_and_verify_agent_turn(self, relative_path: str) -> dict[str, Any]:
        path = _contained_file(self.root, relative_path, "agent turn")
        record = _load_json_object(path, "agent turn")
        if record.get("schema_version") != AGENT_TURN_SCHEMA_VERSION:
            raise WalkthroughError("session_integrity_error", "Wrong agent-turn schema")
        _verify_hash(record, "agent_turn_sha256", "agent turn")
        if record.get("content_order") != list(AGENT_CONTENT_ORDER):
            raise WalkthroughError("session_integrity_error", "Agent-turn content order drift")
        decoded_sections: dict[str, bytes] = {}
        copy_paths: dict[str, Path] = {}
        for section, hash_field in (
            ("prompt", "sha256"),
            ("response_schema", "sha256"),
            ("public_packet", "file_sha256"),
        ):
            metadata = record.get(section)
            if not isinstance(metadata, dict):
                raise WalkthroughError("session_integrity_error", f"Missing {section} snapshot")
            copy_path = _contained_file(self.root, metadata.get("immutable_copy_path", ""), section)
            raw = copy_path.read_bytes()
            if (
                _sha256_bytes(raw) != metadata.get(hash_field)
                or metadata.get("byte_length") != len(raw)
            ):
                raise WalkthroughError("session_integrity_error", f"{section} immutable copy drift")
            encoded = metadata.get("bytes_base64")
            try:
                decoded = base64.b64decode(encoded, validate=True)
            except (TypeError, ValueError) as error:
                raise WalkthroughError("session_integrity_error", f"{section} byte snapshot invalid") from error
            if decoded != raw:
                raise WalkthroughError("session_integrity_error", f"{section} byte snapshot drift")
            decoded_sections[section] = decoded
            copy_paths[section] = copy_path

        try:
            schema_from_bytes = json.loads(decoded_sections["response_schema"])
            packet_from_bytes = json.loads(decoded_sections["public_packet"])
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WalkthroughError(
                "session_integrity_error", "Agent-turn JSON byte snapshot is invalid"
            ) from error
        if not isinstance(schema_from_bytes, dict) or schema_from_bytes != record[
            "response_schema"
        ].get("json"):
            raise WalkthroughError(
                "session_integrity_error",
                "Embedded response schema differs from its immutable bytes",
            )
        if not isinstance(packet_from_bytes, dict) or packet_from_bytes != record[
            "public_packet"
        ].get("json"):
            raise WalkthroughError(
                "session_integrity_error",
                "Embedded public packet differs from its immutable bytes",
            )
        try:
            verified_packet = protocol_v3.load_packet_v3(copy_paths["public_packet"])
        except protocol_v3.ProtocolV3Error as error:
            raise WalkthroughError(
                "session_integrity_error", "Immutable public packet is invalid"
            ) from error
        if verified_packet != packet_from_bytes or record["public_packet"].get(
            "packet_sha256"
        ) != verified_packet.get("packet_sha256"):
            raise WalkthroughError(
                "session_integrity_error", "Public packet canonical binding drift"
            )
        expected_congruence = self._legal_action_congruence(
            prompt_bytes=decoded_sections["prompt"],
            response_schema=schema_from_bytes,
            packet=verified_packet,
        )
        if record.get("legal_action_congruence") != expected_congruence:
            raise WalkthroughError(
                "session_integrity_error", "Agent-turn instruction congruence drift"
            )
        packet_meta = record["public_packet"]
        workflow_packet = _contained_file(
            self._workflow_root, packet_meta["protocol_source_path"], "live public packet"
        )
        if workflow_packet.read_bytes() != decoded_sections["public_packet"]:
            raise WalkthroughError("session_integrity_error", "Live public packet drift")
        expected_evidence_files, expected_structured_hash = self._collect_evidence_hashes(
            verified_packet, self._workflow_root.resolve()
        )
        evidence_record = record.get("evidence")
        if not isinstance(evidence_record, dict) or evidence_record.get(
            "structured_evidence_sha256"
        ) != expected_structured_hash or evidence_record.get("files") != expected_evidence_files:
            raise WalkthroughError(
                "evidence_hash_drift", "Agent-turn evidence manifest drift"
            )
        return record

    def current(self) -> dict[str, Any]:
        """Return the current truthful work item plus a stale-action binding hash."""

        with self._lock:
            manifest, intake = self._load_manifest_and_intake()
            receipts = self._read_receipts(manifest)
            prepared = manifest.get("prepared_protocol") is not None
            if not receipts:
                graph = self._stage_graph(
                    prepared=prepared,
                    begun=False,
                    protocol_stage=None,
                    line_count=(
                        len(self._prepared_spec(manifest).get("line_order", []))
                        if prepared
                        else None
                    ),
                )
                current: dict[str, Any] = {
                    "schema_version": "pipeline-walkthrough-current.v1",
                    "session_id": manifest["session_id"],
                    "session_manifest_sha256": manifest["session_manifest_sha256"],
                    "source": intake["source"],
                    "stage": "source_intake",
                    "status": "ready" if prepared else "blocked",
                    "provenance_status": "live_same_run",
                    "revision": 0,
                    "legal_actions": ["begin_prepared_protocol"] if prepared else [],
                    "blocker": None if prepared else _source_blocker(),
                    "agent_turn": None,
                    "tool_action_contract": {
                        "tool": "apply_source_action",
                        "envelope_schema_version": SOURCE_ACTION_SCHEMA_VERSION,
                        "required_envelope_fields": [
                            "schema_version",
                            "current_sha256",
                            "action",
                        ],
                        "legal_action_types": (
                            ["begin_prepared_protocol"] if prepared else []
                        ),
                    },
                    "stage_graph": graph,
                    "latest_transition": None,
                }
                current["current_sha256"] = _canonical_hash(current)
                return current

            latest = receipts[-1]
            try:
                state = protocol_v3.load_state_v3(self._state_path)
            except protocol_v3.ProtocolV3Error as error:
                raise WalkthroughError("session_integrity_error", str(error)) from error
            result = latest.get("result")
            if (
                not isinstance(result, dict)
                or result.get("state_sha256") != state.get("state_sha256")
                or result.get("state_revision") != state.get("state_revision")
                or result.get("protocol_stage") != state.get("current_stage")
                or result.get("state_file_sha256") != _sha256_file(self._state_path)
            ):
                raise WalkthroughError("session_integrity_error", "Latest transition/state binding drift")
            line_count = len(state["lines"])
            line_index = int(state["current_line_index"])
            current_line_id = (
                None
                if state["current_stage"] == protocol_v3.COMPLETE
                else state["lines"][line_index]["line_id"]
            )
            graph = self._stage_graph(
                prepared=True,
                begun=True,
                protocol_stage=state["current_stage"],
                current_line_id=current_line_id,
                current_line_index=line_index,
                line_count=line_count,
            )
            if state["current_stage"] == protocol_v3.COMPLETE:
                current = {
                    "schema_version": "pipeline-walkthrough-current.v1",
                    "session_id": manifest["session_id"],
                    "session_manifest_sha256": manifest["session_manifest_sha256"],
                    "source": intake["source"],
                    "stage": "ownership_knockout",
                    "status": "blocked",
                    "provenance_status": "available_not_started",
                    "revision": state["state_revision"],
                    "legal_actions": [],
                    "blocker": {
                        "code": "missing_walkthrough_downstream_orchestration",
                        "status": "blocked_missing_transition",
                        "message": "v3 is complete, but this core does not splice in downstream runs.",
                    },
                    "agent_turn": None,
                    "tool_action_contract": None,
                    "stage_graph": graph,
                    "latest_transition": _commit_receipt_view(latest),
                }
                current["current_sha256"] = _canonical_hash(current)
                return current

            turn_path = result.get("agent_turn_path")
            if not isinstance(turn_path, str):
                raise WalkthroughError("session_integrity_error", "Live state has no agent turn")
            turn = self._load_and_verify_agent_turn(turn_path)
            protocol_meta = turn["protocol"]
            if (
                turn.get("session_id") != manifest["session_id"]
                or turn.get("session_manifest_sha256")
                != manifest["session_manifest_sha256"]
                or turn.get("agent_turn_sha256")
                != result.get("agent_turn_sha256")
                or turn["public_packet"].get("packet_sha256")
                != result.get("packet_sha256")
                or turn["public_packet"].get("file_sha256")
                != result.get("packet_file_sha256")
                or
                protocol_meta.get("state_revision") != state.get("state_revision")
                or protocol_meta.get("state_sha256") != state.get("state_sha256")
                or protocol_meta.get("stage") != state.get("current_stage")
                or protocol_meta.get("state_file_sha256")
                != result.get("state_file_sha256")
            ):
                raise WalkthroughError("session_integrity_error", "Agent-turn/state binding drift")
            current = {
                "schema_version": "pipeline-walkthrough-current.v1",
                "session_id": manifest["session_id"],
                "session_manifest_sha256": manifest["session_manifest_sha256"],
                "source": intake["source"],
                "stage": state["current_stage"],
                "status": "current",
                "provenance_status": "live_same_run",
                "revision": state["state_revision"],
                "legal_actions": turn["public_packet"]["json"]["legal_actions"],
                "blocker": None,
                "agent_turn": turn,
                "tool_action_contract": turn["tool_action_contract"],
                "stage_graph": graph,
                "latest_transition": _commit_receipt_view(latest),
            }
            current["current_sha256"] = _canonical_hash(current)
            return current

    def apply_source_action(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        """Apply the explicit prepared-protocol start action, or fail closed."""

        with session_write_lock(self.root):
            return self._apply_source_action_locked(envelope)

    def _apply_source_action_locked(
        self, envelope: Mapping[str, Any]
    ) -> dict[str, Any]:
        with self._lock:
            action_envelope = _normal_json_object(envelope, "source action envelope")
            _strict_keys(
                action_envelope,
                {"schema_version", "current_sha256", "action"},
                "source action envelope",
            )
            if action_envelope["schema_version"] != SOURCE_ACTION_SCHEMA_VERSION:
                raise WalkthroughError("invalid_action_envelope", "Wrong source action schema")
            current = self.current()
            if action_envelope["current_sha256"] != current["current_sha256"]:
                raise WalkthroughError("stale_current", "Source action is not bound to current state")
            action = action_envelope.get("action")
            if not isinstance(action, dict) or set(action) != {"type"}:
                raise WalkthroughError("invalid_action_envelope", "Source action must contain only type")
            if action.get("type") != "begin_prepared_protocol":
                raise WalkthroughError("illegal_action", "Illegal source action")
            if current["stage"] != "source_intake":
                raise WalkthroughError("illegal_stage", "Prepared protocol has already begun")
            manifest, intake = self._load_manifest_and_intake()
            receipts = self._read_receipts(manifest)
            spec = self._prepared_spec(manifest)
            if spec is None:
                raise WalkthroughError(
                    "missing_source_preparation",
                    "An unprepared source cannot enter visible-span inventory",
                )
            if self._workflow_root.exists() or self._workflow_root.is_symlink():
                raise WalkthroughError("refusing_overwrite", "Protocol workflow already exists")
            turns_before = self._child_names(self.root / "agent-turns")
            committed = False
            commit_receipt: dict[str, Any] | None = None
            try:
                try:
                    initialized = protocol_v3.initialize_workflow_v3(spec, self._workflow_root)
                except protocol_v3.ProtocolV3Error as error:
                    raise WalkthroughError(
                        "prepared_protocol_initialization_failed", str(error)
                    ) from error
                turn = self._snapshot_agent_turn(
                    manifest=manifest,
                    state=initialized["state"],
                    packet_path=initialized["packet_path"],
                )
                turn_path = f"agent-turns/{initialized['state']['state_revision']:06d}-{_safe_id(initialized['state']['lines'][0]['line_id'])}-{_safe_id(initialized['state']['current_stage'])}/agent-turn.json"
                commit_receipt = self._append_receipt(
                    manifest,
                    receipts,
                    {
                        "transition_kind": "source_action",
                        "base_current_sha256": current["current_sha256"],
                        "base_agent_turn_sha256": None,
                        "base_protocol_stage": current["stage"],
                        "base_state_revision": current["revision"],
                        "base_item_label": intake["page_id"],
                        "action_envelope_sha256": _canonical_hash(action_envelope),
                        "action": action,
                        "result": {
                            "status": "accepted",
                            "protocol_stage": initialized["state"]["current_stage"],
                            "state_revision": initialized["state"]["state_revision"],
                            "state_sha256": initialized["state"]["state_sha256"],
                            "state_file_sha256": _sha256_file(initialized["state_path"]),
                            "packet_sha256": turn["public_packet"]["packet_sha256"],
                            "packet_file_sha256": turn["public_packet"]["file_sha256"],
                            "agent_turn_path": turn_path,
                            "agent_turn_sha256": turn["agent_turn_sha256"],
                        },
                    },
                )
                committed = True
            finally:
                if not committed:
                    if self._workflow_root.exists() and not self._workflow_root.is_symlink():
                        shutil.rmtree(self._workflow_root)
                    self._remove_new_children(self.root / "agent-turns", turns_before)
            try:
                return self.current()
            except BaseException as error:
                if commit_receipt is None:  # pragma: no cover - guarded by commit flag
                    raise
                raise WalkthroughError(
                    "action_committed_refresh_failed",
                    "The action committed, but its successor could not be refreshed",
                    details={"action_commit": _commit_receipt_view(commit_receipt)},
                    committed=True,
                ) from error

    def apply_v3_decision(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        """Validate and apply one exact current v3 decision, then snapshot its successor."""

        with session_write_lock(self.root):
            return self._apply_v3_decision_locked(envelope)

    def _apply_v3_decision_locked(
        self, envelope: Mapping[str, Any]
    ) -> dict[str, Any]:
        with self._lock:
            decision_envelope = _normal_json_object(envelope, "v3 decision envelope")
            _strict_keys(
                decision_envelope,
                {"schema_version", "current_sha256", "agent_turn_sha256", "decision"},
                "v3 decision envelope",
            )
            if decision_envelope["schema_version"] != V3_DECISION_ENVELOPE_SCHEMA_VERSION:
                raise WalkthroughError("invalid_action_envelope", "Wrong v3 decision envelope schema")
            current = self.current()
            if decision_envelope["current_sha256"] != current["current_sha256"]:
                raise WalkthroughError("stale_current", "Decision is not bound to current state")
            turn = current.get("agent_turn")
            if not isinstance(turn, dict):
                raise WalkthroughError("illegal_stage", "There is no live v3 agent turn")
            if decision_envelope["agent_turn_sha256"] != turn["agent_turn_sha256"]:
                raise WalkthroughError("stale_agent_turn", "Decision is not bound to current agent turn")
            decision = decision_envelope.get("decision")
            if not isinstance(decision, dict):
                raise WalkthroughError("invalid_action_envelope", "decision must be a JSON object")
            manifest, _ = self._load_manifest_and_intake()
            receipts = self._read_receipts(manifest)
            packet_path = _contained_file(
                self._workflow_root,
                turn["public_packet"]["protocol_source_path"],
                "current public packet",
            )
            revision = current["revision"]
            stage = current["stage"]
            line_id = turn["protocol"]["line_id"]
            decision_name = f"{revision:06d}-{_safe_id(line_id)}-{_safe_id(stage)}.json"
            transaction_dir = Path(tempfile.mkdtemp(prefix=".decision-", dir=self.root))
            decision_bytes = _json_bytes(decision)
            temporary_decision = transaction_dir / "decision.json"
            accepted_path = self.root / "decisions" / decision_name
            state_before = self._state_path.read_bytes()
            public_before = self._child_names(self._workflow_root / "public")
            turns_before = self._child_names(self.root / "agent-turns")
            accepted_created = False
            committed = False
            commit_receipt: dict[str, Any] | None = None
            try:
                _write_bytes_exclusive(temporary_decision, decision_bytes)
                try:
                    # Preflight has no writes; the imported apply function validates
                    # again immediately before its one mutable state transition.
                    protocol_v3.validate_decision_files_v3(
                        self._state_path, packet_path, temporary_decision
                    )
                    applied = protocol_v3.apply_decision_files_v3(
                        self._state_path,
                        packet_path,
                        temporary_decision,
                        self._workflow_root,
                    )
                except protocol_v3.ProtocolV3Error as error:
                    raise WalkthroughError("invalid_v3_decision", str(error)) from error
                _write_bytes_exclusive(accepted_path, decision_bytes)
                accepted_created = True

                next_turn: dict[str, Any] | None = None
                next_turn_path: str | None = None
                if applied["next_packet_path"] is not None:
                    next_turn = self._snapshot_agent_turn(
                        manifest=manifest,
                        state=applied["state"],
                        packet_path=applied["next_packet_path"],
                    )
                    next_packet = next_turn["public_packet"]["json"]
                    next_turn_path = (
                        f"agent-turns/{applied['state']['state_revision']:06d}-"
                        f"{_safe_id(next_packet['current']['line_id'])}-"
                        f"{_safe_id(applied['state']['current_stage'])}/agent-turn.json"
                    )
                commit_receipt = self._append_receipt(
                    manifest,
                    receipts,
                    {
                        "transition_kind": "v3_decision",
                        "base_current_sha256": current["current_sha256"],
                        "base_agent_turn_sha256": turn["agent_turn_sha256"],
                        "base_protocol_stage": current["stage"],
                        "base_state_revision": current["revision"],
                        "base_item_label": turn["protocol"]["line_id"],
                        "decision_envelope_sha256": _canonical_hash(decision_envelope),
                        "decision": {
                            "path": str(accepted_path.relative_to(self.root)),
                            "file_sha256": _sha256_bytes(decision_bytes),
                            "canonical_sha256": _canonical_hash(decision),
                            "action_type": decision.get("action", {}).get("type"),
                        },
                        "validation": applied["validation"],
                        "result": {
                            "status": "accepted",
                            "protocol_stage": applied["state"]["current_stage"],
                            "state_revision": applied["state"]["state_revision"],
                            "state_sha256": applied["state"]["state_sha256"],
                            "state_file_sha256": _sha256_file(self._state_path),
                            "agent_turn_path": next_turn_path,
                            "agent_turn_sha256": (
                                next_turn["agent_turn_sha256"]
                                if next_turn is not None
                                else None
                            ),
                            "packet_sha256": (
                                next_turn["public_packet"]["packet_sha256"]
                                if next_turn is not None
                                else None
                            ),
                            "packet_file_sha256": (
                                next_turn["public_packet"]["file_sha256"]
                                if next_turn is not None
                                else None
                            ),
                        },
                    },
                )
                committed = True
            finally:
                shutil.rmtree(transaction_dir, ignore_errors=True)
                if not committed:
                    _replace_bytes_atomic(self._state_path, state_before)
                    self._remove_new_children(self._workflow_root / "public", public_before)
                    self._remove_new_children(self.root / "agent-turns", turns_before)
                    if accepted_created:
                        accepted_path.unlink(missing_ok=True)
            try:
                return self.current()
            except BaseException as error:
                if commit_receipt is None:  # pragma: no cover - guarded by commit flag
                    raise
                raise WalkthroughError(
                    "action_committed_refresh_failed",
                    "The action committed, but its successor could not be refreshed",
                    details={"action_commit": _commit_receipt_view(commit_receipt)},
                    committed=True,
                ) from error


def create_session(
    session_dir: Path | str, source_descriptor: Mapping[str, Any]
) -> PipelineWalkthroughSession:
    """Create and return a new isolated walkthrough session."""

    return PipelineWalkthroughSession.create(session_dir, source_descriptor)


def open_session(session_dir: Path | str) -> PipelineWalkthroughSession:
    """Open and integrity-check an existing walkthrough session."""

    return PipelineWalkthroughSession.open(session_dir)


__all__ = [
    "AGENT_TURN_SCHEMA_VERSION",
    "MISSING_SOURCE_PREPARATION_CAPABILITIES",
    "PREPARED_PAGE_ID",
    "PREPARED_PROTOCOL_KIND",
    "PipelineWalkthroughSession",
    "SESSION_WRITE_LOCK_FILENAME",
    "SESSION_SCHEMA_VERSION",
    "SOURCE_ACTION_SCHEMA_VERSION",
    "SOURCE_DESCRIPTOR_SCHEMA_VERSION",
    "V3_DECISION_ENVELOPE_SCHEMA_VERSION",
    "WalkthroughError",
    "create_session",
    "open_session",
    "session_write_lock",
]
