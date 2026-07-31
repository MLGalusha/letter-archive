from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import time
from pathlib import Path
from typing import Any, Iterable

from .cohort import CohortPage, load_cohort, select_pages
from .engines import ENGINE_IDS, EngineAdapter, EngineInvocation
from .normalization import normalize_provider_output
from .overlay import draw_overlay
from .paths import (
    BACKEND_ROOT,
    COHORT_PATH,
    PACKAGE_ROOT,
    PREPROCESSING_CONFIG_PATH,
    RUNS_ROOT,
    SMOKE_CONFIG_PATH,
    backend_relative,
    resolve_backend_relative,
)
from .preparation import (
    RASTER_FINGERPRINT_ALGORITHM,
    PreparedImage,
    fingerprint_prepared_png,
    prepare_page,
    preprocessing_metadata,
)
from .util import (
    BenchmarkError,
    canonical_json_bytes,
    docker_metadata,
    ensure_safe_id,
    generated_run_id,
    git_metadata,
    host_metadata,
    read_json,
    run_capture,
    sha256_file,
    utc_now,
    write_json,
)


def run_benchmark(
    *,
    engine_id: str,
    scope: str,
    explicit_page_keys: Iterable[str] = (),
    requested_run_id: str | None = None,
) -> dict[str, Any]:
    adapter = EngineAdapter(engine_id)
    cohort = load_cohort()
    pages, resolved_scope = select_pages(
        cohort, scope, explicit_page_keys=explicit_page_keys
    )
    run_id = ensure_safe_id(
        requested_run_id or generated_run_id(engine_id, resolved_scope),
        "runId",
    )
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    final_directory = RUNS_ROOT / run_id
    if final_directory.exists():
        raise BenchmarkError(
            "run-initialization",
            "RUN_ALREADY_EXISTS",
            f"Immutable run already exists: {run_id}",
        )
    staging_directory = RUNS_ROOT / (
        f".staging-{run_id}-{secrets.token_hex(6)}"
    )
    staging_directory.mkdir(parents=False, exist_ok=False)

    started_at = utc_now()
    run_started = time.perf_counter()
    start_git = git_metadata()
    source_snapshot = _create_source_snapshot(adapter, staging_directory)
    preprocessing = preprocessing_metadata()
    preflight_error: BenchmarkError | None = None
    initial_engine_identity: dict[str, Any] | None = None
    try:
        engine_metadata = adapter.preflight()
        initial_engine_identity = _engine_identity(engine_metadata)
    except BenchmarkError as exc:
        preflight_error = exc
        engine_metadata = _fallback_engine_metadata(adapter)
    engine_metadata["execution"]["dependencies"][
        "letter-archive-layout-adapter-bundle"
    ] = (
        f"sha256:{source_snapshot['bundleSha256']};"
        f"files={len(source_snapshot['files'])}"
    )

    page_results: list[dict[str, Any]] = []
    interrupted = False
    try:
        for page in pages:
            page_result = _process_page(
                adapter=adapter,
                page=page,
                run_id=run_id,
                run_directory=staging_directory,
                preflight_error=preflight_error,
            )
            page_results.append(page_result)
            if (
                isinstance(page_result.get("error"), dict)
                and page_result["error"].get("code") == "RUN_INTERRUPTED"
            ):
                interrupted = True
                break
    except KeyboardInterrupt:
        interrupted = True

    if interrupted:
        completed_keys = {page["pageKey"] for page in page_results}
        for page in pages:
            if page.page_key not in completed_keys:
                page_results.append(
                    _unprocessed_page_result(
                        page,
                        staging_directory,
                        BenchmarkError(
                            "orchestration",
                            "RUN_INTERRUPTED",
                            "Run was interrupted before this page started",
                        ),
                    )
                )

    _verify_source_snapshot(adapter, staging_directory, source_snapshot)
    if initial_engine_identity is not None:
        _verify_engine_identity(adapter, initial_engine_identity)

    completed_at = utc_now()
    duration_ms = _elapsed_ms(run_started)
    succeeded = sum(page["status"] == "succeeded" for page in page_results)
    failed = len(page_results) - succeeded
    state = "completed" if failed == 0 and not interrupted else "completed_with_failures"
    environment: dict[str, Any] = {
        "git": start_git,
        "host": host_metadata(),
        "platformCaveat": adapter.platform_caveat,
    }
    docker = docker_metadata()
    if docker is not None:
        environment["docker"] = docker
    integrity = _build_artifact_integrity(
        staging_directory,
        page_results,
        source_snapshot,
    )
    manifest = {
        "schemaVersion": 2,
        "runId": run_id,
        "state": state,
        "createdAt": started_at,
        "completedAt": completed_at,
        "sourceSnapshot": source_snapshot,
        "integrity": integrity,
        "cohort": {
            "id": cohort.cohort_id,
            "manifestPath": backend_relative(COHORT_PATH),
            "sha256": cohort.sha256,
            "selection": {
                "scope": resolved_scope,
                "pageKeys": [page.page_key for page in pages],
            },
        },
        "engine": engine_metadata,
        "preprocessing": preprocessing,
        "environment": environment,
        "pages": page_results,
        "summary": {
            "selected": len(pages),
            "succeeded": succeeded,
            "failed": failed,
            "durationMs": duration_ms,
        },
    }
    write_json(staging_directory / "run.v2.json", manifest)
    _validate_and_publish_staged_run(
        adapter,
        staging_directory,
        final_directory,
        run_id,
        source_snapshot,
    )
    return {
        "runId": run_id,
        "runDirectory": backend_relative(final_directory),
        "state": state,
        "selected": len(pages),
        "succeeded": succeeded,
        "failed": failed,
    }


