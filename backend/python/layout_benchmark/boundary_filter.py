from __future__ import annotations

import copy
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .paths import BACKEND_ROOT, RUNS_ROOT, backend_relative
from .preparation import (
    RASTER_FINGERPRINT_ALGORITHM,
    fingerprint_prepared_png,
)
from .util import (
    BenchmarkError,
    canonical_json_bytes,
    ensure_safe_id,
    read_json,
    run_capture,
    sha256_file,
)


RAW_SCHEMA_VERSION = 1
RAW_KIND = "BoundaryFilterCompositionEvidence"
GEOMETRY_PROVIDER = "pure-python-sampled-path"


@dataclass(frozen=True)
class SourceBinding:
    key: str
    role: str
    run_id: str
    expected_engine_id: str
    expected_manifest_sha256: str
    run_directory: Path
    manifest_path: Path
    manifest: dict[str, Any]


@dataclass(frozen=True)
class SourceContext:
    line_geometry: SourceBinding
    page_boundary: SourceBinding
    cohort_sha256: str
    preprocessing_sha256: str
    selected_page_keys: tuple[str, ...]


def external_snapshot_paths(
    config: dict[str, Any],
    *,
    runs_root: Path = RUNS_ROOT,
) -> tuple[Path, ...]:
    """Return immutable external evidence that must be frozen into a new run."""
    bindings = _load_bindings(config, runs_root=runs_root)
    paths: set[Path] = set()
    for binding in bindings:
        paths.add(binding.manifest_path)
        for page in binding.manifest.get("pages", []):
            if not isinstance(page, dict):
                continue
            artifacts = page.get("artifacts")
            if not isinstance(artifacts, dict):
                continue
            reference = artifacts.get("normalized") or artifacts.get("error")
            if isinstance(reference, str):
                paths.add(
                    _resolve_source_artifact(
                        binding,
                        reference,
                        verify_integrity=True,
                    )
                )
    return tuple(sorted(paths, key=backend_relative))


def load_source_context(
    config: dict[str, Any],
    *,
    runs_root: Path = RUNS_ROOT,
    validate_authoritatively: bool = True,
) -> SourceContext:
    bindings = {item.key: item for item in _load_bindings(config, runs_root=runs_root)}
    line_geometry = bindings["lineGeometry"]
    page_boundary = bindings["pageBoundary"]

    if validate_authoritatively:
        _validate_with_authoritative_runner(line_geometry)
        _validate_with_authoritative_runner(page_boundary)

    line_manifest = line_geometry.manifest
    boundary_manifest = page_boundary.manifest
    _require_equal(
        line_manifest.get("cohort", {}).get("sha256"),
        boundary_manifest.get("cohort", {}).get("sha256"),
        "SOURCE_COHORT_MISMATCH",
        "Source runs were produced from different cohort manifests",
    )
    _require_equal(
        line_manifest.get("preprocessing", {}).get("profileSha256"),
        boundary_manifest.get("preprocessing", {}).get("profileSha256"),
        "SOURCE_PREPROCESSING_MISMATCH",
        "Source runs were produced with different preprocessing profiles",
    )
    line_keys = _selection_page_keys(line_geometry)
    boundary_keys = _selection_page_keys(page_boundary)
    _require_equal(
        line_keys,
        boundary_keys,
        "SOURCE_SELECTION_MISMATCH",
        "Source runs do not contain the same ordered page selection",
    )

    # Prove decoded-raster identity for every page that can contribute to a
    # composition. A failed page remains a measured derived-page failure.
    for page_key in line_keys:
        line_page = _source_page(line_geometry, page_key)
        boundary_page = _source_page(page_boundary, page_key)
        if (
            line_page.get("status") == "succeeded"
            and boundary_page.get("status") == "succeeded"
        ):
            line_inputs = _verified_page_inputs(
                line_geometry,
                page_key,
                expected_target_path=None,
            )
            boundary_inputs = _verified_page_inputs(
                page_boundary,
                page_key,
                expected_target_path=None,
            )
            _verify_pair_identity(
                line_geometry,
                line_page,
                page_boundary,
                boundary_page,
            )
            if (
                line_inputs["rasterFingerprint"]
                != boundary_inputs["rasterFingerprint"]
            ):
                raise BenchmarkError(
                    "engine-preflight",
                    "SOURCE_PREPARED_RASTER_MISMATCH",
                    (
                        "Configured source runs use different decoded pixels "
                        f"for {page_key}"
                    ),
                )

    return SourceContext(
        line_geometry=line_geometry,
        page_boundary=page_boundary,
        cohort_sha256=str(line_manifest["cohort"]["sha256"]),
        preprocessing_sha256=str(
            line_manifest["preprocessing"]["profileSha256"]
        ),
        selected_page_keys=line_keys,
    )


