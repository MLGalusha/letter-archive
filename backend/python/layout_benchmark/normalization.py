from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Iterable

from .boundary_filter import normalize_composition_evidence
from .page_mask_stage import normalized_page_boundary_from_input_stage
from .util import BenchmarkError, read_json


CANONICAL_CLASSES = {
    "text",
    "marginalia",
    "foreign_page",
    "illustration",
    "background",
    "table",
    "header",
    "footer",
    "other",
}


def normalize_provider_output(
    *,
    engine_id: str,
    run_id: str,
    page_key: str,
    raw_path: Path,
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
    page_boundary_available: bool = True,
) -> dict[str, Any]:
    if engine_id.endswith("eyno-boundary-filter"):
        return normalize_composition_evidence(
            raw=read_json(raw_path),
            engine_id=engine_id,
            run_id=run_id,
            page_key=page_key,
            width=width,
            height=height,
            source_sha256=source_sha256,
            prepared_sha256=prepared_sha256,
        )
    if engine_id in {
        "kraken6",
        "kraken7",
        "kraken7-rot4-union",
        "kraken7-rot4-consensus",
        "kraken7-rot3-zones",
        "kraken7-rot3-safe-zones",
        "kraken7-rot3-union-ablation",
        "kraken7-rot3-consensus-ablation",
        "kraken7-rot3-safe-zones-ablation",
        "kraken7-rot4-consensus-replay",
        "kraken7-rot4-safe-zones-replay",
        "kraken7-rot3-eyno-mask-p0-safe-zones",
        "kraken7-rot3-eyno-mask-p16-safe-zones",
        "kraken7-eyno-mask-p0",
        "kraken7-eyno-mask-p16",
        "kraken7-rot3-eyno-mask-p0",
        "kraken7-rot3-eyno-mask-p16",
        "kraken7-orli",
        "kraken7-orli-cpu",
        "kraken7-orli-cpu-cap128",
        "kraken7-orli-cap128",
    }:
        return normalize_kraken(
            engine_id=engine_id,
            run_id=run_id,
            page_key=page_key,
            raw=read_json(raw_path),
            width=width,
            height=height,
            source_sha256=source_sha256,
            prepared_sha256=prepared_sha256,
        )
    if engine_id.startswith("eynollah"):
        return normalize_pagexml(
            engine_id=engine_id,
            run_id=run_id,
            page_key=page_key,
            xml_path=raw_path,
            width=width,
            height=height,
            source_sha256=source_sha256,
            prepared_sha256=prepared_sha256,
            page_boundary_available=page_boundary_available,
        )
    raise BenchmarkError(
        "normalization", "UNKNOWN_ENGINE", f"No normalizer for {engine_id}"
    )