def preflight_engines(engine_ids: Iterable[str]) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for engine_id in engine_ids:
        try:
            metadata = EngineAdapter(engine_id).preflight()
            results.append(
                {
                    "engineId": engine_id,
                    "status": "ready",
                    "metadata": metadata,
                    "error": None,
                }
            )
        except BenchmarkError as exc:
            results.append(
                {
                    "engineId": engine_id,
                    "status": "blocked",
                    "metadata": None,
                    "error": exc.as_dict(),
                }
            )
    return {
        "ready": all(result["status"] == "ready" for result in results),
        "engines": results,
    }


def setup_engines(engine_ids: Iterable[str]) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for engine_id in engine_ids:
        try:
            metadata = EngineAdapter(engine_id).setup()
            results.append(
                {
                    "engineId": engine_id,
                    "status": "ready",
                    "metadata": metadata,
                    "error": None,
                }
            )
        except BenchmarkError as exc:
            results.append(
                {
                    "engineId": engine_id,
                    "status": "blocked",
                    "metadata": None,
                    "error": exc.as_dict(),
                }
            )
    return {
        "ready": all(result["status"] == "ready" for result in results),
        "engines": results,
    }


def list_pages(scope: str) -> dict[str, Any]:
    cohort = load_cohort()
    pages, resolved_scope = select_pages(cohort, scope)
    return {
        "cohortId": cohort.cohort_id,
        "scope": resolved_scope,
        "count": len(pages),
        "pages": [
            {
                "pageKey": page.page_key,
                "filename": page.original_filename,
                "challengeTags": list(page.challenge_tags),
            }
            for page in pages
        ],
    }


def _prepared_raster_sha256(
    manifest: dict[str, Any],
    prepared: dict[str, Any],
    cache: dict[tuple[str, int, int], str],
) -> str:
    declared = prepared.get("rasterFingerprint")
    if declared is not None and (
        not isinstance(declared, dict)
        or declared.get("algorithm") != RASTER_FINGERPRINT_ALGORITHM
        or not isinstance(declared.get("sha256"), str)
    ):
        raise BenchmarkError(
            "comparison",
            "PREPARED_RASTER_FINGERPRINT_INVALID",
            "Prepared raster fingerprint metadata is malformed or unsupported",
        )

    width = int(prepared["width"])
    height = int(prepared["height"])
    encoded_sha256 = str(prepared["sha256"])
    cache_key = (encoded_sha256, width, height)

    run_id = ensure_safe_id(str(manifest["runId"]), "runId")
    prepared_path = _resolve_run_artifact(
        RUNS_ROOT / run_id,
        str(prepared["artifact"]),
    )
    # The encoded SHA remains the immutable artifact-integrity identity. This
    # fallback only supplies the missing, encoder-independent raster identity.
    if sha256_file(prepared_path) != encoded_sha256:
        raise BenchmarkError(
            "comparison",
            "PREPARED_ARTIFACT_CHECKSUM_MISMATCH",
            f"Prepared artifact checksum changed for {run_id}",
        )
    raster_sha256 = cache.get(cache_key)
    if raster_sha256 is None:
        raster_sha256 = fingerprint_prepared_png(
            prepared_path,
            expected_width=width,
            expected_height=height,
        )
        cache[cache_key] = raster_sha256
    if declared is not None and str(declared["sha256"]) != raster_sha256:
        raise BenchmarkError(
            "comparison",
            "PREPARED_RASTER_FINGERPRINT_MISMATCH",
            f"Declared prepared raster fingerprint does not match pixels for {run_id}",
        )
    return raster_sha256