def source_context_metadata(context: SourceContext) -> dict[str, Any]:
    successful_pairs = 0
    unavailable_pages: list[str] = []
    for page_key in context.selected_page_keys:
        line_page = _source_page(context.line_geometry, page_key)
        boundary_page = _source_page(context.page_boundary, page_key)
        if (
            line_page.get("status") == "succeeded"
            and boundary_page.get("status") == "succeeded"
        ):
            successful_pairs += 1
        else:
            unavailable_pages.append(page_key)
    return {
        "lineGeometry": _binding_metadata(context.line_geometry),
        "pageBoundary": _binding_metadata(context.page_boundary),
        "cohortSha256": context.cohort_sha256,
        "preprocessingProfileSha256": context.preprocessing_sha256,
        "selectedPages": len(context.selected_page_keys),
        "successfulSourcePairs": successful_pairs,
        "unavailablePageKeys": unavailable_pages,
    }


def compose_page_evidence(
    context: SourceContext,
    config: dict[str, Any],
    *,
    page_key: str,
    prepared_path: Path,
) -> dict[str, Any]:
    """Build complete raw evidence without modifying either source layout."""
    ensure_safe_id(page_key, "pageKey")
    if page_key not in context.selected_page_keys:
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_NOT_SELECTED",
            f"{page_key} is not present in both configured source runs",
        )

    line_page = _source_page(context.line_geometry, page_key)
    boundary_page = _source_page(context.page_boundary, page_key)
    for binding, page in (
        (context.line_geometry, line_page),
        (context.page_boundary, boundary_page),
    ):
        if page.get("status") != "succeeded":
            raise BenchmarkError(
                "engine-composition",
                "SOURCE_PAGE_UNAVAILABLE",
                (
                    f"{binding.role} source run {binding.run_id} has no "
                    f"successful layout for {page_key}"
                ),
                {
                    "sourceRunId": binding.run_id,
                    "sourceRole": binding.role,
                    "sourceStatus": page.get("status"),
                    "sourceError": page.get("error"),
                },
            )

    line_inputs = _verified_page_inputs(
        context.line_geometry,
        page_key,
        expected_target_path=prepared_path,
    )
    boundary_inputs = _verified_page_inputs(
        context.page_boundary,
        page_key,
        expected_target_path=prepared_path,
    )
    _verify_pair_identity(
        context.line_geometry,
        line_page,
        context.page_boundary,
        boundary_page,
    )
    if line_inputs["rasterFingerprint"] != boundary_inputs["rasterFingerprint"]:
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PREPARED_RASTER_MISMATCH",
            f"Configured source runs use different decoded pixels for {page_key}",
        )

    target_width = line_inputs["width"]
    target_height = line_inputs["height"]
    target_raster = fingerprint_prepared_png(
        prepared_path,
        expected_width=target_width,
        expected_height=target_height,
    )
    if target_raster != line_inputs["rasterFingerprint"]:
        raise BenchmarkError(
            "engine-composition",
            "TARGET_PREPARED_RASTER_MISMATCH",
            (
                "The newly prepared display raster does not match the exact "
                f"decoded source-run coordinate space for {page_key}"
            ),
            {
                "targetRasterSha256": target_raster,
                "sourceRasterSha256": line_inputs["rasterFingerprint"],
            },
        )

    line_layout = line_inputs["normalizedLayout"]
    boundary_layout = boundary_inputs["normalizedLayout"]
    page_boundary = copy.deepcopy(boundary_layout.get("pageBoundary"))
    boundary_warnings = boundary_layout.get("warnings")
    if isinstance(boundary_warnings, list) and any(
        isinstance(warning, dict)
        and warning.get("code") == "PAGE_BOUNDARY_UNAVAILABLE"
        for warning in boundary_warnings
    ):
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_BOUNDARY_UNAVAILABLE",
            (
                "Eynollah source explicitly marks its physical page boundary "
                f"unavailable for {page_key}; frame fallback is forbidden"
            ),
        )
    if not isinstance(page_boundary, list) or len(page_boundary) < 3:
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_BOUNDARY_UNAVAILABLE",
            f"Eynollah source layout has no usable page boundary for {page_key}",
        )

    parameters = _validated_parameters(config)
    sampling_started = time.perf_counter()
    evidence: list[dict[str, Any]] = []
    included_ids: list[str] = []
    excluded_ids: list[str] = []
    for ordinal, source_line in enumerate(line_layout.get("lines", [])):
        if not isinstance(source_line, dict):
            raise BenchmarkError(
                "engine-composition",
                "SOURCE_LAYOUT_INVALID",
                f"Line layout contains a non-object line for {page_key}",
            )
        decision = line_inclusion_decision(
            source_line,
            page_boundary,
            sample_spacing_pixels=parameters["sampleSpacingPixels"],
            threshold_exclusive=parameters[
                "insideRatioThresholdExclusive"
            ],
        )
        source_line_id = source_line.get("id")
        if not isinstance(source_line_id, str):
            raise BenchmarkError(
                "engine-composition",
                "SOURCE_LAYOUT_INVALID",
                f"Line layout contains a line without an ID for {page_key}",
            )
        if decision["included"]:
            included_ids.append(source_line_id)
        else:
            excluded_ids.append(source_line_id)
        evidence.append(
            {
                "sourceOrdinal": ordinal,
                "sourceLineId": source_line_id,
                "includedInProjection": decision["included"],
                "projectedLineId": (
                    source_line_id if decision["included"] else None
                ),
                "reason": decision["reason"],
                "sampling": decision["sampling"],
                "sourceLine": copy.deepcopy(source_line),
            }
        )
    geometry_ms = round((time.perf_counter() - sampling_started) * 1000, 3)

    return {
        "schemaVersion": RAW_SCHEMA_VERSION,
        "kind": RAW_KIND,
        "engineId": str(config["engineId"]),
        "contract": {
            "enforcement": "adapter-enforced-v2",
            "qualityRankable": False,
            "groundTruth": False,
            "productionPageLayoutV2": False,
            "limitation": (
                "The immutable v2 manifest schema verifies snapshotted bytes "
                "and standard artifacts but does not independently type or "
                "cross-validate derived source roles. This snapshotted adapter "
                "and raw evidence enforce those semantics for this experiment."
            ),
        },
        "policy": {
            "geometryPreference": parameters["geometryPreference"],
            "sampleSpacingPixels": parameters["sampleSpacingPixels"],
            "insideRatioThresholdExclusive": parameters[
                "insideRatioThresholdExclusive"
            ],
            "pointOnBoundaryCountsInside": True,
            "coordinateTransform": "identity",
            "projection": "included-lines-and-owning-regions-only",
        },
        "sourceBindings": {
            "lineGeometry": _page_binding_evidence(
                context.line_geometry,
                line_inputs,
            ),
            "pageBoundary": _page_binding_evidence(
                context.page_boundary,
                boundary_inputs,
            ),
        },
        "targetPrepared": {
            "artifactName": prepared_path.name,
            "encodedSha256": sha256_file(prepared_path),
            "width": target_width,
            "height": target_height,
            "rasterFingerprint": {
                "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                "sha256": target_raster,
            },
            "coordinateSpace": "prepared-pixels-top-left",
            "coordinateTransform": "identity",
        },
        "sourceLayouts": {
            "lineGeometry": copy.deepcopy(line_layout),
            "pageBoundary": copy.deepcopy(boundary_layout),
        },
        "pageBoundary": {
            "points": page_boundary,
            "semantics": "exact-provider-predicted-physical-page-boundary",
            "sourceRunId": context.page_boundary.run_id,
        },
        "lineEvidence": evidence,
        "projection": {
            "includedSourceLineIds": included_ids,
            "excludedSourceLineIds": excluded_ids,
            "includedCount": len(included_ids),
            "excludedCount": len(excluded_ids),
            "totalSourceLineCount": len(evidence),
        },
        "timings": {
            "geometrySamplingMs": geometry_ms,
        },
    }


