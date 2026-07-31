from __future__ import annotations

import json
import math
import os
import secrets
import time

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .boundary_filter import SourceContext, compose_page_evidence
from .page_mask_input import (
    MAX_ABS_PADDING_PIXELS,
    VerifiedPageBoundary,
    build_masked_kraken_input,
)
from .paths import resolve_backend_relative
from .util import (
    BenchmarkError,
    canonical_json_bytes,
    sha256_bytes,
    sha256_file,
    write_json,
)


INPUT_STAGE_TYPE = "eynollah-page-mask"
INPUT_STAGE_SCHEMA_VERSION = 1
PAGE_MASK_FILENAME = "page-mask.png"
ENGINE_INPUT_FILENAME = "engine-input.png"
INPUT_STAGE_FILENAME = "input-stage.v1.json"
PAGE_MASK_ARTIFACT_NAMES = {
    "pageMask": PAGE_MASK_FILENAME,
    "engineInput": ENGINE_INPUT_FILENAME,
    "inputStage": INPUT_STAGE_FILENAME,
}


@dataclass(frozen=True)
class PreparedPageMaskStage:
    engine_input_path: Path
    raw_evidence_json: bytes
    duration_ms: int


def is_eynollah_page_mask_config(config: dict[str, Any]) -> bool:
    input_stage = config.get("inputStage")
    return (
        isinstance(input_stage, dict)
        and input_stage.get("type") == INPUT_STAGE_TYPE
    )


def validate_eynollah_page_mask_config(
    config: dict[str, Any],
) -> dict[str, Any]:
    input_stage = _validated_input_stage(config)
    padding = input_stage["paddingPixels"]
    control = input_stage["controlProjection"]
    if (
        abs(padding) > MAX_ABS_PADDING_PIXELS
        or control.get("geometryPreference")
        != ["native-baseline", "native-boundary"]
        or not isinstance(control.get("sampleSpacingPixels"), (int, float))
        or isinstance(control.get("sampleSpacingPixels"), bool)
        or not math.isfinite(float(control["sampleSpacingPixels"]))
        or float(control["sampleSpacingPixels"]) <= 0
        or not isinstance(
            control.get("insideRatioThresholdExclusive"),
            (int, float),
        )
        or isinstance(
            control.get("insideRatioThresholdExclusive"),
            bool,
        )
        or not math.isfinite(
            float(control["insideRatioThresholdExclusive"])
        )
        or not 0
        <= float(control["insideRatioThresholdExclusive"])
        < 1
        or control.get("pointOnBoundaryCountsInside") is not True
        or control.get("coordinateTransform") != "identity"
    ):
        raise BenchmarkError(
            "configuration",
            "INVALID_PAGE_MASK_INPUT_STAGE",
            "Eynollah page-mask padding or control projection is unsupported",
        )
    return input_stage


def page_mask_artifact_paths(page_directory: Path) -> dict[str, Path]:
    return {
        kind: page_directory / filename
        for kind, filename in PAGE_MASK_ARTIFACT_NAMES.items()
    }


def prepare_eynollah_page_mask_stage(
    context: SourceContext,
    config: dict[str, Any],
    *,
    page_key: str,
    prepared_path: Path,
) -> PreparedPageMaskStage:
    started = time.perf_counter()
    input_stage = validate_eynollah_page_mask_config(config)
    control_config = {
        "engineId": config["engineId"],
        "parameters": input_stage["controlProjection"],
    }
    control_evidence = compose_page_evidence(
        context,
        control_config,
        page_key=page_key,
        prepared_path=prepared_path,
    )
    boundary_binding = control_evidence["sourceBindings"]["pageBoundary"]
    normalized_artifact = boundary_binding["normalizedLayout"]
    prepared_binding = boundary_binding["prepared"]
    try:
        normalized_path = resolve_backend_relative(
            normalized_artifact["backendPath"]
        )
        normalized_bytes = normalized_path.read_bytes()
        boundary = VerifiedPageBoundary.from_normalized_layout(
            normalized_bytes,
            expected_page_key=page_key,
            expected_run_id=boundary_binding["runId"],
            expected_engine_id=boundary_binding["engineId"],
            expected_manifest_sha256=boundary_binding["manifest"]["sha256"],
            expected_normalized_artifact_sha256=normalized_artifact[
                "sha256"
            ],
            normalized_artifact_reference=normalized_artifact["artifact"],
            verified_prepared_raster_sha256=prepared_binding[
                "rasterFingerprint"
            ]["sha256"],
        )
        artifacts = build_masked_kraken_input(
            prepared_path,
            boundary,
            page_key=page_key,
            padding_pixels=input_stage["paddingPixels"],
        )
    except (KeyError, OSError, TypeError, ValueError) as exc:
        raise BenchmarkError(
            "input-stage",
            "PAGE_MASK_INPUT_INVALID",
            f"Could not build source-bound page mask for {page_key}: {exc}",
        ) from exc

    page_directory = prepared_path.parent
    paths = page_mask_artifact_paths(page_directory)
    _write_verified_bytes(paths["pageMask"], artifacts.include_mask_png)
    _write_verified_bytes(paths["engineInput"], artifacts.engine_input_png)
    _write_verified_bytes(paths["inputStage"], artifacts.provenance_json)
    duration_ms = round((time.perf_counter() - started) * 1000)

    provenance = json.loads(artifacts.provenance_json)
    raw_evidence = {
        "schemaVersion": INPUT_STAGE_SCHEMA_VERSION,
        "type": INPUT_STAGE_TYPE,
        "durationMs": duration_ms,
        "policy": {
            "paddingPixels": input_stage["paddingPixels"],
            "paddingMetric": "chebyshev",
            "outsideFill": "opaque-white",
            "coordinateTransform": "identity",
            "krakenInput": ENGINE_INPUT_FILENAME,
            "unmaskedControlRole": "lineGeometry",
            "pageBoundaryRole": "pageBoundary",
        },
        "artifacts": {
            "pageMask": {
                "filename": PAGE_MASK_FILENAME,
                **provenance["includeMask"]["artifact"],
            },
            "engineInput": {
                "filename": ENGINE_INPUT_FILENAME,
                **provenance["engineInput"]["artifact"],
            },
            "provenance": {
                "filename": INPUT_STAGE_FILENAME,
                "sha256": sha256_bytes(artifacts.provenance_json),
                "sizeBytes": len(artifacts.provenance_json),
            },
        },
        "provenance": provenance,
        "controlEvidence": control_evidence,
    }
    return PreparedPageMaskStage(
        engine_input_path=paths["engineInput"],
        raw_evidence_json=canonical_json_bytes(raw_evidence),
        duration_ms=duration_ms,
    )