def check_comparable(run_ids: Iterable[str]) -> dict[str, Any]:
    ids = tuple(run_ids)
    if len(ids) < 2:
        raise BenchmarkError(
            "comparison",
            "INSUFFICIENT_RUNS",
            "At least two run IDs are required",
        )
    manifests: list[dict[str, Any]] = []
    for run_id in ids:
        ensure_safe_id(run_id, "runId")
        path = RUNS_ROOT / run_id / "run.v2.json"
        manifest = read_json(path)
        if (
            not isinstance(manifest, dict)
            or manifest.get("schemaVersion") != 2
            or manifest.get("runId") != run_id
        ):
            raise BenchmarkError(
                "comparison",
                "INVALID_RUN_MANIFEST",
                f"Invalid run manifest for {run_id}",
            )
        manifests.append(manifest)

    reasons: list[dict[str, Any]] = []
    raster_cache: dict[tuple[str, int, int], str] = {}
    baseline = manifests[0]
    baseline_keys = baseline["cohort"]["selection"]["pageKeys"]
    baseline_profile = baseline["preprocessing"]["profileSha256"]
    baseline_cohort = baseline["cohort"]["sha256"]
    baseline_pages = {
        page["pageKey"]: page
        for page in baseline["pages"]
        if page["status"] == "succeeded"
    }
    for candidate in manifests[1:]:
        run_id = candidate["runId"]
        if candidate["cohort"]["sha256"] != baseline_cohort:
            reasons.append(
                {
                    "code": "COHORT_MISMATCH",
                    "runId": run_id,
                    "message": "Cohort manifest checksums differ.",
                }
            )
        if candidate["cohort"]["selection"]["pageKeys"] != baseline_keys:
            reasons.append(
                {
                    "code": "SELECTION_MISMATCH",
                    "runId": run_id,
                    "message": "Selected page keys or ordering differ.",
                }
            )
        if candidate["preprocessing"]["profileSha256"] != baseline_profile:
            reasons.append(
                {
                    "code": "PREPROCESSING_PROFILE_MISMATCH",
                    "runId": run_id,
                    "message": "Shared preprocessing profile checksums differ.",
                }
            )
        candidate_pages = {
            page["pageKey"]: page
            for page in candidate["pages"]
            if page["status"] == "succeeded"
        }
        for page_key in baseline_keys:
            left = baseline_pages.get(page_key)
            right = candidate_pages.get(page_key)
            if left is None or right is None:
                reasons.append(
                    {
                        "code": "PAGE_NOT_SUCCESSFUL",
                        "runId": run_id,
                        "pageKey": page_key,
                        "message": "Page did not succeed in both runs.",
                    }
                )
                continue
            left_prepared = left["prepared"]
            right_prepared = right["prepared"]
            if (
                _prepared_raster_sha256(
                    baseline,
                    left_prepared,
                    raster_cache,
                )
                != _prepared_raster_sha256(
                    candidate,
                    right_prepared,
                    raster_cache,
                )
                or left_prepared["width"] != right_prepared["width"]
                or left_prepared["height"] != right_prepared["height"]
            ):
                reasons.append(
                    {
                        "code": "PREPARED_INPUT_MISMATCH",
                        "runId": run_id,
                        "pageKey": page_key,
                        "message": (
                            "Prepared decoded RGB raster or dimensions differ."
                        ),
                    }
                )
    return {
        "comparable": not reasons,
        "runIds": list(ids),
        "pageKeys": baseline_keys,
        "reasons": reasons,
    }


