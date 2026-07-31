from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from dataclasses import asdict
from importlib import resources
from importlib.metadata import PackageNotFoundError, distributions, version
from pathlib import Path
from typing import Any


class RotationBaselinePassError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("adapter") != "kraken":
        raise RuntimeError(f"{path} is not a Kraken adapter config")
    return config


def _inference_provider(config: dict[str, Any]) -> str:
    device = str(config.get("parameters", {}).get("device", "auto"))
    device_type = device.split(",", 1)[0].split(":", 1)[0].strip().lower()
    return f"torch-{device_type or 'auto'}"


def _runtime_inference_configuration(config: dict[str, Any]) -> dict[str, Any]:
    """
    Resolves the configured device and precision through Kraken/Lightning.

    Orli's bfloat16 requirement is model-critical, so preflight must record more
    than a generic ``torch-*`` provider label. Constructing Fabric verifies that
    this installed runtime accepts the exact accelerator/precision pair before
    a long page inference begins.
    """
    parameters = config.get("parameters", {})
    device = str(parameters.get("device", "auto"))
    precision = parameters.get("precision")
    result: dict[str, Any] = {
        "configuredDevice": device,
        "configuredPrecision": precision,
        "inferenceProvider": _inference_provider(config),
    }
    if config.get("api") != "segmentation-task":
        return result

    from kraken.ketos.util import to_ptl_device

    accelerator, devices = to_ptl_device(device)
    result["accelerator"] = accelerator
    result["devices"] = devices
    if config.get("inferenceConfig") == "orli":
        from lightning.fabric import Fabric

        fabric = Fabric(
            accelerator=accelerator,
            devices=devices,
            precision=precision,
        )
        result["resolvedDevice"] = str(fabric.device)
        result["precisionPlugin"] = type(fabric._precision).__name__
    return result


def _provider_json_default(value: Any) -> Any:
    # Kraken plugin containers can contain NumPy-backed polygons even after
    # dataclasses.asdict(). Preserve the coordinates as ordinary JSON arrays.
    try:
        import numpy as np
    except ImportError:
        np = None
    if np is not None:
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, np.generic):
            return value.item()
    if isinstance(value, Path):
        return value.as_posix()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _model_path(config: dict[str, Any], config_path: Path) -> Path:
    model = config["model"]
    if model["kind"] == "package-resource":
        package = model["package"]
        resource = model["resource"]
        candidate = Path(str(resources.files(package).joinpath(resource)))
        if not candidate.is_file():
            # Some Kraken versions expose the bundled model under kraken.blla
            # instead of the package root.
            candidate = Path(
                str(resources.files(f"{package}.blla").joinpath(resource))
            )
    elif model["kind"] == "download":
        backend_root = config_path.resolve().parents[3]
        candidate = (backend_root / model["path"]).resolve()
        try:
            candidate.relative_to(backend_root)
        except ValueError as exc:
            raise RuntimeError(
                f"Downloaded model path escapes backend root: {model['path']}"
            ) from exc
    else:
        raise RuntimeError(f"Unknown Kraken model kind: {model['kind']}")
    if not candidate.is_file():
        raise RuntimeError(f"Kraken model not found: {candidate}")
    return candidate


def describe(config: dict[str, Any], config_path: Path) -> dict[str, Any]:
    expected_version = config["package"]["version"]
    try:
        actual_version = version(config["package"]["name"])
    except PackageNotFoundError as exc:
        raise RuntimeError("Kraken package is not installed") from exc
    if actual_version != expected_version:
        raise RuntimeError(
            f"Kraken version drift: expected {expected_version}, found {actual_version}"
        )
    plugins = []
    for expected in config.get("plugins", []):
        try:
            actual = version(expected["name"])
        except PackageNotFoundError as exc:
            raise RuntimeError(
                f"Kraken plugin is not installed: {expected['name']}"
            ) from exc
        if actual != expected["version"]:
            raise RuntimeError(
                f"Kraken plugin version drift for {expected['name']}: "
                f"expected {expected['version']}, found {actual}"
            )
        plugins.append({"name": expected["name"], "version": actual})
    model_path = _model_path(config, config_path)
    model_sha = _sha256_file(model_path)
    expected_model_sha = config["model"].get("expectedSha256")
    if expected_model_sha is not None and model_sha != expected_model_sha:
        raise RuntimeError(
            "Kraken bundled model checksum drift: "
            f"expected {expected_model_sha}, found {model_sha}"
        )
    import PIL
    import torch

    runtime_inference = _runtime_inference_configuration(config)
    return {
        "package": {"name": "kraken", "version": actual_version},
        "plugins": plugins,
        "pythonVersion": sys.version.split()[0],
        "dependencies": {
            (distribution.metadata.get("Name") or "unknown"): distribution.version
            for distribution in sorted(
                distributions(),
                key=lambda item: (item.metadata.get("Name") or "").lower(),
            )
        },
        "models": [
            {
                "name": (
                    config["model"].get("resource")
                    or config["model"].get("filename")
                    or model_path.name
                ),
                "path": str(model_path),
                "sha256": model_sha,
                "sizeBytes": model_path.stat().st_size,
            }
        ],
        "inferenceProvider": runtime_inference["inferenceProvider"],
        "runtimeInference": runtime_inference,
    }


