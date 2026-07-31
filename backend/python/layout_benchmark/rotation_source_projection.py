from __future__ import annotations

import copy
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .paths import BACKEND_ROOT, RUNS_ROOT, backend_relative
from .page_mask_stage import (
    ENGINE_INPUT_FILENAME,
    INPUT_STAGE_FILENAME,
    INPUT_STAGE_TYPE,
    PAGE_MASK_FILENAME,
)
from .preparation import (
    RASTER_FINGERPRINT_ALGORITHM,
    fingerprint_prepared_png,
)
from .rotation_ensemble import (
    COORDINATE_TRANSFORM_VERSION,
    MERGE_POLICIES,
    PASS_STATUSES,
    ROTATION_EVIDENCE_CONTRACT,
    merge_rotation_passes,
    validate_merge_selection_parameters,
    validate_rotations,
)
from .util import (
    BenchmarkError,
    canonical_json_bytes,
    ensure_safe_id,
    read_json,
    run_capture,
    sha256_bytes,
    sha256_file,
)


RAW_SCHEMA_VERSION = 1
RAW_KIND = "RotationSourceProjectionEvidence"
SOURCE_BINDING_KEY = "rotationEvidence"
ADAPTER_NAME = "layout-run-rotation-projection"
SOURCE_EVIDENCE_KEY = "sourceEvidence"
PAGE_MASK_ARTIFACTS_KEY = "pageMaskArtifacts"
PAGE_MASK_INHERITANCE_CONTRACT = "copy-and-bind-v1"
PAGE_MASK_ARTIFACT_KINDS = {
    "pageMask": PAGE_MASK_FILENAME,
    "engineInput": ENGINE_INPUT_FILENAME,
    "inputStage": INPUT_STAGE_FILENAME,
}


@dataclass(frozen=True)
class RotationSourceBinding:
    role: str
    run_id: str
    expected_engine_id: str
    expected_adapter_version: str
    expected_manifest_sha256: str
    expected_rotations: tuple[int, ...]
    run_directory: Path
    manifest_path: Path
    manifest: dict[str, Any]


@dataclass(frozen=True)
class RotationSourceContext:
    binding: RotationSourceBinding
    cohort_sha256: str
    preprocessing_sha256: str
    selected_page_keys: tuple[str, ...]


def external_snapshot_paths(
    config: dict[str, Any],
    *,
    runs_root: Path = RUNS_ROOT,
) -> tuple[Path, ...]:
    """Return every external raw/error artifact needed to replay a projection."""
    binding = _load_binding(config, runs_root=runs_root)
    inherit_page_mask = inherits_page_mask_artifacts(config)
    paths = {binding.manifest_path}
    for page in binding.manifest.get("pages", []):
        if not isinstance(page, dict):
            continue
        artifacts = page.get("artifacts")
        if not isinstance(artifacts, dict):
            continue
        reference = artifacts.get("raw") or artifacts.get("error")
        if isinstance(reference, str):
            paths.add(
                _resolve_source_artifact(
                    binding,
                    reference,
                    verify_integrity=True,
                )
            )
        if page.get("status") == "succeeded" and inherit_page_mask:
            for path in _verified_page_mask_artifacts(
                binding,
                page_key=str(page.get("pageKey", "")),
                page=page,
                raw=None,
            )["paths"].values():
                paths.add(path)
    return tuple(sorted(paths, key=backend_relative))


def inherits_page_mask_artifacts(config: dict[str, Any]) -> bool:
    source_evidence = config.get(SOURCE_EVIDENCE_KEY)
    if source_evidence is None:
        return False
    if (
        config.get("adapter") != ADAPTER_NAME
        or source_evidence
        != {
            PAGE_MASK_ARTIFACTS_KEY: PAGE_MASK_INHERITANCE_CONTRACT,
        }
    ):
        raise BenchmarkError(
            "configuration",
            "ROTATION_SOURCE_EVIDENCE_CONFIG_INVALID",
            (
                "Rotation sourceEvidence must explicitly declare "
                f"{PAGE_MASK_ARTIFACTS_KEY}="
                f"{PAGE_MASK_INHERITANCE_CONTRACT}"
            ),
        )
    return True