def _process_page(
    *,
    adapter: EngineAdapter,
    page: CohortPage,
    run_id: str,
    run_directory: Path,
    preflight_error: BenchmarkError | None,
) -> dict[str, Any]:
    page_started_at = utc_now()
    page_started = time.perf_counter()
    page_directory = run_directory / "pages" / page.page_key
    page_directory.mkdir(parents=True, exist_ok=False)
    prepared_path = page_directory / "prepared.png"
    raw_path = page_directory / adapter.raw_filename
    normalized_path = page_directory / "normalized-layout.v1.json"
    overlay_path = page_directory / "overlay.png"
    error_path = page_directory / "error.json"
    additional_artifact_provider = getattr(
        adapter,
        "additional_page_artifacts",
        None,
    )
    additional_artifact_paths = (
        additional_artifact_provider(page_directory)
        if callable(additional_artifact_provider)
        else {}
    )

    timings = _empty_timings()
    warnings: list[dict[str, str]] = []
    quality_error: BenchmarkError | None = None
    artifacts: dict[str, str] = {}
    prepared: PreparedImage | None = None
    invocation: EngineInvocation | None = None
    error: BenchmarkError | None = None
    counts = {"regions": 0, "lines": 0}
    active_stage = "preparation"
    try:
        preparation_started = time.perf_counter()
        try:
            prepared = prepare_page(page, prepared_path)
        finally:
            timings["preparationMs"] = _elapsed_ms(preparation_started)
        active_stage = "engine-preflight"
        if preflight_error is not None:
            raise BenchmarkError(
                preflight_error.stage,
                preflight_error.code,
                preflight_error.message,
                preflight_error.details,
            )

        active_stage = "engine-inference"
        engine_started = time.perf_counter()
        try:
            invocation = adapter.run_page(page_directory)
        finally:
            timings["engineMs"] = _elapsed_ms(engine_started)
        timings["engineUserCpuMs"] = invocation.user_cpu_ms
        timings["engineSystemCpuMs"] = invocation.system_cpu_ms
        timings["inputStageMs"] = invocation.input_stage_ms
        if invocation.stderr:
            warnings.append(
                {
                    "code": "ENGINE_STDERR",
                    "message": invocation.stderr[-1900:],
                }
            )
        artifacts["raw"] = _run_relative(run_directory, raw_path)
        for kind, path in additional_artifact_paths.items():
            if not path.is_file():
                raise BenchmarkError(
                    "input-stage",
                    "PAGE_MASK_ARTIFACT_MISSING",
                    f"Input stage did not write required artifact {path.name}",
                )
            artifacts[kind] = _run_relative(run_directory, path)

        active_stage = "normalization"
        normalization_started = time.perf_counter()
        try:
            normalized = normalize_provider_output(
                engine_id=adapter.engine_id,
                run_id=run_id,
                page_key=page.page_key,
                raw_path=raw_path,
                width=prepared.width,
                height=prepared.height,
                source_sha256=page.checksum_sha256,
                prepared_sha256=prepared.sha256,
                page_boundary_available=adapter.page_boundary_available,
            )
            write_json(normalized_path, normalized)
        finally:
            timings["normalizationMs"] = _elapsed_ms(normalization_started)
        artifacts["normalized"] = _run_relative(
            run_directory, normalized_path
        )
        counts = {
            "regions": len(normalized["regions"]),
            "lines": len(normalized["lines"]),
        }
        warnings.extend(normalized["warnings"])
        active_stage = "overlay"
        overlay_started = time.perf_counter()
        try:
            draw_overlay(prepared_path, normalized, overlay_path)
        finally:
            timings["overlayMs"] = _elapsed_ms(overlay_started)
        artifacts["overlay"] = _run_relative(run_directory, overlay_path)

        if adapter.config["adapter"] == "kraken":
            raw = json.loads(raw_path.read_text(encoding="utf-8"))
            provider_timings = raw.get("timings", {})
            timings["providerModelLoadMs"] = _nullable_milliseconds(
                provider_timings.get("modelLoadMs")
            )
            timings["providerInferenceMs"] = _nullable_milliseconds(
                provider_timings.get("inferenceMs")
            )
            raw_lines = raw.get("segmentation", {}).get("lines", [])
            quality_error = _layout_quality_error(
                adapter,
                normalized,
                observed_provider_line_count=(
                    len(raw_lines) if isinstance(raw_lines, list) else None
                ),
            )
        if quality_error is not None:
            raise quality_error
    except KeyboardInterrupt:
        error = BenchmarkError(
            "orchestration",
            "RUN_INTERRUPTED",
            f"Run was interrupted while processing {page.page_key}",
            {"interruptedStage": active_stage},
        )
    except BenchmarkError as exc:
        error = exc
    except Exception as exc:
        error = BenchmarkError(
            "orchestration",
            "UNEXPECTED_ERROR",
            f"Unexpected {type(exc).__name__}: {exc}",
        )

    if error is not None:
        write_json(
            error_path,
            {
                "schemaVersion": 1,
                "pageKey": page.page_key,
                "createdAt": utc_now(),
                "error": error.as_dict(),
            },
        )
        artifacts["error"] = _run_relative(run_directory, error_path)
        if raw_path.is_file():
            artifacts["raw"] = _run_relative(run_directory, raw_path)
        for kind, path in additional_artifact_paths.items():
            if path.is_file():
                artifacts[kind] = _run_relative(run_directory, path)
        # Normalized JSON is written atomically and the overlay is referenced
        # only after its writer returns. A KeyboardInterrupt can otherwise leave
        # a partial PNG or temporary JSON that the exact-coverage validator
        # correctly rejects.
        _prune_page_directory(
            page_directory,
            {
                *([prepared_path] if prepared is not None else []),
                *([raw_path] if "raw" in artifacts else []),
                *([normalized_path] if "normalized" in artifacts else []),
                *([overlay_path] if "overlay" in artifacts else []),
                *[
                    path
                    for kind, path in additional_artifact_paths.items()
                    if kind in artifacts
                ],
                error_path,
            },
        )

    total_ms = _elapsed_ms(page_started)
    timings["totalMs"] = total_ms
    if error is not None:
        error_details = (
            error.details if isinstance(error.details, dict) else {}
        )
        if timings["inputStageMs"] is None:
            timings["inputStageMs"] = _nullable_milliseconds(
                error_details.get("inputStageMs")
            )
        if timings["engineUserCpuMs"] is None:
            timings["engineUserCpuMs"] = _nullable_milliseconds(
                error_details.get("engineUserCpuMs")
            )
        if timings["engineSystemCpuMs"] is None:
            timings["engineSystemCpuMs"] = _nullable_milliseconds(
                error_details.get("engineSystemCpuMs")
            )
    peak_rss, resource_measurement = _resource_values(invocation, error)
    result = {
        "pageKey": page.page_key,
        "status": "succeeded" if error is None else "failed",
        "timestamps": {
            "startedAt": page_started_at,
            "completedAt": utc_now(),
        },
        "durationMs": total_ms,
        "timings": timings,
        "peakRssBytes": peak_rss,
        "resourceMeasurement": resource_measurement,
        "source": {
            "relativePath": backend_relative(page.source_path),
            "filename": page.original_filename,
            "sha256": page.checksum_sha256,
            "width": page.width,
            "height": page.height,
            "exifOrientation": (
                prepared.source_exif_orientation if prepared is not None else None
            ),
        },
        "prepared": (
            {
                "artifact": _run_relative(run_directory, prepared_path),
                "sha256": prepared.sha256,
                "width": prepared.width,
                "height": prepared.height,
                "rasterFingerprint": {
                    "algorithm": RASTER_FINGERPRINT_ALGORITHM,
                    "sha256": prepared.raster_sha256,
                },
            }
            if prepared is not None
            else None
        ),
        "artifacts": artifacts,
        "counts": counts,
        "warnings": warnings,
        "error": error.as_dict() if error is not None else None,
    }
    return result


