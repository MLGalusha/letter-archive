"""Deterministic structural checks for acting-agent packet directories."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .io_utils import canonical_json_bytes, sha256_file


BLOCKED_MARKERS = (
    "human-ground-truth",
    "source-color-selector-v2",
    "archived-evaluation",
    "sealed-component",
    "sealed-recovery",
    "hidden-target",
    "neighbor-truth",
    "target-mask",
    "human_pixel_sha256",
    "evaluation_human_word_number",
    "foreign_human_word_pixels",
    '"evaluation":',
)

TEXT_SUFFIXES = {".json", ".md", ".txt", ".yaml", ".yml"}


def _find_run_root(packet_dir: Path) -> Path:
    for parent in (packet_dir, *packet_dir.parents):
        if (parent / "run-manifest.json").is_file():
            return parent
    raise ValueError("Could not find run-manifest.json above packet directory")


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_packet_dir(
    packet_dir: Path,
    *,
    run_root: Path | None = None,
) -> dict[str, Any]:
    """Validate isolation, referenced evidence hashes, and blocked markers."""

    packet_dir = packet_dir.resolve()
    run_root = (run_root.resolve() if run_root is not None else _find_run_root(packet_dir))
    violations: list[dict[str, Any]] = []
    if not packet_dir.is_dir():
        raise ValueError("Packet directory does not exist")
    if not _inside(packet_dir, run_root):
        violations.append({"kind": "packet_outside_run_root", "path": str(packet_dir)})

    files: list[dict[str, Any]] = []
    for path in sorted(packet_dir.rglob("*")):
        if not path.is_file() and not path.is_symlink():
            continue
        resolved = path.resolve()
        relative = str(path.relative_to(packet_dir))
        if path.is_symlink() and not _inside(resolved, run_root):
            violations.append({"kind": "symlink_escapes_run_root", "path": relative, "target": str(resolved)})
            continue
        if not resolved.is_file():
            violations.append({"kind": "missing_file", "path": relative})
            continue
        digest = sha256_file(resolved)
        files.append({"path": relative, "file_sha256": digest, "bytes": resolved.stat().st_size})
        haystacks = [relative.lower()]
        if path.suffix.lower() in TEXT_SUFFIXES:
            haystacks.append(path.read_text(encoding="utf-8", errors="replace").lower())
        for marker in BLOCKED_MARKERS:
            if any(marker in value for value in haystacks):
                violations.append({"kind": "blocked_marker", "path": relative, "marker": marker})

    packet_path = packet_dir / "work-packet.json"
    if not packet_path.is_file():
        violations.append({"kind": "missing_work_packet", "path": "work-packet.json"})
    else:
        try:
            packet = json.loads(packet_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            violations.append({"kind": "invalid_work_packet_json", "error": str(error)})
        else:
            evidence = packet.get("evidence")
            if not isinstance(evidence, dict):
                violations.append({"kind": "missing_evidence_map"})
            else:
                for evidence_id, binding in sorted(evidence.items()):
                    if not isinstance(binding, dict):
                        continue
                    raw_path = binding.get("path")
                    expected_sha = binding.get("file_sha256")
                    if not isinstance(raw_path, str) or not isinstance(expected_sha, str):
                        violations.append({"kind": "incomplete_evidence_binding", "evidence_id": evidence_id})
                        continue
                    resolved = (run_root / raw_path).resolve()
                    if not _inside(resolved, run_root):
                        violations.append({"kind": "evidence_path_escapes_run_root", "evidence_id": evidence_id, "path": raw_path})
                    elif not resolved.is_file():
                        violations.append({"kind": "missing_evidence_file", "evidence_id": evidence_id, "path": raw_path})
                    else:
                        actual_sha = sha256_file(resolved)
                        if actual_sha != expected_sha:
                            violations.append({"kind": "evidence_hash_mismatch", "evidence_id": evidence_id, "path": raw_path, "expected": expected_sha, "actual": actual_sha})

    record: dict[str, Any] = {
        "schema_version": "acting-packet-boundary-validation.v1",
        "packet_dir": str(packet_dir),
        "run_root": str(run_root),
        "blocked_markers": list(BLOCKED_MARKERS),
        "files": files,
        "violation_count": len(violations),
        "violations": violations,
        "passed": not violations,
    }
    record["validation_sha256"] = hashlib.sha256(canonical_json_bytes(record)).hexdigest()
    return record