def normalize_kraken(
    *,
    engine_id: str,
    run_id: str,
    page_key: str,
    raw: dict[str, Any],
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
) -> dict[str, Any]:
    provider_name = _optional_string(raw.get("provider")) or "kraken"
    page_boundary = normalized_page_boundary_from_input_stage(
        raw,
        page_key=page_key,
        width=width,
        height=height,
        source_sha256=source_sha256,
        prepared_sha256=prepared_sha256,
    )
    if page_boundary is None:
        page_boundary = _frame_boundary(width, height)
        boundary_message = (
            "Kraken Orli predicts text-line baselines and reading order, not a "
            "physical page boundary; the prepared image frame is used."
            if engine_id.startswith("kraken7-orli")
            else "Kraken BLLA does not predict a physical page boundary; the "
            "prepared image frame is used."
        )
        warnings = [
            {
                "code": "PAGE_BOUNDARY_UNAVAILABLE",
                "message": boundary_message,
            }
        ]
    else:
        warnings = [
            {
                "code": "PAGE_BOUNDARY_FROM_INPUT_STAGE",
                "message": (
                    "The physical page boundary comes from the exact immutable "
                    "Eynollah source layout used to build Kraken's masked input; "
                    "Kraken remains the sole provider of displayed line geometry."
                ),
            }
        ]
    segmentation = raw.get("segmentation")
    if not isinstance(segmentation, dict):
        raise BenchmarkError(
            "normalization",
            "INVALID_KRAKEN_OUTPUT",
            "Kraken raw output has no segmentation object",
        )

    raw_regions: list[tuple[str, dict[str, Any]]] = []
    regions_value = segmentation.get("regions", {})
    if isinstance(regions_value, dict):
        for raw_class in sorted(regions_value):
            values = regions_value[raw_class]
            if isinstance(values, list):
                for value in values:
                    if isinstance(value, dict):
                        raw_regions.append((str(raw_class), value))

    raw_regions.sort(
        key=lambda item: (
            _geometry_key(item[1].get("boundary")),
            item[0],
            int(item[1].get("providerOrdinal", 0)),
        )
    )
    regions: list[dict[str, Any]] = []
    provider_region_ids: dict[str, str] = {}
    for raw_class, value in raw_regions:
        boundary = _polygon(
            value.get("boundary"), width, height, warnings, "region"
        )
        if boundary is None:
            continue
        region_id = f"{page_key}-region-{len(regions) + 1:04d}"
        provider_id = _optional_string(value.get("id"))
        if provider_id:
            provider_region_ids[provider_id] = region_id
        regions.append(
            {
                "id": region_id,
                "class": canonical_class(raw_class),
                "boundary": boundary,
                "orientationDegrees": None,
                "readingOrder": {
                    "index": len(regions),
                    "scope": "page",
                    "source": "geometry",
                },
                "confidence": _confidence(value.get("confidence")),
                "lineIds": [],
                "provenance": {
                    "provider": provider_name,
                    "providerId": provider_id,
                    "rawClass": raw_class,
                    "attributes": {
                        "tags": value.get("tags"),
                        "language": value.get("language"),
                        "providerOrdinal": value.get("providerOrdinal"),
                    },
                },
            }
        )

    lines_value = segmentation.get("lines", [])
    if not isinstance(lines_value, list):
        raise BenchmarkError(
            "normalization",
            "INVALID_KRAKEN_OUTPUT",
            "Kraken segmentation.lines must be an array",
        )
    max_predicted_lines = raw.get("parameters", {}).get("maxPredictedLines")
    if (
        engine_id.startswith("kraken7-orli")
        and isinstance(max_predicted_lines, int)
        and max_predicted_lines > 0
        and len(lines_value) >= max_predicted_lines
    ):
        warnings.append(
            {
                "code": "PREDICTED_LINE_CAP_REACHED",
                "message": (
                    f"Orli emitted {len(lines_value)} lines, reaching the "
                    f"configured safety cap of {max_predicted_lines}; output "
                    "is treated as truncated and cannot pass quality gates."
                ),
            }
        )
    alternative_positions = _alternative_reading_order_positions(
        segmentation.get("lineOrders"),
        len(lines_value),
        warnings,
    )
    rotation_ensemble = segmentation.get("rotationEnsemble")
    if isinstance(rotation_ensemble, dict):
        if raw.get("kind") == "RotationSourceProjectionEvidence":
            source_binding = raw.get("sourceBinding")
            source_run_id = (
                source_binding.get("runId")
                if isinstance(source_binding, dict)
                else None
            )
            warnings.append(
                {
                    "code": "ROTATION_SOURCE_PROJECTION",
                    "message": (
                        "No new model inference was performed. This layout is "
                        "a deterministic display projection of immutable "
                        f"provider-native passes from source run {source_run_id}; "
                        "the source evidence and exact reprojection checks are "
                        "preserved in raw.json."
                    ),
                }
            )
        warnings.append(
            {
                "code": "ROTATION_ENSEMBLE",
                "message": (
                    "Combined "
                    f"{rotation_ensemble.get('rotationsDegrees')} degree "
                    "passes with "
                    f"{rotation_ensemble.get('mergePolicy')} policy: "
                    f"{rotation_ensemble.get('inputLineCount')} fully successful "
                    "pass lines "
                    "formed "
                    f"{rotation_ensemble.get('includedClusterCount')} displayed "
                    "line clusters; "
                    f"{rotation_ensemble.get('excludedInputLineCount', 0)} "
                    "partial/failed-pass lines remain raw evidence only."
                ),
            }
        )
        selection_evidence = rotation_ensemble.get("selectionEvidence")
        if (
            rotation_ensemble.get("mergePolicy")
            == "baseline-plus-vertical-zones"
            and isinstance(selection_evidence, dict)
        ):
            warnings.append(
                {
                    "code": "ROTATION_SINGLE_PASS_ZONE_HEURISTIC",
                    "message": (
                        "Rotated proposals use a spatial-zone heuristic: two "
                        "nearby strong vertical lines from one fully successful "
                        "rotation may establish a zone. Independent rotation "
                        "consensus is not required. Contributing successful "
                        "rotations: "
                        f"{selection_evidence.get(
                            'contributingSuccessfulRotationsDegrees', []
                        )}."
                    ),
                }
            )
        if (
            rotation_ensemble.get("mergePolicy")
            == "baseline-plus-nonoverlapping-vertical-zones"
            and isinstance(selection_evidence, dict)
        ):
            rejected_reasons = sorted(
                {
                    str(reason)
                    for zone in selection_evidence.get("zones", [])
                    if isinstance(zone, dict)
                    for reason in zone.get("rejectionReasons", [])
                    if isinstance(reason, str)
                }
            )
            warnings.append(
                {
                    "code": "ROTATION_SAFE_VERTICAL_ZONE_GATE",
                    "message": (
                        "Rotated proposals were admitted only through the "
                        "explicit non-overlapping vertical-zone gate: at least "
                        f"{selection_evidence.get(
                            'minimumProposalClustersPerZone'
                        )} proposal clusters per zone, with substantially "
                        "horizontal 0-degree baselines limited by a "
                        f"{selection_evidence.get(
                            'maximumHorizontalBaselineCentroidRatioPerZone'
                        )} ratio and "
                        f"{selection_evidence.get(
                            'minimumHorizontalBaselineCentroidAllowancePerZone'
                        )} minimum allowance. Accepted zones: "
                        f"{selection_evidence.get('acceptedZoneCount', 0)}; "
                        "rejected zones: "
                        f"{selection_evidence.get('rejectedZoneCount', 0)}; "
                        f"reasons: {rejected_reasons}."
                    ),
                }
            )
        for pass_record in raw.get("rotationPasses", []):
            if not isinstance(pass_record, dict):
                continue
            status = pass_record.get("status")
            if status not in {"partial", "failed"}:
                continue
            rotation = pass_record.get("rotationDegrees")
            error = pass_record.get("error")
            error_message = (
                error.get("message")
                if isinstance(error, dict)
                else "No structured provider error was available."
            )
            warnings.append(
                {
                    "code": (
                        "ROTATION_PASS_PARTIAL"
                        if status == "partial"
                        else "ROTATION_PASS_FAILED"
                    ),
                    "message": (
                        f"The {rotation} degree pass was {status}. "
                        f"{error_message}"
                    ),
                }
            )
    lines: list[dict[str, Any]] = []
    missing_boundary_indices: list[int] = []
    derived_boundary_count = 0
    baseline_envelope_half_width = _baseline_envelope_half_width(width, height)
    for provider_index, value in enumerate(lines_value):
        if not isinstance(value, dict):
            warnings.append(
                {
                    "code": "INVALID_LINE_SKIPPED",
                    "message": f"Kraken line {provider_index} is not an object.",
                }
            )
            continue
        baseline = _baseline(value.get("baseline"), width, height, warnings)
        boundary_source = "provider-polygon"
        raw_boundary = value.get("boundary")
        boundary = (
            _polygon(raw_boundary, width, height, warnings, "line")
            if raw_boundary is not None
            else None
        )
        if boundary is None and value.get("bbox") is not None:
            boundary = _bbox_polygon(
                value.get("bbox"), width, height, warnings
            )
            boundary_source = "provider-bbox"
        if boundary is None and baseline is not None:
            boundary = _baseline_envelope(
                baseline,
                width,
                height,
                baseline_envelope_half_width,
            )
            if boundary is not None:
                boundary_source = "baseline-envelope"
                derived_boundary_count += 1
        if boundary is None:
            missing_boundary_indices.append(provider_index)
            continue
        line_id = f"{page_key}-line-{len(lines) + 1:04d}"
        raw_region_ids = value.get("regions")
        region_id = None
        if isinstance(raw_region_ids, list):
            for raw_region_id in raw_region_ids:
                if raw_region_id in provider_region_ids:
                    region_id = provider_region_ids[raw_region_id]
                    break
        line_class = "text"
        if region_id:
            region = next(item for item in regions if item["id"] == region_id)
            line_class = region["class"]
            region["lineIds"].append(line_id)
        raw_tags = value.get("tags")
        raw_class = _kraken_tag_class(raw_tags)
        ensemble_evidence = value.get("ensembleEvidence")
        is_unresolved_rotated_proposal = (
            isinstance(ensemble_evidence, dict)
            and ensemble_evidence.get("readingOrderSource")
            in {"unresolved-rotated-proposal", "ensemble-appended"}
        )
        orientation, orientation_source = _line_orientation(
            baseline=baseline,
            bbox=value.get("bbox"),
            text_direction=(
                _optional_string(value.get("text_direction"))
                or _optional_string(segmentation.get("textDirection"))
            ),
        )
        lines.append(
            {
                "id": line_id,
                "class": line_class,
                "boundary": boundary,
                "baseline": baseline,
                "orientationDegrees": orientation,
                "readingOrder": (
                    None
                    if is_unresolved_rotated_proposal
                    else {
                        "index": len(lines),
                        "scope": "page",
                        "source": "provider",
                    }
                ),
                "confidence": _confidence(value.get("confidence")),
                "regionId": region_id,
                "provenance": {
                    "provider": provider_name,
                    "providerId": _optional_string(value.get("id")),
                    "rawClass": raw_class,
                    "attributes": {
                        "tags": raw_tags,
                        "regions": raw_region_ids,
                        "language": value.get("language"),
                        "baseDirection": value.get("base_dir"),
                        "providerOrdinal": value.get(
                            "providerOrdinal", provider_index
                        ),
                        "textDirection": segmentation.get("textDirection"),
                        "segmentationType": segmentation.get("type"),
                        "boundarySource": boundary_source,
                        "boundaryEnvelopeHalfWidthPx": (
                            baseline_envelope_half_width
                            if boundary_source == "baseline-envelope"
                            else None
                        ),
                        "baselineSource": (
                            "provider" if baseline is not None else None
                        ),
                        "orientationSource": orientation_source,
                        "alternativeReadingOrders": alternative_positions.get(
                            provider_index, []
                        ),
                        "rotationEnsemble": ensemble_evidence,
                    },
                },
            }
        )
    if derived_boundary_count:
        warnings.append(
            {
                "code": "LINE_BOUNDARY_DERIVED_FROM_BASELINE",
                "message": (
                    f"Derived deterministic display/scoring corridors for "
                    f"{derived_boundary_count} baseline-only Kraken lines using "
                    f"a {baseline_envelope_half_width}px half-width "
                    "(0.25% of the prepared image long edge, rounded and "
                    "clamped to at least 1px). These are not provider-predicted "
                    "line polygons."
                ),
            }
        )
    if missing_boundary_indices:
        index_preview = ", ".join(
            str(index) for index in missing_boundary_indices[:12]
        )
        if len(missing_boundary_indices) > 12:
            index_preview += ", …"
        warnings.append(
            {
                "code": "LINE_BOUNDARY_UNAVAILABLE_SKIPPED",
                "message": (
                    f"Skipped {len(missing_boundary_indices)} Kraken lines "
                    "that had neither a usable polygon nor native bounding "
                    "box nor a usable baseline "
                    f"(provider indices: {index_preview})."
                ),
            }
        )
    return _layout(
        page_key=page_key,
        run_id=run_id,
        engine_id=engine_id,
        width=width,
        height=height,
        source_sha256=source_sha256,
        prepared_sha256=prepared_sha256,
        page_boundary=page_boundary,
        regions=regions,
        lines=lines,
        warnings=warnings,
    )


