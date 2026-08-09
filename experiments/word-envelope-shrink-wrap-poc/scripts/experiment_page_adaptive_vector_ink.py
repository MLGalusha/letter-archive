#!/usr/bin/env python3
"""Learn page-local ink appearance from safe hybrid seeds on acting-safe crops.

This experiment separates source appearance from semantic word ownership. Every
output is a proposal layer; the original source and full-page hybrid anchor are
preserved unchanged, and no completed human annotation is read.
"""

from __future__ import annotations

import argparse
import hashlib
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
from skimage import color, filters, segmentation


FROZEN_CROPS = (
    ("folded-write-to-you", 1700, 1875, 1000, 350, "moderately faint writing near fold/rule evidence"),
    ("enough-tight", 2050, 2100, 600, 300, "almost-erased disconnected word tail"),
    ("acknowledgement-tight", 1750, 3100, 900, 300, "long faint continuation"),
)
METHODS = ("prototype", "hist-gradient-boosting", "random-walker", "two-of-three-consensus")
DECISION_THRESHOLD = 0.80
RANDOM_SEED = 20260809


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def load_source(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def feature_stack(source_rgb: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    rgb = source_rgb.astype(np.float32) / np.float32(255.0)
    lab = color.rgb2lab(rgb).astype(np.float32)
    gray = color.rgb2gray(rgb).astype(np.float32)
    backgrounds = [ndimage.gaussian_filter(gray, sigma, mode="nearest") for sigma in (3.0, 9.0, 25.0)]
    darkness = [np.maximum(background - gray, 0.0).astype(np.float32) for background in backgrounds]
    ridge = filters.sato(gray, sigmas=(1.0, 2.0, 3.0), black_ridges=True).astype(np.float32)
    gradient = filters.sobel(gray).astype(np.float32)
    mean3 = ndimage.gaussian_filter(gray, 3.0, mode="nearest")
    square_mean3 = ndimage.gaussian_filter(gray * gray, 3.0, mode="nearest")
    local_std = np.sqrt(np.maximum(square_mean3 - mean3 * mean3, 0.0)).astype(np.float32)
    features = np.stack(
        (
            lab[:, :, 0] / 100.0,
            lab[:, :, 1] / 50.0,
            lab[:, :, 2] / 50.0,
            gray,
            darkness[0] * 12.0,
            darkness[1] * 12.0,
            darkness[2] * 12.0,
            ridge * 16.0,
            gradient * 8.0,
            local_std * 10.0,
        ),
        axis=2,
    ).astype(np.float32)
    auxiliaries = {
        "gray": gray,
        "broad_darkness": darkness[2],
        "ridge": ridge,
        "gradient": gradient,
        "local_std": local_std,
    }
    return features, auxiliaries


def safe_seed_masks(
    hybrid_probability: np.ndarray,
    auxiliaries: dict[str, np.ndarray],
) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    gray = auxiliaries["gray"]
    darkness = auxiliaries["broad_darkness"]
    ridge = auxiliaries["ridge"]
    local_std = auxiliaries["local_std"]
    positive = hybrid_probability >= 0.95
    limits = {
        "gray_q75": float(np.quantile(gray, 0.75)),
        "darkness_q35": float(np.quantile(darkness, 0.35)),
        "ridge_q40": float(np.quantile(ridge, 0.40)),
        "local_std_q35": float(np.quantile(local_std, 0.35)),
    }
    negative = (
        (hybrid_probability <= 0.0001)
        & (gray >= limits["gray_q75"])
        & (darkness <= limits["darkness_q35"])
        & (ridge <= limits["ridge_q40"])
        & (local_std <= limits["local_std_q35"])
    )
    negative &= ~positive
    return positive, negative, limits


def deterministic_sample(indices: np.ndarray, maximum: int, rng: np.random.Generator) -> np.ndarray:
    if len(indices) <= maximum:
        return indices
    return np.sort(rng.choice(indices, size=maximum, replace=False))


def train_scores(
    features: np.ndarray,
    positive: np.ndarray,
    negative: np.ndarray,
) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    flat = features.reshape(-1, features.shape[2])
    positive_indices = np.flatnonzero(positive)
    negative_indices = np.flatnonzero(negative)
    if len(positive_indices) < 100 or len(negative_indices) < 100:
        raise ValueError("Insufficient safe seeds for page-adaptive learning")
    rng = np.random.default_rng(RANDOM_SEED)
    positive_sample = deterministic_sample(positive_indices, 16000, rng)
    negative_sample = deterministic_sample(negative_indices, 16000, rng)
    train_indices = np.concatenate((positive_sample, negative_sample))
    train_labels = np.concatenate(
        (np.ones(len(positive_sample), dtype=np.uint8), np.zeros(len(negative_sample), dtype=np.uint8))
    )
    scaler = RobustScaler(quantile_range=(10.0, 90.0)).fit(flat[train_indices])
    train_scaled = scaler.transform(flat[train_indices]).astype(np.float32)
    all_scaled = scaler.transform(flat).astype(np.float32)

    positive_vectors = train_scaled[train_labels == 1]
    negative_vectors = train_scaled[train_labels == 0]
    positive_clusters = min(6, len(positive_vectors))
    negative_clusters = min(8, len(negative_vectors))
    positive_model = MiniBatchKMeans(
        n_clusters=positive_clusters, batch_size=2048, n_init=3, random_state=RANDOM_SEED
    ).fit(positive_vectors)
    negative_model = MiniBatchKMeans(
        n_clusters=negative_clusters, batch_size=2048, n_init=3, random_state=RANDOM_SEED
    ).fit(negative_vectors)
    positive_distance = positive_model.transform(all_scaled).min(axis=1)
    negative_distance = negative_model.transform(all_scaled).min(axis=1)
    raw_margin = negative_distance - positive_distance
    seed_margin = raw_margin[train_indices]
    center = float(
        0.5
        * (
            np.quantile(seed_margin[train_labels == 1], 0.10)
            + np.quantile(seed_margin[train_labels == 0], 0.90)
        )
    )
    spread = max(0.05, float(np.quantile(seed_margin, 0.75) - np.quantile(seed_margin, 0.25)))
    prototype_score = expit((raw_margin - center) * (4.0 / spread)).reshape(positive.shape).astype(np.float32)

    x_train, x_test, y_train, y_test = train_test_split(
        train_scaled,
        train_labels,
        test_size=0.25,
        random_state=RANDOM_SEED,
        stratify=train_labels,
    )
    classifier = HistGradientBoostingClassifier(
        learning_rate=0.07,
        max_iter=100,
        max_leaf_nodes=15,
        min_samples_leaf=32,
        l2_regularization=1.0,
        random_state=RANDOM_SEED,
    ).fit(x_train, y_train)
    test_score = classifier.predict_proba(x_test)[:, 1]
    classifier_score = classifier.predict_proba(all_scaled)[:, 1].reshape(positive.shape).astype(np.float32)
    diagnostics = {
        "safe_positive_pixels": int(positive.sum()),
        "safe_negative_pixels": int(negative.sum()),
        "sampled_positive": int(len(positive_sample)),
        "sampled_negative": int(len(negative_sample)),
        "feature_count": int(features.shape[2]),
        "prototype_positive_clusters": positive_clusters,
        "prototype_negative_clusters": negative_clusters,
        "prototype_margin_center": center,
        "prototype_margin_iqr": spread,
        "pseudo_label_holdout_balanced_accuracy_at_0.5": float(
            balanced_accuracy_score(y_test, test_score >= 0.5)
        ),
        "pseudo_label_holdout_roc_auc": float(roc_auc_score(y_test, test_score)),
        "warning": "Holdout metrics reproduce software-derived safe seeds, not human ink truth.",
    }
    return {"prototype": prototype_score, "hist-gradient-boosting": classifier_score}, diagnostics


def random_walker_score(
    auxiliaries: dict[str, np.ndarray],
    prototype_score: np.ndarray,
    positive: np.ndarray,
    negative: np.ndarray,
) -> np.ndarray:
    channels = np.stack(
        (
            auxiliaries["gray"],
            auxiliaries["broad_darkness"] * 8.0,
            auxiliaries["ridge"] * 12.0,
            prototype_score,
        ),
        axis=2,
    ).astype(np.float32)
    labels = np.zeros(positive.shape, dtype=np.uint8)
    labels[positive] = 1
    labels[negative] = 2
    probabilities = segmentation.random_walker(
        channels,
        labels,
        beta=60,
        mode="cg_j",
        tol=1e-6,
        return_full_prob=True,
        channel_axis=-1,
    )
    return np.clip(probabilities[0], 0.0, 1.0).astype(np.float32)


def component_count(mask: np.ndarray) -> int:
    return int(ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))[1])