def load_source_context(
    config: dict[str, Any],
    *,
    runs_root: Path = RUNS_ROOT,
    validate_authoritatively: bool = True,
) -> RotationSourceContext:
    binding = _load_binding(config, runs_root=runs_root)
    if validate_authoritatively:
        _validate_with_authoritative_runner(binding)
    manifest = binding.manifest
    source_state = manifest.get("state")
    if source_state not in {"completed", "completed_with_failures"}:
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_RUN_INCOMPLETE",
            (
                "Rotation source run is not in a terminal published state: "
                f"{binding.run_id}"
            ),
        )
    _validate_source_engine_contract(binding)
    if inherits_page_mask_artifacts(config):
        source_values = (
            binding.manifest.get("engine", {})
            .get("configuration", {})
            .get("values", {})
        )
        source_input_stage = (
            source_values.get("inputStage")
            if isinstance(source_values, dict)
            else None
        )
        if (
            not isinstance(source_input_stage, dict)
            or source_input_stage.get("type") != INPUT_STAGE_TYPE
        ):
            raise BenchmarkError(
                "engine-preflight",
                "ROTATION_SOURCE_PAGE_MASK_CONTRACT_MISMATCH",
                (
                    "The configured source run does not declare an "
                    "Eynollah page-mask input stage"
                ),
            )
    _projection_parameters(config, binding)
    page_keys = _selection_page_keys(binding)
    return RotationSourceContext(
        binding=binding,
        cohort_sha256=str(manifest["cohort"]["sha256"]),
        preprocessing_sha256=str(
            manifest["preprocessing"]["profileSha256"]
        ),
        selected_page_keys=page_keys,
    )


def source_context_metadata(
    context: RotationSourceContext,
) -> dict[str, Any]:
    successful_pages = sum(
        1
        for page in context.binding.manifest.get("pages", [])
        if isinstance(page, dict) and page.get("status") == "succeeded"
    )
    return {
        "role": context.binding.role,
        "runId": context.binding.run_id,
        "engineId": context.binding.expected_engine_id,
        "adapterVersion": context.binding.expected_adapter_version,
        "manifestSha256": context.binding.expected_manifest_sha256,
        "rotationsDegrees": list(context.binding.expected_rotations),
        "rotationEvidenceContract": ROTATION_EVIDENCE_CONTRACT,
        "cohortSha256": context.cohort_sha256,
        "preprocessingProfileSha256": context.preprocessing_sha256,
        "selectedPages": len(context.selected_page_keys),
        "successfulSourcePages": successful_pages,
    }