def normalize_pagexml(
    *,
    engine_id: str,
    run_id: str,
    page_key: str,
    xml_path: Path,
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
    page_boundary_available: bool = True,
) -> dict[str, Any]:
    try:
        tree = ET.parse(xml_path)
    except (ET.ParseError, OSError) as exc:
        raise BenchmarkError(
            "normalization",
            "INVALID_PAGE_XML",
            f"Could not parse Eynollah PAGE XML: {exc}",
        ) from exc
    root = tree.getroot()
    page = next(
        (element for element in root.iter() if _local_name(element.tag) == "Page"),
        None,
    )
    if page is None:
        raise BenchmarkError(
            "normalization", "INVALID_PAGE_XML", "PAGE XML has no Page element"
        )
    xml_width = _positive_int(page.get("imageWidth"))
    xml_height = _positive_int(page.get("imageHeight"))
    if xml_width != width or xml_height != height:
        raise BenchmarkError(
            "normalization",
            "PAGE_XML_DIMENSIONS_MISMATCH",
            "Eynollah PAGE XML dimensions do not match prepared input",
            {
                "expected": {"width": width, "height": height},
                "actual": {"width": xml_width, "height": xml_height},
            },
        )

    warnings: list[dict[str, str]] = []
    border = next(
        (
            element
            for element in list(page)
            if _local_name(element.tag) == "Border"
        ),
        None,
    )
    page_boundary = None
    if border is not None and page_boundary_available:
        page_boundary = _coords_polygon(border, width, height, warnings, "page")
    if page_boundary is None:
        page_boundary = _frame_boundary(width, height)
        warnings.append(
            {
                "code": "PAGE_BOUNDARY_UNAVAILABLE",
                "message": (
                    "Eynollah page extraction was disabled; its full-frame "
                    "Border is not a page-boundary prediction and the prepared "
                    "image frame is used only as an unavailable fallback."
                    if not page_boundary_available
                    else "Eynollah PAGE XML has no valid Border; the prepared "
                    "image frame is used."
                ),
            }
        )

    provider_region_order = _pagexml_region_order(page)
    provider_regions = [
        element
        for element in list(page)
        if _local_name(element.tag).endswith("Region")
    ]
    provider_regions.sort(
        key=lambda element: (
            provider_region_order.get(element.get("id", ""), 1_000_000),
            _element_geometry_key(element),
            element.get("id", ""),
        )
    )

    regions: list[dict[str, Any]] = []
    provider_to_normalized: dict[str, str] = {}
    region_elements: list[tuple[ET.Element, dict[str, Any]]] = []
    for element in provider_regions:
        boundary = _coords_polygon(
            element, width, height, warnings, "region"
        )
        if boundary is None:
            continue
        provider_id = _optional_string(element.get("id"))
        raw_class = _pagexml_raw_class(element)
        region_id = f"{page_key}-region-{len(regions) + 1:04d}"
        reading_index = provider_region_order.get(
            provider_id or "", len(regions)
        )
        reading_source = (
            "provider"
            if provider_id is not None and provider_id in provider_region_order
            else "geometry"
        )
        region = {
            "id": region_id,
            "class": canonical_class(raw_class),
            "boundary": boundary,
            "orientationDegrees": _orientation(element.get("orientation")),
            "readingOrder": {
                "index": reading_index,
                "scope": "page",
                "source": reading_source,
            },
            "confidence": _element_confidence(element),
            "lineIds": [],
            "provenance": {
                "provider": "eynollah",
                "providerId": provider_id,
                "rawClass": raw_class,
                "attributes": {
                    "pageXmlTag": _local_name(element.tag),
                    "type": element.get("type"),
                    "custom": element.get("custom"),
                },
            },
        }
        regions.append(region)
        region_elements.append((element, region))
        if provider_id:
            provider_to_normalized[provider_id] = region_id

    lines_pending: list[tuple[int, int, ET.Element, dict[str, Any]]] = []
    for region_position, (region_element, region) in enumerate(region_elements):
        region_order = region["readingOrder"]["index"]
        provider_lines = [
            element
            for element in list(region_element)
            if _local_name(element.tag) == "TextLine"
        ]
        for line_position, line_element in enumerate(provider_lines):
            lines_pending.append(
                (
                    region_order,
                    line_position,
                    line_element,
                    region,
                )
            )
    lines_pending.sort(
        key=lambda item: (
            item[0],
            item[1],
            _element_geometry_key(item[2]),
            item[2].get("id", ""),
        )
    )

    lines: list[dict[str, Any]] = []
    for _, _, element, region in lines_pending:
        boundary = _coords_polygon(element, width, height, warnings, "line")
        if boundary is None:
            continue
        baseline = _pagexml_baseline(element, width, height, warnings)
        orientation = _orientation(element.get("orientation"))
        orientation_source = (
            "line-attribute" if orientation is not None else None
        )
        if orientation is None and region["orientationDegrees"] is not None:
            orientation = region["orientationDegrees"]
            orientation_source = "region-attribute"
        if orientation is None:
            orientation, orientation_source = _line_orientation(
                baseline=baseline,
                bbox=None,
                text_direction=None,
            )
        line_id = f"{page_key}-line-{len(lines) + 1:04d}"
        region["lineIds"].append(line_id)
        raw_class = _pagexml_raw_class(element)
        inherited_class = region["class"]
        line_class = (
            canonical_class(raw_class)
            if raw_class not in {"TextLine", "textline"}
            else inherited_class
        )
        if line_class == "other":
            line_class = inherited_class if inherited_class != "other" else "text"
        lines.append(
            {
                "id": line_id,
                "class": line_class,
                "boundary": boundary,
                "baseline": baseline,
                "orientationDegrees": orientation,
                "readingOrder": {
                    "index": len(lines),
                    "scope": "page",
                    "source": "provider",
                },
                "confidence": _element_confidence(element),
                "regionId": region["id"],
                "provenance": {
                    "provider": "eynollah",
                    "providerId": _optional_string(element.get("id")),
                    "rawClass": raw_class,
                    "attributes": {
                        "pageXmlTag": _local_name(element.tag),
                        "type": element.get("type"),
                        "custom": element.get("custom"),
                        "orientationSource": orientation_source,
                    },
                },
            }
        )
    return _layout(
        page_key=page_key,
        run_id=run_id,
        engine_id=engine_id,
        width=width,
        height=height,
        source_sha256=source_sha256,
        prepared_sha256=prepared_sha256,
        page_boundary=page_boundary,
        regions=regions,
        lines=lines,
        warnings=warnings,
    )