def normalize_composition_evidence(
    *,
    raw: dict[str, Any],
    engine_id: str,
    run_id: str,
    page_key: str,
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
) -> dict[str, Any]:
    """Create the strict benchmark display projection from complete evidence."""
    if (
        raw.get("schemaVersion") != RAW_SCHEMA_VERSION
        or raw.get("kind") != RAW_KIND
        or raw.get("engineId") != engine_id
    ):
        raise BenchmarkError(
            "normalization",
            "INVALID_COMPOSITION_OUTPUT",
            "Boundary-filter raw evidence has an invalid contract identity",
        )
    target = raw.get("targetPrepared")
    if (
        not isinstance(target, dict)
        or target.get("encodedSha256") != prepared_sha256
        or target.get("width") != width
        or target.get("height") != height
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_COORDINATE_SPACE_MISMATCH",
            "Boundary-filter evidence does not match the prepared output raster",
        )
    raster_fingerprint = target.get("rasterFingerprint")
    if (
        not isinstance(raster_fingerprint, dict)
        or raster_fingerprint.get("algorithm")
        != RASTER_FINGERPRINT_ALGORITHM
        or not isinstance(raster_fingerprint.get("sha256"), str)
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_RASTER_FINGERPRINT_INVALID",
            "Boundary-filter evidence lacks a valid decoded-raster identity",
        )

    source_layouts = raw.get("sourceLayouts")
    evidence = raw.get("lineEvidence")
    projection = raw.get("projection")
    contract = raw.get("contract")
    source_bindings = raw.get("sourceBindings")
    if (
        not isinstance(source_layouts, dict)
        or not isinstance(source_layouts.get("lineGeometry"), dict)
        or not isinstance(source_layouts.get("pageBoundary"), dict)
        or not isinstance(evidence, list)
        or not isinstance(projection, dict)
        or not isinstance(contract, dict)
        or contract.get("enforcement") != "adapter-enforced-v2"
        or contract.get("qualityRankable") is not False
        or contract.get("groundTruth") is not False
        or contract.get("productionPageLayoutV2") is not False
        or not isinstance(source_bindings, dict)
        or not isinstance(source_bindings.get("lineGeometry"), dict)
        or not isinstance(source_bindings.get("pageBoundary"), dict)
    ):
        raise BenchmarkError(
            "normalization",
            "INVALID_COMPOSITION_OUTPUT",
            "Boundary-filter evidence is missing exact source layouts",
        )
    line_layout = source_layouts["lineGeometry"]
    boundary_layout = source_layouts["pageBoundary"]
    for binding_key, source_layout in (
        ("lineGeometry", line_layout),
        ("pageBoundary", boundary_layout),
    ):
        binding = source_bindings[binding_key]
        source_image = source_layout.get("image")
        if (
            source_layout.get("pageKey") != page_key
            or source_layout.get("runId") != binding.get("runId")
            or source_layout.get("engineId") != binding.get("engineId")
            or not isinstance(source_image, dict)
            or source_image.get("width") != width
            or source_image.get("height") != height
            or source_image.get("sourceSha256") != source_sha256
        ):
            raise BenchmarkError(
                "normalization",
                "SOURCE_LAYOUT_IDENTITY_MISMATCH",
                "Exact source layout identity differs from the derived page",
            )

    source_lines = line_layout.get("lines")
    if not isinstance(source_lines, list) or len(source_lines) != len(evidence):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_EVIDENCE_INCOMPLETE",
            "Per-line evidence does not cover every source line",
        )

    included_ids = projection.get("includedSourceLineIds")
    excluded_ids = projection.get("excludedSourceLineIds")
    if not isinstance(included_ids, list) or not isinstance(excluded_ids, list):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_EVIDENCE_INCOMPLETE",
            "Projection line decisions are missing",
        )
    expected_source_ids = [line.get("id") for line in source_lines]
    evidence_source_ids = [item.get("sourceLineId") for item in evidence]
    if (
        evidence_source_ids != expected_source_ids
        or set(included_ids).intersection(excluded_ids)
        or set(included_ids).union(excluded_ids) != set(expected_source_ids)
        or projection.get("includedCount") != len(included_ids)
        or projection.get("excludedCount") != len(excluded_ids)
        or projection.get("totalSourceLineCount") != len(source_lines)
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_EVIDENCE_INCOMPLETE",
            "Projection decisions do not partition the exact source lines",
        )
    evidence_by_id = {
        str(item["sourceLineId"]): item
        for item in evidence
        if isinstance(item, dict)
    }
    included_set = set(str(value) for value in included_ids)
    for source_line, item in zip(source_lines, evidence, strict=True):
        if (
            not isinstance(item, dict)
            or canonical_json_bytes(item.get("sourceLine"))
            != canonical_json_bytes(source_line)
        ):
            raise BenchmarkError(
                "normalization",
                "SOURCE_LINE_EVIDENCE_CHANGED",
                "Raw evidence did not retain an exact source line",
            )
        _validate_line_evidence_item(
            item,
            included=source_line.get("id") in included_set,
        )
    projected_lines: list[dict[str, Any]] = []
    for source_line in source_lines:
        source_line_id = str(source_line["id"])
        if source_line_id not in included_set:
            continue
        item = evidence_by_id[source_line_id]
        projected_line = copy.deepcopy(source_line)
        provenance = projected_line.setdefault("provenance", {})
        attributes = provenance.setdefault("attributes", {})
        attributes["boundaryFilterProjection"] = {
            "sourceRunId": raw["sourceBindings"]["lineGeometry"]["runId"],
            "sourceLineId": source_line_id,
            "includedInProjection": True,
            "reason": item["reason"],
            "sampling": copy.deepcopy(item["sampling"]),
        }
        projected_lines.append(projected_line)

    source_regions = line_layout.get("regions")
    if not isinstance(source_regions, list):
        raise BenchmarkError(
            "normalization",
            "SOURCE_LAYOUT_INVALID",
            "Line source layout has invalid regions",
        )
    projected_regions: list[dict[str, Any]] = []
    retained_region_ids: set[str] = set()
    for source_region in source_regions:
        retained_line_ids = [
            line_id
            for line_id in source_region.get("lineIds", [])
            if line_id in included_set
        ]
        if not retained_line_ids:
            continue
        projected_region = copy.deepcopy(source_region)
        projected_region["lineIds"] = retained_line_ids
        provenance = projected_region.setdefault("provenance", {})
        attributes = provenance.setdefault("attributes", {})
        attributes["boundaryFilterProjection"] = {
            "sourceRunId": raw["sourceBindings"]["lineGeometry"]["runId"],
            "retainedSourceLineIds": retained_line_ids,
        }
        projected_regions.append(projected_region)
        retained_region_ids.add(str(projected_region["id"]))
    for projected_line in projected_lines:
        region_id = projected_line.get("regionId")
        if region_id is not None and region_id not in retained_region_ids:
            raise BenchmarkError(
                "normalization",
                "SOURCE_REGION_EVIDENCE_INCOMPLETE",
                f"Included line references unavailable source region {region_id}",
            )

    page_boundary = raw.get("pageBoundary", {}).get("points")
    if page_boundary != boundary_layout.get("pageBoundary"):
        raise BenchmarkError(
            "normalization",
            "SOURCE_PAGE_BOUNDARY_CHANGED",
            "Display projection did not retain the exact Eynollah page boundary",
        )
    excluded_count = len(excluded_ids)
    warnings = [
        {
            "code": "DIAGNOSTIC_BOUNDARY_FILTER_PROJECTION",
            "message": (
                "This normalized layout is a reversible display projection over "
                "two immutable source runs, not model inference or production "
                "PageLayoutV2, ground truth, or a rankable detector. Exact "
                "source layouts and all line decisions are retained in "
                "raw.json and the source snapshot. Derived source-role "
                "semantics are adapter-enforced because manifest v2 does not "
                "independently type derivations."
            ),
        },
        {
            "code": "SOURCE_LINES_EXCLUDED_BY_PAGE_BOUNDARY",
            "message": (
                f"{excluded_count} of {len(source_lines)} line-geometry "
                "source lines were excluded because sampled native geometry was not "
                "primarily inside the exact Eynollah page boundary."
            ),
        },
    ]
    return {
        "schemaVersion": 1,
        "pageKey": page_key,
        "runId": run_id,
        "engineId": engine_id,
        "image": {
            "width": width,
            "height": height,
            "coordinateSpace": "prepared-pixels-top-left",
            "sourceSha256": source_sha256,
            "preparedSha256": prepared_sha256,
            "rasterFingerprint": copy.deepcopy(raster_fingerprint),
        },
        "pageBoundary": copy.deepcopy(page_boundary),
        "regions": projected_regions,
        "lines": projected_lines,
        "warnings": warnings,
    }