def segment(
    config: dict[str, Any],
    config_path: Path,
    input_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    os.environ.setdefault("PYTHONHASHSEED", "0")
    random.seed(0)

    import numpy as np
    import torch
    from PIL import Image

    np.random.seed(0)
    torch.manual_seed(0)

    metadata = describe(config, config_path)
    model_path = Path(metadata["models"][0]["path"])
    model_started = time.perf_counter()
    api = config.get("api", "legacy-blla")
    if api == "segmentation-task":
        from kraken.tasks import SegmentationTaskModel

        model = SegmentationTaskModel.load_model(str(model_path))
    elif api == "legacy-blla":
        from kraken.lib import vgsl

        model = vgsl.TorchVGSLModel.load_model(str(model_path))
    else:
        raise RuntimeError(f"Unknown Kraken segmentation API: {api}")
    model_load_ms = round((time.perf_counter() - model_started) * 1000, 3)
    parameters = config["parameters"]

    with Image.open(input_path) as source:
        image = source.convert("RGB")
        inference_started = time.perf_counter()
        if api == "segmentation-task":
            from rotation_geometry import (
                ROTATION_EVIDENCE_CONTRACT,
                merge_rotation_passes,
                rotate_image,
                validate_rotations,
            )

            inference_config = _task_inference_config(
                config,
                parameters,
            )
            configured_rotations = parameters.get("rotationsDegrees")
            if configured_rotations is None:
                segmentation = model.predict(image, inference_config)
                serialized_segmentation = _serialize_segmentation(segmentation)
                rotation_passes = None
                pass_timings = None
                ensemble_quality_error = None
            else:
                if (
                    config.get("rotationEvidenceContract")
                    != ROTATION_EVIDENCE_CONTRACT
                ):
                    raise RuntimeError(
                        "Rotation evidence contract drift: expected "
                        f"{ROTATION_EVIDENCE_CONTRACT}, found "
                        f"{config.get('rotationEvidenceContract')!r}"
                    )
                rotations = validate_rotations(configured_rotations)
                provider_passes: list[dict[str, Any]] = []
                pass_timings = []
                pass_outcomes: list[dict[str, Any]] = []
                for rotation in rotations:
                    rotated_image = rotate_image(image, rotation)
                    pass_started = time.perf_counter()
                    attempts: list[dict[str, Any]] = []
                    try:
                        provider_segmentation = model.predict(
                            rotated_image, inference_config
                        )
                        status = "succeeded"
                        error = None
                        attempts.append(
                            {
                                "raiseOnError": parameters["raiseOnError"],
                                "outcome": "succeeded",
                            }
                        )
                    except Exception as strict_error:
                        attempts.append(
                            {
                                "raiseOnError": parameters["raiseOnError"],
                                "outcome": "failed",
                                "error": _exception_record(strict_error),
                            }
                        )
                        fallback_enabled = bool(
                            parameters.get(
                                "rotationFallbackRaiseOnErrorFalse", False
                            )
                            and parameters["raiseOnError"]
                        )
                        if fallback_enabled:
                            fallback_config = _task_inference_config(
                                config,
                                parameters,
                                raise_on_error=False,
                            )
                            try:
                                provider_segmentation = model.predict(
                                    rotated_image, fallback_config
                                )
                                status = "partial"
                                error = _exception_record(strict_error)
                                attempts.append(
                                    {
                                        "raiseOnError": False,
                                        "outcome": "succeeded",
                                    }
                                )
                            except Exception as fallback_error:
                                provider_segmentation = None
                                status = "failed"
                                error = _exception_record(fallback_error)
                                attempts.append(
                                    {
                                        "raiseOnError": False,
                                        "outcome": "failed",
                                        "error": error,
                                    }
                                )
                        else:
                            provider_segmentation = None
                            status = "failed"
                            error = _exception_record(strict_error)
                    pass_timings.append(
                        {
                            "rotationDegrees": rotation,
                            "inferenceMs": round(
                                (time.perf_counter() - pass_started) * 1000,
                                3,
                            ),
                            "attempts": attempts,
                        }
                    )
                    provider_passes.append(
                        _serialize_segmentation(provider_segmentation)
                        if provider_segmentation is not None
                        else _empty_segmentation(parameters["textDirection"])
                    )
                    pass_outcomes.append(
                        {
                            "rotationDegrees": rotation,
                            "status": status,
                            "error": error,
                            "attempts": attempts,
                            "fallback": {
                                "attempted": any(
                                    attempt.get("raiseOnError") is False
                                    for attempt in attempts
                                ),
                                "outcome": next(
                                    (
                                        attempt.get("outcome")
                                        for attempt in reversed(attempts)
                                        if attempt.get("raiseOnError") is False
                                    ),
                                    None,
                                ),
                            },
                        }
                    )
                ensemble = merge_rotation_passes(
                    provider_passes,
                    rotations=rotations,
                    source_width=image.width,
                    source_height=image.height,
                    merge_policy=str(parameters["rotationMergePolicy"]),
                    pass_outcomes=pass_outcomes,
                )
                serialized_segmentation = ensemble["segmentation"]
                rotation_passes = ensemble["rotationPasses"]
                ensemble_quality_error = ensemble.get("qualityError")
        else:
            from kraken import blla

            segmentation = blla.segment(
                image,
                text_direction=parameters["textDirection"],
                model=model,
                device=parameters["device"],
                raise_on_error=parameters["raiseOnError"],
                autocast=parameters["autocast"],
            )
            serialized_segmentation = _serialize_segmentation(segmentation)
            rotation_passes = None
            pass_timings = None
            ensemble_quality_error = None
        inference_ms = round((time.perf_counter() - inference_started) * 1000, 3)

    raw = {
        "provider": config.get("provider", "kraken"),
        "providerVersion": metadata["package"]["version"],
        "plugins": metadata["plugins"],
        "api": api,
        "inferenceProvider": metadata["inferenceProvider"],
        "runtimeInference": metadata["runtimeInference"],
        "model": metadata["models"][0],
        "parameters": parameters,
        "timings": {
            "modelLoadMs": model_load_ms,
            "inferenceMs": inference_ms,
            "rotationPasses": pass_timings,
        },
        "image": {
            "filename": input_path.name,
            "width": image.width,
            "height": image.height,
            "mode": image.mode,
        },
        "segmentation": serialized_segmentation,
    }
    if rotation_passes is not None:
        raw["rotationPasses"] = rotation_passes
    if ensemble_quality_error is not None:
        raw["qualityError"] = ensemble_quality_error
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            raw,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            default=_provider_json_default,
        )
        + "\n",
        encoding="utf-8",
    )
    if ensemble_quality_error is not None:
        raise RotationBaselinePassError(ensemble_quality_error["message"])
    return raw