def canonical_class(raw_class: str | None) -> str:
    if raw_class is None:
        return "other"
    value = re.sub(r"[^a-z0-9]+", "_", raw_class.lower()).strip("_")
    if value in CANONICAL_CLASSES:
        return value
    if "marginal" in value:
        return "marginalia"
    if "foreign" in value:
        return "foreign_page"
    if "image" in value or "illustration" in value or "graphic" in value:
        return "illustration"
    if "table" in value:
        return "table"
    if "header" in value or "heading" in value:
        return "header"
    if "footer" in value:
        return "footer"
    if "background" in value:
        return "background"
    if "text" in value or "baseline" in value or "paragraph" in value:
        return "text"
    return "other"


def _layout(
    *,
    page_key: str,
    run_id: str,
    engine_id: str,
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
    page_boundary: list[dict[str, int]],
    regions: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    warnings: list[dict[str, str]],
) -> dict[str, Any]:
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
        },
        "pageBoundary": page_boundary,
        "regions": regions,
        "lines": lines,
        "warnings": warnings,
    }


def _frame_boundary(width: int, height: int) -> list[dict[str, int]]:
    return [
        {"x": 0, "y": 0},
        {"x": max(0, width - 1), "y": 0},
        {"x": max(0, width - 1), "y": max(0, height - 1)},
        {"x": 0, "y": max(0, height - 1)},
    ]


