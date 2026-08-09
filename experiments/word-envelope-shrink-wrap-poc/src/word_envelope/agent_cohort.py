"""Fail-closed cohort replay and matched agent-cohort comparisons.

The cohort layer deliberately owns only orchestration.  Individual actions are
still validated and scored by :mod:`word_envelope.agent_benchmark`; this module
adds exact action-set checks, safe managed-output replacement, deterministic
indexes, and paired comparisons across task variants or model runs.
"""

from __future__ import annotations

import re
import shutil
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

from .agent_benchmark import (
    AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION,
    AGENT_BENCHMARK_RESULT_SCHEMA_VERSION,
    aggregate_agent_results,
    evaluate_agent_action,
)
from .engine import EnvelopeError
from .io_utils import read_json, sha256_file, write_json


AGENT_COHORT_INDEX_SCHEMA_VERSION = "word-ink-agent-cohort-index.v1"
AGENT_COHORT_COMPARISON_SCHEMA_VERSION = "word-ink-agent-cohort-comparison.v2"
MANAGED_RESULTS_SCHEMA_VERSION = "word-ink-agent-managed-results.v1"

_SAFE_TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SINGLE_LETTER_VARIANT = re.compile(r"^(.+)-([a-z])$")
_PIXEL_METRIC_FIELDS = (
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


def evaluate_agent_cohort(
    tasks_root: Path,
    actions_dir: Path,
    output_dir: Path,
    *,
    task_ids: Iterable[str] | None = None,
    allow_missing_actions: bool = False,
    allow_extra_actions: bool = False,
    allow_duplicate_actions: bool = False,
) -> dict[str, Any]:
    """Replay an exact action set and publish deterministic cohort results.

    Task roots are discovered from bound ``public/task.json`` plus
    ``private/truth.json`` pairs anywhere below ``tasks_root``.  By default the
    action directory must contain exactly one JSON file named
    ``<task-id>.json`` for every requested task and no other JSON files.

    The three ``allow_*`` switches are intentionally separate and default to
    false.  When explicitly enabled, missing tasks are skipped, extras are
    ignored, and the lexicographically first duplicate is chosen.  These
    overrides are for exploratory recovery only; benchmark runs should retain
    the fail-closed defaults.
    """

    tasks_root = Path(tasks_root)
    actions_dir = Path(actions_dir)
    output_dir = Path(output_dir)
    discovered_tasks = _discover_task_roots(tasks_root)
    requested_ids = _requested_task_ids(discovered_tasks, task_ids)
    actions_by_id, all_action_paths = _discover_actions(actions_dir)

    missing = [task_id for task_id in requested_ids if not actions_by_id.get(task_id)]
    duplicates = {
        task_id: paths
        for task_id, paths in actions_by_id.items()
        if task_id in requested_ids and len(paths) > 1
    }
    extra_paths = [
        path
        for path in all_action_paths
        if path.stem not in set(requested_ids)
    ]
    problems: list[str] = []
    if missing and not allow_missing_actions:
        problems.append(f"missing actions for task IDs: {missing}")
    if duplicates and not allow_duplicate_actions:
        details = {
            task_id: [_relative_display(path, actions_dir) for path in paths]
            for task_id, paths in sorted(duplicates.items())
        }
        problems.append(f"duplicate actions: {details}")
    if extra_paths and not allow_extra_actions:
        problems.append(
            "extra action JSON files: "
            f"{[_relative_display(path, actions_dir) for path in extra_paths]}"
        )
    if problems:
        raise EnvelopeError("Agent cohort action set mismatch: " + "; ".join(problems))

    selected_actions = {
        task_id: sorted(actions_by_id[task_id], key=lambda path: path.as_posix())[0]
        for task_id in requested_ids
        if actions_by_id.get(task_id)
    }
    evaluated_ids = sorted(selected_actions)
    ignored_duplicates = {
        task_id: [
            _relative_display(path, actions_dir)
            for path in sorted(paths, key=lambda path: path.as_posix())[1:]
        ]
        for task_id, paths in sorted(duplicates.items())
        if allow_duplicate_actions
    }

    prior_managed = _validate_managed_output(output_dir, evaluated_ids)
    _prepare_managed_top_level_files(output_dir)
    _prune_managed_result_directories(output_dir, prior_managed)
    _begin_managed_run(output_dir, evaluated_ids)

    results: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []
    for task_id in evaluated_ids:
        result_dir = output_dir / task_id
        action_path = selected_actions[task_id]
        result = evaluate_agent_action(
            discovered_tasks[task_id], action_path, output_dir=result_dir
        )
        results.append(result)
        result_path = result_dir / "result.json"
        entries.append(
            _index_entry(
                result=result,
                action_path=action_path,
                actions_dir=actions_dir,
                result_path=result_path,
                output_dir=output_dir,
            )
        )

    aggregate = aggregate_agent_results(results)
    index = {
        "schema_version": AGENT_COHORT_INDEX_SCHEMA_VERSION,
        "requested_task_ids": requested_ids,
        "evaluated_task_ids": evaluated_ids,
        "missing_task_ids": missing,
        "ignored_extra_action_paths": [
            _relative_display(path, actions_dir) for path in extra_paths
        ]
        if allow_extra_actions
        else [],
        "ignored_duplicate_action_paths": ignored_duplicates,
        "task_count": len(entries),
        "tasks": entries,
    }
    write_json(output_dir / "summary.json", aggregate)
    write_json(output_dir / "index.json", index)
    write_json(
        output_dir / "managed-results.json",
        {
            "schema_version": MANAGED_RESULTS_SCHEMA_VERSION,
            "task_ids": evaluated_ids,
        },
    )
    return {"aggregate": aggregate, "index": index}


def compare_agent_cohorts(
    left: Path | Mapping[str, Any] | Iterable[Path | Mapping[str, Any]],
    right: Path | Mapping[str, Any] | Iterable[Path | Mapping[str, Any]],
    *,
    left_label: str = "left",
    right_label: str = "right",
    output_path: Path | None = None,
) -> dict[str, Any]:
    """Compare matched task base IDs, with deltas defined as right minus left.

    A cohort output directory, its ``summary.json``/``index.json``, an in-memory
    cohort return value, or an iterable of benchmark results can be supplied on
    either side.  Pixel metrics are compared only when *both* paired results
    contain an actual claim metric object.  Deferrals therefore remain explicit
    outcomes rather than synthetic zero-valued pixel scores.
    """

    if (
        not left_label
        or not right_label
        or left_label == right_label
        or "deltas" in {left_label, right_label}
    ):
        raise EnvelopeError(
            "Cohort comparison labels must be distinct, nonempty, and not 'deltas'"
        )
    left_results = _load_comparison_results(left)
    right_results = _load_comparison_results(right)
    left_by_base = _results_by_base_id(left_results, left_label)
    right_by_base = _results_by_base_id(right_results, right_label)
    matched_ids = sorted(set(left_by_base) & set(right_by_base))
    if not matched_ids:
        raise EnvelopeError("Agent cohorts do not share any task base IDs")

    pairs: list[dict[str, Any]] = []
    for base_id in matched_ids:
        left_result = left_by_base[base_id]
        right_result = right_by_base[base_id]
        left_case = left_result.get("case_id")
        right_case = right_result.get("case_id")
        if left_case is not None and right_case is not None and left_case != right_case:
            raise EnvelopeError(
                f"Matched task base ID {base_id!r} refers to different cases"
            )
        left_outcome = _comparison_outcome(left_result)
        right_outcome = _comparison_outcome(right_result)
        pair = {
            "task_base_id": base_id,
            "left": left_outcome,
            "right": right_outcome,
            "deltas": {
                "action_valid": _bool_delta(
                    right_outcome["action_valid"], left_outcome["action_valid"]
                ),
                "strict_pass": _bool_delta(
                    right_outcome["strict_pass"], left_outcome["strict_pass"]
                ),
                "false_accept": _bool_delta(
                    right_outcome["false_accept"], left_outcome["false_accept"]
                ),
                "deferral": _bool_delta(
                    right_outcome["deferred"], left_outcome["deferred"]
                ),
                "manual_deferral": _bool_delta(
                    right_outcome["manual_deferral"],
                    left_outcome["manual_deferral"],
                ),
                "nonterminal_action": _bool_delta(
                    right_outcome["nonterminal_action"],
                    left_outcome["nonterminal_action"],
                ),
            },
            "pixel_metric_comparison": _compare_pixel_metrics(
                left_result.get("metrics"), right_result.get("metrics")
            ),
        }
        pairs.append(pair)

    left_counts = _matched_counts(left_by_base, matched_ids)
    right_counts = _matched_counts(right_by_base, matched_ids)
    comparison = {
        "schema_version": AGENT_COHORT_COMPARISON_SCHEMA_VERSION,
        "delta_direction": f"{right_label}_minus_{left_label}",
        "left_label": left_label,
        "right_label": right_label,
        "matched_task_count": len(matched_ids),
        "matched_task_base_ids": matched_ids,
        "unmatched_left_task_base_ids": sorted(set(left_by_base) - set(right_by_base)),
        "unmatched_right_task_base_ids": sorted(set(right_by_base) - set(left_by_base)),
        "matched_counts": {
            left_label: left_counts,
            right_label: right_counts,
            "deltas": {
                key: right_counts[key] - left_counts[key]
                for key in left_counts
            },
        },
        "tasks": pairs,
    }
    if output_path is not None:
        output_path = Path(output_path)
        if output_path.is_symlink():
            raise EnvelopeError(
                f"Refusing to replace symlinked cohort comparison: {output_path}"
            )
        if output_path.exists() and not output_path.is_file():
            raise EnvelopeError(
                f"Cohort comparison output is not a file: {output_path}"
            )
        write_json(output_path, comparison)
    return comparison


def _discover_task_roots(tasks_root: Path) -> dict[str, Path]:
    if tasks_root.is_symlink():
        raise EnvelopeError(f"Refusing symlinked agent task root: {tasks_root}")
    if not tasks_root.is_dir():
        raise EnvelopeError(f"Agent task root is not a directory: {tasks_root}")
    resolved_root = tasks_root.resolve()
    discovered: dict[str, Path] = {}
    sources: dict[str, Path] = {}
    for task_json in sorted(tasks_root.rglob("task.json")):
        if task_json.is_symlink() or not _is_within(task_json.resolve(), resolved_root):
            raise EnvelopeError(f"Refusing escaped or symlinked agent task: {task_json}")
        public_dir = task_json.parent
        private_dir = public_dir.parent / "private"
        if not (private_dir / "truth.json").is_file():
            continue
        task = read_json(task_json)
        if not isinstance(task, Mapping):
            raise EnvelopeError(f"Agent task JSON must contain an object: {task_json}")
        task_id = task.get("task_id")
        _require_safe_task_id(task_id)
        if task_id in discovered:
            raise EnvelopeError(
                f"Duplicate evaluator task ID {task_id!r}: "
                f"{sources[task_id]} and {task_json}"
            )
        discovered[task_id] = public_dir.parent
        sources[task_id] = task_json
    if not discovered:
        raise EnvelopeError(f"No evaluator task packs found below {tasks_root}")
    return discovered


def _requested_task_ids(
    discovered: Mapping[str, Path], task_ids: Iterable[str] | None
) -> list[str]:
    if task_ids is None:
        return sorted(discovered)
    values = list(task_ids)
    for task_id in values:
        _require_safe_task_id(task_id)
    if len(values) != len(set(values)):
        raise EnvelopeError("Requested agent cohort task IDs contain duplicates")
    missing_tasks = sorted(set(values) - set(discovered))
    if missing_tasks:
        raise EnvelopeError(f"Requested evaluator task IDs were not found: {missing_tasks}")
    return sorted(values)


def _discover_actions(actions_dir: Path) -> tuple[dict[str, list[Path]], list[Path]]:
    if actions_dir.is_symlink():
        raise EnvelopeError(f"Refusing symlinked agent action root: {actions_dir}")
    if not actions_dir.is_dir():
        raise EnvelopeError(f"Agent action root is not a directory: {actions_dir}")
    paths = sorted(
        (path for path in actions_dir.rglob("*.json") if path.is_file()),
        key=lambda path: path.as_posix(),
    )
    by_id: dict[str, list[Path]] = {}
    for path in paths:
        if path.is_symlink():
            raise EnvelopeError(f"Refusing symlinked agent action JSON: {path}")
        by_id.setdefault(path.stem, []).append(path)
    return by_id, paths


def _validate_managed_output(output_dir: Path, current_ids: Iterable[str]) -> list[str]:
    if output_dir.is_symlink():
        raise EnvelopeError(f"Refusing symlinked cohort output root: {output_dir}")
    if output_dir.exists() and not output_dir.is_dir():
        raise EnvelopeError(f"Cohort output root is not a directory: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    marker = output_dir / "managed-results.json"
    if marker.is_symlink():
        raise EnvelopeError(f"Refusing symlinked managed-results marker: {marker}")
    prior: list[str] = []
    if marker.exists():
        if not marker.is_file():
            raise EnvelopeError(f"Managed-results marker is not a file: {marker}")
        value = read_json(marker)
        if not isinstance(value, Mapping) or value.get(
            "schema_version"
        ) != MANAGED_RESULTS_SCHEMA_VERSION:
            raise EnvelopeError("Unsupported or malformed managed-results marker")
        ids = value.get("task_ids")
        if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
            raise EnvelopeError("Managed-results task_ids must be a string list")
        if len(ids) != len(set(ids)):
            raise EnvelopeError("Managed-results task_ids contain duplicates")
        for task_id in ids:
            _require_safe_task_id(task_id)
        prior = sorted(ids)

    prior_set = set(prior)
    for task_id in current_ids:
        path = output_dir / task_id
        if path.exists() and task_id not in prior_set:
            raise EnvelopeError(
                f"Refusing to replace unmanaged cohort result path: {path}"
            )
    for task_id in prior:
        path = output_dir / task_id
        if path.is_symlink():
            raise EnvelopeError(f"Refusing symlinked managed result directory: {path}")
        if path.exists() and not path.is_dir():
            raise EnvelopeError(f"Managed result path is not a directory: {path}")
    return prior


def _prune_managed_result_directories(output_dir: Path, prior_ids: Iterable[str]) -> None:
    for task_id in sorted(prior_ids):
        path = output_dir / task_id
        if path.exists():
            shutil.rmtree(path)


def _prepare_managed_top_level_files(output_dir: Path) -> None:
    has_managed_marker = (output_dir / "managed-results.json").is_file()
    for name in ("summary.json", "index.json", "managed-results.json"):
        path = output_dir / name
        if path.is_symlink():
            raise EnvelopeError(f"Refusing symlinked cohort output file: {path}")
        if path.exists() and not path.is_file():
            raise EnvelopeError(f"Cohort output path is not a file: {path}")
        if (
            name in {"summary.json", "index.json"}
            and path.exists()
            and not has_managed_marker
        ):
            raise EnvelopeError(f"Refusing to replace unmanaged cohort output: {path}")


def _begin_managed_run(output_dir: Path, task_ids: list[str]) -> None:
    """Make an interrupted evaluation safely recoverable on its next rerun."""

    for name in ("summary.json", "index.json"):
        path = output_dir / name
        if path.exists():
            path.unlink()
    write_json(
        output_dir / "managed-results.json",
        {
            "schema_version": MANAGED_RESULTS_SCHEMA_VERSION,
            "task_ids": task_ids,
        },
    )


def _index_entry(
    *,
    result: Mapping[str, Any],
    action_path: Path,
    actions_dir: Path,
    result_path: Path,
    output_dir: Path,
) -> dict[str, Any]:
    return {
        "task_id": result["task_id"],
        "task_base_id": _task_base_id(str(result["task_id"])),
        "task_pack_sha256": result["task_pack_sha256"],
        "case_id": result.get("case_id"),
        "variant": result.get("variant"),
        "action_path": _relative_display(action_path, actions_dir),
        "action_sha256": sha256_file(action_path),
        "result_path": result_path.relative_to(output_dir).as_posix(),
        "result_sha256": sha256_file(result_path),
        "action_valid": bool(result.get("action_valid")),
        "replay_valid": bool(result.get("replay_valid")),
        "completed_claim": bool(result.get("completed_claim")),
        "strict_pass": bool(result.get("strict_pass")),
        "false_accept": bool(result.get("false_accept")),
        "manual_deferral": bool(result.get("manual_deferral")),
        "nonterminal_action": bool(result.get("nonterminal_action")),
        "disposition": result.get("disposition"),
        "metrics": result.get("metrics")
        if isinstance(result.get("metrics"), Mapping)
        else None,
    }


def _load_comparison_results(
    value: Path | Mapping[str, Any] | Iterable[Path | Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    if isinstance(value, (str, Path)):
        path = Path(value)
        if path.is_dir():
            return _results_from_index_path(path / "index.json")
        document = read_json(path)
        if not isinstance(document, Mapping):
            raise EnvelopeError(f"Cohort comparison input must be an object: {path}")
        schema = document.get("schema_version")
        if schema == AGENT_BENCHMARK_RESULT_SCHEMA_VERSION:
            return [document]
        if schema == AGENT_COHORT_INDEX_SCHEMA_VERSION:
            return _results_from_index_path(path)
        if schema == AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION:
            return _results_from_index_path(path.parent / "index.json")
        raise EnvelopeError(f"Unsupported cohort comparison input schema: {schema!r}")

    if isinstance(value, Mapping):
        if "aggregate" in value and "index" in value:
            index = value["index"]
            if not isinstance(index, Mapping):
                raise EnvelopeError("In-memory cohort index must be an object")
            return _results_from_index_mapping(index)
        schema = value.get("schema_version")
        if schema == AGENT_BENCHMARK_RESULT_SCHEMA_VERSION:
            return [value]
        if schema == AGENT_COHORT_INDEX_SCHEMA_VERSION:
            return _results_from_index_mapping(value)
        if schema == AGENT_BENCHMARK_AGGREGATE_SCHEMA_VERSION:
            raise EnvelopeError(
                "An aggregate mapping alone has no per-task dispositions; "
                "supply the cohort output directory, index, or results"
            )
        raise EnvelopeError(f"Unsupported cohort comparison mapping schema: {schema!r}")

    results: list[Mapping[str, Any]] = []
    for item in value:
        document = read_json(Path(item)) if isinstance(item, (str, Path)) else item
        if not isinstance(document, Mapping) or document.get(
            "schema_version"
        ) != AGENT_BENCHMARK_RESULT_SCHEMA_VERSION:
            raise EnvelopeError("Cohort result iterable contains an unsupported result")
        results.append(document)
    return results


def _results_from_index_path(index_path: Path) -> list[Mapping[str, Any]]:
    if not index_path.is_file():
        raise EnvelopeError(f"Missing cohort per-task index: {index_path}")
    index = read_json(index_path)
    if not isinstance(index, Mapping) or index.get(
        "schema_version"
    ) != AGENT_COHORT_INDEX_SCHEMA_VERSION:
        raise EnvelopeError(f"Unsupported cohort index: {index_path}")
    tasks = index.get("tasks")
    if not isinstance(tasks, list):
        raise EnvelopeError("Cohort index tasks must be a list")
    results: list[Mapping[str, Any]] = []
    for entry in tasks:
        if not isinstance(entry, Mapping) or not isinstance(entry.get("result_path"), str):
            raise EnvelopeError("Cohort index task entry is malformed")
        result_path = index_path.parent / entry["result_path"]
        if not _is_within(result_path.resolve(), index_path.parent.resolve()):
            raise EnvelopeError(f"Indexed cohort result escapes its root: {result_path}")
        if not result_path.is_file():
            raise EnvelopeError(f"Missing indexed cohort result: {result_path}")
        if entry.get("result_sha256") != sha256_file(result_path):
            raise EnvelopeError(f"Indexed cohort result hash drift: {result_path}")
        result = read_json(result_path)
        if not isinstance(result, Mapping) or result.get(
            "schema_version"
        ) != AGENT_BENCHMARK_RESULT_SCHEMA_VERSION:
            raise EnvelopeError(f"Unsupported indexed cohort result: {result_path}")
        if result.get("task_id") != entry.get("task_id"):
            raise EnvelopeError(f"Indexed cohort task/result mismatch: {result_path}")
        results.append(result)
    return results


def _results_from_index_mapping(index: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    if index.get("schema_version") != AGENT_COHORT_INDEX_SCHEMA_VERSION:
        raise EnvelopeError("Unsupported in-memory cohort index")
    tasks = index.get("tasks")
    if not isinstance(tasks, list) or not all(isinstance(item, Mapping) for item in tasks):
        raise EnvelopeError("Cohort index tasks must be an object list")
    return list(tasks)


def _results_by_base_id(
    results: Iterable[Mapping[str, Any]], label: str
) -> dict[str, Mapping[str, Any]]:
    by_base: dict[str, Mapping[str, Any]] = {}
    for result in results:
        task_id = result.get("task_id")
        if not isinstance(task_id, str):
            raise EnvelopeError(f"{label} cohort result is missing task_id")
        base_id = result.get("task_base_id")
        if not isinstance(base_id, str):
            base_id = _task_base_id(task_id)
        if base_id in by_base:
            raise EnvelopeError(
                f"{label} cohort has multiple results for task base ID {base_id!r}"
            )
        by_base[base_id] = result
    return by_base


def _comparison_outcome(result: Mapping[str, Any]) -> dict[str, Any]:
    action_valid = bool(result.get("action_valid"))
    completed_claim = bool(result.get("completed_claim"))
    nonterminal_action = bool(result.get("nonterminal_action"))
    return {
        "task_id": result.get("task_id"),
        "case_id": result.get("case_id"),
        "variant": result.get("variant"),
        "action_valid": action_valid,
        "strict_pass": bool(result.get("strict_pass")),
        "false_accept": bool(result.get("false_accept")),
        "deferred": action_valid and not completed_claim and not nonterminal_action,
        "manual_deferral": bool(result.get("manual_deferral")),
        "nonterminal_action": nonterminal_action,
        "disposition": result.get("disposition"),
    }


def _matched_counts(
    results: Mapping[str, Mapping[str, Any]], matched_ids: Iterable[str]
) -> dict[str, int]:
    outcomes = [_comparison_outcome(results[task_id]) for task_id in matched_ids]
    return {
        "action_valid": sum(item["action_valid"] for item in outcomes),
        "strict_pass": sum(item["strict_pass"] for item in outcomes),
        "false_accept": sum(item["false_accept"] for item in outcomes),
        "deferrals": sum(item["deferred"] for item in outcomes),
        "manual_deferrals": sum(item["manual_deferral"] for item in outcomes),
        "nonterminal_actions": sum(item["nonterminal_action"] for item in outcomes),
    }


def _compare_pixel_metrics(left: Any, right: Any) -> dict[str, Any]:
    if not isinstance(left, Mapping) or not isinstance(right, Mapping):
        return {
            "comparable": False,
            "reason": "one_or_both_results_have_no_claim_metrics",
        }
    values: dict[str, dict[str, float]] = {}
    for field in _PIXEL_METRIC_FIELDS:
        left_value = left.get(field)
        right_value = right.get(field)
        if (
            isinstance(left_value, (int, float))
            and not isinstance(left_value, bool)
            and isinstance(right_value, (int, float))
            and not isinstance(right_value, bool)
        ):
            left_number = float(left_value)
            right_number = float(right_value)
            values[field] = {
                "left": left_number,
                "right": right_number,
                "delta": round(right_number - left_number, 9),
            }
    if not values:
        return {
            "comparable": False,
            "reason": "claims_have_no_shared_numeric_pixel_metrics",
        }
    return {"comparable": True, "metrics": values}


def _task_base_id(task_id: str) -> str:
    match = _SINGLE_LETTER_VARIANT.fullmatch(task_id)
    return match.group(1) if match else task_id


def _bool_delta(right: bool, left: bool) -> int:
    return int(right) - int(left)


def _require_safe_task_id(value: Any) -> None:
    if (
        not isinstance(value, str)
        or value in {".", ".."}
        or not _SAFE_TASK_ID.fullmatch(value)
    ):
        raise EnvelopeError(f"Unsafe or malformed agent task ID: {value!r}")


def _relative_display(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