def line_inclusion_decision(
    line: dict[str, Any],
    page_boundary: list[dict[str, Any]],
    *,
    sample_spacing_pixels: float,
    threshold_exclusive: float,
) -> dict[str, Any]:
    baseline = _point_pairs(line.get("baseline"))
    boundary = _point_pairs(line.get("boundary"))
    provenance = line.get("provenance")
    attributes = (
        provenance.get("attributes")
        if isinstance(provenance, dict)
        else None
    )
    baseline_source = (
        attributes.get("baselineSource")
        if isinstance(attributes, dict)
        else None
    )
    boundary_source = (
        attributes.get("boundarySource")
        if isinstance(attributes, dict)
        else None
    )
    if len(baseline) >= 2 and baseline_source == "provider":
        geometry = baseline
        geometry_source = "native-baseline"
        closed = False
        provider_geometry_source = baseline_source
    elif len(boundary) >= 3 and boundary_source == "provider-polygon":
        geometry = boundary
        geometry_source = "native-boundary"
        closed = True
        provider_geometry_source = boundary_source
    else:
        return {
            "included": False,
            "reason": "source-line-has-no-provider-native-sampleable-geometry",
            "sampling": {
                "provider": GEOMETRY_PROVIDER,
                "geometrySource": "unavailable",
                "providerGeometrySource": None,
                "closedPath": False,
                "sampleSpacingPixels": sample_spacing_pixels,
                "insideSampleCount": 0,
                "totalSampleCount": 0,
                "insideRatio": 0.0,
                "insideRatioThresholdExclusive": threshold_exclusive,
            },
        }
    polygon = _point_pairs(page_boundary)
    if len(polygon) < 3:
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_BOUNDARY_UNAVAILABLE",
            "Page boundary has fewer than three usable points",
        )
    samples = _sample_path(
        geometry,
        spacing=sample_spacing_pixels,
        closed=closed,
    )
    inside_count = sum(_point_in_polygon(point, polygon) for point in samples)
    total_count = len(samples)
    ratio = inside_count / total_count if total_count else 0.0
    included = ratio > threshold_exclusive
    return {
        "included": included,
        "reason": (
            "sampled-native-geometry-primarily-inside-page-boundary"
            if included
            else "sampled-native-geometry-not-primarily-inside-page-boundary"
        ),
        "sampling": {
            "provider": GEOMETRY_PROVIDER,
            "geometrySource": geometry_source,
            "providerGeometrySource": provider_geometry_source,
            "closedPath": closed,
            "sampleSpacingPixels": sample_spacing_pixels,
            "insideSampleCount": inside_count,
            "totalSampleCount": total_count,
            "insideRatio": round(ratio, 9),
            "insideRatioThresholdExclusive": threshold_exclusive,
        },
    }


