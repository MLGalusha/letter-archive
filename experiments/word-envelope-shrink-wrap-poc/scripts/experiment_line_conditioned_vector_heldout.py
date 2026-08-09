#!/usr/bin/env python3
"""Apply the frozen line-conditioned vector policy to pre-existing held-out crops."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from experiment_line_conditioned_vector_ink import (
    DECISION_THRESHOLD,
    METHODS,
    corridor_mask,
    learn_scores,
    render_board,
    structured_score,
    training_seeds,
)
from experiment_page_adaptive_vector_ink import (
    feature_stack,
    load_source,
    method_metrics,
    sha256_array,
    sha256_file,
)


HELDOUT_CROPS = (
    ("know-enough-broad", 1450, 2100, 1200, 350, "broader crop frozen in prior local-recovery experiment; overlaps enough-tight content"),
    ("thank-you-for", 1450, 2600, 1200, 300, "different faint line frozen in prior local-recovery experiment"),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--hybrid-probability", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = load_source(args.source)
    probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    started = time.perf_counter()
    crop_records: dict[str, object] = {}
    for label, x, y, width, height, role in HELDOUT_CROPS:
        crop_started = time.perf_counter()
        local_source = source[y : y + height, x : x + width]
        local_probability = probability[y : y + height, x : x + width]
        anchor = local_probability >= 0.50
        features, auxiliaries = feature_stack(local_source)
        corridor, corridor_bbox = corridor_mask(anchor.shape)
        positive, negative, seed_stats = training_seeds(local_probability, auxiliaries, corridor)
        scores, training = learn_scores(features, positive, negative, corridor)
        structured, structure_record = structured_score(scores["line-prototype"])
        scores["structured-line-prototype"] = structured
        scores["prototype-classifier-agreement"] = (
            (structured >= DECISION_THRESHOLD)
            & (scores["line-hist-gradient-boosting"] >= 0.50)
        ).astype(np.float32)
        metrics = {method: method_metrics(scores[method], anchor, local_probability) for method in METHODS}
        crop_dir = args.output / label
        crop_dir.mkdir(parents=True, exist_ok=True)
        outputs: dict[str, object] = {}
        for method in METHODS:
            score_path = crop_dir / f"{method}.score.float16.npy"
            mask_path = crop_dir / f"{method}.p080.png"
            np.save(score_path, scores[method].astype(np.float16), allow_pickle=False)
            Image.fromarray(np.where(scores[method] >= DECISION_THRESHOLD, 0, 255).astype(np.uint8), "L").save(mask_path)
            outputs[method] = {
                "score_file": score_path.name,
                "score_file_sha256": sha256_file(score_path),
                "mask_file": mask_path.name,
                "mask_file_sha256": sha256_file(mask_path),
            }
        board_path = crop_dir / "heldout-line-conditioned-vector-review.png"
        render_board(label, local_source, anchor, corridor_bbox, scores, metrics, board_path)
        crop_records[label] = {
            "role_frozen_before_this_experiment": role,
            "bbox_xywh": [x, y, width, height],
            "rough_line_corridor_local_bbox_xywh": corridor_bbox,
            "anchor_pixels": int(anchor.sum()),
            "seed_stats": {
                **seed_stats,
                "positive_pixels": int(positive.sum()),
                "negative_pixels": int(negative.sum()),
                "positive_mask_pixel_sha256": sha256_array(positive.astype(np.uint8)),
                "negative_mask_pixel_sha256": sha256_array(negative.astype(np.uint8)),
            },
            "training": training,
            "structured_filter": structure_record,
            "methods": metrics,
            "outputs": outputs,
            "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
            "runtime_seconds": time.perf_counter() - crop_started,
        }
    manifest = {
        "schema_version": "line-conditioned-vector-ink-heldout.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Apply the already-frozen v1 line-conditioned vector parameters unchanged to two crops declared in the earlier local-recovery experiment.",
        "independence_note": "thank-you-for is distinct content; know-enough-broad overlaps the earlier enough-tight content and tests crop-width/context stability, not independent visual generalization.",
        "interpretation_guardrail": "No threshold or feature was changed after viewing these crops; pseudo-label metrics are not human truth and outputs remain proposals.",
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "frozen_code": {
            "line_conditioned_script": "experiment_line_conditioned_vector_ink.py",
            "decision_threshold": DECISION_THRESHOLD,
            "methods": list(METHODS),
        },
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
