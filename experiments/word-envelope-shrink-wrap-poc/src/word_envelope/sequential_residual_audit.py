"""Deterministic, append-only audit of the *fresh* ownership residual.

This is deliberately separate from :mod:`sequential_ownership`: it treats an
ownership run as immutable evidence, validates its complete hash chain, and
then derives ``ink & ~claimed`` itself.  In particular it never consumes the
older pass-2 candidate-residual artifacts that may have informed ownership.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .engine import EnvelopeError
from .io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from .masks import save_mask, stable_components


RUN_SCHEMA_VERSION = "sequential-fresh-residual-audit-run.v1"
CHECKPOINT_SCHEMA_VERSION = "sequential-fresh-residual-audit-checkpoint.v1"
EVENT_SCHEMA_VERSION = "sequential-fresh-residual-audit-event.v1"
PACKET_SCHEMA_VERSION = "sequential-fresh-residual-audit-packet.v1"
ACTION_SCHEMA_VERSION = "sequential-fresh-residual-audit-action.v1"
_OWNER_RUN_SCHEMA = "sequential-full-page-ownership-run.v1"
_OWNER_CHECKPOINT_SCHEMA = "sequential-full-page-ownership-checkpoint.v1"
_OWNER_EVENT_SCHEMA = "sequential-full-page-ownership-event.v1"
_OWNER_COMPACT_ACTION_SCHEMA = "sequential-full-page-ownership-compact-action.v1"
_OWNER_REGISTRATION_REASON_CODES = {
    "wrong_line_registration", "clipped_target", "duplicate_geometry",
    "visible_word_outside_target",
}
_OWNER_REVIEW_ELIGIBLE_MANUAL_DISPOSITIONS = {
    "ambiguous_ownership", "touching_or_overwritten_ink", "unsafe_cut",
}
_OWNER_REVIEW_CONVERSION_REASON = "eligible_manual_review_upgraded_to_sol"
_COMPONENT_ACTIONS = {
    "attach_existing_unit", "new_missing_word", "punctuation_or_nonword",
    "noise_or_fold", "defer_human",
}
_NEW_WORD_ROUTES = {"human_or_model_followup"}
_STATE_FIELDS = {
    "cursor", "terminal_region_ids", "component_dispositions", "new_word_ids",
    "audit_claimed_supplement_mask",
}


def _policy() -> dict[str, Any]:
    return {
        "fresh_residual_equation": "normalized_global_ink_mask & ~ownership_global_claimed",
        "connectivity": 8,
        "context_padding_policy": "6_percent_of_source_long_edge; approximately_240px_on_3000x4000_007",
        "claimed_supplement_policy": "only attach_existing_unit and new_missing_word add exact component pixels",
        "directed_line_hints": "hints_only_never_semantic_truth",
        "new_missing_word_routes": sorted(_NEW_WORD_ROUTES),
        "attach_distance_policy": "max(8px,75_percent_of_target_unit_height)",
    }


def init_run(*, ownership_run: Path, audit_dir: Path) -> dict[str, Any]:
    """Freeze a validated ownership head and initialize an empty supplement.

    ``audit_dir`` is published only after every artifact and checkpoint has
    been written.  Machine ownership must be complete; terminal human
    deferrals remain explicit production blockers.
    """
    ownership_run, audit_dir = Path(ownership_run).resolve(), Path(audit_dir).resolve()
    if audit_dir.exists() or audit_dir.is_symlink():
        raise EnvelopeError(f"Audit directory already exists; refusing overwrite: {audit_dir}")
    owner, owner_head = _validate_ownership_run(ownership_run)
    owner_state = owner_head["state"]
    if owner_state["cursor"] != len(owner_state["queue_unit_ids"]):
        raise EnvelopeError("Ownership machine queue is unfinished; residual audit cannot start")
    if owner_state.get("tier_deferred_units"):
        raise EnvelopeError("Ownership has unresolved tier-deferred units; residual audit cannot start")
    ink = _load_normalized_mask(Path(owner["input_bindings"]["normalized_global_ink_mask"]["path"]),
                                tuple(owner["input_bindings"]["source"]["size_wh"]))
    claimed = _load_ref_mask(ownership_run, owner_head["state"]["global_claimed_mask"])
    if claimed.shape != ink.shape or np.any(claimed & ~ink):
        raise EnvelopeError("Ownership global claim is not a subset of bound global ink")
    fresh = ink & ~claimed
    _, components = stable_components(fresh)
    # Components are immutable IDs for this audit.  No later classification is
    # allowed to remove a pixel from this inventory.
    for component in components:
        component.pop("raw_label", None)
    lines = _line_geometry(owner["units"])
    regions = _derive_regions(components, lines, fresh.shape)
    _assert_region_partition(regions, components)
    basis: dict[str, Any] = {
        "schema_version": RUN_SCHEMA_VERSION,
        "audit_id": _hash({"ownership_run": str(ownership_run), "head": owner_head["checkpoint_sha256"]})[:24],
        "page_id": owner["page_id"],
        "ownership_binding": {
            "run_dir": str(ownership_run),
            "run_manifest_file_sha256": sha256_file(ownership_run / "run-manifest.json"),
            "run_manifest_sha256": owner["run_manifest_sha256"],
            "head_revision": owner_head["revision"],
            "head_checkpoint_sha256": owner_head["checkpoint_sha256"],
            "head_ledger_sha256": owner_head["ledger_sha256"],
            "human_blockers": [
                f"manual_ownership:{item['unit_id']}:{item['disposition']}"
                for item in owner_state.get("deferred_units", [])
            ],
        },
        "input_bindings": copy.deepcopy(owner["input_bindings"]),
        "policy": _policy(),
        "ownership_units": owner["units"],
        "lines": lines,
        "components": components,
        "regions": regions,
    }
    audit_dir.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=f".{audit_dir.name}.init-", dir=audit_dir.parent))
    try:
        (temp / "commits" / "000000").mkdir(parents=True)
        (temp / "packets").mkdir()
        (temp / "transactions").mkdir()
        save_mask(temp / "commits/000000/fresh-residual-input.png", fresh)
        basis["fresh_residual_input_mask"] = _pending_ref(
            temp / "commits/000000/fresh-residual-input.png",
            "commits/000000/fresh-residual-input.png",
        )
        basis["run_manifest_sha256"] = _hash_without(basis, "run_manifest_sha256")
        _write_json_new(temp / "run-manifest.json", basis)
        supplement = np.zeros_like(fresh, dtype=bool)
        save_mask(temp / "commits/000000/audit-claimed-supplement.png", supplement)
        state = {
            "cursor": 0,
            "terminal_region_ids": [],
            "component_dispositions": [],
            "new_word_ids": [],
            "audit_claimed_supplement_mask": _pending_ref(temp / "commits/000000/audit-claimed-supplement.png",
                                                           "commits/000000/audit-claimed-supplement.png"),
        }
        checkpoint = _make_checkpoint(basis, 0, None, None, None, state)
        _write_json_new(temp / "commits/000000/checkpoint.json", checkpoint)
        # Narrow the initialization race: never publish work built from a head
        # that changed while the immutable audit basis was being assembled.
        _, current_owner_head = _validate_ownership_run(ownership_run)
        if (current_owner_head["checkpoint_sha256"] != owner_head["checkpoint_sha256"] or
                current_owner_head["ledger_sha256"] != owner_head["ledger_sha256"]):
            raise EnvelopeError("Ownership head changed during residual audit initialization")
        _publish(temp, audit_dir)
    except BaseException:
        shutil.rmtree(temp, ignore_errors=True)
        raise
    return status(audit_dir)


def next_packet(audit_dir: Path) -> dict[str, Any]:
    """Return the one software-selected current region, byte-stably."""
    audit_dir = Path(audit_dir).resolve()
    run, checkpoint = _load_head(audit_dir)
    region = _current_region(run, checkpoint["state"])
    if region is None:
        raise EnvelopeError("Machine residual audit is complete; no next packet exists")
    name = f"r{checkpoint['revision']:06d}-{region['region_id']}"
    final = audit_dir / "packets" / name
    if final.exists():
        packet = _read_json(final / "packet.json")
        _validate_packet(packet, final, audit_dir, checkpoint, run, checkpoint["state"])
        return packet
    transaction = Path(tempfile.mkdtemp(prefix=f"packet-{name}-", dir=audit_dir / "transactions"))
    try:
        packet = _build_packet(audit_dir, run, checkpoint, region, transaction)
        _write_json_new(transaction / "packet.json", packet)
        _publish(transaction, final)
    except BaseException:
        shutil.rmtree(transaction, ignore_errors=True)
        raise
    return packet


def apply_action(audit_dir: Path, action_envelope: Mapping[str, Any]) -> dict[str, Any]:
    """Atomically append one packet-bound, complete region disposition."""
    audit_dir = Path(audit_dir).resolve()
    run, checkpoint = _load_head(audit_dir)
    packet = next_packet(audit_dir)
    dispositions = _validate_action(action_envelope, packet, run, checkpoint["state"])
    state = checkpoint["state"]
    region = _require_current_region(run, state)
    residual = _load_ref_mask(audit_dir, run["fresh_residual_input_mask"])
    supplement = _load_ref_mask(audit_dir, state["audit_claimed_supplement_mask"])
    if np.any(supplement & ~residual):
        raise EnvelopeError("Audit claimed supplement escapes its immutable input residual")
    selected = np.zeros_like(residual, dtype=bool)
    for disposition in dispositions:
        if disposition["type"] in {"attach_existing_unit", "new_missing_word"}:
            for component_id in disposition["component_ids"]:
                selected |= _component_mask(component_id, residual)
    if np.any(selected & supplement):
        raise EnvelopeError("Audit claimed supplement overlaps a prior supplement claim")
    new_supplement = supplement | selected
    revision = checkpoint["revision"] + 1
    final = audit_dir / "commits" / f"{revision:06d}"
    if final.exists():
        raise EnvelopeError("Next audit revision already exists; refusing overwrite")
    transaction = Path(tempfile.mkdtemp(prefix=f"commit-{revision:06d}-", dir=audit_dir / "transactions"))
    try:
        save_mask(transaction / "audit-claimed-supplement.png", new_supplement)
        new_ref = _pending_ref(transaction / "audit-claimed-supplement.png",
                               f"commits/{revision:06d}/audit-claimed-supplement.png")
        event: dict[str, Any] = {
            "schema_version": EVENT_SCHEMA_VERSION,
            "audit_id": run["audit_id"], "revision": revision,
            "base_checkpoint_sha256": checkpoint["checkpoint_sha256"],
            "packet_sha256": packet["packet_sha256"], "region_id": region["region_id"],
            "dispositions": copy.deepcopy(dispositions),
            "supplement_before_pixel_sha256": sha256_mask_pixels(supplement),
            "supplement_after_pixel_sha256": sha256_mask_pixels(new_supplement),
            "new_claimed_pixels": int(selected.sum()),
        }
        event["event_sha256"] = _hash_without(event, "event_sha256")
        _write_json_new(transaction / "event.json", event)
        child_state = {
            "cursor": state["cursor"] + 1,
            "terminal_region_ids": state["terminal_region_ids"] + [region["region_id"]],
            "component_dispositions": state["component_dispositions"] + copy.deepcopy(dispositions),
            "new_word_ids": state["new_word_ids"] + [d["new_word_id"] for d in dispositions if d["type"] == "new_missing_word"],
            "audit_claimed_supplement_mask": new_ref,
        }
        child = _make_checkpoint(run, revision, checkpoint["checkpoint_sha256"],
                                 checkpoint["ledger_sha256"], event["event_sha256"], child_state)
        _write_json_new(transaction / "checkpoint.json", child)
        _publish(transaction, final)
    except BaseException:
        shutil.rmtree(transaction, ignore_errors=True)
        raise
    return status(audit_dir)


def status(audit_dir: Path) -> dict[str, Any]:
    run, checkpoint = _load_head(Path(audit_dir).resolve())
    state = checkpoint["state"]
    complete = state["cursor"] == len(run["regions"])
    human = [d for d in state["component_dispositions"] if d["type"] == "defer_human"]
    return {
        "schema_version": "sequential-fresh-residual-audit-status.v1",
        "audit_id": run["audit_id"], "page_id": run["page_id"],
        "revision": checkpoint["revision"], "checkpoint_sha256": checkpoint["checkpoint_sha256"],
        "machine_status": "complete" if complete else "in_progress",
        "production_status": ("not_ready_machine_work_remaining" if not complete else
                              "blocked_human_review" if (human or run["ownership_binding"]["human_blockers"]) else "ready"),
        "production_blockers": list(run["ownership_binding"]["human_blockers"]) + [f"human_residual:{d['component_ids']}" for d in human],
        "current": None if complete else _current_region(run, state)["region_id"],
        "progress": _progress(run, state),
        "fresh_residual_pixel_sha256": run["fresh_residual_input_mask"]["pixel_sha256"],
        "audit_claimed_supplement_pixel_sha256": state["audit_claimed_supplement_mask"]["pixel_sha256"],
    }


def _progress(run: Mapping[str, Any], state: Mapping[str, Any]) -> dict[str, int]:
    component_by_id = {component["id"]: component for component in run["components"]}
    human = [item for item in state["component_dispositions"] if item["type"] == "defer_human"]
    return {
        "terminal_regions": state["cursor"], "total_regions": len(run["regions"]),
        "terminal_components": sum(len(item["component_ids"])
                                   for item in state["component_dispositions"]),
        "total_components": len(run["components"]),
        "terminal_component_pixels": sum(
            component_by_id[component_id]["area_px"]
            for item in state["component_dispositions"] for component_id in item["component_ids"]),
        "total_component_pixels": sum(item["area_px"] for item in run["components"]),
        "human_deferred_components": sum(len(item["component_ids"]) for item in human),
    }


def _build_packet(audit_dir: Path, run: Mapping[str, Any], checkpoint: Mapping[str, Any],
                  region: Mapping[str, Any], output: Path) -> dict[str, Any]:
    residual = _load_ref_mask(audit_dir, run["fresh_residual_input_mask"])
    ink = _load_normalized_mask(Path(run["input_bindings"]["normalized_global_ink_mask"]["path"]),
                                tuple(run["input_bindings"]["source"]["size_wh"]))
    owner_claimed = ink & ~residual
    component_by_id = {item["id"]: item for item in run["components"]}
    components = [copy.deepcopy(component_by_id[i]) for i in region["component_ids"]]
    bounds = _context_bounds(components, residual.shape)
    evidence = _render_evidence(Path(run["input_bindings"]["source"]["path"]), residual,
                                owner_claimed, components, bounds, output)
    hints = [_component_hint(component, run["ownership_units"], run["lines"]) for component in components]
    packet: dict[str, Any] = {
        "schema_version": PACKET_SCHEMA_VERSION, "audit_id": run["audit_id"],
        "checkpoint_sha256": checkpoint["checkpoint_sha256"], "region": copy.deepcopy(dict(region)),
        "components": components, "component_hints": hints,
        "source_context": {"bbox_source_xywh": bounds, "context_padding_policy": run["policy"]["context_padding_policy"]},
        "evidence": evidence,
        "progress": _progress(run, checkpoint["state"]),
        "legal_actions": {
            "packet_bound_envelope": {"schema_version": ACTION_SCHEMA_VERSION, "packet_sha256": None, "dispositions": "one complete disposition per current component"},
            "types": sorted(_COMPONENT_ACTIONS),
            "requirements": {
                "attach_existing_unit": ["component_ids", "unit_id (known ownership unit)"],
                "new_missing_word": ["component_ids", "new_word_id", "bbox_source_xywh", "text_guess", "route"],
                "punctuation_or_nonword": ["component_ids"], "noise_or_fold": ["component_ids"],
                "defer_human": ["component_ids", "reason"],
            },
        },
        "directed_line_hints_are_not_semantic_truth": True,
    }
    packet["packet_sha256"] = _packet_hash(packet)
    packet["legal_actions"]["packet_bound_envelope"]["packet_sha256"] = packet["packet_sha256"]
    return packet


def _validate_action(value: Mapping[str, Any], packet: Mapping[str, Any], run: Mapping[str, Any],
                     state: Mapping[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, Mapping) or set(value) != {"schema_version", "packet_sha256", "dispositions"}:
        raise EnvelopeError("Action must contain exactly schema_version, packet_sha256, and dispositions")
    if value["schema_version"] != ACTION_SCHEMA_VERSION or value["packet_sha256"] != packet["packet_sha256"]:
        raise EnvelopeError("Action is stale for the current audit packet")
    dispositions = value["dispositions"]
    if not isinstance(dispositions, list) or not dispositions:
        raise EnvelopeError("Action dispositions must be a non-empty list")
    expected = set(packet["region"]["component_ids"])
    seen: set[int] = set()
    known_units = {u["unit_id"] for u in run["ownership_units"]}
    prior_new = set(state["new_word_ids"])
    normalized: list[dict[str, Any]] = []
    for raw in dispositions:
        if not isinstance(raw, Mapping) or raw.get("type") not in _COMPONENT_ACTIONS:
            raise EnvelopeError("Every disposition must have a legal type")
        item = copy.deepcopy(dict(raw)); kind = item["type"]
        ids = item.get("component_ids")
        if not isinstance(ids, list) or not ids or any(not isinstance(i, int) or isinstance(i, bool) for i in ids):
            raise EnvelopeError("Every disposition must list one or more integer component_ids")
        if len(ids) != len(set(ids)) or any(i not in expected for i in ids) or seen.intersection(ids):
            raise EnvelopeError("Component IDs must be current, known, and assigned exactly once")
        seen.update(ids)
        allowed = {"type", "component_ids"}
        if kind == "attach_existing_unit":
            allowed |= {"unit_id"}
            unit_id = item.get("unit_id")
            if unit_id not in known_units: raise EnvelopeError("attach_existing_unit needs a known unit_id")
            unit = next(unit for unit in run["ownership_units"] if unit["unit_id"] == unit_id)
            threshold = max(8, round(unit["bbox_source_xywh"][3] * .75))
            if any(_bbox_distance(_component_by_id(run, component_id)["bbox"],
                                  _box_dict(unit["bbox_source_xywh"])) > threshold
                   for component_id in ids):
                raise EnvelopeError("attach_existing_unit component is too far from the target unit")
        elif kind == "new_missing_word":
            allowed |= {"new_word_id", "bbox_source_xywh", "text_guess", "route"}
            word_id = item.get("new_word_id")
            if (not isinstance(word_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", word_id)
                    or word_id in prior_new):
                raise EnvelopeError("new_missing_word needs an unused stable new_word_id")
            prior_new.add(word_id)
            _valid_bbox(item.get("bbox_source_xywh"), tuple(run["input_bindings"]["source"]["size_wh"]))
            word_box = _box_dict(item["bbox_source_xywh"])
            if any(not _bbox_contains(word_box, _component_by_id(run, component_id)["bbox"])
                   for component_id in ids):
                raise EnvelopeError("new_missing_word bbox must cover every claimed component")
            if (not isinstance(item.get("text_guess"), str) or
                    item.get("route") not in _NEW_WORD_ROUTES):
                raise EnvelopeError("new_missing_word needs text_guess and route")
        elif kind == "defer_human":
            allowed |= {"reason"}
            if not isinstance(item.get("reason"), str) or not item["reason"]: raise EnvelopeError("defer_human needs a reason")
        if set(item) != allowed:
            raise EnvelopeError(f"Disposition {kind} has missing or extra fields")
        normalized.append(item)
    if seen != expected:
        raise EnvelopeError("Every current component requires exactly one disposition")
    return normalized


def _load_head(audit_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    run = _read_json(audit_dir / "run-manifest.json")
    if run.get("schema_version") != RUN_SCHEMA_VERSION or run.get("run_manifest_sha256") != _hash_without(run, "run_manifest_sha256"):
        raise EnvelopeError("Residual audit manifest is unsupported or hash-stale")
    owner_path = Path(run["ownership_binding"]["run_dir"])
    owner, head = _validate_ownership_run(owner_path)
    binding = run["ownership_binding"]
    if (sha256_file(owner_path / "run-manifest.json") != binding["run_manifest_file_sha256"] or
        owner["run_manifest_sha256"] != binding["run_manifest_sha256"] or
        head["checkpoint_sha256"] != binding["head_checkpoint_sha256"] or
        head["ledger_sha256"] != binding["head_ledger_sha256"] or
        head["revision"] != binding["head_revision"]):
        raise EnvelopeError("Bound ownership run has advanced or changed")
    if _hash(copy.deepcopy(owner["input_bindings"])) != _hash(copy.deepcopy(run["input_bindings"])):
        raise EnvelopeError("Audit input bindings diverge from ownership run")
    fresh_artifact = _load_ref_mask(audit_dir, run["fresh_residual_input_mask"])
    if not np.array_equal(fresh_artifact, _fresh_residual_from_validated_owner(run, owner, head)):
        raise EnvelopeError("Frozen fresh residual artifact does not match immutable ownership basis")
    _validate_audit_manifest(run, owner_path, owner, head, fresh_artifact)
    names = sorted(p.name for p in (audit_dir / "commits").iterdir() if p.is_dir() and re.fullmatch(r"[0-9]{6}", p.name))
    if not names or names != [f"{i:06d}" for i in range(len(names))]:
        raise EnvelopeError("Audit checkpoints are not contiguous")
    parent_cp = parent_ledger = None
    parent_checkpoint: dict[str, Any] | None = None
    head_cp: dict[str, Any] | None = None
    for revision, name in enumerate(names):
        cp = _read_json(audit_dir / "commits" / name / "checkpoint.json")
        _validate_checkpoint(audit_dir, run, cp, revision, parent_cp, parent_ledger,
                             fresh_artifact)
        if revision == 0:
            _validate_initial_state(audit_dir, cp["state"])
        else:
            assert parent_checkpoint is not None
            event = _read_json(audit_dir / "commits" / name / "event.json")
            _validate_audit_transition(audit_dir, run, parent_checkpoint, cp, event,
                                       fresh_artifact)
        parent_cp, parent_ledger, head_cp = cp["checkpoint_sha256"], cp["ledger_sha256"], cp
        parent_checkpoint = cp
    assert head_cp is not None
    _validate_state_partition(run, head_cp["state"])
    expected_supplement = _supplement_from_dispositions(run, head_cp["state"], fresh_artifact)
    actual_supplement = _load_ref_mask(audit_dir, head_cp["state"]["audit_claimed_supplement_mask"])
    if not np.array_equal(expected_supplement, actual_supplement):
        raise EnvelopeError("Audit claimed supplement is not the exact claimed-component union")
    return run, head_cp


def _validate_checkpoint(audit_dir: Path, run: Mapping[str, Any], cp: Mapping[str, Any], revision: int,
                         parent_cp: str | None, parent_ledger: str | None,
                         residual: np.ndarray) -> None:
    if cp.get("schema_version") != CHECKPOINT_SCHEMA_VERSION or cp.get("audit_id") != run["audit_id"] or cp.get("revision") != revision:
        raise EnvelopeError(f"Audit checkpoint identity mismatch at revision {revision}")
    if cp.get("parent_checkpoint_sha256") != parent_cp or cp.get("parent_ledger_sha256") != parent_ledger:
        raise EnvelopeError(f"Audit checkpoint parent mismatch at revision {revision}")
    state = cp.get("state")
    if cp.get("state_sha256") != _hash(state): raise EnvelopeError(f"Audit state hash is stale at revision {revision}")
    ledger = {"run_manifest_sha256": run["run_manifest_sha256"], "revision": revision,
              "parent_ledger_sha256": parent_ledger, "event_sha256": cp.get("event_sha256"), "state_sha256": cp["state_sha256"]}
    if cp.get("ledger_sha256") != _hash(ledger) or cp.get("checkpoint_sha256") != _hash_without(cp, "checkpoint_sha256"):
        raise EnvelopeError(f"Audit checkpoint hash is stale at revision {revision}")
    if (not isinstance(state, Mapping) or set(state) != _STATE_FIELDS or
            state.get("cursor") != revision or
            not isinstance(state.get("terminal_region_ids"), list) or
            len(state["terminal_region_ids"]) != revision or
            not isinstance(state.get("component_dispositions"), list) or
            not isinstance(state.get("new_word_ids"), list)):
        raise EnvelopeError(f"Audit checkpoint state is invalid at revision {revision}")
    supplement = _load_ref_mask(audit_dir, state["audit_claimed_supplement_mask"])
    if supplement.shape != residual.shape or np.any(supplement & ~residual):
        raise EnvelopeError("Audit supplement is not within immutable fresh residual")


def _validate_audit_manifest(run: Mapping[str, Any], owner_path: Path,
                             owner: Mapping[str, Any], head: Mapping[str, Any],
                             fresh: np.ndarray) -> None:
    expected_fields = {
        "schema_version", "audit_id", "page_id", "ownership_binding", "input_bindings",
        "policy", "ownership_units", "lines", "components", "regions",
        "fresh_residual_input_mask", "run_manifest_sha256",
    }
    if set(run) != expected_fields:
        raise EnvelopeError("Residual audit manifest has missing or extra fields")
    state = head["state"]
    expected_binding = {
        "run_dir": str(owner_path.resolve()),
        "run_manifest_file_sha256": sha256_file(owner_path / "run-manifest.json"),
        "run_manifest_sha256": owner["run_manifest_sha256"],
        "head_revision": head["revision"],
        "head_checkpoint_sha256": head["checkpoint_sha256"],
        "head_ledger_sha256": head["ledger_sha256"],
        "human_blockers": [
            f"manual_ownership:{item['unit_id']}:{item['disposition']}"
            for item in state.get("deferred_units", [])
        ],
    }
    expected_id = _hash({"ownership_run": str(owner_path.resolve()),
                         "head": head["checkpoint_sha256"]})[:24]
    if (run["audit_id"] != expected_id or run["page_id"] != owner["page_id"] or
            run["ownership_binding"] != expected_binding or
            run["input_bindings"] != owner["input_bindings"] or
            run["policy"] != _policy() or run["ownership_units"] != owner["units"]):
        raise EnvelopeError("Residual audit manifest diverges from its validated ownership basis")
    _, components = stable_components(fresh)
    for component in components:
        component.pop("raw_label", None)
    lines = _line_geometry(owner["units"])
    regions = _derive_regions(components, lines, fresh.shape)
    _assert_region_partition(regions, components)
    if (run["lines"] != lines or run["components"] != components or run["regions"] != regions):
        raise EnvelopeError("Residual component inventory or region partition is not freshly derived")
    if sum(item["area_px"] for item in components) != int(fresh.sum()):
        raise EnvelopeError("Residual component pixel inventory is not exact")
    if run["fresh_residual_input_mask"].get("path") != "commits/000000/fresh-residual-input.png":
        raise EnvelopeError("Frozen residual artifact path is not canonical")


def _validate_initial_state(audit_dir: Path, state: Mapping[str, Any]) -> None:
    expected_ref = _pending_ref(audit_dir / "commits/000000/audit-claimed-supplement.png",
                                "commits/000000/audit-claimed-supplement.png")
    expected = {"cursor": 0, "terminal_region_ids": [], "component_dispositions": [],
                "new_word_ids": [], "audit_claimed_supplement_mask": expected_ref}
    if state != expected or np.any(_load_ref_mask(audit_dir, expected_ref)):
        raise EnvelopeError("Residual audit revision-zero state is not the canonical empty state")


def _validate_audit_transition(audit_dir: Path, run: Mapping[str, Any],
                               parent: Mapping[str, Any], child: Mapping[str, Any],
                               event: Mapping[str, Any], residual: np.ndarray) -> None:
    revision = child["revision"]
    event_fields = {
        "schema_version", "audit_id", "revision", "base_checkpoint_sha256",
        "packet_sha256", "region_id", "dispositions",
        "supplement_before_pixel_sha256", "supplement_after_pixel_sha256",
        "new_claimed_pixels", "event_sha256",
    }
    if (set(event) != event_fields or event.get("schema_version") != EVENT_SCHEMA_VERSION or
            event.get("audit_id") != run["audit_id"] or event.get("revision") != revision or
            event.get("base_checkpoint_sha256") != parent["checkpoint_sha256"] or
            event.get("event_sha256") != _hash_without(event, "event_sha256") or
            event.get("event_sha256") != child.get("event_sha256")):
        raise EnvelopeError(f"Audit event is not a valid child transition at revision {revision}")
    parent_state = parent["state"]
    region = _require_current_region(run, parent_state)
    packet_dir = audit_dir / "packets" / f"r{parent['revision']:06d}-{region['region_id']}"
    packet = _read_json(packet_dir / "packet.json")
    _validate_packet(packet, packet_dir, audit_dir, parent, run, parent_state)
    dispositions = _validate_action({"schema_version": ACTION_SCHEMA_VERSION,
                                     "packet_sha256": event["packet_sha256"],
                                     "dispositions": event["dispositions"]},
                                    packet, run, parent_state)
    before = _load_ref_mask(audit_dir, parent_state["audit_claimed_supplement_mask"])
    selected = np.zeros_like(residual, dtype=bool)
    for disposition in dispositions:
        if disposition["type"] in {"attach_existing_unit", "new_missing_word"}:
            for component_id in disposition["component_ids"]:
                selected |= _component_mask(component_id, residual)
    after = before | selected
    expected_ref = _pending_ref(audit_dir / "commits" / f"{revision:06d}" /
                                "audit-claimed-supplement.png",
                                f"commits/{revision:06d}/audit-claimed-supplement.png")
    expected_state = {
        "cursor": parent_state["cursor"] + 1,
        "terminal_region_ids": parent_state["terminal_region_ids"] + [region["region_id"]],
        "component_dispositions": parent_state["component_dispositions"] + copy.deepcopy(dispositions),
        "new_word_ids": parent_state["new_word_ids"] +
                        [item["new_word_id"] for item in dispositions
                         if item["type"] == "new_missing_word"],
        "audit_claimed_supplement_mask": expected_ref,
    }
    if child["state"] != expected_state or not np.array_equal(
            _load_ref_mask(audit_dir, expected_ref), after):
        raise EnvelopeError(f"Audit state does not exactly replay event at revision {revision}")
    if (event["region_id"] != region["region_id"] or
            event["packet_sha256"] != packet["packet_sha256"] or
            event["supplement_before_pixel_sha256"] != sha256_mask_pixels(before) or
            event["supplement_after_pixel_sha256"] != sha256_mask_pixels(after) or
            event["new_claimed_pixels"] != int(selected.sum())):
        raise EnvelopeError(f"Audit event accounting is not exact at revision {revision}")


def _validate_state_partition(run: Mapping[str, Any], state: Mapping[str, Any]) -> None:
    terminal = state["terminal_region_ids"]
    expected_regions = [r["region_id"] for r in run["regions"][:state["cursor"]]]
    if terminal != expected_regions: raise EnvelopeError("Audit terminal region order is invalid")
    expected_components = {i for r in run["regions"][:state["cursor"]] for i in r["component_ids"]}
    got: list[int] = [i for d in state["component_dispositions"] for i in d["component_ids"]]
    if len(got) != len(set(got)) or set(got) != expected_components:
        raise EnvelopeError("Audit component accounting is not exact")


def _make_checkpoint(run: Mapping[str, Any], revision: int, parent_cp: str | None, parent_ledger: str | None,
                     event_sha256: str | None, state: Mapping[str, Any]) -> dict[str, Any]:
    state_copy = copy.deepcopy(dict(state)); state_hash = _hash(state_copy)
    ledger = {"run_manifest_sha256": run["run_manifest_sha256"], "revision": revision,
              "parent_ledger_sha256": parent_ledger, "event_sha256": event_sha256, "state_sha256": state_hash}
    cp = {"schema_version": CHECKPOINT_SCHEMA_VERSION, "audit_id": run["audit_id"], "revision": revision,
          "parent_checkpoint_sha256": parent_cp, "parent_ledger_sha256": parent_ledger,
          "event_sha256": event_sha256, "state": state_copy, "state_sha256": state_hash, "ledger_sha256": _hash(ledger)}
    cp["checkpoint_sha256"] = _hash_without(cp, "checkpoint_sha256")
    return cp


def _validate_ownership_run(run_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Independent minimal verifier for all immutable owner inputs/commits."""
    run = _read_json(run_dir / "run-manifest.json")
    if run.get("schema_version") != _OWNER_RUN_SCHEMA or run.get("run_manifest_sha256") != _hash_without(run, "run_manifest_sha256"):
        raise EnvelopeError("Ownership manifest is unsupported or hash-stale")
    for name, binding in run.get("input_bindings", {}).items():
        path = Path(binding.get("path", ""))
        if not path.is_file() or sha256_file(path) != binding.get("file_sha256"):
            raise EnvelopeError(f"Ownership bound input is missing or changed: {name}")
    source_size = tuple(run["input_bindings"]["source"]["size_wh"])
    ink_binding = run["input_bindings"]["normalized_global_ink_mask"]
    ink = _load_normalized_mask(Path(ink_binding["path"]), source_size)
    if sha256_mask_pixels(ink) != ink_binding.get("pixel_sha256"):
        raise EnvelopeError("Ownership normalized global ink pixels changed")
    commits = sorted(p.name for p in (run_dir / "commits").iterdir() if p.is_dir() and re.fullmatch(r"[0-9]{6}", p.name))
    if not commits or commits != [f"{i:06d}" for i in range(len(commits))]:
        raise EnvelopeError("Ownership checkpoints are not contiguous")
    parent_cp = parent_ledger = None
    parent_state: Mapping[str, Any] | None = None
    head: dict[str, Any] | None = None
    for revision, name in enumerate(commits):
        cp = _read_json(run_dir / "commits" / name / "checkpoint.json")
        if cp.get("schema_version") != _OWNER_CHECKPOINT_SCHEMA or cp.get("run_id") != run["run_id"] or cp.get("revision") != revision:
            raise EnvelopeError(f"Ownership checkpoint identity mismatch at revision {revision}")
        if cp.get("parent_checkpoint_sha256") != parent_cp or cp.get("parent_ledger_sha256") != parent_ledger:
            raise EnvelopeError(f"Ownership checkpoint parent mismatch at revision {revision}")
        if cp.get("state_sha256") != _hash(cp.get("state")):
            raise EnvelopeError(f"Ownership state hash is stale at revision {revision}")
        ledger = {"run_manifest_sha256": run["run_manifest_sha256"], "revision": revision,
                  "parent_ledger_sha256": parent_ledger, "event_sha256": cp.get("event_sha256"), "state_sha256": cp["state_sha256"]}
        if cp.get("ledger_sha256") != _hash(ledger) or cp.get("checkpoint_sha256") != _hash_without(cp, "checkpoint_sha256"):
            raise EnvelopeError(f"Ownership checkpoint hash is stale at revision {revision}")
        if revision:
            event = _read_json(run_dir / "commits" / name / "event.json")
            if event.get("event_sha256") != _hash_without(event, "event_sha256") or event["event_sha256"] != cp.get("event_sha256"):
                raise EnvelopeError(f"Ownership event hash is stale at revision {revision}")
        state = cp["state"]
        _validate_ownership_state(run, state, revision)
        global_claimed = _load_ref_mask(run_dir, state["global_claimed_mask"])
        if global_claimed.shape != ink.shape: raise EnvelopeError("Ownership claim dimensions do not match ink")
        union = np.zeros_like(ink)
        seen: set[str] = set()
        for claim in state.get("claimed_units", []):
            if claim.get("unit_id") in seen: raise EnvelopeError("Ownership unit claims duplicate a unit")
            seen.add(claim.get("unit_id")); mask = _load_ref_mask(run_dir, claim["source_mask"])
            if (claim.get("unit_id") not in _owner_unit_ids(run) or
                    not mask.any() or claim.get("pixels") != int(mask.sum()) or
                    mask.shape != ink.shape or np.any(mask & union) or np.any(mask & ~ink)):
                raise EnvelopeError("Ownership source claims are overlapping or escape ink")
            union |= mask
        if not np.array_equal(union, global_claimed): raise EnvelopeError("Ownership global claim is not exact disjoint union")
        if revision:
            assert parent_state is not None
            _validate_ownership_event_transition(run_dir, run, parent_state, state, event,
                                                 cp, revision)
        parent_cp, parent_ledger, head = cp["checkpoint_sha256"], cp["ledger_sha256"], cp
        parent_state = state
    assert head is not None
    return run, head