def _validate_line_evidence_item(
    item: dict[str, Any],
    *,
    included: bool,
) -> None:
    source_line_id = item.get("sourceLineId")
    projected_line_id = item.get("projectedLineId")
    reason = item.get("reason")
    sampling = item.get("sampling")
    if (
        item.get("includedInProjection") is not included
        or projected_line_id != (source_line_id if included else None)
        or not isinstance(sampling, dict)
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_DECISION_INCONSISTENT",
            f"Line decision is inconsistent for {source_line_id}",
        )
    inside_count = sampling.get("insideSampleCount")
    total_count = sampling.get("totalSampleCount")
    ratio = sampling.get("insideRatio")
    threshold = sampling.get("insideRatioThresholdExclusive")
    if (
        not isinstance(inside_count, int)
        or isinstance(inside_count, bool)
        or not isinstance(total_count, int)
        or isinstance(total_count, bool)
        or inside_count < 0
        or total_count < 0
        or inside_count > total_count
        or not isinstance(ratio, (int, float))
        or isinstance(ratio, bool)
        or not math.isfinite(float(ratio))
        or not 0 <= float(ratio) <= 1
        or not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(float(threshold))
        or not 0 <= float(threshold) < 1
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_DECISION_INVALID",
            f"Line decision has invalid sampling values for {source_line_id}",
        )
    expected_ratio = inside_count / total_count if total_count else 0.0
    expected_included = total_count > 0 and expected_ratio > float(threshold)
    expected_reason = (
        "sampled-native-geometry-primarily-inside-page-boundary"
        if expected_included
        else (
            "source-line-has-no-provider-native-sampleable-geometry"
            if total_count == 0
            else "sampled-native-geometry-not-primarily-inside-page-boundary"
        )
    )
    if (
        abs(float(ratio) - expected_ratio) > 1e-8
        or included is not expected_included
        or reason != expected_reason
    ):
        raise BenchmarkError(
            "normalization",
            "COMPOSITION_DECISION_INCONSISTENT",
            f"Line decision ratio or reason is inconsistent for {source_line_id}",
        )