def compose_page_evidence(
    context: RotationSourceContext,
    config: dict[str, Any],
    *,
    page_key: str,
    prepared_path: Path,
) -> dict[str, Any]:
    ensure_safe_id(page_key, "pageKey")
    if page_key not in context.selected_page_keys:
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PAGE_NOT_SELECTED",
            f"{page_key} is not present in the configured source run",
        )
    inputs = _verified_page_inputs(
        context.binding,
        page_key,
        expected_target_path=prepared_path,
        inherit_page_mask=inherits_page_mask_artifacts(config),
    )
    source_raw = inputs["raw"]
    source_records = source_raw["rotationPasses"]
    source_by_rotation = {
        int(record["rotationDegrees"]): record for record in source_records
    }
    parameters = _projection_parameters(config, context.binding)
    selected_rotations = parameters["sourceRotationsDegrees"]
    selected_records = [
        source_by_rotation[rotation] for rotation in selected_rotations
    ]
    baseline_record = source_by_rotation[0]
    if (
        parameters["requireSuccessfulBaselinePass"]
        and baseline_record["status"] != "succeeded"
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_BASELINE_NOT_SUCCEEDED",
            (
                f"The source 0 degree pass for {page_key} was "
                f"{baseline_record['status']}"
            ),
        )
    pass_outcomes = [
        {
            "rotationDegrees": record["rotationDegrees"],
            "status": record["status"],
            "error": copy.deepcopy(record.get("error")),
            "attempts": copy.deepcopy(record.get("attempts", [])),
            "fallback": copy.deepcopy(record.get("fallback")),
        }
        for record in selected_records
    ]
    result = merge_rotation_passes(
        [
            copy.deepcopy(record["nativeSegmentation"])
            for record in selected_records
        ],
        rotations=selected_rotations,
        source_width=inputs["width"],
        source_height=inputs["height"],
        merge_policy=parameters["rotationMergePolicy"],
        pass_outcomes=pass_outcomes,
        selection_parameters=parameters.get("selectionParameters"),
    )
    if result.get("qualityError") is not None:
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PROJECTION_QUALITY_FAILURE",
            str(result["qualityError"].get("message")),
            copy.deepcopy(result["qualityError"]),
        )
    projection_checks: list[dict[str, Any]] = []
    for source_record, projected_record in zip(
        selected_records,
        result["rotationPasses"],
        strict=True,
    ):
        native_equal = (
            canonical_json_bytes(source_record["nativeSegmentation"])
            == canonical_json_bytes(projected_record["nativeSegmentation"])
        )
        source_projection_equal = (
            canonical_json_bytes(
                source_record["sourceProjectedSegmentation"]
            )
            == canonical_json_bytes(
                projected_record["sourceProjectedSegmentation"]
            )
        )
        if not native_equal or not source_projection_equal:
            raise BenchmarkError(
                "engine-composition",
                "ROTATION_SOURCE_COORDINATE_PROJECTION_MISMATCH",
                (
                    "Reprojecting untouched native evidence did not reproduce "
                    f"the frozen {source_record['rotationDegrees']} degree "
                    "source-coordinate evidence"
                ),
                {
                    "rotationDegrees": source_record["rotationDegrees"],
                    "nativeEqual": native_equal,
                    "sourceProjectionEqual": source_projection_equal,
                },
            )
        projection_checks.append(
            {
                "rotationDegrees": source_record["rotationDegrees"],
                "status": source_record["status"],
                "nativeSegmentationExact": native_equal,
                "sourceProjectedSegmentationExact": source_projection_equal,
                "displayEligible": source_record["status"] == "succeeded",
            }
        )
    successful_rotations = {
        int(record["rotationDegrees"])
        for record in selected_records
        if record["status"] == "succeeded"
    }
    for line in result["segmentation"]["lines"]:
        evidence = line.get("ensembleEvidence")
        rotations = (
            evidence.get("sourceRotationsDegrees")
            if isinstance(evidence, dict)
            else None
        )
        if (
            not isinstance(rotations, list)
            or any(rotation not in successful_rotations for rotation in rotations)
        ):
            raise BenchmarkError(
                "engine-composition",
                "ROTATION_INELIGIBLE_PASS_GEOMETRY_DISPLAYED",
                "A partial or failed source pass contributed displayed geometry",
            )
    inherited_page_mask = inputs.get("inheritedPageMask")
    if isinstance(inherited_page_mask, dict):
        _copy_inherited_page_mask_artifacts(
            inherited_page_mask,
            target_directory=prepared_path.parent,
        )
    evidence = {
        "schemaVersion": RAW_SCHEMA_VERSION,
        "kind": RAW_KIND,
        "provider": config["provider"],
        "providerVersion": config["package"]["version"],
        "api": "immutable-source-run-rotation-projection",
        "inferenceProvider": "pure-python-geometry-no-model-inference",
        "runtimeInference": {
            "provider": "deterministic-native-evidence-reprojection",
            "coordinateTransform": COORDINATE_TRANSFORM_VERSION,
            "modelInferencePerformed": False,
        },
        "model": copy.deepcopy(source_raw.get("model")),
        "parameters": copy.deepcopy(parameters),
        "timings": {
            "modelLoadMs": None,
            "inferenceMs": None,
            "rotationPasses": None,
        },
        "image": copy.deepcopy(source_raw["image"]),
        "segmentation": result["segmentation"],
        "rotationPasses": result["rotationPasses"],
        "sourceBinding": {
            "role": context.binding.role,
            "runId": context.binding.run_id,
            "engineId": context.binding.expected_engine_id,
            "adapterVersion": context.binding.expected_adapter_version,
            "manifestPath": backend_relative(context.binding.manifest_path),
            "manifestSha256": context.binding.expected_manifest_sha256,
            "rawPath": backend_relative(inputs["rawPath"]),
            "rawReference": inputs["rawReference"],
            "rawSha256": inputs["rawSha256"],
            "rawSizeBytes": inputs["rawPath"].stat().st_size,
            "preparedReference": inputs["preparedReference"],
            "preparedSha256": inputs["preparedSha256"],
            "rasterFingerprint": {
                "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                "sha256": inputs["rasterFingerprint"],
            },
        },
        "projection": {
            "selectedRotationsDegrees": list(selected_rotations),
            "mergePolicy": parameters["rotationMergePolicy"],
            "selectionParameters": copy.deepcopy(
                parameters.get("selectionParameters")
            ),
            "sourcePassStatuses": [
                {
                    "rotationDegrees": record["rotationDegrees"],
                    "status": record["status"],
                }
                for record in selected_records
            ],
            "checks": projection_checks,
            "partialAndFailedGeometryDisplayEligible": False,
        },
        "sourceRawEvidence": copy.deepcopy(source_raw),
    }
    if isinstance(inherited_page_mask, dict):
        evidence["inputStage"] = copy.deepcopy(source_raw["inputStage"])
        evidence["sourceBinding"]["inheritedPageMask"] = {
            "contract": PAGE_MASK_INHERITANCE_CONTRACT,
            "artifacts": {
                kind: {
                    "sourceReference": inherited_page_mask["references"][kind],
                    "sourceSha256": inherited_page_mask["metadata"][kind][
                        "sha256"
                    ],
                    "sourceSizeBytes": inherited_page_mask["metadata"][kind][
                        "sizeBytes"
                    ],
                    "derivedFilename": PAGE_MASK_ARTIFACT_KINDS[kind],
                    "copyExact": True,
                }
                for kind in PAGE_MASK_ARTIFACT_KINDS
            },
        }
    return evidence