def _owner_unit_ids(run: Mapping[str, Any]) -> set[str]:
    return ({item["unit_id"] for item in run.get("units", [])} |
            {item["unit_id"] for item in run.get("preloaded_approved_units", [])})


def _owner_unit_by_id(run: Mapping[str, Any], unit_id: str) -> Mapping[str, Any]:
    for unit in run.get("units", []):
        if unit.get("unit_id") == unit_id:
            return unit
    raise EnvelopeError(f"Ownership queue refers to unknown unit {unit_id}")


def _owner_bbox(value: Any, *, label: str) -> list[int]:
    if (not isinstance(value, list) or len(value) != 4 or
            any(not isinstance(item, int) or isinstance(item, bool) for item in value)):
        raise EnvelopeError(f"Ownership {label} must contain four integers")
    x, y, width, height = value
    if x < 0 or y < 0 or width < 1 or height < 1:
        raise EnvelopeError(f"Ownership {label} has invalid geometry")
    return [x, y, width, height]


def _owner_bbox_overrides(state: Mapping[str, Any]) -> dict[str, Any]:
    global_ref = state.get("global_claimed_mask")
    if not isinstance(global_ref, Mapping):
        raise EnvelopeError("Ownership global claimed reference is invalid")
    overrides = global_ref.get("registration_bbox_overrides", {})
    if not isinstance(overrides, Mapping):
        raise EnvelopeError("Ownership registration bbox overrides are invalid")
    if any(not isinstance(unit_id, str) or not unit_id for unit_id in overrides):
        raise EnvelopeError("Ownership registration bbox override IDs are invalid")
    return copy.deepcopy(dict(overrides))