def _load_bindings(
    config: dict[str, Any],
    *,
    runs_root: Path,
) -> tuple[SourceBinding, SourceBinding]:
    source_runs = config.get("sourceRuns")
    if not isinstance(source_runs, dict):
        raise BenchmarkError(
            "configuration",
            "COMPOSITION_SOURCE_RUNS_INVALID",
            "Boundary-filter config must declare sourceRuns",
        )
    bindings = tuple(
        _load_binding(key, source_runs.get(key), runs_root=runs_root)
        for key in ("lineGeometry", "pageBoundary")
    )
    return bindings  # type: ignore[return-value]


def _load_binding(
    key: str,
    value: Any,
    *,
    runs_root: Path,
) -> SourceBinding:
    if not isinstance(value, dict):
        raise BenchmarkError(
            "configuration",
            "COMPOSITION_SOURCE_RUN_INVALID",
            f"Boundary-filter config is missing sourceRuns.{key}",
        )
    run_id = ensure_safe_id(str(value.get("runId", "")), f"{key}.runId")
    expected_engine_id = ensure_safe_id(
        str(value.get("expectedEngineId", "")),
        f"{key}.expectedEngineId",
    )
    role = str(value.get("role", ""))
    expected_manifest_sha256 = str(value.get("manifestSha256", ""))
    if (
        not role
        or len(expected_manifest_sha256) != 64
        or any(ch not in "0123456789abcdef" for ch in expected_manifest_sha256)
    ):
        raise BenchmarkError(
            "configuration",
            "COMPOSITION_SOURCE_RUN_INVALID",
            f"Boundary-filter config has invalid metadata for {key}",
        )
    run_directory = runs_root.resolve() / run_id
    manifest_path = run_directory / "run.v2.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_RUN_MANIFEST_MISSING",
            f"Configured source manifest does not exist: {run_id}",
        )
    observed_manifest_sha256 = sha256_file(manifest_path)
    if observed_manifest_sha256 != expected_manifest_sha256:
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_RUN_MANIFEST_CHECKSUM_MISMATCH",
            f"Configured source manifest changed: {run_id}",
            {
                "expectedSha256": expected_manifest_sha256,
                "observedSha256": observed_manifest_sha256,
            },
        )
    manifest = read_json(manifest_path)
    if (
        not isinstance(manifest, dict)
        or manifest.get("schemaVersion") != 2
        or manifest.get("runId") != run_id
        or manifest.get("engine", {}).get("id") != expected_engine_id
    ):
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_RUN_MANIFEST_INVALID",
            f"Configured source manifest identity is invalid: {run_id}",
        )
    return SourceBinding(
        key=key,
        role=role,
        run_id=run_id,
        expected_engine_id=expected_engine_id,
        expected_manifest_sha256=expected_manifest_sha256,
        run_directory=run_directory,
        manifest_path=manifest_path,
        manifest=manifest,
    )


def _validate_with_authoritative_runner(binding: SourceBinding) -> None:
    validator = BACKEND_ROOT / "scripts" / "validate-layout-benchmark-run.ts"
    tsx = BACKEND_ROOT / "node_modules" / ".bin" / "tsx"
    if not validator.is_file() or not tsx.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_RUN_VALIDATOR_UNAVAILABLE",
            "The authoritative TypeScript source-run validator is unavailable",
        )
    result = run_capture(
        [
            str(tsx),
            str(validator),
            "--directory",
            str(binding.run_directory),
            "--run-id",
            binding.run_id,
        ],
        timeout_seconds=600,
    )
    if result.returncode != 0:
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_RUN_INTEGRITY_INVALID",
            f"Source run failed authoritative validation: {binding.run_id}",
            {
                "exitCode": result.returncode,
                "stdout": result.stdout[-10_000:],
                "stderr": result.stderr[-10_000:],
            },
        )


