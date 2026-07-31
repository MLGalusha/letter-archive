from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .paths import COHORT_PATH, SMOKE_CONFIG_PATH, STORAGE_ROOT
from .util import BenchmarkError, SHA256_RE, read_json, sha256_file


PAGE_KEY_RE = re.compile(
    r"^(?P<collection>\d{3})-(?P<date>[0-9X]{8})-(?P<type>[A-Z])"
    r"(?P<sequence>\d{2})-(?P<page>\d{2})$"
)


@dataclass(frozen=True)
class CohortPage:
    page_key: str
    collection_code: str
    date_raw: str
    document_type: str
    type_sequence: int
    page_number: int
    original_filename: str
    checksum_sha256: str
    width: int
    height: int
    challenge_tags: tuple[str, ...]
    source_path: Path


@dataclass(frozen=True)
class LoadedCohort:
    cohort_id: str
    path: Path
    sha256: str
    pages: tuple[CohortPage, ...]
    raw: dict[str, Any]


def canonical_page_key(original_filename: str, page_number: int) -> str:
    stem = Path(original_filename).stem
    if PAGE_KEY_RE.fullmatch(stem):
        return stem
    legacy = re.fullmatch(
        r"(?P<prefix>\d{3}-[0-9X]{8}-[A-Z]\d{2})", stem
    )
    if legacy:
        return f"{legacy.group('prefix')}-{page_number:02d}"
    raise BenchmarkError(
        "cohort",
        "INVALID_FILENAME",
        f"Cannot derive a canonical page key from {original_filename}",
    )


def load_cohort(path: Path = COHORT_PATH) -> LoadedCohort:
    raw = read_json(path)
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
        raise BenchmarkError(
            "cohort", "UNSUPPORTED_SCHEMA", "Cohort schemaVersion must be 1"
        )
    cohort_id = raw.get("cohortId")
    letters = raw.get("letters")
    if not isinstance(cohort_id, str) or not isinstance(letters, list):
        raise BenchmarkError(
            "cohort", "INVALID_COHORT", "Cohort ID and letters are required"
        )

    pages: list[CohortPage] = []
    seen: set[str] = set()
    for letter in letters:
        identity = letter.get("identity", {})
        collection = identity.get("collectionCode")
        date_raw = identity.get("dateRaw")
        document_type = identity.get("type")
        sequence = identity.get("typeSequence")
        if (
            not isinstance(collection, str)
            or not isinstance(date_raw, str)
            or not isinstance(document_type, str)
            or not isinstance(sequence, int)
        ):
            raise BenchmarkError(
                "cohort", "INVALID_IDENTITY", "Every letter identity must be complete"
            )
        folder = f"{document_type}{sequence:02d}"
        for page in letter.get("pages", []):
            page_number = page.get("pageNumber")
            filename = page.get("originalFilename")
            checksum = page.get("checksumSha256")
            width = page.get("width")
            height = page.get("height")
            tags = page.get("challengeTags", [])
            if (
                not isinstance(page_number, int)
                or not isinstance(filename, str)
                or not isinstance(checksum, str)
                or not SHA256_RE.fullmatch(checksum)
                or not isinstance(width, int)
                or width <= 0
                or not isinstance(height, int)
                or height <= 0
                or not isinstance(tags, list)
                or not all(isinstance(tag, str) for tag in tags)
            ):
                raise BenchmarkError(
                    "cohort",
                    "INVALID_PAGE",
                    f"Invalid cohort page under {collection}-{date_raw}-{folder}",
                )
            page_key = canonical_page_key(filename, page_number)
            expected_key = (
                f"{collection}-{date_raw}-{document_type}{sequence:02d}"
                f"-{page_number:02d}"
            )
            if page_key != expected_key:
                raise BenchmarkError(
                    "cohort",
                    "PAGE_IDENTITY_MISMATCH",
                    f"{filename} resolves to {page_key}, expected {expected_key}",
                )
            if page_key in seen:
                raise BenchmarkError(
                    "cohort", "DUPLICATE_PAGE", f"Duplicate page key {page_key}"
                )
            seen.add(page_key)
            source_path = (
                STORAGE_ROOT / collection / date_raw / folder / filename
            )
            pages.append(
                CohortPage(
                    page_key=page_key,
                    collection_code=collection,
                    date_raw=date_raw,
                    document_type=document_type,
                    type_sequence=sequence,
                    page_number=page_number,
                    original_filename=filename,
                    checksum_sha256=checksum,
                    width=width,
                    height=height,
                    challenge_tags=tuple(tags),
                    source_path=source_path,
                )
            )
    if not pages:
        raise BenchmarkError("cohort", "EMPTY_COHORT", "Cohort contains no pages")
    return LoadedCohort(
        cohort_id=cohort_id,
        path=path,
        sha256=sha256_file(path),
        pages=tuple(pages),
        raw=raw,
    )


def select_pages(
    cohort: LoadedCohort,
    scope: str,
    explicit_page_keys: Iterable[str] = (),
) -> tuple[tuple[CohortPage, ...], str]:
    by_key = {page.page_key: page for page in cohort.pages}
    explicit = tuple(dict.fromkeys(explicit_page_keys))
    if explicit:
        missing = [page_key for page_key in explicit if page_key not in by_key]
        if missing:
            raise BenchmarkError(
                "selection",
                "UNKNOWN_PAGE",
                "Explicit page keys are not in the cohort",
                {"pageKeys": missing},
            )
        allowed: set[str] | None = None
        resolved_scope = "explicit"
        if scope == "smoke":
            allowed = set(smoke_page_keys())
        elif scope != "full":
            raise BenchmarkError(
                "selection", "INVALID_SCOPE", f"Unknown scope {scope}"
            )
        selected_keys = [
            page_key
            for page_key in explicit
            if allowed is None or page_key in allowed
        ]
        if not selected_keys:
            raise BenchmarkError(
                "selection",
                "EMPTY_SELECTION",
                "Explicit pages do not intersect the requested scope",
            )
        return tuple(by_key[key] for key in selected_keys), resolved_scope

    if scope == "full":
        return cohort.pages, "full"
    if scope != "smoke":
        raise BenchmarkError("selection", "INVALID_SCOPE", f"Unknown scope {scope}")
    keys = smoke_page_keys()
    missing = [page_key for page_key in keys if page_key not in by_key]
    if missing:
        raise BenchmarkError(
            "selection",
            "INVALID_SMOKE_CONFIG",
            "Smoke pages are not in the cohort",
            {"pageKeys": missing},
        )
    return tuple(by_key[key] for key in keys), "smoke"


def smoke_page_keys() -> tuple[str, ...]:
    raw = read_json(SMOKE_CONFIG_PATH)
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
        raise BenchmarkError(
            "selection",
            "INVALID_SMOKE_CONFIG",
            "Smoke config schemaVersion must be 1",
        )
    pages = raw.get("pages")
    if not isinstance(pages, list):
        raise BenchmarkError(
            "selection", "INVALID_SMOKE_CONFIG", "Smoke pages must be an array"
        )
    keys: list[str] = []
    for entry in pages:
        if not isinstance(entry, dict) or not isinstance(entry.get("pageKey"), str):
            raise BenchmarkError(
                "selection",
                "INVALID_SMOKE_CONFIG",
                "Every smoke entry must have a pageKey",
            )
        keys.append(entry["pageKey"])
    if len(keys) != len(set(keys)):
        raise BenchmarkError(
            "selection", "INVALID_SMOKE_CONFIG", "Smoke page keys must be unique"
        )
    return tuple(keys)