def _projection_parameters(
    config: dict[str, Any],
    binding: RotationSourceBinding,
) -> dict[str, Any]:
    raw = config.get("parameters")
    if not isinstance(raw, dict):
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            "Rotation projection parameters must be an object",
        )
    rotations_raw = raw.get("sourceRotationsDegrees")
    if not isinstance(rotations_raw, list):
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            "sourceRotationsDegrees must be an array",
        )
    try:
        rotations = validate_rotations(rotations_raw)
    except (TypeError, ValueError) as exc:
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            str(exc),
        ) from exc
    if any(rotation not in binding.expected_rotations for rotation in rotations):
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_ROTATION_UNAVAILABLE",
            "A selected projection rotation is absent from the source run",
        )
    merge_policy = raw.get("rotationMergePolicy")
    if merge_policy not in MERGE_POLICIES:
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            f"Unknown rotation merge policy {merge_policy!r}",
        )
    if raw.get("requireSuccessfulBaselinePass") is not True:
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            "requireSuccessfulBaselinePass must be true",
        )
    parameters = {
        "sourceRotationsDegrees": rotations,
        "rotationMergePolicy": merge_policy,
        "requireSuccessfulBaselinePass": True,
    }
    if "selectionParameters" in raw:
        if not isinstance(raw["selectionParameters"], dict):
            raise BenchmarkError(
                "configuration",
                "ROTATION_PROJECTION_PARAMETERS_INVALID",
                "selectionParameters must be an object",
            )
        parameters["selectionParameters"] = copy.deepcopy(
            raw["selectionParameters"]
        )
    try:
        validate_merge_selection_parameters(
            merge_policy,
            parameters.get("selectionParameters"),
        )
    except ValueError as exc:
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
            str(exc),
        ) from exc
    return parameters