def attach_page_mask_evidence(
    raw_path: Path,
    stage: PreparedPageMaskStage,
) -> None:
    try:
        raw = json.loads(raw_path.read_bytes())
        evidence = json.loads(stage.raw_evidence_json)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkError(
            "input-stage",
            "PAGE_MASK_RAW_EVIDENCE_INVALID",
            f"Could not attach page-mask evidence to {raw_path.name}: {exc}",
        ) from exc
    if not isinstance(raw, dict) or "inputStage" in raw:
        raise BenchmarkError(
            "input-stage",
            "PAGE_MASK_RAW_EVIDENCE_INVALID",
            "Kraken raw output is not an unmodified JSON object",
        )
    _verify_persisted_stage_artifacts(stage, evidence)
    image = raw.get("image")
    if (
        not isinstance(image, dict)
        or image.get("filename") != stage.engine_input_path.name
    ):
        raise BenchmarkError(
            "input-stage",
            "KRAKEN_INPUT_ARTIFACT_MISMATCH",
            "Kraken raw output does not identify the masked engine input",
        )
    raw["inputStage"] = evidence
    write_json(raw_path, raw)


def _verify_persisted_stage_artifacts(
    stage: PreparedPageMaskStage,
    evidence: dict[str, Any],
) -> None:
    page_directory = stage.engine_input_path.parent
    try:
        artifacts = evidence["artifacts"]
        expected = {
            "pageMask": artifacts["pageMask"],
            "engineInput": artifacts["engineInput"],
            "provenance": artifacts["provenance"],
        }
    except (KeyError, TypeError) as exc:
        raise BenchmarkError(
            "input-stage",
            "PAGE_MASK_ARTIFACT_BINDING_INVALID",
            f"Page-mask artifact evidence is incomplete: {exc}",
        ) from exc

    for kind, metadata in expected.items():
        if (
            not isinstance(metadata, dict)
            or not isinstance(metadata.get("filename"), str)
            or not isinstance(metadata.get("sha256"), str)
            or isinstance(metadata.get("sizeBytes"), bool)
            or not isinstance(metadata.get("sizeBytes"), int)
            or metadata["sizeBytes"] < 0
        ):
            raise BenchmarkError(
                "input-stage",
                "PAGE_MASK_ARTIFACT_BINDING_INVALID",
                f"Page-mask {kind} artifact metadata is invalid",
            )
        expected_filename = {
            "pageMask": PAGE_MASK_FILENAME,
            "engineInput": ENGINE_INPUT_FILENAME,
            "provenance": INPUT_STAGE_FILENAME,
        }[kind]
        if metadata["filename"] != expected_filename:
            raise BenchmarkError(
                "input-stage",
                "PAGE_MASK_ARTIFACT_BINDING_INVALID",
                f"Page-mask {kind} filename is not canonical",
            )
        path = page_directory / expected_filename
        if path.is_symlink() or not path.is_file():
            raise BenchmarkError(
                "input-stage",
                "PAGE_MASK_ARTIFACT_CHANGED",
                f"Page-mask artifact is missing or unsafe: {expected_filename}",
            )
        if (
            path.stat().st_size != metadata["sizeBytes"]
            or sha256_file(path) != metadata["sha256"]
        ):
            raise BenchmarkError(
                "input-stage",
                "PAGE_MASK_ARTIFACT_CHANGED",
                (
                    "Page-mask artifact changed after input preparation: "
                    f"{expected_filename}"
                ),
            )