def _layout_quality_error(
    adapter: EngineAdapter,
    normalized: dict[str, Any],
    *,
    observed_provider_line_count: int | None = None,
) -> BenchmarkError | None:
    if not any(
        warning["code"] == "PREDICTED_LINE_CAP_REACHED"
        for warning in normalized["warnings"]
    ):
        return None
    return BenchmarkError(
        "engine-quality",
        "PREDICTED_LINE_CAP_REACHED",
        "Orli reached its configured maximum line count; output is truncated.",
        {
            "maxPredictedLines": adapter.config["parameters"].get(
                "maxPredictedLines"
            ),
            "observedProviderLineCount": observed_provider_line_count,
            "normalizedUsableLineCount": len(normalized["lines"]),
        },
    )


def _unprocessed_page_result(
    page: CohortPage, run_directory: Path, error: BenchmarkError
) -> dict[str, Any]:
    page_directory = run_directory / "pages" / page.page_key
    # A signal can arrive between a page worker returning and the orchestrator
    # recording its result. Reset any such orphaned directory so an explicitly
    # unprocessed page has exactly one immutable error artifact.
    _reset_page_directory(page_directory)
    error_path = page_directory / "error.json"
    write_json(
        error_path,
        {
            "schemaVersion": 1,
            "pageKey": page.page_key,
            "createdAt": utc_now(),
            "error": error.as_dict(),
        },
    )
    return {
        "pageKey": page.page_key,
        "status": "failed",
        "timestamps": {
            "startedAt": utc_now(),
            "completedAt": utc_now(),
        },
        "durationMs": 0,
        "timings": _empty_timings(),
        "peakRssBytes": None,
        "resourceMeasurement": {
            "method": "unavailable",
            "caveat": "Engine did not start.",
        },
        "source": {
            "relativePath": backend_relative(page.source_path),
            "filename": page.original_filename,
            "sha256": page.checksum_sha256,
            "width": page.width,
            "height": page.height,
            "exifOrientation": None,
        },
        "prepared": None,
        "artifacts": {"error": _run_relative(run_directory, error_path)},
        "counts": {"regions": 0, "lines": 0},
        "warnings": [],
        "error": error.as_dict(),
    }


def _reset_page_directory(page_directory: Path) -> None:
    if page_directory.is_symlink() or (
        page_directory.exists() and not page_directory.is_dir()
    ):
        page_directory.unlink()
    elif page_directory.exists():
        shutil.rmtree(page_directory)
    page_directory.mkdir(parents=True, exist_ok=False)


def _prune_page_directory(
    page_directory: Path,
    retained_paths: set[Path],
) -> None:
    retained_names = {path.name for path in retained_paths}
    for entry in page_directory.iterdir():
        if entry.name in retained_names and entry.is_file():
            continue
        if entry.is_symlink() or not entry.is_dir():
            entry.unlink(missing_ok=True)
        else:
            shutil.rmtree(entry)


