#!/usr/bin/env python3
"""Build deterministic workflow packets for four observed 007/014 failures.

The package is intentionally a state-machine demonstration, not a new set of
image annotations.  Geometry and evidence hashes are labelled simulations;
ledger transitions and supervisor packets are produced by the real v1 ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

from word_envelope.agent_work_ledger import (
    apply_transition,
    bind_transition,
    create_work_ledger,
    next_work_item,
)
from word_envelope.io_utils import canonical_json_bytes, sha256_file, write_json


SOURCE_007_SHA256 = (
    "0bce0fe0b8c4a578b846bf004a36cc7774ecf7cbaeebe4f12106a1b962490312"
)
SOURCE_014_SHA256 = (
    "a52f9665c362880699636c45bd6533767c8ff46df996affd6cfca856ed2b2d69"
)
PACKAGE_SCHEMA_VERSION = "word-workflow-v1-demo-package.v1"


def digest(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def identity_reading(start: Sequence[float], end: Sequence[float]) -> dict[str, Any]:
    return {
        "source_to_upright_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
        "upright_to_source_affine": [1, 0, 0, 0, 1, 0, 0, 0, 1],
        "start_anchor_source_xy": list(start),
        "end_anchor_source_xy": list(end),
        "upright_direction": "left_to_right",
    }


def bottom_to_top_reading(
    start: Sequence[float], end: Sequence[float], *, page_height: int = 1600
) -> dict[str, Any]:
    """Map decreasing source Y to increasing upright X.

    The directed transform is separate from any undirected envelope angle.
    For ``u = page_height - y, v = x``, a bottom-to-top source inscription is
    read left-to-right in its upright board.
    """

    return {
        "source_to_upright_affine": [0, -1, page_height, 1, 0, 0, 0, 0, 1],
        "upright_to_source_affine": [0, 1, 0, -1, 0, page_height, 0, 0, 1],
        "start_anchor_source_xy": list(start),
        "end_anchor_source_xy": list(end),
        "upright_direction": "left_to_right",
    }


def context(line_id: str) -> dict[str, str]:
    return {
        "source_locator_sha256": digest(f"simulated:{line_id}:source-locator"),
        "upright_view_sha256": digest(f"simulated:{line_id}:upright-view"),
        "ownership_overlay_sha256": digest(
            f"simulated:{line_id}:ownership-overlay"
        ),
    }


def transcript_unit(
    identifier: str, text: str, order: int, *, kind: str = "word"
) -> dict[str, Any]:
    return {"id": identifier, "text": text, "kind": kind, "order": order}


def visible_unit(
    identifier: str,
    order: int,
    box: Sequence[int],
    proposed_text: str | None,
) -> dict[str, Any]:
    return {
        "id": identifier,
        "order": order,
        "bbox_source_xywh": list(box),
        "proposed_text": proposed_text,
    }


def alignment_group(
    identifier: str,
    order: int,
    transcript_ids: Sequence[str],
    visible_ids: Sequence[str],
) -> dict[str, Any]:
    return {
        "id": identifier,
        "order": order,
        "transcript_unit_ids": list(transcript_ids),
        "visible_unit_ids": list(visible_ids),
    }


def line_spec(
    *,
    line_id: str,
    reading_order: int,
    directed_reading: Mapping[str, Any],
    transcripts: Sequence[Mapping[str, Any]],
    visible: Sequence[Mapping[str, Any]],
    groups: Sequence[Mapping[str, Any]],
    residuals: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    return {
        "line_id": line_id,
        "reading_order": reading_order,
        "directed_reading": dict(directed_reading),
        "context": context(line_id),
        "transcript_units": list(transcripts),
        "visible_units": list(visible),
        "alignment_groups": list(groups),
        "residual_regions": list(residuals),
    }


def compact_action(
    ledger: Mapping[str, Any], action_type: str, payload: Mapping[str, Any]
) -> dict[str, Any]:
    packet = next_work_item(ledger)
    return {
        "type": action_type,
        "line_id": packet["current"]["line_id"],
        "item_id": packet["current"]["item_id"],
        "payload": dict(payload),
    }


def advance(
    ledger: Mapping[str, Any], action_type: str, payload: Mapping[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    transition = bind_transition(
        ledger, compact_action(ledger, action_type, payload)
    )
    return apply_transition(ledger, transition), transition


def approve_registration(ledger: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    packet = next_work_item(ledger)
    return advance(
        ledger,
        "approve_line_registration",
        {
            "directed_reading_sha256": packet["required_evidence"][
                "directed_reading_sha256"
            ]
        },
    )


def emit_scenario(
    destination: Path,
    *,
    initial: Mapping[str, Any],
    prerequisites: Sequence[tuple[str, Mapping[str, Any]]],
    demonstration: tuple[str, Mapping[str, Any]],
    assertions: Mapping[str, Any],
) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    write_json(destination / "initial-ledger.json", initial)
    current = dict(initial)
    prerequisite_transitions: list[dict[str, Any]] = []
    for action_type, payload in prerequisites:
        if action_type == "approve_line_registration":
            current, transition = approve_registration(current)
        else:
            current, transition = advance(current, action_type, payload)
        prerequisite_transitions.append(transition)
    write_json(destination / "prerequisite-transitions.json", prerequisite_transitions)
    write_json(destination / "current-ledger.json", current)
    current_packet = next_work_item(current)
    assert canonical_json_bytes(current_packet) == canonical_json_bytes(
        next_work_item(current)
    )
    write_json(destination / "current-work-item.json", current_packet)

    action_type, payload = demonstration
    bound = bind_transition(current, compact_action(current, action_type, payload))
    child = apply_transition(current, bound)
    child_packet = next_work_item(child)
    assert canonical_json_bytes(child_packet) == canonical_json_bytes(
        next_work_item(child)
    )
    write_json(destination / "bound-transition.json", bound)
    write_json(destination / "child-ledger.json", child)
    write_json(destination / "child-work-item.json", child_packet)
    result = {
        "initial_revision": initial["revision"],
        "current_revision": current["revision"],
        "current_stage": current_packet["current"]["stage"],
        "current_item_id": current_packet["current"]["item_id"],
        "demonstration_action": action_type,
        "child_revision": child["revision"],
        "child_stage": child_packet["current"]["stage"],
        "child_item_id": child_packet["current"]["item_id"],
        "parent_hash_bound": (
            child["parent_ledger_sha256"] == current["ledger_sha256"]
            and bound["base_ledger_sha256"] == current["ledger_sha256"]
        ),
        "assertions": dict(assertions),
    }
    write_json(destination / "scenario-summary.json", result)
    return {
        "result": result,
        "current": current,
        "child": child,
        "current_packet": current_packet,
        "child_packet": child_packet,
    }


def build_will_to_wish(root: Path) -> dict[str, Any]:
    line = line_spec(
        line_id="007-body-09-will-to-wish",
        reading_order=0,
        directed_reading=identity_reading([520, 2110], [2450, 2110]),
        transcripts=[transcript_unit("007-t-will", "will", 0)],
        visible=[visible_unit("007-v-wish-ink", 0, [1460, 2060, 245, 105], "wish")],
        groups=[alignment_group("007-g-will-wish", 0, ["007-t-will"], ["007-v-wish-ink"])],
    )
    initial = create_work_ledger(
        page_id="007-19430411-L01-02",
        source_sha256=SOURCE_007_SHA256,
        lines=[line],
    )
    result = emit_scenario(
        root / "01-007-will-to-wish",
        initial=initial,
        prerequisites=[
            ("approve_line_registration", {}),
            ("confirm_location", {"evidence_sha256": digest("007:wish:location")}),
        ],
        demonstration=(
            "reject_transcript",
            {
                "transcript_unit_id": "007-t-will",
                "replacement_text": "wish",
                "evidence_sha256": digest("007:visible-wish:evidence"),
            },
        ),
        assertions={
            "same_visible_ink_repeated": True,
            "downstream_geometry_invalidated": True,
            "replacement": "will -> wish",
        },
    )
    child_line = result["child"]["lines"][0]
    assert child_line["transcript_units"][0]["text"] == "wish"
    assert result["current_packet"]["current"] == result["child_packet"]["current"]
    assert child_line["alignment_groups"][0]["ownership_status"] == "blocked"
    return result["result"]


def build_omitted_love(root: Path) -> dict[str, Any]:
    line = line_spec(
        line_id="007-lower-signoff-omitted-love",
        reading_order=0,
        directed_reading=identity_reading([380, 3320], [1550, 3600]),
        transcripts=[transcript_unit("007-t-you", "You", 0)],
        visible=[visible_unit("007-v-you", 1, [1090, 3500, 220, 130], "You")],
        groups=[alignment_group("007-g-you", 1, ["007-t-you"], ["007-v-you"])],
        residuals=[
            {
                "id": "007-r-leading-love",
                "order": 0,
                "bbox_source_xywh": [770, 3425, 290, 145],
                "proposed_text": "Love",
                "evidence_sha256": digest(
                    "simulated:007-lower-signoff-omitted-love:007-r-leading-love"
                ),
            }
        ],
    )
    initial = create_work_ledger(
        page_id="007-19430411-L01-02",
        source_sha256=SOURCE_007_SHA256,
        lines=[line],
    )
    result = emit_scenario(
        root / "02-007-omitted-love-residual",
        initial=initial,
        prerequisites=[
            ("approve_line_registration", {}),
            ("confirm_location", {"evidence_sha256": digest("007:you:location")}),
            ("accept_alignment_group", {"evidence_sha256": digest("007:you:alignment")}),
            (
                "approve_ownership",
                {
                    "owned_mask_sha256": digest("007:you:owned-mask"),
                    "selection_record_sha256": digest("007:you:selection"),
                },
            ),
        ],
        demonstration=(
            "insert_visible_unit",
            {
                "visible_unit": visible_unit(
                    "007-v-love", 0, [770, 3425, 290, 145], "Love"
                ),
                "alignment_group": alignment_group(
                    "007-g-love-unmatched", 0, [], ["007-v-love"]
                ),
                "evidence_sha256": digest("007:residual-is-leading-love"),
            },
        ),
        assertions={
            "residual_prevented_silent_completion": True,
            "inserted_unit": "Love",
            "transcript_unit_created": False,
            "next_step_returns_to_location": True,
        },
    )
    child_line = result["child"]["lines"][0]
    assert result["current_packet"]["current"]["stage"] == "residual"
    assert result["child_packet"]["current"]["stage"] == "location"
    assert result["child_packet"]["current"]["item_id"] == "007-v-love"
    assert child_line["residual_regions"][0]["status"] == "converted"
    return result["result"]


def vertical_pair_line(
    *,
    line_id: str,
    reading_order: int,
    words: Sequence[tuple[str, int]],
    x: int,
) -> dict[str, Any]:
    transcripts = [
        transcript_unit(f"014-t-{word.lower()}", word, order)
        for order, (word, _) in enumerate(words)
    ]
    visible = [
        visible_unit(
            f"014-v-{word.lower()}",
            order,
            [x - 35, y - 24, 70 + len(word) * 8, 48],
            word,
        )
        for order, (word, y) in enumerate(words)
    ]
    groups = [
        alignment_group(
            f"014-g-{word.lower()}",
            order,
            [f"014-t-{word.lower()}"],
            [f"014-v-{word.lower()}"],
        )
        for order, (word, _) in enumerate(words)
    ]
    return line_spec(
        line_id=line_id,
        reading_order=reading_order,
        directed_reading=bottom_to_top_reading(
            [x, words[0][1]], [x, words[-1][1]]
        ),
        transcripts=transcripts,
        visible=visible,
        groups=groups,
    )


def build_014_directed_order(root: Path) -> dict[str, Any]:
    pair_specs = [
        ("014-top-01-we-will", [("We", 147), ("will", 78)], 258),
        ("014-top-02-have-a", [("have", 155), ("a", 91)], 332),
        ("014-top-03-big-fat", [("big", 162), ("fat", 85)], 410),
        ("014-top-04-new-years", [("New", 159), ("Years", 82)], 548),
    ]
    lines = [
        vertical_pair_line(
            line_id=line_id,
            reading_order=order,
            words=words,
            x=x,
        )
        for order, (line_id, words, x) in enumerate(pair_specs)
    ]
    initial = create_work_ledger(
        page_id="014-18780127-L01-04",
        source_sha256=SOURCE_014_SHA256,
        lines=lines,
    )
    result = emit_scenario(
        root / "03-014-clockwise-top-margin-order",
        initial=initial,
        prerequisites=[],
        demonstration=(
            "approve_line_registration",
            {
                "directed_reading_sha256": initial["lines"][0]["directed_reading"][
                    "directed_reading_sha256"
                ]
            },
        ),
        assertions={
            "clockwise_line_order": [
                "We -> will",
                "have -> a",
                "big -> fat",
                "New -> Years",
            ],
            "raw_source_y_sort_is_forbidden": True,
            "we_will_source_y": [147, 78],
            "big_fat_source_y": [162, 85],
            "directed_transform_is_not_envelope_angle": True,
        },
    )
    stored_lines = initial["lines"]
    observed = [
        [unit["proposed_text"] for unit in line["visible_units"]]
        for line in stored_lines
    ]
    assert observed == [["We", "will"], ["have", "a"], ["big", "fat"], ["New", "Years"]]
    assert result["child_packet"]["current"]["item_id"] == "014-v-we"
    return result["result"]


def build_body_10_many_to_many(root: Path) -> dict[str, Any]:
    words = [
        ("felt", "[felt?]", "word"),
        ("like", "like", "word"),
        ("i-1", "I", "word"),
        ("do", "do", "word"),
        ("period", ".", "punctuation"),
        ("i-2", "I", "word"),
        ("guess", "guess", "word"),
        ("you", "you", "word"),
    ]
    transcripts = [
        transcript_unit(f"007-t-{key}", text, order, kind=kind)
        for order, (key, text, kind) in enumerate(words)
    ]
    visible_specs = [
        ("007-v-felt-like", 0, [720, 2300, 420, 115], "[felt?] like"),
        ("007-v-i-do", 1, [1170, 2300, 250, 115], "I do"),
        ("007-v-period", 2, [1430, 2355, 32, 32], "."),
        ("007-v-i-2", 3, [1490, 2300, 52, 115], "I"),
        ("007-v-guess-a", 4, [1560, 2300, 128, 115], "guess-part-a"),
        ("007-v-guess-b", 5, [1680, 2300, 118, 115], "guess-part-b"),
        ("007-v-you", 6, [1820, 2300, 180, 115], "you"),
    ]
    visible = [visible_unit(*spec) for spec in visible_specs]
    groups = [
        alignment_group(
            "007-g-felt-like",
            0,
            ["007-t-felt", "007-t-like"],
            ["007-v-felt-like"],
        ),
        alignment_group(
            "007-g-i-do", 1, ["007-t-i-1", "007-t-do"], ["007-v-i-do"]
        ),
        alignment_group(
            "007-g-period", 2, ["007-t-period"], ["007-v-period"]
        ),
        alignment_group("007-g-i-2", 3, ["007-t-i-2"], ["007-v-i-2"]),
        alignment_group(
            "007-g-guess",
            4,
            ["007-t-guess"],
            ["007-v-guess-a", "007-v-guess-b"],
        ),
        alignment_group("007-g-you", 5, ["007-t-you"], ["007-v-you"]),
    ]
    line = line_spec(
        line_id="007-body-10-many-to-many",
        reading_order=0,
        directed_reading=identity_reading([650, 2360], [2100, 2360]),
        transcripts=transcripts,
        visible=visible,
        groups=groups,
    )
    initial = create_work_ledger(
        page_id="007-19430411-L01-02",
        source_sha256=SOURCE_007_SHA256,
        lines=[line],
    )
    prerequisites: list[tuple[str, Mapping[str, Any]]] = [
        ("approve_line_registration", {})
    ]
    prerequisites.extend(
        (
            "confirm_location",
            {"evidence_sha256": digest(f"007:body10:location:{identifier}")},
        )
        for identifier, *_ in visible_specs
    )
    result = emit_scenario(
        root / "04-007-body-10-many-to-many",
        initial=initial,
        prerequisites=prerequisites,
        demonstration=(
            "accept_alignment_group",
            {"evidence_sha256": digest("007:body10:felt-like:alignment")},
        ),
        assertions={
            "two_transcript_units_to_one_visible_unit": "007-g-felt-like",
            "one_transcript_unit_to_two_visible_units": "007-g-guess",
            "punctuation_only_group": "007-g-period",
            "ownership_is_committed_per_alignment_group": True,
        },
    )
    current_group = result["current"]["lines"][0]["alignment_groups"][0]
    guess_group = result["current"]["lines"][0]["alignment_groups"][4]
    assert len(current_group["transcript_unit_ids"]) == 2
    assert len(current_group["visible_unit_ids"]) == 1
    assert len(guess_group["transcript_unit_ids"]) == 1
    assert len(guess_group["visible_unit_ids"]) == 2
    assert result["child_packet"]["current"]["item_id"] == "007-g-i-do"
    return result["result"]


def readme_text() -> str:
    return """# Word Workflow v1: 007/014 deterministic demo