def _polygon(
    value: Any,
    width: int,
    height: int,
    warnings: list[dict[str, str]],
    kind: str,
) -> list[dict[str, int]] | None:
    points = _remove_consecutive_duplicates(_points(value, width, height))
    while len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len({(point["x"], point["y"]) for point in points}) < 3:
        warnings.append(
            {
                "code": f"INVALID_{kind.upper()}_BOUNDARY_SKIPPED",
                "message": f"A provider {kind} with fewer than three usable boundary points was skipped.",
            }
        )
        return None
    return points


def _baseline(
    value: Any,
    width: int,
    height: int,
    warnings: list[dict[str, str]],
) -> list[dict[str, int]] | None:
    points = _remove_consecutive_duplicates(_points(value, width, height))
    if len(points) < 2:
        if value is not None:
            warnings.append(
                {
                    "code": "INVALID_BASELINE_DROPPED",
                    "message": "A provider baseline with fewer than two usable points was set to null.",
                }
            )
        return None
    return points


def _baseline_envelope_half_width(width: int, height: int) -> int:
    """Returns a resolution-scaled, deliberately narrow baseline corridor."""
    return max(1, round(max(width, height) / 400))


def _baseline_envelope(
    baseline: list[dict[str, int]],
    width: int,
    height: int,
    half_width: int,
) -> list[dict[str, int]] | None:
    """
    Builds a deterministic corridor around a provider baseline.

    Orli's native output is a baseline polyline without a line polygon. The
    benchmark contract still needs a boundary for display, exclusion tests, and
    fallback box topology. This corridor is therefore intentionally narrow,
    tagged as derived provenance, and never presented as provider geometry.
    """
    if len(baseline) < 2 or half_width < 1:
        return None

    left: list[list[float]] = []
    right: list[list[float]] = []
    for index, point in enumerate(baseline):
        previous = next(
            (
                baseline[candidate]
                for candidate in range(index - 1, -1, -1)
                if baseline[candidate] != point
            ),
            None,
        )
        following = next(
            (
                baseline[candidate]
                for candidate in range(index + 1, len(baseline))
                if baseline[candidate] != point
            ),
            None,
        )
        if previous is not None and following is not None:
            dx = following["x"] - previous["x"]
            dy = following["y"] - previous["y"]
        elif following is not None:
            dx = following["x"] - point["x"]
            dy = following["y"] - point["y"]
        elif previous is not None:
            dx = point["x"] - previous["x"]
            dy = point["y"] - previous["y"]
        else:
            return None
        length = math.hypot(dx, dy)
        if length == 0:
            return None
        normal_x = (-dy / length) * half_width
        normal_y = (dx / length) * half_width
        left.append([point["x"] + normal_x, point["y"] + normal_y])
        right.append([point["x"] - normal_x, point["y"] - normal_y])

    points = _remove_consecutive_duplicates(
        _points([*left, *reversed(right)], width, height)
    )
    while len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len({(point["x"], point["y"]) for point in points}) >= 3:
        return points

    # Image-edge clamping can collapse one side of a very short corridor.
    # Fall back to a small axis-aligned envelope while retaining the same
    # deterministic half-width.
    xs = [point["x"] for point in baseline]
    ys = [point["y"] for point in baseline]
    fallback = _remove_consecutive_duplicates(
        _points(
            [
                [min(xs) - half_width, min(ys) - half_width],
                [max(xs) + half_width, min(ys) - half_width],
                [max(xs) + half_width, max(ys) + half_width],
                [min(xs) - half_width, max(ys) + half_width],
            ],
            width,
            height,
        )
    )
    return (
        fallback
        if len({(point["x"], point["y"]) for point in fallback}) >= 3
        else None
    )


