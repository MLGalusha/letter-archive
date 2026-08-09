"""Crash-safe, sequential full-page ink-ownership supervisor.

This module is an isolated pass-2 experiment.  It deliberately reuses the
strict single-turn ownership validator while adding the page-level guarantees
that validator cannot provide by itself:

* exactly one current word chosen by software in pass-1 reading order;
* an append-only, hash-chained checkpoint per committed action;
* source-coordinate claims that are subsets of one bound global ink mask and
  are pairwise disjoint across units;
* cut/exclude/context actions that require a fresh turn on the same word; and
* directed source-to-upright evidence transforms which are never reduced to an
  undirected (modulo 180 degree) envelope angle.

No production pass-2 contract or frozen artifact is read implicitly or
modified.  Every input and every output run directory is supplied by the
caller.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from types import SimpleNamespace
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .agent_action_builder import (
    AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
    build_bound_action,
)
from .agent_ownership import (
    apply_single_action,
    component_inventory_sha256,
    component_reference,
)
from .engine import EnvelopeError
from .io_utils import (
    canonical_json_bytes,
    sha256_file,
    sha256_mask_pixels,
)
from .masks import save_mask, stable_components


RUN_SCHEMA_VERSION = "sequential-full-page-ownership-run.v1"
CHECKPOINT_SCHEMA_VERSION = "sequential-full-page-ownership-checkpoint.v1"
EVENT_SCHEMA_VERSION = "sequential-full-page-ownership-event.v1"
WORK_PACKET_SCHEMA_VERSION = "sequential-full-page-ownership-work-packet.v1"
COMPACT_ACTION_SCHEMA_VERSION = "sequential-full-page-ownership-compact-action.v1"
DIRECTED_TRANSFORM_SCHEMA_VERSION = "directed-reading-transform.v1"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_WORK_PADDING_LONG_EDGE_FRACTION = 0.02625
_CONTEXT_PADDING_LONG_EDGE_FRACTION = 0.06
_RED = np.array([222, 50, 42], dtype=np.uint8)
_GREEN = (20, 150, 70)
_BLUE = (8, 104, 172)
_ORANGE = (230, 126, 34)

# Pass 2 answers a narrower question than the interactive supervisor: whether
# an existing candidate mask is exact enough to preload without another model
# turn.  A ``sol_review`` answer to that question must not erase pass 1's
# useful Terra-vs-Sol ownership routing.  These risks are the cases where an
# interactive decision still requires shared-ink or difficult-orientation
# reasoning, even when the original route was routine.
_SOL_INTERACTIVE_RISK_FLAGS = {
    "shared_component",
    "shared_ink",
    "touching_neighbor",
    "touching_neighbors",
    "touching_words",
    "threshold_bridge",
    "cut_required",
    "sideways",
    "vertical",
    "rotated",
    "rotation",
    "rotation_uncertain",
    "fold",
    "transcript_conflict",
    "pass2_missing_word_candidate",
}

_MACHINE_UPGRADEABLE_MANUAL_DISPOSITIONS = {
    "ambiguous_ownership",
    "touching_or_overwritten_ink",
    "unsafe_cut",
}
_DISCOVERED_COMPLEXITY_REASON = "agent_discovered_nonroutine_complexity"
_STATIC_SOL_REASON = "non_routine_unit_requires_sol"
_REGISTRATION_REASON_CODES = {
    "wrong_line_registration",
    "clipped_target",
    "duplicate_geometry",
    "visible_word_outside_target",
}


def init_run(
    *,
    pass1_decision_path: Path,
    knockout_manifest_path: Path,
    public_packet_path: Path,
    run_dir: Path,
    work_padding_px: int | None = None,
    context_padding_px: int | None = None,
    pass2_decision_path: Path | None = None,
    residual_region_manifest_path: Path | None = None,
    clean_ink_mask_path: Path | None = None,
    high_recall_ink_mask_path: Path | None = None,
    unit_ids: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Create a new immutable-input run and revision-zero checkpoint.

    ``run_dir`` must not exist.  Initialization is built in a sibling temporary
    directory and published with one rename, so a crash never exposes a partial
    run at the requested path.
    """

    run_dir = Path(run_dir).resolve()
    if run_dir.exists() or run_dir.is_symlink():
        raise EnvelopeError(f"Run directory already exists; refusing overwrite: {run_dir}")
    bound = _validate_bound_inputs(
        Path(pass1_decision_path).resolve(),
        Path(knockout_manifest_path).resolve(),
        Path(public_packet_path).resolve(),
    )
    upstream_ink_path = bound["ink_path"]
    upstream_ink_pixel_sha256 = bound["ink_pixel_sha256"]
    source_size = tuple(bound["packet"]["source"]["size"])
    if clean_ink_mask_path is not None:
        clean_ink_path = Path(clean_ink_mask_path).resolve()
        if not clean_ink_path.is_file() or clean_ink_path.is_symlink():
            raise EnvelopeError("Clean ink mask is missing or is a symlink")
        clean_mask = _load_normalized_mask(clean_ink_path, source_size)
        clean_ink_pixel_sha256 = sha256_mask_pixels(clean_mask)
    else:
        clean_ink_path = upstream_ink_path
        clean_mask = _load_normalized_mask(clean_ink_path, source_size)
        clean_ink_pixel_sha256 = upstream_ink_pixel_sha256
    claim_ink_path = clean_ink_path
    claim_ink_mask = clean_mask
    if high_recall_ink_mask_path is not None:
        high_recall_path = Path(high_recall_ink_mask_path).resolve()
        if not high_recall_path.is_file() or high_recall_path.is_symlink():
            raise EnvelopeError("High-recall ink mask is missing or is a symlink")
        high_recall_mask = _load_normalized_mask(
            high_recall_path, source_size
        )
        if np.any(clean_mask & ~high_recall_mask):
            raise EnvelopeError(
                "High-recall ink must retain every pixel in the clean bound mask"
            )
        if np.array_equal(clean_mask, high_recall_mask):
            raise EnvelopeError("High-recall ink mask must add observable evidence")
        claim_ink_path = high_recall_path
        claim_ink_mask = high_recall_mask
    bound["upstream_ink_path"] = upstream_ink_path
    bound["upstream_ink_pixel_sha256"] = upstream_ink_pixel_sha256
    bound["clean_ink_path"] = clean_ink_path
    bound["clean_ink_pixel_sha256"] = clean_ink_pixel_sha256
    bound["ink_path"] = claim_ink_path
    bound["ink_pixel_sha256"] = sha256_mask_pixels(claim_ink_mask)
    units, ignored = _ordered_units(bound["decision"])
    unit_subset: list[str] | None = None
    if unit_ids is not None:
        unit_subset = list(unit_ids)
        if not unit_subset or any(not isinstance(value, str) or not value for value in unit_subset):
            raise EnvelopeError("Diagnostic unit subset requires nonempty unit IDs")
        if len(set(unit_subset)) != len(unit_subset):
            raise EnvelopeError("Diagnostic unit subset contains duplicate unit IDs")
        known_units = {unit["unit_id"] for unit in units}
        unknown = sorted(set(unit_subset) - known_units)
        if unknown:
            raise EnvelopeError(f"Diagnostic unit subset contains unknown IDs: {unknown}")
        requested = set(unit_subset)
        units = [unit for unit in units if unit["unit_id"] in requested]
        # Preserve canonical page reading order regardless of CLI ordering.
        unit_subset = [unit["unit_id"] for unit in units]
    bound["unit_subset_ids"] = unit_subset
    long_edge = max(source_size)
    if work_padding_px is None:
        work_padding_px = max(2, round(long_edge * _WORK_PADDING_LONG_EDGE_FRACTION))
    if context_padding_px is None:
        context_padding_px = max(5, round(long_edge * _CONTEXT_PADDING_LONG_EDGE_FRACTION))
    _positive_padding(work_padding_px, "work_padding_px")
    _positive_padding(context_padding_px, "context_padding_px")
    if context_padding_px <= work_padding_px:
        raise EnvelopeError("context_padding_px must be greater than work_padding_px")
    _validate_units(units, source_size)
    pass2_import = None
    preloaded_claims: list[dict[str, Any]] = []
    if (pass2_decision_path is None) != (residual_region_manifest_path is None):
        raise EnvelopeError(
            "pass2_decision_path and residual_region_manifest_path must be supplied together"
        )
    if unit_subset is not None and pass2_decision_path is not None:
        raise EnvelopeError(
            "Diagnostic unit subsets cannot import pass2 decisions; build a full run instead"
        )
    if pass2_decision_path is not None and residual_region_manifest_path is not None:
        pass2_import = _validate_and_adapt_pass2(
            bound,
            units,
            Path(pass2_decision_path).resolve(),
            Path(residual_region_manifest_path).resolve(),
        )
        units = pass2_import["active_units"]
        preloaded_claims = pass2_import["preloaded_claims"]

    run_basis: dict[str, Any] = {
        "schema_version": RUN_SCHEMA_VERSION,
        "run_id": _run_id(bound),
        "page_id": bound["decision"]["page_id"],
        "input_bindings": {
            "pass1_decision": _input_file_binding(bound["decision_path"]),
            "knockout_manifest": _input_file_binding(bound["knockout_manifest_path"]),
            "public_packet": _input_file_binding(bound["packet_path"]),
            "source": _input_file_binding(bound["source_path"])
            | {"size_wh": list(source_size)},
            "normalized_global_ink_mask": _input_file_binding(bound["ink_path"])
            | {
                "size_wh": list(source_size),
                "pixel_sha256": bound["ink_pixel_sha256"],
            },
            "clean_reference_ink_mask": _input_file_binding(clean_ink_path)
            | {
                "size_wh": list(source_size),
                "pixel_sha256": clean_ink_pixel_sha256,
            },
            "upstream_knockout_ink_mask": _input_file_binding(upstream_ink_path)
            | {
                "size_wh": list(source_size),
                "pixel_sha256": upstream_ink_pixel_sha256,
                "purpose": "provenance_only_not_implicitly_clean_or_claimable",
            },
        },
        "upstream_bindings": {
            "public_packet_internal_sha256": bound["packet"]["packet_sha256"],
            "knockout_manifest_internal_sha256": bound["knockout_manifest"][
                "manifest_sha256"
            ],
            "knockout_decision_file_sha256": bound["knockout_manifest"]["inputs"][
                "decision"
            ]["file_sha256"],
        },
        "policy": {
            "work_padding_px": work_padding_px,
            "context_padding_px": context_padding_px,
            "default_padding_policy": (
                "scale_aware_long_edge:work=2.625_percent,context=6_percent; "
                "approximately 105/240px at 3000x4000 and 42/96px at 1200x1600"
            ),
            "connectivity": 8,
            "claim_universe": "normalized_global_ink_mask_only",
            "ink_view_policy": (
                "explicit_clean_and_high_recall_pair"
                if clean_ink_mask_path is not None and high_recall_ink_mask_path is not None
                else "explicit_clean_single_claim_universe"
                if clean_ink_mask_path is not None
                else "legacy_knockout_clean_with_explicit_high_recall"
                if high_recall_ink_mask_path is not None
                else "legacy_single_knockout_mask_shown_as_both_clean_and_strong"
            ),
            "prior_claim_policy": "red_and_removed_from_current_inventory",
            "unit_order": "pass1_line_reading_order_then_unit_reading_order",
            "unit_subset_policy": (
                "explicit_diagnostic_subset_in_canonical_page_order"
                if unit_subset is not None
                else "full_pass1_word_queue"
            ),
            "nonterminal_actions": [
                "exclude",
                "cut",
                "request_expanded_context",
                "reopen_bbox",
            ],
            "terminal_actions": ["claim_select", "defer_tier", "defer_manual"],
            "model_tier_policy": {
                "automatic_approval": (
                    "only a validated pass2 approve_candidate_mask is preloaded"
                ),
                "interactive_routing": (
                    "original pass1 ownership route plus explicit geometry/risk flags; "
                    "pass2 sol_review alone does not require Sol"
                ),
                "terra_cut_policy": "cut is reserved for Sol",
            },
        },
        "units": units,
        "ignored_non_word_units": ignored,
        "preloaded_approved_units": [
            {
                "unit_id": item["unit_id"],
                "pixels": item["pixels"],
                "source_mask_pixel_sha256": sha256_mask_pixels(item["source_mask"]),
            }
            for item in preloaded_claims
        ],
    }
    if unit_subset is not None:
        run_basis["diagnostic_unit_subset"] = {
            "unit_ids": unit_subset,
            "unit_count": len(unit_subset),
            "not_a_page_completeness_run": True,
        }
    if pass2_import is not None:
        run_basis["input_bindings"]["validated_pass2_decision"] = _input_file_binding(
            pass2_import["decision_path"]
        )
        run_basis["input_bindings"]["residual_region_manifest"] = _input_file_binding(
            pass2_import["residual_region_manifest_path"]
        )
        run_basis["input_bindings"]["frozen_pass2_validator"] = _input_file_binding(
            pass2_import["validator_path"]
        )
        run_basis["input_bindings"]["frozen_pass2_schema"] = _input_file_binding(
            pass2_import["schema_path"]
        )
        run_basis["pass2_import"] = {
            "validator": "validate_full_page_ownership_knockout_decision_v2.validate",
            "validation_sha256": pass2_import["validation"]["validation_sha256"],
            "action_counts": pass2_import["validation"]["action_counts"],
            "approved_units_preloaded": [item["unit_id"] for item in preloaded_claims],
            "active_queue_policy": (
                "unapproved pass1 visible units in pass1 reading order, then pass2 missing-word "
                "candidates in decision order"
            ),
            "external_route_blockers": pass2_import["external_route_blockers"],
        }
    run_basis["run_manifest_sha256"] = _hash_without(
        run_basis, "run_manifest_sha256"
    )

    parent = run_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f".{run_dir.name}.init-", dir=parent))
    try:
        (temp / "commits").mkdir()
        (temp / "packets").mkdir()
        (temp / "transactions").mkdir()
        _write_json_new(temp / "run-manifest.json", run_basis)

        ink = _load_normalized_mask(bound["ink_path"], source_size)
        claimed = np.zeros_like(ink, dtype=bool)
        global_path = temp / "commits/000000/global-claimed.png"
        save_mask(global_path, claimed)
        state = _initial_state(
            run_basis,
            ink,
            claimed,
            global_path,
            temp,
            preloaded_claims=preloaded_claims,
        )
        checkpoint = _make_checkpoint(
            run_basis,
            revision=0,
            parent_checkpoint_sha256=None,
            parent_ledger_sha256=None,
            event_sha256=None,
            state=state,
        )
        _write_json_new(temp / "commits/000000/checkpoint.json", checkpoint)
        _publish_directory(temp, run_dir)
    except BaseException:
        if temp.exists():
            shutil.rmtree(temp, ignore_errors=True)
        raise
    return status(run_dir)


