"""Append-only page-wide provisional word ownership for fast human cleanup."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image
from scipy import ndimage

from .human_review_console import ConsoleError
from .io_utils import canonical_json_bytes, sha256_file, sha256_mask_pixels
from .simple_page_selector import SimplePageSelector


MANIFEST_SCHEMA = "provisional-ownership-ledger-manifest.v1"
STATE_SCHEMA = "provisional-ownership-ledger-state.v1"
EVENT_SCHEMA = "provisional-ownership-ledger-event.v1"
ACTION_SCHEMA = "provisional-ownership-ledger-action.v1"
PALETTES = (
    ("#D43D51", "#E57A1F", "#D4A000", "#43A047", "#008C95", "#2474D2", "#7357C7", "#B43FA8"),
    ("#8B1E3F", "#B85C00", "#8A7300", "#167A4A", "#006A80", "#174EA6", "#51349B", "#8A267F"),
)


def _hash_record(value: Mapping[str, Any], key: str) -> str:
    basis = dict(value)
    basis.pop(key, None)
    return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink():
        raise ConsoleError("integrity_error", "An ownership record is missing or unsafe", status=500)
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConsoleError("integrity_error", "An ownership record is unreadable", status=500) from error
    if not isinstance(value, dict):
        raise ConsoleError("integrity_error", "An ownership record has the wrong shape", status=500)
    return value


def _write_new(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def _write_json_new(path: Path, value: Mapping[str, Any]) -> None:
    _write_new(path, canonical_json_bytes(dict(value)) + b"\n")


def _write_json_replace(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        _write_json_new(temporary, value)
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def _save_labels_new(path: Path, labels: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        Image.fromarray(labels.astype(np.uint16, copy=False)).save(temporary, format="PNG")
        with temporary.open("rb+") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _component_inventory(mask: np.ndarray) -> tuple[np.ndarray, list[dict[str, Any]]]:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    labels = labels.astype(np.int32, copy=False)
    slices = ndimage.find_objects(labels)
    areas = np.bincount(labels.ravel(), minlength=count + 1)
    components: list[dict[str, Any]] = []
    for component_id in range(1, count + 1):
        item = slices[component_id - 1]
        if item is None:
            continue
        y_slice, x_slice = item
        crop = labels[y_slice, x_slice] == component_id
        components.append(
            {
                "component_id": component_id,
                "bbox_xywh": [
                    int(x_slice.start),
                    int(y_slice.start),
                    int(x_slice.stop - x_slice.start),
                    int(y_slice.stop - y_slice.start),
                ],
                "pixels": int(areas[component_id]),
                "pixel_sha256": sha256_mask_pixels(crop),
            }
        )
    return labels, components


class ProvisionalOwnershipLedger:
    """Whole-component ownership with replayable arbitrary human corrections."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()
        self._thread_lock = threading.RLock()
        self._manifest = _read_json(self.root / "manifest.json")
        if (
            self._manifest.get("schema_version") != MANIFEST_SCHEMA
            or self._manifest.get("manifest_sha256")
            != _hash_record(self._manifest, "manifest_sha256")
        ):
            raise ConsoleError("integrity_error", "The ownership manifest failed validation", status=500)
        self._labels = self._load_component_labels()
        self._known_component_ids = {
            int(item["component_id"]) for item in self._manifest["components"]
        }

    @classmethod
    def initialize(
        cls,
        root: Path | str,
        selector_dir: Path | str,
        words: Sequence[Mapping[str, Any]],
        *,
        ambiguous_component_ids: Sequence[int] = (),
        provenance: Mapping[str, Any] | None = None,
    ) -> "ProvisionalOwnershipLedger":
        target = Path(root).resolve()
        if target.exists() or target.is_symlink():
            raise ConsoleError("ownership_exists", "The ownership ledger already exists", status=409)
        selector = SimplePageSelector(selector_dir)
        clean = selector._ink_mask("clean")
        labels, components = _component_inventory(clean)
        known = {int(item["component_id"]) for item in components}
        ambiguous = sorted({int(value) for value in ambiguous_component_ids})
        if any(value not in known for value in ambiguous):
            raise ConsoleError("invalid_prefill", "An ambiguous component does not exist")
        manifest = {
            "schema_version": MANIFEST_SCHEMA,
            "selector_manifest_sha256": selector.manifest["manifest_sha256"],
            "selector_session_dir": str(selector.session_dir),
            "source_size_wh": list(selector.size_wh),
            "preview_size_wh": list(selector.manifest["source"]["preview_size_wh"]),
            "clean_mask_pixel_sha256": sha256_mask_pixels(clean),
            "clean_pixels": int(clean.sum()),
            "component_count": len(components),
            "components": components,
            "provenance": dict(provenance or {}),
            "line_palette_period": 2,
            "palette_size": len(PALETTES[0]),
        }
        manifest["manifest_sha256"] = _hash_record(manifest, "manifest_sha256")
        target.mkdir(parents=True)
        try:
            _write_json_new(target / "manifest.json", manifest)
            _save_labels_new(target / "components.labels.png", labels)
            manifest["component_labels_file_sha256"] = sha256_file(
                target / "components.labels.png"
            )
            manifest["manifest_sha256"] = _hash_record(manifest, "manifest_sha256")
            # Manifest publication is still private to an unreferenced new root.
            (target / "manifest.json").unlink()
            _write_json_new(target / "manifest.json", manifest)
            (target / ".ledger.lock").touch()
            ledger = cls(target)
            state = ledger._initial_state(words, ambiguous)
            ledger._publish_initial(state)
            return ledger
        except BaseException:
            import shutil

            shutil.rmtree(target, ignore_errors=True)
            raise

    def _load_component_labels(self) -> np.ndarray:
        path = self.root / "components.labels.png"
        if sha256_file(path) != self._manifest.get("component_labels_file_sha256"):
            raise ConsoleError("integrity_error", "The component inventory changed", status=500)
        with Image.open(path) as image:
            labels = np.asarray(image, dtype=np.int32)
        expected = tuple(reversed(self._manifest["source_size_wh"]))
        if labels.shape != expected:
            raise ConsoleError("integrity_error", "The component inventory has the wrong size", status=500)
        return labels

    def _initial_state(
        self,
        raw_words: Sequence[Mapping[str, Any]],
        ambiguous: Sequence[int],
    ) -> dict[str, Any]:
        owners: dict[str, str | None] = {
            str(component_id): None for component_id in sorted(self._known_component_ids)
        }
        words: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        used_components: set[int] = set()
        for index, raw in enumerate(raw_words, start=1):
            word_id = str(raw.get("word_id") or f"word-{index:04d}")
            if not word_id or word_id in seen_ids:
                raise ConsoleError("invalid_prefill", "Prefill word IDs must be unique")
            seen_ids.add(word_id)
            component_ids = sorted({int(value) for value in raw.get("component_ids", [])})
            if any(value not in self._known_component_ids for value in component_ids):
                raise ConsoleError("invalid_prefill", f"{word_id} names an unknown component")
            if used_components.intersection(component_ids):
                raise ConsoleError("invalid_prefill", "A component is assigned to two words")
            used_components.update(component_ids)
            for component_id in component_ids:
                owners[str(component_id)] = word_id
            line_order = int(raw.get("line_order", 1))
            word_order = int(raw.get("word_order", index))
            slot = (word_order - 1) % len(PALETTES[0])
            words.append(
                {
                    "word_id": word_id,
                    "owner_label": index,
                    "line_id": str(raw.get("line_id", f"line-{line_order:03d}")),
                    "line_order": line_order,
                    "word_order": word_order,
                    "reference_text": raw.get("reference_text"),
                    "palette_family": (line_order - 1) % 2,
                    "palette_slot": slot,
                    "color_hex": PALETTES[(line_order - 1) % 2][slot],
                    "status": "active",
                    "merged_into": None,
                    "component_ids": component_ids,
                    "provenance": dict(raw.get("provenance", {})),
                }
            )
        state = {
            "schema_version": STATE_SCHEMA,
            "revision": 0,
            "parent_state_sha256": None,
            "status": "editing",
            "next_word_number": len(words) + 1,
            "next_owner_label": len(words) + 1,
            "words": words,
            "component_owner": owners,
            "ambiguous_component_ids": list(ambiguous),
            "nontext_component_ids": [],
            "last_event_sha256": None,
        }
        self._validate_state(state)
        return state

    def _word_map(self, state: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
        return {str(word["word_id"]): word for word in state["words"]}

    def _choose_color(
        self,
        words: Sequence[Mapping[str, Any]],
        line_order: int,
        word_order: int,
    ) -> tuple[int, int, str]:
        family = (line_order - 1) % 2
        active = [
            word
            for word in words
            if word.get("status") == "active" and int(word["line_order"]) == line_order
        ]
        ordered = sorted(active, key=lambda word: (int(word["word_order"]), str(word["word_id"])))
        left = [word for word in ordered if int(word["word_order"]) < word_order]
        right = [word for word in ordered if int(word["word_order"]) >= word_order]
        blocked = {
            int(word["palette_slot"])
            for word in ((left[-1:] if left else []) + (right[:1] if right else []))
        }
        for slot in range(len(PALETTES[family])):
            if slot not in blocked:
                return family, slot, PALETTES[family][slot]
        raise ConsoleError("palette_exhausted", "No distinct nearby word color is available")

    def _validate_state(self, state: Mapping[str, Any]) -> None:
        if state.get("schema_version") != STATE_SCHEMA:
            raise ConsoleError("integrity_error", "The ownership state schema is invalid", status=500)
        words = state.get("words")
        owners = state.get("component_owner")
        if not isinstance(words, list) or not isinstance(owners, dict):
            raise ConsoleError("integrity_error", "The ownership state shape is invalid", status=500)
        word_ids = [str(word.get("word_id")) for word in words]
        if len(word_ids) != len(set(word_ids)) or any(not value for value in word_ids):
            raise ConsoleError("integrity_error", "Ownership word IDs are invalid", status=500)
        word_map = self._word_map(state)
        if set(owners) != {str(value) for value in self._known_component_ids}:
            raise ConsoleError("integrity_error", "Ownership does not conserve the component universe", status=500)
        observed: dict[int, str] = {}
        for word in words:
            component_ids = [int(value) for value in word.get("component_ids", [])]
            if len(component_ids) != len(set(component_ids)):
                raise ConsoleError("integrity_error", "A word repeats an owned component", status=500)
            for component_id in component_ids:
                if component_id not in self._known_component_ids or component_id in observed:
                    raise ConsoleError("integrity_error", "A component has multiple owners", status=500)
                observed[component_id] = str(word["word_id"])
        for raw_id, owner in owners.items():
            component_id = int(raw_id)
            if owner is not None and (
                owner not in word_map
                or word_map[owner].get("status") != "active"
                or observed.get(component_id) != owner
            ):
                raise ConsoleError("integrity_error", "The component owner table is inconsistent", status=500)
            if owner is None and component_id in observed:
                raise ConsoleError("integrity_error", "An unassigned component appears in a word", status=500)
        nontext = {int(value) for value in state.get("nontext_component_ids", [])}
        ambiguous = {int(value) for value in state.get("ambiguous_component_ids", [])}
        if not nontext.issubset(self._known_component_ids) or not ambiguous.issubset(self._known_component_ids):
            raise ConsoleError("integrity_error", "A review set names an unknown component", status=500)
        if any(owners[str(value)] is not None for value in nontext):
            raise ConsoleError("integrity_error", "Nontext components may not have word owners", status=500)
        active_by_line: dict[int, list[Mapping[str, Any]]] = {}
        for word in words:
            if word.get("status") != "active":
                if word.get("component_ids"):
                    raise ConsoleError("integrity_error", "A retired word still owns components", status=500)
                continue
            line_order = int(word["line_order"])
            family = (line_order - 1) % 2
            slot = int(word["palette_slot"])
            if (
                int(word["palette_family"]) != family
                or not 0 <= slot < len(PALETTES[family])
                or word["color_hex"] != PALETTES[family][slot]
            ):
                raise ConsoleError("integrity_error", "A word color is not palette-bound", status=500)
            active_by_line.setdefault(line_order, []).append(word)
        for line_words in active_by_line.values():
            ordered = sorted(line_words, key=lambda word: (int(word["word_order"]), str(word["word_id"])))
            for left, right in zip(ordered, ordered[1:]):
                if left["color_hex"] == right["color_hex"]:
                    raise ConsoleError("integrity_error", "Adjacent words share a color", status=500)

    def _owner_labels(self, state: Mapping[str, Any]) -> np.ndarray:
        result = np.zeros(self._labels.shape, dtype=np.uint16)
        for word in state["words"]:
            if word.get("status") != "active" or not word.get("component_ids"):
                continue
            result[np.isin(self._labels, word["component_ids"])] = int(word["owner_label"])
        return result

    def _review_overlay(self, state: Mapping[str, Any]) -> np.ndarray:
        overlay = np.zeros((*self._labels.shape, 4), dtype=np.uint8)
        clean = self._labels > 0
        overlay[clean] = (82, 82, 82, 165)
        nontext = [int(value) for value in state.get("nontext_component_ids", [])]
        if nontext:
            overlay[np.isin(self._labels, nontext)] = (70, 70, 70, 70)
        ambiguous = [int(value) for value in state.get("ambiguous_component_ids", [])]
        if ambiguous:
            overlay[np.isin(self._labels, ambiguous)] = (217, 145, 27, 235)
        for word in state["words"]:
            if word.get("status") != "active" or not word.get("component_ids"):
                continue
            color = str(word["color_hex"])
            rgb = tuple(int(color[index : index + 2], 16) for index in (1, 3, 5))
            overlay[np.isin(self._labels, word["component_ids"])] = (*rgb, 225)
        preview_wh = tuple(
            int(value)
            for value in self._manifest.get(
                "preview_size_wh", self._manifest["source_size_wh"]
            )
        )
        return np.asarray(
            Image.fromarray(overlay, mode="RGBA").resize(
                preview_wh, Image.Resampling.NEAREST
            ),
            dtype=np.uint8,
        )

    def _state_with_asset(self, state: dict[str, Any], revision_dir: Path) -> dict[str, Any]:
        labels_path = revision_dir / "owner-labels.png"
        _save_labels_new(labels_path, self._owner_labels(state))
        state["owner_labels"] = {
            "path": f"revisions/{revision_dir.name}/owner-labels.png",
            "file_sha256": sha256_file(labels_path),
        }
        overlay_path = revision_dir / "review-overlay.png"
        Image.fromarray(self._review_overlay(state), mode="RGBA").save(
            overlay_path, format="PNG", optimize=True
        )
        state["review_overlay"] = {
            "path": f"revisions/{revision_dir.name}/review-overlay.png",
            "file_sha256": sha256_file(overlay_path),
        }
        return state

    @staticmethod
    def _result_body_sha256(state: Mapping[str, Any]) -> str:
        """Bind an event to its result without creating a state/event hash cycle."""

        basis = dict(state)
        basis.pop("state_sha256", None)
        basis["last_event_sha256"] = None
        return hashlib.sha256(canonical_json_bytes(basis)).hexdigest()

    def _publish_initial(self, state: dict[str, Any]) -> None:
        revision_dir = self.root / "revisions" / "r000000"
        revision_dir.mkdir(parents=True)
        state = self._state_with_asset(state, revision_dir)
        state["state_sha256"] = _hash_record(state, "state_sha256")
        _write_json_new(revision_dir / "state.json", state)
        _write_json_replace(
            self.root / "head.json",
            {"revision": 0, "state_sha256": state["state_sha256"]},
        )

    def head(self) -> dict[str, Any]:
        head = _read_json(self.root / "head.json")
        revision = head.get("revision")
        if not isinstance(revision, int) or revision < 0:
            raise ConsoleError("integrity_error", "The ownership head is invalid", status=500)
        state = _read_json(self.root / "revisions" / f"r{revision:06d}" / "state.json")
        if (
            state.get("state_sha256") != head.get("state_sha256")
            or state.get("state_sha256") != _hash_record(state, "state_sha256")
        ):
            raise ConsoleError("integrity_error", "The ownership head state changed", status=500)
        self._validate_state(state)
        return state

    def public_bootstrap(self) -> dict[str, Any]:
        state = self.head()
        active_words = [
            {
                "word_id": word["word_id"],
                "line_id": word["line_id"],
                "line_order": word["line_order"],
                "word_order": word["word_order"],
                "reference_text": word["reference_text"],
                "color_hex": word["color_hex"],
                "component_count": len(word["component_ids"]),
                "selected_pixels": sum(
                    int(self._manifest["components"][component_id - 1]["pixels"])
                    for component_id in word["component_ids"]
                ),
            }
            for word in state["words"]
            if word.get("status") == "active"
        ]
        return {
            "schema_version": "provisional-ownership-ledger-bootstrap.v1",
            "revision": state["revision"],
            "state_sha256": state["state_sha256"],
            "status": state["status"],
            "words": active_words,
            "counts": {
                "active_words": len(active_words),
                "owned_components": sum(
                    owner is not None for owner in state["component_owner"].values()
                ),
                "unassigned_components": sum(
                    owner is None for owner in state["component_owner"].values()
                ),
                "ambiguous_components": len(state["ambiguous_component_ids"]),
                "nontext_components": len(state["nontext_component_ids"]),
            },
            "assets": {
                "review_overlay": f"/api/ownership-asset/review-overlay?revision={state['revision']}"
            },
        }

    def component_at(self, x: int, y: int) -> dict[str, Any]:
        if (
            not isinstance(x, int)
            or isinstance(x, bool)
            or not isinstance(y, int)
            or isinstance(y, bool)
            or not 0 <= x < self._labels.shape[1]
            or not 0 <= y < self._labels.shape[0]
        ):
            raise ConsoleError("invalid_point", "Choose a point inside the page")
        component_id = int(self._labels[y, x])
        state = self.head()
        if component_id == 0:
            return {"component_id": None, "owner_word_id": None, "kind": "background"}
        owner = state["component_owner"][str(component_id)]
        kind = (
            "nontext"
            if component_id in state["nontext_component_ids"]
            else "ambiguous"
            if component_id in state["ambiguous_component_ids"]
            else "owned"
            if owner is not None
            else "unassigned"
        )
        component = self._manifest["components"][component_id - 1]
        return {
            "component_id": component_id,
            "owner_word_id": owner,
            "kind": kind,
            "bbox_xywh": component["bbox_xywh"],
            "pixels": component["pixels"],
        }

    def asset_path(self, kind: str, revision: int) -> tuple[Path, str]:
        if kind != "review-overlay" or not isinstance(revision, int) or revision < 0:
            raise ConsoleError("unknown_asset", "That ownership image does not exist", status=404)
        state = _read_json(self.root / "revisions" / f"r{revision:06d}" / "state.json")
        asset = state.get("review_overlay", {})
        path = (self.root / str(asset.get("path", ""))).resolve()
        if self.root not in path.parents or sha256_file(path) != asset.get("file_sha256"):
            raise ConsoleError("integrity_error", "The ownership image changed", status=500)
        return path, "image/png"

    def _locked(self):
        class Lock:
            def __init__(inner, outer: "ProvisionalOwnershipLedger") -> None:
                inner.outer = outer
                inner.handle = None

            def __enter__(inner):
                inner.outer._thread_lock.acquire()
                inner.handle = (inner.outer.root / ".ledger.lock").open("a+b")
                fcntl.flock(inner.handle.fileno(), fcntl.LOCK_EX)

            def __exit__(inner, exc_type, exc, traceback):
                assert inner.handle is not None
                fcntl.flock(inner.handle.fileno(), fcntl.LOCK_UN)
                inner.handle.close()
                inner.outer._thread_lock.release()

        return Lock(self)

    def apply(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, Mapping) or payload.get("schema_version") != ACTION_SCHEMA:
            raise ConsoleError("invalid_action", "The ownership action schema is invalid")
        with self._locked():
            prior = self.head()
            if payload.get("base_state_sha256") != prior["state_sha256"]:
                raise ConsoleError("stale_action", "Ownership changed before this edit", status=409)
            if prior["status"] != "editing":
                raise ConsoleError("wrong_stage", "Frozen ownership cannot be edited", status=409)
            next_state = json.loads(json.dumps(prior))
            next_state.pop("state_sha256", None)
            next_state.pop("owner_labels", None)
            action_type = payload.get("type")
            if action_type == "transfer":
                self._apply_transfer(next_state, payload)
            elif action_type == "create_word":
                self._apply_create(next_state, payload)
            elif action_type == "split_word":
                self._apply_split(next_state, payload)
            elif action_type == "merge_words":
                self._apply_merge(next_state, payload)
            elif action_type == "mark_nontext":
                self._apply_nontext(next_state, payload)
            elif action_type == "freeze":
                if set(payload) != {"schema_version", "base_state_sha256", "type"}:
                    raise ConsoleError("invalid_action", "Freeze has unexpected fields")
                next_state["status"] = "frozen"
            else:
                raise ConsoleError("invalid_action", "That ownership action is not supported")
            revision = int(prior["revision"]) + 1
            next_state.update(
                {
                    "revision": revision,
                    "parent_state_sha256": prior["state_sha256"],
                }
            )
            self._validate_state(next_state)
            revision_dir = self.root / "revisions" / f"r{revision:06d}"
            revision_dir.mkdir(parents=True)
            next_state = self._state_with_asset(next_state, revision_dir)
            event = {
                "schema_version": EVENT_SCHEMA,
                "revision": revision,
                "parent_state_sha256": prior["state_sha256"],
                "result_body_sha256": self._result_body_sha256(next_state),
                "action": dict(payload),
            }
            event["event_sha256"] = _hash_record(event, "event_sha256")
            next_state["last_event_sha256"] = event["event_sha256"]
            next_state["state_sha256"] = _hash_record(next_state, "state_sha256")
            # The event hash is part of the final state; republish its exact bytes.
            (revision_dir / "state.json").unlink(missing_ok=True)
            _write_json_new(revision_dir / "state.json", next_state)
            _write_json_new(self.root / "events" / f"e{revision:06d}.json", event)
            _write_json_replace(
                self.root / "head.json",
                {"revision": revision, "state_sha256": next_state["state_sha256"]},
            )
            return next_state

    def _payload_component_ids(self, payload: Mapping[str, Any]) -> list[int]:
        values = payload.get("component_ids")
        if not isinstance(values, list) or not values or any(
            not isinstance(value, int) or isinstance(value, bool) for value in values
        ):
            raise ConsoleError("invalid_action", "Choose one or more whole components")
        result = sorted(set(values))
        if len(result) != len(values) or any(value not in self._known_component_ids for value in result):
            raise ConsoleError("invalid_action", "The component selection is invalid")
        return result

    def _transfer(self, state: dict[str, Any], component_ids: Sequence[int], target: str | None) -> None:
        words = self._word_map(state)
        if target is not None and (target not in words or words[target]["status"] != "active"):
            raise ConsoleError("invalid_action", "The target word is unavailable")
        for component_id in component_ids:
            old = state["component_owner"][str(component_id)]
            if old is not None:
                words[old]["component_ids"].remove(component_id)
            state["component_owner"][str(component_id)] = target
            if target is not None:
                words[target]["component_ids"].append(component_id)
                words[target]["component_ids"].sort()
        state["ambiguous_component_ids"] = [
            value for value in state["ambiguous_component_ids"] if value not in component_ids
        ]
        state["nontext_component_ids"] = [
            value for value in state["nontext_component_ids"] if value not in component_ids
        ]

    def _apply_transfer(self, state: dict[str, Any], payload: Mapping[str, Any]) -> None:
        if set(payload) != {"schema_version", "base_state_sha256", "type", "component_ids", "target_word_id"}:
            raise ConsoleError("invalid_action", "Transfer has unexpected fields")
        target = payload.get("target_word_id")
        if target is not None and not isinstance(target, str):
            raise ConsoleError("invalid_action", "Transfer target must be one word or unassigned")
        self._transfer(state, self._payload_component_ids(payload), target)

    def _apply_create(self, state: dict[str, Any], payload: Mapping[str, Any]) -> None:
        required = {"schema_version", "base_state_sha256", "type", "line_id", "line_order", "word_order", "reference_text"}
        if set(payload) != required:
            raise ConsoleError("invalid_action", "Create word has unexpected fields")
        line_order = payload["line_order"]
        word_order = payload["word_order"]
        reference_text = payload["reference_text"]
        if (
            not isinstance(line_order, int)
            or isinstance(line_order, bool)
            or not isinstance(word_order, int)
            or isinstance(word_order, bool)
            or line_order < 1
            or word_order < 1
            or not isinstance(payload["line_id"], str)
            or not payload["line_id"]
            or (reference_text is not None and not isinstance(reference_text, str))
        ):
            raise ConsoleError("invalid_action", "The new word position is invalid")
        for word in state["words"]:
            if word["status"] == "active" and int(word["line_order"]) == line_order and int(word["word_order"]) >= word_order:
                word["word_order"] = int(word["word_order"]) + 1
        family, slot, color = self._choose_color(state["words"], line_order, word_order)
        number = int(state["next_word_number"])
        state["words"].append(
            {
                "word_id": f"word-{number:04d}",
                "owner_label": int(state["next_owner_label"]),
                "line_id": payload["line_id"],
                "line_order": line_order,
                "word_order": word_order,
                "reference_text": payload["reference_text"],
                "palette_family": family,
                "palette_slot": slot,
                "color_hex": color,
                "status": "active",
                "merged_into": None,
                "component_ids": [],
                "provenance": {"kind": "human_created"},
            }
        )
        state["next_word_number"] = number + 1
        state["next_owner_label"] = int(state["next_owner_label"]) + 1

    def _apply_split(self, state: dict[str, Any], payload: Mapping[str, Any]) -> None:
        required = {"schema_version", "base_state_sha256", "type", "source_word_id", "component_ids", "reference_text"}
        if set(payload) != required:
            raise ConsoleError("invalid_action", "Split word has unexpected fields")
        source_id = payload.get("source_word_id")
        words = self._word_map(state)
        if source_id not in words or words[source_id]["status"] != "active":
            raise ConsoleError("invalid_action", "The source word is unavailable")
        component_ids = self._payload_component_ids(payload)
        if any(state["component_owner"][str(value)] != source_id for value in component_ids):
            raise ConsoleError("invalid_action", "Split components must belong to the source word")
        source = words[source_id]
        line_order = int(source["line_order"])
        new_order = int(source["word_order"]) + 1
        create_payload = {
            "schema_version": ACTION_SCHEMA,
            "base_state_sha256": payload["base_state_sha256"],
            "type": "create_word",
            "line_id": source["line_id"],
            "line_order": line_order,
            "word_order": new_order,
            "reference_text": payload["reference_text"],
        }
        self._apply_create(state, create_payload)
        target = f"word-{int(state['next_word_number']) - 1:04d}"
        self._transfer(state, component_ids, target)

    def _apply_merge(self, state: dict[str, Any], payload: Mapping[str, Any]) -> None:
        if set(payload) != {"schema_version", "base_state_sha256", "type", "source_word_id", "target_word_id"}:
            raise ConsoleError("invalid_action", "Merge has unexpected fields")
        source_id, target_id = payload.get("source_word_id"), payload.get("target_word_id")
        words = self._word_map(state)
        if source_id == target_id or source_id not in words or target_id not in words:
            raise ConsoleError("invalid_action", "Choose two different known words")
        source, target = words[source_id], words[target_id]
        if source["status"] != "active" or target["status"] != "active":
            raise ConsoleError("invalid_action", "Only active words can be merged")
        self._transfer(state, list(source["component_ids"]), target_id)
        source["status"] = "merged"
        source["merged_into"] = target_id
        source["component_ids"] = []

    def _apply_nontext(self, state: dict[str, Any], payload: Mapping[str, Any]) -> None:
        if set(payload) != {"schema_version", "base_state_sha256", "type", "component_ids"}:
            raise ConsoleError("invalid_action", "Mark nontext has unexpected fields")
        component_ids = self._payload_component_ids(payload)
        self._transfer(state, component_ids, None)
        state["nontext_component_ids"] = sorted(
            set(state["nontext_component_ids"]).union(component_ids)
        )

    def validate(self) -> dict[str, Any]:
        violations: list[str] = []
        try:
            head = self.head()
            revision = int(head["revision"])
            previous = None
            for index in range(revision + 1):
                state = _read_json(self.root / "revisions" / f"r{index:06d}" / "state.json")
                if (
                    state.get("revision") != index
                    or state.get("parent_state_sha256") != previous
                    or state.get("state_sha256") != _hash_record(state, "state_sha256")
                ):
                    raise ConsoleError("integrity_error", f"Revision {index} failed its hash chain")
                self._validate_state(state)
                asset = state.get("owner_labels", {})
                path = self.root / str(asset.get("path", ""))
                if sha256_file(path) != asset.get("file_sha256"):
                    raise ConsoleError("integrity_error", f"Revision {index} owner labels changed")
                with Image.open(path) as image:
                    observed = np.asarray(image, dtype=np.uint16)
                if not np.array_equal(observed, self._owner_labels(state)):
                    raise ConsoleError("integrity_error", f"Revision {index} owner labels do not replay")
                overlay_asset = state.get("review_overlay", {})
                overlay_path = self.root / str(overlay_asset.get("path", ""))
                if sha256_file(overlay_path) != overlay_asset.get("file_sha256"):
                    raise ConsoleError("integrity_error", f"Revision {index} review overlay changed")
                with Image.open(overlay_path) as image:
                    observed_overlay = np.asarray(image.convert("RGBA"), dtype=np.uint8)
                if not np.array_equal(observed_overlay, self._review_overlay(state)):
                    raise ConsoleError("integrity_error", f"Revision {index} review overlay does not replay")
                if index:
                    event = _read_json(self.root / "events" / f"e{index:06d}.json")
                    if (
                        event.get("revision") != index
                        or event.get("parent_state_sha256") != previous
                        or event.get("result_body_sha256") != self._result_body_sha256(state)
                        or event.get("event_sha256") != _hash_record(event, "event_sha256")
                        or state.get("last_event_sha256") != event["event_sha256"]
                    ):
                        raise ConsoleError("integrity_error", f"Revision {index} event failed validation")
                previous = state["state_sha256"]
        except (ConsoleError, OSError) as error:
            violations.append(str(getattr(error, "message", error)))
        current = self.head() if not violations else None
        return {
            "schema_version": "provisional-ownership-ledger-validation.v1",
            "violation_count": len(violations),
            "violations": violations,
            "revision": current["revision"] if current else None,
            "status": current["status"] if current else None,
            "word_count": (
                sum(word["status"] == "active" for word in current["words"])
                if current
                else None
            ),
            "owned_component_count": (
                sum(owner is not None for owner in current["component_owner"].values())
                if current
                else None
            ),
            "unassigned_component_count": (
                sum(owner is None for owner in current["component_owner"].values())
                if current
                else None
            ),
        }