def _fallback_engine_metadata(adapter: EngineAdapter) -> dict[str, Any]:
    config = adapter.config
    execution_config = config["execution"]
    execution: dict[str, Any] = {
        "kind": execution_config["kind"],
        "commandFingerprint": "0" * 64,
        "pythonVersion": "unavailable",
        "inferenceProvider": "unavailable",
        "dependencies": {},
    }
    if execution_config["kind"] == "docker":
        execution["image"] = execution_config["image"]
    return {
        "id": adapter.engine_id,
        "adapterVersion": config["adapterVersion"],
        "package": {
            "name": config["package"]["name"],
            "version": config["package"]["version"],
        },
        "models": [],
        "configuration": adapter.configuration_metadata(),
        "execution": execution,
    }


def _validate_staged_run(staging_directory: Path, run_id: str) -> None:
    validator = BACKEND_ROOT / "scripts" / "validate-layout-benchmark-run.ts"
    tsx = BACKEND_ROOT / "node_modules" / ".bin" / "tsx"
    if not validator.is_file() or not tsx.is_file():
        raise BenchmarkError(
            "publication-validation",
            "VALIDATOR_UNAVAILABLE",
            "The authoritative TypeScript/Zod staged-run validator is unavailable",
            {
                "validator": backend_relative(validator),
                "tsx": backend_relative(tsx),
            },
        )
    command = [
        str(tsx),
        str(validator),
        "--directory",
        str(staging_directory.resolve()),
        "--run-id",
        run_id,
    ]
    result = run_capture(command, timeout_seconds=600)
    if result.returncode != 0:
        raise BenchmarkError(
            "publication-validation",
            "STAGED_RUN_INVALID",
            "The staged run failed authoritative schema or artifact validation",
            {
                "exitCode": result.returncode,
                "stdout": result.stdout[-20_000:],
                "stderr": result.stderr[-20_000:],
                "stagingDirectory": backend_relative(staging_directory),
            },
        )


def _validate_and_publish_staged_run(
    adapter: EngineAdapter,
    staging_directory: Path,
    final_directory: Path,
    run_id: str,
    source_snapshot: dict[str, Any],
) -> None:
    _validate_staged_run(staging_directory, run_id)
    # The validator above is part of the frozen source set. Re-check that set
    # after validation so a concurrent edit cannot bless a run with code that
    # differs from the source snapshot published alongside it.
    _verify_source_snapshot(adapter, staging_directory, source_snapshot)
    os.replace(staging_directory, final_directory)


def _source_paths(adapter: EngineAdapter) -> tuple[Path, ...]:
    fixed_paths = [
        BACKEND_ROOT / "scripts" / "run-layout-benchmark.ts",
        BACKEND_ROOT / "scripts" / "validate-layout-benchmark-run.ts",
        BACKEND_ROOT / "src" / "benchmarks" / "layout" / "raster-fingerprint.ts",
        BACKEND_ROOT / "src" / "benchmarks" / "layout" / "schemas.ts",
        BACKEND_ROOT / "src" / "services" / "filename-parser.ts",
        BACKEND_ROOT / "package.json",
        BACKEND_ROOT / "package-lock.json",
        BACKEND_ROOT / "tsconfig.json",
        BACKEND_ROOT / "python" / "requirements.txt",
        COHORT_PATH,
        PREPROCESSING_CONFIG_PATH,
        SMOKE_CONFIG_PATH,
        adapter.config_path,
    ]
    execution = adapter.config.get("execution", {})
    if (
        execution.get("kind") == "docker"
        or adapter.config.get("adapter") == "eynollah-pagexml"
    ):
        dockerfile = execution.get("dockerfile")
        if not isinstance(dockerfile, str) or not dockerfile:
            raise BenchmarkError(
                "run-initialization",
                "PROVENANCE_DOCKERFILE_UNDECLARED",
                "A Docker benchmark engine must declare its Dockerfile path",
            )
        try:
            fixed_paths.append(resolve_backend_relative(dockerfile))
        except ValueError as exc:
            raise BenchmarkError(
                "run-initialization",
                "PROVENANCE_DOCKERFILE_INVALID",
                "The configured Dockerfile must be backend-relative",
                {"path": dockerfile},
            ) from exc
    fixed_paths.extend(adapter.external_source_snapshot_paths())
    package_paths = [
        path
        for path in PACKAGE_ROOT.rglob("*.py")
        if ".runtime" not in path.parts
        and "__pycache__" not in path.parts
        and "tests" not in path.parts
    ]
    paths = tuple(
        sorted(
            {path.resolve() for path in [*fixed_paths, *package_paths]},
            key=lambda path: backend_relative(path),
        )
    )
    missing = [backend_relative(path) for path in paths if not path.is_file()]
    if missing:
        raise BenchmarkError(
            "run-initialization",
            "PROVENANCE_SOURCE_MISSING",
            "A benchmark source file required for provenance is missing",
            {"paths": missing},
        )
    return paths