def _verified_page_inputs(
    binding: SourceBinding,
    page_key: str,
    *,
    expected_target_path: Path | None,
) -> dict[str, Any]:
    page = _source_page(binding, page_key)
    prepared = page.get("prepared")
    artifacts = page.get("artifacts")
    if (
        page.get("status") != "succeeded"
        or not isinstance(prepared, dict)
        or not isinstance(artifacts, dict)
        or not isinstance(artifacts.get("normalized"), str)
    ):
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_UNAVAILABLE",
            f"Source run {binding.run_id} has no successful page {page_key}",
            {"sourceError": page.get("error")},
        )
    width = int(prepared["width"])
    height = int(prepared["height"])
    prepared_path = _resolve_source_artifact(
        binding,
        str(prepared["artifact"]),
        verify_integrity=True,
    )
    normalized_reference = str(artifacts["normalized"])
    normalized_path = _resolve_source_artifact(
        binding,
        normalized_reference,
        verify_integrity=True,
    )
    normalized = read_json(normalized_path)
    image = normalized.get("image") if isinstance(normalized, dict) else None
    if (
        not isinstance(normalized, dict)
        or normalized.get("pageKey") != page_key
        or normalized.get("runId") != binding.run_id
        or normalized.get("engineId") != binding.expected_engine_id
        or not isinstance(image, dict)
        or image.get("width") != width
        or image.get("height") != height
        or image.get("preparedSha256") != prepared.get("sha256")
        or image.get("sourceSha256") != page.get("source", {}).get("sha256")
    ):
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_NORMALIZED_LAYOUT_INVALID",
            f"Source normalized layout identity is invalid for {page_key}",
            {"sourceRunId": binding.run_id},
        )
    raster = fingerprint_prepared_png(
        prepared_path,
        expected_width=width,
        expected_height=height,
    )
    declared_raster = prepared.get("rasterFingerprint")
    if declared_raster is not None and (
        not isinstance(declared_raster, dict)
        or declared_raster.get("algorithm") != RASTER_FINGERPRINT_ALGORITHM
        or declared_raster.get("sha256") != raster
    ):
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PREPARED_RASTER_FINGERPRINT_MISMATCH",
            f"Source prepared fingerprint is invalid for {page_key}",
            {"sourceRunId": binding.run_id},
        )
    if expected_target_path is not None:
        target_raster = fingerprint_prepared_png(
            expected_target_path,
            expected_width=width,
            expected_height=height,
        )
        if target_raster != raster:
            raise BenchmarkError(
                "engine-composition",
                "TARGET_PREPARED_RASTER_MISMATCH",
                f"Derived prepared raster differs from {binding.run_id}",
                {"pageKey": page_key},
            )
    return {
        "page": page,
        "preparedPath": prepared_path,
        "preparedReference": str(prepared["artifact"]),
        "preparedSha256": str(prepared["sha256"]),
        "normalizedPath": normalized_path,
        "normalizedReference": normalized_reference,
        "normalizedSha256": sha256_file(normalized_path),
        "normalizedLayout": normalized,
        "width": width,
        "height": height,
        "rasterFingerprint": raster,
    }


def _verify_pair_identity(
    left_binding: SourceBinding,
    left_page: dict[str, Any],
    right_binding: SourceBinding,
    right_page: dict[str, Any],
) -> None:
    left_prepared = left_page.get("prepared")
    right_prepared = right_page.get("prepared")
    if (
        left_page.get("source") != right_page.get("source")
        or not isinstance(left_prepared, dict)
        or not isinstance(right_prepared, dict)
        or left_prepared.get("width") != right_prepared.get("width")
        or left_prepared.get("height") != right_prepared.get("height")
    ):
        raise BenchmarkError(
            "engine-composition",
            "SOURCE_PAGE_IDENTITY_MISMATCH",
            "Source-run page identity or dimensions differ",
            {
                "lineGeometryRunId": left_binding.run_id,
                "pageBoundaryRunId": right_binding.run_id,
                "pageKey": left_page.get("pageKey"),
            },
        )


def _resolve_source_artifact(
    binding: SourceBinding,
    reference: str,
    *,
    verify_integrity: bool,
) -> Path:
    if (
        not reference
        or reference.startswith(("/", "\\"))
        or "\\" in reference
        or any(part in {"", ".", ".."} for part in reference.split("/"))
    ):
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_ARTIFACT_PATH_INVALID",
            f"Unsafe source artifact path in {binding.run_id}: {reference}",
        )
    root = binding.run_directory.resolve()
    lexical_path = root / reference
    if lexical_path.is_symlink():
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_ARTIFACT_SYMLINK_REJECTED",
            f"Source artifact cannot be a symlink: {reference}",
            {"sourceRunId": binding.run_id},
        )
    path = lexical_path.resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_ARTIFACT_ESCAPES_RUN",
            f"Source artifact escapes {binding.run_id}: {reference}",
        ) from exc
    if not path.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_ARTIFACT_MISSING",
            f"Source artifact is missing: {binding.run_id}/{reference}",
        )
    if verify_integrity:
        integrity = binding.manifest.get("integrity", {}).get("artifacts", {})
        expected = integrity.get(reference) if isinstance(integrity, dict) else None
        if (
            not isinstance(expected, dict)
            or sha256_file(path) != expected.get("sha256")
            or path.stat().st_size != expected.get("sizeBytes")
        ):
            raise BenchmarkError(
                "engine-preflight",
                "SOURCE_ARTIFACT_INTEGRITY_MISMATCH",
                f"Source artifact failed integrity verification: {reference}",
                {"sourceRunId": binding.run_id},
            )
    return path