This package replays four failure modes observed in the two-page experiment
through the real `word-work-ledger.v1` supervisor. Every scenario contains the
revision-zero ledger, prerequisite transition trace, current ledger and work
packet, one hash-bound transition, and the resulting child ledger/work packet.

## Scenarios

1. **007 `will` → `wish`** — transcript rejection increments the transcript
   revision, clears downstream alignment/ownership/envelope state, and returns
   the exact same visible ink group as the next task.
2. **007 omitted `Love` before `You`** — a residual region prevents silent line
   completion. Converting it inserts an unmatched visible unit and returns the
   workflow to location review for `Love`.
3. **014 clockwise top margin** — explicit directed transforms and start/end
   anchors preserve `We → will / have → a / big → fat / New → Years`, even though
   the source Y coordinates decrease inside each pair. No envelope angle or raw
   source-coordinate sort determines semantic order.
4. **007 body 10 many-to-many** — alignment groups represent two transcript
   units sharing one visible unit, one transcript unit spanning two visible
   units, and punctuation-only ink as atomic ownership tasks.

## What this proves

- The supervisor chooses one stable current stage/item and enumerates its legal
  actions; repeated reads of an unchanged ledger are deterministic.
- Every demonstrated mutation is bound to the parent revision, ledger hash,
  and work-item hash, and creates an append-only child revision.
