#!/usr/bin/env python3
"""Re-run frozen Eynollah on naturally enhanced context around one faint word."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
import tensorflow as tf

from experiment_sbb_probability_sweep import predict_foreground_probability


THRESHOLDS = (0.50, 0.20)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def component_count(mask: np.ndarray) -> int:
    count, _, _, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    return int(count - 1)


def threshold_metrics(
    probability: np.ndarray,
    full_page_reference: np.ndarray,
    original_context: np.ndarray,
    faint_proxy: np.ndarray,
    paper_proxy: np.ndarray,
    synthetic_bridge: np.ndarray,
    threshold: float,
) -> dict[str, int | float]:
    candidate = probability >= threshold
    reference = full_page_reference >= threshold
    original = original_context >= threshold
    projected = candidate & ~synthetic_bridge
    return {
        "pixels": int(candidate.sum()),
        "components": component_count(candidate),
        "shared_with_full_page": int((candidate & reference).sum()),
        "full_page_retention": float((candidate & reference).sum() / max(1, reference.sum())),
        "candidate_only_vs_full_page": int((candidate & ~reference).sum()),
        "full_page_only": int((reference & ~candidate).sum()),
        "gained_vs_original_context": int((candidate & ~original).sum()),
        "lost_vs_original_context": int((original & ~candidate).sum()),
        "faint_proxy_selected": int((candidate & faint_proxy).sum()),
        "faint_proxy_recall": float((candidate & faint_proxy).sum() / max(1, faint_proxy.sum())),
        "paper_proxy_selected": int((candidate & paper_proxy).sum()),
        "paper_proxy_rate": float((candidate & paper_proxy).sum() / max(1, paper_proxy.sum())),
        "synthetic_bridge_selected": int((candidate & synthetic_bridge).sum()),
        "exact_source_projected_pixels": int(projected.sum()),
        "exact_source_projected_components": component_count(projected),
        "exact_source_projected_mask_pixel_sha256": sha256_array(projected.astype(np.uint8)),
        "mask_pixel_sha256": sha256_array(candidate.astype(np.uint8)),
    }


def overlay(
    source: np.ndarray,
    probability: np.ndarray,
    baseline: np.ndarray,
    threshold: float,
) -> Image.Image:
    result = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    candidate = probability >= threshold
    reference = baseline >= threshold
    result[candidate & reference] = (0, 190, 205)
    result[candidate & ~reference] = (235, 55, 45)
    result[reference & ~candidate] = (240, 175, 20)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGB")


def render_board(
    source: np.ndarray,
    probabilities: dict[str, np.ndarray],
    metrics: dict[str, object],
    synthetic_bridges: dict[str, np.ndarray],
    threshold: float,
    output: Path,
    project_exact_source: bool = False,
) -> None:
    baseline = probabilities["original context"]
    ordered: list[tuple[str, np.ndarray | None]] = [("unaltered source", None), *probabilities.items()]
    panel_width = 600
    panel_height = 300
    title_height = 82
    columns = 3
    rows = int(np.ceil(len(ordered) / columns))
    board = Image.new("RGB", (panel_width * columns, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, probability) in enumerate(ordered):
        x = (index % columns) * panel_width
        y = (index // columns) * (panel_height + title_height)
        draw.text((x + 10, y + 8), name, fill="#222222")
        if probability is None:
            panel = Image.fromarray(source, "RGB")
            subtitle_1 = "acting-safe source; no overlay"
            subtitle_2 = "cyan shared · red gained · gold lost vs original context"
        else:
            display_probability = probability.copy()
            if project_exact_source:
                display_probability[synthetic_bridges[name]] = 0.0
            panel = overlay(source, display_probability, baseline, threshold)
            item = metrics[name][f"{threshold:.2f}"]
            subtitle_1 = (
                f"gain {item['gained_vs_original_context']:,} · loss {item['lost_vs_original_context']:,} · "
                f"faint {100*item['faint_proxy_recall']:.1f}%"
            )
            if project_exact_source:
                subtitle_2 = (
                    f"source-only {item['exact_source_projected_pixels']:,} px / "
                    f"{item['exact_source_projected_components']} components · removed "
                    f"{item['synthetic_bridge_selected']:,} bridge px"
                )
            else:
                subtitle_2 = (
                    f"paper {100*item['paper_proxy_rate']:.2f}% · "
                    f"full-page retain {100*item['full_page_retention']:.1f}%"
                )
        draw.text((x + 10, y + 34), subtitle_1, fill="#555555")
        draw.text((x + 10, y + 56), subtitle_2, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enhancement-manifest", required=True, type=Path)
    parser.add_argument("--full-page-probability", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    enhancement = json.loads(args.enhancement_manifest.read_text())
    enhancement_root = args.enhancement_manifest.parent
    context = enhancement["eynollah_reinference_context"]
    target_x, target_y, target_width, target_height = context["target_bbox_within_context_xywh"]
    page_x, page_y, _, _ = enhancement["frozen_crop"]["bbox_xywh"]
    full_probability = np.load(args.full_page_probability, allow_pickle=False).astype(np.float32)
    full_page_reference = full_probability[page_y : page_y + target_height, page_x : page_x + target_width]
    faint_proxy = np.asarray(Image.open(enhancement_root / context["target_faint_vector_proxy"]["file"])) == 0
    paper_proxy = np.asarray(Image.open(enhancement_root / context["target_paper_proxy"]["file"])) == 0
    source_page = np.asarray(Image.open(enhancement["source"]["path"]).convert("RGB"))
    source = source_page[page_y : page_y + target_height, page_x : page_x + target_width]

    model_started = time.perf_counter()
    model = tf.keras.models.load_model(args.model, compile=False)
    model_load_seconds = time.perf_counter() - model_started
    probabilities: dict[str, np.ndarray] = {}
    runtimes: dict[str, float] = {}
    input_records: dict[str, object] = {}
    synthetic_bridges: dict[str, np.ndarray] = {}
    for name, item in context["inputs"].items():
        input_path = enhancement_root / item["file"]
        image = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not read {input_path}")
        started = time.perf_counter()
        context_probability = predict_foreground_probability(model, image)
        runtimes[name] = time.perf_counter() - started
        probabilities[name] = context_probability[
            target_y : target_y + target_height,
            target_x : target_x + target_width,
        ]
        bridge_file = item.get("target_synthetic_bridge_file")
        synthetic_bridges[name] = (
            np.asarray(Image.open(enhancement_root / bridge_file)) == 0
            if bridge_file
            else np.zeros((target_height, target_width), dtype=bool)
        )
        input_records[name] = {
            "path": str(input_path),
            "file_sha256": sha256_file(input_path),
            "upstream_expected_file_sha256": item["file_sha256"],
            "target_synthetic_bridge_file": bridge_file,
            "target_synthetic_bridge_pixels": int(synthetic_bridges[name].sum()),
        }

    original_probability = probabilities["original context"]
    metrics: dict[str, object] = {}
    outputs: dict[str, object] = {}
    for name, probability in probabilities.items():
        variant_dir = args.output / name.lower().replace(" ", "-").replace("+", "plus")
        variant_dir.mkdir(parents=True, exist_ok=True)
        probability_path = variant_dir / "target-probability.float16.npy"
        np.save(probability_path, probability.astype(np.float16), allow_pickle=False)
        metrics[name] = {
            f"{threshold:.2f}": threshold_metrics(
                probability,
                full_page_reference,
                original_probability,
                faint_proxy,
                paper_proxy,
                synthetic_bridges[name],
                threshold,
            )
            for threshold in THRESHOLDS
        }
        metrics[name]["probability_probes"] = {
            "faint_proxy_median": float(np.median(probability[faint_proxy])),
            "faint_proxy_q90": float(np.quantile(probability[faint_proxy], 0.90)),
            "paper_proxy_median": float(np.median(probability[paper_proxy])),
            "paper_proxy_q99": float(np.quantile(probability[paper_proxy], 0.99)),
        }
        outputs[name] = {
            "probability_file": str(probability_path.relative_to(args.output)),
            "probability_file_sha256": sha256_file(probability_path),
            "probability_float32_pixel_sha256": sha256_array(probability.astype(np.float32)),
            "runtime_seconds": runtimes[name],
        }
        for threshold in THRESHOLDS:
            mask_path = variant_dir / f"target-p{threshold:.2f}.png"
            Image.fromarray(np.where(probability >= threshold, 0, 255).astype(np.uint8), "L").save(mask_path)
            projected_path = variant_dir / f"target-p{threshold:.2f}-exact-source-projected.png"
            projected = (probability >= threshold) & ~synthetic_bridges[name]
            Image.fromarray(np.where(projected, 0, 255).astype(np.uint8), "L").save(projected_path)
            outputs[name][f"p{threshold:.2f}_file"] = str(mask_path.relative_to(args.output))
            outputs[name][f"p{threshold:.2f}_file_sha256"] = sha256_file(mask_path)
            outputs[name][f"p{threshold:.2f}_exact_source_projected_file"] = str(
                projected_path.relative_to(args.output)
            )
            outputs[name][f"p{threshold:.2f}_exact_source_projected_file_sha256"] = sha256_file(
                projected_path
            )

    review_boards: dict[str, object] = {}
    for threshold in THRESHOLDS:
        board_path = args.output / f"p{threshold:.2f}-enhanced-eynollah-reinference-review.png"
        render_board(source, probabilities, metrics, synthetic_bridges, threshold, board_path)
        projected_board_path = args.output / f"p{threshold:.2f}-exact-source-projected-review.png"
        render_board(
            source,
            probabilities,
            metrics,
            synthetic_bridges,
            threshold,
            projected_board_path,
            project_exact_source=True,
        )
        review_boards[f"{threshold:.2f}"] = {
            "file": board_path.name,
            "file_sha256": sha256_file(board_path),
            "exact_source_projected_file": projected_board_path.name,
            "exact_source_projected_file_sha256": sha256_file(projected_board_path),
        }
    manifest = {
        "schema_version": "enhanced-eynollah-reinference.v1",
        "experiment_status": "measurement_complete_visual_review_pending",
        "sealed_human_evidence_used": False,
        "selection_rule": (
            "Run the frozen 2022-08-16 Eynollah hybrid checkpoint at native scale on one fixed real-context crop "
            f"for these upstream-frozen inputs: {', '.join(context['inputs'].keys())}."
        ),
        "interpretation_guardrail": "Faint-vector and paper masks are acting-safe measurement probes, not truth. A useful enhancement must improve coherent target strokes without proportionally increasing paper selection or deleting reliable full-page anchor ink.",
        "enhancement_manifest": {"path": str(args.enhancement_manifest), "file_sha256": sha256_file(args.enhancement_manifest)},
        "full_page_probability": {"path": str(args.full_page_probability), "file_sha256": sha256_file(args.full_page_probability)},
        "model": {
            "path": str(args.model),
            "saved_model_pb_sha256": sha256_file(args.model / "saved_model.pb"),
            "parameters": int(model.count_params()),
            "input_shape": list(model.input_shape),
            "output_shape": list(model.output_shape),
        },
        "inputs": input_records,
        "metrics": metrics,
        "outputs": outputs,
        "review_boards": review_boards,
        "runtime": {
            "model_load_seconds": model_load_seconds,
            "variant_inference_seconds": runtimes,
            "total_inference_seconds": float(sum(runtimes.values())),
            "device": "CPU",
            "host_arch": platform.machine(),
            "tensorflow": tf.__version__,
        },
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "runtime": manifest["runtime"]}, indent=2))


if __name__ == "__main__":
    main()