def _serialize_segmentation(segmentation: Any) -> dict[str, Any]:
    lines = []
    for ordinal, line in enumerate(segmentation.lines):
        value = asdict(line)
        value["providerOrdinal"] = ordinal
        lines.append(value)
    regions: dict[str, list[dict[str, Any]]] = {}
    for region_class, provider_regions in segmentation.regions.items():
        regions[str(region_class)] = []
        for ordinal, region in enumerate(provider_regions):
            value = asdict(region)
            value["providerOrdinal"] = ordinal
            regions[str(region_class)].append(value)
    return {
        "type": segmentation.type,
        "textDirection": segmentation.text_direction,
        "scriptDetection": segmentation.script_detection,
        "lineOrders": segmentation.line_orders,
        "language": segmentation.language,
        "regions": regions,
        "lines": lines,
    }


def _empty_segmentation(text_direction: str) -> dict[str, Any]:
    return {
        "type": "baselines",
        "textDirection": text_direction,
        "scriptDetection": False,
        "lineOrders": [],
        "language": None,
        "regions": {},
        "lines": [],
    }


def _exception_record(error: Exception) -> dict[str, str]:
    return {
        "type": type(error).__name__,
        "message": str(error)[:2_000],
    }


def _task_inference_config(
    config: dict[str, Any],
    parameters: dict[str, Any],
    *,
    raise_on_error: bool | None = None,
) -> Any:
    from kraken.configs import SegmentationInferenceConfig
    from kraken.ketos.util import to_ptl_device

    inference_config_class = SegmentationInferenceConfig
    if config.get("inferenceConfig") == "orli":
        from orli.configs import OrliSegmentationInferenceConfig

        inference_config_class = OrliSegmentationInferenceConfig
    accelerator, devices = to_ptl_device(parameters["device"])
    return inference_config_class(
        accelerator=accelerator,
        device=devices,
        precision=parameters["precision"],
        batch_size=parameters["batchSize"],
        raise_on_error=(
            parameters["raiseOnError"]
            if raise_on_error is None
            else raise_on_error
        ),
        num_threads=parameters["numThreads"],
        text_direction=parameters["textDirection"],
        input_padding=parameters["inputPadding"],
        polygonize=parameters.get("polygonize", False),
        max_predicted_lines=parameters.get("maxPredictedLines", 768),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Internal isolated Kraken benchmark worker"
    )
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--describe", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.describe and (args.input is None or args.output is None):
        parser.error("--input and --output are required unless --describe is used")
    return args


def main() -> None:
    args = parse_args()
    try:
        config = _load_config(args.config)
        if args.describe:
            print(json.dumps(describe(config, args.config), sort_keys=True))
            return
        segment(config, args.config, args.input, args.output)
    except Exception as exc:
        print(
            json.dumps(
                {
                    "stage": "engine",
                    "code": type(exc).__name__,
                    "message": str(exc),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        raise


if __name__ == "__main__":
    main()