def _validate_ownership_bbox_overrides(run: Mapping[str, Any], state: Mapping[str, Any],
                                       revision: int) -> None:
    overrides = _owner_bbox_overrides(state)
    units = {item["unit_id"]: item for item in run.get("units", [])}
    unknown = set(overrides) - set(units)
    if unknown:
        raise EnvelopeError(
            f"Ownership registration bbox overrides refer to unknown units: {sorted(unknown)}"
        )
    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    history_fields = {
        "at_revision", "unit_turn", "from_bbox_source_xywh",
        "to_bbox_source_xywh", "confidence", "reason_codes",
        "work_packet_sha256",
    }
    for unit_id, override in overrides.items():
        if (not isinstance(override, Mapping) or set(override) != {
                "original_bbox_source_xywh", "active_bbox_source_xywh", "history"}):
            raise EnvelopeError(
                f"Ownership registration bbox override is malformed for {unit_id}"
            )
        original = _owner_bbox(
            override["original_bbox_source_xywh"], label="original registration bbox"
        )
        if original != units[unit_id]["bbox_source_xywh"]:
            raise EnvelopeError(
                f"Ownership registration override changed immutable geometry for {unit_id}"
            )
        active = _owner_bbox(
            override["active_bbox_source_xywh"], label="active registration bbox"
        )
        history = override["history"]
        if not isinstance(history, list) or not history:
            raise EnvelopeError(
                f"Ownership registration override has no append-only history for {unit_id}"
            )
        previous = original
        previous_revision = 0
        for item in history:
            if not isinstance(item, Mapping) or set(item) != history_fields:
                raise EnvelopeError(
                    f"Ownership registration history is malformed for {unit_id}"
                )
            at_revision = item["at_revision"]
            unit_turn = item["unit_turn"]
            if (not isinstance(at_revision, int) or isinstance(at_revision, bool) or
                    not previous_revision < at_revision <= revision or
                    not isinstance(unit_turn, int) or isinstance(unit_turn, bool) or
                    unit_turn < 0):
                raise EnvelopeError(
                    f"Ownership registration history revision is invalid for {unit_id}"
                )
            before_bbox = _owner_bbox(
                item["from_bbox_source_xywh"], label="registration history source bbox"
            )
            after_bbox = _owner_bbox(
                item["to_bbox_source_xywh"], label="registration history target bbox"
            )
            if before_bbox != previous:
                raise EnvelopeError(
                    f"Ownership registration history is not append-only for {unit_id}"
                )
            if (after_bbox[0] + after_bbox[2] > source_width or
                    after_bbox[1] + after_bbox[3] > source_height):
                raise EnvelopeError(
                    f"Ownership registration history escapes the source for {unit_id}"
                )
            reasons = item["reason_codes"]
            if (item["confidence"] not in {"high", "medium", "low"} or
                    not isinstance(reasons, list) or not reasons or
                    any(not isinstance(reason, str) for reason in reasons) or
                    len(reasons) != len(set(reasons)) or
                    any(reason not in _OWNER_REGISTRATION_REASON_CODES for reason in reasons) or
                    not isinstance(item["work_packet_sha256"], str) or
                    re.fullmatch(r"[0-9a-f]{64}", item["work_packet_sha256"]) is None):
                raise EnvelopeError(
                    f"Ownership registration history provenance is invalid for {unit_id}"
                )
            previous = after_bbox
            previous_revision = at_revision
        if active != previous:
            raise EnvelopeError(
                f"Ownership active registration bbox disagrees with history for {unit_id}"
            )


