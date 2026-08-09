#!/usr/bin/env python3
"""Validate the acting-safe, cloud-portable handwriting seed bundle."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = REPO_ROOT / "docs/research/handwriting-pipeline/CLOUD-SEED-MANIFEST.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate(path_text: str, expected: str, label: str) -> dict[str, object]:
    path = REPO_ROOT / path_text
    actual = sha256_file(path) if path.is_file() else None
    return {
        "label": label,
        "path": path_text,
        "exists": path.is_file(),
        "expected_sha256": expected,
        "actual_sha256": actual,
        "matches": actual == expected,
    }


def main() -> None:
    record = json.loads(MANIFEST.read_text())
    checks: list[dict[str, object]] = []
    for source in record["acting_safe_sources"]:
        checks.append(validate(source["path"], source["file_sha256"], source["page_id"]))
    for item in record["current_page_012_records"]:
        expected = item.get("record_sha256")
        if expected:
            checks.append(validate(item["path"], expected, item["record_id"]))
        primary = item.get("primary_file")
        if primary:
            checks.append(
                validate(primary, item["primary_file_sha256"], f"{item['record_id']}:primary")
            )
    failures = [check for check in checks if not check["matches"]]
    result = {
        "schema_version": "handwriting-cloud-seed-validation.v1",
        "manifest": str(MANIFEST.relative_to(REPO_ROOT)),
        "manifest_sha256": sha256_file(MANIFEST),
        "sealed_human_evidence_opened": False,
        "check_count": len(checks),
        "failure_count": len(failures),
        "passed": not failures,
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
