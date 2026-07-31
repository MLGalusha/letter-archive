from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .boundary_filter import (
    SourceContext,
    compose_page_evidence,
    external_snapshot_paths,
    load_source_context,
    source_context_metadata,
)
from .page_mask_stage import (
    PreparedPageMaskStage,
    attach_page_mask_evidence,
    is_eynollah_page_mask_config,
    page_mask_artifact_paths,
    prepare_eynollah_page_mask_stage,
    validate_eynollah_page_mask_config,
)
from .rotation_source_projection import (
    RotationSourceContext,
    compose_page_evidence as compose_rotation_page_evidence,
    external_snapshot_paths as rotation_external_snapshot_paths,
    inherits_page_mask_artifacts,
    load_source_context as load_rotation_source_context,
    source_context_metadata as rotation_source_context_metadata,
)
from .paths import (
    BACKEND_ROOT,
    CONFIG_ROOT,
    PYTHON_ROOT,
    RUNTIME_ROOT,
    backend_relative,
    resolve_backend_relative,
)
from .util import (
    BenchmarkError,
    canonical_json_bytes,
    json_safe,
    read_json,
    run_capture,
    sha256_file,
    write_json,
)


ENGINE_IDS = (
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
    "kraken7-eyno-boundary-filter",
    "eynollah",
    "eynollah-v091",
    "eynollah-v091-cl",
)


@dataclass(frozen=True)
class EngineInvocation:
    peak_rss_bytes: int | None
    resource_measurement: dict[str, str | None]
    stderr: str
    user_cpu_ms: int | None
    system_cpu_ms: int | None
    input_stage_ms: int | None = None


