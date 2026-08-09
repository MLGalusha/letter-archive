"""Deterministic replay and scoring for blinded agent ink-ownership tasks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

import numpy as np
from PIL import Image

from .agent_ownership import apply_single_action, component_reference, score_ownership
from .agent_packs import AGENT_TASK_PACK_SCHEMA_VERSION, AGENT_TRUTH_SCHEMA_VERSION
from .engine import EnvelopeError
from .io_utils import (
    canonical_json_bytes,
    read_json,
    sha256_file,
    sha256_mask_pixels,
    write_json,
)
from .masks import load_mask, save_mask, stable_components


AGENT_BENCHMARK_RESULT_SCHEMA_VERSION = "word-ink-agent-benchmark-result.v1"
AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION = "word-ink-agent-benchmark-aggregate.v1"
STRICT_PASS_THRESHOLDS = {
    "precision_min": 0.995,
    "recall_min": 0.995,
    "minimum_target_component_recall_min": 0.95,
    "neighbor_contamination_max": 0.005,
    "neighbor_component_max_contamination_max": 0.02,
}
_NONTERMINAL_ACTION_TYPES = {"exclude", "cut", "request_expanded_context"}
_METRIC_SUMMARY_FIELDS = (
    "precision",
    "recall",
    "f1",
    "iou",
    "minimum_target_component_recall",
    "macro_target_component_recall",
    "neighbor_contamination",
    "neighbor_component_max_contamination",
    "generic_debris_fraction",
)


def evaluate_agent_action(
    task_dir: Path,
    action_json: Path | Mapping[str, Any],
    *,
    private_dir: Path | None = None,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """Replay and score one strict action against a sealed task pack.

    ``task_dir`` may be either the task root (containing ``public`` and
    ``private``) or its ``public`` directory.  Fixture drift raises
    :class:`EnvelopeError`; malformed, stale, or wrongly bound agent actions are
    returned as invalid benchmark results so they remain aggregateable.
    """

    public_dir, resolved_private_dir = _resolve_task_directories(task_dir, private_dir)
    task = read_json(public_dir / "task.json")
    truth = read_json(resolved_private_dir / "truth.json")
    base_mask = load_mask(resolved_private_dir / "base-mask.png", polarity="bright")
    truth_target = load_mask(
        resolved_private_dir / "truth-target-mask.png", polarity="bright"
    )
    truth_neighbor = load_mask(
        resolved_private_dir / "truth-neighbor-mask.png", polarity="bright"
    )
    fixture = _validate_fixture(
        public_dir=public_dir,
        task=task,
        truth=truth,
        base_mask=base_mask,
        truth_target=truth_target,
        truth_neighbor=truth_neighbor,
    )
    _prepare_output_dir(output_dir)
    result = _base_result(task, truth, action_json)

    try:
        action_record = _load_action_record(action_json)
        _validate_action_binding(action_record, task)
        first = apply_single_action(action_record, base_mask)
        second = apply_single_action(action_record, base_mask)
        deterministic = _same_replay(first, second)
    except (
        EnvelopeError,
        OSError,
        UnicodeError,
        ValueError,
        TypeError,
        KeyError,
        json.JSONDecodeError,
    ) as error:
        result["error"] = {
            "type": type(error).__name__,
            "message": str(error),
        }
        result["disposition"] = "invalid_action"
        return _finish_result(result, output_dir)

    action_type = str(first.action["type"])
    is_claim = action_type == "claim_select"
    is_manual = action_type == "defer_manual"
    is_nonterminal = action_type in _NONTERMINAL_ACTION_TYPES
    expected_invalid = bool(result["expected_invalid_input"])
    result.update(
        {
            "action_valid": True,
            "replay_valid": deterministic,
            "deterministic_replay_valid": deterministic,
            "action_type": action_type,
            "action_confidence": first.action["confidence"],
            "terminal_status": first.terminal_status,
            "requires_later_turn": bool(
                first.requires_later_turn or is_nonterminal
            ),
            "completed_claim": is_claim,
            "nonterminal_action": is_nonterminal,
            "manual_deferral": is_manual,
        }
    )
    if action_type in {"exclude", "cut"}:
        removed = base_mask & ~first.output_mask
        removed_target = removed & truth_target
        removed_neighbor = removed & truth_neighbor
        removed_generic = removed & ~truth_target & ~truth_neighbor
        target_pixels = int(truth_target.sum())
        neighbor_pixels = int(truth_neighbor.sum())
        result["tool_action_metrics"] = {
            "removed_pixels": int(removed.sum()),
            "removed_target_pixels": int(removed_target.sum()),
            "removed_target_fraction": round(
                float(removed_target.sum() / target_pixels) if target_pixels else 0.0,
                9,
            ),
            "removed_neighbor_pixels": int(removed_neighbor.sum()),
            "removed_neighbor_fraction": round(
                float(removed_neighbor.sum() / neighbor_pixels)
                if neighbor_pixels
                else 0.0,
                9,
            ),
            "removed_generic_pixels": int(removed_generic.sum()),
        }
        result["safe_nonterminal_action"] = bool(
            deterministic and not removed_target.any()
        )
        result["unsafe_tool_action"] = not result["safe_nonterminal_action"]

    if is_claim:
        if first.claimed_mask is None:
            raise EnvelopeError("A replayed claim_select did not emit a claimed mask")
        claimed = np.asarray(first.claimed_mask, dtype=bool)
        subset_raw = not bool(np.any(claimed & ~base_mask))
        result["claimed_subset_of_raw"] = subset_raw
        if not expected_invalid:
            metrics = _score_claim(
                claimed=claimed,
                base_mask=base_mask,
                truth_target=truth_target,
                truth_neighbor=truth_neighbor,
                truth=truth,
                semantic_neighbor_available=fixture["semantic_neighbor_available"],
            )
            result["metrics"] = metrics
            gate = _strict_gate(metrics, deterministic, subset_raw)
            result["strict_gate"] = gate
            result["strict_pass"] = gate["passed"]
        else:
            result["strict_gate"] = {
                "eligible": False,
                "reason": "private truth marks this input invalid",
                "thresholds": dict(STRICT_PASS_THRESHOLDS),
                "checks": {},
                "failed_checks": [],
                "passed": False,
            }
        result["false_accept"] = not bool(result["strict_pass"])
        result["disposition"] = (
            "accepted" if result["strict_pass"] else "unsafe_accept"
        )
        if output_dir is not None:
            result["artifacts"] = _save_claim_artifacts(
                output_dir=output_dir,
                public_dir=public_dir,
                task=task,
                claimed=claimed,
                truth_target=truth_target,
                truth_neighbor=truth_neighbor,
            )
    elif is_manual:
        result["correct_human_or_invalid_deferral"] = expected_invalid
        result["correct_invalid_deferral"] = expected_invalid
        result["unnecessary_deferral"] = not expected_invalid
        result["disposition"] = (
            "correct_invalid_deferral"
            if expected_invalid
            else "unnecessary_deferral"
        )
    else:
        if action_type == "request_expanded_context":
            result["disposition"] = "needs_expanded_context"
        elif result["unsafe_tool_action"]:
            result["disposition"] = "unsafe_tool_action"
        else:
            result["disposition"] = "requires_later_turn"

    return _finish_result(result, output_dir)


def aggregate_agent_results(
    results: Iterable[Path | Mapping[str, Any]],
    *,
    output_path: Path | None = None,
) -> dict[str, Any]:
    """Aggregate saved or in-memory benchmark results without rescoring them."""

    values = [_load_result(value) for value in results]
    for result in values:
        if result.get("schema_version") != AGENT_BENCHMARK_RESULT_SCHEMA_VERSION:
            raise EnvelopeError("Cannot aggregate an unsupported benchmark result")

    valid_actions = sum(bool(value.get("action_valid")) for value in values)
    completed_claims = sum(bool(value.get("completed_claim")) for value in values)
    evaluable_claims = sum(
        bool(value.get("completed_claim"))
        and not bool(value.get("expected_invalid_input"))
        for value in values
    )
    strict_passes = sum(bool(value.get("strict_pass")) for value in values)
    false_accepts = sum(bool(value.get("false_accept")) for value in values)
    correct_deferrals = sum(
        bool(value.get("correct_human_or_invalid_deferral")) for value in values
    )
    unnecessary_deferrals = sum(
        bool(value.get("unnecessary_deferral")) for value in values
    )
    safe_nonterminal_actions = sum(
        bool(value.get("safe_nonterminal_action")) for value in values
    )
    unsafe_tool_actions = sum(
        bool(value.get("unsafe_tool_action")) for value in values
    )
    action_types: dict[str, int] = {}
    for value in values:
        action_type = value.get("action_type")
        if isinstance(action_type, str):
            action_types[action_type] = action_types.get(action_type, 0) + 1

    aggregate = {
        "schema_version": AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION,
        "result_count": len(values),
        "valid_actions": valid_actions,
        "invalid_actions": len(values) - valid_actions,
        "replay_valid_actions": sum(bool(value.get("replay_valid")) for value in values),
        "completed_claims": completed_claims,
        "evaluable_claims": evaluable_claims,
        "strict_passes": strict_passes,
        "false_accepts": false_accepts,
        "correct_human_or_invalid_deferrals": correct_deferrals,
        "correct_invalid_deferrals": sum(
            bool(value.get("correct_invalid_deferral")) for value in values
        ),
        "unnecessary_deferrals": unnecessary_deferrals,
        "nonterminal_actions": sum(
            bool(value.get("nonterminal_action")) for value in values
        ),
        "safe_nonterminal_actions": safe_nonterminal_actions,
        "unsafe_tool_actions": unsafe_tool_actions,
        "action_type_counts": dict(sorted(action_types.items())),
        "rates": {
            "valid_action_rate": _rate(valid_actions, len(values)),
            "strict_pass_rate_per_evaluable_claim": _rate(
                strict_passes, evaluable_claims
            ),
            "false_accept_rate_per_completed_claim": _rate(
                false_accepts, completed_claims
            ),
        },
        "metric_summaries": {
            field: _metric_summary(values, field)
            for field in _METRIC_SUMMARY_FIELDS
        },
        "task_ids": [value.get("task_id") for value in values],
    }
    if output_path is not None:
        write_json(output_path, aggregate)
    return aggregate


def _resolve_task_directories(
    task_dir: Path, private_dir: Path | None
) -> tuple[Path, Path]:
    root = Path(task_dir)
    public = root / "public" if (root / "public/task.json").is_file() else root
    private = Path(private_dir) if private_dir is not None else public.parent / "private"
    if not (public / "task.json").is_file():
        raise EnvelopeError(f"Missing public task.json in {public}")
    if not (private / "truth.json").is_file():
        raise EnvelopeError(f"Missing private truth.json in {private}")
    return public, private


def _validate_fixture(
    *,
    public_dir: Path,
    task: Mapping[str, Any],
    truth: Mapping[str, Any],
    base_mask: np.ndarray,
    truth_target: np.ndarray,
    truth_neighbor: np.ndarray,
) -> dict[str, Any]:
    if task.get("schema_version") != AGENT_TASK_PACK_SCHEMA_VERSION:
        raise EnvelopeError("Unsupported public task-pack schema")
    if truth.get("schema_version") != AGENT_TRUTH_SCHEMA_VERSION:
        raise EnvelopeError("Unsupported private truth schema")
    task_basis = dict(task)
    task_pack_hash = task_basis.pop("task_pack_sha256", None)
    observed_task_hash = hashlib.sha256(canonical_json_bytes(task_basis)).hexdigest()
    if task_pack_hash != observed_task_hash:
        raise EnvelopeError("Public task_pack_sha256 does not match its contents")
    if truth.get("task_id") != task.get("task_id"):
        raise EnvelopeError("Private truth task_id does not match the public task")
    if truth.get("task_pack_sha256") != task_pack_hash:
        raise EnvelopeError("Private truth is bound to a different task pack")

    public_assets = task.get("public_assets")
    if not isinstance(public_assets, Mapping):
        raise EnvelopeError("Public task assets must be an object")
    for name, asset in public_assets.items():
        if not isinstance(asset, Mapping):
            raise EnvelopeError(f"Public asset {name!r} must be an object")
        path = asset.get("path")
        expected_hash = asset.get("sha256")
        if not isinstance(path, str) or not isinstance(expected_hash, str):
            raise EnvelopeError(f"Public asset {name!r} is missing its binding")
        asset_path = public_dir / path
        if not asset_path.is_file() or sha256_file(asset_path) != expected_hash:
            raise EnvelopeError(f"Public asset {name!r} does not match its binding")

    masks = (base_mask, truth_target, truth_neighbor)
    if any(mask.ndim != 2 for mask in masks) or any(
        mask.shape != base_mask.shape for mask in masks[1:]
    ):
        raise EnvelopeError("Private benchmark masks must have identical 2-D shapes")
    expected_size = task.get("work_size_wh")
    if expected_size != [base_mask.shape[1], base_mask.shape[0]]:
        raise EnvelopeError("Private base-mask dimensions do not match the public task")
    if sha256_mask_pixels(base_mask) != truth.get("base_mask_pixel_sha256"):
        raise EnvelopeError("Private base mask does not match its truth binding")
    if sha256_mask_pixels(base_mask) != task.get("input_state_sha256"):
        raise EnvelopeError("Private base mask does not match the public input state")
    if sha256_mask_pixels(truth_target) != truth.get(
        "truth_target_mask_pixel_sha256"
    ):
        raise EnvelopeError("Target truth mask does not match its binding")
    if sha256_mask_pixels(truth_neighbor) != truth.get(
        "truth_neighbor_mask_pixel_sha256"
    ):
        raise EnvelopeError("Neighbor truth mask does not match its binding")
    if np.any(truth_target & truth_neighbor):
        raise EnvelopeError("Target and neighbor truth masks overlap")
    if np.any(truth_neighbor & ~base_mask):
        raise EnvelopeError("Neighbor truth mask must be contained by the task base mask")

    assessment = truth.get("input_assessment")
    if not isinstance(assessment, Mapping) or assessment.get("status") not in {
        "evaluable",
        "invalid_input",
    }:
        raise EnvelopeError("Private input_assessment status is unsupported")
    if assessment["status"] == "evaluable" and not truth_target.any():
        raise EnvelopeError("An evaluable task must have nonempty target truth")

    labels, inventory = stable_components(base_mask)
    if task.get("components") != [component_reference(item) for item in inventory]:
        raise EnvelopeError("Public component inventory does not match the base mask")
    from .agent_ownership import component_inventory_sha256

    if task.get("component_inventory_sha256") != component_inventory_sha256(inventory):
        raise EnvelopeError("Public component inventory hash does not match the base mask")
    references = truth.get("truth_target_component_refs")
    if not isinstance(references, list):
        raise EnvelopeError("Private target component references must be a list")
    by_id = {item["id"]: item for item in inventory}
    target_ids: list[int] = []
    for reference in references:
        if not isinstance(reference, Mapping) or set(reference) != {"id", "fingerprint"}:
            raise EnvelopeError("Private target component reference is malformed")
        component = by_id.get(reference["id"])
        if component is None or component_reference(component) != reference:
            raise EnvelopeError("Private target component reference is stale")
        target_ids.append(int(reference["id"]))
    if len(target_ids) != len(set(target_ids)):
        raise EnvelopeError("Private target component references contain duplicates")
    if not np.array_equal(np.isin(labels, target_ids), truth_target):
        raise EnvelopeError("Private target component references do not reconstruct truth")
    return {
        "semantic_neighbor_available": bool(
            truth.get("semantic_neighbor_available", False)
        )
    }


def _base_result(
    task: Mapping[str, Any],
    truth: Mapping[str, Any],
    action_json: Path | Mapping[str, Any],
) -> dict[str, Any]:
    assessment = dict(truth["input_assessment"])
    return {
        "schema_version": AGENT_BENCHMARK_RESULT_SCHEMA_VERSION,
        "task_id": task["task_id"],
        "case_id": truth.get("case_id"),
        "variant": task.get("variant"),
        "task_pack_sha256": task["task_pack_sha256"],
        "action_source": (
            str(Path(action_json).resolve())
            if isinstance(action_json, (str, Path))
            else None
        ),
        "input_assessment": assessment,
        "expected_invalid_input": assessment["status"] == "invalid_input",
        "action_valid": False,
        "replay_valid": False,
        "deterministic_replay_valid": False,
        "action_type": None,
        "action_confidence": None,
        "terminal_status": None,
        "requires_later_turn": False,
        "completed_claim": False,
        "nonterminal_action": False,
        "safe_nonterminal_action": False,
        "unsafe_tool_action": False,
        "manual_deferral": False,
        "claimed_subset_of_raw": None,
        "strict_pass": False,
        "false_accept": False,
        "correct_human_or_invalid_deferral": False,
        "correct_invalid_deferral": False,
        "unnecessary_deferral": False,
        "disposition": None,
        "metrics": None,
        "tool_action_metrics": None,
        "strict_gate": None,
        "artifacts": {},
        "error": None,
    }


def _load_action_record(action_json: Path | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(action_json, Mapping):
        return action_json
    value = read_json(Path(action_json))
    if not isinstance(value, Mapping):
        raise EnvelopeError("Agent action JSON must contain an object")
    return value


def _validate_action_binding(
    action_record: Mapping[str, Any], task: Mapping[str, Any]
) -> None:
    for key in ("task_id", "task_pack_sha256", "turn"):
        if action_record.get(key) != task.get(key):
            raise EnvelopeError(f"Agent action {key} does not match the public task")


def _same_replay(first: Any, second: Any) -> bool:
    return bool(
        first.action == second.action
        and np.array_equal(first.output_mask, second.output_mask)
        and (
            (first.claimed_mask is None and second.claimed_mask is None)
            or (
                first.claimed_mask is not None
                and second.claimed_mask is not None
                and np.array_equal(first.claimed_mask, second.claimed_mask)
            )
        )
        and first.input_mask_pixel_sha256 == second.input_mask_pixel_sha256
        and first.output_mask_pixel_sha256 == second.output_mask_pixel_sha256
        and first.input_component_inventory_sha256
        == second.input_component_inventory_sha256
        and first.output_component_inventory_sha256
        == second.output_component_inventory_sha256
        and first.requires_later_turn == second.requires_later_turn
        and first.terminal_status == second.terminal_status
        and first.cleanup_log == second.cleanup_log
    )


def _score_claim(
    *,
    claimed: np.ndarray,
    base_mask: np.ndarray,
    truth_target: np.ndarray,
    truth_neighbor: np.ndarray,
    truth: Mapping[str, Any],
    semantic_neighbor_available: bool,
) -> dict[str, Any]:
    metrics = score_ownership(
        claimed,
        truth_target,
        truth_neighbor if semantic_neighbor_available else None,
    )
    labels, _ = stable_components(base_mask)
    component_scores: list[dict[str, Any]] = []
    for reference in truth["truth_target_component_refs"]:
        component_id = int(reference["id"])
        component_mask = labels == component_id
        pixels = int(component_mask.sum())
        claimed_pixels = int(np.count_nonzero(claimed & component_mask))
        recall = float(claimed_pixels / pixels) if pixels else 0.0
        component_scores.append(
            {
                "component_id": component_id,
                "pixels": pixels,
                "claimed_pixels": claimed_pixels,
                "recall": round(recall, 9),
                "wholly_missed": claimed_pixels == 0,
            }
        )
    recalls = [float(item["recall"]) for item in component_scores]
    missed = [
        int(item["component_id"])
        for item in component_scores
        if item["wholly_missed"]
    ]
    known_neighbor = truth_neighbor if semantic_neighbor_available else np.zeros_like(claimed)
    generic_debris = claimed & base_mask & ~truth_target & ~known_neighbor
    claimed_pixels = int(claimed.sum())
    metrics.update(
        {
            "target_component_recalls": component_scores,
            "minimum_target_component_recall": round(min(recalls), 9),
            "macro_target_component_recall": round(
                sum(recalls) / len(recalls), 9
            ),
            "wholly_missed_target_component_ids": missed,
            "wholly_missed_target_component_count": len(missed),
            "generic_debris_pixels": int(generic_debris.sum()),
            "generic_debris_fraction": round(
                float(generic_debris.sum() / claimed_pixels)
                if claimed_pixels
                else 0.0,
                9,
            ),
        }
    )
    return metrics


def _strict_gate(
    metrics: Mapping[str, Any], deterministic: bool, subset_raw: bool
) -> dict[str, Any]:
    neighbor = metrics["neighbor_contamination"]
    neighbor_max = metrics["neighbor_component_max_contamination"]
    checks = {
        "precision": metrics["precision"] >= STRICT_PASS_THRESHOLDS["precision_min"],
        "recall": metrics["recall"] >= STRICT_PASS_THRESHOLDS["recall_min"],
        "no_wholly_missed_target_components": metrics[
            "wholly_missed_target_component_count"
        ]
        == 0,
        "minimum_target_component_recall": metrics[
            "minimum_target_component_recall"
        ]
        >= STRICT_PASS_THRESHOLDS["minimum_target_component_recall_min"],
        "neighbor_contamination": neighbor is None
        or neighbor <= STRICT_PASS_THRESHOLDS["neighbor_contamination_max"],
        "neighbor_component_max_contamination": neighbor_max is None
        or neighbor_max
        <= STRICT_PASS_THRESHOLDS["neighbor_component_max_contamination_max"],
        "deterministic_replay": deterministic,
        "claimed_subset_of_raw": subset_raw,
    }
    failed = [name for name, passed in checks.items() if not passed]
    return {
        "eligible": True,
        "thresholds": dict(STRICT_PASS_THRESHOLDS),
        "checks": checks,
        "failed_checks": failed,
        "passed": not failed,
    }


def _save_claim_artifacts(
    *,
    output_dir: Path,
    public_dir: Path,
    task: Mapping[str, Any],
    claimed: np.ndarray,
    truth_target: np.ndarray,
    truth_neighbor: np.ndarray,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    claimed_path = output_dir / "claimed-mask.png"
    save_mask(claimed_path, claimed)
    work_asset = task["public_assets"].get("work_crop")
    if isinstance(work_asset, Mapping):
        with Image.open(public_dir / str(work_asset["path"])) as source:
            base = source.convert("RGBA")
    else:
        base = Image.new("RGBA", (claimed.shape[1], claimed.shape[0]), "white")
    if base.size != (claimed.shape[1], claimed.shape[0]):
        raise EnvelopeError("Work-crop image dimensions do not match the claimed mask")
    overlay = np.zeros((*claimed.shape, 4), dtype=np.uint8)
    true_positive = claimed & truth_target
    false_negative = truth_target & ~claimed
    neighbor_false_positive = claimed & truth_neighbor
    generic_false_positive = claimed & ~truth_target & ~truth_neighbor
    overlay[true_positive] = (30, 190, 95, 155)
    overlay[false_negative] = (35, 105, 225, 175)
    overlay[neighbor_false_positive] = (225, 50, 55, 180)
    overlay[generic_false_positive] = (240, 155, 35, 180)
    scored = Image.alpha_composite(base, Image.fromarray(overlay, mode="RGBA"))
    overlay_path = output_dir / "scoring-overlay.png"
    scored.convert("RGB").save(
        overlay_path, format="PNG", compress_level=9, optimize=False
    )
    return {
        "claimed_mask": {
            "path": str(claimed_path.resolve()),
            "sha256": sha256_file(claimed_path),
        },
        "scoring_overlay": {
            "path": str(overlay_path.resolve()),
            "sha256": sha256_file(overlay_path),
        },
    }


def _finish_result(result: dict[str, Any], output_dir: Path | None) -> dict[str, Any]:
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "result.json", result)
    return result


def _prepare_output_dir(output_dir: Path | None) -> None:
    """Remove only evaluator-owned files so repeated runs cannot show stale claims."""

    if output_dir is None:
        return
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in ("claimed-mask.png", "scoring-overlay.png", "result.json"):
        path = output_dir / name
        if path.is_symlink():
            raise EnvelopeError(f"Refusing to replace symlinked evaluator artifact: {path}")
        if path.exists():
            if not path.is_file():
                raise EnvelopeError(f"Evaluator artifact path is not a file: {path}")
            path.unlink()


def _load_result(value: Path | Mapping[str, Any]) -> Mapping[str, Any]:
    result = read_json(Path(value)) if isinstance(value, (str, Path)) else value
    if not isinstance(result, Mapping):
        raise EnvelopeError("Benchmark result must be an object")
    return result


def _metric_summary(
    results: Iterable[Mapping[str, Any]], field: str
) -> dict[str, Any]:
    values = [
        float(result["metrics"][field])
        for result in results
        if isinstance(result.get("metrics"), Mapping)
        and result["metrics"].get(field) is not None
    ]
    if not values:
        return {"count": 0, "mean": None, "minimum": None, "maximum": None}
    return {
        "count": len(values),
        "mean": round(sum(values) / len(values), 9),
        "minimum": round(min(values), 9),
        "maximum": round(max(values), 9),
    }


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 9) if denominator else None