def next_packet(run_dir: Path) -> dict[str, Any]:
    """Return the deterministic packet for the one current word.

    Evidence is rendered into an immutable cache directory.  Rendering does not
    change the ledger revision or cursor, and repeated calls return the same
    packet bytes.
    """

    run_dir = Path(run_dir).resolve()
    run, checkpoint = _load_head(run_dir)
    state = checkpoint["state"]
    if _current_unit(run, state) is None:
        raise EnvelopeError("Machine ownership work is complete; no next packet exists")

    packet_name = f"r{checkpoint['revision']:06d}-u{state['cursor']:06d}-t{state['unit_turn']:04d}"
    final_dir = run_dir / "packets" / packet_name
    if final_dir.exists():
        packet = _read_json(final_dir / "work-packet.json")
        _validate_cached_packet(packet, final_dir, run_dir, checkpoint)
        return packet

    transaction = Path(
        tempfile.mkdtemp(prefix=f"packet-{packet_name}-", dir=run_dir / "transactions")
    )
    try:
        packet = _build_packet(run_dir, run, checkpoint, transaction, packet_name)
        _write_json_new(transaction / "work-packet.json", packet)
        _publish_directory(transaction, final_dir)
    except BaseException:
        if transaction.exists():
            shutil.rmtree(transaction, ignore_errors=True)
        raise
    return packet


def apply_compact_action(
    run_dir: Path, compact_action: Mapping[str, Any]
) -> dict[str, Any]:
    """Validate and atomically commit one packet-bound compact action."""

    run_dir = Path(run_dir).resolve()
    run, checkpoint = _load_head(run_dir)
    packet = next_packet(run_dir)
    action = _validate_compact_action_envelope(compact_action, packet)
    state = checkpoint["state"]
    local = _load_artifact_mask(run_dir, state["current_local_mask"])

    if action["type"] == "reopen_bbox":
        _validate_reopen_bbox_action(action, run, checkpoint, packet)
        bound_action = None
        result = SimpleNamespace(
            claimed_mask=None,
            output_mask=local,
            input_mask_pixel_sha256=sha256_mask_pixels(local),
            output_mask_pixel_sha256=sha256_mask_pixels(local),
            requires_later_turn=True,
            cleanup_log=(),
        )
    elif action["type"] == "defer_tier":
        if set(action) != {"type", "target", "reason"}:
            raise EnvelopeError("defer_tier must contain exactly type, target, and reason")
        if action["target"] != "sol" or not isinstance(action["reason"], str):
            raise EnvelopeError("defer_tier target must be sol with a supported reason")
        if packet["current"]["active_model_tier"] != "terra":
            raise EnvelopeError("Only an active Terra packet may defer to Sol")
        expected_reason = (
            _STATIC_SOL_REASON
            if packet["current"]["required_model_tier"] == "sol"
            else _DISCOVERED_COMPLEXITY_REASON
        )
        if action["reason"] != expected_reason:
            raise EnvelopeError(
                f"defer_tier reason must be {expected_reason!r} for the current packet"
            )
        bound_action = None
        result = SimpleNamespace(
            claimed_mask=None,
            output_mask=local,
            input_mask_pixel_sha256=sha256_mask_pixels(local),
            output_mask_pixel_sha256=sha256_mask_pixels(local),
            requires_later_turn=False,
            cleanup_log=(),
        )
    else:
        ownership_decision = {
            "schema_version": AGENT_OWNERSHIP_DECISION_SCHEMA_VERSION,
            "action": copy.deepcopy(action),
        }
        bound_action = build_bound_action(
            packet["ownership_task"], ownership_decision, current_mask=local
        )
        result = apply_single_action(bound_action, local)

    ink = _load_input_mask(run, "normalized_global_ink_mask")
    global_claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    unit = _require_current_unit(run, state)
    old_bounds = state["current_work_bbox_source_xywh"]
    source_claim: np.ndarray | None = None
    new_global = global_claimed
    new_cursor = state["cursor"]
    new_turn = state["unit_turn"] + 1
    new_context = copy.deepcopy(state["requested_context_margin_px"])
    deferred_units = copy.deepcopy(state["deferred_units"])
    claimed_units = copy.deepcopy(state["claimed_units"])
    completed_unit_ids = list(state["completed_unit_ids"])
    tier_deferred_units = copy.deepcopy(state["tier_deferred_units"])
    bbox_overrides = copy.deepcopy(_bbox_overrides(state))

    action_type = action["type"]
    if action_type == "claim_select":
        if result.claimed_mask is None or not result.claimed_mask.any():
            raise EnvelopeError("claim_select produced no claimed pixels")
        source_claim = _map_local_to_source(
            result.claimed_mask, old_bounds, global_claimed.shape
        )
        if np.any(source_claim & ~ink):
            raise EnvelopeError("Claim contains pixels outside normalized global ink")
        if np.any(source_claim & global_claimed):
            raise EnvelopeError("Claim intersects globally claimed ink; double claim refused")
        new_global = global_claimed | source_claim
        new_cursor += 1
        new_turn = 0
        new_context = _zero_margins()
        if unit["unit_id"] not in completed_unit_ids:
            completed_unit_ids.append(unit["unit_id"])
        tier_deferred_units = [
            item for item in tier_deferred_units if item["unit_id"] != unit["unit_id"]
        ]
        deferred_units = [
            item for item in deferred_units if item["unit_id"] != unit["unit_id"]
        ]
    elif action_type in {"exclude", "cut"}:
        if not result.requires_later_turn:
            raise EnvelopeError(f"{action_type} did not require a fresh turn")
    elif action_type == "request_expanded_context":
        requested = action["request"]
        for side in requested["sides"]:
            new_context[side] = max(new_context[side], requested["margin_px"])
        proposed_bounds = _work_bounds(run, unit, new_context, state=state)
        if proposed_bounds == old_bounds:
            raise EnvelopeError("Expanded-context request does not enlarge the work crop")
    elif action_type == "reopen_bbox":
        corrected = list(action["bbox_source_xywh"])
        original = list(unit["bbox_source_xywh"])
        previous_active = _effective_bbox(unit, state)
        prior = bbox_overrides.get(unit["unit_id"], {})
        history = copy.deepcopy(prior.get("history", []))
        history.append(
            {
                "at_revision": checkpoint["revision"] + 1,
                "unit_turn": state["unit_turn"],
                "from_bbox_source_xywh": previous_active,
                "to_bbox_source_xywh": corrected,
                "confidence": action["confidence"],
                "reason_codes": list(action["reason_codes"]),
                "work_packet_sha256": packet["work_packet_sha256"],
            }
        )
        bbox_overrides[unit["unit_id"]] = {
            "original_bbox_source_xywh": original,
            "active_bbox_source_xywh": corrected,
            "history": history,
        }
        new_context = _zero_margins()
    elif action_type == "defer_manual":
        deferred_units.append(
            {
                "unit_id": unit["unit_id"],
                "disposition": action["disposition"],
                "at_revision": checkpoint["revision"] + 1,
            }
        )
        new_cursor += 1
        new_turn = 0
        new_context = _zero_margins()
        if unit["unit_id"] not in completed_unit_ids:
            completed_unit_ids.append(unit["unit_id"])
        tier_deferred_units = [
            item for item in tier_deferred_units if item["unit_id"] != unit["unit_id"]
        ]
    elif action_type == "defer_tier":
        if any(item["unit_id"] == unit["unit_id"] for item in tier_deferred_units):
            raise EnvelopeError(f"Unit {unit['unit_id']} is already tier-deferred")
        tier_deferred_units.append(
            {
                "unit_id": unit["unit_id"],
                "target": action["target"],
                "reason": action["reason"],
                "at_revision": checkpoint["revision"] + 1,
            }
        )
        new_cursor += 1
        new_turn = 0
        new_context = _zero_margins()
    else:  # pragma: no cover - authoritative builder rejects this first
        raise EnvelopeError(f"Unsupported action type: {action_type}")

    next_revision = checkpoint["revision"] + 1
    final_commit = run_dir / "commits" / f"{next_revision:06d}"
    if final_commit.exists():
        raise EnvelopeError("Next revision already exists; refusing overwrite")
    transaction = Path(
        tempfile.mkdtemp(
            prefix=f"commit-{next_revision:06d}-", dir=run_dir / "transactions"
        )
    )
    try:
        global_ref = state["global_claimed_mask"]
        if source_claim is not None:
            claim_path = transaction / "claimed-source-mask.png"
            save_mask(claim_path, source_claim)
            claim_ref = _artifact_ref_for_pending(
                claim_path,
                f"commits/{next_revision:06d}/claimed-source-mask.png",
            )
            global_path = transaction / "global-claimed.png"
            save_mask(global_path, new_global)
            global_ref = _artifact_ref_for_pending(
                global_path, f"commits/{next_revision:06d}/global-claimed.png"
            )
            claimed_units.append(
                {
                    "unit_id": unit["unit_id"],
                    "at_revision": next_revision,
                    "pixels": int(source_claim.sum()),
                    "source_mask": claim_ref,
                }
            )
        global_ref = copy.deepcopy(global_ref)
        global_ref["registration_bbox_overrides"] = bbox_overrides

        next_local_ref: dict[str, Any] | None = None
        next_bounds: list[int] | None = None
        if new_cursor < len(state["queue_unit_ids"]):
            next_unit = _unit_by_id(run, state["queue_unit_ids"][new_cursor])
            if new_cursor == state["cursor"]:
                if action_type in {"exclude", "cut"}:
                    next_bounds = list(old_bounds)
                    next_local = result.output_mask
                elif action_type == "request_expanded_context":
                    next_bounds = _work_bounds(run, next_unit, new_context, state=state)
                    suppression = _current_suppression(
                        ink, global_claimed, local, old_bounds
                    )
                    next_local = _local_unclaimed_mask(
                        ink, global_claimed, next_bounds, suppression
                    )
                elif action_type == "reopen_bbox":
                    next_bounds = _work_bounds(
                        run,
                        next_unit,
                        new_context,
                        bbox_overrides=bbox_overrides,
                    )
                    next_local = _local_unclaimed_mask(
                        ink,
                        global_claimed,
                        next_bounds,
                        np.zeros_like(ink, dtype=bool),
                    )
                else:  # pragma: no cover
                    raise EnvelopeError("Nonterminal state was not handled")
            else:
                next_bounds = _work_bounds(
                    run,
                    next_unit,
                    new_context,
                    bbox_overrides=bbox_overrides,
                )
                next_local = _local_unclaimed_mask(
                    ink, new_global, next_bounds, np.zeros_like(ink, dtype=bool)
                )
            local_path = transaction / "current-local-mask.png"
            save_mask(local_path, next_local)
            next_local_ref = _artifact_ref_for_pending(
                local_path,
                f"commits/{next_revision:06d}/current-local-mask.png",
            )

        event: dict[str, Any] = {
            "schema_version": EVENT_SCHEMA_VERSION,
            "run_id": run["run_id"],
            "revision": next_revision,
            "base_checkpoint_sha256": checkpoint["checkpoint_sha256"],
            "base_ledger_sha256": checkpoint["ledger_sha256"],
            "work_packet_sha256": packet["work_packet_sha256"],
            "unit_id": unit["unit_id"],
            "unit_turn": state["unit_turn"],
            "compact_action": copy.deepcopy(dict(compact_action)),
            "bound_ownership_action": bound_action,
            "local_to_source": {
                "source_origin_xy": [old_bounds[0], old_bounds[1]],
                "work_size_wh": [old_bounds[2], old_bounds[3]],
            },
            "input_local_mask_pixel_sha256": result.input_mask_pixel_sha256,
            "output_local_mask_pixel_sha256": result.output_mask_pixel_sha256,
            "claimed_source_mask_pixel_sha256": (
                sha256_mask_pixels(source_claim) if source_claim is not None else None
            ),
            "global_claimed_before_pixel_sha256": sha256_mask_pixels(global_claimed),
            "global_claimed_after_pixel_sha256": sha256_mask_pixels(new_global),
            "cursor_before": state["cursor"],
            "cursor_after": new_cursor,
            "requires_fresh_turn": new_cursor == state["cursor"],
            "cleanup_log": list(result.cleanup_log),
        }
        if action_type == "reopen_bbox":
            event["registration_correction"] = {
                "original_manifest_bbox_source_xywh": list(unit["bbox_source_xywh"]),
                "before_active_bbox_source_xywh": previous_active,
                "after_active_bbox_source_xywh": list(action["bbox_source_xywh"]),
            }
        event["event_sha256"] = _hash_without(event, "event_sha256")
        _write_json_new(transaction / "event.json", event)

        new_state: dict[str, Any] = {
            "cursor": new_cursor,
            "unit_turn": new_turn,
            "requested_context_margin_px": new_context,
            "current_work_bbox_source_xywh": next_bounds,
            "current_local_mask": next_local_ref,
            "global_claimed_mask": global_ref,
            "claimed_units": claimed_units,
            "deferred_units": deferred_units,
            "queue_unit_ids": list(state["queue_unit_ids"]),
            "queue_generation": state["queue_generation"],
            "active_model_tier": state["active_model_tier"],
            "completed_unit_ids": completed_unit_ids,
            "tier_deferred_units": tier_deferred_units,
        }
        child = _make_checkpoint(
            run,
            revision=next_revision,
            parent_checkpoint_sha256=checkpoint["checkpoint_sha256"],
            parent_ledger_sha256=checkpoint["ledger_sha256"],
            event_sha256=event["event_sha256"],
            state=new_state,
        )
        _write_json_new(transaction / "checkpoint.json", child)
        _publish_directory(transaction, final_commit)
    except BaseException:
        # A failed/crashed transition is never a checkpoint.  Cleanup is best
        # effort only; resume ignores all transaction directories by design.
        if transaction.exists():
            shutil.rmtree(transaction, ignore_errors=True)
        raise
    return status(run_dir)