def _validate_ownership_state(run: Mapping[str, Any], state: Mapping[str, Any],
                              revision: int) -> None:
    fields = {"cursor", "unit_turn", "requested_context_margin_px",
              "current_work_bbox_source_xywh", "current_local_mask", "global_claimed_mask",
              "claimed_units", "deferred_units", "queue_unit_ids", "queue_generation",
              "active_model_tier", "completed_unit_ids", "tier_deferred_units"}
    if not isinstance(state, Mapping) or set(state) != fields:
        raise EnvelopeError(f"Ownership state shape is invalid at revision {revision}")
    active_ids = {item["unit_id"] for item in run.get("units", [])}
    all_ids = _owner_unit_ids(run)
    queue = state["queue_unit_ids"]
    cursor = state["cursor"]
    if (not isinstance(queue, list) or len(queue) != len(set(queue)) or
            any(not isinstance(item, str) or item not in active_ids for item in queue) or
            not isinstance(cursor, int) or isinstance(cursor, bool) or not 0 <= cursor <= len(queue)):
        raise EnvelopeError(f"Ownership queue/cursor is invalid at revision {revision}")
    if revision == 0 and queue != [item["unit_id"] for item in run.get("units", [])]:
        raise EnvelopeError("Ownership revision-zero queue does not match manifest units")
    for field in ("claimed_units", "deferred_units", "tier_deferred_units"):
        if (not isinstance(state[field], list) or
                any(not isinstance(item, Mapping) for item in state[field])):
            raise EnvelopeError(f"Ownership {field} are invalid at revision {revision}")
    claimed = [item.get("unit_id") for item in state["claimed_units"]]
    deferred = [item.get("unit_id") for item in state["deferred_units"]]
    tier = [item.get("unit_id") for item in state["tier_deferred_units"]]
    completed = state["completed_unit_ids"]
    for label, values, universe in (("claims", claimed, all_ids), ("human deferrals", deferred, active_ids),
                                    ("tier deferrals", tier, active_ids), ("completed units", completed, active_ids)):
        if (not isinstance(values, list) or len(values) != len(set(values)) or
                any(not isinstance(item, str) or item not in universe for item in values)):
            raise EnvelopeError(f"Ownership {label} are invalid at revision {revision}")
    active_claimed = set(claimed) & active_ids
    if (set(completed) != active_claimed | set(deferred) or
            active_claimed & set(deferred) or set(tier) & set(completed)):
        raise EnvelopeError(f"Ownership terminal disposition accounting is invalid at revision {revision}")
    terminal_or_tier = set(completed) | set(tier)
    if any(unit_id not in terminal_or_tier for unit_id in queue[:cursor]):
        raise EnvelopeError(f"Ownership cursor skips an unresolved unit at revision {revision}")
    if any(not isinstance(item.get("at_revision"), int) or item["at_revision"] > revision
           for item in state["claimed_units"] + state["deferred_units"] + state["tier_deferred_units"]):
        raise EnvelopeError(f"Ownership disposition revision is invalid at revision {revision}")
    _validate_ownership_bbox_overrides(run, state, revision)


