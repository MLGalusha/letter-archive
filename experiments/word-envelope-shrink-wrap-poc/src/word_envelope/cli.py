"""Command-line interface for the isolated word-envelope POC."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .agent_action_builder import build_bound_action_from_paths
from .agent_benchmark import evaluate_agent_action
from .agent_cohort import compare_agent_cohorts, evaluate_agent_cohort
from .agent_packs import generate_agent_task_packs, stage_public_task_packs
from .agent_risk import assess_ownership_risk
from .engine import EnvelopeError, EnvelopeParams, MAX_MASK_PIXELS
from .io_utils import (
    check_rss,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from .limits import generate_limit_characterization
from .masks import (
    apply_cleanup_operations,
    create_bounded_crop,
    extract_ink_mask,
    load_mask,
    save_mask,
    stable_components,
)
from .records import build_example, reset_result_dir
from .real_stress import generate_real_stress_suite
from .render import (
    save_component_overlay,
    save_contact_sheet,
    save_method_comparison,
)
from .synthetic import generate_synthetic_suite


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    try:
        check_rss("CLI start")
        return int(arguments.handler(arguments) or 0)
    except (EnvelopeError, MemoryError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="word-envelope",
        description="Deterministic handwritten-word envelope proof of concept",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    crop = subparsers.add_parser(
        "crop", description="Create a small bounded source crop with exact metadata"
    )
    crop.add_argument("--source", type=Path, required=True)
    crop.add_argument("--box", nargs=4, type=int, metavar=("X", "Y", "W", "H"), required=True)
    crop.add_argument("--padding", type=int, default=0)
    crop.add_argument("--max-pixels", type=int, default=1_500_000)
    crop.add_argument("--output-dir", type=Path, required=True)
    crop.set_defaults(handler=_crop)

    extract = subparsers.add_parser(
        "extract", description="Extract a raw dark-ink mask from a small crop"
    )
    extract.add_argument("--crop", type=Path, required=True)
    extract.add_argument("--window-size", type=int, default=31)
    extract.add_argument("--k", type=float, default=0.16)
    extract.add_argument("--offset", type=float, default=0.0)
    extract.add_argument("--minimum-component-area", type=int, default=2)
    extract.add_argument("--output-dir", type=Path, required=True)
    extract.set_defaults(handler=_extract)

    components = subparsers.add_parser(
        "components", description="Inventory and number connected components"
    )
    components.add_argument("--mask", type=Path, required=True)
    components.add_argument("--crop", type=Path)
    components.add_argument("--polarity", choices=("auto", "dark", "bright"), default="auto")
    components.add_argument("--include-pixels", action="store_true")
    components.add_argument("--output-dir", type=Path, required=True)
    components.set_defaults(handler=_components)

    clean = subparsers.add_parser(
        "clean", description="Replay component, polygon, scribble, and cut operations"
    )
    clean.add_argument("--mask", type=Path, required=True)
    clean.add_argument("--operations", type=Path, required=True)
    clean.add_argument("--crop", type=Path)
    clean.add_argument("--polarity", choices=("auto", "dark", "bright"), default="auto")
    clean.add_argument("--output-dir", type=Path, required=True)
    clean.set_defaults(handler=_clean)

    wrap = subparsers.add_parser(
        "wrap", description="Preview and record one or both envelope approaches"
    )
    wrap.add_argument("--example-id", required=True)
    wrap.add_argument("--crop", type=Path, required=True)
    wrap.add_argument("--raw-mask", type=Path, required=True)
    wrap.add_argument("--cleaned-mask", type=Path, required=True)
    wrap.add_argument("--excluded-mask", type=Path)
    wrap.add_argument("--metadata", type=Path, required=True)
    wrap.add_argument("--operations", type=Path)
    wrap.add_argument(
        "--method", choices=("morphological", "soft_union", "both"), default="both"
    )
    wrap.add_argument("--params", type=Path)
    wrap.add_argument("--angle", type=float)
    wrap.add_argument("--centerline", type=Path)
    wrap.add_argument("--along-bridge", type=float)
    wrap.add_argument("--cross-bridge", type=float)
    wrap.add_argument("--padding", type=float)
    wrap.add_argument("--smooth-iterations", type=int)
    wrap.add_argument("--simplify-tolerance", type=float)
    wrap.add_argument("--soft-threshold", type=float)
    wrap.add_argument("--minimum-selected-coverage", type=float)
    wrap.add_argument("--minimum-selected-ink-pixels", type=int)
    wrap.add_argument("--maximum-envelope-fraction", type=float)
    wrap.add_argument("--maximum-envelope-to-ink-area-ratio", type=float)
    wrap.add_argument("--maximum-excluded-contamination", type=float)
    wrap.add_argument("--maximum-excluded-component-contamination", type=float)
    wrap.add_argument("--minimum-excluded-component-pixels-for-gate", type=int)
    wrap.add_argument("--allow-border-touching-ink", action="store_true", default=None)
    wrap.add_argument("--rough-box", nargs=4, type=float, metavar=("X", "Y", "W", "H"))
    wrap.add_argument(
        "--assessment-status",
        choices=("success", "partial", "failure", "unreviewed"),
        default="unreviewed",
    )
    wrap.add_argument("--assessment-notes", default="")
    wrap.add_argument("--output-dir", type=Path, required=True)
    wrap.set_defaults(handler=_wrap)

    synthetic = subparsers.add_parser(
        "synthetic", description="Generate all synthetic cases and galleries serially"
    )
    synthetic.add_argument("--output-dir", type=Path, required=True)
    synthetic.set_defaults(handler=_synthetic)

    limits = subparsers.add_parser(
        "limits",
        description="Run deterministic adversarial sweeps and failure cases serially",
    )
    limits.add_argument("--output-dir", type=Path, required=True)
    limits.set_defaults(handler=_limits)

    stress_real = subparsers.add_parser(
        "stress-real",
        description="Replay the frozen real-word stress corpus serially",
    )
    stress_real.add_argument("--manifest", type=Path, required=True)
    stress_real.add_argument("--output-dir", type=Path, required=True)
    stress_real.set_defaults(handler=_stress_real)

    agent_pack = subparsers.add_parser(
        "agent-pack",
        description="Generate blinded context/component task packs for ownership agents",
    )
    agent_pack.add_argument("--pilot", type=Path, required=True)
    agent_pack.add_argument("--stress-manifest", type=Path, required=True)
    agent_pack.add_argument("--stress-artifacts", type=Path, required=True)
    agent_pack.add_argument("--prompt", type=Path, required=True)
    agent_pack.add_argument("--output-dir", type=Path, required=True)
    agent_pack.set_defaults(handler=_agent_pack)

    agent_stage = subparsers.add_parser(
        "agent-stage",
        description="Copy verified task assets into a separate public-only stage",
    )
    agent_stage.add_argument("--packs", type=Path, required=True)
    agent_stage.add_argument("--task-id", action="append")
    agent_stage.add_argument("--output-dir", type=Path, required=True)
    agent_stage.set_defaults(handler=_agent_stage)

    agent_build = subparsers.add_parser(
        "agent-build-action",
        description="Expand a compact ID-only decision into a replay-bound action",
    )
    agent_build.add_argument("--task", type=Path, required=True)
    agent_build.add_argument("--decision", type=Path, required=True)
    agent_build.add_argument("--output", type=Path, required=True)
    agent_build.set_defaults(handler=_agent_build_action)

    agent_evaluate = subparsers.add_parser(
        "agent-evaluate",
        description="Replay and score one bound ownership action",
    )
    agent_evaluate.add_argument("--task-dir", type=Path, required=True)
    agent_evaluate.add_argument("--action", type=Path, required=True)
    agent_evaluate.add_argument("--output-dir", type=Path, required=True)
    agent_evaluate.set_defaults(handler=_agent_evaluate)

    agent_cohort = subparsers.add_parser(
        "agent-evaluate-cohort",
        description="Fail-closed replay and scoring for one exact action cohort",
    )
    agent_cohort.add_argument("--tasks-root", type=Path, required=True)
    agent_cohort.add_argument("--actions-dir", type=Path, required=True)
    agent_cohort.add_argument("--task-id", action="append")
    agent_cohort.add_argument("--output-dir", type=Path, required=True)
    agent_cohort.set_defaults(handler=_agent_evaluate_cohort)

    agent_compare = subparsers.add_parser(
        "agent-compare",
        description="Compare two matched evaluated ownership cohorts",
    )
    agent_compare.add_argument("--left", type=Path, required=True)
    agent_compare.add_argument("--right", type=Path, required=True)
    agent_compare.add_argument("--left-label", default="left")
    agent_compare.add_argument("--right-label", default="right")
    agent_compare.add_argument("--output", type=Path, required=True)
    agent_compare.set_defaults(handler=_agent_compare)

    agent_risk = subparsers.add_parser(
        "agent-risk",
        description="Run the truth-free observable escalation gate",
    )
    agent_risk.add_argument("--task", type=Path, required=True)
    agent_risk.add_argument("--mask", type=Path, required=True)
    agent_risk.add_argument("--action", type=Path, required=True)
    agent_risk.add_argument("--output", type=Path, required=True)
    agent_risk.set_defaults(handler=_agent_risk)

    gallery = subparsers.add_parser(
        "gallery", description="Stack existing six-panel comparisons into a contact sheet"
    )
    gallery.add_argument("--row", type=Path, action="append", required=True)
    gallery.add_argument("--output", type=Path, required=True)
    gallery.set_defaults(handler=_gallery)
    return parser


def _crop(arguments: argparse.Namespace) -> int:
    output_dir: Path = arguments.output_dir
    record = create_bounded_crop(
        arguments.source,
        box_xywh=arguments.box,
        padding=arguments.padding,
        output_path=output_dir / "crop.png",
        metadata_path=output_dir / "crop.json",
        max_pixels=arguments.max_pixels,
    )
    print(
        f"Created {record['crop']['width_px']}x{record['crop']['height_px']} crop "
        f"at ({record['crop']['x']}, {record['crop']['y']})"
    )
    return 0


def _extract(arguments: argparse.Namespace) -> int:
    with Image.open(arguments.crop) as source:
        _validate_image_size(source, name="Extraction crop")
        crop = source.convert("RGB")
    mask = extract_ink_mask(
        crop,
        window_size=arguments.window_size,
        k=arguments.k,
        offset=arguments.offset,
        minimum_component_area=arguments.minimum_component_area,
    )
    output_dir: Path = arguments.output_dir
    mask_path = output_dir / "raw-mask.png"
    save_mask(mask_path, mask)
    _, inventory = stable_components(mask)
    write_json(
        output_dir / "extraction.json",
        {
            "schema_version": "word-envelope-ink-extraction.v1",
            "crop_path": str(arguments.crop.resolve()),
            "crop_sha256": sha256_file(arguments.crop),
            "parameters": {
                "algorithm": "sauvola-dark-ink-v1",
                "window_size": arguments.window_size,
                "k": arguments.k,
                "offset": arguments.offset,
                "minimum_component_area": arguments.minimum_component_area,
            },
            "raw_mask_sha256": sha256_file(mask_path),
            "raw_mask_pixel_sha256": sha256_mask_pixels(mask),
            "ink_pixels": int(mask.sum()),
            "components": inventory,
        },
    )
    save_component_overlay(output_dir / "components.png", crop, mask)
    print(f"Extracted {int(mask.sum())} ink pixels in {len(inventory)} components")
    return 0


def _components(arguments: argparse.Namespace) -> int:
    mask = load_mask(arguments.mask, polarity=arguments.polarity)
    _, inventory = stable_components(mask, include_pixels=arguments.include_pixels)
    if arguments.crop is not None:
        with Image.open(arguments.crop) as source:
            _validate_image_size(source, name="Component crop")
            crop = source.convert("RGB")
        if crop.size != (mask.shape[1], mask.shape[0]):
            raise EnvelopeError("Crop and mask dimensions differ")
    else:
        crop = Image.new("RGB", (mask.shape[1], mask.shape[0]), (248, 248, 245))
    output_dir: Path = arguments.output_dir
    write_json(
        output_dir / "components.json",
        {
            "schema_version": "word-envelope-components.v1",
            "mask_path": str(arguments.mask.resolve()),
            "mask_sha256": sha256_file(arguments.mask),
            "mask_pixel_sha256": sha256_mask_pixels(mask),
            "connectivity": 8,
            "components": inventory,
        },
    )
    save_component_overlay(output_dir / "components.png", crop, mask)
    print(f"Numbered {len(inventory)} components")
    return 0


def _clean(arguments: argparse.Namespace) -> int:
    raw = load_mask(arguments.mask, polarity=arguments.polarity)
    operations = read_json(arguments.operations)
    cleaned, replay_log = apply_cleanup_operations(raw, operations)
    excluded = raw & ~cleaned
    output_dir: Path = arguments.output_dir
    cleaned_path = output_dir / "cleaned-mask.png"
    excluded_path = output_dir / "excluded-mask.png"
    save_mask(cleaned_path, cleaned)
    save_mask(excluded_path, excluded)
    _, raw_inventory = stable_components(raw)
    _, cleaned_inventory = stable_components(cleaned)
    write_json(
        output_dir / "cleanup.json",
        {
            "schema_version": "word-envelope-cleanup-replay.v1",
            "operations_path": str(arguments.operations.resolve()),
            "operations_sha256": sha256_file(arguments.operations),
            "raw_mask_pixel_sha256": sha256_mask_pixels(raw),
            "cleaned_mask_pixel_sha256": sha256_mask_pixels(cleaned),
            "excluded_mask_pixel_sha256": sha256_mask_pixels(excluded),
            "replay_log": replay_log,
            "raw_components": raw_inventory,
            "cleaned_components": cleaned_inventory,
        },
    )
    if arguments.crop is not None:
        with Image.open(arguments.crop) as source:
            _validate_image_size(source, name="Cleanup crop")
            crop = source.convert("RGB")
    else:
        crop = Image.new("RGB", (raw.shape[1], raw.shape[0]), (248, 248, 245))
    save_component_overlay(output_dir / "cleaned-components.png", crop, cleaned)
    print(
        f"Cleanup changed {int(raw.sum())} raw pixels to {int(cleaned.sum())} "
        f"cleaned pixels across {len(replay_log)} operations"
    )
    return 0


def _wrap(arguments: argparse.Namespace) -> int:
    params = _wrap_params(arguments)
    reset_result_dir(arguments.output_dir)
    if arguments.method != "both":
        for method_name in ("morphological", "soft_union"):
            method_dir = arguments.output_dir / method_name
            if method_dir.exists():
                reset_result_dir(method_dir)
    methods = (
        ("morphological", "soft_union")
        if arguments.method == "both"
        else (arguments.method,)
    )
    successes: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    for method in methods:
        method_output = (
            arguments.output_dir / method
            if arguments.method == "both"
            else arguments.output_dir
        )
        try:
            successes[method] = build_example(
                example_id=arguments.example_id,
                crop_path=arguments.crop,
                raw_mask_path=arguments.raw_mask,
                cleaned_mask_path=arguments.cleaned_mask,
                metadata_path=arguments.metadata,
                operations_path=arguments.operations,
                excluded_mask_path=arguments.excluded_mask,
                params=params,
                method=method,
                output_dir=method_output,
                rough_box=(tuple(arguments.rough_box) if arguments.rough_box else None),
                assessment_status=arguments.assessment_status,
                assessment_notes=arguments.assessment_notes,
            )
        except Exception as error:
            failures[method] = f"{type(error).__name__}: {error}"
            write_json(
                method_output / "failure.json",
                _failure_record(arguments, method=method, error=error, params=params),
            )
    if arguments.method == "both" and successes:
        with Image.open(arguments.crop) as source:
            _validate_image_size(source, name="Wrap crop")
            crop = source.convert("RGB")
        save_method_comparison(
            arguments.output_dir / "method-comparison.png",
            title=arguments.example_id,
            crop=crop,
            method_polygons=[
                (
                    method,
                    successes[method]["wrap"]["polygon_crop"]
                    if method in successes
                    else None,
                )
                for method in methods
            ],
        )
    write_json(
        arguments.output_dir / "wrap-summary.json",
        {
            "schema_version": "word-envelope-wrap-summary.v2",
            "example_id": arguments.example_id,
            "requested_methods": list(methods),
            "geometry_successes": sorted(successes),
            "semantic_assessments": {
                method: diagnostic["assessment"]["status"]
                for method, diagnostic in sorted(successes.items())
            },
            "review_required": sorted(
                method
                for method, diagnostic in successes.items()
                if diagnostic["assessment"]["status"] != "success"
            ),
            "failures": failures,
        },
    )
    for method, diagnostic in successes.items():
        result = diagnostic["wrap"]["result"]
        print(
            f"{method}: {result['polygon_sha256']} coverage="
            f"{result['selected_ink_coverage']:.6f} background_reduction="
            f"{result['background_area_reduction']:.3f} assessment="
            f"{diagnostic['assessment']['status']}"
        )
    for method, message in failures.items():
        print(f"{method}: FAILED: {message}", file=sys.stderr)
    return 0 if successes else 2


def _wrap_params(arguments: argparse.Namespace) -> EnvelopeParams:
    values: dict[str, Any] = {}
    if arguments.params is not None:
        loaded = read_json(arguments.params)
        values.update(loaded.get("parameters", loaded))
    overrides = {
        "angle_degrees": arguments.angle,
        "along_bridge_px": arguments.along_bridge,
        "cross_bridge_px": arguments.cross_bridge,
        "padding_px": arguments.padding,
        "smooth_iterations": arguments.smooth_iterations,
        "simplify_tolerance_px": arguments.simplify_tolerance,
        "soft_threshold": arguments.soft_threshold,
        "minimum_selected_coverage": arguments.minimum_selected_coverage,
        "minimum_selected_ink_pixels": arguments.minimum_selected_ink_pixels,
        "maximum_envelope_fraction": arguments.maximum_envelope_fraction,
        "maximum_envelope_to_ink_area_ratio": arguments.maximum_envelope_to_ink_area_ratio,
        "maximum_excluded_contamination": arguments.maximum_excluded_contamination,
        "maximum_excluded_component_contamination": arguments.maximum_excluded_component_contamination,
        "minimum_excluded_component_pixels_for_gate": arguments.minimum_excluded_component_pixels_for_gate,
        "allow_border_touching_ink": arguments.allow_border_touching_ink,
    }
    values.update({key: value for key, value in overrides.items() if value is not None})
    if arguments.centerline is not None:
        centerline = read_json(arguments.centerline)
        values["centerline"] = centerline.get("centerline", centerline)
    return EnvelopeParams.from_mapping(values)


def _failure_record(
    arguments: argparse.Namespace,
    *,
    method: str,
    error: Exception,
    params: EnvelopeParams,
) -> dict[str, Any]:
    inputs: dict[str, Any] = {}
    for key, path in (
        ("crop", arguments.crop),
        ("raw_mask", arguments.raw_mask),
        ("cleaned_mask", arguments.cleaned_mask),
        ("excluded_mask", arguments.excluded_mask),
        ("metadata", arguments.metadata),
        ("operations", arguments.operations),
    ):
        if path is not None:
            inputs[key] = {
                "path": str(path.resolve()),
                "sha256": sha256_file(path),
            }
    return {
        "schema_version": "word-envelope-failure.v2",
        "example_id": arguments.example_id,
        "method": method,
        "error_type": type(error).__name__,
        "message": str(error),
        "parameters": params.as_record(),
        "rough_region_crop_xywh": (
            list(arguments.rough_box) if arguments.rough_box else None
        ),
        "inputs": inputs,
    }


def _synthetic(arguments: argparse.Namespace) -> int:
    summary = generate_synthetic_suite(arguments.output_dir)
    succeeded = sum(bool(case["successes"]) for case in summary["cases"])
    print(f"Generated {len(summary['cases'])} cases; {succeeded} have a valid result")
    return 0 if succeeded == len(summary["cases"]) else 1


def _limits(arguments: argparse.Namespace) -> int:
    summary = generate_limit_characterization(arguments.output_dir)
    counts = summary["classification_counts"]
    print(
        "Limit characterization complete: "
        + ", ".join(f"{key}={value}" for key, value in counts.items())
    )
    return 0


def _stress_real(arguments: argparse.Namespace) -> int:
    summary = generate_real_stress_suite(arguments.manifest, arguments.output_dir)
    diagnostic_attempts = (
        summary["method_attempt_count"] - summary["evaluated_method_attempt_count"]
    )
    diagnostic_successes = (
        summary["geometry_success_count"]
        - summary["evaluated_geometry_success_count"]
    )
    print(
        f"Replayed {summary['case_count']} real stress cases; "
        f"evaluated geometry successes="
        f"{summary['evaluated_geometry_success_count']}/"
        f"{summary['evaluated_method_attempt_count']}; "
        f"diagnostic-only geometry successes={diagnostic_successes}/"
        f"{diagnostic_attempts}"
    )
    return 0


def _agent_pack(arguments: argparse.Namespace) -> int:
    summary = generate_agent_task_packs(
        arguments.pilot,
        arguments.stress_manifest,
        arguments.stress_artifacts,
        arguments.output_dir,
        prompt_path=arguments.prompt,
    )
    print(
        f"Generated {summary['task_count']} blinded ownership task packs for "
        f"{summary['suite_id']}"
    )
    return 0


def _agent_stage(arguments: argparse.Namespace) -> int:
    summary = stage_public_task_packs(
        arguments.packs,
        arguments.output_dir,
        task_ids=arguments.task_id,
    )
    print(
        f"Staged {summary['task_count']} verified public-only ownership tasks"
    )
    return 0


def _agent_build_action(arguments: argparse.Namespace) -> int:
    record = build_bound_action_from_paths(
        arguments.task,
        arguments.decision,
        arguments.output,
    )
    print(
        f"Built {record['action']['type']} action for task {record['task_id']}"
    )
    return 0


def _agent_evaluate(arguments: argparse.Namespace) -> int:
    result = evaluate_agent_action(
        arguments.task_dir,
        arguments.action,
        output_dir=arguments.output_dir,
    )
    print(
        f"Evaluated {result['task_id']}: {result['disposition']}; "
        f"strict_pass={result['strict_pass']}"
    )
    return 0


def _agent_evaluate_cohort(arguments: argparse.Namespace) -> int:
    cohort = evaluate_agent_cohort(
        arguments.tasks_root,
        arguments.actions_dir,
        arguments.output_dir,
        task_ids=arguments.task_id,
    )
    summary = cohort["aggregate"]
    print(
        f"Evaluated {summary['result_count']} ownership actions; "
        f"strict_passes={summary['strict_passes']}; "
        f"false_accepts={summary['false_accepts']}"
    )
    return 0


def _agent_compare(arguments: argparse.Namespace) -> int:
    comparison = compare_agent_cohorts(
        arguments.left,
        arguments.right,
        left_label=arguments.left_label,
        right_label=arguments.right_label,
        output_path=arguments.output,
    )
    print(
        f"Compared {comparison['matched_task_count']} matched ownership tasks"
    )
    return 0


def _agent_risk(arguments: argparse.Namespace) -> int:
    task = read_json(arguments.task)
    action = read_json(arguments.action)
    mask = load_mask(arguments.mask, polarity="bright")
    result = assess_ownership_risk(task, mask, action)
    write_json(arguments.output, result)
    print(
        f"Risk decision for {task['task_id']}: {result['decision']} "
        f"({', '.join(result['reason_codes'])})"
    )
    return 0


def _gallery(arguments: argparse.Namespace) -> int:
    rows = [(path.parent.name, path) for path in arguments.row]
    save_contact_sheet(arguments.output, rows)
    print(f"Saved {len(rows)} rows to {arguments.output}")
    return 0


def _validate_image_size(image: Image.Image, *, name: str) -> None:
    pixels = image.width * image.height
    if pixels > MAX_MASK_PIXELS:
        raise EnvelopeError(f"{name} has {pixels} pixels; limit is {MAX_MASK_PIXELS}")


if __name__ == "__main__":
    raise SystemExit(main())