def _load_binding(
    config: dict[str, Any],
    *,
    runs_root: Path,
) -> RotationSourceBinding:
    if config.get("adapter") != ADAPTER_NAME:
        raise BenchmarkError(
            "configuration",
            "ROTATION_PROJECTION_ADAPTER_INVALID",
            f"Expected adapter {ADAPTER_NAME}",
        )
    source_runs = config.get("sourceRuns")
    value = (
        source_runs.get(SOURCE_BINDING_KEY)
        if isinstance(source_runs, dict)
        else None
    )
    if not isinstance(value, dict):
        raise BenchmarkError(
            "configuration",
            "ROTATION_SOURCE_RUN_INVALID",
            f"Missing sourceRuns.{SOURCE_BINDING_KEY}",
        )
    run_id = ensure_safe_id(str(value.get("runId", "")), "rotation runId")
    expected_engine_id = ensure_safe_id(
        str(value.get("expectedEngineId", "")),
        "rotation expectedEngineId",
    )
    expected_adapter_version = str(value.get("expectedAdapterVersion", ""))
    role = str(value.get("role", ""))
    manifest_sha256 = str(value.get("manifestSha256", ""))
    rotations_raw = value.get("expectedRotationsDegrees")
    try:
        rotations = (
            validate_rotations(rotations_raw)
            if isinstance(rotations_raw, list)
            else ()
        )
    except (TypeError, ValueError) as exc:
        raise BenchmarkError(
            "configuration",
            "ROTATION_SOURCE_RUN_INVALID",
            f"Invalid expected rotations: {exc}",
        ) from exc
    if (
        role != "rotation-native-evidence"
        or not expected_adapter_version
        or not re.fullmatch(r"[a-f0-9]{64}", manifest_sha256)
        or not rotations
    ):
        raise BenchmarkError(
            "configuration",
            "ROTATION_SOURCE_RUN_INVALID",
            "Rotation source binding metadata is incomplete or invalid",
        )
    run_directory = runs_root.resolve() / run_id
    manifest_path = run_directory / "run.v2.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_MANIFEST_MISSING",
            f"Configured source manifest does not exist: {run_id}",
        )
    observed_sha256 = sha256_file(manifest_path)
    if observed_sha256 != manifest_sha256:
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_MANIFEST_CHECKSUM_MISMATCH",
            f"Configured source manifest changed: {run_id}",
            {
                "expectedSha256": manifest_sha256,
                "observedSha256": observed_sha256,
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
            "ROTATION_SOURCE_MANIFEST_INVALID",
            f"Configured source manifest identity is invalid: {run_id}",
        )
    return RotationSourceBinding(
        role=role,
        run_id=run_id,
        expected_engine_id=expected_engine_id,
        expected_adapter_version=expected_adapter_version,
        expected_manifest_sha256=manifest_sha256,
        expected_rotations=rotations,
        run_directory=run_directory,
        manifest_path=manifest_path,
        manifest=manifest,
    )


def _validate_source_engine_contract(
    binding: RotationSourceBinding,
) -> None:
    engine = binding.manifest.get("engine")
    configuration = engine.get("configuration") if isinstance(engine, dict) else None
    values = (
        configuration.get("values")
        if isinstance(configuration, dict)
        else None
    )
    parameters = values.get("parameters") if isinstance(values, dict) else None
    if (
        not isinstance(engine, dict)
        or engine.get("adapterVersion") != binding.expected_adapter_version
        or not isinstance(values, dict)
        or values.get("rotationEvidenceContract")
        != ROTATION_EVIDENCE_CONTRACT
        or not isinstance(parameters, dict)
        or parameters.get("rotationsDegrees")
        != list(binding.expected_rotations)
    ):
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_EVIDENCE_CONTRACT_MISMATCH",
            (
                "Source run does not match the pinned adapter version, "
                "rotation list, and native/source-projected evidence contract"
            ),
        )