def _source_page(binding: SourceBinding, page_key: str) -> dict[str, Any]:
    for page in binding.manifest.get("pages", []):
        if isinstance(page, dict) and page.get("pageKey") == page_key:
            return page
    raise BenchmarkError(
        "engine-composition",
        "SOURCE_PAGE_MISSING",
        f"Source run {binding.run_id} does not contain {page_key}",
    )


def _selection_page_keys(binding: SourceBinding) -> tuple[str, ...]:
    values = (
        binding.manifest.get("cohort", {})
        .get("selection", {})
        .get("pageKeys")
    )
    if (
        not isinstance(values, list)
        or not values
        or any(not isinstance(value, str) for value in values)
    ):
        raise BenchmarkError(
            "engine-preflight",
            "SOURCE_SELECTION_INVALID",
            f"Source run has invalid selection: {binding.run_id}",
        )
    return tuple(values)


def _page_binding_evidence(
    binding: SourceBinding,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    manifest_relative = backend_relative(binding.manifest_path)
    normalized_relative = backend_relative(inputs["normalizedPath"])
    return {
        "role": binding.role,
        "runId": binding.run_id,
        "engineId": binding.expected_engine_id,
        "manifest": {
            "backendPath": manifest_relative,
            "sha256": binding.expected_manifest_sha256,
            "snapshotPath": f"source-snapshot/{manifest_relative}",
        },
        "normalizedLayout": {
            "artifact": inputs["normalizedReference"],
            "backendPath": normalized_relative,
            "sha256": inputs["normalizedSha256"],
            "snapshotPath": f"source-snapshot/{normalized_relative}",
        },
        "prepared": {
            "artifact": inputs["preparedReference"],
            "encodedSha256": inputs["preparedSha256"],
            "width": inputs["width"],
            "height": inputs["height"],
            "rasterFingerprint": {
                "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                "sha256": inputs["rasterFingerprint"],
            },
        },
    }


def _binding_metadata(binding: SourceBinding) -> dict[str, Any]:
    return {
        "role": binding.role,
        "runId": binding.run_id,
        "engineId": binding.expected_engine_id,
        "manifestSha256": binding.expected_manifest_sha256,
    }


def _validated_parameters(config: dict[str, Any]) -> dict[str, Any]:
    parameters = config.get("parameters")
    if not isinstance(parameters, dict):
        raise BenchmarkError(
            "configuration",
            "COMPOSITION_PARAMETERS_INVALID",
            "Boundary-filter config must declare parameters",
        )
    preference = parameters.get("geometryPreference")
    spacing = parameters.get("sampleSpacingPixels")
    threshold = parameters.get("insideRatioThresholdExclusive")
    if (
        preference != ["native-baseline", "native-boundary"]
        or not isinstance(spacing, (int, float))
        or isinstance(spacing, bool)
        or not math.isfinite(float(spacing))
        or float(spacing) <= 0
        or not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(float(threshold))
        or not 0 <= float(threshold) < 1
        or parameters.get("pointOnBoundaryCountsInside") is not True
        or parameters.get("coordinateTransform") != "identity"
    ):
        raise BenchmarkError(
            "configuration",
            "COMPOSITION_PARAMETERS_INVALID",
            "Boundary-filter geometry parameters are invalid or unsupported",
        )
    return {
        "geometryPreference": list(preference),
        "sampleSpacingPixels": float(spacing),
        "insideRatioThresholdExclusive": float(threshold),
    }


def _sample_path(
    points: list[tuple[float, float]],
    *,
    spacing: float,
    closed: bool,
) -> list[tuple[float, float]]:
    segments = list(zip(points, points[1:]))
    if closed:
        segments.append((points[-1], points[0]))
    samples: list[tuple[float, float]] = []
    for start, end in segments:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        divisions = max(1, math.ceil(length / spacing))
        for index in range(divisions):
            fraction = (index + 0.5) / divisions
            samples.append(
                (
                    start[0] + dx * fraction,
                    start[1] + dy * fraction,
                )
            )
    if not samples and points:
        samples.append(points[0])
    return samples


def _point_in_polygon(
    point: tuple[float, float],
    polygon: list[tuple[float, float]],
) -> bool:
    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        if _point_on_segment(point, previous, current):
            return True
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def _point_on_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> bool:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
    tolerance = 1e-9 * max(1.0, abs(x2 - x1), abs(y2 - y1))
    if abs(cross) > tolerance:
        return False
    return (
        min(x1, x2) - tolerance <= x <= max(x1, x2) + tolerance
        and min(y1, y2) - tolerance <= y <= max(y1, y2) + tolerance
    )


def _point_pairs(value: Any) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    if not isinstance(value, list):
        return points
    for item in value:
        if not isinstance(item, dict):
            continue
        x = item.get("x")
        y = item.get("y")
        if (
            isinstance(x, (int, float))
            and not isinstance(x, bool)
            and math.isfinite(float(x))
            and isinstance(y, (int, float))
            and not isinstance(y, bool)
            and math.isfinite(float(y))
        ):
            points.append((float(x), float(y)))
    return points


def _require_equal(
    left: Any,
    right: Any,
    code: str,
    message: str,
) -> None:
    if left != right:
        raise BenchmarkError(
            "engine-preflight",
            code,
            message,
            {"left": left, "right": right},
        )
