#!/usr/bin/env python3
"""Validate the machine-readable handwriting research artifact registry."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


EVIDENCE_ROLES = {
    "navigation",
    "invalid",
    "post_freeze_mixed",
    "run_state",
    "boundary_receipt",
}
DECISIONS = {
    "index",
    "diagnostic",
    "invalid",
    "promoted_suggestion",
    "rejected",
    "candidate_heldout",
    "blocked",
}
ACTING_VISIBILITY = {"safe", "mixed_do_not_expose", "not_applicable"}
LOCAL_WORKSPACE_PREFIXES = (
    Path("/Users/masongalusha/Workspace/projects/letter-archive"),
    Path("/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc"),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(path: Path, workspace_root: Path) -> tuple[Path, bool]:
    if path.exists():
        return path, False
    for prefix in LOCAL_WORKSPACE_PREFIXES:
        try:
            relative = path.relative_to(prefix)
        except ValueError:
            continue
        relocated = workspace_root / relative
        if relocated.exists():
            return relocated, True
    return path, False


def record_ids_sha256(record_ids: list[str]) -> str:
    return hashlib.sha256(("\n".join(record_ids) + "\n").encode("utf-8")).hexdigest()


def validate(
    path: Path,
    workspace_root: Path,
    portable_seed_manifest: Path | None = None,
) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    violations: list[dict[str, Any]] = []
    entries = registry.get("entries")
    if not isinstance(entries, list):
        raise ValueError("Registry entries must be a list")
    ids = [entry.get("record_id") for entry in entries]
    if len(ids) != len(set(ids)):
        violations.append({"kind": "duplicate_record_id"})
    portable_baseline_count = 0
    portable_baseline_hash = None
    if portable_seed_manifest is not None:
        portable = json.loads(portable_seed_manifest.read_text(encoding="utf-8"))[
            "portable_registry_baseline"
        ]
        portable_baseline_count = int(portable["entry_count"])
        portable_baseline_hash = portable["record_ids_newline_sha256"]
        actual_prefix_hash = record_ids_sha256(ids[:portable_baseline_count])
        if len(ids) < portable_baseline_count or actual_prefix_hash != portable_baseline_hash:
            violations.append(
                {
                    "kind": "portable_registry_baseline_mismatch",
                    "expected_entry_count": portable_baseline_count,
                    "actual_entry_count": len(ids),
                    "expected_prefix_record_ids_sha256": portable_baseline_hash,
                    "actual_prefix_record_ids_sha256": actual_prefix_hash,
                }
            )
    known = set(ids)
    verified: list[dict[str, Any]] = []
    for entry_index, entry in enumerate(entries):
        record_id = entry.get("record_id")
        portable_omission_allowed = entry_index < portable_baseline_count
        if entry.get("evidence_role") not in EVIDENCE_ROLES:
            violations.append({"kind": "invalid_evidence_role", "record_id": record_id})
        if entry.get("decision") not in DECISIONS:
            violations.append({"kind": "invalid_decision", "record_id": record_id})
        if entry.get("acting_visibility") not in ACTING_VISIBILITY:
            violations.append({"kind": "invalid_acting_visibility", "record_id": record_id})
        recorded_root = Path(entry.get("output_root", ""))
        root, root_relocated = resolve_path(recorded_root, workspace_root)
        if not root.is_dir() and not portable_omission_allowed:
            violations.append({"kind": "missing_output_root", "record_id": record_id, "path": str(recorded_root), "resolved_path": str(root)})
        primary = entry.get("primary_record", {})
        recorded_primary_path = Path(primary.get("path", ""))
        primary_path, primary_relocated = resolve_path(recorded_primary_path, workspace_root)
        expected = primary.get("file_sha256")
        actual = sha256_file(primary_path) if primary_path.is_file() else None
        if actual is None and not portable_omission_allowed:
            violations.append({"kind": "missing_primary_record", "record_id": record_id, "path": str(recorded_primary_path), "resolved_path": str(primary_path)})
        elif actual != expected:
            violations.append({"kind": "primary_record_hash_mismatch", "record_id": record_id, "path": str(primary_path), "expected": expected, "actual": actual})
        missing_predecessors = sorted(set(entry.get("predecessor_ids", [])) - known)
        if missing_predecessors:
            violations.append({"kind": "missing_predecessor", "record_id": record_id, "predecessor_ids": missing_predecessors})
        verified.append({"record_id": record_id, "entry_index": entry_index, "portable_omission_allowed": portable_omission_allowed, "output_root_exists": root.is_dir(), "primary_record_exists": actual is not None, "primary_record_hash_matches": actual == expected if actual is not None else None, "root_relocated": root_relocated, "primary_record_relocated": primary_relocated})
    result = {
        "schema_version": "handwriting-research-artifact-registry-validation.v1",
        "registry_path": str(path.resolve()),
        "registry_file_sha256": sha256_file(path),
        "workspace_root": str(workspace_root.resolve()),
        "portable_seed_manifest": str(portable_seed_manifest.resolve()) if portable_seed_manifest else None,
        "portable_baseline_entry_count": portable_baseline_count,
        "portable_baseline_record_ids_sha256": portable_baseline_hash,
        "entry_count": len(entries),
        "verified": verified,
        "violation_count": len(violations),
        "violations": violations,
        "passed": not violations,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("registry", type=Path, nargs="?", default=Path(__file__).with_name("ARTIFACT-REGISTRY.json"))
    parser.add_argument(
        "--workspace-root",
        type=Path,
        default=Path(os.environ.get("LETTER_ARCHIVE_REPO_ROOT", Path(__file__).resolve().parents[3])),
        help="Combined checkout root used to relocate recorded local-worktree paths in cloud clones.",
    )
    parser.add_argument(
        "--portable-seed-manifest",
        type=Path,
        help=(
            "Allow intentionally absent primary artifacts only for the frozen, "
            "append-only registry prefix declared by this cloud seed manifest."
        ),
    )
    args = parser.parse_args()
    result = validate(args.registry, args.workspace_root, args.portable_seed_manifest)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