class EngineAdapter:
    def __init__(self, engine_id: str) -> None:
        if engine_id not in ENGINE_IDS:
            raise BenchmarkError(
                "arguments", "UNKNOWN_ENGINE", f"Unknown engine {engine_id}"
            )
        self.engine_id = engine_id
        self._source_context: SourceContext | None = None
        self._rotation_projection_context: RotationSourceContext | None = None
        self.config_path = CONFIG_ROOT / f"{engine_id}.v1.json"
        self.config = read_json(self.config_path)
        if (
            not isinstance(self.config, dict)
            or self.config.get("schemaVersion") != 1
            or self.config.get("engineId") != engine_id
        ):
            raise BenchmarkError(
                "configuration",
                "INVALID_ENGINE_CONFIG",
                f"Invalid engine config for {engine_id}",
            )
        if is_eynollah_page_mask_config(self.config):
            validate_eynollah_page_mask_config(self.config)
        self._inherits_page_mask_artifacts = (
            inherits_page_mask_artifacts(self.config)
            if self.config["adapter"] == "layout-run-rotation-projection"
            or "sourceEvidence" in self.config
            else False
        )

    @property
    def timeout_seconds(self) -> int:
        return int(self.config["execution"]["timeoutSeconds"])

    @property
    def raw_filename(self) -> str:
        return (
            "raw.xml"
            if self.config["adapter"] == "eynollah-pagexml"
            else "raw.json"
        )

    @property
    def page_boundary_available(self) -> bool:
        return not (
            self.config["adapter"] == "eynollah-pagexml"
            and bool(self.config["parameters"].get("ignorePageExtraction"))
        )

    @property
    def has_eynollah_page_mask(self) -> bool:
        return is_eynollah_page_mask_config(self.config)

    def additional_page_artifacts(
        self,
        page_directory: Path,
    ) -> dict[str, Path]:
        if self.has_eynollah_page_mask:
            return page_mask_artifact_paths(page_directory)
        if self._inherits_page_mask_artifacts:
            return page_mask_artifact_paths(page_directory)
        return {}

    def external_source_snapshot_paths(self) -> tuple[Path, ...]:
        if self.config["adapter"] == "layout-run-rotation-projection":
            return rotation_external_snapshot_paths(self.config)
        if (
            self.config["adapter"] == "layout-run-boundary-filter"
            or self.has_eynollah_page_mask
        ):
            return external_snapshot_paths(self.config)
        return ()

    @property
    def platform_caveat(self) -> str | None:
        if self.config["adapter"] == "layout-run-rotation-projection":
            mask_note = (
                " The exact source page mask, masked engine input, standalone "
                "provenance, and Eynollah physical-page boundary are "
                "integrity-verified, copied byte-for-byte into the derived "
                "run, and exposed with the displayed geometry."
                if self._inherits_page_mask_artifacts
                else ""
            )
            return (
                "This non-rankable local diagnostic performs no model "
                "inference. It verifies and replays untouched provider-native "
                "rotation passes from one immutable source run, then applies "
                "the configured deterministic display policy. Partial and "
                "failed passes remain frozen raw evidence but can never "
                "contribute displayed geometry. Rejected candidate zones and "
                "their explicit rejection reasons are retained in raw evidence."
                f"{mask_note}"
            )
        if self.config["adapter"] == "layout-run-boundary-filter":
            return (
                "This non-rankable local diagnostic performs no model "
                "inference. It verifies and freezes an immutable Kraken line "
                "run and Eynollah page-boundary run, then exposes only Kraken "
                "lines whose sampled native geometry is primarily inside the "
                "exact provider boundary. Every excluded line and both exact "
                "source layouts remain in raw evidence; the normalized layout "
                "is a reversible display projection, not production "
                "PageLayoutV2."
            )
        if self.config["adapter"] == "eynollah-pagexml":
            base = (
                "Eynollah 0.9.0 runs in a host-native Linux container with an "
                "explicit onnxruntime CPU substitution for its upstream "
                "GPU-only dependency declaration."
            )
            if not self.page_boundary_available:
                return (
                    f"{base} Page extraction is explicitly disabled, so a "
                    "full-frame PAGE Border is recorded as "
                    "PAGE_BOUNDARY_UNAVAILABLE."
                )
            if self.config["models"].get("bundleVersion") == "0.9.1":
                return (
                    f"{base} This profile uses the official v0.9.1 "
                    "inference-layout bundle referenced by Eynollah's own "
                    "model specification, including its ONNX page-extraction "
                    "model."
                )
            return (
                f"{base} Full layout needs roughly 6 GiB of "
                "model memory before overhead; the local Docker VM exposes "
                "about 4 GiB, so local inference may terminate with OOM. "
                "Use a >=16 GiB Linux worker for the full cohort."
            )
        if self.engine_id == "kraken6":
            return (
                "The preserved baseline environment contains unrelated package "
                "dependency drift (craft-text-detector/OpenCV). Kraken 6.0.3 "
                "and its pinned BLLA model are independently version-checked."
            )
        if self.engine_id.startswith("kraken7-rot"):
            rotations = self.config.get("parameters", {}).get(
                "rotationsDegrees", []
            )
            rotation_label = ", ".join(f"{rotation}°" for rotation in rotations)
            merge_policy = self.config.get("parameters", {}).get(
                "rotationMergePolicy"
            )
            zone_note = (
                " Its vertical-zone policy may accept multiple nearby lines "
                "from one fully successful rotated pass; that is a spatial "
                "single-pass heuristic, not independent-rotation consensus."
                if merge_policy == "baseline-plus-vertical-zones"
                else ""
            )
            mask_note = (
                " Before every pass, pixels outside the immutable Eynollah "
                "physical-page boundary are filled with opaque white using the "
                "configured Chebyshev padding. The mask, exact masked input, "
                "source layouts, and source bindings remain immutable evidence."
                if self.has_eynollah_page_mask
                else ""
            )
            return (
                "This local diagnostic runs the same pinned Kraken 7 BLLA "
                f"model at {rotation_label}. Every untouched provider-native "
                "pass and a separately labeled source-coordinate projection "
                "are retained in raw evidence under the "
                "native-and-source-projected-v2 contract. Only fully successful "
                "passes may contribute displayed geometry, and baseline-plus "
                "policies fail the page unless 0° fully succeeds. The normalized "
                "layout is a diagnostic display projection, not a production "
                "PageLayoutV2 or calibrated confidence result. A strict-pass "
                "geometry failure may be retried with raise_on_error=false, but "
                "that partial geometry remains raw evidence only."
                f"{zone_note}{mask_note}"
            )
        if self.engine_id.startswith("kraken7-orli"):
            cap_note = (
                " This diagnostic profile stops generation at 128 lines and "
                "fails the page if that cap is reached."
                if self.engine_id.endswith("-cap128")
                else ""
            )
            runtime_note = (
                "This diagnostic profile runs on CPU with bf16-mixed precision "
                "using the same pinned environment and model as the MPS profile. "
                "It exists to distinguish Apple MPS numerical behavior from "
                "model quality and is not a production-performance candidate."
                if self.engine_id.startswith("kraken7-orli-cpu")
                else
                "This profile runs on Apple MPS with bf16-mixed precision. "
                "Valid MPS/bfloat16 quality-smoke output was non-viable, so it "
                "must not be treated as a successful quality candidate."
            )
            return (
                "Orli 0.0.2 runs as a Kraken 7 model plugin in its own pinned "
                f"environment. {runtime_note} The published base model requires "
                "bfloat16; results are hardware/precision-specific, while "
                "earlier 32-true output is invalid rather than detector-quality "
                "evidence. Orli emits true baseline polylines directly in "
                "reading order, but does not classify line types, group lines "
                "into semantic regions, predict a physical page boundary, or "
                "natively emit line polygons in this profile."
                f"{cap_note}"
            )
        if self.has_eynollah_page_mask:
            padding = self.config["inputStage"]["paddingPixels"]
            return (
                "This diagnostic runs the pinned Kraken 7 BLLA model on an "
                "identity-sized RGB input whose pixels outside the immutable "
                "Eynollah physical-page boundary are opaque white. The "
                f"boundary uses explicit {padding}px Chebyshev padding. The "
                "canonical prepared scan, binary mask, masked engine input, "
                "unmasked Kraken control layout, Eynollah layout, and exact "
                "source bindings remain separate immutable evidence."
            )
        return None

    def configuration_metadata(self) -> dict[str, Any]:
        return {
            "profileId": f"{self.engine_id}-v1",
            "path": backend_relative(self.config_path),
            "sha256": sha256_file(self.config_path),
            "values": self.config,
        }

    def preflight(self) -> dict[str, Any]:
        if self.config["adapter"] == "kraken":
            return self._preflight_kraken()
        if self.config["adapter"] == "eynollah-pagexml":
            return self._preflight_eynollah()
        if self.config["adapter"] == "layout-run-boundary-filter":
            return self._preflight_boundary_filter()
        if self.config["adapter"] == "layout-run-rotation-projection":
            return self._preflight_rotation_projection()
        raise BenchmarkError(
            "configuration",
            "UNKNOWN_ENGINE_ADAPTER",
            f"Unknown adapter {self.config['adapter']}",
        )

    def setup(self) -> dict[str, Any]:
        if self.config["adapter"] in {
            "layout-run-boundary-filter",
            "layout-run-rotation-projection",
        }:
            return self.preflight()
        if self.engine_id == "kraken6":
            return self.preflight()
        if self.engine_id.startswith("kraken7"):
            self._setup_kraken_runtime()
        else:
            self._setup_eynollah()
        return self.preflight()

    def run_page(self, page_directory: Path) -> EngineInvocation:
        prepared_path = page_directory / "prepared.png"
        raw_path = page_directory / self.raw_filename
        if self.config["adapter"] == "kraken":
            if self.has_eynollah_page_mask:
                return self._run_kraken_with_page_mask(
                    page_directory.name,
                    prepared_path,
                    raw_path,
                )
            return self._run_kraken(prepared_path, raw_path)
        if self.config["adapter"] == "eynollah-pagexml":
            return self._run_eynollah(page_directory, prepared_path, raw_path)
        if self.config["adapter"] == "layout-run-boundary-filter":
            return self._run_boundary_filter(
                page_directory.name,
                prepared_path,
                raw_path,
            )
        if self.config["adapter"] == "layout-run-rotation-projection":
            return self._run_rotation_projection(
                page_directory.name,
                prepared_path,
                raw_path,
            )
        raise BenchmarkError(
            "configuration",
            "UNKNOWN_ENGINE_ADAPTER",
            f"Unknown adapter {self.config['adapter']}",
        )

    def _preflight_boundary_filter(self) -> dict[str, Any]:
        context = load_source_context(self.config)
        self._source_context = context
        context_metadata = source_context_metadata(context)
        models: list[dict[str, Any]] = []
        for role, binding in (
            ("line-geometry", context.line_geometry),
            ("page-boundary", context.page_boundary),
        ):
            for model in binding.manifest.get("engine", {}).get("models", []):
                if not isinstance(model, dict):
                    continue
                models.append(
                    {
                        "name": f"{role}:{model['name']}",
                        "sha256": str(model["sha256"]),
                        "sizeBytes": int(model["sizeBytes"]),
                    }
                )
        return {
            "id": self.engine_id,
            "adapterVersion": self.config["adapterVersion"],
            "package": {
                "name": self.config["package"]["name"],
                "version": self.config["package"]["version"],
            },
            "models": models,
            "configuration": self.configuration_metadata(),
            "execution": {
                "kind": self.config["execution"]["kind"],
                "commandFingerprint": hashlib.sha256(
                    canonical_json_bytes(
                        {
                            "module": "layout_benchmark.boundary_filter",
                            "engineId": self.engine_id,
                            "sourceRuns": self.config["sourceRuns"],
                            "parameters": self.config["parameters"],
                        }
                    )
                ).hexdigest(),
                "pythonVersion": platform.python_version(),
                "inferenceProvider": "pure-python-geometry-no-inference",
                "runtimeInference": {
                    "provider": "sampled-native-path-point-in-polygon",
                    "coordinateTransform": "identity",
                    "sourceContext": context_metadata,
                },
                "dependencies": {
                    "line-geometry-source-run": (
                        f"runId={context.line_geometry.run_id};"
                        f"manifestSha256="
                        f"{context.line_geometry.expected_manifest_sha256}"
                    ),
                    "page-boundary-source-run": (
                        f"runId={context.page_boundary.run_id};"
                        f"manifestSha256="
                        f"{context.page_boundary.expected_manifest_sha256}"
                    ),
                },
            },
        }

    def _preflight_rotation_projection(self) -> dict[str, Any]:
        context = load_rotation_source_context(self.config)
        self._rotation_projection_context = context
        context_metadata = rotation_source_context_metadata(context)
        models = [
            _sanitize_model(model)
            for model in context.binding.manifest.get("engine", {}).get(
                "models", []
            )
            if isinstance(model, dict)
        ]
        command_identity = {
            "module": "layout_benchmark.rotation_source_projection",
            "engineId": self.engine_id,
            "sourceRuns": self.config["sourceRuns"],
            "sourceEvidence": self.config.get("sourceEvidence"),
            "parameters": self.config["parameters"],
        }
        return {
            "id": self.engine_id,
            "adapterVersion": self.config["adapterVersion"],
            "package": {
                "name": self.config["package"]["name"],
                "version": self.config["package"]["version"],
            },
            "models": models,
            "configuration": self.configuration_metadata(),
            "execution": {
                "kind": self.config["execution"]["kind"],
                "commandFingerprint": hashlib.sha256(
                    canonical_json_bytes(command_identity)
                ).hexdigest(),
                "pythonVersion": platform.python_version(),
                "inferenceProvider": (
                    "pure-python-geometry-no-model-inference"
                ),
                "runtimeInference": {
                    "provider": (
                        "deterministic-native-rotation-evidence-reprojection"
                    ),
                    "modelInferencePerformed": False,
                    "sourceContext": context_metadata,
                },
                "dependencies": {
                    "rotation-source-run": (
                        f"runId={context.binding.run_id};"
                        "manifestSha256="
                        f"{context.binding.expected_manifest_sha256}"
                    ),
                },
            },
        }

    def _run_boundary_filter(
        self,
        page_key: str,
        prepared_path: Path,
        raw_path: Path,
    ) -> EngineInvocation:
        context = self._source_context
        if context is None:
            self._preflight_boundary_filter()
            context = self._source_context
        if context is None:
            raise BenchmarkError(
                "engine-preflight",
                "COMPOSITION_CONTEXT_UNAVAILABLE",
                "Boundary-filter source context was not initialized",
            )
        evidence = compose_page_evidence(
            context,
            self.config,
            page_key=page_key,
            prepared_path=prepared_path,
        )
        write_json(raw_path, evidence)
        return EngineInvocation(
            peak_rss_bytes=None,
            resource_measurement={
                "method": "unavailable",
                "caveat": (
                    "Pure geometry executes in the benchmark orchestrator; "
                    "isolated per-page RSS is not available."
                ),
            },
            stderr="",
            user_cpu_ms=None,
            system_cpu_ms=None,
        )

    def _run_rotation_projection(
        self,
        page_key: str,
        prepared_path: Path,
        raw_path: Path,
    ) -> EngineInvocation:
        context = self._rotation_projection_context
        if context is None:
            self._preflight_rotation_projection()
            context = self._rotation_projection_context
        if context is None:
            raise BenchmarkError(
                "engine-preflight",
                "ROTATION_PROJECTION_CONTEXT_UNAVAILABLE",
                "Rotation-projection source context was not initialized",
            )
        evidence = compose_rotation_page_evidence(
            context,
            self.config,
            page_key=page_key,
            prepared_path=prepared_path,
        )
        write_json(raw_path, evidence)
        return EngineInvocation(
            peak_rss_bytes=None,
            resource_measurement={
                "method": "unavailable",
                "caveat": (
                    "Pure geometry executes in the benchmark orchestrator; "
                    "isolated per-page RSS is not available."
                ),
            },
            stderr="",
            user_cpu_ms=None,
            system_cpu_ms=None,
        )

    def _run_kraken_with_page_mask(
        self,
        page_key: str,
        prepared_path: Path,
        raw_path: Path,
    ) -> EngineInvocation:
        context = self._source_context
        if context is None:
            self._preflight_kraken()
            context = self._source_context
        if context is None:
            raise BenchmarkError(
                "engine-preflight",
                "PAGE_MASK_SOURCE_CONTEXT_UNAVAILABLE",
                "Eynollah page-mask source context was not initialized",
            )
        stage = prepare_eynollah_page_mask_stage(
            context,
            self.config,
            page_key=page_key,
            prepared_path=prepared_path,
        )
        try:
            invocation = self._run_kraken(
                stage.engine_input_path,
                raw_path,
            )
        except BenchmarkError as exc:
            if raw_path.is_file():
                attach_page_mask_evidence(raw_path, stage)
            details = (
                dict(exc.details)
                if isinstance(exc.details, dict)
                else {}
            )
            details["inputStageMs"] = stage.duration_ms
            raise BenchmarkError(
                exc.stage,
                exc.code,
                exc.message,
                details,
            ) from exc
        attach_page_mask_evidence(raw_path, stage)
        return EngineInvocation(
            peak_rss_bytes=invocation.peak_rss_bytes,
            resource_measurement=invocation.resource_measurement,
            stderr=invocation.stderr,
            user_cpu_ms=invocation.user_cpu_ms,
            system_cpu_ms=invocation.system_cpu_ms,
            input_stage_ms=stage.duration_ms,
        )

    def _python_path(self) -> Path:
        return resolve_backend_relative(self.config["execution"]["python"])

    def _kraken_base_command(self) -> list[str]:
        return [
            str(self._python_path()),
            "-m",
            "layout_benchmark.kraken_worker",
            "--config",
            str(self.config_path),
        ]

    def _preflight_kraken(self) -> dict[str, Any]:
        input_stage_context: SourceContext | None = None
        if self.has_eynollah_page_mask:
            validate_eynollah_page_mask_config(self.config)
            input_stage_context = load_source_context(self.config)
            self._source_context = input_stage_context
        python_path = self._python_path()
        if not python_path.is_file():
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_NOT_SETUP",
                f"{self.engine_id} Python environment does not exist",
                {
                    "python": backend_relative(python_path),
                    "setupCommand": (
                        "npx tsx scripts/run-layout-benchmark.ts setup "
                        f"--engine {self.engine_id}"
                    ),
                },
            )
        command = self._kraken_base_command() + ["--describe"]
        result = run_capture(
            command,
            timeout_seconds=120,
            env=self._python_environment(),
        )
        if result.returncode != 0:
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_PREFLIGHT_FAILED",
                f"{self.engine_id} preflight failed",
                _subprocess_details(command, result),
            )
        try:
            observed = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise BenchmarkError(
                "engine-preflight",
                "INVALID_PREFLIGHT_OUTPUT",
                f"{self.engine_id} returned invalid preflight JSON",
                {"stdout": result.stdout[-8000:], "stderr": result.stderr[-8000:]},
            ) from exc
        runtime_inference = observed.get("runtimeInference")
        parameters = self.config.get("parameters", {})
        expected_runtime = {
            "configuredDevice": str(parameters.get("device", "auto")),
            "configuredPrecision": parameters.get("precision"),
        }
        if (
            not isinstance(runtime_inference, dict)
            or any(
                runtime_inference.get(key) != expected
                for key, expected in expected_runtime.items()
            )
            or runtime_inference.get("inferenceProvider")
            != observed.get("inferenceProvider")
        ):
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_INFERENCE_CONFIG_DRIFT",
                (
                    f"{self.engine_id} runtime did not resolve the configured "
                    "device and precision"
                ),
                {
                    "expected": expected_runtime,
                    "observed": runtime_inference,
                },
            )
        if self.engine_id.startswith("kraken7-orli") and (
            runtime_inference.get("configuredPrecision") != "bf16-mixed"
            or not runtime_inference.get("resolvedDevice")
            or not runtime_inference.get("precisionPlugin")
        ):
            raise BenchmarkError(
                "engine-preflight",
                "ORLI_BFLOAT16_RUNTIME_UNVERIFIED",
                (
                    "Orli preflight could not verify the required bfloat16 "
                    "Lightning runtime"
                ),
                {"observed": runtime_inference},
            )
        models = [_sanitize_model(item) for item in observed["models"]]
        dependencies = dict(observed["dependencies"])
        if input_stage_context is not None:
            context_metadata = source_context_metadata(input_stage_context)
            runtime_inference = {
                **runtime_inference,
                "inputStage": {
                    "type": self.config["inputStage"]["type"],
                    "paddingPixels": self.config["inputStage"][
                        "paddingPixels"
                    ],
                    "paddingMetric": self.config["inputStage"][
                        "paddingMetric"
                    ],
                    "sourceContext": context_metadata,
                },
            }
            dependencies.update(
                {
                    "unmasked-control-source-run": (
                        f"runId={input_stage_context.line_geometry.run_id};"
                        "manifestSha256="
                        f"{input_stage_context.line_geometry.expected_manifest_sha256}"
                    ),
                    "page-boundary-source-run": (
                        f"runId={input_stage_context.page_boundary.run_id};"
                        "manifestSha256="
                        f"{input_stage_context.page_boundary.expected_manifest_sha256}"
                    ),
                }
            )
        return {
            "id": self.engine_id,
            "adapterVersion": self.config["adapterVersion"],
            "package": observed["package"],
            "models": models,
            "configuration": self.configuration_metadata(),
            "execution": {
                "kind": self.config["execution"]["kind"],
                "commandFingerprint": hashlib.sha256(
                    canonical_json_bytes(
                        {
                            "module": "layout_benchmark.kraken_worker",
                            "engineId": self.engine_id,
                            "inputStage": self.config.get("inputStage"),
                        }
                    )
                ).hexdigest(),
                "pythonVersion": observed["pythonVersion"],
                "inferenceProvider": observed["inferenceProvider"],
                "runtimeInference": runtime_inference,
                "dependencies": dependencies,
            },
        }

    def _run_kraken(
        self, prepared_path: Path, raw_path: Path
    ) -> EngineInvocation:
        command = self._kraken_base_command() + [
            "--input",
            str(prepared_path),
            "--output",
            str(raw_path),
        ]
        measured_command = command
        measurement = {
            "method": "unavailable",
            "caveat": "No supported per-process RSS measurement was available.",
        }
        if platform.system() == "Darwin" and Path("/usr/bin/time").is_file():
            measured_command = ["/usr/bin/time", "-lp", *command]
            measurement = {
                "method": "usr-bin-time",
                "caveat": (
                    "macOS maximum resident set size for the isolated engine "
                    "worker; it excludes the orchestrator."
                ),
            }
        try:
            result = run_capture(
                measured_command,
                timeout_seconds=self.timeout_seconds,
                env=self._python_environment(),
            )
        except subprocess.TimeoutExpired as exc:
            timeout_stderr = _decode_timeout_stream(exc.stderr)
            raise BenchmarkError(
                "engine-inference",
                "ENGINE_TIMEOUT",
                f"{self.engine_id} exceeded {self.timeout_seconds} seconds",
                {
                    "timeoutSeconds": self.timeout_seconds,
                    "stdout": _decode_timeout_stream(exc.stdout),
                    "stderr": timeout_stderr,
                    "peakRssBytes": _parse_macos_peak_rss(timeout_stderr),
                    "resourceMeasurement": measurement,
                    "engineUserCpuMs": _parse_macos_time_ms(
                        timeout_stderr, "user"
                    ),
                    "engineSystemCpuMs": _parse_macos_time_ms(
                        timeout_stderr, "sys"
                    ),
                },
            ) from exc
        peak_rss = _parse_macos_peak_rss(result.stderr)
        stderr = _without_time_metrics(result.stderr)
        if result.returncode != 0:
            code = "ENGINE_OOM" if result.returncode in {137, -9} else "ENGINE_FAILED"
            details = _subprocess_details(command, result)
            details.update(
                {
                    "peakRssBytes": peak_rss,
                    "resourceMeasurement": measurement,
                    "engineUserCpuMs": _parse_macos_time_ms(
                        result.stderr, "user"
                    ),
                    "engineSystemCpuMs": _parse_macos_time_ms(
                        result.stderr, "sys"
                    ),
                }
            )
            raise BenchmarkError(
                "engine-inference",
                code,
                f"{self.engine_id} failed with exit code {result.returncode}",
                details,
            )
        if not raw_path.is_file():
            details = _subprocess_details(command, result)
            details.update(
                {
                    "peakRssBytes": peak_rss,
                    "resourceMeasurement": measurement,
                    "engineUserCpuMs": _parse_macos_time_ms(
                        result.stderr, "user"
                    ),
                    "engineSystemCpuMs": _parse_macos_time_ms(
                        result.stderr, "sys"
                    ),
                }
            )
            raise BenchmarkError(
                "engine-inference",
                "RAW_OUTPUT_MISSING",
                f"{self.engine_id} succeeded without writing {raw_path.name}",
                details,
            )
        return EngineInvocation(
            peak_rss_bytes=peak_rss,
            resource_measurement=measurement,
            stderr=stderr,
            user_cpu_ms=_parse_macos_time_ms(result.stderr, "user"),
            system_cpu_ms=_parse_macos_time_ms(result.stderr, "sys"),
        )

    def _python_environment(self) -> dict[str, str]:
        current = os.environ.get("PYTHONPATH")
        python_path = str(PYTHON_ROOT)
        if current:
            python_path = f"{python_path}{os.pathsep}{current}"
        return {
            "PYTHONPATH": python_path,
            "PYTHONHASHSEED": "0",
        }

    def _setup_kraken_runtime(self) -> None:
        execution = self.config["execution"]
        python_path = self._python_path()
        bootstrap = execution["bootstrap"]
        uv = shutil.which(bootstrap["tool"])
        if uv is None:
            raise BenchmarkError(
                "engine-setup",
                "BOOTSTRAP_TOOL_MISSING",
                "uv is required to create the isolated Kraken 7 environment",
            )
        runtime_directory = python_path.parent.parent
        runtime_directory.parent.mkdir(parents=True, exist_ok=True)
        wheel_directory = RUNTIME_ROOT / "downloads"
        wheel_directory.mkdir(parents=True, exist_ok=True)
        wheel_specs = bootstrap.get("wheels", [bootstrap])
        wheel_paths: list[Path] = []
        for wheel in wheel_specs:
            wheel_path = wheel_directory / Path(wheel["wheelUrl"]).name
            _download_verified(
                url=wheel["wheelUrl"],
                path=wheel_path,
                expected_size=wheel["wheelSizeBytes"],
                expected_sha256=wheel["wheelSha256"],
            )
            wheel_paths.append(wheel_path)
        if not python_path.is_file():
            create = run_capture(
                [
                    uv,
                    "venv",
                    "--allow-existing",
                    "--python",
                    execution["pythonVersion"],
                    str(runtime_directory),
                ],
                timeout_seconds=600,
            )
            if create.returncode != 0:
                raise BenchmarkError(
                    "engine-setup",
                    "VENV_CREATE_FAILED",
                    "Could not create the Kraken 7 virtual environment",
                    _subprocess_details([uv, "venv"], create),
                )
        install = run_capture(
            [
                uv,
                "pip",
                "install",
                "--python",
                str(python_path),
                *[str(path) for path in wheel_paths],
            ],
            timeout_seconds=1800,
        )
        if install.returncode != 0:
            raise BenchmarkError(
                "engine-setup",
                "PACKAGE_INSTALL_FAILED",
                "Could not install pinned Kraken 7",
                _subprocess_details([uv, "pip", "install"], install),
            )
        model = self.config["model"]
        if model["kind"] == "download":
            _download_verified(
                url=model["downloadUrl"],
                path=resolve_backend_relative(model["path"]),
                expected_size=model["publishedSizeBytes"],
                expected_sha256=model["expectedSha256"],
                expected_md5=model.get("publishedMd5"),
            )

    def _preflight_eynollah(self) -> dict[str, Any]:
        self._require_eynollah_memory()
        image = self.config["execution"]["image"]
        inspect = run_capture(
            ["docker", "image", "inspect", image, "--format", "{{json .}}"],
            timeout_seconds=30,
        )
        if inspect.returncode != 0:
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_NOT_SETUP",
                "Pinned Eynollah CPU image is not built",
                {
                    "image": image,
                    "setupCommand": (
                        "npx tsx scripts/run-layout-benchmark.ts setup "
                        f"--engine {self.engine_id}"
                    ),
                    "stderr": inspect.stderr[-8000:],
                },
            )
        try:
            image_data = json.loads(inspect.stdout)
        except json.JSONDecodeError as exc:
            raise BenchmarkError(
                "engine-preflight",
                "INVALID_DOCKER_INSPECT",
                "Docker returned invalid image metadata",
            ) from exc
        image_platform = _normalize_docker_platform(
            f"{image_data.get('Os', 'unknown')}/"
            f"{image_data.get('Architecture', 'unknown')}"
        )
        requested_platform = self.config["execution"].get("platform", "native")
        expected_platform = (
            _docker_server_platform()
            if requested_platform == "native"
            else _normalize_docker_platform(requested_platform)
        )
        if image_platform != expected_platform:
            raise BenchmarkError(
                "engine-preflight",
                "DOCKER_PLATFORM_MISMATCH",
                "Eynollah image architecture does not match the requested native platform",
                {
                    "requested": requested_platform,
                    "expected": expected_platform,
                    "image": image_platform,
                    "emulationAllowed": False,
                },
            )
        describe_script = (
            "import json,platform;"
            "from importlib.metadata import distributions,version;"
            "import onnxruntime;"
            "print(json.dumps({"
            "'pythonVersion':platform.python_version(),"
            "'package':{'name':'eynollah','version':version('eynollah')},"
            "'dependencies':{(d.metadata.get('Name') or 'unknown'):d.version "
            "for d in distributions()},"
            "'providers':onnxruntime.get_available_providers()"
            "},sort_keys=True))"
        )
        describe_command = self._docker_prefix() + [
            image,
            "python",
            "-c",
            describe_script,
        ]
        describe = run_capture(describe_command, timeout_seconds=120)
        if describe.returncode != 0:
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_PREFLIGHT_FAILED",
                "Eynollah container preflight failed",
                _subprocess_details(describe_command, describe),
            )
        try:
            observed = json.loads(describe.stdout)
        except json.JSONDecodeError as exc:
            raise BenchmarkError(
                "engine-preflight",
                "INVALID_PREFLIGHT_OUTPUT",
                "Eynollah returned invalid preflight JSON",
                {"stdout": describe.stdout[-8000:]},
            ) from exc
        expected_version = self.config["package"]["version"]
        if observed["package"]["version"] != expected_version:
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_VERSION_DRIFT",
                "Eynollah container package version does not match config",
                {
                    "expected": expected_version,
                    "actual": observed["package"]["version"],
                },
            )
        if "CPUExecutionProvider" not in observed["providers"]:
            raise BenchmarkError(
                "engine-preflight",
                "INFERENCE_PROVIDER_MISSING",
                "Eynollah container does not expose CPUExecutionProvider",
                {"providers": observed["providers"]},
            )
        archive_path = resolve_backend_relative(self.config["models"]["archive"])
        model_config = self.config["models"]
        required_models = _required_eynollah_models(model_config)
        if not archive_path.is_file() or not _download_matches(
            archive_path,
            expected_size=model_config["publishedSizeBytes"],
            expected_sha256=model_config.get("publishedSha256"),
            expected_md5=model_config["publishedMd5"],
        ):
            raise BenchmarkError(
                "engine-preflight",
                "MODEL_ARCHIVE_DRIFT",
                "Pinned Eynollah model archive is missing or invalid",
                {
                    "archive": backend_relative(archive_path),
                    "expectedSizeBytes": model_config["publishedSizeBytes"],
                    "expectedSha256": model_config.get("publishedSha256"),
                    "expectedMd5": model_config["publishedMd5"],
                    "setupCommand": (
                        "npx tsx scripts/run-layout-benchmark.ts setup "
                        f"--engine {self.engine_id}"
                    ),
                },
            )
        models_dir = self._eynollah_models_directory()
        models = _verify_eynollah_model_directory(
            models_dir,
            required_models,
        )
        models.insert(
            0,
            {
                "name": archive_path.name,
                "sha256": sha256_file(archive_path),
                "sizeBytes": archive_path.stat().st_size,
            },
        )
        image_digest = image_data.get("Id")
        return {
            "id": self.engine_id,
            "adapterVersion": self.config["adapterVersion"],
            "package": observed["package"],
            "models": models,
            "configuration": self.configuration_metadata(),
            "execution": {
                "kind": "docker",
                "image": image,
                "imageDigest": image_digest,
                "commandFingerprint": self._eynollah_command_fingerprint(),
                "pythonVersion": observed["pythonVersion"],
                "inferenceProvider": ",".join(observed["providers"]),
                "dependencies": {
                    **observed["dependencies"],
                    "docker-image-platform": image_platform,
                },
            },
        }

    def _setup_eynollah(self) -> None:
        self._require_eynollah_memory()
        dockerfile = resolve_backend_relative(
            self.config["execution"]["dockerfile"]
        )
        image = self.config["execution"]["image"]
        build = run_capture(
            [
                "docker",
                "build",
                *self._docker_platform_args(),
                "--file",
                str(dockerfile),
                "--tag",
                image,
                str(BACKEND_ROOT),
            ],
            timeout_seconds=3600,
        )
        if build.returncode != 0:
            raise BenchmarkError(
                "engine-setup",
                "DOCKER_BUILD_FAILED",
                "Could not build the pinned Eynollah CPU image",
                _subprocess_details(["docker", "build"], build),
            )

        model_config = self.config["models"]
        required_models = _required_eynollah_models(model_config)
        archive_path = resolve_backend_relative(model_config["archive"])
        _download_verified(
            url=model_config["downloadUrl"],
            path=archive_path,
            expected_size=model_config["publishedSizeBytes"],
            expected_sha256=model_config.get("publishedSha256"),
            expected_md5=model_config["publishedMd5"],
        )
        models_directory = self._eynollah_models_directory()
        if models_directory.is_dir():
            try:
                _verify_eynollah_model_directory(
                    models_directory,
                    required_models,
                )
                return
            except BenchmarkError:
                pass
        _install_eynollah_models(
            archive_path,
            models_directory,
            required_models,
        )

    def _eynollah_models_directory(self) -> Path:
        return resolve_backend_relative(self.config["models"]["directory"])

    def _require_eynollah_memory(self) -> None:
        result = run_capture(
            ["docker", "info", "--format", "{{.MemTotal}}"],
            timeout_seconds=30,
        )
        if result.returncode != 0:
            raise BenchmarkError(
                "engine-preflight",
                "DOCKER_UNAVAILABLE",
                "Docker is required for Eynollah",
                {"stderr": result.stderr[-8000:]},
            )
        try:
            available = int(result.stdout.strip())
        except ValueError as exc:
            raise BenchmarkError(
                "engine-preflight",
                "DOCKER_MEMORY_UNKNOWN",
                "Could not determine Docker container memory",
                {"stdout": result.stdout[-8000:]},
            ) from exc
        requirements = self.config["resourceRequirements"]
        minimum = int(requirements["minimumContainerMemoryBytes"])
        if available < minimum:
            raise BenchmarkError(
                "engine-preflight",
                "ENGINE_MEMORY_INSUFFICIENT",
                "Docker does not expose enough memory for Eynollah full layout",
                {
                    "availableContainerMemoryBytes": available,
                    "minimumContainerMemoryBytes": minimum,
                    "modelWorkerLimitBytes": requirements[
                        "modelWorkerLimitBytes"
                    ],
                    "recommendedHostMemoryBytes": requirements[
                        "recommendedHostMemoryBytes"
                    ],
                    "mode": requirements["mode"],
                    "rationale": requirements["rationale"],
                },
            )

    def _docker_prefix(self) -> list[str]:
        return [
            "docker",
            "run",
            "--rm",
            *self._docker_platform_args(),
        ]

    def _docker_platform_args(self) -> list[str]:
        requested = self.config["execution"].get("platform", "native")
        return [] if requested == "native" else ["--platform", requested]

    def _eynollah_layout_command(self) -> list[str]:
        parameters = self.config["parameters"]
        command = [
            "eynollah",
            "-m",
            "/models",
        ]
        page_model_override = parameters.get(
            "pageModelOverrideForInitialization"
        )
        if page_model_override:
            command.extend(["-mv", "page", "", page_model_override])
        command.extend(
            [
                "-D",
                parameters["device"],
                "layout",
                "-i",
                "/work/prepared.png",
                "-o",
                "/work/provider-output",
            ]
        )
        if parameters["fullLayout"]:
            command.append("-fl")
        if parameters["curvedTextLines"]:
            command.append("-cl")
        if parameters["tableDetection"]:
            command.append("-tab")
        if parameters["scaling"]:
            command.append("-as")
        if parameters["enhancement"]:
            command.append("-ae")
        if parameters["binarization"]:
            command.append("-ib")
        if parameters.get("ignorePageExtraction"):
            command.append("-ipe")
        return command

    def _eynollah_command_fingerprint(self) -> str:
        return hashlib.sha256(
            canonical_json_bytes({"argv": self._eynollah_layout_command()})
        ).hexdigest()

    def _run_eynollah(
        self, page_directory: Path, prepared_path: Path, raw_path: Path
    ) -> EngineInvocation:
        output_directory = page_directory / "provider-output"
        output_directory.mkdir(exist_ok=False)
        try:
            return self._run_eynollah_with_output(
                page_directory,
                prepared_path,
                raw_path,
                output_directory,
            )
        finally:
            shutil.rmtree(output_directory, ignore_errors=True)

    def _run_eynollah_with_output(
        self,
        page_directory: Path,
        prepared_path: Path,
        raw_path: Path,
        output_directory: Path,
    ) -> EngineInvocation:
        models_directory = self._eynollah_models_directory()
        container_name = (
            f"layout-benchmark-{os.getpid()}-{secrets.token_hex(4)}"
        )
        eynollah_command = self._eynollah_layout_command()
        wrapped_command = (
            f"{shlex.join(eynollah_command)}; engine_status=$?; "
            "if [ -r /sys/fs/cgroup/memory.peak ]; then "
            "cat /sys/fs/cgroup/memory.peak > "
            "/work/provider-output/cgroup-memory-peak.txt; fi; "
            "exit $engine_status"
        )
        command = self._docker_prefix() + [
            "--name",
            container_name,
            "--volume",
            f"{page_directory.resolve()}:/work",
            "--volume",
            f"{models_directory.resolve()}:/models:ro",
            self.config["execution"]["image"],
            "sh",
            "-c",
            wrapped_command,
        ]
        try:
            result = run_capture(command, timeout_seconds=self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            run_capture(["docker", "kill", container_name], timeout_seconds=30)
            state = _inspect_container_state(container_name)
            run_capture(["docker", "rm", container_name], timeout_seconds=30)
            peak_rss = _read_integer_file(
                output_directory / "cgroup-memory-peak.txt"
            )
            raise BenchmarkError(
                "engine-inference",
                "ENGINE_TIMEOUT",
                f"Eynollah exceeded {self.timeout_seconds} seconds",
                {
                    "timeoutSeconds": self.timeout_seconds,
                    "stdout": _decode_timeout_stream(exc.stdout),
                    "stderr": _decode_timeout_stream(exc.stderr),
                    "containerState": state,
                    "peakRssBytes": peak_rss,
                    "resourceMeasurement": _eynollah_resource_measurement(
                        peak_rss,
                        (
                            "The container timed out before cgroup "
                            "memory.peak could be persisted."
                        ),
                    ),
                },
            ) from exc
        state = _inspect_container_state(container_name)
        run_capture(["docker", "rm", container_name], timeout_seconds=30)
        peak_path = output_directory / "cgroup-memory-peak.txt"
        peak_rss = _read_integer_file(peak_path)
        resource_measurement = _eynollah_resource_measurement(
            peak_rss,
            "The container exited before cgroup memory.peak could be persisted.",
        )
        oom_killed = bool(state.get("OOMKilled")) if state else False
        if result.returncode != 0:
            code = (
                "ENGINE_OOM"
                if oom_killed or result.returncode in {137, -9}
                else "ENGINE_FAILED"
            )
            details = _subprocess_details(command, result)
            details.update(
                {
                    "containerState": state,
                    "peakRssBytes": peak_rss,
                    "resourceMeasurement": resource_measurement,
                }
            )
            raise BenchmarkError(
                "engine-inference",
                code,
                f"Eynollah failed with exit code {result.returncode}",
                details,
            )
        xml_files = sorted(output_directory.glob("*.xml"))
        if len(xml_files) != 1:
            details = _subprocess_details(command, result)
            details.update(
                {
                    "xmlFiles": [path.name for path in xml_files],
                    "containerState": state,
                    "peakRssBytes": peak_rss,
                    "resourceMeasurement": resource_measurement,
                }
            )
            raise BenchmarkError(
                "engine-inference",
                "RAW_OUTPUT_MISSING",
                "Eynollah did not produce exactly one PAGE XML file",
                details,
            )
        shutil.copyfile(xml_files[0], raw_path)
        return EngineInvocation(
            peak_rss_bytes=peak_rss,
            resource_measurement=_eynollah_resource_measurement(
                peak_rss,
                "The container did not expose a readable cgroup v2 memory.peak value.",
            ),
            stderr=result.stderr,
            user_cpu_ms=None,
            system_cpu_ms=None,
        )


def _sanitize_model(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(value["name"]),
        "sha256": str(value["sha256"]),
        "sizeBytes": int(value["sizeBytes"]),
    }


def _read_integer_file(path: Path) -> int | None:
    if not path.is_file():
        return None
    try:
        value = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    return value if value >= 0 else None


def _eynollah_resource_measurement(
    peak_rss: int | None,
    unavailable_caveat: str,
) -> dict[str, str]:
    if peak_rss is not None:
        return {
            "method": "cgroup-v2-memory.peak",
            "caveat": "Peak covers the entire Eynollah container cgroup.",
        }
    return {
        "method": "unavailable",
        "caveat": unavailable_caveat,
    }


def _model_inventory(
    directory: Path,
    *,
    stage: str = "engine-preflight",
) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        values.append(
            {
                "name": path.relative_to(directory).as_posix(),
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    if not values:
        raise BenchmarkError(
            stage,
            "MODEL_INVENTORY_EMPTY",
            f"No Eynollah model files found under {directory}",
        )
    return values


def _required_eynollah_models(
    model_config: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if not re.fullmatch(
        r"[a-f0-9]{64}",
        str(model_config.get("publishedSha256", "")),
    ):
        raise BenchmarkError(
            "configuration",
            "INVALID_MODEL_MANIFEST",
            "Eynollah model config must pin the archive publishedSha256",
        )
    raw = model_config.get("requiredFiles")
    if not isinstance(raw, dict) or not raw:
        raise BenchmarkError(
            "configuration",
            "INVALID_MODEL_MANIFEST",
            "Eynollah model config must pin a nonempty requiredFiles manifest",
        )
    required: dict[str, dict[str, Any]] = {}
    for name, metadata in raw.items():
        path = Path(str(name))
        if (
            not isinstance(name, str)
            or not name
            or path.is_absolute()
            or ".." in path.parts
            or path.as_posix() != name
            or not isinstance(metadata, dict)
            or not re.fullmatch(r"[a-f0-9]{64}", str(metadata.get("sha256", "")))
            or not isinstance(metadata.get("sizeBytes"), int)
            or metadata["sizeBytes"] < 0
        ):
            raise BenchmarkError(
                "configuration",
                "INVALID_MODEL_MANIFEST",
                f"Invalid Eynollah required model entry: {name}",
            )
        required[name] = {
            "sha256": metadata["sha256"],
            "sizeBytes": metadata["sizeBytes"],
        }
    return required


def _verify_eynollah_model_directory(
    directory: Path,
    required: dict[str, dict[str, Any]],
    *,
    stage: str = "engine-preflight",
) -> list[dict[str, Any]]:
    if not directory.is_dir():
        raise BenchmarkError(
            stage,
            "MODELS_NOT_SETUP",
            "Pinned Eynollah models are not installed",
            {"modelsDirectory": str(directory)},
        )
    observed = _model_inventory(directory, stage=stage)
    observed_by_name = {item["name"]: item for item in observed}
    missing = sorted(set(required) - set(observed_by_name))
    unexpected = sorted(set(observed_by_name) - set(required))
    mismatched = sorted(
        name
        for name in set(required) & set(observed_by_name)
        if (
            observed_by_name[name]["sha256"] != required[name]["sha256"]
            or observed_by_name[name]["sizeBytes"] != required[name]["sizeBytes"]
        )
    )
    if missing or unexpected or mismatched:
        raise BenchmarkError(
            stage,
            "MODEL_MANIFEST_MISMATCH",
            "Extracted Eynollah models do not match the pinned manifest",
            {
                "modelsDirectory": str(directory),
                "missing": missing,
                "unexpected": unexpected,
                "mismatched": mismatched,
            },
        )
    return observed


def _install_eynollah_models(
    archive_path: Path,
    models_directory: Path,
    required: dict[str, dict[str, Any]],
) -> None:
    models_directory.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(
            prefix=".models-staging-", dir=str(models_directory.parent)
        )
    )
    backup: Path | None = None
    try:
        with zipfile.ZipFile(archive_path) as archive:
            _safe_extract_zip(archive, temporary)
        _verify_eynollah_model_directory(
            temporary,
            required,
            stage="engine-setup",
        )
        if models_directory.exists():
            backup = models_directory.parent / (
                f".models-backup-{secrets.token_hex(6)}"
            )
            os.replace(models_directory, backup)
        try:
            os.replace(temporary, models_directory)
        except Exception:
            if backup is not None and backup.exists():
                os.replace(backup, models_directory)
                backup = None
            raise
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
        if backup is not None and backup.exists():
            if backup.is_dir():
                shutil.rmtree(backup)
            else:
                backup.unlink()


def _download_verified(
    *,
    url: str,
    path: Path,
    expected_size: int,
    expected_sha256: str | None = None,
    expected_md5: str | None = None,
) -> None:
    if path.is_file() and _download_matches(
        path,
        expected_size=expected_size,
        expected_sha256=expected_sha256,
        expected_md5=expected_md5,
    ):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    if partial.exists():
        partial.unlink()
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open(
            "wb"
        ) as destination:
            shutil.copyfileobj(response, destination, length=1024 * 1024)
    except Exception as exc:
        if partial.exists():
            partial.unlink()
        raise BenchmarkError(
            "engine-setup",
            "DOWNLOAD_FAILED",
            f"Could not download {path.name}: {exc}",
            {"url": url},
        ) from exc
    if not _download_matches(
        partial,
        expected_size=expected_size,
        expected_sha256=expected_sha256,
        expected_md5=expected_md5,
    ):
        raise BenchmarkError(
            "engine-setup",
            "DOWNLOAD_CHECKSUM_MISMATCH",
            f"Downloaded artifact failed verification: {path.name}",
            {
                "expectedSizeBytes": expected_size,
                "actualSizeBytes": partial.stat().st_size,
                "expectedSha256": expected_sha256,
                "actualSha256": sha256_file(partial),
                "expectedMd5": expected_md5,
            },
        )
    os.replace(partial, path)


def _download_matches(
    path: Path,
    *,
    expected_size: int,
    expected_sha256: str | None,
    expected_md5: str | None,
) -> bool:
    if path.stat().st_size != expected_size:
        return False
    if expected_sha256 is not None and sha256_file(path) != expected_sha256:
        return False
    if expected_md5 is not None:
        digest = hashlib.md5(usedforsecurity=False)
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != expected_md5:
            return False
    return True


def _safe_extract_zip(archive: zipfile.ZipFile, destination: Path) -> None:
    destination_resolved = destination.resolve()
    for member in archive.infolist():
        target = (destination / member.filename).resolve()
        try:
            target.relative_to(destination_resolved)
        except ValueError as exc:
            raise BenchmarkError(
                "engine-setup",
                "UNSAFE_MODEL_ARCHIVE",
                f"Model archive member escapes destination: {member.filename}",
            ) from exc
    archive.extractall(destination)

def _docker_server_platform() -> str:
    result = run_capture(
        ["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"],
        timeout_seconds=30,
    )
    if result.returncode != 0 or "/" not in result.stdout:
        raise BenchmarkError(
            "engine-preflight",
            "DOCKER_PLATFORM_UNKNOWN",
            "Could not determine the Docker server platform",
            {"stdout": result.stdout[-8000:], "stderr": result.stderr[-8000:]},
        )
    return _normalize_docker_platform(result.stdout.strip())


def _normalize_docker_platform(value: str) -> str:
    operating_system, separator, architecture = value.strip().lower().partition("/")
    if not separator:
        return value.strip().lower()
    aliases = {
        "aarch64": "arm64",
        "arm64v8": "arm64",
        "x86_64": "amd64",
        "x64": "amd64",
    }
    return f"{operating_system}/{aliases.get(architecture, architecture)}"


def _parse_macos_peak_rss(stderr: str) -> int | None:
    match = re.search(
        r"^\s*(\d+)\s+maximum resident set size\s*$", stderr, re.MULTILINE
    )
    return int(match.group(1)) if match else None


def _parse_macos_time_ms(stderr: str, label: str) -> int | None:
    match = re.search(
        rf"^\s*(?:{re.escape(label)}\s+(\d+(?:\.\d+)?)|"
        rf"(\d+(?:\.\d+)?)\s+{re.escape(label)})\s*$",
        stderr,
        re.MULTILINE,
    )
    if match is None:
        return None
    seconds = match.group(1) or match.group(2)
    return round(float(seconds) * 1000)


def _without_time_metrics(stderr: str) -> str:
    metric_patterns = (
        r"^\s*\d+(?:\.\d+)?\s+real\s*$",
        r"^\s*\d+(?:\.\d+)?\s+user\s*$",
        r"^\s*\d+(?:\.\d+)?\s+sys\s*$",
        r"^\s*real\s+\d+(?:\.\d+)?\s*$",
        r"^\s*user\s+\d+(?:\.\d+)?\s*$",
        r"^\s*sys\s+\d+(?:\.\d+)?\s*$",
        r"^\s*\d+\s+maximum resident set size\s*$",
        r"^\s*\d+\s+average shared memory size\s*$",
        r"^\s*\d+\s+average unshared data size\s*$",
        r"^\s*\d+\s+average unshared stack size\s*$",
        r"^\s*\d+\s+page reclaims\s*$",
        r"^\s*\d+\s+page faults\s*$",
        r"^\s*\d+\s+swaps\s*$",
        r"^\s*\d+\s+block input operations\s*$",
        r"^\s*\d+\s+block output operations\s*$",
        r"^\s*\d+\s+messages sent\s*$",
        r"^\s*\d+\s+messages received\s*$",
        r"^\s*\d+\s+signals received\s*$",
        r"^\s*\d+\s+voluntary context switches\s*$",
        r"^\s*\d+\s+involuntary context switches\s*$",
        r"^\s*\d+\s+instructions retired\s*$",
        r"^\s*\d+\s+cycles elapsed\s*$",
        r"^\s*\d+\s+peak memory footprint\s*$",
    )
    kept = [
        line
        for line in stderr.splitlines()
        if not any(re.match(pattern, line) for pattern in metric_patterns)
    ]
    return "\n".join(kept).strip()


def _subprocess_details(
    command: list[str], result: subprocess.CompletedProcess[str]
) -> dict[str, Any]:
    return {
        "command": _redacted_command(command),
        "exitCode": result.returncode,
        "stdout": result.stdout[-50000:],
        "stderr": result.stderr[-50000:],
    }


def _redacted_command(command: list[str]) -> list[str]:
    values: list[str] = []
    for token in command:
        if token.startswith(str(BACKEND_ROOT)):
            try:
                values.append(backend_relative(Path(token)))
                continue
            except (ValueError, OSError):
                pass
        values.append(token)
    return values


def _decode_timeout_stream(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")[-50000:]
    return value[-50000:]


def _inspect_container_state(container_name: str) -> dict[str, Any]:
    result = run_capture(
        [
            "docker",
            "inspect",
            container_name,
            "--format",
            "{{json .State}}",
        ],
        timeout_seconds=30,
    )
    if result.returncode != 0:
        return {}
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}
    return json_safe(value) if isinstance(value, dict) else {}
