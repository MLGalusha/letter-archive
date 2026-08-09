#!/usr/bin/env python3
"""Compare untried source-only faint-ink extractors on one frozen hard word.

Configurations are fixed before proxy measurement.  The faint and paper proxies are
software-derived diagnostics, not ground truth, and no sealed human page is read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.filters import threshold_sauvola


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(array: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(array).tobytes()).hexdigest()


def black_mask(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L")) < 128


def save_mask(mask: np.ndarray, path: Path) -> None:
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").save(path, optimize=True)


def components(mask: np.ndarray) -> int:
    return int(cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)[0] - 1)


def metrics(mask: np.ndarray, faint: np.ndarray, paper: np.ndarray, anchor: np.ndarray) -> dict[str, object]:
    return {
        "pixels": int(mask.sum()),
        "components": components(mask),
        "faint_proxy_selected": int((mask & faint).sum()),
        "faint_proxy_recall": float((mask & faint).sum() / max(1, faint.sum())),
        "paper_proxy_selected": int((mask & paper).sum()),
        "paper_proxy_rate": float((mask & paper).sum() / max(1, paper.sum())),
        "anchor_selected": int((mask & anchor).sum()),
        "anchor_retention": float((mask & anchor).sum() / max(1, anchor.sum())),
        "mask_uint8_pixel_sha256": sha256_array(mask.astype(np.uint8)),
    }


def normalized_gray(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0


def su_local_contrast(gray: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    """Su/Lu/Tan-inspired local max-min contrast and local darkness consensus."""
    votes = np.zeros(gray.shape, dtype=np.uint8)
    records = []
    for window in (15, 31, 61):
        local_min = ndimage.minimum_filter(gray, size=window, mode="nearest")
        local_max = ndimage.maximum_filter(gray, size=window, mode="nearest")
        local_mean = ndimage.uniform_filter(gray, size=window, mode="nearest")
        contrast = (local_max - local_min) / np.maximum(local_max + local_min, 1e-4)
        darkness = (local_mean - gray) / np.maximum(local_max - local_min, 0.02)
        contrast_u8 = np.clip(contrast * 255.0 / max(1e-6, np.quantile(contrast, 0.995)), 0, 255).astype(np.uint8)
        otsu, _ = cv2.threshold(contrast_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contrast_threshold = float(otsu / 255.0 * np.quantile(contrast, 0.995))
        vote = (contrast >= contrast_threshold) & (darkness >= 0.14)
        votes += vote
        records.append({"window": window, "contrast_otsu_threshold": contrast_threshold, "pixels": int(vote.sum())})
    return votes >= 2, {"windows": records, "minimum_votes": 2}


def multi_sauvola(gray: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    votes = np.zeros(gray.shape, dtype=np.uint8)
    records = []
    for window in (15, 31, 61, 121):
        threshold = threshold_sauvola(gray, window_size=window, k=0.18, r=0.5)
        vote = gray < threshold
        votes += vote
        records.append({"window": window, "pixels": int(vote.sum())})
    return votes >= 3, {"windows": records, "k": 0.18, "minimum_votes": 3}


def multiscale_blackhat(gray: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    gray_u8 = np.round(gray * 255).astype(np.uint8)
    response = np.zeros_like(gray_u8)
    records = []
    for diameter in (5, 9, 15):
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter))
        blackhat = cv2.morphologyEx(gray_u8, cv2.MORPH_BLACKHAT, kernel)
        response = np.maximum(response, blackhat)
        records.append({"diameter": diameter, "maximum": int(blackhat.max())})
    otsu, _ = cv2.threshold(response, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    threshold = max(3, int(otsu))
    return response >= threshold, {"kernels": records, "otsu": int(otsu), "applied_threshold": threshold}


def multiscale_retinex_z(gray: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    best = np.zeros_like(gray)
    records = []
    for sigma in (3.0, 8.0, 20.0, 45.0):
        background = cv2.GaussianBlur(gray, (0, 0), sigma)
        residual = np.maximum(background - gray, 0.0)
        local_noise = cv2.GaussianBlur(np.abs(gray - cv2.GaussianBlur(gray, (0, 0), 1.0)), (0, 0), sigma)
        score = residual / np.maximum(local_noise, 0.003)
        best = np.maximum(best, score)
        records.append({"sigma": sigma, "q99": float(np.quantile(score, 0.99))})
    return best >= 1.35, {"scales": records, "z_threshold": 1.35}


def exact_group_filter(
    candidate: np.ndarray,
    anchor: np.ndarray,
    vote_count: np.ndarray,
    mode: str,
) -> tuple[np.ndarray, dict[str, object]]:
    """Use temporary closing only to group; retain candidate source pixels exactly."""
    if mode == "conservative":
        grouped = ndimage.binary_closing(candidate, structure=np.ones((3, 7), dtype=bool))
        minimum_votes, minimum_pixels, minimum_width = 3, 5, 4
        reach = ndimage.binary_dilation(anchor, iterations=4)
    else:
        grouped = ndimage.binary_closing(candidate, structure=np.ones((5, 11), dtype=bool))
        minimum_votes, minimum_pixels, minimum_width = 2, 7, 5
        reach = ndimage.binary_dilation(anchor, iterations=7)
    labels, count = ndimage.label(grouped, structure=np.ones((3, 3), dtype=np.uint8))
    output = np.zeros_like(candidate)
    accepted_touching = 0
    accepted_standalone = 0
    for component_id in range(1, count + 1):
        group = labels == component_id
        exact = candidate & group
        ys, xs = np.nonzero(exact)
        if len(xs) < minimum_pixels:
            continue
        width = int(xs.max() - xs.min() + 1)
        height = int(ys.max() - ys.min() + 1)
        median_votes = float(np.median(vote_count[exact]))
        touches = bool((group & reach).any())
        stroke_like = width >= minimum_width and height >= 2 and max(width, height) / max(1, min(width, height)) >= 1.35
        standalone = stroke_like and median_votes >= minimum_votes
        if touches or standalone:
            output |= exact
            accepted_touching += int(touches)
            accepted_standalone += int(standalone and not touches)
    return output, {
        "mode": mode,
        "synthetic_grouping_pixels_retained": 0,
        "temporary_groups": int(count),
        "accepted_touching": accepted_touching,
        "accepted_standalone": accepted_standalone,
        "minimum_votes": minimum_votes,
        "minimum_exact_pixels": minimum_pixels,
        "minimum_width": minimum_width,
    }


def overlay(source: np.ndarray, anchor: np.ndarray, addition: np.ndarray) -> Image.Image:
    canvas = source.astype(np.float32) * 0.62 + 255.0 * 0.38
    canvas[anchor] = (0, 180, 195)
    canvas[addition & ~anchor] = (235, 65, 45)
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")


def render_board(source: np.ndarray, methods: dict[str, np.ndarray], anchor: np.ndarray, stats: dict[str, object], output: Path) -> None:
    ordered = list(methods.items())
    panel_width, panel_height, title_height = source.shape[1], source.shape[0], 72
    columns = 3
    rows = int(np.ceil(len(ordered) / columns))
    board = Image.new("RGB", (panel_width * columns, (panel_height + title_height) * rows), "#f3eee4")
    draw = ImageDraw.Draw(board)
    for index, (name, mask) in enumerate(ordered):
        x = index % columns * panel_width
        y = index // columns * (panel_height + title_height)
        item = stats[name]
        panel = Image.fromarray(source, "RGB") if name == "original source" else overlay(source, anchor, mask)
        draw.text((x + 10, y + 8), name, fill="#222222")
        if name == "original source":
            subtitle = "cyan = anchor · red = candidate addition on other panels"
        else:
            subtitle = (
                f"{item['pixels']:,} px · {item['components']} comps · faint proxy "
                f"{100*item['faint_proxy_recall']:.1f}% · paper {item['paper_proxy_selected']}"
            )
        draw.text((x + 10, y + 38), subtitle, fill="#555555")
        board.paste(panel, (x, y + title_height))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--natural-root", type=Path, required=True)
    parser.add_argument("--full-page-probability", type=Path, required=True)
    parser.add_argument("--reconnect-probability", type=Path, required=True)
    parser.add_argument("--one-pass-mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    manifest = json.loads((args.natural_root / "experiment.json").read_text())
    x, y, width, height = manifest["frozen_crop"]["bbox_xywh"]
    source = np.asarray(Image.open(args.natural_root / "original.png").convert("RGB"))
    boosted = np.asarray(Image.open(args.natural_root / "page-ink-vector-boost.png").convert("RGB"))
    faint = black_mask(args.natural_root / manifest["eynollah_reinference_context"]["target_faint_vector_proxy"]["file"])
    paper = black_mask(args.natural_root / manifest["eynollah_reinference_context"]["target_paper_proxy"]["file"])
    full_probability = np.load(args.full_page_probability, allow_pickle=False).astype(np.float32)[y:y+height, x:x+width]
    reconnect_probability = np.load(args.reconnect_probability, allow_pickle=False).astype(np.float32)
    anchor = full_probability >= 0.50
    reconnect = reconnect_probability >= 0.50
    one_pass = black_mask(args.one_pass_mask)

    original_gray = normalized_gray(source)
    boosted_gray = normalized_gray(boosted)
    su, su_record = su_local_contrast(boosted_gray)
    sauvola, sauvola_record = multi_sauvola(boosted_gray)
    blackhat, blackhat_record = multiscale_blackhat(boosted_gray)
    retinex, retinex_record = multiscale_retinex_z(original_gray)
    corridor = np.zeros(anchor.shape, dtype=bool)
    corridor[round(0.22 * height):round(0.78 * height)] = True
    primitive_masks = [su & corridor, sauvola & corridor, blackhat & corridor, retinex & corridor]
    vote_count = sum(mask.astype(np.uint8) for mask in primitive_masks)
    conservative_candidate = (vote_count >= 3) & corridor
    balanced_candidate = (vote_count >= 2) & corridor
    conservative, conservative_record = exact_group_filter(conservative_candidate, reconnect, vote_count, "conservative")
    balanced, balanced_record = exact_group_filter(balanced_candidate, reconnect | conservative, vote_count, "balanced")
    composed_conservative = reconnect | conservative
    composed_balanced = reconnect | conservative | balanced

    methods = {
        "original source": np.zeros_like(anchor),
        "full-page Eynollah p0.50": anchor,
        "source-reconnect Eynollah p0.50": reconnect,
        "prior one-pass composition": one_pass,
        "Su local contrast": su & corridor,
        "multi-window Sauvola": sauvola & corridor,
        "multiscale blackhat": blackhat & corridor,
        "multiscale Retinex z": retinex & corridor,
        "new composed conservative": composed_conservative,
        "new composed balanced": composed_balanced,
    }
    metric_records = {name: metrics(mask, faint, paper, anchor) for name, mask in methods.items() if name != "original source"}
    metric_records["original source"] = {
        "pixels": 0, "components": 0, "faint_proxy_recall": 0.0, "paper_proxy_selected": 0
    }
    outputs = {}
    for name, mask in methods.items():
        if name == "original source":
            continue
        path = args.output / f"{name.lower().replace(' ', '-').replace('.', '')}.mask.png"
        save_mask(mask, path)
        outputs[name] = {"file": path.name, "file_sha256": sha256_file(path)}
    board_path = args.output / "faint-ink-classical-challengers.png"
    render_board(source, methods, anchor, metric_records, board_path)
    record = {
        "schema_version": "faint-ink-classical-challengers.v1",
        "evidence_visibility": "acting-safe-source-and-software-proxies-only",
        "sealed_human_evidence_used": False,
        "frozen_crop": manifest["frozen_crop"],
        "selection_rule": "All method families and constants fixed before proxy measurement.",
        "guardrail": "Faint/paper proxies are prior software evidence, not ground truth. Visual structure, contamination, fragmentation, and anchor retention remain independent checks.",
        "methods": {
            "su_local_contrast": su_record,
            "multi_window_sauvola": sauvola_record,
            "multiscale_blackhat": blackhat_record,
            "multiscale_retinex_z": retinex_record,
            "conservative_grouping": conservative_record,
            "balanced_grouping": balanced_record,
        },
        "metrics": metric_records,
        "inputs": {
            "natural_manifest_sha256": sha256_file(args.natural_root / "experiment.json"),
            "full_page_probability_sha256": sha256_file(args.full_page_probability),
            "reconnect_probability_sha256": sha256_file(args.reconnect_probability),
            "one_pass_mask_sha256": sha256_file(args.one_pass_mask),
        },
        "outputs": outputs,
        "board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "runtime_seconds": time.perf_counter() - started,
    }
    record_path = args.output / "experiment.json"
    record_path.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"metrics": metric_records, "manifest_sha256": sha256_file(record_path)}))


if __name__ == "__main__":
    main()