def _verified_page_inputs(
    binding: RotationSourceBinding,
    page_key: str,
    *,
    expected_target_path: Path,
    inherit_page_mask: bool = False,
) -> dict[str, Any]:
    page = _source_page(binding, page_key)
    prepared = page.get("prepared")
    artifacts = page.get("artifacts")
    if (
        page.get("status") != "succeeded"
        or not isinstance(prepared, dict)
        or not isinstance(artifacts, dict)
        or not isinstance(artifacts.get("raw"), str)
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PAGE_UNAVAILABLE",
            f"Source run has no successful raw page {page_key}",
            {"sourceError": page.get("error")},
        )
    width = int(prepared["width"])
    height = int(prepared["height"])
    prepared_path = _resolve_source_artifact(
        binding,
        str(prepared["artifact"]),
        verify_integrity=True,
    )
    raw_reference = str(artifacts["raw"])
    raw_path = _resolve_source_artifact(
        binding,
        raw_reference,
        verify_integrity=True,
    )
    raw = read_json(raw_path)
    _validate_page_raw_contract(
        binding,
        page_key=page_key,
        raw=raw,
        width=width,
        height=height,
    )
    raster = fingerprint_prepared_png(
        prepared_path,
        expected_width=width,
        expected_height=height,
    )
    declared_raster = prepared.get("rasterFingerprint")
    if (
        not isinstance(declared_raster, dict)
        or declared_raster.get("algorithm") != RASTER_FINGERPRINT_ALGORITHM
        or declared_raster.get("sha256") != raster
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PREPARED_FINGERPRINT_MISMATCH",
            f"Source prepared fingerprint is invalid for {page_key}",
        )
    target_raster = fingerprint_prepared_png(
        expected_target_path,
        expected_width=width,
        expected_height=height,
    )
    if target_raster != raster:
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_TARGET_PREPARED_RASTER_MISMATCH",
            f"Derived prepared raster differs from the source for {page_key}",
        )
    inherited_page_mask = (
        _verified_page_mask_artifacts(
            binding,
            page_key=page_key,
            page=page,
            raw=raw,
        )
        if inherit_page_mask
        else None
    )
    return {
        "page": page,
        "preparedPath": prepared_path,
        "preparedReference": str(prepared["artifact"]),
        "preparedSha256": str(prepared["sha256"]),
        "rawPath": raw_path,
        "rawReference": raw_reference,
        "rawSha256": sha256_file(raw_path),
        "raw": raw,
        "width": width,
        "height": height,
        "rasterFingerprint": raster,
        "inheritedPageMask": inherited_page_mask,
    }


def _verified_page_mask_artifacts(
    binding: RotationSourceBinding,
    *,
    page_key: str,
    page: dict[str, Any],
    raw: dict[str, Any] | None,
) -> dict[str, Any]:
    artifacts = page.get("artifacts")
    if not isinstance(artifacts, dict):
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_PAGE_MASK_ARTIFACTS_MISSING",
            f"Source page-mask artifacts are unavailable for {page_key}",
        )
    references: dict[str, str] = {}
    paths: dict[str, Path] = {}
    metadata: dict[str, dict[str, Any]] = {}
    integrity = binding.manifest.get("integrity", {}).get("artifacts", {})
    for kind, filename in PAGE_MASK_ARTIFACT_KINDS.items():
        reference = artifacts.get(kind)
        if (
            not isinstance(reference, str)
            or not reference.endswith(f"/{filename}")
        ):
            raise BenchmarkError(
                "engine-preflight",
                "ROTATION_SOURCE_PAGE_MASK_ARTIFACTS_MISSING",
                (
                    f"Source page {page_key} does not bind canonical "
                    f"{kind} evidence"
                ),
            )
        path = _resolve_source_artifact(
            binding,
            reference,
            verify_integrity=True,
        )
        declared = (
            integrity.get(reference)
            if isinstance(integrity, dict)
            else None
        )
        if not isinstance(declared, dict):
            raise BenchmarkError(
                "engine-preflight",
                "ROTATION_SOURCE_PAGE_MASK_ARTIFACT_BINDING_INVALID",
                f"Source {kind} integrity metadata is missing for {page_key}",
            )
        references[kind] = reference
        paths[kind] = path
        metadata[kind] = copy.deepcopy(declared)

    if raw is None:
        return {
            "references": references,
            "paths": paths,
            "metadata": metadata,
        }

    stage = raw.get("inputStage")
    raw_image = raw.get("image")
    if (
        not isinstance(stage, dict)
        or stage.get("schemaVersion") != 1
        or stage.get("type") != INPUT_STAGE_TYPE
        or not isinstance(raw_image, dict)
        or raw_image.get("filename") != ENGINE_INPUT_FILENAME
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PAGE_MASK_EVIDENCE_INVALID",
            f"Source raw page-mask evidence is invalid for {page_key}",
        )
    try:
        raw_artifacts = stage["artifacts"]
        raw_metadata = {
            "pageMask": raw_artifacts["pageMask"],
            "engineInput": raw_artifacts["engineInput"],
            "inputStage": raw_artifacts["provenance"],
        }
        provenance = stage["provenance"]
        provenance_bytes = paths["inputStage"].read_bytes()
        standalone_provenance_equal = (
            canonical_json_bytes(provenance) == provenance_bytes
        )
        provenance_include_mask = provenance["includeMask"]["artifact"]
        provenance_engine_input = provenance["engineInput"]["artifact"]
    except (KeyError, OSError, TypeError) as exc:
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PAGE_MASK_EVIDENCE_INVALID",
            f"Source page-mask bindings are incomplete for {page_key}: {exc}",
        ) from exc

    for kind, filename in PAGE_MASK_ARTIFACT_KINDS.items():
        declared = raw_metadata.get(kind)
        observed = metadata[kind]
        if (
            not isinstance(declared, dict)
            or declared.get("filename") != filename
            or declared.get("sha256") != observed.get("sha256")
            or declared.get("sizeBytes") != observed.get("sizeBytes")
        ):
            raise BenchmarkError(
                "engine-composition",
                "ROTATION_SOURCE_PAGE_MASK_ARTIFACT_BINDING_INVALID",
                f"Source raw {kind} binding does not match {page_key}",
            )
    if (
        not standalone_provenance_equal
        or provenance_include_mask.get("sha256")
        != metadata["pageMask"].get("sha256")
        or provenance_include_mask.get("sizeBytes")
        != metadata["pageMask"].get("sizeBytes")
        or provenance_engine_input.get("sha256")
        != metadata["engineInput"].get("sha256")
        or provenance_engine_input.get("sizeBytes")
        != metadata["engineInput"].get("sizeBytes")
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_PAGE_MASK_ARTIFACT_BINDING_INVALID",
            (
                "Source standalone page-mask provenance does not match "
                f"the frozen artifacts for {page_key}"
            ),
        )
    return {
        "references": references,
        "paths": paths,
        "metadata": metadata,
    }