def _create_source_snapshot(
    adapter: EngineAdapter,
    run_directory: Path,
) -> dict[str, Any]:
    return _snapshot_source_files(run_directory, _source_paths(adapter))


def _snapshot_source_files(
    run_directory: Path,
    source_paths: Iterable[Path],
) -> dict[str, Any]:
    files: dict[str, dict[str, Any]] = {}
    source_hashes: dict[str, str] = {}
    for source_path in sorted(
        (path.resolve() for path in source_paths),
        key=backend_relative,
    ):
        original_path = backend_relative(source_path)
        snapshot_relative = (
            Path("source-snapshot") / Path(original_path)
        ).as_posix()
        snapshot_path = run_directory / snapshot_relative
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, snapshot_path)

        snapshot_sha256 = sha256_file(snapshot_path)
        snapshot_size = snapshot_path.stat().st_size
        live_sha256 = sha256_file(source_path)
        live_size = source_path.stat().st_size
        if (
            live_sha256 != snapshot_sha256
            or live_size != snapshot_size
        ):
            raise BenchmarkError(
                "run-initialization",
                "PROVENANCE_SOURCE_CHANGED_DURING_SNAPSHOT",
                "A benchmark source file changed while its frozen snapshot was copied",
                {"path": original_path},
            )
        source_hashes[original_path] = snapshot_sha256
        files[original_path] = {
            "snapshotPath": snapshot_relative,
            "sha256": snapshot_sha256,
            "sizeBytes": snapshot_size,
        }
    return {
        "algorithm": "sha256",
        "bundleSha256": hashlib.sha256(
            canonical_json_bytes(source_hashes)
        ).hexdigest(),
        "files": files,
    }


def _verify_source_snapshot(
    adapter: EngineAdapter,
    run_directory: Path,
    source_snapshot: dict[str, Any],
) -> None:
    snapshot_files = source_snapshot["files"]
    live_paths = {
        backend_relative(path): path for path in _source_paths(adapter)
    }
    changed: list[str] = []
    observed_hashes: dict[str, str] = {}
    for original_path in sorted(set(snapshot_files) | set(live_paths)):
        metadata = snapshot_files.get(original_path)
        live_path = live_paths.get(original_path)
        if not isinstance(metadata, dict) or live_path is None:
            changed.append(original_path)
            continue
        snapshot_path = _resolve_run_artifact(
            run_directory,
            str(metadata.get("snapshotPath", "")),
        )
        expected_sha256 = metadata.get("sha256")
        expected_size = metadata.get("sizeBytes")
        snapshot_sha256 = sha256_file(snapshot_path)
        snapshot_size = snapshot_path.stat().st_size
        live_sha256 = sha256_file(live_path)
        live_size = live_path.stat().st_size
        observed_hashes[original_path] = snapshot_sha256
        if (
            snapshot_sha256 != expected_sha256
            or live_sha256 != expected_sha256
            or snapshot_size != expected_size
            or live_size != expected_size
        ):
            changed.append(original_path)

    observed_bundle = hashlib.sha256(
        canonical_json_bytes(observed_hashes)
    ).hexdigest()
    if (
        changed
        or observed_bundle != source_snapshot.get("bundleSha256")
    ):
        raise BenchmarkError(
            "publication-validation",
            "ADAPTER_SOURCE_CHANGED",
            "Benchmark adapter or contract source changed while the run was active",
            {
                "startedSha256": source_snapshot.get("bundleSha256"),
                "completedSha256": observed_bundle,
                "changedPaths": sorted(set(changed)),
            },
        )


def _engine_identity(metadata: dict[str, Any]) -> dict[str, str]:
    return {
        "sha256": hashlib.sha256(
            canonical_json_bytes(metadata)
        ).hexdigest()
    }


def _verify_engine_identity(
    adapter: EngineAdapter,
    started: dict[str, str],
) -> None:
    try:
        completed_metadata = adapter.preflight()
    except BenchmarkError as exc:
        raise BenchmarkError(
            "publication-validation",
            "ENGINE_IDENTITY_RECHECK_FAILED",
            "The engine no longer passes the preflight used to start this run",
            {
                "startedSha256": started["sha256"],
                "preflightError": exc.as_dict(),
            },
        ) from exc
    completed = _engine_identity(completed_metadata)
    if completed["sha256"] == started["sha256"]:
        return
    raise BenchmarkError(
        "publication-validation",
        "ENGINE_IDENTITY_CHANGED",
        (
            "Engine package, model, configuration, or runtime identity changed "
            "while the run was active"
        ),
        {
            "startedSha256": started["sha256"],
            "completedSha256": completed["sha256"],
        },
    )


