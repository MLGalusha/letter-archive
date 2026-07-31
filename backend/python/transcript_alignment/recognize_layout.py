#!/usr/bin/env python3
"""Run Kraken recognition over preserved line geometry without flattening it."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import sys
import time
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from PIL import Image
from kraken.configs import RecognitionInferenceConfig
from kraken.containers import BaselineLine, Segmentation
from kraken.tasks import RecognitionTaskModel


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rgb8_raster_sha256(image: Image.Image) -> str:
    """Hash decoded RGB pixels using the PageLayout v2 checksum contract."""
    rgb = image if image.mode == "RGB" else image.convert("RGB")
    framing = f"rgb8:{rgb.width}x{rgb.height}\n".encode("ascii")
    return hashlib.sha256(framing + rgb.tobytes()).hexdigest()


def point_pairs(points: Iterable[dict[str, Any]]) -> list[tuple[int, int]]:
    return [
        (round(float(point["x"])), round(float(point["y"])))
        for point in points
    ]


def closed_polygon(points: Iterable[dict[str, Any]]) -> list[tuple[int, int]]:
    polygon = point_pairs(points)
    if polygon and polygon[0] != polygon[-1]:
        polygon.append(polygon[0])
    return polygon


def _legacy_normalized_lines(layout: dict[str, Any]) -> list[dict[str, Any]]:
    lines = list(layout.get("lines") or [])
    return sorted(
        lines,
        key=lambda line: (
            (line.get("readingOrder") or {}).get("index", sys.maxsize),
            line["id"],
        ),
    )


def _page_layout_v2_lines(layout: dict[str, Any]) -> list[dict[str, Any]]:
    segmentation = layout.get("segmentation") or {}
    lines = list(segmentation.get("lines") or [])
    primary_order = (
        (segmentation.get("readingOrder") or {}).get("lineIds")
        or []
    )
    order = {line_id: index for index, line_id in enumerate(primary_order)}
    return sorted(
        lines,
        key=lambda line: (order.get(line["id"], sys.maxsize), line["id"]),
    )


def _is_page_layout_v2(layout: dict[str, Any]) -> bool:
    if layout.get("schemaVersion") != 2:
        return False
    if (
        layout.get("kind") != "PageLayout"
        or not isinstance(layout.get("source"), dict)
        or not isinstance(layout.get("segmentation"), dict)
    ):
        raise ValueError("Invalid native PageLayout v2 envelope")
    return True


def _line_geometry(line: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    geometry = line.get("geometry") or line
    baseline = geometry.get("baseline")
    boundary = geometry.get("boundary")
    if not baseline or not boundary:
        raise ValueError(
            f"Line {line.get('id', '<unknown>')} lacks baseline or boundary geometry",
        )
    return baseline, boundary


def build_segmentation(
    layout: dict[str, Any],
    image_path: Path,
) -> Segmentation:
    is_page_layout_v2 = _is_page_layout_v2(layout)
    source_lines = (
        _page_layout_v2_lines(layout)
        if is_page_layout_v2
        else _legacy_normalized_lines(layout)
    )
    if not source_lines:
        raise ValueError("Layout contains no lines")

    lines: list[BaselineLine] = []
    for source in source_lines:
        attributes = (source.get("provenance") or {}).get("attributes") or {}
        geometry = source.get("geometry") or {}
        segmentation_type = (
            geometry.get("type")
            or source.get("type")
            or source.get("segmentationType")
            or attributes.get("segmentationType")
            or "baselines"
        )
        if segmentation_type not in {"baseline", "baselines"}:
            raise ValueError(
                f"Line {source['id']} uses unsupported geometry type "
                f"{segmentation_type}; mixed geometry must be processed separately",
            )
        baseline, boundary = _line_geometry(source)
        lines.append(
            BaselineLine(
                id=source["id"],
                text=None,
                base_dir=(
                    source.get("baseDirection")
                    or attributes.get("baseDirection")
                    or "L"
                ),
                imagename=str(image_path),
                tags=source.get("tags") or attributes.get("tags"),
                regions=(
                    source.get("regionIds")
                    or source.get("providerRegionIds")
                    or attributes.get("regions")
                    or None
                ),
                language=source.get("language") or attributes.get("language"),
                baseline=point_pairs(baseline),
                boundary=closed_polygon(boundary),
            ),
        )

    segmentation_data = layout.get("segmentation") or {}
    text_direction = (
        segmentation_data.get("textDirection")
        or segmentation_data.get("text_direction")
        or (
            (source_lines[0].get("provenance") or {})
            .get("attributes", {})
            .get("textDirection")
        )
        or "horizontal-lr"
    )
    line_id_to_index = {
        line["id"]: index for index, line in enumerate(source_lines)
    }
    alternate_orders: list[list[int]] = []
    for alternate in segmentation_data.get("alternateReadingOrders") or []:
        line_ids = alternate.get("lineIds") or []
        if (
            alternate.get("complete") is True
            and len(line_ids) == len(source_lines)
            and all(line_id in line_id_to_index for line_id in line_ids)
        ):
            alternate_orders.append([
                line_id_to_index[line_id] for line_id in line_ids
            ])
    return Segmentation(
        type="baselines",
        imagename=str(image_path),
        text_direction=text_direction,
        script_detection=bool(segmentation_data.get("scriptDetection", False)),
        lines=lines,
        regions=None,
        line_orders=alternate_orders,
        language=segmentation_data.get("language"),
    )


def normalized_max_rss_bytes() -> int:
    maximum = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if platform.system() == "Darwin":
        return int(maximum)
    return int(maximum * 1024)


def mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def verify_layout_image(
    layout: dict[str, Any],
    image_path: Path,
    image: Image.Image,
) -> str:
    """Bind recognition geometry to the exact encoded and decoded raster."""
    actual_sha256 = sha256_file(image_path)
    if _is_page_layout_v2(layout):
        normalized = (layout.get("source") or {}).get("normalized")
        if not isinstance(normalized, dict):
            raise ValueError("PageLayout v2 lacks normalized raster provenance")
        expected_sha256 = normalized.get("sha256")
        expected_raster_sha256 = normalized.get("rasterSha256")
        raster_checksum_algorithm = normalized.get("rasterChecksumAlgorithm")
        expected_size = (
            normalized.get("width"),
            normalized.get("height"),
        )
        if not (
            isinstance(expected_sha256, str)
            and isinstance(expected_raster_sha256, str)
            and raster_checksum_algorithm == "sha256-rgb8-v1"
            and all(
                isinstance(value, int) and not isinstance(value, bool)
                for value in expected_size
            )
        ):
            raise ValueError("PageLayout v2 normalized raster provenance is incomplete")
        if actual_sha256 != expected_sha256:
            raise ValueError(
                f"Image SHA-256 {actual_sha256} does not match PageLayout v2 "
                f"normalized image {expected_sha256}",
            )
        if image.size != expected_size:
            raise ValueError(
                f"Image size {image.size} does not match PageLayout v2 "
                f"normalized image {expected_size}",
            )
        actual_raster_sha256 = rgb8_raster_sha256(image)
        if actual_raster_sha256 != expected_raster_sha256:
            raise ValueError(
                f"Decoded RGB raster SHA-256 {actual_raster_sha256} does not "
                f"match PageLayout v2 {expected_raster_sha256}",
            )
        return actual_sha256

    expected_image = layout.get("image") or {}
    expected_sha256 = expected_image.get("preparedSha256")
    if expected_sha256 and actual_sha256 != expected_sha256:
        raise ValueError(
            f"Image SHA-256 {actual_sha256} does not match layout "
            f"{expected_sha256}",
        )
    expected_size = (
        expected_image.get("width"),
        expected_image.get("height"),
    )
    if all(
        isinstance(value, int) and not isinstance(value, bool)
        for value in expected_size
    ):
        if image.size != expected_size:
            raise ValueError(
                f"Image size {image.size} does not match layout {expected_size}",
            )
    return actual_sha256


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid4()}")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def recognize(
    *,
    layout_path: Path,
    image_path: Path,
    model_path: Path,
    output_path: Path,
    loaded_model: RecognitionTaskModel | None = None,
) -> dict[str, Any]:
    started_at = time.time()
    monotonic_start = time.monotonic()
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    segmentation = build_segmentation(layout, image_path)

    with Image.open(image_path) as source_image:
        image = source_image.convert("RGB")
        actual_image_sha256 = verify_layout_image(layout, image_path, image)

        model = loaded_model or RecognitionTaskModel.load_model(model_path)
        if model.seg_type != "baselines":
            raise ValueError(
                f"Recognition model must accept baselines, got {model.seg_type!r}",
            )
        config = RecognitionInferenceConfig(
            accelerator="cpu",
            device=1,
            precision="32-true",
            batch_size=1,
            num_line_workers=0,
            num_threads=1,
            padding=16,
            raise_on_error=True,
            return_logits=False,
            return_line_image=False,
        )
        records = []
        for record in model.predict(image, segmentation, config):
            confidences = [float(value) for value in record.confidences]
            records.append(
                {
                    "segmentId": record.id,
                    "text": record.prediction,
                    "meanConfidence": mean(confidences),
                    "characterConfidences": confidences,
                    "cuts": [
                        [list(point) for point in cut]
                        for cut in record.cuts
                    ],
                },
            )

    completed_at = time.time()
    result = {
        "schemaVersion": 1,
        "kind": "kraken-line-recognition",
        "pageKey": layout.get("pageKey") or layout.get("pageId"),
        "source": {
            "layoutPath": str(layout_path),
            "layoutSha256": sha256_file(layout_path),
            "imagePath": str(image_path),
            "imageSha256": actual_image_sha256,
        },
        "model": {
            "path": str(model_path),
            "sha256": sha256_file(model_path),
            "krakenVersion": version("kraken"),
            "segmentationType": model.seg_type,
        },
        "inference": {
            "accelerator": "cpu",
            "device": 1,
            "precision": "32-true",
            "batchSize": 1,
            "numLineWorkers": 0,
            "numThreads": 1,
            "padding": 16,
        },
        "runtime": {
            "startedAtUnix": started_at,
            "completedAtUnix": completed_at,
            "elapsedSeconds": completed_at - started_at,
            "monotonicElapsedSeconds": time.monotonic() - monotonic_start,
            "maximumResidentSetBytes": normalized_max_rss_bytes(),
            "platform": platform.platform(),
            "pythonVersion": platform.python_version(),
        },
        "summary": {
            "inputLineCount": len(segmentation.lines),
            "recognizedLineCount": len(records),
            "nonemptyLineCount": sum(bool(record["text"].strip()) for record in records),
        },
        "records": records,
    }
    atomic_write_json(output_path, result)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recognize preserved Kraken baseline geometry locally",
    )
    parser.add_argument("--layout", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = recognize(
        layout_path=args.layout.resolve(),
        image_path=args.image.resolve(),
        model_path=args.model.resolve(),
        output_path=args.output.resolve(),
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "summary": result["summary"],
                "elapsedSeconds": result["runtime"]["elapsedSeconds"],
            },
        ),
    )


if __name__ == "__main__":
    main()