def _bbox_polygon(
    value: Any,
    width: int,
    height: int,
    warnings: list[dict[str, str]],
) -> list[dict[str, int]] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        warnings.append(
            {
                "code": "INVALID_LINE_BBOX_SKIPPED",
                "message": "A provider line bounding box was not a four-value array.",
            }
        )
        return None
    if not all(
        isinstance(item, (int, float)) and math.isfinite(float(item))
        for item in value
    ):
        warnings.append(
            {
                "code": "INVALID_LINE_BBOX_SKIPPED",
                "message": "A provider line bounding box contained a non-finite coordinate.",
            }
        )
        return None
    x0, y0, x1, y1 = (float(item) for item in value)
    left, right = sorted((x0, x1))
    top, bottom = sorted((y0, y1))
    if left == right or top == bottom:
        warnings.append(
            {
                "code": "INVALID_LINE_BBOX_SKIPPED",
                "message": "A provider line bounding box had zero area.",
            }
        )
        return None
    return _polygon(
        [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
        ],
        width,
        height,
        warnings,
        "line",
    )


def _line_orientation(
    *,
    baseline: list[dict[str, int]] | None,
    bbox: Any,
    text_direction: str | None,
) -> tuple[float | None, str | None]:
    if baseline is not None and len(baseline) >= 2:
        start = baseline[0]
        end = baseline[-1]
        dx = end["x"] - start["x"]
        dy = end["y"] - start["y"]
        if dx or dy:
            # Image-space positive y points down, so atan2 yields clockwise
            # angles. Modulo 180 describes physical line orientation without
            # conflating it with left-to-right versus right-to-left direction.
            angle = math.degrees(math.atan2(dy, dx)) % 180.0
            if angle > 90.0:
                angle -= 180.0
            return round(angle, 3), "baseline-chord"
    if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        return (
            90.0 if (text_direction or "").startswith("vertical") else 0.0,
            "text-direction",
        )
    return None, None