def _copy_inherited_page_mask_artifacts(
    inherited: dict[str, Any],
    *,
    target_directory: Path,
) -> None:
    pending: list[tuple[Path, Path]] = []
    try:
        for kind, filename in PAGE_MASK_ARTIFACT_KINDS.items():
            source = inherited["paths"][kind]
            expected = inherited["metadata"][kind]
            data = source.read_bytes()
            if (
                len(data) != expected["sizeBytes"]
                or sha256_bytes(data) != expected["sha256"]
            ):
                raise BenchmarkError(
                    "engine-composition",
                    "ROTATION_SOURCE_PAGE_MASK_ARTIFACT_CHANGED",
                    f"Source {kind} changed before it could be copied",
                )
            target = target_directory / filename
            temporary = target.with_name(
                f".{target.name}.tmp-{os.getpid()}-{kind}"
            )
            if target.exists() or target.is_symlink() or temporary.exists():
                raise BenchmarkError(
                    "engine-composition",
                    "ROTATION_PAGE_MASK_TARGET_UNSAFE",
                    f"Derived page-mask target already exists: {filename}",
                )
            with temporary.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            pending.append((temporary, target))
        for temporary, target in pending:
            os.replace(temporary, target)
        for kind, filename in PAGE_MASK_ARTIFACT_KINDS.items():
            target = target_directory / filename
            expected = inherited["metadata"][kind]
            if (
                target.stat().st_size != expected["sizeBytes"]
                or sha256_file(target) != expected["sha256"]
            ):
                raise BenchmarkError(
                    "engine-composition",
                    "ROTATION_PAGE_MASK_COPY_MISMATCH",
                    f"Derived {kind} is not an exact source copy",
                )
    finally:
        for temporary, _ in pending:
            temporary.unlink(missing_ok=True)


