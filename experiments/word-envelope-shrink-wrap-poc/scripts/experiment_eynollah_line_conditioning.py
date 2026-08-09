#!/usr/bin/env python3
"""Filter Eynollah candidate ink through independent Kraken line geometry."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, find_objects, label


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mask_pixel_sha256(mask: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(mask.astype(np.uint8)).tobytes()).hexdigest()


def line_union(layout: dict[str, Any], shape_hw: tuple[int, int]) -> np.ndarray:
    raster = Image.new("1", (shape_hw[1], shape_hw[0]), 0)
    draw = ImageDraw.Draw(raster)
    for line in layout["lines"]:
        points = [(round(point["x"]), round(point["y"])) for point in line["boundary"]]
        if len(points) >= 3:
            draw.polygon(points, fill=1)
    return np.asarray(raster, dtype=bool)


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius == 0:
        return mask.copy()
    return distance_transform_edt(~mask) <= radius


def render_mask(mask: np.ndarray) -> Image.Image:
    raster = np.where(mask, 0, 255).astype(np.uint8)
    return Image.fromarray(raster, mode="L").convert("RGB")


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    image = image.copy()
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", (width, height), "white")
    panel.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
    return panel


def source_with_lines(source: Image.Image, layout: dict[str, Any]) -> Image.Image:
    result = source.copy()
    draw = ImageDraw.Draw(result)
    colors = ("#00a6a6", "#df3c3c", "#c337b5", "#f08a00")
    for index, line in enumerate(layout["lines"]):
        points = [(point["x"], point["y"]) for point in line["boundary"]]
        if len(points) >= 3:
            draw.line(points + [points[0]], fill=colors[index % len(colors)], width=5)
        baseline = [(point["x"], point["y"]) for point in line["baseline"]]
        if len(baseline) >= 2:
            draw.line(baseline, fill=colors[index % len(colors)], width=6)
    return result


def render_board(
    source: Image.Image,
    raw: np.ndarray,
    layout: dict[str, Any],
    results: list[tuple[int, np.ndarray]],
    output: Path,
) -> None:
    labels_and_images: list[tuple[str, Image.Image]] = [
        ("Independent Kraken line polygons + baselines", source_with_lines(source, layout)),
        (f"Raw hybrid p >= 0.50 ({int(raw.sum()):,} px)", render_mask(raw)),
    ]
    labels_and_images.extend(
        (
            f"Line polygons + {radius}px ({int(mask.sum()):,} px; {mask.sum() / raw.sum():.1%} retained)",
            render_mask(mask),
        )
        for radius, mask in results
    )
    cell_w, cell_h, header_h = 620, 720, 62
    board = Image.new("RGB", (cell_w * 3, (cell_h + header_h) * 2), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=17)
    for index, (label, image) in enumerate(labels_and_images):
        row, column = divmod(index, 3)
        x, y = column * cell_w, row * (cell_h + header_h)
        draw.text((x + 14, y + 18), label, font=font, fill="#1f2526")
        board.paste(fit(image, cell_w - 20, cell_h - 10), (x + 10, y + header_h))
    board.save(output, optimize=True)


def whole_component_selection(
    raw: np.ndarray,
    corridor: np.ndarray,
    minimum_overlap_fraction: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    labels, component_count = label(raw, structure=np.ones((3, 3), dtype=np.uint8))
    selected = np.zeros_like(raw)
    accepted_count = 0
    component_records: list[dict[str, Any]] = []
    for component_id, slices in enumerate(find_objects(labels), 1):
        if slices is None:
            continue
        component = labels[slices] == component_id
        area = int(component.sum())
        overlap = int((component & corridor[slices]).sum())
        fraction = overlap / area
        accepted = fraction >= minimum_overlap_fraction
        if accepted:
            selected[slices] |= component
            accepted_count += 1
        if area >= 100:
            component_records.append(
                {
                    "component_id": component_id,
                    "area_pixels": area,
                    "corridor_overlap_pixels": overlap,
                    "corridor_overlap_fraction": fraction,
                    "accepted": accepted,
                    "bbox_xyxy": [slices[1].start, slices[0].start, slices[1].stop, slices[0].stop],
                }
            )
    component_records.sort(key=lambda item: item["area_pixels"], reverse=True)
    return selected, {
        "component_count": int(component_count),
        "accepted_component_count": accepted_count,
        "rejected_component_count": int(component_count - accepted_count),
        "components_ge_100px": component_records,
    }


def render_component_board(
    source: Image.Image,
    raw: np.ndarray,
    layout: dict[str, Any],
    clipped: np.ndarray,
    radius: int,
    results: list[tuple[float, np.ndarray]],
    output: Path,
) -> None:
    labels_and_images: list[tuple[str, Image.Image]] = [
        ("Independent Kraken line geometry", source_with_lines(source, layout)),
        (f"Raw hybrid p >= 0.50 ({int(raw.sum()):,} px)", render_mask(raw)),
        (f"Pixel-clipped at +{radius}px ({int(clipped.sum()):,} px)", render_mask(clipped)),
    ]
    labels_and_images.extend(
        (
            f"Whole components; overlap >= {fraction:.0%} ({int(mask.sum()):,} px)",
            render_mask(mask),
        )
        for fraction, mask in results
    )
    cell_w, cell_h, header_h = 620, 720, 62
    board = Image.new("RGB", (cell_w * 3, (cell_h + header_h) * 2), "#f7f3ea")
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=17)
    for index, (panel_label, image) in enumerate(labels_and_images):
        row, column = divmod(index, 3)
        x, y = column * cell_w, row * (cell_h + header_h)
        draw.text((x + 14, y + 18), panel_label, font=font, fill="#1f2526")
        board.paste(fit(image, cell_w - 20, cell_h - 10), (x + 10, y + header_h))
    board.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--hybrid-mask", type=Path, required=True)
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-id", required=True)
    parser.add_argument("--radii", default="0,15,30,60")
    parser.add_argument("--component-radius", type=int, default=30)
    parser.add_argument("--component-overlap-fractions", default="0.10,0.25,0.50")
    args = parser.parse_args()
    started = time.perf_counter()
    args.output.mkdir(parents=True, exist_ok=True)

    source = Image.open(args.source).convert("RGB")
    hybrid = np.asarray(Image.open(args.hybrid_mask).convert("L")) == 0
    layout = json.loads(args.layout.read_text(encoding="utf-8"))
    if source.size != (hybrid.shape[1], hybrid.shape[0]):
        raise ValueError("Source and hybrid mask dimensions differ")
    if layout["image"]["width"] != source.width or layout["image"]["height"] != source.height:
        raise ValueError("Kraken prepared coordinate space does not match source dimensions")

    base = line_union(layout, hybrid.shape)
    radii = [int(value) for value in args.radii.split(",")]
    results: list[tuple[int, np.ndarray]] = []
    records: dict[str, Any] = {}
    for radius in radii:
        corridor = dilate(base, radius)
        selected = hybrid & corridor
        path = args.output / f"hybrid-p050-line-polygon-plus-{radius:03d}px.png"
        render_mask(selected).convert("L").save(path, optimize=True)
        records[str(radius)] = {
            "file": path.name,
            "file_sha256": sha256_file(path),
            "mask_pixel_sha256": mask_pixel_sha256(selected),
            "selected_pixels": int(selected.sum()),
            "retained_fraction_of_raw_hybrid": float(selected.sum() / hybrid.sum()),
            "excluded_raw_hybrid_pixels": int((hybrid & ~corridor).sum()),
            "corridor_pixels": int(corridor.sum()),
            "corridor_page_fraction": float(corridor.mean()),
        }
        results.append((radius, selected))

    board_path = args.output / "line-conditioning-review.png"
    render_board(source, hybrid, layout, results, board_path)

    component_corridor = dilate(base, args.component_radius)
    component_records: dict[str, Any] = {}
    component_results: list[tuple[float, np.ndarray]] = []
    for fraction in [float(value) for value in args.component_overlap_fractions.split(",")]:
        selected, diagnostics = whole_component_selection(hybrid, component_corridor, fraction)
        path = args.output / f"hybrid-p050-whole-components-overlap-{fraction:.2f}.png"
        render_mask(selected).convert("L").save(path, optimize=True)
        component_records[f"{fraction:.2f}"] = {
            "file": path.name,
            "file_sha256": sha256_file(path),
            "mask_pixel_sha256": mask_pixel_sha256(selected),
            "selected_pixels": int(selected.sum()),
            "retained_fraction_of_raw_hybrid": float(selected.sum() / hybrid.sum()),
            **diagnostics,
        }
        component_results.append((fraction, selected))
    component_board_path = args.output / "whole-component-conditioning-review.png"
    clipped_at_component_radius = next(mask for radius, mask in results if radius == args.component_radius)
    render_component_board(
        source,
        hybrid,
        layout,
        clipped_at_component_radius,
        args.component_radius,
        component_results,
        component_board_path,
    )
    manifest = {
        "schema_version": "eynollah-line-conditioning.v1",
        "page_id": args.page_id,
        "evidence_boundary": {
            "sealed_human_evidence_used": False,
            "source_and_independent_software_geometry_only": True,
        },
        "source": {"path": str(args.source.resolve()), "file_sha256": sha256_file(args.source), "size_wh": list(source.size)},
        "hybrid_mask": {
            "path": str(args.hybrid_mask.resolve()),
            "file_sha256": sha256_file(args.hybrid_mask),
            "pixels": int(hybrid.sum()),
        },
        "kraken_layout": {
            "path": str(args.layout.resolve()),
            "file_sha256": sha256_file(args.layout),
            "coordinate_space": layout["image"]["coordinateSpace"],
            "line_count": len(layout["lines"]),
            "prepared_pixels_match_source_dimensions": True,
        },
        "method": "Intersect hybrid p0.50 with union of Kraken provider line-boundary polygons after isotropic dilation.",
        "radii_px": records,
        "review_board": {"file": board_path.name, "file_sha256": sha256_file(board_path)},
        "whole_component_policy": {
            "corridor_radius_px": args.component_radius,
            "connectivity": 8,
            "rule": "Keep each complete raw-hybrid connected component when its fraction inside the dilated line corridor meets the threshold.",
            "thresholds": component_records,
            "review_board": {"file": component_board_path.name, "file_sha256": sha256_file(component_board_path)},
        },
        "runtime_seconds": time.perf_counter() - started,
        "decision_policy": "Visual acting-safe characterization only; no radius may be promoted without complete-mask evaluation and correction-effort measurement.",
    }
    manifest_path = args.output / "experiment.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