def _validate_ownership_event_transition(run_dir: Path, run: Mapping[str, Any],
                                         before: Mapping[str, Any], after: Mapping[str, Any],
                                         event: Mapping[str, Any], checkpoint: Mapping[str, Any],
                                         revision: int) -> None:
    if (event.get("schema_version") != _OWNER_EVENT_SCHEMA or
            event.get("run_id") != run["run_id"] or event.get("revision") != revision or
            event.get("base_checkpoint_sha256") != checkpoint["parent_checkpoint_sha256"] or
            event.get("base_ledger_sha256") != checkpoint["parent_ledger_sha256"] or
            event.get("cursor_before") != before["cursor"] or
            event.get("cursor_after") != after["cursor"]):
        raise EnvelopeError(f"Ownership event transition metadata is invalid at revision {revision}")
    before_global = _load_ref_mask(run_dir, before["global_claimed_mask"])
    after_global = _load_ref_mask(run_dir, after["global_claimed_mask"])
    if "compact_action" in event:
        compact = event["compact_action"]
        action = compact.get("action") if isinstance(compact, Mapping) else None
        action_type = action.get("type") if isinstance(action, Mapping) else None
        if (action_type not in {"claim_select", "defer_manual", "defer_tier", "exclude", "cut",
                               "request_expanded_context", "reopen_bbox"} or
                before["cursor"] >= len(before["queue_unit_ids"]) or
                event.get("unit_id") != before["queue_unit_ids"][before["cursor"]] or
                event.get("unit_turn") != before["unit_turn"]):
            raise EnvelopeError(f"Ownership compact event is invalid at revision {revision}")
        terminal = action_type in {"claim_select", "defer_manual", "defer_tier"}
        if after["cursor"] != before["cursor"] + (1 if terminal else 0):
            raise EnvelopeError(f"Ownership action/cursor transition is invalid at revision {revision}")
        for field in ("queue_unit_ids", "queue_generation", "active_model_tier"):
            if after[field] != before[field]:
                raise EnvelopeError(f"Ownership action changed immutable queue metadata at revision {revision}")
        before_overrides = _owner_bbox_overrides(before)
        after_overrides = _owner_bbox_overrides(after)
        if action_type == "claim_select":
            if len(after["claimed_units"]) != len(before["claimed_units"]) + 1:
                raise EnvelopeError("Ownership claim action did not append exactly one unit claim")
            claim = after["claimed_units"][-1]
            source_claim = _load_ref_mask(run_dir, claim["source_mask"])
            if claim["unit_id"] != event["unit_id"] or not np.array_equal(after_global, before_global | source_claim):
                raise EnvelopeError("Ownership claim action/global union is not exact")
        elif not np.array_equal(before_global, after_global):
            raise EnvelopeError("Non-claim ownership action changed global claimed pixels")
        if action_type == "reopen_bbox":
            _validate_ownership_reopen_transition(
                run_dir, run, before, after, event, revision,
                before_overrides, after_overrides,
            )
        elif after_overrides != before_overrides:
            raise EnvelopeError(
                f"Ownership action changed registration bbox overrides at revision {revision}"
            )
        if (event.get("global_claimed_before_pixel_sha256") != sha256_mask_pixels(before_global) or
                event.get("global_claimed_after_pixel_sha256") != sha256_mask_pixels(after_global)):
            raise EnvelopeError("Ownership event global pixel accounting is stale")
    elif "control_action" in event:
        control = event["control_action"]
        control_type = control.get("type") if isinstance(control, Mapping) else None
        if control_type == "requeue_tier":
            if (before["cursor"] != len(before["queue_unit_ids"]) or
                    after["cursor"] != 0 or
                    after["queue_unit_ids"] != control.get("queue_unit_ids") or
                    after["queue_generation"] != before["queue_generation"] + 1 or
                    after["active_model_tier"] != control.get("target") or
                    not np.array_equal(before_global, after_global) or
                    _owner_bbox_overrides(after) != _owner_bbox_overrides(before)):
                raise EnvelopeError(
                    f"Ownership tier requeue transition is invalid at revision {revision}"
                )
        elif control_type == "requeue_review":
            _validate_ownership_requeue_review_transition(
                run_dir, run, before, after, event, revision,
                before_global, after_global,
            )
        else:
            raise EnvelopeError(
                f"Ownership control event is unsupported at revision {revision}"
            )
    else:
        raise EnvelopeError(f"Ownership event has no recognized action at revision {revision}")


