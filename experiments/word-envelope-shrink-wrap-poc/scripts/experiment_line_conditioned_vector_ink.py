#!/usr/bin/env python3
"""Add rough-line hard negatives and directional structure to page-local vectors."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.special import expit
from sklearn.cluster import MiniBatchKMeans
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import RobustScaler

from experiment_page_adaptive_vector_ink import (
    DECISION_THRESHOLD,
    FROZEN_CROPS,
    RANDOM_SEED,
    component_count,
    feature_stack,
    load_source,
    method_metrics,
    sha256_array,
    sha256_file,
)


METHODS = (
    "line-prototype",
    "line-hist-gradient-boosting",
    "structured-line-prototype",
    "prototype-classifier-agreement",
)
CORRIDOR_TOP_FRACTION = 0.22
CORRIDOR_BOTTOM_FRACTION = 0.78


def corridor_mask(shape: tuple[int, int]) -> tuple[np.ndarray, list[int]]:
    height, width = shape
    top = int(round(height * CORRIDOR_TOP_FRACTION))
    bottom = int(round(height * CORRIDOR_BOTTOM_FRACTION))
    mask = np.zeros(shape, dtype=bool)
    mask[top:bottom, :] = True
    return mask, [0, top, width, bottom - top]


def training_seeds(
    probability: np.ndarray,
    auxiliaries: dict[str, np.ndarray],
    corridor: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, dict[str, float | int]]:
    gray = auxiliaries["gray"]
    darkness = auxiliaries["broad_darkness"]
    ridge = auxiliaries["ridge"]
    gradient = auxiliaries["gradient"]
    local_std = auxiliaries["local_std"]
    positive = (probability >= 0.95) & corridor

    flat = (
        (probability <= 0.0001)
        & (gray >= np.quantile(gray, 0.75))
        & (darkness <= np.quantile(darkness, 0.35))
        & (ridge <= np.quantile(ridge, 0.40))
        & (local_std <= np.quantile(local_std, 0.35))
    )
    # Hard negatives intentionally come only from outside the rough target-line
    # corridor. Low ridge/gradient excludes most real strokes while retaining the
    # mottled paper that fooled the first prototype. Inside-corridor low-model
    # pixels stay unknown so near-erased target writing is never labelled negative.
    positive_ridge_median = float(np.median(ridge[positive]))
    positive_gradient_median = float(np.median(gradient[positive]))
    outside = ~corridor
    hard_paper = (
        outside
        & (probability <= 0.0001)
        & (darkness >= np.quantile(darkness[outside], 0.25))
        & (darkness <= np.quantile(darkness[outside], 0.90))
        & (local_std >= np.quantile(local_std[outside], 0.30))
        & (ridge <= positive_ridge_median)
        & (gradient <= positive_gradient_median)
    )
    negative = (flat | hard_paper) & ~positive
    return positive, negative, {
        "flat_negative_pixels": int(flat.sum()),
        "hard_paper_negative_pixels": int(hard_paper.sum()),
        "positive_ridge_median": positive_ridge_median,
        "positive_gradient_median": positive_gradient_median,
    }


def sample_indices(indices: np.ndarray, maximum: int, rng: np.random.Generator) -> np.ndarray:
    if len(indices) <= maximum:
        return indices
    return np.sort(rng.choice(indices, size=maximum, replace=False))


def learn_scores(
    features: np.ndarray,
    positive: np.ndarray,
    negative: np.ndarray,
    corridor: np.ndarray,
) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    flat_features = features.reshape(-1, features.shape[2])
    rng = np.random.default_rng(RANDOM_SEED)
    positive_indices = sample_indices(np.flatnonzero(positive), 16000, rng)
    negative_indices = sample_indices(np.flatnonzero(negative), 20000, rng)
    labels = np.concatenate(
        (np.ones(len(positive_indices), dtype=np.uint8), np.zeros(len(negative_indices), dtype=np.uint8))
    )
    indices = np.concatenate((positive_indices, negative_indices))
    scaler = RobustScaler(quantile_range=(10.0, 90.0)).fit(flat_features[indices])
    sampled = scaler.transform(flat_features[indices]).astype(np.float32)
    all_scaled = scaler.transform(flat_features).astype(np.float32)

    positive_vectors = sampled[labels == 1]
    negative_vectors = sampled[labels == 0]
    positive_model = MiniBatchKMeans(
        n_clusters=min(6, len(positive_vectors)), batch_size=2048, n_init=3, random_state=RANDOM_SEED
    ).fit(positive_vectors)
    negative_model = MiniBatchKMeans(
        n_clusters=min(12, len(negative_vectors)), batch_size=2048, n_init=3, random_state=RANDOM_SEED
    ).fit(negative_vectors)
    positive_distance = positive_model.transform(all_scaled).min(axis=1)
    negative_distance = negative_model.transform(all_scaled).min(axis=1)
    margin = negative_distance - positive_distance
    sampled_margin = margin[indices]
    center = float(
        0.5
        * (
            np.quantile(sampled_margin[labels == 1], 0.10)
            + np.quantile(sampled_margin[labels == 0], 0.90)
        )
    )
    spread = max(0.05, float(np.quantile(sampled_margin, 0.75) - np.quantile(sampled_margin, 0.25)))
    prototype = expit((margin - center) * (4.0 / spread)).reshape(positive.shape).astype(np.float32)
    prototype[~corridor] = 0.0

    x_train, x_test, y_train, y_test = train_test_split(
        sampled, labels, test_size=0.25, random_state=RANDOM_SEED, stratify=labels
    )
    classifier = HistGradientBoostingClassifier(
        learning_rate=0.06,
        max_iter=120,
        max_leaf_nodes=15,
        min_samples_leaf=48,
        l2_regularization=2.0,
        random_state=RANDOM_SEED,
    ).fit(x_train, y_train)
    test_score = classifier.predict_proba(x_test)[:, 1]
    classifier_score = classifier.predict_proba(all_scaled)[:, 1].reshape(positive.shape).astype(np.float32)
    classifier_score[~corridor] = 0.0
    return {
        "line-prototype": prototype,
        "line-hist-gradient-boosting": classifier_score,
    }, {
        "sampled_positive": int(len(positive_indices)),
        "sampled_negative": int(len(negative_indices)),
        "prototype_margin_center": center,
        "prototype_margin_iqr": spread,
        "pseudo_label_holdout_balanced_accuracy_at_0.5": float(
            balanced_accuracy_score(y_test, test_score >= 0.5)
        ),
        "pseudo_label_holdout_roc_auc": float(roc_auc_score(y_test, test_score)),
        "warning": "Metrics reproduce software-derived seeds; they are not human ink accuracy.",
    }


def structured_score(prototype: np.ndarray) -> tuple[np.ndarray, dict[str, float | int]]:
    candidate = prototype >= DECISION_THRESHOLD
    # Horizontal support is a weak writing-line prior, not a pixel invention.
    # The final mask retains only original vector-selected source positions.
    kernel = np.ones((5, 25), dtype=np.float32) / np.float32(125.0)
    directional_density = ndimage.convolve(candidate.astype(np.float32), kernel, mode="nearest")
    supported = candidate & (directional_density >= 0.08)
    grouped = ndimage.binary_closing(supported, structure=np.ones((3, 9), dtype=bool))
    labels, count = ndimage.label(grouped, structure=np.ones((3, 3), dtype=np.uint8))
    keep = np.zeros(count + 1, dtype=bool)
    for component_id in range(1, count + 1):
        group = labels == component_id
        ys, xs = np.nonzero(group)
        original_pixels = int((candidate & group).sum())
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        if original_pixels >= 12 and width >= 6 and height >= 2:
            keep[component_id] = True
    retained = candidate & keep[labels]
    score = np.where(retained, prototype, 0.0).astype(np.float32)
    return score, {
        "directional_kernel_hw": [5, 25],
        "minimum_directional_density": 0.08,
        "group_closing_hw": [3, 9],
        "minimum_original_pixels_per_group": 12,
        "minimum_group_width": 6,
        "minimum_group_height": 2,
        "raw_candidate_pixels": int(candidate.sum()),
        "retained_pixels": int(retained.sum()),
        "retained_fraction": float(retained.sum() / max(1, candidate.sum())),
    }


def overlay(source: np.ndarray, anchor: np.ndarray, score: np.ndarray | None) -> Image.Image:
    result = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    result[anchor] = (0, 190, 205)
    if score is not None:
        additions = (score >= DECISION_THRESHOLD) & ~anchor
        result[additions] = (235, 55, 45)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_board(
    label: str,
    source: np.ndarray,
    anchor: np.ndarray,
    corridor_bbox: list[int],
    scores: dict[str, np.ndarray],
    metrics: dict[str, object],
    output: Path,
) -> None:
    ordered: list[tuple[str, np.ndarray | None]] = [
        ("source + rough line corridor", None),
        ("hybrid anchor", np.zeros_like(anchor, dtype=np.float32)),
        *[(method, scores[method]) for method in METHODS],
    ]
    panel_width = 600
    panel_height = round(source.shape[0] * panel_width / source.shape[1])
    title_height = 72
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, score) in enumerate(ordered):
        x0 = (index % 3) * panel_width
        y0 = (index // 3) * (panel_height + title_height)
        if name.startswith("source"):
            panel = Image.fromarray(source, "RGB")
            panel_draw = ImageDraw.Draw(panel)
            bx, by, bw, bh = corridor_bbox
            panel_draw.rectangle((bx, by, bx + bw - 1, by + bh - 1), outline=(20, 160, 180), width=2)
            subtitle = "cyan rectangle is geometry prior; source unchanged"
        else:
            panel = overlay(source, anchor, score)
            if name == "hybrid anchor":
                subtitle = f"cyan anchor {anchor.sum():,} px"
            else:
                item = metrics[name]
                subtitle = f"red additions {item['addition_pixels']:,} px | {item['addition_components']:,} comps"
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{label}: {name}", fill="#222222")
        draw.text((x0 + 10, y0 + 37), subtitle, fill="#8a2820" if not name.startswith("source") else "#555555")
        board.paste(panel, (x0, y0 + title_height))
    board.save(output, optimize=True)


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
    for label, x, y, width, height, role in FROZEN_CROPS:
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
        agreement_mask = (
            (structured >= DECISION_THRESHOLD)
            & (scores["line-hist-gradient-boosting"] >= 0.50)
        )
        scores["prototype-classifier-agreement"] = agreement_mask.astype(np.float32)
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
        board_path = crop_dir / "line-conditioned-vector-review.png"
        render_board(label, local_source, anchor, corridor_bbox, scores, metrics, board_path)
        crop_records[label] = {
            "role_frozen_before_inference": role,
            "bbox_xywh": [x, y, width, height],
            "rough_line_corridor_local_bbox_xywh": corridor_bbox,
            "rough_line_corridor_rule": [CORRIDOR_TOP_FRACTION, CORRIDOR_BOTTOM_FRACTION],
            "anchor_pixels": int(anchor.sum()),
            "seed_definitions": {
                "positive": "hybrid >=0.95 inside rough line corridor",
                "flat_negative": "bright low-model low-darkness low-ridge low-texture source pixels",
                "hard_paper_negative": "hybrid <=0.0001 outside corridor, moderate darkness/texture, below positive median ridge and gradient",
                "inside_corridor_low_probability": "unknown; never labelled background",
            },
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
        "schema_version": "line-conditioned-vector-ink.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Reuse the three previously frozen acting-safe crops; freeze a centered 22%-78% rough line corridor before model fitting.",
        "interpretation_guardrail": (
            "The corridor is rough geometry, not human ownership truth. Low-probability pixels inside it remain unknown. "
            "Outputs are optional proposals and are not optimized by pixel count or pseudo-label accuracy."
        ),
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {"path": str(args.hybrid_probability), "file_sha256": sha256_file(args.hybrid_probability)},
        "upstream_code": "experiment_page_adaptive_vector_ink.py source-only ten-feature stack",
        "hard_negative_change": "Add paper-texture negatives only outside the rough target-line corridor; leave its low-model pixels unknown.",
        "structure_change": "Retain original vector-selected source positions only when they have directional line support and belong to a sufficiently large grouped component.",
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