def _build_artifact_integrity(
    run_directory: Path,
    page_results: Iterable[dict[str, Any]],
    source_snapshot: dict[str, Any],
) -> dict[str, Any]:
    references: set[str] = set()
    for page in page_results:
        prepared = page.get("prepared")
        if isinstance(prepared, dict) and isinstance(
            prepared.get("artifact"), str
        ):
            references.add(prepared["artifact"])
        artifacts = page.get("artifacts")
        if isinstance(artifacts, dict):
            for value in artifacts.values():
                if isinstance(value, str):
                    references.add(value)
    for metadata in source_snapshot["files"].values():
        snapshot_path = metadata.get("snapshotPath")
        if isinstance(snapshot_path, str):
            references.add(snapshot_path)

    artifacts: dict[str, dict[str, Any]] = {}
    for reference in sorted(references):
        path = _resolve_run_artifact(run_directory, reference)
        artifacts[reference] = {
            "sha256": sha256_file(path),
            "sizeBytes": path.stat().st_size,
        }
    return {"algorithm": "sha256", "artifacts": artifacts}


def _resolve_run_artifact(run_directory: Path, reference: str) -> Path:
    if not reference or Path(reference).is_absolute():
        raise BenchmarkError(
            "publication-validation",
            "INVALID_ARTIFACT_REFERENCE",
            f"Run artifact reference must be relative: {reference}",
        )
    root = run_directory.resolve()
    path = (root / reference).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise BenchmarkError(
            "publication-validation",
            "ARTIFACT_ESCAPES_RUN",
            f"Run artifact escapes the staged directory: {reference}",
        ) from exc
    if not path.is_file():
        raise BenchmarkError(
            "publication-validation",
            "ARTIFACT_MISSING",
            f"Referenced run artifact is missing: {reference}",
        )
    return path


def _source_provenance(adapter: EngineAdapter) -> dict[str, Any]:
    paths = _source_paths(adapter)
    files = {
        backend_relative(path): sha256_file(path)
        for path in paths
    }
    return {
        "sha256": hashlib.sha256(canonical_json_bytes(files)).hexdigest(),
        "fileCount": len(files),
        "files": files,
    }


def _verify_source_provenance(
    adapter: EngineAdapter, start: dict[str, Any]
) -> None:
    completed = _source_provenance(adapter)
    if completed["sha256"] == start["sha256"]:
        return
    start_files = start["files"]
    completed_files = completed["files"]
    changed = sorted(
        path
        for path in set(start_files) | set(completed_files)
        if start_files.get(path) != completed_files.get(path)
    )
    raise BenchmarkError(
        "publication-validation",
        "ADAPTER_SOURCE_CHANGED",
        "Benchmark adapter or contract source changed while the run was active",
        {
            "startedSha256": start["sha256"],
            "completedSha256": completed["sha256"],
            "changedPaths": changed,
        },
    )


def _empty_timings() -> dict[str, int | float | None]:
    return {
        "preparationMs": None,
        "engineMs": None,
        "inputStageMs": None,
        "normalizationMs": None,
        "overlayMs": None,
        "totalMs": 0,
        "engineUserCpuMs": None,
        "engineSystemCpuMs": None,
        "providerModelLoadMs": None,
        "providerInferenceMs": None,
    }


def _resource_values(
    invocation: EngineInvocation | None,
    error: BenchmarkError | None,
) -> tuple[int | None, dict[str, str | None]]:
    if invocation is not None:
        return invocation.peak_rss_bytes, invocation.resource_measurement
    if error is not None and isinstance(error.details, dict):
        peak = error.details.get("peakRssBytes")
        measurement = error.details.get("resourceMeasurement")
        if isinstance(measurement, dict):
            return (
                int(peak) if isinstance(peak, int) and peak >= 0 else None,
                {
                    "method": str(measurement.get("method", "unavailable")),
                    "caveat": (
                        str(measurement["caveat"])
                        if measurement.get("caveat") is not None
                        else None
                    ),
                },
            )
    return (
        None,
        {
            "method": "unavailable",
            "caveat": "Engine did not complete with measurable resource data.",
        },
    )


def _nullable_milliseconds(value: Any) -> int | None:
    if isinstance(value, (int, float)) and value >= 0:
        return int(round(value))
    return None


def _elapsed_ms(start: float) -> int:
    return int(round((time.perf_counter() - start) * 1000))


def _run_relative(run_directory: Path, artifact: Path) -> str:
    return artifact.relative_to(run_directory).as_posix()