def _validate_ownership_reopen_transition(
    run_dir: Path,
    run: Mapping[str, Any],
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    event: Mapping[str, Any],
    revision: int,
    before_overrides: Mapping[str, Any],
    after_overrides: Mapping[str, Any],
) -> None:
    compact = event["compact_action"]
    if (not isinstance(compact, Mapping) or set(compact) != {
            "schema_version", "work_packet_sha256", "action"} or
            compact.get("schema_version") != _OWNER_COMPACT_ACTION_SCHEMA or
            compact.get("work_packet_sha256") != event.get("work_packet_sha256") or
            not isinstance(compact.get("work_packet_sha256"), str) or
            re.fullmatch(r"[0-9a-f]{64}", compact["work_packet_sha256"]) is None):
        raise EnvelopeError(
            f"Ownership reopen_bbox compact envelope is invalid at revision {revision}"
        )
    action = compact["action"]
    if not isinstance(action, Mapping) or set(action) != {
            "type", "bbox_source_xywh", "confidence", "reason_codes"}:
        raise EnvelopeError(
            f"Ownership reopen_bbox action is malformed at revision {revision}"
        )
    reasons = action["reason_codes"]
    if (action["confidence"] not in {"high", "medium", "low"} or
            not isinstance(reasons, list) or not reasons or
            any(not isinstance(reason, str) for reason in reasons) or
            len(reasons) != len(set(reasons)) or
            any(reason not in _OWNER_REGISTRATION_REASON_CODES for reason in reasons)):
        raise EnvelopeError(
            f"Ownership reopen_bbox provenance is invalid at revision {revision}"
        )

    unit_id = event["unit_id"]
    unit = _owner_unit_by_id(run, unit_id)
    original = _owner_bbox(unit["bbox_source_xywh"], label="manifest bbox")
    prior = before_overrides.get(unit_id)
    active_before = (
        _owner_bbox(prior["active_bbox_source_xywh"], label="active registration bbox")
        if prior is not None else original
    )
    corrected = _owner_bbox(action["bbox_source_xywh"], label="reopen bbox")
    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    if (corrected[0] + corrected[2] > source_width or
            corrected[1] + corrected[3] > source_height):
        raise EnvelopeError(
            f"Ownership reopen_bbox escapes the source at revision {revision}"
        )
    delta = max(abs(left - right) for left, right in zip(active_before, corrected))
    material_threshold = max(2, round(min(active_before[2], active_before[3]) * 0.05))
    if delta < material_threshold:
        raise EnvelopeError(
            f"Ownership reopen_bbox is a semantic no-op at revision {revision}"
        )
    old_center = (
        active_before[0] + active_before[2] / 2,
        active_before[1] + active_before[3] / 2,
    )
    new_center = (
        corrected[0] + corrected[2] / 2,
        corrected[1] + corrected[3] / 2,
    )
    requested = before["requested_context_margin_px"]
    if (not isinstance(requested, Mapping) or set(requested) != {
            "left", "right", "top", "bottom"} or
            any(not isinstance(value, int) or isinstance(value, bool) or value < 0
                for value in requested.values())):
        raise EnvelopeError(
            f"Ownership reopen_bbox prior context is invalid at revision {revision}"
        )
    move_limit = (
        run["policy"]["context_padding_px"]
        + max(active_before[2], active_before[3], corrected[2], corrected[3])
        + max(requested.values())
    )
    if max(abs(old_center[0] - new_center[0]),
           abs(old_center[1] - new_center[1])) > move_limit:
        raise EnvelopeError(
            f"Ownership reopen_bbox exceeds bounded move policy at revision {revision}"
        )
    ink_binding = run["input_bindings"]["normalized_global_ink_mask"]
    ink = _load_normalized_mask(
        Path(ink_binding["path"]), tuple(run["input_bindings"]["source"]["size_wh"])
    )
    x, y, width, height = corrected
    if not ink[y:y + height, x:x + width].any():
        raise EnvelopeError(
            f"Ownership reopen_bbox intersects zero normalized ink at revision {revision}"
        )

    expected_history = copy.deepcopy(prior["history"] if prior is not None else [])
    expected_history.append({
        "at_revision": revision,
        "unit_turn": before["unit_turn"],
        "from_bbox_source_xywh": active_before,
        "to_bbox_source_xywh": corrected,
        "confidence": action["confidence"],
        "reason_codes": list(reasons),
        "work_packet_sha256": compact["work_packet_sha256"],
    })
    expected_overrides = copy.deepcopy(dict(before_overrides))
    expected_overrides[unit_id] = {
        "original_bbox_source_xywh": original,
        "active_bbox_source_xywh": corrected,
        "history": expected_history,
    }
    if after_overrides != expected_overrides:
        raise EnvelopeError(
            f"Ownership reopen_bbox state does not exactly replay at revision {revision}"
        )

    correction = event.get("registration_correction")
    if correction != {
        "original_manifest_bbox_source_xywh": original,
        "before_active_bbox_source_xywh": active_before,
        "after_active_bbox_source_xywh": corrected,
    }:
        raise EnvelopeError(
            f"Ownership reopen_bbox event provenance does not exactly replay at revision {revision}"
        )
    if (after["cursor"] != before["cursor"] or
            after["unit_turn"] != before["unit_turn"] + 1 or
            after["requested_context_margin_px"] != {
                "left": 0, "right": 0, "top": 0, "bottom": 0} or
            any(after[field] != before[field] for field in (
                "claimed_units", "deferred_units", "completed_unit_ids",
                "tier_deferred_units"))):
        raise EnvelopeError(
            f"Ownership reopen_bbox changed non-registration state at revision {revision}"
        )
    before_global_ref = copy.deepcopy(dict(before["global_claimed_mask"]))
    after_global_ref = copy.deepcopy(dict(after["global_claimed_mask"]))
    before_global_ref.pop("registration_bbox_overrides", None)
    after_global_ref.pop("registration_bbox_overrides", None)
    if before_global_ref != after_global_ref:
        raise EnvelopeError(
            f"Ownership reopen_bbox changed the global claim binding at revision {revision}"
        )

    work_padding = run["policy"]["work_padding_px"]
    expected_bounds = [
        max(0, x - work_padding),
        max(0, y - work_padding),
        min(source_width, x + width + work_padding) - max(0, x - work_padding),
        min(source_height, y + height + work_padding) - max(0, y - work_padding),
    ]
    if after["current_work_bbox_source_xywh"] != expected_bounds:
        raise EnvelopeError(
            f"Ownership reopen_bbox work crop does not exactly replay at revision {revision}"
        )
    after_local = _load_ref_mask(run_dir, after["current_local_mask"])
    bx, by, bw, bh = expected_bounds
    before_global = _load_ref_mask(run_dir, before["global_claimed_mask"])
    expected_local = ink[by:by + bh, bx:bx + bw] & ~before_global[by:by + bh, bx:bx + bw]
    if (after["current_local_mask"].get("path") !=
            f"commits/{revision:06d}/current-local-mask.png" or
            not np.array_equal(after_local, expected_local)):
        raise EnvelopeError(
            f"Ownership reopen_bbox local inventory does not exactly replay at revision {revision}"
        )
    before_local = _load_ref_mask(run_dir, before["current_local_mask"])
    before_bounds = before["current_work_bbox_source_xywh"]
    expected_local_hash = sha256_mask_pixels(before_local)
    if (event.get("bound_ownership_action") is not None or
            event.get("local_to_source") != {
                "source_origin_xy": before_bounds[:2],
                "work_size_wh": before_bounds[2:],
            } or
            event.get("input_local_mask_pixel_sha256") != expected_local_hash or
            event.get("output_local_mask_pixel_sha256") != expected_local_hash or
            event.get("claimed_source_mask_pixel_sha256") is not None or
            event.get("requires_fresh_turn") is not True or
            event.get("cleanup_log") != []):
        raise EnvelopeError(
            f"Ownership reopen_bbox mask accounting does not exactly replay at revision {revision}"
        )


def _validate_ownership_requeue_review_transition(
    run_dir: Path,
    run: Mapping[str, Any],
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    event: Mapping[str, Any],
    revision: int,
    before_global: np.ndarray,
    after_global: np.ndarray,
) -> None:
    control = event["control_action"]
    expected_control_fields = {
        "type", "target", "requested_unit_ids", "conversions", "queue_unit_ids",
    }
    if (not isinstance(control, Mapping) or set(control) != expected_control_fields or
            control.get("target") != "sol"):
        raise EnvelopeError(
            f"Ownership requeue_review control is malformed at revision {revision}"
        )
    requested = control["requested_unit_ids"]
    if (not isinstance(requested, list) or not requested or
            any(not isinstance(unit_id, str) or not unit_id for unit_id in requested) or
            len(requested) != len(set(requested))):
        raise EnvelopeError(
            f"Ownership requeue_review requested IDs are invalid at revision {revision}"
        )
    units = run.get("units", [])
    known_ids = {unit["unit_id"] for unit in units}
    unknown = set(requested) - known_ids
    if unknown:
        raise EnvelopeError(
            f"Ownership requeue_review requested unknown units at revision {revision}"
        )
    if before["cursor"] != len(before["queue_unit_ids"]):
        raise EnvelopeError(
            f"Ownership requeue_review began before queue completion at revision {revision}"
        )
    active_manual = {item["unit_id"]: item for item in before["deferred_units"]}
    inactive = set(requested) - set(active_manual)
    if inactive:
        raise EnvelopeError(
            f"Ownership requeue_review requested inactive manual units at revision {revision}"
        )
    noneligible = [
        unit_id for unit_id in requested
        if active_manual[unit_id].get("disposition")
        not in _OWNER_REVIEW_ELIGIBLE_MANUAL_DISPOSITIONS
    ]
    if noneligible:
        raise EnvelopeError(
            f"Ownership requeue_review converted noneligible manual units at revision {revision}"
        )

    requested_set = set(requested)
    unresolved_tier = {
        item["unit_id"] for item in before["tier_deferred_units"]
        if item.get("target") == "sol"
    }
    expected_queue_ids = unresolved_tier | requested_set
    expected_queue = [
        unit["unit_id"] for unit in units if unit["unit_id"] in expected_queue_ids
    ]
    if (len(expected_queue) != len(expected_queue_ids) or
            control["queue_unit_ids"] != expected_queue or
            after["queue_unit_ids"] != expected_queue):
        raise EnvelopeError(
            f"Ownership requeue_review queue is not immutable reading order at revision {revision}"
        )
    expected_conversions = [
        {
            "unit_id": unit_id,
            "from": {
                "kind": "manual_review",
                "disposition": active_manual[unit_id]["disposition"],
                "at_revision": active_manual[unit_id]["at_revision"],
            },
            "to": {
                "kind": "tier_deferred",
                "target": "sol",
                "reason": _OWNER_REVIEW_CONVERSION_REASON,
            },
        }
        for unit_id in requested
    ]
    if control["conversions"] != expected_conversions:
        raise EnvelopeError(
            f"Ownership requeue_review conversions do not exactly replay at revision {revision}"
        )

    expected_deferred = [
        item for item in before["deferred_units"]
        if item["unit_id"] not in requested_set
    ]
    expected_tier = copy.deepcopy(before["tier_deferred_units"]) + [
        {
            "unit_id": unit_id,
            "target": "sol",
            "reason": _OWNER_REVIEW_CONVERSION_REASON,
            "at_revision": revision,
            "origin_manual_disposition": active_manual[unit_id]["disposition"],
        }
        for unit_id in requested
    ]
    expected_completed = [
        unit_id for unit_id in before["completed_unit_ids"]
        if unit_id not in requested_set
    ]
    zero_margins = {"left": 0, "right": 0, "top": 0, "bottom": 0}
    if (after["cursor"] != 0 or
            after["queue_generation"] != before["queue_generation"] + 1 or
            after["active_model_tier"] != "sol" or
            after["unit_turn"] != 0 or
            after["requested_context_margin_px"] != zero_margins or
            after["claimed_units"] != before["claimed_units"] or
            after["deferred_units"] != expected_deferred or
            after["tier_deferred_units"] != expected_tier or
            after["completed_unit_ids"] != expected_completed):
        raise EnvelopeError(
            f"Ownership requeue_review active state does not exactly replay at revision {revision}"
        )
    if (not np.array_equal(before_global, after_global) or
            after["global_claimed_mask"] != before["global_claimed_mask"] or
            _owner_bbox_overrides(after) != _owner_bbox_overrides(before)):
        raise EnvelopeError(
            f"Ownership requeue_review changed claims or registration history at revision {revision}"
        )
    if event.get("global_claimed_pixel_sha256") != sha256_mask_pixels(before_global):
        raise EnvelopeError(
            f"Ownership requeue_review global claim accounting is stale at revision {revision}"
        )

    first = _owner_unit_by_id(run, expected_queue[0])
    override = _owner_bbox_overrides(before).get(first["unit_id"])
    bbox = _owner_bbox(
        override["active_bbox_source_xywh"] if override is not None
        else first["bbox_source_xywh"],
        label="requeue review active bbox",
    )
    x, y, width, height = bbox
    source_width, source_height = run["input_bindings"]["source"]["size_wh"]
    work_padding = run["policy"]["work_padding_px"]
    left = max(0, x - work_padding)
    top = max(0, y - work_padding)
    expected_bounds = [
        left,
        top,
        min(source_width, x + width + work_padding) - left,
        min(source_height, y + height + work_padding) - top,
    ]
    if after["current_work_bbox_source_xywh"] != expected_bounds:
        raise EnvelopeError(
            f"Ownership requeue_review work crop does not exactly replay at revision {revision}"
        )
    ink_binding = run["input_bindings"]["normalized_global_ink_mask"]
    ink = _load_normalized_mask(
        Path(ink_binding["path"]), tuple(run["input_bindings"]["source"]["size_wh"])
    )
    bx, by, bw, bh = expected_bounds
    expected_local = ink[by:by + bh, bx:bx + bw] & ~before_global[by:by + bh, bx:bx + bw]
    after_local = _load_ref_mask(run_dir, after["current_local_mask"])
    if (after["current_local_mask"].get("path") !=
            f"commits/{revision:06d}/current-local-mask.png" or
            not np.array_equal(after_local, expected_local)):
        raise EnvelopeError(
            f"Ownership requeue_review local inventory does not exactly replay at revision {revision}"
        )