def _alternative_reading_order_positions(
    value: Any,
    line_count: int,
    warnings: list[dict[str, str]],
) -> dict[int, list[dict[str, int]]]:
    positions: dict[int, list[dict[str, int]]] = {}
    if value is None:
        return positions
    if not isinstance(value, list):
        warnings.append(
            {
                "code": "INVALID_ALTERNATIVE_READING_ORDER_DROPPED",
                "message": "Kraken alternative reading orders were not an array.",
            }
        )
        return positions
    for order_index, order in enumerate(value):
        if (
            not isinstance(order, list)
            or len(order) != line_count
            or any(not isinstance(item, int) for item in order)
            or set(order) != set(range(line_count))
        ):
            warnings.append(
                {
                    "code": "INVALID_ALTERNATIVE_READING_ORDER_DROPPED",
                    "message": (
                        f"Kraken alternative reading order {order_index} was "
                        "not a complete permutation of provider line indices."
                    ),
                }
            )
            continue
        for position, provider_index in enumerate(order):
            positions.setdefault(provider_index, []).append(
                {"orderIndex": order_index, "position": position}
            )
    return positions


def _kraken_tag_class(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in ("type", "class", "script"):
        candidate = value.get(key)
        direct = _optional_string(candidate)
        if direct is not None:
            return direct
        if isinstance(candidate, list):
            for item in candidate:
                if not isinstance(item, dict):
                    continue
                nested = _optional_string(
                    item.get("type")
                    or item.get("class")
                    or item.get("script")
                )
                if nested is not None:
                    return nested
    return None


def _points(value: Any, width: int, height: int) -> list[dict[str, int]]:
    if not isinstance(value, (list, tuple)):
        return []
    points: list[dict[str, int]] = []
    for item in value:
        x: Any
        y: Any
        if isinstance(item, dict):
            x, y = item.get("x"), item.get("y")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = item[0], item[1]
        else:
            continue
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        if not math.isfinite(float(x)) or not math.isfinite(float(y)):
            continue
        points.append(
            {
                "x": min(max(int(round(float(x))), 0), max(0, width - 1)),
                "y": min(max(int(round(float(y))), 0), max(0, height - 1)),
            }
        )
    return points


def _remove_consecutive_duplicates(
    points: Iterable[dict[str, int]],
) -> list[dict[str, int]]:
    result: list[dict[str, int]] = []
    for point in points:
        if not result or point != result[-1]:
            result.append(point)
    return result


def _geometry_key(value: Any) -> tuple[float, float, float, float]:
    if not isinstance(value, (list, tuple)):
        return (math.inf, math.inf, math.inf, math.inf)
    xs: list[float] = []
    ys: list[float] = []
    for item in value:
        if isinstance(item, dict):
            x, y = item.get("x"), item.get("y")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = item[0], item[1]
        else:
            continue
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            xs.append(float(x))
            ys.append(float(y))
    if not xs:
        return (math.inf, math.inf, math.inf, math.inf)
    return (min(ys), min(xs), max(ys), max(xs))


def _confidence(value: Any) -> float | None:
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return None
    return min(max(float(value), 0.0), 1.0)


def _orientation(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return result % 360.0


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _positive_int(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _coords_polygon(
    element: ET.Element,
    width: int,
    height: int,
    warnings: list[dict[str, str]],
    kind: str,
) -> list[dict[str, int]] | None:
    coords = next(
        (
            child
            for child in list(element)
            if _local_name(child.tag) == "Coords"
        ),
        None,
    )
    raw = coords.get("points") if coords is not None else None
    return _polygon(_parse_pagexml_points(raw), width, height, warnings, kind)


def _pagexml_baseline(
    line: ET.Element,
    width: int,
    height: int,
    warnings: list[dict[str, str]],
) -> list[dict[str, int]] | None:
    baseline = next(
        (
            child
            for child in list(line)
            if _local_name(child.tag) == "Baseline"
        ),
        None,
    )
    if baseline is None:
        return None
    raw = baseline.get("points")
    return _baseline(_parse_pagexml_points(raw), width, height, warnings)


def _parse_pagexml_points(raw: str | None) -> list[list[float]]:
    if not raw:
        return []
    points: list[list[float]] = []
    for token in raw.split():
        values = token.split(",")
        if len(values) != 2:
            continue
        try:
            points.append([float(values[0]), float(values[1])])
        except ValueError:
            continue
    return points


def _pagexml_region_order(page: ET.Element) -> dict[str, int]:
    order: dict[str, int] = {}
    for element in page.iter():
        if _local_name(element.tag) != "RegionRefIndexed":
            continue
        provider_id = element.get("regionRef")
        index = _positive_or_zero_int(element.get("index"))
        if provider_id and index is not None and provider_id not in order:
            order[provider_id] = index
    return order


def _positive_or_zero_int(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _pagexml_raw_class(element: ET.Element) -> str:
    explicit = element.get("type")
    if explicit:
        return explicit
    custom = element.get("custom") or ""
    match = re.search(r"(?:type|structure)\s*[:=]\s*([A-Za-z_-]+)", custom)
    if match:
        return match.group(1)
    return _local_name(element.tag)


def _element_confidence(element: ET.Element) -> float | None:
    direct = _confidence(element.get("conf"))
    if direct is not None:
        return direct
    coords = next(
        (
            child
            for child in list(element)
            if _local_name(child.tag) == "Coords"
        ),
        None,
    )
    return _confidence(coords.get("conf")) if coords is not None else None


def _element_geometry_key(element: ET.Element) -> tuple[float, float, float, float]:
    coords = next(
        (
            child
            for child in list(element)
            if _local_name(child.tag) == "Coords"
        ),
        None,
    )
    return _geometry_key(
        _parse_pagexml_points(coords.get("points") if coords is not None else None)
    )
