#!/usr/bin/env python3
"""Build and score a small interactive word-selection capability ladder.

The acting model receives a crop locator and fallible text hint, but never the
human-owned pixels.  Human masks are opened only by the post-freeze evaluator.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402
from word_envelope.simple_page_selector import (  # noqa: E402
    SimplePageSelector,
    initialize_simple_selector,
    install_dual_ink_layers,
)
from word_envelope.transcript_guided_page_agent import (  # noqa: E402
    TranscriptGuidedPageAgentSession,
    summarize_trace_timing,
)


SCHEMA = "interactive-word-capability-benchmark.v1"
DEFAULT_TARGETS = [
    (99, "You"),
    (98, "so"),
    (97, "many"),
    (96, "time."),
    (95, "I"),
    (94, "guess"),
    (93, "By"),
    (92, "now"),
    (91, "you"),
    (90, "know"),
]
DEFAULT_PROPOSAL_IDS = [
    "007-p02-body-01-01",
    "007-p02-body-01-02",
    "007-p02-body-01-03",
    "007-p02-body-01-04",
    "007-p02-body-01-05",
    "007-p02-body-01-06",
    "007-p02-body-02-01",
    "007-p02-body-02-02",
    "007-p02-body-02-03",
    "007-p02-body-02-04",
]


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _write_new(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(canonical_json_bytes(value) + b"\n")


def _binary(path: Path) -> np.ndarray:
    with Image.open(path) as opened:
        return np.asarray(opened.convert("L"), dtype=np.uint8) > 0


def _save_binary(path: Path, mask: np.ndarray) -> None:
    Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L").save(
        path, format="PNG"
    )


def _crop_bbox(bbox: list[int], size_wh: tuple[int, int]) -> list[int]:
    x, y, width, height = bbox
    pad_x = max(120, round(width * 0.65))
    pad_y = max(90, round(height * 0.90))
    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(size_wh[0], x + width + pad_x)
    y1 = min(size_wh[1], y + height + pad_y)
    return [x0, y0, x1 - x0, y1 - y0]


def _snap_grow_locator_to_clean_components(
    bbox: list[int],
    clean: np.ndarray,
    *,
    labels: np.ndarray | None = None,
    slices: list[tuple[slice, ...] | None] | None = None,
) -> tuple[list[int], dict[str, Any]]:
    """Grow a fallible proposal to plausible clean components crossing it.

    This deliberately uses geometry only. It does not know the human mask or
    transcript. Wildly large components are withheld for agent/cut review.
    """

    x, y, width, height = bbox
    if labels is None or slices is None:
        labels, count = ndimage.label(
            clean, structure=np.ones((3, 3), dtype=np.uint8)
        )
        slices = ndimage.find_objects(labels, max_label=count)
    touching = [
        int(value)
        for value in np.unique(labels[y : y + height, x : x + width])
        if int(value) > 0
    ]
    accepted: list[int] = []
    withheld: list[int] = []
    bounds = [x, y, x + width, y + height]
    for component_id in touching:
        component_slice = slices[component_id - 1]
        if component_slice is None:
            continue
        sy, sx = component_slice
        cx0, cy0, cx1, cy1 = sx.start, sy.start, sx.stop, sy.stop
        component_width = cx1 - cx0
        component_height = cy1 - cy0
        area = int(np.count_nonzero(labels[component_slice] == component_id))
        horizontally_plausible = (
            cx0 >= x - max(35, round(width * 0.55))
            and cx1 <= x + width + max(35, round(width * 0.55))
        )
        vertically_plausible = (
            cy0 >= y - max(55, round(height * 2.25))
            and cy1 <= y + height + max(55, round(height * 2.25))
        )
        size_plausible = (
            component_width <= max(260, round(width * 2.1))
            and component_height <= max(190, round(height * 4.5))
        )
        if area >= 4 and horizontally_plausible and vertically_plausible and size_plausible:
            accepted.append(component_id)
            bounds[0] = min(bounds[0], cx0)
            bounds[1] = min(bounds[1], cy0)
            bounds[2] = max(bounds[2], cx1)
            bounds[3] = max(bounds[3], cy1)
        else:
            withheld.append(component_id)
    padding = 4
    grown = [
        max(0, bounds[0] - padding),
        max(0, bounds[1] - padding),
        min(clean.shape[1], bounds[2] + padding) - max(0, bounds[0] - padding),
        min(clean.shape[0], bounds[3] + padding) - max(0, bounds[1] - padding),
    ]
    return grown, {
        "method": "snap_to_plausible_clean_components_intersecting_proposal",
        "proposal_bbox_xywh": bbox,
        "grown_bbox_xywh": grown,
        "touching_component_count": len(touching),
        "accepted_component_count": len(accepted),
        "withheld_wild_component_count": len(withheld),
    }


def _batch_growth_risk_reasons(growth: Any) -> list[str]:
    reasons: list[str] = []
    if not isinstance(growth, dict):
        return reasons
    proposal_bbox = growth.get("proposal_bbox_xywh")
    grown_bbox = growth.get("grown_bbox_xywh")
    if (
        isinstance(proposal_bbox, list)
        and len(proposal_bbox) == 4
        and isinstance(grown_bbox, list)
        and len(grown_bbox) == 4
    ):
        preceding_vertical_growth = int(proposal_bbox[1]) - int(grown_bbox[1])
        preceding_limit = max(20, round(int(proposal_bbox[3]) * 0.25))
        if preceding_vertical_growth > preceding_limit:
            reasons.append("growth_reaches_preceding_writing_row")
    return reasons


def build(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    if output.exists() or output.is_symlink():
        raise SystemExit(f"Refusing to overwrite {output}")
    human_selector = args.human_selector.resolve()
    state = _read(human_selector / "revisions/r000103/state.json")
    if state.get("word_count") != 100 or state.get("status") != "complete":
        raise SystemExit("The bound human reference is not the completed 100-word run")
    words = {int(word["word_number"]): word for word in state["words"]}
    source_path = human_selector / "source/working.png"
    clean_path = human_selector / "source/clean.selection.mask.png"
    high_path = human_selector / "source/high_recall.selection.mask.png"
    source = Image.open(source_path).convert("RGB")
    clean = _binary(clean_path)
    high = _binary(high_path)
    if np.any(clean & ~high):
        raise SystemExit("Clean ink is not a subset of high-recall ink")

    proposal_by_id: dict[str, dict[str, Any]] = {}
    proposal_record_path: Path | None = None
    if args.locator_source == "software_proposal":
        if args.proposal_record is None:
            raise SystemExit("--proposal-record is required for software locators")
        proposal_record_path = args.proposal_record.resolve()
        proposal_record = _read(proposal_record_path)
        proposal_by_id = {
            str(unit["id"]): unit
            for unit in proposal_record.get("units", [])
            if isinstance(unit, dict) and isinstance(unit.get("id"), str)
        }
        missing = [value for value in DEFAULT_PROPOSAL_IDS if value not in proposal_by_id]
        if missing:
            raise SystemExit(f"Software proposal record is missing targets: {missing}")

    component_labels: np.ndarray | None = None
    component_slices: list[tuple[slice, ...] | None] | None = None
    if args.locator_grow == "component_snap":
        component_labels, component_count = ndimage.label(
            clean, structure=np.ones((3, 3), dtype=np.uint8)
        )
        component_slices = ndimage.find_objects(
            component_labels, max_label=component_count
        )

    output.mkdir(parents=True)
    public_targets: list[dict[str, Any]] = []
    hidden_targets: list[dict[str, Any]] = []
    for order, (word_number, reference_text) in enumerate(DEFAULT_TARGETS, start=1):
        human_word = words[word_number]
        human_bbox = [int(value) for value in human_word["selection_bbox_xywh"]]
        proposal_id = DEFAULT_PROPOSAL_IDS[order - 1]
        if args.locator_source == "software_proposal":
            proposal = proposal_by_id[proposal_id]
            locator_bbox = [
                int(value) for value in proposal["source_axis_aligned_bbox_xywh"]
            ]
            proposal_text = str(proposal.get("transcript", ""))
            locator_role = "prior_integrated_software_candidate_not_truth"
        else:
            locator_bbox = human_bbox
            proposal_text = reference_text
            locator_role = "oracle_extent_for_capability_isolation"
        locator_growth = None
        if args.locator_grow == "component_snap":
            if args.locator_source != "software_proposal":
                raise SystemExit("component_snap is only meaningful for software proposals")
            locator_bbox, locator_growth = _snap_grow_locator_to_clean_components(
                locator_bbox,
                clean,
                labels=component_labels,
                slices=component_slices,
            )
            locator_role = "software_candidate_snap_grown_by_clean_component_geometry"
        crop = _crop_bbox(locator_bbox, source.size)
        x, y, width, height = crop
        target_dir = output / f"target-{order:02d}"
        inputs = target_dir / "inputs"
        inputs.mkdir(parents=True)
        crop_source = inputs / "original.png"
        crop_clean = inputs / "clean.png"
        crop_high = inputs / "high-recall.png"
        source.crop((x, y, x + width, y + height)).save(crop_source, format="PNG")
        clean_crop = clean[y : y + height, x : x + width]
        high_crop = high[y : y + height, x : x + width]
        _save_binary(crop_clean, clean_crop)
        _save_binary(crop_high, high_crop)
        if not np.any(clean_crop):
            raise SystemExit(f"Target {order} has no clean ink")
        if not np.any(high_crop & ~clean_crop):
            # The UI contract requires two genuinely distinct bound layers. Keep
            # the benchmark crop wide enough that this should be rare; fail closed.
            raise SystemExit(f"Target {order} has no high-recall-only evidence")

        selector_dir = target_dir / "selector"
        initialize_simple_selector(
            selector_dir,
            page_id=f"007-p02-oracle-crop-{order:02d}",
            source_path=crop_source,
            strong_mask_path=crop_high,
        )
        install_dual_ink_layers(
            selector_dir,
            clean_mask_path=crop_clean,
            high_recall_mask_path=crop_high,
        )
        transcription = {
            "schema_version": "simple-page-transcription-first-decision.v1",
            "lines": [
                {
                    "line_order": 1,
                    "line_kind": "body",
                    "tokens": [
                        {
                            "token_order": 1,
                            "text": reference_text,
                            "reading_status": "readable",
                        }
                    ],
                }
            ],
        }
        transcription_path = target_dir / "reference-hint.json"
        _write_new(transcription_path, transcription)
        local_focus = [
            locator_bbox[0] - x,
            locator_bbox[1] - y,
            locator_bbox[2],
            locator_bbox[3],
        ]
        session = TranscriptGuidedPageAgentSession(
            selector_dir,
            target_dir / "agent-trace",
            transcription_path,
            focus_bbox_xywh=local_focus if args.software_prefill else None,
        )
        packet = session.current()
        prefill_record = None
        if args.software_prefill:
            labels, _ = ndimage.label(
                clean_crop, structure=np.ones((3, 3), dtype=np.uint8)
            )
            fx, fy, fw, fh = local_focus
            focus_labels = [
                int(value)
                for value in np.unique(labels[fy : fy + fh, fx : fx + fw])
                if int(value) > 0
            ]
            withheld_boundary_labels: list[int] = []
            if args.prefill_mode == "safe_inside":
                safe_labels: list[int] = []
                focus_window = np.zeros_like(clean_crop)
                focus_window[fy : fy + fh, fx : fx + fw] = True
                for component_id in focus_labels:
                    component = labels == component_id
                    if np.any(component & ~focus_window):
                        withheld_boundary_labels.append(component_id)
                    else:
                        safe_labels.append(component_id)
                selected_labels = safe_labels
            else:
                selected_labels = focus_labels
            preview_width, preview_height = session.base.preview_wh
            rectangles: list[list[int]] = []
            for component_id in selected_labels:
                component_y, component_x = np.nonzero(
                    (labels == component_id)
                    & np.pad(
                        np.ones((fh, fw), dtype=bool),
                        ((fy, height - fy - fh), (fx, width - fx - fw)),
                    )
                )
                if not component_x.size:
                    continue
                source_x = int(component_x[len(component_x) // 2])
                source_y = int(component_y[len(component_y) // 2])
                px = min(preview_width - 1, source_x * preview_width // width)
                py = min(preview_height - 1, source_y * preview_height // height)
                rectangles.append([px, py, 1, 1])
            if len(rectangles) > 32:
                raise SystemExit(f"Target {order} has an unusable component prefill")
            if rectangles:
                packet = session.apply(
                    {
                        "guided_turn_sha256": packet["guided_turn_sha256"],
                        "decision": {
                            "schema_version": "simple-page-agent-decision.v3",
                            "action": {
                                "type": "select_or_refine",
                                "ink_variant": "clean",
                                "rectangles": rectangles,
                                "deselect_rectangles": [],
                            },
                        },
                    }
                )
            prefill_record = {
                "method": (
                    "clean_components_fully_inside_locator_boundary_crossers_withheld"
                    if args.prefill_mode == "safe_inside"
                    else "all_clean_8_connected_components_touching_locator"
                ),
                "component_seed_count": len(rectangles),
                "software_action_count": 1 if rectangles else 0,
                "withheld_boundary_component_count": len(withheld_boundary_labels),
                "focus_bbox_xywh": local_focus,
                "focus_gate": packet["current_draft"]["focus_gate"],
            }
        public_targets.append(
            {
                "target_order": order,
                "target_id": (
                    proposal_id
                    if args.locator_source == "software_proposal"
                    else f"oracle-{order:02d}"
                ),
                "reference_text": reference_text,
                "software_proposal_text": proposal_text,
                "crop_bbox_xywh": crop,
                "locator_bbox_xywh": locator_bbox,
                "crop_locator_role": locator_role,
                "locator_growth": locator_growth,
                "agent_trace_dir": str((target_dir / "agent-trace").relative_to(output)),
                "initial_packet_sha256": packet["guided_turn_sha256"],
                "initial_collage_path": str(
                    (target_dir / "agent-trace" / packet["collage"]["path"]).relative_to(output)
                ),
                "software_prefill": prefill_record,
            }
        )
        hidden_targets.append(
            {
                "target_order": order,
                "human_word_number": word_number,
                "human_selection_bbox_xywh": human_bbox,
                "human_selected_mask_path": str(
                    (human_selector / human_word["selected_mask_path"]).resolve()
                ),
                "human_selected_mask_file_sha256": human_word[
                    "selected_mask_file_sha256"
                ],
            }
        )

    public = {
        "schema_version": SCHEMA,
        "page_id": "007-p02",
        "experiment": (
            (
                (
                    (
                        "software_locator_component_snap_safe_prefill_then_agent_verify"
                        if args.locator_grow == "component_snap"
                        else "software_locator_safe_inside_prefill_then_agent_verify"
                    )
                    if args.locator_source == "software_proposal"
                    else "oracle_locator_safe_inside_prefill_then_agent_verify"
                )
                if args.prefill_mode == "safe_inside"
                else "oracle_locator_software_component_prefill_then_agent_verify"
            )
            if args.software_prefill
            else "oracle_crop_same_interactive_loop_as_human"
        ),
        "acting_agent_may_read": True,
        "acting_agent_must_not_read_hidden_evaluation": True,
        "target_count": len(public_targets),
        "targets": public_targets,
        "quality_gate": {
            "per_word_precision_min": 0.90,
            "per_word_recall_min": 0.90,
            "passing_words_min": 9,
            "multiword_envelopes_allowed": 0,
        },
    }
    if proposal_record_path is not None:
        public["software_proposal_source"] = {
            "role": "disposable_location_candidate_not_ground_truth",
            "file_sha256": sha256_file(proposal_record_path),
        }
    public["manifest_sha256"] = _hash_record(public, "manifest_sha256")
    hidden = {
        "schema_version": "interactive-word-capability-hidden-evaluation.v1",
        "epistemic_role": "evaluation_only_after_all_agent_decisions_freeze",
        "human_state_sha256": state["state_sha256"],
        "human_selector_dir": str(human_selector),
        "targets": hidden_targets,
    }
    hidden["hidden_manifest_sha256"] = _hash_record(
        hidden, "hidden_manifest_sha256"
    )
    _write_new(output / "public-manifest.json", public)
    _write_new(output / "evaluation/hidden-manifest.json", hidden)
    print(json.dumps(public, indent=2))


def _place_cropped_mask(
    canvas: np.ndarray, cropped: np.ndarray, bbox: list[int], offset_xy: tuple[int, int]
) -> None:
    x, y, width, height = bbox
    if cropped.shape != (height, width):
        raise SystemExit("A selected mask no longer matches its frozen bbox")
    ox, oy = offset_xy
    x0, y0 = x + ox, y + oy
    canvas[y0 : y0 + height, x0 : x0 + width] |= cropped


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def build_batch_review(args: argparse.Namespace) -> None:
    """Render many current green drafts for one model confirmation turn."""

    output = args.output.resolve()
    public = _read(output / "public-manifest.json")
    batch_dir = output / "batch-review"
    if batch_dir.exists() or batch_dir.is_symlink():
        raise SystemExit(f"Refusing to overwrite {batch_dir}")
    batch_dir.mkdir(parents=True)
    panel_width = 780
    label_height = 48
    panel_height = 242
    columns = 2
    rows = math.ceil(len(public["targets"]) / columns)
    sheet = Image.new("RGB", (panel_width * columns, panel_height * rows), "white")
    draw = ImageDraw.Draw(sheet)
    label_font = _font(26)
    bindings: list[dict[str, Any]] = []
    for index, target in enumerate(public["targets"]):
        order = int(target["target_order"])
        trace = output / target["agent_trace_dir"]
        packet = TranscriptGuidedPageAgentSession.open(trace).current()
        if packet["target_queue"]["status"] != "active":
            raise SystemExit(f"Target {order} is not active")
        collage = Image.open(trace / packet["collage"]["path"]).convert("RGB")
        available_height = panel_height - label_height
        scale = min(panel_width / collage.width, available_height / collage.height)
        resized = collage.resize(
            (max(1, round(collage.width * scale)), max(1, round(collage.height * scale))),
            Image.Resampling.LANCZOS,
        )
        column = index % columns
        row = index // columns
        ox = column * panel_width
        oy = row * panel_height
        sheet.paste(resized, (ox, oy + label_height))
        gate = packet["current_draft"]["focus_gate"]["status"]
        batch_risk_reasons = _batch_growth_risk_reasons(
            target.get("locator_growth")
        )
        if gate != "pass":
            batch_risk_reasons.append("software_focus_gate_blocked")
        batch_eligible = not batch_risk_reasons
        draw.text(
            (ox + 12, oy + 9),
            (
                f'{order:02d}  target: {target["reference_text"]}  '
                + ("batch eligible" if batch_eligible else "FULL-SIZE REVIEW REQUIRED")
            ),
            fill=(20, 63, 72) if batch_eligible else (195, 72, 36),
            font=label_font,
        )
        bindings.append(
            {
                "target_order": order,
                "reference_text": target["reference_text"],
                "guided_turn_sha256": packet["guided_turn_sha256"],
                "focus_gate": packet["current_draft"]["focus_gate"],
                "batch_eligible": batch_eligible,
                "batch_risk_reasons": batch_risk_reasons,
            }
        )
    sheet.save(batch_dir / "batch-review.png", format="PNG")
    packet = {
        "schema_version": "interactive-word-batch-review.v1",
        "purpose": "one_visual_turn_to_approve_good_green_drafts_and_route_only_exceptions",
        "instruction": (
            "For every numbered panel, compare the original word at the cyan locator with "
            "the green clean-ink draft. Approve only when green contains one complete target "
            "word including its visible strokes and punctuation, with no neighboring word ink. "
            "Any target marked FULL-SIZE REVIEW REQUIRED must be needs_fix even if its thumbnail "
            "looks plausible."
        ),
        "image_path": "batch-review.png",
        "targets": bindings,
        "allowed_statuses": ["approve", "needs_fix"],
        "reason_codes": [
            "complete_exact_word",
            "missing_target_ink",
            "neighbor_ink_selected",
            "wrong_occurrence",
            "uncertain_visual_ownership",
        ],
    }
    packet["batch_review_sha256"] = _hash_record(packet, "batch_review_sha256")
    _write_new(batch_dir / "batch-review.json", packet)
    schema = {
        "schema_version": "interactive-word-batch-review-decision-schema.v1",
        "required_shape": {
            "schema_version": "interactive-word-batch-review-decision.v1",
            "batch_review_sha256": packet["batch_review_sha256"],
            "reviews": [
                {
                    "target_order": "each target exactly once",
                    "status": "approve|needs_fix",
                    "reason_code": "one allowed reason code",
                    "brief_reason": "short visible reason",
                }
            ],
        },
    }
    _write_new(batch_dir / "decision-schema.json", schema)
    print(json.dumps(packet, indent=2))


def apply_batch_review(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    public = _read(output / "public-manifest.json")
    batch_dir = output / "batch-review"
    packet = _read(batch_dir / "batch-review.json")
    decision = _read(args.decision.resolve())
    receipt_path = batch_dir / "batch-review-receipt.json"
    if receipt_path.exists() or receipt_path.is_symlink():
        raise SystemExit(f"Refusing to overwrite {receipt_path}")
    if decision.get("schema_version") != "interactive-word-batch-review-decision.v1":
        raise SystemExit("Wrong batch decision schema")
    if decision.get("batch_review_sha256") != packet["batch_review_sha256"]:
        raise SystemExit("Stale batch review decision")
    reviews = decision.get("reviews")
    if not isinstance(reviews, list):
        raise SystemExit("reviews must be an array")
    expected_orders = [int(value["target_order"]) for value in packet["targets"]]
    if [value.get("target_order") for value in reviews] != expected_orders:
        raise SystemExit("Reviews must cover every target exactly once in packet order")
    allowed_reasons = set(packet["reason_codes"])
    target_by_order = {int(value["target_order"]): value for value in public["targets"]}
    prepared: list[tuple[dict[str, Any], TranscriptGuidedPageAgentSession, dict[str, Any]]] = []
    for binding, review in zip(packet["targets"], reviews):
        status = review.get("status")
        if status not in {"approve", "needs_fix"}:
            raise SystemExit("Invalid batch review status")
        if review.get("reason_code") not in allowed_reasons:
            raise SystemExit("Invalid batch reason code")
        if not isinstance(review.get("brief_reason"), str) or not review["brief_reason"].strip():
            raise SystemExit("Every batch review needs a brief visible reason")
        target = target_by_order[int(binding["target_order"])]
        session = TranscriptGuidedPageAgentSession.open(output / target["agent_trace_dir"])
        current = session.current()
        if current["guided_turn_sha256"] != binding["guided_turn_sha256"]:
            raise SystemExit(f'Stale target {binding["target_order"]}')
        if status == "approve" and current["current_draft"]["focus_gate"]["status"] != "pass":
            raise SystemExit(f'Cannot approve blocked target {binding["target_order"]}')
        if status == "approve" and not binding.get("batch_eligible"):
            raise SystemExit(
                f'Cannot batch-approve risky target {binding["target_order"]}'
            )
        prepared.append((review, session, current))
    results: list[dict[str, Any]] = []
    for review, session, current in prepared:
        if review["status"] == "approve":
            next_packet = session.apply(
                {
                    "guided_turn_sha256": current["guided_turn_sha256"],
                    "decision": {
                        "schema_version": "simple-page-agent-decision.v3",
                        "action": {"type": "commit_word"},
                    },
                }
            )
            committed = True
            result_hash = next_packet["guided_turn_sha256"]
        else:
            committed = False
            result_hash = current["guided_turn_sha256"]
        results.append(
            {
                "target_order": review["target_order"],
                "review_status": review["status"],
                "committed": committed,
                "result_guided_turn_sha256": result_hash,
            }
        )
    receipt = {
        "schema_version": "interactive-word-batch-review-receipt.v1",
        "batch_review_sha256": packet["batch_review_sha256"],
        "decision_file_sha256": sha256_file(args.decision.resolve()),
        "results": results,
    }
    receipt["receipt_sha256"] = _hash_record(receipt, "receipt_sha256")
    _write_new(receipt_path, receipt)
    print(json.dumps(receipt, indent=2))


def audit_horizontal_proposals(args: argparse.Namespace) -> None:
    """Geometry-only scale estimate without creating per-word image sessions."""

    proposal_record_path = args.proposal_record.resolve()
    clean_path = args.clean_mask.resolve()
    proposal_record = _read(proposal_record_path)
    clean = _binary(clean_path)
    labels, component_count = ndimage.label(
        clean, structure=np.ones((3, 3), dtype=np.uint8)
    )
    slices = ndimage.find_objects(labels, max_label=component_count)
    records: list[dict[str, Any]] = []
    for unit in proposal_record.get("units", []):
        if not isinstance(unit, dict):
            continue
        line_id = str(unit.get("line_id", ""))
        bbox = unit.get("source_axis_aligned_bbox_xywh")
        if not line_id.startswith("body-") or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        proposal_bbox = [int(value) for value in bbox]
        grown_bbox, growth = _snap_grow_locator_to_clean_components(
            proposal_bbox, clean, labels=labels, slices=slices
        )
        risks = _batch_growth_risk_reasons(growth)
        records.append(
            {
                "unit_id": unit.get("id"),
                "line_id": line_id,
                "proposal_text": unit.get("transcript"),
                "proposal_bbox_xywh": proposal_bbox,
                "grown_bbox_xywh": grown_bbox,
                "batch_eligible_by_current_horizontal_rule": not risks,
                "risk_reasons": risks,
                "growth": growth,
            }
        )
    risky = [value for value in records if value["risk_reasons"]]
    result = {
        "schema_version": "horizontal-software-proposal-risk-audit.v1",
        "scope": "horizontal body-* proposals only",
        "explicit_limit": (
            "The preceding-row heuristic is not valid for rotated, diagonal, vertical, "
            "signature, or postscript streams until their directed reading transform is bound."
        ),
        "proposal_record_file_sha256": sha256_file(proposal_record_path),
        "clean_mask_file_sha256": sha256_file(clean_path),
        "unit_count": len(records),
        "batch_eligible_count": len(records) - len(risky),
        "full_size_review_count": len(risky),
        "full_size_review_rate": round(len(risky) / max(1, len(records)), 6),
        "units": records,
    }
    result["audit_sha256"] = _hash_record(result, "audit_sha256")
    _write_new(args.output_json.resolve(), result)
    print(json.dumps({key: value for key, value in result.items() if key != "units"}, indent=2))


def evaluate(args: argparse.Namespace) -> None:
    output = args.output.resolve()
    public = _read(output / "public-manifest.json")
    hidden = _read(output / "evaluation/hidden-manifest.json")
    evaluation_dir = output / "evaluation/results-v2"
    if evaluation_dir.exists() or evaluation_dir.is_symlink():
        raise SystemExit(f"Refusing to overwrite {evaluation_dir}")
    evaluation_dir.mkdir(parents=True)
    human_selector = Path(hidden["human_selector_dir"])
    source = Image.open(human_selector / "source/working.png").convert("RGB")
    page_agent = np.zeros((source.height, source.width), dtype=bool)
    page_human = np.zeros_like(page_agent)
    records: list[dict[str, Any]] = []
    total_wall_ms = 0
    total_software_ms = 0

    for public_target, hidden_target in zip(public["targets"], hidden["targets"]):
        order = int(public_target["target_order"])
        target_dir = output / f"target-{order:02d}"
        trace = target_dir / "agent-trace"
        packet = TranscriptGuidedPageAgentSession.open(trace).current()
        if packet["target_queue"]["status"] != "complete":
            raise SystemExit(f"Target {order} is not committed")
        selector = SimplePageSelector(target_dir / "selector")
        state = selector.bootstrap()["state"]
        if state["word_count"] != 1:
            raise SystemExit(f"Target {order} does not contain exactly one committed word")
        if state["status"] == "selecting_words":
            state = selector.finish_words(
                {"base_state_sha256": state["state_sha256"]}
            )["state"]
        word = state["words"][0]
        local = np.zeros((selector.size_wh[1], selector.size_wh[0]), dtype=bool)
        selected_path = target_dir / "selector" / word["selected_mask_path"]
        _place_cropped_mask(local, _binary(selected_path), word["selection_bbox_xywh"], (0, 0))
        crop_x, crop_y, _, _ = public_target["crop_bbox_xywh"]
        page_agent[
            crop_y : crop_y + local.shape[0], crop_x : crop_x + local.shape[1]
        ] |= local
        human = np.zeros_like(page_human)
        _place_cropped_mask(
            human,
            _binary(Path(hidden_target["human_selected_mask_path"])),
            hidden_target["human_selection_bbox_xywh"],
            (0, 0),
        )
        page_human |= human
        intersection = int(np.count_nonzero(page_agent & human))
        # Measure this target only, not cumulative page ownership.
        agent_target = np.zeros_like(page_agent)
        agent_target[
            crop_y : crop_y + local.shape[0], crop_x : crop_x + local.shape[1]
        ] = local
        overlap = int(np.count_nonzero(agent_target & human))
        agent_pixels = int(agent_target.sum())
        human_pixels = int(human.sum())
        precision = overlap / max(1, agent_pixels)
        recall = overlap / max(1, human_pixels)
        timing = summarize_trace_timing(trace)
        timing_word = timing["words"][0]
        total_wall_ms += int(timing_word["wall_ms"])
        total_software_ms += int(timing_word["software_ms"])
        polygon = [
            [round(float(px) + crop_x, 3), round(float(py) + crop_y, 3)]
            for px, py in word["envelope_polygon"]
        ]
        software_prefill_actions = int(
            (public_target.get("software_prefill") or {}).get(
                "software_action_count", 0
            )
        )
        records.append(
            {
                "target_order": order,
                "reference_text": public_target["reference_text"],
                "agent_pixels": agent_pixels,
                "human_pixels": human_pixels,
                "overlap_pixels": overlap,
                "precision": round(precision, 6),
                "recall": round(recall, 6),
                "iou": round(overlap / max(1, agent_pixels + human_pixels - overlap), 6),
                "passes_90_90": precision >= 0.90 and recall >= 0.90,
                "total_trace_actions": timing_word["action_count"],
                "agent_actions": timing_word["action_count"] - software_prefill_actions,
                "queue_age_to_commit_ms": timing_word["wall_ms"],
                "software_ms": timing_word["software_ms"],
                "agent_selection_bbox_xywh": [
                    word["selection_bbox_xywh"][0] + crop_x,
                    word["selection_bbox_xywh"][1] + crop_y,
                    word["selection_bbox_xywh"][2],
                    word["selection_bbox_xywh"][3],
                ],
                "fitted_envelope_polygon": polygon,
                "fit_quality": word["fit_quality"],
                "fit_method": word["fit_method"],
            }
        )

    passing = sum(record["passes_90_90"] for record in records)
    result = {
        "schema_version": "interactive-word-capability-evaluation.v1",
        "experiment": public["experiment"],
        "target_count": len(records),
        "passing_90_90": passing,
        "quality_gate_pass": passing >= 9,
        "macro_precision": round(sum(r["precision"] for r in records) / len(records), 6),
        "macro_recall": round(sum(r["recall"] for r in records) / len(records), 6),
        "average_queue_age_to_commit_ms": round(total_wall_ms / len(records)),
        "average_software_ms_per_word": round(total_software_ms / len(records)),
        "words": records,
    }
    result["evaluation_sha256"] = _hash_record(result, "evaluation_sha256")
    _write_new(evaluation_dir / "metrics.json", result)

    overlay = source.copy()
    draw = ImageDraw.Draw(overlay)
    font = _font(28)
    for record in records:
        polygon = [(point[0], point[1]) for point in record["fitted_envelope_polygon"]]
        color = (0, 140, 155) if record["passes_90_90"] else (235, 126, 35)
        draw.line(polygon + [polygon[0]], fill=color, width=7)
        x, y, _, _ = record["agent_selection_bbox_xywh"]
        draw.text((x, max(0, y - 34)), record["reference_text"], fill=color, font=font)
    overlay.save(evaluation_dir / "fitted-boxes-overlay.png", format="PNG")

    # The pass/fail overlay intentionally uses one color, but neighboring cursive
    # envelopes can visually merge into a fake extrusion. Preserve that QA view and
    # also emit a word-identity view whose alternating colors make ownership clear.
    identity_overlay = source.copy()
    identity_draw = ImageDraw.Draw(identity_overlay)
    identity_palette = (
        (0, 140, 155),
        (126, 76, 180),
        (218, 112, 24),
        (42, 135, 72),
        (187, 54, 103),
    )
    for record in records:
        polygon = [(point[0], point[1]) for point in record["fitted_envelope_polygon"]]
        color = identity_palette[(int(record["target_order"]) - 1) % len(identity_palette)]
        identity_draw.line(polygon + [polygon[0]], fill=color, width=7)
        x, y, _, _ = record["agent_selection_bbox_xywh"]
        identity_draw.text(
            (x, max(0, y - 34)), record["reference_text"], fill=color, font=font
        )
    identity_overlay.save(
        evaluation_dir / "fitted-boxes-word-identities.png", format="PNG"
    )

    overlap_rgba = np.asarray(source, dtype=np.uint8).copy()
    shared = page_agent & page_human
    human_only = page_human & ~page_agent
    agent_only = page_agent & ~page_human
    overlap_rgba[shared] = (31, 170, 92)
    overlap_rgba[human_only] = (30, 112, 220)
    overlap_rgba[agent_only] = (220, 55, 47)
    Image.fromarray(overlap_rgba, mode="RGB").save(
        evaluation_dir / "ownership-overlap.png", format="PNG"
    )
    print(json.dumps(result, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--human-selector", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--software-prefill", action="store_true")
    build_parser.add_argument(
        "--locator-source",
        choices=["oracle", "software_proposal"],
        default="oracle",
    )
    build_parser.add_argument("--proposal-record", type=Path)
    build_parser.add_argument(
        "--locator-grow",
        choices=["none", "component_snap"],
        default="none",
    )
    build_parser.add_argument(
        "--prefill-mode",
        choices=["all_touching", "safe_inside"],
        default="all_touching",
    )
    build_parser.set_defaults(func=build)
    evaluate_parser = subparsers.add_parser("evaluate")
    evaluate_parser.add_argument("--output", type=Path, required=True)
    evaluate_parser.set_defaults(func=evaluate)
    batch_parser = subparsers.add_parser("build-batch-review")
    batch_parser.add_argument("--output", type=Path, required=True)
    batch_parser.set_defaults(func=build_batch_review)
    apply_batch_parser = subparsers.add_parser("apply-batch-review")
    apply_batch_parser.add_argument("--output", type=Path, required=True)
    apply_batch_parser.add_argument("--decision", type=Path, required=True)
    apply_batch_parser.set_defaults(func=apply_batch_review)
    audit_parser = subparsers.add_parser("audit-horizontal-proposals")
    audit_parser.add_argument("--proposal-record", type=Path, required=True)
    audit_parser.add_argument("--clean-mask", type=Path, required=True)
    audit_parser.add_argument("--output-json", type=Path, required=True)
    audit_parser.set_defaults(func=audit_horizontal_proposals)
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