def _fresh_residual(run: Mapping[str, Any]) -> np.ndarray:
    owner, head = _bound_owner(run)
    return _fresh_residual_from_validated_owner(run, owner, head)


def _fresh_residual_from_validated_owner(run: Mapping[str, Any], owner: Mapping[str, Any],
                                         head: Mapping[str, Any]) -> np.ndarray:
    ink = _load_normalized_mask(Path(owner["input_bindings"]["normalized_global_ink_mask"]["path"]), tuple(owner["input_bindings"]["source"]["size_wh"]))
    return ink & ~_load_ref_mask(Path(run["ownership_binding"]["run_dir"]), head["state"]["global_claimed_mask"])


def _ownership_claimed(run: Mapping[str, Any]) -> np.ndarray:
    _, head = _bound_owner(run)
    return _load_ref_mask(Path(run["ownership_binding"]["run_dir"]), head["state"]["global_claimed_mask"])


def _bound_owner(run: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    owner_path = Path(run["ownership_binding"]["run_dir"])
    owner, head = _validate_ownership_run(owner_path)
    binding = run["ownership_binding"]
    if (sha256_file(owner_path / "run-manifest.json") != binding["run_manifest_file_sha256"] or
        owner["run_manifest_sha256"] != binding["run_manifest_sha256"] or
        head["checkpoint_sha256"] != binding["head_checkpoint_sha256"] or
        head["ledger_sha256"] != binding["head_ledger_sha256"] or head["revision"] != binding["head_revision"]):
        raise EnvelopeError("Bound ownership run has advanced or changed")
    return owner, head


def _supplement_from_dispositions(run: Mapping[str, Any], state: Mapping[str, Any],
                                  fresh: np.ndarray | None = None) -> np.ndarray:
    if fresh is None:
        fresh = _fresh_residual(run)
    result = np.zeros_like(fresh, dtype=bool)
    for disposition in state["component_dispositions"]:
        if disposition["type"] in {"attach_existing_unit", "new_missing_word"}:
            for component_id in disposition["component_ids"]:
                result |= _component_mask(component_id, fresh)
    return result


def _line_geometry(units: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for unit in units: grouped.setdefault(str(unit["line_id"]), []).append(unit)
    lines = []
    for line_id, members in grouped.items():
        boxes = [u["bbox_source_xywh"] for u in members]; x0=min(b[0] for b in boxes); y0=min(b[1] for b in boxes)
        x1=max(b[0]+b[2] for b in boxes); y1=max(b[1]+b[3] for b in boxes)
        lines.append({"line_id": line_id, "line_reading_order": min(int(u.get("line_reading_order", 0)) for u in members),
                      "bbox_source_xywh": [x0,y0,x1-x0,y1-y0],
                      "directed_reading": members[0].get("directed_reading"),
                      "upright_rotation_degrees": members[0].get("upright_rotation_degrees")})
    return sorted(lines, key=lambda x: (x["line_reading_order"], x["line_id"]))


def _derive_regions(components: Sequence[Mapping[str, Any]], lines: Sequence[Mapping[str, Any]], shape: tuple[int, int]) -> list[dict[str, Any]]:
    by_line: dict[str, list[int]] = {line["line_id"]: [] for line in lines}; outside: list[Mapping[str, Any]]=[]
    median_h = int(np.median([line["bbox_source_xywh"][3] for line in lines])) if lines else 10
    threshold = max(8, round(median_h * .75))
    for comp in components:
        nearest = min(lines, key=lambda line: _bbox_distance(comp["bbox"], _box_dict(line["bbox_source_xywh"])), default=None)
        if nearest is not None and _bbox_distance(comp["bbox"], _box_dict(nearest["bbox_source_xywh"])) <= threshold:
            by_line[nearest["line_id"]].append(comp["id"])
        else: outside.append(comp)
    regions=[]
    for line in lines:
        ids=by_line[line["line_id"]]
        if ids: regions.append({"region_id": f"line-{line['line_id']}", "kind":"line", "line_id":line["line_id"], "component_ids":sorted(ids)})
    # Explicit spatial outside-line clusters, rather than assigning unknown ink
    # to a nearby transcript line.
    gap=max(12, round(max(shape)*.03)); clusters: list[list[Mapping[str, Any]]] = []
    for comp in sorted(outside, key=lambda c:(c["bbox"]["y"],c["bbox"]["x"],c["id"])):
        matches=[c for c in clusters if any(_bbox_distance(comp["bbox"], x["bbox"]) <= gap for x in c)]
        if not matches: clusters.append([comp])
        else:
            merged=[comp]
            for c in matches: merged.extend(c); clusters.remove(c)
            clusters.append(merged)
    clusters.sort(key=lambda c:(min(x["bbox"]["y"] for x in c),min(x["bbox"]["x"] for x in c)))
    for n, cluster in enumerate(clusters, 1):
        regions.append({"region_id":f"outside-line-{n:03d}","kind":"outside_line_cluster","line_id":None,"component_ids":sorted(x["id"] for x in cluster)})
    return regions


def _assert_region_partition(regions: Sequence[Mapping[str, Any]], components: Sequence[Mapping[str, Any]]) -> None:
    ids=[i for r in regions for i in r["component_ids"]]
    region_ids = [r["region_id"] for r in regions]
    if (any(not isinstance(region_id, str) or
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,255}", region_id)
            for region_id in region_ids) or
            len(region_ids) != len(set(region_ids)) or len(ids)!=len(set(ids)) or
            set(ids)!={c["id"] for c in components}):
        raise EnvelopeError("Residual region partition is not exact")


def _context_bounds(components: Sequence[Mapping[str, Any]], shape: tuple[int,int]) -> list[int]:
    boxes=[c["bbox"] for c in components]; x0=min(b["x"] for b in boxes); y0=min(b["y"] for b in boxes)
    x1=max(b["x"]+b["width"] for b in boxes); y1=max(b["y"]+b["height"] for b in boxes)
    pad=max(5,round(max(shape)*.06)); return [max(0,x0-pad),max(0,y0-pad),min(shape[1],x1+pad)-max(0,x0-pad),min(shape[0],y1+pad)-max(0,y0-pad)]


def _render_evidence(source_path: Path, residual: np.ndarray, claimed: np.ndarray, components: Sequence[Mapping[str, Any]], bounds: Sequence[int], output: Path) -> dict[str, Any]:
    x,y,w,h=bounds
    with Image.open(source_path) as image: source=image.convert("RGB").crop((x,y,x+w,y+h))
    array=np.asarray(source).copy(); local_claimed=claimed[y:y+h,x:x+w]; array[local_claimed]=[222,50,42]
    source_claimed=Image.fromarray(array,"RGB")
    residual_img=Image.new("RGB",(w,h),"white"); rarr=np.asarray(residual_img).copy(); rarr[residual[y:y+h,x:x+w]]=[0,0,0]; numbered=Image.fromarray(rarr,"RGB")
    draw=ImageDraw.Draw(numbered); font=_font(max(12,min(28,round(max(h,w)*.025))))
    for c in components:
        b=c["bbox"]; bx,by=b["x"]-x,b["y"]-y; draw.rectangle((bx,by,bx+b["width"]-1,by+b["height"]-1),outline=(0,100,255),width=1); draw.text((bx, max(0,by-16)),str(c["id"]),fill=(0,80,220),font=font,stroke_width=1,stroke_fill="white")
    files={"source_context_claimed_red":source_claimed,"residual_high_contrast_numbered":numbered}
    result={}
    for name,image in files.items():
        path=output/f"{name}.png"; image.save(path,format="PNG",compress_level=9,optimize=False)
        result[name]={"path":path.name,"file_sha256":sha256_file(path),"size_wh":[w,h]}
    return result


def _component_hint(component: Mapping[str,Any], units: Sequence[Mapping[str,Any]], lines: Sequence[Mapping[str,Any]]) -> dict[str,Any]:
    nearest_unit=min(units,key=lambda u:_bbox_distance(component["bbox"],_box_dict(u["bbox_source_xywh"])),default=None)
    nearest_line=min(lines,key=lambda l:_bbox_distance(component["bbox"],_box_dict(l["bbox_source_xywh"])),default=None)
    return {"component_id":component["id"],"nearest_unit_id":None if nearest_unit is None else nearest_unit["unit_id"],"nearest_line_id":None if nearest_line is None else nearest_line["line_id"],"hint_only":True}


def _current_region(run: Mapping[str,Any], state: Mapping[str,Any]) -> dict[str,Any] | None:
    return None if state["cursor"] >= len(run["regions"]) else run["regions"][state["cursor"]]
def _require_current_region(run: Mapping[str,Any], state: Mapping[str,Any]) -> dict[str,Any]:
    region=_current_region(run,state)
    if region is None: raise EnvelopeError("Current residual audit is complete")
    return region
def _component_mask(component_id: int, residual: np.ndarray) -> np.ndarray:
    labels, _ = stable_components(residual)
    return labels == component_id


def _component_by_id(run: Mapping[str, Any], component_id: int) -> dict[str, Any]:
    for component in run["components"]:
        if component["id"] == component_id:
            return copy.deepcopy(component)
    raise EnvelopeError(f"Unknown residual component ID: {component_id}")


def _validate_packet(packet: Mapping[str, Any], packet_dir: Path, audit_dir: Path,
                     checkpoint: Mapping[str, Any], run: Mapping[str, Any],
                     state: Mapping[str, Any]) -> None:
    if packet.get("schema_version") != PACKET_SCHEMA_VERSION or packet.get("checkpoint_sha256") != checkpoint["checkpoint_sha256"]:
        raise EnvelopeError("Cached audit packet is stale")
    if packet.get("packet_sha256") != _packet_hash(packet):
        raise EnvelopeError("Cached audit packet hash is stale")
    if packet["legal_actions"]["packet_bound_envelope"].get("packet_sha256") != packet["packet_sha256"]:
        raise EnvelopeError("Cached audit action binding is stale")
    region = _require_current_region(run, state)
    components = [_component_by_id(run, component_id) for component_id in region["component_ids"]]
    bounds = _context_bounds(components, tuple(_load_ref_mask(
        audit_dir, run["fresh_residual_input_mask"]).shape))
    expected_legal = {
        "packet_bound_envelope": {"schema_version": ACTION_SCHEMA_VERSION,
                                  "packet_sha256": packet["packet_sha256"],
                                  "dispositions": "one complete disposition per current component"},
        "types": sorted(_COMPONENT_ACTIONS),
        "requirements": {
            "attach_existing_unit": ["component_ids", "unit_id (known ownership unit)"],
            "new_missing_word": ["component_ids", "new_word_id", "bbox_source_xywh", "text_guess", "route"],
            "punctuation_or_nonword": ["component_ids"], "noise_or_fold": ["component_ids"],
            "defer_human": ["component_ids", "reason"],
        },
    }
    expected_fields = {"schema_version", "audit_id", "checkpoint_sha256", "region",
                       "components", "component_hints", "source_context", "evidence",
                       "progress", "legal_actions", "directed_line_hints_are_not_semantic_truth",
                       "packet_sha256"}
    if (set(packet) != expected_fields or packet.get("audit_id") != run["audit_id"] or
            packet.get("region") != region or packet.get("components") != components or
            packet.get("component_hints") != [_component_hint(c, run["ownership_units"], run["lines"])
                                               for c in components] or
            packet.get("source_context") != {"bbox_source_xywh": bounds,
                                             "context_padding_policy": run["policy"]["context_padding_policy"]} or
            packet.get("progress") != _progress(run, state) or
            packet.get("legal_actions") != expected_legal or
            packet.get("directed_line_hints_are_not_semantic_truth") is not True):
        raise EnvelopeError("Cached audit packet does not match the current derived region")
    if set(packet["evidence"]) != {"source_context_claimed_red", "residual_high_contrast_numbered"}:
        raise EnvelopeError("Cached audit evidence inventory is invalid")
    for name, item in packet["evidence"].items():
        if (set(item) != {"path", "file_sha256", "size_wh"} or
                item.get("path") != f"{name}.png" or item.get("size_wh") != bounds[2:]):
            raise EnvelopeError("Cached audit evidence binding is invalid")
        path = _safe_child(packet_dir, item["path"], "packet evidence")
        if not path.is_file() or sha256_file(path) != item["file_sha256"]:
            raise EnvelopeError("Cached audit evidence is missing or changed")
    residual = _load_ref_mask(audit_dir, run["fresh_residual_input_mask"])
    ink = _load_normalized_mask(Path(run["input_bindings"]["normalized_global_ink_mask"]["path"]),
                                tuple(run["input_bindings"]["source"]["size_wh"]))
    with tempfile.TemporaryDirectory(prefix="residual-audit-evidence-check-") as directory:
        expected_evidence = _render_evidence(Path(run["input_bindings"]["source"]["path"]),
                                             residual, ink & ~residual, components, bounds,
                                             Path(directory))
    if packet["evidence"] != expected_evidence:
        raise EnvelopeError("Cached audit evidence is not the deterministic source rendering")


def _packet_hash(packet: Mapping[str, Any]) -> str:
    basis = copy.deepcopy(dict(packet))
    basis.pop("packet_sha256", None)
    basis["legal_actions"]["packet_bound_envelope"]["packet_sha256"] = None
    return _hash(basis)


def _pending_ref(path: Path, relative: str) -> dict[str, Any]:
    with Image.open(path) as image:
        mask = np.asarray(image.convert("L"), dtype=np.uint8) > 0
    return {"path": relative, "file_sha256": sha256_file(path),
            "pixel_sha256": sha256_mask_pixels(mask), "size_wh": list(mask.shape[::-1])}


def _load_ref_mask(root: Path, reference: Mapping[str, Any]) -> np.ndarray:
    relative = reference.get("path")
    path = _safe_child(root, relative, "mask artifact")
    if not path.is_file() or sha256_file(path) != reference.get("file_sha256"):
        raise EnvelopeError(f"Mask artifact is missing or changed: {path}")
    with Image.open(path) as image:
        data = np.asarray(image.convert("L"), dtype=np.uint8)
    if not set(np.unique(data)).issubset({0, 255}):
        raise EnvelopeError("Mask artifact must be binary 0/255")
    mask = data > 0
    if sha256_mask_pixels(mask) != reference.get("pixel_sha256") or list(mask.shape[::-1]) != reference.get("size_wh"):
        raise EnvelopeError(f"Mask artifact pixel binding is stale: {path}")
    return mask


def _load_normalized_mask(path: Path, size_wh: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as image:
        data = np.asarray(image.convert("L"), dtype=np.uint8)
    if data.shape != (size_wh[1], size_wh[0]) or not set(np.unique(data)).issubset({0, 255}):
        raise EnvelopeError("Normalized global ink mask must be binary and match source dimensions")
    return data > 0


def _bbox_distance(left: Mapping[str, int], right: Mapping[str, int]) -> float:
    lx0, ly0 = left["x"], left["y"]; lx1, ly1 = lx0 + left["width"], ly0 + left["height"]
    rx0, ry0 = right["x"], right["y"]; rx1, ry1 = rx0 + right["width"], ry0 + right["height"]
    dx = max(rx0-lx1, lx0-rx1, 0); dy = max(ry0-ly1, ly0-ry1, 0)
    return float(max(dx, dy))


def _bbox_contains(outer: Mapping[str, int], inner: Mapping[str, int]) -> bool:
    return (outer["x"] <= inner["x"] and outer["y"] <= inner["y"] and
            outer["x"] + outer["width"] >= inner["x"] + inner["width"] and
            outer["y"] + outer["height"] >= inner["y"] + inner["height"])


def _safe_child(root: Path, relative: Any, label: str) -> Path:
    if (not isinstance(relative, str) or not relative or Path(relative).is_absolute() or
            ".." in Path(relative).parts):
        raise EnvelopeError(f"{label.capitalize()} path is invalid")
    root_resolved = Path(root).resolve()
    path = (root_resolved / relative).resolve()
    try:
        path.relative_to(root_resolved)
    except ValueError as error:
        raise EnvelopeError(f"{label.capitalize()} path escapes its artifact root") from error
    return path


def _box_dict(value: Any) -> dict[str, int]:
    if not isinstance(value, list) or len(value) != 4 or any(not isinstance(v, int) or isinstance(v, bool) for v in value):
        raise EnvelopeError("Source bbox must contain four integers")
    x, y, width, height = value
    if x < 0 or y < 0 or width < 1 or height < 1: raise EnvelopeError("Source bbox is invalid")
    return {"x":x,"y":y,"width":width,"height":height}


def _valid_bbox(value: Any, size_wh: tuple[int, int]) -> None:
    box = _box_dict(value)
    if box["x"]+box["width"] > size_wh[0] or box["y"]+box["height"] > size_wh[1]:
        raise EnvelopeError("new_missing_word bbox escapes source bounds")


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try: return ImageFont.truetype(candidate, size=size)
        except OSError: pass
    return ImageFont.load_default()


def _read_json(path: Path) -> dict[str, Any]:
    try: value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error: raise EnvelopeError(f"Cannot read valid JSON: {path}") from error
    if not isinstance(value, dict): raise EnvelopeError(f"Expected JSON object: {path}")
    return value


def _write_json_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(canonical_json_bytes(value)); handle.flush(); os.fsync(handle.fileno())
    except FileExistsError as error: raise EnvelopeError(f"Refusing to overwrite append-only file: {path}") from error


def _publish(source: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink(): raise EnvelopeError(f"Refusing to overwrite published directory: {destination}")
    os.rename(source, destination)


def _hash(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _hash_without(value: Mapping[str, Any], field: str) -> str:
    basis = copy.deepcopy(dict(value)); basis.pop(field, None); return _hash(basis)


def _json_stdout(value: Any) -> None:
    print(canonical_json_bytes(value).decode("utf-8"), end="")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic fresh residual audit")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init"); init.add_argument("--ownership-run", type=Path, required=True); init.add_argument("--audit-dir", type=Path, required=True)
    for name in ("next", "status"):
        child = commands.add_parser(name); child.add_argument("--audit-dir", type=Path, required=True)
    apply = commands.add_parser("apply"); apply.add_argument("--audit-dir", type=Path, required=True)
    action = apply.add_mutually_exclusive_group(required=True); action.add_argument("--action"); action.add_argument("--action-file", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "init": result = init_run(ownership_run=args.ownership_run, audit_dir=args.audit_dir)
        elif args.command == "next": result = next_packet(args.audit_dir)
        elif args.command == "status": result = status(args.audit_dir)
        else:
            raw = args.action if args.action is not None else args.action_file.read_text(encoding="utf-8")
            try: payload = json.loads(raw)
            except json.JSONDecodeError as error: raise EnvelopeError("Action is not valid JSON") from error
            result = apply_action(args.audit_dir, payload)
    except (EnvelopeError, OSError, ValueError) as error:
        parser.exit(2, f"error: {error}\n")
    _json_stdout(result); return 0


if __name__ == "__main__":
    raise SystemExit(main())