def method_metrics(score: np.ndarray, anchor: np.ndarray, hybrid_probability: np.ndarray) -> dict[str, object]:
    selected = score >= DECISION_THRESHOLD
    additions = selected & ~anchor
    return {
        "threshold": DECISION_THRESHOLD,
        "selected_pixels": int(selected.sum()),
        "addition_pixels": int(additions.sum()),
        "addition_components": component_count(additions),
        "addition_probability_bands": {
            "hybrid_p_ge_0.20": int((additions & (hybrid_probability >= 0.20)).sum()),
            "hybrid_p_0.05_to_0.20": int(
                (additions & (hybrid_probability >= 0.05) & (hybrid_probability < 0.20)).sum()
            ),
            "hybrid_p_0.01_to_0.05": int(
                (additions & (hybrid_probability >= 0.01) & (hybrid_probability < 0.05)).sum()
            ),
            "hybrid_p_lt_0.01": int((additions & (hybrid_probability < 0.01)).sum()),
        },
        "score_quantiles": {
            str(q): float(np.quantile(score, q)) for q in (0.50, 0.90, 0.95, 0.99, 0.995)
        },
        "score_float32_pixel_sha256": sha256_array(score.astype(np.float32)),
        "selection_mask_pixel_sha256": sha256_array(selected.astype(np.uint8)),
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
    scores: dict[str, np.ndarray],
    metrics: dict[str, object],
    output: Path,
) -> None:
    ordered: list[tuple[str, np.ndarray | None]] = [
        ("source", None),
        ("hybrid anchor", np.zeros_like(anchor, dtype=np.float32)),
        *[(method, scores[method]) for method in METHODS],
    ]
    panel_width = 600
    panel_height = round(source.shape[0] * panel_width / source.shape[1])
    title_height = 70
    board = Image.new("RGB", (panel_width * 3, (panel_height + title_height) * 2), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, score) in enumerate(ordered):
        x0 = (index % 3) * panel_width
        y0 = (index // 3) * (panel_height + title_height)
        if name == "source":
            panel = Image.fromarray(source, "RGB")
            subtitle = "unaltered acting-safe source"
        else:
            panel = overlay(source, anchor, score)
            if name == "hybrid anchor":
                subtitle = f"cyan anchor {anchor.sum():,} px"
            else:
                item = metrics[name]
                subtitle = f"red additions {item['addition_pixels']:,} px | {item['addition_components']:,} comps"
        panel = panel.resize((panel_width, panel_height), Image.Resampling.LANCZOS)
        draw.text((x0 + 10, y0 + 8), f"{label}: {name}", fill="#222222")
        draw.text((x0 + 10, y0 + 36), subtitle, fill="#8a2820" if name != "source" else "#555555")
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
    full_probability = np.load(args.hybrid_probability, allow_pickle=False).astype(np.float32)
    if source.shape[:2] != full_probability.shape:
        raise ValueError("Source and hybrid probability dimensions differ")

    experiment_started = time.perf_counter()
    crop_records: dict[str, object] = {}
    for label, x, y, width, height, role in FROZEN_CROPS:
        crop_started = time.perf_counter()
        crop_dir = args.output / label
        crop_dir.mkdir(parents=True, exist_ok=True)
        local_source = source[y : y + height, x : x + width]
        local_probability = full_probability[y : y + height, x : x + width]
        anchor = local_probability >= 0.50
        features, auxiliaries = feature_stack(local_source)
        positive, negative, seed_limits = safe_seed_masks(local_probability, auxiliaries)
        scores, training = train_scores(features, positive, negative)
        scores["random-walker"] = random_walker_score(
            auxiliaries, scores["prototype"], positive, negative
        )
        votes = np.stack(
            [scores[name] >= DECISION_THRESHOLD for name in ("prototype", "hist-gradient-boosting", "random-walker")],
            axis=0,
        )
        scores["two-of-three-consensus"] = (votes.sum(axis=0) / 3.0).astype(np.float32)

        metrics = {name: method_metrics(scores[name], anchor, local_probability) for name in METHODS}
        output_records: dict[str, object] = {}
        for name in METHODS:
            score_path = crop_dir / f"{name}.score.float16.npy"
            mask_path = crop_dir / f"{name}.p080.png"
            np.save(score_path, scores[name].astype(np.float16), allow_pickle=False)
            Image.fromarray(np.where(scores[name] >= DECISION_THRESHOLD, 0, 255).astype(np.uint8), "L").save(mask_path)
            output_records[name] = {
                "score_file": score_path.name,
                "score_file_sha256": sha256_file(score_path),
                "mask_file": mask_path.name,
                "mask_file_sha256": sha256_file(mask_path),
            }
        positive_path = crop_dir / "safe-positive-seeds.png"
        negative_path = crop_dir / "safe-negative-seeds.png"
        Image.fromarray(np.where(positive, 0, 255).astype(np.uint8), "L").save(positive_path)
        Image.fromarray(np.where(negative, 0, 255).astype(np.uint8), "L").save(negative_path)
        board_path = crop_dir / "vector-ink-review.png"
        render_board(label, local_source, anchor, scores, metrics, board_path)
        crop_records[label] = {
            "role_frozen_before_inference": role,
            "bbox_xywh": [x, y, width, height],
            "anchor_pixels": int(anchor.sum()),
            "seed_limits": seed_limits,
            "seeds": {
                "positive_definition": "hybrid probability >= 0.95",
                "negative_definition": "hybrid <= 0.0001 plus bright, low-darkness, low-ridge, low-texture source quantiles",
                "positive_pixels": int(positive.sum()),
                "negative_pixels": int(negative.sum()),
                "positive_mask_pixel_sha256": sha256_array(positive.astype(np.uint8)),
                "negative_mask_pixel_sha256": sha256_array(negative.astype(np.uint8)),
                "positive_file": positive_path.name,
                "positive_file_sha256": sha256_file(positive_path),
                "negative_file": negative_path.name,
                "negative_file_sha256": sha256_file(negative_path),
            },
            "training": training,
            "methods": metrics,
            "outputs": output_records,
            "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
            "runtime_seconds": time.perf_counter() - crop_started,
        }

    manifest = {
        "schema_version": "page-adaptive-vector-ink.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "page_id": args.page_id,
        "sealed_human_evidence_used": False,
        "selection_rule": "Reuse the same three acting-safe crop roles and source bboxes frozen before earlier crop inference.",
        "interpretation_guardrail": (
            "Pseudo-label metrics measure reproduction of software-derived safe seeds, not human truth. "
            "All selected pixels remain optional ink-appearance proposals; semantic ownership is out of scope."
        ),
        "source": {"path": str(args.source), "file_sha256": sha256_file(args.source)},
        "hybrid_probability": {
            "path": str(args.hybrid_probability),
            "file_sha256": sha256_file(args.hybrid_probability),
        },
        "features": {
            "source_only": True,
            "names": [
                "Lab-L", "Lab-a", "Lab-b", "gray", "darkness-sigma3", "darkness-sigma9",
                "darkness-sigma25", "Sato-ridge-1-2-3", "Sobel-gradient", "local-std-sigma3"
            ],
            "normalization": "RobustScaler 10th-90th percentiles fitted to sampled safe seeds per crop",
        },
        "models": {
            "prototype": "6 positive and 8 negative MiniBatchKMeans prototypes; logisticized nearest-prototype distance margin",
            "hist_gradient_boosting": "100 iterations, 15 leaves, depth inferred, l2=1.0",
            "random_walker": "pixel graph over gray, broad darkness, ridge, and prototype score; beta=60; conjugate-gradient tolerance=1e-6; safe seeds clamped",
            "consensus": "at least two of three method scores >=0.80",
            "random_seed": RANDOM_SEED,
        },
        "crops": crop_records,
        "runtime_seconds": time.perf_counter() - experiment_started,
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