def _validate_page_raw_contract(
    binding: RotationSourceBinding,
    *,
    page_key: str,
    raw: Any,
    width: int,
    height: int,
) -> None:
    if not isinstance(raw, dict):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_RAW_INVALID",
            f"Source raw JSON is invalid for {page_key}",
        )
    image = raw.get("image")
    records = raw.get("rotationPasses")
    ensemble = raw.get("segmentation", {}).get("rotationEnsemble")
    if (
        not isinstance(image, dict)
        or image.get("width") != width
        or image.get("height") != height
        or not isinstance(records, list)
        or not isinstance(ensemble, dict)
        or ensemble.get("evidenceContract") != ROTATION_EVIDENCE_CONTRACT
        or ensemble.get("rotationsDegrees")
        != list(binding.expected_rotations)
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_RAW_INVALID",
            f"Source raw identity or ensemble contract is invalid for {page_key}",
        )
    if [record.get("rotationDegrees") for record in records] != list(
        binding.expected_rotations
    ):
        raise BenchmarkError(
            "engine-composition",
            "ROTATION_SOURCE_RAW_INVALID",
            f"Source pass order is invalid for {page_key}",
        )
    for record in records:
        rotation = int(record["rotationDegrees"])
        expected_native_width = height if rotation in (90, 270) else width
        expected_native_height = width if rotation in (90, 270) else height
        transform = record.get("coordinateTransform")
        native_image = record.get("nativeImage")
        source_image = record.get("sourceImage")
        if (
            record.get("evidenceContract") != ROTATION_EVIDENCE_CONTRACT
            or record.get("status") not in PASS_STATUSES
            or not isinstance(record.get("nativeSegmentation"), dict)
            or not isinstance(record.get("sourceProjectedSegmentation"), dict)
            or native_image
            != {
                "width": expected_native_width,
                "height": expected_native_height,
                "coordinateSpace": "rotated-input-pixels-top-left",
            }
            or source_image
            != {
                "width": width,
                "height": height,
                "coordinateSpace": "prepared-pixels-top-left",
            }
            or transform
            != {
                "version": COORDINATE_TRANSFORM_VERSION,
                "direction": "native-rotated-to-source",
            }
        ):
            raise BenchmarkError(
                "engine-composition",
                "ROTATION_SOURCE_PASS_CONTRACT_INVALID",
                f"Source {rotation} degree pass is invalid for {page_key}",
            )


def _resolve_source_artifact(
    binding: RotationSourceBinding,
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
            "ROTATION_SOURCE_ARTIFACT_PATH_INVALID",
            f"Unsafe source artifact path: {reference}",
        )
    root = binding.run_directory.resolve()
    lexical_path = root / reference
    if lexical_path.is_symlink():
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_ARTIFACT_SYMLINK_REJECTED",
            f"Source artifact cannot be a symlink: {reference}",
        )
    path = lexical_path.resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_ARTIFACT_ESCAPES_RUN",
            f"Source artifact escapes the run: {reference}",
        ) from exc
    if not path.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_ARTIFACT_MISSING",
            f"Source artifact is missing: {reference}",
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
                "ROTATION_SOURCE_ARTIFACT_INTEGRITY_MISMATCH",
                f"Source artifact failed integrity verification: {reference}",
            )
    return path


def _source_page(
    binding: RotationSourceBinding,
    page_key: str,
) -> dict[str, Any]:
    for page in binding.manifest.get("pages", []):
        if isinstance(page, dict) and page.get("pageKey") == page_key:
            return page
    raise BenchmarkError(
        "engine-composition",
        "ROTATION_SOURCE_PAGE_MISSING",
        f"Source run does not contain {page_key}",
    )


def _selection_page_keys(
    binding: RotationSourceBinding,
) -> tuple[str, ...]:
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
            "ROTATION_SOURCE_SELECTION_INVALID",
            "Source run has an invalid page selection",
        )
    return tuple(values)


def _validate_with_authoritative_runner(
    binding: RotationSourceBinding,
) -> None:
    validator = BACKEND_ROOT / "scripts" / "validate-layout-benchmark-run.ts"
    tsx = BACKEND_ROOT / "node_modules" / ".bin" / "tsx"
    if not validator.is_file() or not tsx.is_file():
        raise BenchmarkError(
            "engine-preflight",
            "ROTATION_SOURCE_VALIDATOR_UNAVAILABLE",
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
            "ROTATION_SOURCE_INTEGRITY_INVALID",
            f"Source run failed validation: {binding.run_id}",
            {
                "exitCode": result.returncode,
                "stdout": result.stdout[-10_000:],
                "stderr": result.stderr[-10_000:],
            },
        )