- Location boxes, transcript alignment, ink ownership, residual coverage, and
  envelope state remain separate gates.
- Omitted visible ink and transcript conflicts cannot be hidden by exhausting a
  transcript-token queue.

## What is simulated

The source page IDs and source-image SHA-256 values are real. The compact boxes,
context images, evidence records, masks, and their hashes are deterministic
stand-ins labelled `simulated`; no source image was re-annotated here. Actions
are scripted demonstrations, not live model judgments. This package proves the
workflow semantics and replay bindings, not word-detection accuracy, pixel
ownership quality, or envelope quality. None of the scenarios claims production
completion.
"""


def package_manifest(root: Path) -> dict[str, Any]:
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "MANIFEST.json":
            files.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "sha256": sha256_file(path),
                    "size_bytes": path.stat().st_size,
                }
            )
    basis = {"schema_version": PACKAGE_SCHEMA_VERSION, "files": files}
    return {**basis, "package_sha256": hashlib.sha256(canonical_json_bytes(basis)).hexdigest()}


def build(destination: Path) -> dict[str, Any]:
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent)
    )
    try:
        results = {
            "007_will_to_wish": build_will_to_wish(temporary),
            "007_omitted_love": build_omitted_love(temporary),
            "014_clockwise_top_margin": build_014_directed_order(temporary),
            "007_body_10_many_to_many": build_body_10_many_to_many(temporary),
        }
        summary = {
            "schema_version": PACKAGE_SCHEMA_VERSION,
            "scenario_count": len(results),
            "source_pages": {
                "007-19430411-L01-02": SOURCE_007_SHA256,
                "014-18780127-L01-04": SOURCE_014_SHA256,
            },
            "results": results,
            "all_demonstrations_hash_bound": all(
                item["parent_hash_bound"] for item in results.values()
            ),
            "claim_scope": "workflow semantics only; visual evidence is simulated",
        }
        write_json(temporary / "SUMMARY.json", summary)
        (temporary / "README.md").write_text(
            readme_text(), encoding="utf-8", newline="\n"
        )
        manifest = package_manifest(temporary)
        write_json(temporary / "MANIFEST.json", manifest)
        if destination.exists():
            if destination.name != "word-workflow-v1-demo":
                raise ValueError(f"refusing to replace unexpected destination: {destination}")
            shutil.rmtree(destination)
        temporary.rename(destination)
        return manifest
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/word-workflow-v1-demo"),
    )
    args = parser.parse_args()
    manifest = build(args.output_dir)
    print(manifest["package_sha256"])


if __name__ == "__main__":
    main()