def normalized_page_boundary_from_input_stage(
    raw: dict[str, Any],
    *,
    page_key: str,
    width: int,
    height: int,
    source_sha256: str,
    prepared_sha256: str,
) -> list[dict[str, int]] | None:
    stage = raw.get("inputStage")
    if stage is None:
        return None
    try:
        if (
            not isinstance(stage, dict)
            or stage["schemaVersion"] != INPUT_STAGE_SCHEMA_VERSION
            or stage["type"] != INPUT_STAGE_TYPE
        ):
            raise ValueError("input-stage contract identity is invalid")
        provenance = stage["provenance"]
        control = stage["controlEvidence"]
        source_binding = control["sourceBindings"]["pageBoundary"]
        source_layout = control["sourceLayouts"]["pageBoundary"]
        target = provenance["targetPrepared"]
        transform = provenance["coordinateTransform"]
        source_boundary = provenance["sourceBoundary"]
        artifacts = stage["artifacts"]
        raw_image = raw["image"]
        if (
            provenance["pageKey"] != page_key
            or target["encodedSha256"] != prepared_sha256
            or transform["name"] != "identity"
            or transform["width"] != width
            or transform["height"] != height
            or raw_image["filename"] != ENGINE_INPUT_FILENAME
            or raw_image["width"] != width
            or raw_image["height"] != height
        ):
            raise ValueError("masked input does not match the prepared page")
        image = source_layout["image"]
        if (
            source_layout["pageKey"] != page_key
            or source_layout["runId"] != source_binding["runId"]
            or source_layout["engineId"] != source_binding["engineId"]
            or image["width"] != width
            or image["height"] != height
            or image["sourceSha256"] != source_sha256
            or image["preparedSha256"]
            != source_binding["prepared"]["encodedSha256"]
        ):
            raise ValueError("page-boundary source layout identity is invalid")
        if (
            source_boundary["runId"] != source_binding["runId"]
            or source_boundary["engineId"] != source_binding["engineId"]
            or source_boundary["manifestSha256"]
            != source_binding["manifest"]["sha256"]
            or source_boundary["normalizedArtifactSha256"]
            != source_binding["normalizedLayout"]["sha256"]
            or artifacts["pageMask"]["sha256"]
            != provenance["includeMask"]["artifact"]["sha256"]
            or artifacts["engineInput"]["sha256"]
            != provenance["engineInput"]["artifact"]["sha256"]
        ):
            raise ValueError("page-mask source or artifact binding is invalid")
        warnings = source_layout["warnings"]
        if any(
            warning.get("code") == "PAGE_BOUNDARY_UNAVAILABLE"
            for warning in warnings
            if isinstance(warning, dict)
        ):
            raise ValueError("page-boundary source is an unavailable fallback")
        boundary = source_layout["pageBoundary"]
        expected_closed = source_boundary["boundary"]["closedPolygon"]
        if (
            not isinstance(boundary, list)
            or len(boundary) < 3
            or expected_closed != [*boundary, boundary[0]]
        ):
            raise ValueError("page-boundary geometry binding is invalid")
        if any(
            not isinstance(point, dict)
            or set(point) != {"x", "y"}
            or not isinstance(point["x"], int)
            or not isinstance(point["y"], int)
            or point["x"] < 0
            or point["x"] >= width
            or point["y"] < 0
            or point["y"] >= height
            for point in boundary
        ):
            raise ValueError("page-boundary geometry is outside the image")
    except (KeyError, TypeError, ValueError) as exc:
        raise BenchmarkError(
            "normalization",
            "INVALID_PAGE_MASK_INPUT_STAGE",
            f"Kraken page-mask input evidence is invalid: {exc}",
        ) from exc
    return [
        {"x": int(point["x"]), "y": int(point["y"])}
        for point in boundary
    ]


def _validated_input_stage(config: dict[str, Any]) -> dict[str, Any]:
    input_stage = config.get("inputStage")
    if (
        not isinstance(input_stage, dict)
        or set(input_stage)
        != {"type", "paddingPixels", "paddingMetric", "controlProjection"}
        or input_stage.get("type") != INPUT_STAGE_TYPE
        or input_stage.get("paddingMetric") != "chebyshev"
        or isinstance(input_stage.get("paddingPixels"), bool)
        or not isinstance(input_stage.get("paddingPixels"), int)
        or not isinstance(input_stage.get("controlProjection"), dict)
    ):
        raise BenchmarkError(
            "configuration",
            "INVALID_PAGE_MASK_INPUT_STAGE",
            (
                "Eynollah page-mask inputStage must explicitly declare type, "
                "integer paddingPixels, Chebyshev padding, and controlProjection"
            ),
        )
    return input_stage


def _write_verified_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.tmp-{os.getpid()}-{secrets.token_hex(4)}"
    )
    try:
        with temporary.open("xb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    if sha256_file(path) != sha256_bytes(value):
        raise BenchmarkError(
            "input-stage",
            "PAGE_MASK_ARTIFACT_WRITE_MISMATCH",
            f"Page-mask artifact checksum changed while writing {path.name}",
        )