def requeue_tier(run_dir: Path, *, target: str) -> dict[str, Any]:
    """Append a child revision that re-enters tier-deferred units.

    Only a completed current queue may be requeued.  Units are selected from
    the unresolved tier-deferred set and restored in their immutable original
    run order; prior global claims and human deferrals are retained exactly.
    """

    run_dir = Path(run_dir).resolve()
    if target != "sol":
        raise EnvelopeError("requeue-tier currently supports the machine target 'sol' only")
    run, checkpoint = _load_head(run_dir)
    state = checkpoint["state"]
    if state["cursor"] != len(state["queue_unit_ids"]):
        raise EnvelopeError("Cannot requeue while the current queue still has work")
    deferred_ids = {
        item["unit_id"]
        for item in state["tier_deferred_units"]
        if item["target"] == target
    }
    if not deferred_ids:
        raise EnvelopeError(f"No unresolved tier-deferred units target {target}")
    queue = [unit["unit_id"] for unit in run["units"] if unit["unit_id"] in deferred_ids]
    if len(queue) != len(deferred_ids):
        raise EnvelopeError("Tier-deferred queue contains unknown or duplicate units")

    ink = _load_input_mask(run, "normalized_global_ink_mask")
    claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    first = _unit_by_id(run, queue[0])
    bounds = _work_bounds(run, first, _zero_margins(), state=state)
    local = _local_unclaimed_mask(
        ink, claimed, bounds, np.zeros_like(ink, dtype=bool)
    )
    revision = checkpoint["revision"] + 1
    transaction = Path(
        tempfile.mkdtemp(prefix=f"commit-{revision:06d}-", dir=run_dir / "transactions")
    )
    final_commit = run_dir / "commits" / f"{revision:06d}"
    try:
        local_path = transaction / "current-local-mask.png"
        save_mask(local_path, local)
        local_ref = _artifact_ref_for_pending(
            local_path, f"commits/{revision:06d}/current-local-mask.png"
        )
        event: dict[str, Any] = {
            "schema_version": EVENT_SCHEMA_VERSION,
            "run_id": run["run_id"],
            "revision": revision,
            "base_checkpoint_sha256": checkpoint["checkpoint_sha256"],
            "base_ledger_sha256": checkpoint["ledger_sha256"],
            "control_action": {
                "type": "requeue_tier",
                "target": target,
                "queue_unit_ids": queue,
            },
            "cursor_before": state["cursor"],
            "cursor_after": 0,
            "global_claimed_pixel_sha256": sha256_mask_pixels(claimed),
        }
        event["event_sha256"] = _hash_without(event, "event_sha256")
        _write_json_new(transaction / "event.json", event)
        child_state = copy.deepcopy(state)
        child_state.update(
            {
                "cursor": 0,
                "queue_unit_ids": queue,
                "queue_generation": state["queue_generation"] + 1,
                "active_model_tier": target,
                "unit_turn": 0,
                "requested_context_margin_px": _zero_margins(),
                "current_work_bbox_source_xywh": bounds,
                "current_local_mask": local_ref,
            }
        )
        child = _make_checkpoint(
            run,
            revision=revision,
            parent_checkpoint_sha256=checkpoint["checkpoint_sha256"],
            parent_ledger_sha256=checkpoint["ledger_sha256"],
            event_sha256=event["event_sha256"],
            state=child_state,
        )
        _write_json_new(transaction / "checkpoint.json", child)
        _publish_directory(transaction, final_commit)
    except BaseException:
        if transaction.exists():
            shutil.rmtree(transaction, ignore_errors=True)
        raise
    return status(run_dir)


def requeue_review(
    run_dir: Path, *, target: str, unit_ids: Sequence[str]
) -> dict[str, Any]:
    """Upgrade exact eligible manual deferrals and start the Sol queue.

    This is an append-only control transition.  The original manual-deferral
    events remain in the ledger; only their active blocker entries are
    converted.  Existing unresolved Sol tier deferrals join the converted
    units in immutable original reading order.
    """

    run_dir = Path(run_dir).resolve()
    if target != "sol":
        raise EnvelopeError("requeue-review currently supports the machine target 'sol' only")
    requested = list(unit_ids)
    if not requested:
        raise EnvelopeError("requeue-review requires at least one exact unit ID")
    if any(not isinstance(unit_id, str) or not unit_id for unit_id in requested):
        raise EnvelopeError("requeue-review unit IDs must be non-empty strings")
    if len(requested) != len(set(requested)):
        raise EnvelopeError("requeue-review unit IDs must not contain duplicates")

    run, checkpoint = _load_head(run_dir)
    state = checkpoint["state"]
    if state["cursor"] != len(state["queue_unit_ids"]):
        raise EnvelopeError("Cannot requeue review while the current queue still has work")

    known_ids = {unit["unit_id"] for unit in run["units"]}
    unknown = sorted(set(requested) - known_ids)
    if unknown:
        raise EnvelopeError(f"requeue-review refers to unknown unit IDs: {unknown}")
    active_manual = {item["unit_id"]: item for item in state["deferred_units"]}
    inactive = sorted(set(requested) - set(active_manual))
    if inactive:
        raise EnvelopeError(
            f"requeue-review unit IDs are stale or not active manual deferrals: {inactive}"
        )
    noneligible = [
        {
            "unit_id": unit_id,
            "disposition": active_manual[unit_id]["disposition"],
        }
        for unit_id in requested
        if active_manual[unit_id]["disposition"]
        not in _MACHINE_UPGRADEABLE_MANUAL_DISPOSITIONS
    ]
    if noneligible:
        raise EnvelopeError(
            "Manual deferrals are not eligible for machine upgrade: "
            + ", ".join(
                f"{item['unit_id']}:{item['disposition']}" for item in noneligible
            )
        )

    requested_set = set(requested)
    unresolved_tier = {
        item["unit_id"]
        for item in state["tier_deferred_units"]
        if item["target"] == target
    }
    queue_ids = unresolved_tier | requested_set
    queue = [unit["unit_id"] for unit in run["units"] if unit["unit_id"] in queue_ids]
    if len(queue) != len(queue_ids):
        raise EnvelopeError("Review requeue contains unknown or duplicate units")

    ink = _load_input_mask(run, "normalized_global_ink_mask")
    claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    first = _unit_by_id(run, queue[0])
    bounds = _work_bounds(run, first, _zero_margins(), state=state)
    local = _local_unclaimed_mask(
        ink, claimed, bounds, np.zeros_like(ink, dtype=bool)
    )
    revision = checkpoint["revision"] + 1
    transaction = Path(
        tempfile.mkdtemp(prefix=f"commit-{revision:06d}-", dir=run_dir / "transactions")
    )
    final_commit = run_dir / "commits" / f"{revision:06d}"
    conversions = [
        {
            "unit_id": unit_id,
            "from": {
                "kind": "manual_review",
                "disposition": active_manual[unit_id]["disposition"],
                "at_revision": active_manual[unit_id]["at_revision"],
            },
            "to": {
                "kind": "tier_deferred",
                "target": target,
                "reason": "eligible_manual_review_upgraded_to_sol",
            },
        }
        for unit_id in requested
    ]
    try:
        local_path = transaction / "current-local-mask.png"
        save_mask(local_path, local)
        local_ref = _artifact_ref_for_pending(
            local_path, f"commits/{revision:06d}/current-local-mask.png"
        )
        event: dict[str, Any] = {
            "schema_version": EVENT_SCHEMA_VERSION,
            "run_id": run["run_id"],
            "revision": revision,
            "base_checkpoint_sha256": checkpoint["checkpoint_sha256"],
            "base_ledger_sha256": checkpoint["ledger_sha256"],
            "control_action": {
                "type": "requeue_review",
                "target": target,
                "requested_unit_ids": requested,
                "conversions": conversions,
                "queue_unit_ids": queue,
            },
            "cursor_before": state["cursor"],
            "cursor_after": 0,
            "global_claimed_pixel_sha256": sha256_mask_pixels(claimed),
        }
        event["event_sha256"] = _hash_without(event, "event_sha256")
        _write_json_new(transaction / "event.json", event)
        child_state = copy.deepcopy(state)
        child_state.update(
            {
                "cursor": 0,
                "queue_unit_ids": queue,
                "queue_generation": state["queue_generation"] + 1,
                "active_model_tier": target,
                "unit_turn": 0,
                "requested_context_margin_px": _zero_margins(),
                "current_work_bbox_source_xywh": bounds,
                "current_local_mask": local_ref,
                "deferred_units": [
                    item
                    for item in state["deferred_units"]
                    if item["unit_id"] not in requested_set
                ],
                "tier_deferred_units": copy.deepcopy(state["tier_deferred_units"])
                + [
                    {
                        "unit_id": unit_id,
                        "target": target,
                        "reason": "eligible_manual_review_upgraded_to_sol",
                        "at_revision": revision,
                        "origin_manual_disposition": active_manual[unit_id]["disposition"],
                    }
                    for unit_id in requested
                ],
                "completed_unit_ids": [
                    unit_id
                    for unit_id in state["completed_unit_ids"]
                    if unit_id not in requested_set
                ],
            }
        )
        child = _make_checkpoint(
            run,
            revision=revision,
            parent_checkpoint_sha256=checkpoint["checkpoint_sha256"],
            parent_ledger_sha256=checkpoint["ledger_sha256"],
            event_sha256=event["event_sha256"],
            state=child_state,
        )
        _write_json_new(transaction / "checkpoint.json", child)
        _publish_directory(transaction, final_commit)
    except BaseException:
        if transaction.exists():
            shutil.rmtree(transaction, ignore_errors=True)
        raise
    return status(run_dir)


def status(run_dir: Path) -> dict[str, Any]:
    """Return derived machine progress and production blockers."""

    run_dir = Path(run_dir).resolve()
    run, checkpoint = _load_head(run_dir)
    state = checkpoint["state"]
    total = len(state["queue_unit_ids"])
    complete = state["cursor"] >= total
    deferred = state["deferred_units"]
    tier_deferred = state["tier_deferred_units"]
    external = run.get("pass2_import", {}).get("external_route_blockers", [])
    if not complete:
        production_status = "not_ready_machine_work_remaining"
    elif deferred:
        production_status = "blocked_manual_review"
    elif tier_deferred or external:
        production_status = "blocked_follow_up_review"
    else:
        production_status = "ready_for_bound_residual_audit"
    current = None
    if not complete:
        unit = _require_current_unit(run, state)
        current = {
            "unit_id": unit["unit_id"],
            "line_id": unit["line_id"],
            "tentative_text": unit["tentative_text"],
            "cursor": state["cursor"],
            "unit_turn": state["unit_turn"],
            "unit_kind": unit["unit_kind"],
            "active_model_tier": state["active_model_tier"],
        }
    return {
        "schema_version": "sequential-full-page-ownership-status.v1",
        "run_id": run["run_id"],
        "page_id": run["page_id"],
        "revision": checkpoint["revision"],
        "checkpoint_sha256": checkpoint["checkpoint_sha256"],
        "state_sha256": checkpoint["state_sha256"],
        "ledger_sha256": checkpoint["ledger_sha256"],
        "machine_status": (
            "awaiting_tier_requeue"
            if complete and tier_deferred
            else ("complete" if complete else "in_progress")
        ),
        "production_status": production_status,
        "production_blockers": [
            f"manual_ownership:{item['unit_id']}:{item['disposition']}"
            for item in deferred
        ]
        + [
            f"tier_escalation:{item['unit_id']}:{item['target']}"
            for item in tier_deferred
        ]
        + list(external),
        "current": current,
        "progress": {
            "terminal_units": state["cursor"],
            "total_units": total,
            "page_completed_units": len(state["completed_unit_ids"]),
            "page_total_units": len(run["units"]),
            "claimed_units": len(state["claimed_units"]),
            "preloaded_approved_units": len(run.get("preloaded_approved_units", [])),
            "deferred_units": len(deferred),
            "tier_deferred_units": len(tier_deferred),
            "queue_generation": state["queue_generation"],
        },
        "global_claimed_mask_pixel_sha256": state["global_claimed_mask"][
            "pixel_sha256"
        ],
    }


def _build_packet(
    run_dir: Path,
    run: Mapping[str, Any],
    checkpoint: Mapping[str, Any],
    transaction: Path,
    packet_name: str,
) -> dict[str, Any]:
    state = checkpoint["state"]
    unit = _require_current_unit(run, state)
    local = _load_artifact_mask(run_dir, state["current_local_mask"])
    global_claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    source_path = Path(run["input_bindings"]["source"]["path"])
    work_bounds = state["current_work_bbox_source_xywh"]
    original_bbox = list(unit["bbox_source_xywh"])
    active_bbox = _effective_bbox(unit, state)
    override = copy.deepcopy(_bbox_overrides(state).get(unit["unit_id"]))
    context_bounds = _context_bounds(run, unit, work_bounds)
    if context_bounds[2] * context_bounds[3] <= work_bounds[2] * work_bounds[3]:
        raise EnvelopeError(
            "Source context cannot be made larger than the selectable work mask"
        )
    clean_ink = _load_input_mask(
        run,
        (
            "clean_reference_ink_mask"
            if "clean_reference_ink_mask" in run["input_bindings"]
            else "normalized_global_ink_mask"
        ),
    )
    wx, wy, ww, wh = work_bounds
    clean_local = local & clean_ink[wy : wy + wh, wx : wx + ww]
    labels, inventory = stable_components(local)
    references = [component_reference(component) for component in inventory]
    inventory_hash = component_inventory_sha256(inventory)
    fragment_guidance = _fragment_group_guidance(
        labels=labels,
        inventory=inventory,
        run=run,
        state=state,
        unit=unit,
        work_bounds=work_bounds,
        active_bbox=active_bbox,
    )
    evidence = _render_evidence(
        source_path,
        local,
        clean_local,
        global_claimed,
        unit,
        original_bbox,
        active_bbox,
        work_bounds,
        context_bounds,
        transaction,
        packet_name,
        fragment_guidance,
    )
    ink = _load_input_mask(run, "normalized_global_ink_mask")
    tx, ty, tw, th = active_bbox
    target_ink = ink[ty : ty + th, tx : tx + tw]
    target_claimed = global_claimed[ty : ty + th, tx : tx + tw]
    target_unclaimed_pixels = int(np.count_nonzero(target_ink & ~target_claimed))
    target_claimed_pixels = int(np.count_nonzero(target_ink & target_claimed))
    conflict_limit = max(3, round(int(target_ink.sum()) * 0.10))
    ownership_conflict = {
        "blocked": target_claimed_pixels > 0
        and target_unclaimed_pixels <= conflict_limit,
        "reason": (
            "target_bbox_is_mostly_or_entirely_consumed_by_prior_global_claim"
            if target_claimed_pixels > 0 and target_unclaimed_pixels <= conflict_limit
            else None
        ),
        "target_ink_pixels": int(target_ink.sum()),
        "target_prior_claimed_pixels": target_claimed_pixels,
        "target_unclaimed_pixels": target_unclaimed_pixels,
        "little_unclaimed_threshold_px": conflict_limit,
        "required_disposition": (
            "request_expanded_context_or_terminal_human_conflict"
            if target_claimed_pixels > 0 and target_unclaimed_pixels <= conflict_limit
            else None
        ),
    }
    duplicate_ownership_hint = _original_target_claimants(
        run_dir,
        state,
        original_bbox,
    )
    required_tier, tier_basis = _interactive_model_tier(unit)
    automatic_eligibility = _automatic_approval_eligibility(unit)
    legal_actions = _legal_actions(
        references,
        list(local.shape[::-1]),
        active_model_tier=state["active_model_tier"],
        required_model_tier=required_tier,
        ownership_conflict=ownership_conflict["blocked"],
    )
    orientation = {
        "schema_version": DIRECTED_TRANSFORM_SCHEMA_VERSION,
        "source_to_upright_rotation_degrees_ccw": unit[
            "upright_rotation_degrees"
        ],
        "directed_reading": unit["directed_reading"],
        "direction_is_preserved_across_180_degrees": True,
        "envelope_axis_relationship": (
            "none; this directed reading transform must not be normalized modulo 180 "
            "or reused as an undirected envelope angle"
        ),
    }
    task: dict[str, Any] = {
        "task_id": f"{run['run_id']}:{unit['unit_id']}:turn-{state['unit_turn']}",
        "turn": state["unit_turn"],
        "input_state_sha256": sha256_mask_pixels(local),
        "component_inventory_sha256": inventory_hash,
        "components": references,
        "work_size_wh": list(local.shape[::-1]),
        "checkpoint_sha256": checkpoint["checkpoint_sha256"],
        "ledger_sha256": checkpoint["ledger_sha256"],
        "unit": {
            "unit_id": unit["unit_id"],
            "line_id": unit["line_id"],
            "tentative_text": unit["tentative_text"],
            "original_target_bbox_source_xywh": original_bbox,
            "active_target_bbox_source_xywh": active_bbox,
            "target_bbox_source_xywh": active_bbox,
            "registration_override_history": (
                copy.deepcopy(override["history"]) if override is not None else []
            ),
            "work_bbox_source_xywh": work_bounds,
            "supervisor_route_priority": unit.get(
                "supervisor_route_priority", unit["ownership_route"]
            ),
            "unit_kind": unit["unit_kind"],
            "active_model_tier": state["active_model_tier"],
            "required_model_tier": required_tier,
            "interactive_required_model_tier": required_tier,
            "interactive_model_tier_basis": tier_basis,
            "automatic_approval_eligibility": automatic_eligibility,
        },
        "ownership_conflict": ownership_conflict,
        "original_target_prior_claimants": duplicate_ownership_hint,
        "software_fragment_guidance": fragment_guidance,
        "directed_reading_transform": orientation,
        "evidence": evidence,
        "legal_actions": legal_actions,
    }
    task["task_pack_sha256"] = hashlib.sha256(
        canonical_json_bytes(task)
    ).hexdigest()
    packet: dict[str, Any] = {
        "schema_version": WORK_PACKET_SCHEMA_VERSION,
        "run_id": run["run_id"],
        "page_id": run["page_id"],
        "revision": checkpoint["revision"],
        "checkpoint_sha256": checkpoint["checkpoint_sha256"],
        "state_sha256": checkpoint["state_sha256"],
        "ledger_sha256": checkpoint["ledger_sha256"],
        "current": {
            "cursor": state["cursor"],
            "unit_turn": state["unit_turn"],
            "unit_id": unit["unit_id"],
            "line_id": unit["line_id"],
            "tentative_text": unit["tentative_text"],
            "original_target_bbox_source_xywh": original_bbox,
            "active_target_bbox_source_xywh": active_bbox,
            "target_bbox_source_xywh": active_bbox,
            "registration_override_history": (
                copy.deepcopy(override["history"]) if override is not None else []
            ),
            "work_bbox_source_xywh": work_bounds,
            "context_bbox_source_xywh": context_bounds,
            "supervisor_route_priority": unit.get(
                "supervisor_route_priority", unit["ownership_route"]
            ),
            "unit_kind": unit["unit_kind"],
            "active_model_tier": state["active_model_tier"],
            "required_model_tier": required_tier,
            "interactive_required_model_tier": required_tier,
            "interactive_model_tier_basis": tier_basis,
            "automatic_approval_eligibility": automatic_eligibility,
        },
        "directed_reading_transform": orientation,
        "global_claimed": {
            "pixels": int(global_claimed.sum()),
            "pixel_sha256": sha256_mask_pixels(global_claimed),
            "display_policy": "visible_red_and_never_numbered_or_reclaimable",
        },
        "current_unclaimed": {
            "pixels": int(local.sum()),
            "mask_pixel_sha256": sha256_mask_pixels(local),
            "component_inventory_sha256": inventory_hash,
            "components": references,
        },
        "ink_views": {
            "selection_component_universe": "strong",
            "clean": {
                "pixels": int(clean_local.sum()),
                "mask_pixel_sha256": sha256_mask_pixels(clean_local),
                "purpose": "lower_noise_comparison_view",
            },
            "strong": {
                "pixels": int(local.sum()),
                "mask_pixel_sha256": sha256_mask_pixels(local),
                "purpose": "high_recall_selectable_claim_universe",
            },
            "same_crop_coordinates": True,
        },
        "ownership_conflict": ownership_conflict,
        "original_target_prior_claimants": duplicate_ownership_hint,
        "software_fragment_guidance": fragment_guidance,
        "evidence": evidence,
        "legal_actions": legal_actions,
        "compact_action_contract": {
            "schema_version": COMPACT_ACTION_SCHEMA_VERSION,
            "required_root_fields": [
                "schema_version",
                "work_packet_sha256",
                "action",
            ],
            "instruction": (
                "Return exactly one legal compact action bound to this packet. "
                "Software commits one revision; claim_select, defer_tier, or "
                "defer_manual advances the current queue exactly once."
            ),
        },
        "ownership_task": task,
    }
    packet["compact_action_contract"]["work_packet_sha256"] = None
    packet["work_packet_sha256"] = _work_packet_hash(packet)
    packet["compact_action_contract"]["work_packet_sha256"] = packet[
        "work_packet_sha256"
    ]
    return packet


def _fragment_group_guidance(
    *,
    labels: np.ndarray,
    inventory: Sequence[Mapping[str, Any]],
    run: Mapping[str, Any],
    state: Mapping[str, Any],
    unit: Mapping[str, Any],
    work_bounds: Sequence[int],
    active_bbox: Sequence[int],
) -> dict[str, Any]:
    """Offer deterministic same-line fragment bundles without claiming semantics."""

    if (
        float(unit["upright_rotation_degrees"]) != 0.0
        or unit["directed_reading"] != "left_to_right"
    ):
        return {
            "status": "unavailable_for_directed_orientation",
            "reading_lane": None,
            "ignored_micro_component_ids": [],
            "groups": [],
            "eligible_group_ids": [],
            "recommended_group_ids": [],
        }

    line_boxes = [
        _effective_bbox(candidate, state)
        for candidate in run["units"]
        if candidate["line_id"] == unit["line_id"]
    ]
    line_centers = [box[1] + box[3] / 2.0 for box in line_boxes]
    line_heights = [box[3] for box in line_boxes]
    lane_center = float(np.median(line_centers))
    lane_half_height = max(32.0, float(np.median(line_heights)) * 0.85)
    lane_top = lane_center - lane_half_height
    lane_bottom = lane_center + lane_half_height

    work_x, work_y, _work_width, _work_height = [int(value) for value in work_bounds]
    ignored_micro: list[int] = []
    features: list[dict[str, Any]] = []
    for component in inventory:
        component_id = int(component["id"])
        area = int(component["area_px"])
        if area <= 2:
            ignored_micro.append(component_id)
            continue
        component_mask = labels == component_id
        ys, _xs = np.nonzero(component_mask)
        bbox = component["bbox"]
        features.append(
            {
                "component_id": component_id,
                "area_px": area,
                "bbox_source_xywh": [
                    work_x + int(bbox["x"]),
                    work_y + int(bbox["y"]),
                    int(bbox["width"]),
                    int(bbox["height"]),
                ],
                "median_source_y": work_y + float(np.median(ys)),
            }
        )

    parent = list(range(len(features)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left_index, left in enumerate(features):
        lx, _ly, lw, lh = left["bbox_source_xywh"]
        for right_index in range(left_index + 1, len(features)):
            right = features[right_index]
            rx, _ry, rw, rh = right["bbox_source_xywh"]
            horizontal_gap = max(0, max(lx, rx) - min(lx + lw, rx + rw))
            baseline_delta = abs(left["median_source_y"] - right["median_source_y"])
            if (
                horizontal_gap <= max(24.0, 0.15 * (lw + rw))
                and baseline_delta <= max(24.0, 0.30 * max(lh, rh))
            ):
                union(left_index, right_index)

    grouped: dict[int, list[int]] = {}
    for index in range(len(features)):
        grouped.setdefault(find(index), []).append(index)
    group_indexes = sorted(
        grouped.values(),
        key=lambda indexes: min(
            features[index]["bbox_source_xywh"][0] for index in indexes
        ),
    )
    target_x, target_y, target_width, target_height = [
        int(value) for value in active_bbox
    ]
    target_center_x = target_x + target_width / 2.0
    groups: list[dict[str, Any]] = []
    for order, indexes in enumerate(group_indexes, start=1):
        members = [features[index] for index in indexes]
        left = min(member["bbox_source_xywh"][0] for member in members)
        top = min(member["bbox_source_xywh"][1] for member in members)
        right = max(
            member["bbox_source_xywh"][0] + member["bbox_source_xywh"][2]
            for member in members
        )
        bottom = max(
            member["bbox_source_xywh"][1] + member["bbox_source_xywh"][3]
            for member in members
        )
        robust_y = float(
            np.average(
                [member["median_source_y"] for member in members],
                weights=[member["area_px"] for member in members],
            )
        )
        overlap_width = max(0, min(right, target_x + target_width) - max(left, target_x))
        overlap_height = max(0, min(bottom, target_y + target_height) - max(top, target_y))
        groups.append(
            {
                "group_id": f"G{order:03d}",
                "component_ids": [member["component_id"] for member in members],
                "component_count": len(members),
                "area_px": sum(member["area_px"] for member in members),
                "bbox_source_xywh": [left, top, right - left, bottom - top],
                "robust_median_source_y": round(robust_y, 3),
                "reading_lane_status": (
                    "aligned" if lane_top <= robust_y <= lane_bottom else "outside_current_line"
                ),
                "target_bbox_overlap_area": int(overlap_width * overlap_height),
                "target_center_distance_x_px": round(
                    abs((left + right) / 2.0 - target_center_x), 3
                ),
                "agent_may_split": True,
                "semantic_status": "software_proposal_not_ownership_truth",
            }
        )
    eligible = [group for group in groups if group["reading_lane_status"] == "aligned"]
    recommended = sorted(
        eligible,
        key=lambda group: (
            -group["target_bbox_overlap_area"],
            group["target_center_distance_x_px"],
            group["group_id"],
        ),
    )[:1]
    return {
        "status": "available",
        "reading_lane": {
            "center_source_y": round(lane_center, 3),
            "half_height_px": round(lane_half_height, 3),
            "top_source_y": round(lane_top, 3),
            "bottom_source_y": round(lane_bottom, 3),
            "source": "median_geometry_of_all_software_units_on_current_line",
            "purpose": "row filtering only; not ownership truth",
        },
        "ignored_micro_component_ids": ignored_micro,
        "groups": groups,
        "eligible_group_ids": [group["group_id"] for group in eligible],
        "recommended_group_ids": [group["group_id"] for group in recommended],
        "routing_hint": (
            "Terra may approve an obvious group; if it disputes semantic continuity "
            "inside a recommended multi-component group, defer the exact packet to Sol."
        ),
    }


def _render_evidence(
    source_path: Path,
    local: np.ndarray,
    clean_local: np.ndarray,
    global_claimed: np.ndarray,
    unit: Mapping[str, Any],
    original_bbox: Sequence[int],
    active_bbox: Sequence[int],
    work_bounds: Sequence[int],
    context_bounds: Sequence[int],
    destination: Path,
    packet_name: str,
    fragment_guidance: Mapping[str, Any],
) -> dict[str, Any]:
    with Image.open(source_path) as handle:
        source = handle.convert("RGB")
    cx, cy, cw, ch = context_bounds
    wx, wy, ww, wh = work_bounds
    context = source.crop((cx, cy, cx + cw, cy + ch))
    work = source.crop((wx, wy, wx + ww, wy + wh))
    claimed_context = global_claimed[cy : cy + ch, cx : cx + cw]
    red_overlay = _red_overlay(context, claimed_context)
    board = red_overlay.copy()
    draw = ImageDraw.Draw(board)
    ox, oy, ow, oh = original_bbox
    draw.rectangle(
        (ox - cx, oy - cy, ox + ow - cx, oy + oh - cy),
        outline=_ORANGE,
        width=2,
    )
    tx, ty, tw, th = active_bbox
    draw.rectangle(
        (tx - cx, ty - cy, tx + tw - cx, ty + th - cy),
        outline=_GREEN,
        width=3,
    )
    labels, inventory = stable_components(local)
    label_font = _font(17)
    for component in inventory:
        bbox = component["bbox"]
        x0 = wx - cx + bbox["x"]
        y0 = wy - cy + bbox["y"]
        x1 = x0 + bbox["width"]
        y1 = y0 + bbox["height"]
        draw.rectangle((x0, y0, x1, y1), outline=_BLUE, width=2)
        draw.text(
            (x0 + 1, max(0, y0 - 18)),
            str(component["id"]),
            fill="white",
            font=label_font,
            stroke_width=2,
            stroke_fill="black",
        )
    group_palette = (
        (0, 132, 153),
        (139, 87, 190),
        (222, 115, 24),
        (35, 142, 80),
    )
    for index, group in enumerate(fragment_guidance.get("groups", [])):
        gx, gy, gw, gh = group["bbox_source_xywh"]
        color = group_palette[index % len(group_palette)]
        draw.rectangle(
            (gx - cx, gy - cy, gx + gw - cx, gy + gh - cy),
            outline=color,
            width=4,
        )
        draw.text(
            (gx - cx + 3, max(0, gy - cy - 38)),
            group["group_id"],
            fill=color,
            font=_font(22),
            stroke_width=2,
            stroke_fill="white",
        )
    lane = fragment_guidance.get("reading_lane")
    if lane is not None:
        top_y = int(round(lane["top_source_y"] - cy))
        bottom_y = int(round(lane["bottom_source_y"] - cy))
        draw.line((0, top_y, cw, top_y), fill=(0, 185, 205), width=3)
        draw.line((0, bottom_y, cw, bottom_y), fill=(0, 185, 205), width=3)
    rotation = float(unit["upright_rotation_degrees"])
    upright_context = context.rotate(
        rotation,
        expand=True,
        resample=Image.Resampling.BICUBIC,
        fillcolor="#e5ddc9",
    )
    upright_board = board.rotate(
        rotation,
        expand=True,
        resample=Image.Resampling.BICUBIC,
        fillcolor="#e5ddc9",
    )

    # The candidate rectangle is only a disposable viewport.  The agent's
    # semantic object is the exact connected-ink label map below.  Encoding the
    # stable component id in RGB gives the browser a deterministic per-pixel
    # hit target without treating overlapping rectangles as ownership truth.
    label_values = labels.astype(np.uint32)
    label_rgb = np.zeros((*labels.shape, 3), dtype=np.uint8)
    label_rgb[..., 0] = (label_values & 0xFF).astype(np.uint8)
    label_rgb[..., 1] = ((label_values >> 8) & 0xFF).astype(np.uint8)
    label_rgb[..., 2] = ((label_values >> 16) & 0xFF).astype(np.uint8)
    component_label_map = Image.fromarray(label_rgb, mode="RGB")

    selection_rgb = np.full((*local.shape, 3), (251, 247, 238), dtype=np.uint8)
    selection_rgb[local] = np.array((201, 55, 48), dtype=np.uint8)
    ink_selection_crop = Image.fromarray(selection_rgb, mode="RGB")
    clean_selection_rgb = np.full(
        (*clean_local.shape, 3), (251, 247, 238), dtype=np.uint8
    )
    clean_selection_rgb[clean_local] = np.array((201, 55, 48), dtype=np.uint8)
    clean_ink_selection_crop = Image.fromarray(clean_selection_rgb, mode="RGB")

    # Make prior claims disappear against a robust paper-color estimate.  This
    # is review evidence rather than a restoration: exact claimed pixels remain
    # bound separately in the ledger, while the visual knockout makes missed
    # words and residual islands conspicuous at page scale.
    source_array = np.asarray(source, dtype=np.uint8).copy()
    brightness = source_array.mean(axis=2)
    chroma = source_array.max(axis=2) - source_array.min(axis=2)
    paper_samples = source_array[(brightness > 145) & (chroma < 75) & ~global_claimed]
    paper_color = (
        np.median(paper_samples, axis=0).astype(np.uint8)
        if len(paper_samples)
        else np.array((238, 226, 207), dtype=np.uint8)
    )
    source_array[global_claimed] = paper_color
    residual_full = Image.fromarray(source_array, mode="RGB")
    residual_draw = ImageDraw.Draw(residual_full)
    residual_draw.rectangle((tx, ty, tx + tw, ty + th), outline=_GREEN, width=8)
    residual_page = _fit_inside(residual_full, (900, 1200), fill="#eee2d2")

    decision_collage = _decision_collage(
        residual_page=residual_page,
        context_board=board,
        work_crop=work,
        ink_selection=ink_selection_crop,
        unit=unit,
    )

    values = {
        "decision_collage": (
            decision_collage,
            "ordered_agent_collage_full_residual_context_candidate_and_exact_ink",
        ),
        "residual_page": (
            residual_page,
            "page_with_claimed_ink_visually_erased_and_current_candidate_green",
        ),
        "source_context": (context, "larger_source_context"),
        "upright_context": (upright_context, "directed_larger_upright_context"),
        "work_crop": (work, "source_oriented_work_crop"),
        "prior_owned_red_overlay": (
            red_overlay,
            "larger_context_with_globally_claimed_ink_red",
        ),
        "numbered_components": (
            board,
            "red_prior_ownership_orange_original_green_active_target_numbered_components",
        ),
        "upright_numbered_components": (
            upright_board,
            "directed_upright_numbered_review_board",
        ),
        "ink_selection_crop": (
            ink_selection_crop,
            "strong_high_recall_unclaimed_ink_ready_for_selection",
        ),
        "clean_ink_selection_crop": (
            clean_ink_selection_crop,
            "clean_lower_noise_ink_in_exact_same_crop_coordinates",
        ),
        "component_label_map": (
            component_label_map,
            "machine_hit_map_rgb_encodes_stable_component_id_not_visual_evidence",
        ),
    }
    evidence: dict[str, Any] = {}
    photographic_evidence = {
        "decision_collage",
        "residual_page",
        "source_context",
        "upright_context",
        "work_crop",
        "prior_owned_red_overlay",
        "numbered_components",
        "upright_numbered_components",
    }
    published_by_file_sha256: dict[str, Path] = {}
    for name, (image, role) in values.items():
        is_photographic = name in photographic_evidence
        suffix = "jpg" if is_photographic else "png"
        filename = f"{name.replace('_', '-')}.{suffix}"
        path = destination / filename
        if is_photographic:
            image.convert("RGB").save(
                path,
                format="JPEG",
                quality=95,
                subsampling=0,
                optimize=True,
            )
            media_type = "image/jpeg"
        else:
            image.save(path, format="PNG", compress_level=9, optimize=False)
            media_type = "image/png"
        file_sha256 = sha256_file(path)
        duplicate = published_by_file_sha256.get(file_sha256)
        if duplicate is not None:
            path.unlink()
            os.link(duplicate, path)
        else:
            published_by_file_sha256[file_sha256] = path
        with Image.open(path) as published:
            published_pixel_sha256 = _image_pixel_sha256(published.convert("RGB"))
        evidence[name] = {
            "path": f"packets/{packet_name}/{filename}",
            "file_sha256": file_sha256,
            "image_pixel_sha256": published_pixel_sha256,
            "size_wh": list(image.size),
            "media_type": media_type,
            "role": role,
        }
    for image, _ in values.values():
        image.close()
    source.close()
    return evidence


def _fit_inside(image: Image.Image, size: tuple[int, int], *, fill: str) -> Image.Image:
    """Return a deterministic contained preview without cropping evidence."""

    target_width, target_height = size
    copy_image = image.copy()
    copy_image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, fill)
    x = (target_width - copy_image.width) // 2
    y = (target_height - copy_image.height) // 2
    canvas.paste(copy_image, (x, y))
    return canvas


def _decision_collage(
    *,
    residual_page: Image.Image,
    context_board: Image.Image,
    work_crop: Image.Image,
    ink_selection: Image.Image,
    unit: Mapping[str, Any],
) -> Image.Image:
    """Render the exact ordered evidence the agent should inspect first."""

    width, height = 1680, 1180
    canvas = Image.new("RGB", (width, height), "#f5ede1")
    draw = ImageDraw.Draw(canvas)
    title_font = _font(30)
    label_font = _font(22)
    small_font = _font(17)
    draw.text((34, 25), "CURRENT WORD WORKSPACE", fill="#2d241d", font=title_font)
    draw.text(
        (34, 66),
        f"Software candidate: {unit['unit_id']}  |  tentative reading: {unit['tentative_text']}",
        fill="#51463c",
        font=small_font,
    )

    panels = [
        ("1  Remaining page", residual_page, (34, 112, 520, 1035)),
        ("2  Context + proposal", context_board, (580, 112, 1066, 540)),
        ("3  Candidate crop", work_crop, (1092, 112, 1646, 540)),
        ("4  Exact selectable ink", ink_selection, (580, 608, 1646, 1035)),
    ]
    for label, image, (x0, y0, x1, y1) in panels:
        draw.text((x0, y0 - 32), label, fill="#2d241d", font=label_font)
        fitted = _fit_inside(image, (x1 - x0, y1 - y0), fill="#fffaf2")
        canvas.paste(fitted, (x0, y0))
        draw.rectangle((x0, y0, x1, y1), outline="#b9aa96", width=2)
    draw.text(
        (580, 1065),
        "Goal: make the viewport contain one complete word, then turn only that word green.",
        fill="#14535e",
        font=label_font,
    )
    draw.text(
        (580, 1100),
        "Red = unselected ink · green = selected ink · claimed words are erased from panel 1.",
        fill="#6d5f51",
        font=small_font,
    )
    return canvas


def _legal_actions(
    references: Sequence[Mapping[str, Any]],
    work_size_wh: list[int],
    *,
    active_model_tier: str,
    required_model_tier: str,
    ownership_conflict: bool,
) -> list[dict[str, Any]]:
    ids = [reference["id"] for reference in references]
    common = {
        "confidence": ["high", "medium", "low"],
        "reason_codes": [
            "same_word_body",
            "detached_mark_belongs_to_target",
            "adjacent_word",
            "rule_or_noise",
            "threshold_bridge",
            "border_contact",
            "clipped_ink",
            "touching_words",
            "correction_or_strikeout",
            "uncertain_reading",
        ],
    }
    actions: list[dict[str, Any]] = []
    ownership_allowed = (
        not ownership_conflict
        and required_model_tier != "human"
        and (
            active_model_tier == required_model_tier
            or (
                active_model_tier == "sol"
                and required_model_tier in {"terra", "sol"}
            )
        )
    )
    if ids and ownership_allowed:
        actions.extend(
            [
                {
                    "type": "claim_select",
                    "component_ids": {"nonempty_subset_of": ids},
                    "model_tiers": ["terra", "sol"],
                    "note": "may select multiple disconnected components belonging to one word",
                    **common,
                    "effect": "terminal_for_unit_and_cursor_advances_once",
                },
                {
                    "type": "exclude",
                    "component_ids": {"nonempty_subset_of": ids},
                    "model_tiers": ["terra", "sol"],
                    **common,
                    "effect": "same_unit_fresh_turn_required",
                },
            ]
        )
        if active_model_tier == "sol":
            actions.append(
                {
                    "type": "cut",
                    "bridge_component_id": {"one_of": ids},
                    "cut": {
                        "kind": "line",
                        "points": "exactly_two_[x,y]_integer_endpoints_in_work_crop",
                        "width_px": [1, 2, 3],
                        "intent": "sever_observed_bridge",
                        "work_size_wh": work_size_wh,
                    },
                    "model_tiers": ["sol"],
                    **common,
                    "effect": "same_unit_fresh_turn_required_and_components_relabel",
                }
            )
    actions.extend(
        [
            {
                "type": "reopen_bbox",
                "bbox_source_xywh": (
                    "exact_[x,y,width,height]_integers_in_bound_source"
                ),
                "confidence": ["high", "medium", "low"],
                "reason_codes": {
                    "nonempty_subset_of": sorted(_REGISTRATION_REASON_CODES)
                },
                "model_tiers": ["terra", "sol"],
                "validation": (
                    "materially_different_intersects_normalized_ink_and_within_"
                    "bounded_registration_move_policy"
                ),
                "effect": (
                    "same_unit_fresh_turn_with_override_provenance_and_fresh_"
                    "unclaimed_mask"
                ),
            },
            {
                "type": "request_expanded_context",
                "request": {
                    "kind": ["crop_margin", "source_resolution", "line_context"],
                    "sides": {"nonempty_subset_of": ["left", "right", "top", "bottom"]},
                    "margin_px": {"integer_min": 16, "integer_max": 512},
                    "focus_component_ids": {"subset_of": ids},
                    "why": [
                        "border_contact",
                        "ambiguous_neighbor",
                        "detached_mark",
                        "low_resolution",
                        "uncertain_reading",
                    ],
                },
                **common,
                "effect": "same_unit_fresh_turn_required_with_larger_context",
            },
        ] if active_model_tier in {"terra", "sol"} else [
            {
                "type": "request_expanded_context",
                "request": {
                    "kind": ["crop_margin", "source_resolution", "line_context"],
                    "sides": {"nonempty_subset_of": ["left", "right", "top", "bottom"]},
                    "margin_px": {"integer_min": 16, "integer_max": 512},
                    "focus_component_ids": {"subset_of": ids},
                    "why": [
                        "border_contact",
                        "ambiguous_neighbor",
                        "detached_mark",
                        "low_resolution",
                        "uncertain_reading",
                    ],
                },
                **common,
                "effect": "same_unit_fresh_turn_required_with_larger_context",
            }
        ]
    )
    if active_model_tier == "terra" and not ownership_conflict:
        actions.append(
            {
                "type": "defer_tier",
                "target": "sol",
                "reason": (
                    _STATIC_SOL_REASON
                    if required_model_tier == "sol"
                    else _DISCOVERED_COMPLEXITY_REASON
                ),
                "effect": "terminal_for_current_tier_and_cursor_advances_once_then_requeue_required",
            }
        )
    actions.append(
        {
            "type": "defer_manual",
            "disposition": [
                "ambiguous_ownership",
                "ambiguous_detached_mark",
                "clipped_target",
                "touching_or_overwritten_ink",
                "insufficient_visual_evidence",
                "unsafe_cut",
            ],
            **common,
            "effect": "terminal_final_human_disposition_cursor_advances_once_production_blocks",
        }
    )
    return actions


def _automatic_approval_eligibility(unit: Mapping[str, Any]) -> dict[str, Any]:
    """Explain why the current active unit was not automatically preloaded."""

    pass2_action = unit.get("pass2_action")
    return {
        "eligible": False,
        "required_validated_pass2_action": "approve_candidate_mask",
        "observed_pass2_action": pass2_action,
        "reason": (
            "validated_pass2_did_not_approve_an_exact_candidate_mask"
            if pass2_action is not None
            else "no_validated_pass2_exact_approval"
        ),
        "independent_from_interactive_model_tier": True,
    }


def _interactive_model_tier(unit: Mapping[str, Any]) -> tuple[str, list[str]]:
    """Return the deterministic model tier for an interactive ownership turn.

    Pass 2's ``sol_review`` means only that the candidate mask was unsafe to
    preload.  It is deliberately absent from the Sol-routing conditions below.
    """

    unit_kind = unit.get("unit_kind")
    ownership_route = unit.get("ownership_route")
    pass2_action = unit.get("pass2_action", unit.get("supervisor_route_priority"))
    risks = {
        risk
        for risk in unit.get("risk_flags", [])
        if isinstance(risk, str) and risk != "none"
    }

    if (
        unit_kind != "word"
        or "unreadable" in risks
        or ownership_route in {"human", "human_review"}
        or pass2_action in {"human", "human_review"}
    ):
        return "human", [
            "provisional_nonword_unreadable_or_human_route_requires_explicit_review"
        ]

    sol_reasons: list[str] = []
    if ownership_route == "sol_shared_ink":
        sol_reasons.append("original_pass1_route_sol_shared_ink")
    if pass2_action == "reopen_bbox" or unit.get("queue_origin") == "pass2_missing_word_candidate":
        sol_reasons.append("pass2_reopen_or_missing_word_follow_up")
    difficult_risks = sorted(risks & _SOL_INTERACTIVE_RISK_FLAGS)
    if difficult_risks:
        sol_reasons.append("difficult_risk_flags:" + ",".join(difficult_risks))
    if abs(float(unit.get("upright_rotation_degrees", 0))) >= 45:
        sol_reasons.append("large_directed_rotation")
    if sol_reasons:
        return "sol", sol_reasons

    basis = ["original_pass1_route_terra_box_mask"]
    if pass2_action == "sol_review":
        basis.append("pass2_sol_review_blocks_auto_preload_but_not_interactive_terra")
    return "terra", basis


def _validate_bound_inputs(
    decision_path: Path, knockout_manifest_path: Path, packet_path: Path
) -> dict[str, Any]:
    for path in (decision_path, knockout_manifest_path, packet_path):
        if not path.is_file():
            raise EnvelopeError(f"Required bound input is missing: {path}")
    decision = _read_json(decision_path)
    knockout = _read_json(knockout_manifest_path)
    packet = _read_json(packet_path)
    for name, value in (("decision", decision), ("knockout manifest", knockout), ("packet", packet)):
        if not isinstance(value, Mapping):
            raise EnvelopeError(f"{name} must be a JSON object")

    packet_claim = packet.get("packet_sha256")
    if packet_claim != _legacy_hash_without(packet, "packet_sha256"):
        raise EnvelopeError("Public packet packet_sha256 is stale")
    decision_hash = sha256_file(decision_path)
    packet_hash = sha256_file(packet_path)
    inputs = knockout.get("inputs", {})
    if inputs.get("decision", {}).get("file_sha256") != decision_hash:
        raise EnvelopeError("Knockout manifest does not bind the exact pass1 decision")
    if inputs.get("public_packet", {}).get("file_sha256") != packet_hash:
        raise EnvelopeError("Knockout manifest does not bind the exact public packet")
    if decision.get("public_packet_sha256") != packet_hash:
        raise EnvelopeError("Pass1 decision does not bind the exact public packet")
    if decision.get("page_id") != packet.get("page_id") or knockout.get(
        "page_id"
    ) != decision.get("page_id"):
        raise EnvelopeError("Pass1, knockout, and packet page IDs do not match")
    if knockout.get("manifest_sha256") != _legacy_hash_without(
        knockout, "manifest_sha256"
    ):
        raise EnvelopeError("Knockout manifest_sha256 is stale")

    source_info = packet.get("source", {})
    source_path = _resolve_input_path(packet_path, source_info.get("path"))
    if not source_path.is_file() or sha256_file(source_path) != source_info.get("sha256"):
        raise EnvelopeError("Public packet source is missing or changed")
    if decision.get("source_sha256") != source_info.get("sha256"):
        raise EnvelopeError("Pass1 decision does not bind the exact source")
    if inputs.get("source", {}).get("file_sha256") != source_info.get("sha256"):
        raise EnvelopeError("Knockout manifest does not bind the exact source")
    with Image.open(source_path) as source:
        if list(source.size) != source_info.get("size"):
            raise EnvelopeError("Bound source dimensions changed")

    output_entry = next(
        (
            item
            for item in knockout.get("outputs", [])
            if item.get("path") == "masks/ink-proposal.png"
        ),
        None,
    )
    if output_entry is None:
        raise EnvelopeError("Knockout manifest lacks normalized global ink output")
    ink_path = knockout_manifest_path.parent / output_entry["path"]
    if not ink_path.is_file() or sha256_file(ink_path) != output_entry.get("file_sha256"):
        raise EnvelopeError("Normalized global ink mask is missing or changed")
    ink = _load_normalized_mask(ink_path, tuple(source_info["size"]))
    ink_pixel_hash = sha256_mask_pixels(ink)
    if inputs.get("ink_proposal_pixel_sha256") != ink_pixel_hash:
        raise EnvelopeError("Knockout manifest global ink pixel hash is stale")
    return {
        "decision": decision,
        "decision_path": decision_path,
        "knockout_manifest": knockout,
        "knockout_manifest_path": knockout_manifest_path,
        "packet": packet,
        "packet_path": packet_path,
        "source_path": source_path,
        "ink_path": ink_path,
        "ink_pixel_sha256": ink_pixel_hash,
    }


def _validate_and_adapt_pass2(
    bound: Mapping[str, Any],
    word_units: Sequence[Mapping[str, Any]],
    decision_path: Path,
    residual_region_manifest_path: Path,
) -> dict[str, Any]:
    """Run the frozen pass-2 validator and adapt only its proven outcomes.

    This is intentionally an adapter, not a second validator.  The frozen
    validator owns all schema, evidence, residual-partition, and route checks.
    Here we independently enforce only the supervisor's page-state invariants:
    approved masks map to source, remain inside global ink, and do not overlap;
    reopened geometry replaces the active bbox; Sol/human/reopen units stay in
    the queue; and missing-word follow-ups become deterministic new queue items.
    """

    if not decision_path.is_file() or not residual_region_manifest_path.is_file():
        raise EnvelopeError("Pass2 decision or residual-region manifest is missing")
    try:
        validation = _call_frozen_pass2_validator(
            decision_path,
            pass1_decision_path=bound["decision_path"],
            knockout_manifest_path=bound["knockout_manifest_path"],
            public_packet_path=bound["packet_path"],
            residual_region_manifest_path=residual_region_manifest_path,
        )
    except (RuntimeError, OSError, ValueError) as error:
        raise EnvelopeError(f"Frozen pass2 validation failed: {error}") from error
    if validation.get("status") != "pass":
        raise EnvelopeError("Frozen pass2 validator did not return status pass")
    if validation.get("decision_file_sha256") != sha256_file(decision_path):
        raise EnvelopeError("Frozen pass2 validation is stale for the decision file")

    pass2 = _read_json(decision_path)
    if pass2.get("page_id") != bound["decision"]["page_id"]:
        raise EnvelopeError("Pass2 decision page does not match the supervisor inputs")
    all_pass1_units: dict[str, dict[str, Any]] = {}
    line_context: dict[str, dict[str, Any]] = {}
    for line in bound["decision"]["lines"]:
        line_context[line["line_id"]] = line
        for unit in line.get("visible_units", []):
            all_pass1_units[unit["unit_id"]] = {**unit, "line_id": line["line_id"]}

    decisions: dict[str, dict[str, Any]] = {
        item["unit_id"]: item
        for line in pass2["lines"]
        for item in line["unit_decisions"]
    }
    ink = _load_normalized_mask(
        bound["ink_path"], tuple(bound["packet"]["source"]["size"])
    )
    claimed_union = np.zeros_like(ink, dtype=bool)
    preloaded: list[dict[str, Any]] = []
    for unit_id, item in decisions.items():
        if item["action"] != "approve_candidate_mask":
            continue
        pass1_unit = all_pass1_units[unit_id]
        bbox = pass1_unit["bbox_source_xywh"]
        approval = item["approved_candidate_mask"]
        path = (bound["knockout_manifest_path"].parent / approval["path"]).resolve()
        try:
            path.relative_to(bound["knockout_manifest_path"].parent.resolve())
        except ValueError as error:
            raise EnvelopeError(f"Approved mask for {unit_id} leaves knockout root") from error
        if not path.is_file() or sha256_file(path) != approval["file_sha256"]:
            raise EnvelopeError(f"Approved mask for {unit_id} is missing or stale")
        with Image.open(path) as image:
            values = np.asarray(image.convert("L"), dtype=np.uint8)
        if values.shape != (bbox[3], bbox[2]) or not set(
            int(value) for value in np.unique(values)
        ).issubset({0, 255}):
            raise EnvelopeError(f"Approved mask for {unit_id} is not exact binary bbox geometry")
        local = values > 0
        if sha256_mask_pixels(local) != approval["pixel_sha256"] or int(
            local.sum()
        ) != approval["pixel_count"]:
            raise EnvelopeError(f"Approved mask pixels for {unit_id} are stale")
        source_mask = _map_local_to_source(local, bbox, ink.shape)
        if np.any(source_mask & ~ink):
            raise EnvelopeError(f"Approved mask for {unit_id} leaves normalized global ink")
        if np.any(source_mask & claimed_union):
            raise EnvelopeError(f"Approved pass2 masks overlap at unit {unit_id}")
        claimed_union |= source_mask
        preloaded.append(
            {
                "unit_id": unit_id,
                "pixels": int(source_mask.sum()),
                "source_mask": source_mask,
                "approved_local_mask_file_sha256": approval["file_sha256"],
            }
        )

    active: list[dict[str, Any]] = []
    for original in word_units:
        item = decisions.get(original["unit_id"])
        if item is None:
            raise EnvelopeError(f"Validated pass2 omits word unit {original['unit_id']}")
        if item["action"] == "approve_candidate_mask":
            continue
        unit = copy.deepcopy(dict(original))
        unit["supervisor_route_priority"] = item["action"]
        unit["pass2_action"] = item["action"]
        unit["pass2_reason"] = item["reason"]
        if item["action"] == "reopen_bbox":
            unit["original_bbox_source_xywh"] = unit["bbox_source_xywh"]
            unit["bbox_source_xywh"] = list(item["reopen_bbox_source_xywh"])
            unit["pass2_follow_up"] = copy.deepcopy(item["follow_up"])
        else:
            unit["pass2_escalation"] = copy.deepcopy(item["escalation"])
        active.append(unit)

    used_ids = set(all_pass1_units)
    for position, candidate in enumerate(pass2["missing_word_candidates"], start=1):
        candidate_id = candidate["candidate_id"]
        if candidate_id in used_ids:
            raise EnvelopeError(f"Pass2 missing-word candidate reuses unit ID {candidate_id}")
        used_ids.add(candidate_id)
        target_line_id = candidate["follow_up"]["target_line_id"]
        line = line_context[target_line_id]
        active.append(
            {
                "unit_id": candidate_id,
                "line_id": target_line_id,
                "line_reading_order": line["line_reading_order"],
                "unit_reading_order": 1_000_000 + position,
                "tentative_text": candidate["tentative_text"],
                "unit_kind": "word",
                "bbox_source_xywh": list(candidate["source_bbox_xywh"]),
                "ownership_route": candidate["route"],
                "risk_flags": ["pass2_missing_word_candidate"],
                "upright_rotation_degrees": line["upright_rotation_degrees"],
                "directed_reading": line["directed_reading"],
                "supervisor_route_priority": candidate["route"],
                "pass2_action": "missing_word_candidate",
                "queue_origin": "pass2_missing_word_candidate",
                "pass2_follow_up": copy.deepcopy(candidate["follow_up"]),
                "pass2_origin_group_ids": list(candidate["origin_group_ids"]),
            }
        )
    _validate_units(active, tuple(bound["packet"]["source"]["size"]))
    return {
        "decision_path": decision_path,
        "residual_region_manifest_path": residual_region_manifest_path,
        "validation": validation,
        "active_units": active,
        "preloaded_claims": preloaded,
        "external_route_blockers": [
            f"pass2_residual:{group['group_id']}:{group['disposition']}"
            for group in pass2["residual_groups"]
            if group["disposition"] in {"sol_review", "human_review"}
        ],
        "validator_path": Path(__file__).resolve().parents[2]
        / "scripts/validate_full_page_ownership_knockout_decision_v2.py",
        "schema_path": Path(__file__).resolve().parents[2]
        / "schemas/full-page-ownership-knockout-decision-v2.schema.json",
    }


def _call_frozen_pass2_validator(decision_path: Path, **kwargs: Path) -> dict[str, Any]:
    validator_path = (
        Path(__file__).resolve().parents[2]
        / "scripts/validate_full_page_ownership_knockout_decision_v2.py"
    )
    if not validator_path.is_file():
        raise EnvelopeError(f"Frozen pass2 validator is missing: {validator_path}")
    spec = importlib.util.spec_from_file_location(
        "_sequential_ownership_frozen_pass2_validator", validator_path
    )
    if spec is None or spec.loader is None:
        raise EnvelopeError("Cannot load the frozen pass2 validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate(decision_path, **kwargs)


def _ordered_units(
    decision: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lines = decision.get("lines")
    if not isinstance(lines, list):
        raise EnvelopeError("Pass1 decision lines must be a list")
    ordered_lines = sorted(lines, key=lambda line: (line["line_reading_order"], line["line_id"]))
    units: list[dict[str, Any]] = []
    ignored: list[dict[str, Any]] = []
    for line in ordered_lines:
        visible = line.get("visible_units")
        if not isinstance(visible, list):
            raise EnvelopeError(f"Pass1 line {line.get('line_id')} visible_units must be a list")
        for unit in sorted(visible, key=lambda item: (item["reading_order"], item["unit_id"])):
            record = {
                "unit_id": unit["unit_id"],
                "line_id": line["line_id"],
                "line_reading_order": line["line_reading_order"],
                "unit_reading_order": unit["reading_order"],
                "tentative_text": unit["tentative_text"],
                "unit_kind": unit["unit_kind"],
                "bbox_source_xywh": list(unit["bbox_source_xywh"]),
                "ownership_route": unit["ownership_route"],
                "risk_flags": list(unit.get("risk_flags", [])),
                "upright_rotation_degrees": line["upright_rotation_degrees"],
                "directed_reading": line["directed_reading"],
            }
            # Pass-1 labels are provisional.  A non_word_mark or unreadable
            # region may be a real word (007's possible "I" is the motivating
            # case), so every visible unit survives until an explicit terminal
            # ownership disposition.
            units.append(record)
    return units, ignored


def _validate_units(units: Sequence[Mapping[str, Any]], source_size: tuple[int, int]) -> None:
    seen: set[str] = set()
    for unit in units:
        unit_id = unit["unit_id"]
        if not isinstance(unit_id, str) or not unit_id or unit_id in seen:
            raise EnvelopeError("Pass1 word unit IDs must be non-empty and globally unique")
        seen.add(unit_id)
        x, y, width, height = _bbox(unit["bbox_source_xywh"])
        if x + width > source_size[0] or y + height > source_size[1]:
            raise EnvelopeError(f"Unit {unit_id} bbox lies outside the bound source")
        rotation = unit["upright_rotation_degrees"]
        if isinstance(rotation, bool) or not isinstance(rotation, (int, float)):
            raise EnvelopeError(f"Unit {unit_id} upright rotation must be numeric")
        if not -180 <= float(rotation) <= 180:
            raise EnvelopeError(f"Unit {unit_id} upright rotation is outside [-180, 180]")
        if unit["directed_reading"] not in {
            "left_to_right",
            "right_to_left",
            "top_to_bottom",
            "bottom_to_top",
        }:
            raise EnvelopeError(f"Unit {unit_id} directed_reading is unsupported")


def _initial_state(
    run: Mapping[str, Any],
    ink: np.ndarray,
    claimed: np.ndarray,
    global_path: Path,
    temp_root: Path,
    *,
    preloaded_claims: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    claimed_units: list[dict[str, Any]] = []
    for position, preload in enumerate(preloaded_claims, start=1):
        source_mask = np.asarray(preload["source_mask"], dtype=bool)
        if source_mask.shape != ink.shape:
            raise EnvelopeError("Preloaded source claim dimensions do not match global ink")
        if np.any(source_mask & claimed):
            raise EnvelopeError("Preloaded source claims overlap")
        claimed |= source_mask
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", str(preload["unit_id"]))
        claim_path = (
            temp_root
            / "commits/000000/preloaded-claims"
            / f"{position:06d}-{safe_id}.png"
        )
        save_mask(claim_path, source_mask)
        claimed_units.append(
            {
                "unit_id": preload["unit_id"],
                "at_revision": 0,
                "pixels": int(source_mask.sum()),
                "source_mask": _artifact_ref_for_pending(
                    claim_path,
                    f"commits/000000/preloaded-claims/{position:06d}-{safe_id}.png",
                ),
                "origin": "validated_pass2_approved_candidate_mask",
            }
        )
    # The caller creates this artifact path before entering here, but revision
    # zero is not published until this final exact preloaded union is saved.
    save_mask(global_path, claimed)
    global_ref = _artifact_ref_for_pending(
        global_path, "commits/000000/global-claimed.png"
    )
    # Registration correction provenance belongs to checkpoint state while
    # the immutable run manifest retains the original unit geometry.  Nesting
    # it in the always-present global-claim reference preserves the legacy
    # top-level state contract consumed by the residual auditor.
    global_ref["registration_bbox_overrides"] = {}
    if not run["units"]:
        return {
            "cursor": 0,
            "queue_unit_ids": [],
            "queue_generation": 0,
            "active_model_tier": "terra",
            "unit_turn": 0,
            "requested_context_margin_px": _zero_margins(),
            "current_work_bbox_source_xywh": None,
            "current_local_mask": None,
            "global_claimed_mask": global_ref,
            "claimed_units": claimed_units,
            "deferred_units": [],
            "completed_unit_ids": [],
            "tier_deferred_units": [],
        }
    bounds = _work_bounds(run, run["units"][0], _zero_margins())
    local = _local_unclaimed_mask(ink, claimed, bounds, np.zeros_like(ink, dtype=bool))
    local_path = temp_root / "commits/000000/current-local-mask.png"
    save_mask(local_path, local)
    return {
        "cursor": 0,
        "queue_unit_ids": [unit["unit_id"] for unit in run["units"]],
        "queue_generation": 0,
        "active_model_tier": "terra",
        "unit_turn": 0,
        "requested_context_margin_px": _zero_margins(),
        "current_work_bbox_source_xywh": bounds,
        "current_local_mask": _artifact_ref_for_pending(
            local_path, "commits/000000/current-local-mask.png"
        ),
        "global_claimed_mask": global_ref,
        "claimed_units": claimed_units,
        "deferred_units": [],
        "completed_unit_ids": [],
        "tier_deferred_units": [],
    }


def _make_checkpoint(
    run: Mapping[str, Any],
    *,
    revision: int,
    parent_checkpoint_sha256: str | None,
    parent_ledger_sha256: str | None,
    event_sha256: str | None,
    state: Mapping[str, Any],
) -> dict[str, Any]:
    state_copy = copy.deepcopy(dict(state))
    state_hash = _canonical_hash(state_copy)
    ledger_basis = {
        "run_manifest_sha256": run["run_manifest_sha256"],
        "revision": revision,
        "parent_ledger_sha256": parent_ledger_sha256,
        "event_sha256": event_sha256,
        "state_sha256": state_hash,
    }
    checkpoint: dict[str, Any] = {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "run_id": run["run_id"],
        "revision": revision,
        "parent_checkpoint_sha256": parent_checkpoint_sha256,
        "parent_ledger_sha256": parent_ledger_sha256,
        "event_sha256": event_sha256,
        "state": state_copy,
        "state_sha256": state_hash,
        "ledger_sha256": _canonical_hash(ledger_basis),
    }
    checkpoint["checkpoint_sha256"] = _hash_without(
        checkpoint, "checkpoint_sha256"
    )
    return checkpoint


def _load_head(run_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest_path = run_dir / "run-manifest.json"
    if not manifest_path.is_file():
        raise EnvelopeError(f"Run manifest is missing: {manifest_path}")
    run = _read_json(manifest_path)
    if run.get("schema_version") != RUN_SCHEMA_VERSION:
        raise EnvelopeError("Sequential ownership run schema is unsupported")
    if run.get("run_manifest_sha256") != _hash_without(
        run, "run_manifest_sha256"
    ):
        raise EnvelopeError("Run manifest hash is stale")
    _validate_live_input_bindings(run)

    commits_dir = run_dir / "commits"
    names = sorted(
        path.name
        for path in commits_dir.iterdir()
        if path.is_dir() and re.fullmatch(r"[0-9]{6}", path.name)
    )
    if not names or names[0] != "000000":
        raise EnvelopeError("Run has no revision-zero checkpoint")
    expected = [f"{index:06d}" for index in range(len(names))]
    if names != expected:
        raise EnvelopeError("Committed checkpoint revisions are not contiguous")

    parent_checkpoint = None
    parent_ledger = None
    head: dict[str, Any] | None = None
    for revision, name in enumerate(names):
        commit_dir = commits_dir / name
        checkpoint = _read_json(commit_dir / "checkpoint.json")
        _validate_checkpoint(run_dir, run, checkpoint, revision, parent_checkpoint, parent_ledger)
        if revision:
            event = _read_json(commit_dir / "event.json")
            if event.get("event_sha256") != _hash_without(event, "event_sha256"):
                raise EnvelopeError(f"Event hash is stale at revision {revision}")
            if event["event_sha256"] != checkpoint["event_sha256"]:
                raise EnvelopeError(f"Checkpoint/event hash mismatch at revision {revision}")
        parent_checkpoint = checkpoint["checkpoint_sha256"]
        parent_ledger = checkpoint["ledger_sha256"]
        head = checkpoint
    assert head is not None
    _validate_global_claims(run_dir, head)
    return run, head


def _validate_checkpoint(
    run_dir: Path,
    run: Mapping[str, Any],
    checkpoint: Mapping[str, Any],
    revision: int,
    parent_checkpoint: str | None,
    parent_ledger: str | None,
) -> None:
    if checkpoint.get("schema_version") != CHECKPOINT_SCHEMA_VERSION:
        raise EnvelopeError(f"Checkpoint schema is unsupported at revision {revision}")
    if checkpoint.get("run_id") != run["run_id"] or checkpoint.get("revision") != revision:
        raise EnvelopeError(f"Checkpoint identity mismatch at revision {revision}")
    if checkpoint.get("parent_checkpoint_sha256") != parent_checkpoint:
        raise EnvelopeError(f"Checkpoint parent mismatch at revision {revision}")
    if checkpoint.get("parent_ledger_sha256") != parent_ledger:
        raise EnvelopeError(f"Ledger parent mismatch at revision {revision}")
    if checkpoint.get("state_sha256") != _canonical_hash(checkpoint.get("state")):
        raise EnvelopeError(f"State hash is stale at revision {revision}")
    ledger_basis = {
        "run_manifest_sha256": run["run_manifest_sha256"],
        "revision": revision,
        "parent_ledger_sha256": parent_ledger,
        "event_sha256": checkpoint.get("event_sha256"),
        "state_sha256": checkpoint["state_sha256"],
    }
    if checkpoint.get("ledger_sha256") != _canonical_hash(ledger_basis):
        raise EnvelopeError(f"Ledger hash is stale at revision {revision}")
    if checkpoint.get("checkpoint_sha256") != _hash_without(
        checkpoint, "checkpoint_sha256"
    ):
        raise EnvelopeError(f"Checkpoint hash is stale at revision {revision}")
    state = checkpoint["state"]
    queue = state.get("queue_unit_ids")
    if (
        not isinstance(queue, list)
        or len(queue) != len(set(queue))
        or any(not isinstance(unit_id, str) for unit_id in queue)
        or any(unit_id not in {unit["unit_id"] for unit in run["units"]} for unit_id in queue)
    ):
        raise EnvelopeError(f"Checkpoint queue is invalid at revision {revision}")
    cursor = state.get("cursor")
    if not isinstance(cursor, int) or isinstance(cursor, bool) or not 0 <= cursor <= len(queue):
        raise EnvelopeError(f"Checkpoint cursor is invalid at revision {revision}")
    global_claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    expected_size = tuple(run["input_bindings"]["source"]["size_wh"])
    if global_claimed.shape != (expected_size[1], expected_size[0]):
        raise EnvelopeError("Global claimed mask dimensions do not match source")
    if cursor < len(queue):
        local = _load_artifact_mask(run_dir, state["current_local_mask"])
        bounds = state["current_work_bbox_source_xywh"]
        if local.shape != (bounds[3], bounds[2]):
            raise EnvelopeError("Current local mask dimensions do not match work crop")
    elif state["current_local_mask"] is not None or state["current_work_bbox_source_xywh"] is not None:
        raise EnvelopeError("Complete checkpoint must not retain a current local mask")


def _validate_global_claims(run_dir: Path, checkpoint: Mapping[str, Any]) -> None:
    state = checkpoint["state"]
    global_claimed = _load_artifact_mask(run_dir, state["global_claimed_mask"])
    union = np.zeros_like(global_claimed, dtype=bool)
    seen_units: set[str] = set()
    for claim in state["claimed_units"]:
        if claim["unit_id"] in seen_units:
            raise EnvelopeError(f"Unit {claim['unit_id']} has more than one terminal claim")
        seen_units.add(claim["unit_id"])
        mask = _load_artifact_mask(run_dir, claim["source_mask"])
        if np.any(mask & union):
            raise EnvelopeError("Global unit claim masks overlap")
        union |= mask
    if not np.array_equal(union, global_claimed):
        raise EnvelopeError("Global claimed mask is not the exact disjoint claim union")


def _unit_by_id(run: Mapping[str, Any], unit_id: str) -> dict[str, Any]:
    for unit in run["units"]:
        if unit["unit_id"] == unit_id:
            return unit
    raise EnvelopeError(f"Run queue refers to unknown unit {unit_id}")


def _current_unit(
    run: Mapping[str, Any], state: Mapping[str, Any]
) -> dict[str, Any] | None:
    queue = state["queue_unit_ids"]
    if state["cursor"] >= len(queue):
        return None
    return _unit_by_id(run, queue[state["cursor"]])


def _require_current_unit(
    run: Mapping[str, Any], state: Mapping[str, Any]
) -> dict[str, Any]:
    unit = _current_unit(run, state)
    if unit is None:
        raise EnvelopeError("Current queue is complete")
    return unit


def _validate_live_input_bindings(run: Mapping[str, Any]) -> None:
    for name, binding in run["input_bindings"].items():
        path = Path(binding["path"])
        if not path.is_file() or sha256_file(path) != binding["file_sha256"]:
            raise EnvelopeError(f"Bound input {name} is missing or changed")
    mask_names = ["normalized_global_ink_mask"]
    if "clean_reference_ink_mask" in run["input_bindings"]:
        mask_names.append("clean_reference_ink_mask")
    for name in mask_names:
        mask_binding = run["input_bindings"][name]
        mask = _load_normalized_mask(
            Path(mask_binding["path"]), tuple(mask_binding["size_wh"])
        )
        if sha256_mask_pixels(mask) != mask_binding["pixel_sha256"]:
            raise EnvelopeError(f"Bound {name} pixels changed")


def _validate_cached_packet(
    packet: Mapping[str, Any], packet_dir: Path, run_dir: Path, checkpoint: Mapping[str, Any]
) -> None:
    if packet.get("schema_version") != WORK_PACKET_SCHEMA_VERSION:
        raise EnvelopeError("Cached work packet schema is unsupported")
    claimed = packet["compact_action_contract"].get("work_packet_sha256")
    if packet.get("work_packet_sha256") != _work_packet_hash(packet):
        raise EnvelopeError("Cached work packet hash is stale")
    if claimed != packet["work_packet_sha256"]:
        raise EnvelopeError("Cached compact-action packet binding is stale")
    if packet.get("checkpoint_sha256") != checkpoint["checkpoint_sha256"]:
        raise EnvelopeError("Cached work packet is stale for the checkpoint")
    for evidence in packet["evidence"].values():
        path = run_dir / evidence["path"]
        if not path.is_file() or sha256_file(path) != evidence["file_sha256"]:
            raise EnvelopeError("Cached work-packet evidence is missing or changed")


def _validate_compact_action_envelope(
    value: Mapping[str, Any], packet: Mapping[str, Any]
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EnvelopeError("Compact action must be an object")
    expected = {"schema_version", "work_packet_sha256", "action"}
    if set(value) != expected:
        raise EnvelopeError(
            f"Compact action has invalid fields; missing={sorted(expected - set(value))}, "
            f"extra={sorted(set(value) - expected)}"
        )
    if value["schema_version"] != COMPACT_ACTION_SCHEMA_VERSION:
        raise EnvelopeError("Compact action schema is unsupported")
    if value["work_packet_sha256"] != packet["work_packet_sha256"]:
        raise EnvelopeError("Compact action is stale for the current work packet")
    if not isinstance(value["action"], Mapping):
        raise EnvelopeError("Compact action.action must be an object")
    action_type = value["action"].get("type")
    legal_types = {item["type"] for item in packet["legal_actions"]}
    if action_type not in legal_types:
        raise EnvelopeError(
            f"Action type {action_type!r} is not legal for the current packet"
        )
    return copy.deepcopy(dict(value["action"]))


def _validate_reopen_bbox_action(
    action: Mapping[str, Any],
    run: Mapping[str, Any],
    checkpoint: Mapping[str, Any],
    packet: Mapping[str, Any],
) -> None:
    expected = {"type", "bbox_source_xywh", "confidence", "reason_codes"}
    if set(action) != expected:
        raise EnvelopeError(
            "reopen_bbox must contain exactly type, bbox_source_xywh, confidence, "
            "and reason_codes"
        )
    if packet["current"]["active_model_tier"] not in {"terra", "sol"}:
        raise EnvelopeError("reopen_bbox is legal only for active Terra or Sol")
    if action["confidence"] not in {"high", "medium", "low"}:
        raise EnvelopeError("reopen_bbox confidence is unsupported")
    reasons = action["reason_codes"]
    if (
        not isinstance(reasons, list)
        or not reasons
        or len(reasons) != len(set(reasons))
        or any(reason not in _REGISTRATION_REASON_CODES for reason in reasons)
    ):
        raise EnvelopeError(
            "reopen_bbox reason_codes must be a nonempty unique subset of "
            f"{sorted(_REGISTRATION_REASON_CODES)}"
        )

    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    bbox = _bbox(action["bbox_source_xywh"])
    x, y, width, height = bbox
    if x + width > source_width or y + height > source_height:
        raise EnvelopeError("reopen_bbox bbox lies outside the bound source")
    state = checkpoint["state"]
    unit = _require_current_unit(run, state)
    active = _effective_bbox(unit, state)
    delta = max(abs(before - after) for before, after in zip(active, bbox))
    material_threshold = max(2, round(min(active[2], active[3]) * 0.05))
    if delta < material_threshold:
        raise EnvelopeError("reopen_bbox is a no-op or not materially different")

    old_center = (active[0] + active[2] / 2, active[1] + active[3] / 2)
    new_center = (x + width / 2, y + height / 2)
    center_move = max(
        abs(old_center[0] - new_center[0]),
        abs(old_center[1] - new_center[1]),
    )
    requested = state["requested_context_margin_px"]
    move_limit = (
        run["policy"]["context_padding_px"]
        + max(active[2], active[3], width, height)
        + max(requested.values())
    )
    if center_move > move_limit:
        raise EnvelopeError(
            "reopen_bbox exceeds bounded registration move policy; request expanded "
            "context first"
        )
    ink = _load_input_mask(run, "normalized_global_ink_mask")
    if not ink[y : y + height, x : x + width].any():
        raise EnvelopeError("reopen_bbox bbox intersects zero normalized ink")


def _effective_bbox(
    unit: Mapping[str, Any], state: Mapping[str, Any]
) -> list[int]:
    override = _bbox_overrides(state).get(unit["unit_id"])
    if override is None:
        return list(unit["bbox_source_xywh"])
    return list(override["active_bbox_source_xywh"])


def _bbox_overrides(state: Mapping[str, Any]) -> Mapping[str, Any]:
    global_ref = state.get("global_claimed_mask", {})
    overrides = global_ref.get("registration_bbox_overrides", {})
    if not isinstance(overrides, Mapping):
        raise EnvelopeError("Checkpoint registration bbox overrides are invalid")
    return overrides


def _original_target_claimants(
    run_dir: Path,
    state: Mapping[str, Any],
    original_bbox: Sequence[int],
) -> list[dict[str, Any]]:
    x, y, width, height = original_bbox
    result: list[dict[str, Any]] = []
    for claim in state["claimed_units"]:
        mask = _load_artifact_mask(run_dir, claim["source_mask"])
        overlap = mask[y : y + height, x : x + width]
        pixels = int(overlap.sum())
        if pixels == 0:
            continue
        ys, xs = np.nonzero(mask)
        claim_bbox = [
            int(xs.min()),
            int(ys.min()),
            int(xs.max() - xs.min() + 1),
            int(ys.max() - ys.min() + 1),
        ]
        result.append(
            {
                "claimant_unit_id": claim["unit_id"],
                "claim_at_revision": claim["at_revision"],
                "claimed_source_bbox_xywh": claim_bbox,
                "overlap_pixels_in_original_target": pixels,
            }
        )
    return result


def _work_bounds(
    run: Mapping[str, Any],
    unit: Mapping[str, Any],
    margins: Mapping[str, int],
    *,
    state: Mapping[str, Any] | None = None,
    bbox_overrides: Mapping[str, Any] | None = None,
) -> list[int]:
    if bbox_overrides is not None:
        override = bbox_overrides.get(unit["unit_id"])
        bbox = (
            list(override["active_bbox_source_xywh"])
            if override is not None
            else list(unit["bbox_source_xywh"])
        )
    elif state is not None:
        bbox = _effective_bbox(unit, state)
    else:
        bbox = list(unit["bbox_source_xywh"])
    x, y, width, height = bbox
    base = run["policy"]["work_padding_px"]
    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    left = max(0, x - base - margins["left"])
    top = max(0, y - base - margins["top"])
    right = min(source_width, x + width + base + margins["right"])
    bottom = min(source_height, y + height + base + margins["bottom"])
    return [left, top, right - left, bottom - top]


def _context_bounds(
    run: Mapping[str, Any], unit: Mapping[str, Any], work_bounds: Sequence[int]
) -> list[int]:
    wx, wy, ww, wh = work_bounds
    extra = run["policy"]["context_padding_px"]
    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    left = max(0, wx - extra)
    top = max(0, wy - extra)
    right = min(source_width, wx + ww + extra)
    bottom = min(source_height, wy + wh + extra)
    return [left, top, right - left, bottom - top]


def _local_unclaimed_mask(
    ink: np.ndarray,
    global_claimed: np.ndarray,
    bounds: Sequence[int],
    suppression: np.ndarray,
) -> np.ndarray:
    x, y, width, height = bounds
    return (
        ink[y : y + height, x : x + width]
        & ~global_claimed[y : y + height, x : x + width]
        & ~suppression[y : y + height, x : x + width]
    )


def _current_suppression(
    ink: np.ndarray,
    global_claimed: np.ndarray,
    local: np.ndarray,
    bounds: Sequence[int],
) -> np.ndarray:
    x, y, width, height = bounds
    base = ink[y : y + height, x : x + width] & ~global_claimed[
        y : y + height, x : x + width
    ]
    suppression = np.zeros_like(ink, dtype=bool)
    suppression[y : y + height, x : x + width] = base & ~local
    return suppression


def _map_local_to_source(
    local: np.ndarray, bounds: Sequence[int], source_shape: tuple[int, int]
) -> np.ndarray:
    x, y, width, height = bounds
    if local.shape != (height, width):
        raise EnvelopeError("Local claim dimensions do not match source mapping")
    source = np.zeros(source_shape, dtype=bool)
    source[y : y + height, x : x + width] = local
    return source


def _load_input_mask(run: Mapping[str, Any], name: str) -> np.ndarray:
    binding = run["input_bindings"][name]
    return _load_normalized_mask(Path(binding["path"]), tuple(binding["size_wh"]))


def _load_normalized_mask(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as image:
        grayscale = np.asarray(image.convert("L"), dtype=np.uint8)
    if grayscale.shape != (size_wh[1], size_wh[0]):
        raise EnvelopeError("Normalized global ink mask dimensions do not match source")
    values = set(int(value) for value in np.unique(grayscale))
    if not values.issubset({0, 255}):
        raise EnvelopeError("Normalized global ink mask must contain only 0 and 255")
    return grayscale > 0


def _load_artifact_mask(run_dir: Path, reference: Mapping[str, Any]) -> np.ndarray:
    path = run_dir / reference["path"]
    if not path.is_file() or sha256_file(path) != reference["file_sha256"]:
        raise EnvelopeError(f"Checkpoint mask artifact is missing or changed: {path}")
    with Image.open(path) as image:
        values = np.asarray(image.convert("L"), dtype=np.uint8)
    mask = values > 0
    if sha256_mask_pixels(mask) != reference["pixel_sha256"]:
        raise EnvelopeError(f"Checkpoint mask pixel hash is stale: {path}")
    return mask


def _artifact_ref_for_pending(path: Path, final_relative_path: str) -> dict[str, Any]:
    with Image.open(path) as image:
        mask = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    return {
        "path": final_relative_path,
        "file_sha256": sha256_file(path),
        "pixel_sha256": sha256_mask_pixels(mask),
        "size_wh": list(mask.shape[::-1]),
    }


def _red_overlay(image: Image.Image, mask: np.ndarray) -> Image.Image:
    array = np.asarray(image.convert("RGB"), dtype=np.uint8).copy()
    if mask.shape != array.shape[:2]:
        raise EnvelopeError("Red overlay mask dimensions do not match image")
    array[mask] = (
        (array[mask].astype(np.uint16) * 35 + _RED.astype(np.uint16) * 65) // 100
    ).astype(np.uint8)
    return Image.fromarray(array, mode="RGB")


def _image_pixel_sha256(image: Image.Image) -> str:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    digest = hashlib.sha256()
    digest.update(f"RGB8:{rgb.shape[1]}:{rgb.shape[0]}:row-major-v1\n".encode())
    digest.update(rgb.tobytes(order="C"))
    return digest.hexdigest()


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _run_id(bound: Mapping[str, Any]) -> str:
    basis = {
        "page_id": bound["decision"]["page_id"],
        "decision_file_sha256": sha256_file(bound["decision_path"]),
        "knockout_manifest_file_sha256": sha256_file(bound["knockout_manifest_path"]),
        "packet_file_sha256": sha256_file(bound["packet_path"]),
        "clean_ink_pixel_sha256": bound["clean_ink_pixel_sha256"],
        "claim_universe_pixel_sha256": bound["ink_pixel_sha256"],
        "diagnostic_unit_subset": bound.get("unit_subset_ids"),
    }
    return f"{basis['page_id']}--{_canonical_hash(basis)[:16]}"


def _input_file_binding(path: Path) -> dict[str, Any]:
    return {"path": str(path.resolve()), "file_sha256": sha256_file(path)}


def _resolve_input_path(packet_path: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise EnvelopeError("Public packet source path is invalid")
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate.resolve()
    root = Path(__file__).resolve().parents[2]
    root_candidate = (root / candidate).resolve()
    if root_candidate.exists():
        return root_candidate
    return (packet_path.parent / candidate).resolve()


def _publish_directory(source: Path, destination: Path) -> None:
    """Publish a prepared directory without replacing an existing destination."""

    if destination.exists() or destination.is_symlink():
        raise EnvelopeError(f"Refusing to overwrite published directory: {destination}")
    os.rename(source, destination)


def _write_json_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json_bytes(value)
    try:
        with path.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as error:
        raise EnvelopeError(f"Refusing to overwrite append-only file: {path}") from error


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EnvelopeError(f"Cannot read valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise EnvelopeError(f"Expected JSON object: {path}")
    return value


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    return _canonical_hash(basis)


def _legacy_hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop(field, None)
    payload = json.dumps(
        basis, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _work_packet_hash(value: Mapping[str, Any]) -> str:
    basis = copy.deepcopy(dict(value))
    basis.pop("work_packet_sha256", None)
    basis["compact_action_contract"]["work_packet_sha256"] = None
    return _canonical_hash(basis)


def _bbox(value: Any) -> tuple[int, int, int, int]:
    if (
        not isinstance(value, list)
        or len(value) != 4
        or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
    ):
        raise EnvelopeError("bbox_source_xywh must contain four integers")
    x, y, width, height = value
    if x < 0 or y < 0 or width < 1 or height < 1:
        raise EnvelopeError("bbox_source_xywh must have nonnegative origin and positive size")
    return x, y, width, height


def _zero_margins() -> dict[str, int]:
    return {"left": 0, "right": 0, "top": 0, "bottom": 0}


def _positive_padding(value: Any, name: str) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 2048:
        raise EnvelopeError(f"{name} must be an integer from 0 to 2048")


def _json_stdout(value: Any) -> None:
    print(canonical_json_bytes(value).decode("utf-8"), end="")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic sequential full-page ownership supervisor"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--pass1-decision", type=Path, required=True)
    init_parser.add_argument("--knockout-manifest", type=Path, required=True)
    init_parser.add_argument("--public-packet", type=Path, required=True)
    init_parser.add_argument("--run-dir", type=Path, required=True)
    init_parser.add_argument("--work-padding-px", type=int)
    init_parser.add_argument("--context-padding-px", type=int)
    init_parser.add_argument("--pass2-decision", type=Path)
    init_parser.add_argument("--residual-region-manifest", type=Path)
    init_parser.add_argument("--clean-ink-mask", type=Path)
    init_parser.add_argument("--high-recall-ink-mask", type=Path)
    init_parser.add_argument("--unit-id", action="append")

    for command in ("next", "status"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--run-dir", type=Path, required=True)
    requeue_parser = subparsers.add_parser("requeue-tier")
    requeue_parser.add_argument("--run-dir", type=Path, required=True)
    requeue_parser.add_argument("--target", choices=["sol"], required=True)
    review_parser = subparsers.add_parser("requeue-review")
    review_parser.add_argument("--run-dir", type=Path, required=True)
    review_parser.add_argument("--target", choices=["sol"], required=True)
    review_parser.add_argument("--unit-id", action="append", required=True)
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--run-dir", type=Path, required=True)
    action_group = apply_parser.add_mutually_exclusive_group(required=True)
    action_group.add_argument("--action", help="compact packet-bound JSON object")
    action_group.add_argument("--action-file", type=Path)

    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            result = init_run(
                pass1_decision_path=args.pass1_decision,
                knockout_manifest_path=args.knockout_manifest,
                public_packet_path=args.public_packet,
                run_dir=args.run_dir,
                work_padding_px=args.work_padding_px,
                context_padding_px=args.context_padding_px,
                pass2_decision_path=args.pass2_decision,
                residual_region_manifest_path=args.residual_region_manifest,
                clean_ink_mask_path=args.clean_ink_mask,
                high_recall_ink_mask_path=args.high_recall_ink_mask,
                unit_ids=args.unit_id,
            )
        elif args.command == "next":
            result = next_packet(args.run_dir)
        elif args.command == "status":
            result = status(args.run_dir)
        elif args.command == "requeue-tier":
            result = requeue_tier(args.run_dir, target=args.target)
        elif args.command == "requeue-review":
            result = requeue_review(
                args.run_dir, target=args.target, unit_ids=args.unit_id
            )
        else:
            raw = args.action if args.action is not None else args.action_file.read_text(encoding="utf-8")
            try:
                compact = json.loads(raw)
            except json.JSONDecodeError as error:
                raise EnvelopeError("Action is not valid JSON") from error
            result = apply_compact_action(args.run_dir, compact)
    except (EnvelopeError, OSError, ValueError) as error:
        parser.exit(2, f"error: {error}\n")
    _json_stdout(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
