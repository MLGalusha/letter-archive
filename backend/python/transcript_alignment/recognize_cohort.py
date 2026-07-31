#!/usr/bin/env python3
"""Recognize a completed layout cohort sequentially with one loaded model."""

from __future__ import annotations

import argparse
import json
import platform
import time
from pathlib import Path
from typing import Any

from kraken.tasks import RecognitionTaskModel

from transcript_alignment.recognize_layout import (
    atomic_write_json,
    recognize,
    sha256_file,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run local handwriting recognition over a layout benchmark run",
    )
    parser.add_argument("--layout-run", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument(
        "--page-key",
        action="append",
        dest="page_keys",
        help="Optional page key to include; repeat for more than one page",
    )
    return parser.parse_args()


def reusable_output_matches(
    output_path: Path,
    *,
    layout_path: Path,
    image_path: Path,
    model_sha256: str,
) -> bool:
    if not output_path.is_file():
        return False
    try:
        output = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        output.get("schemaVersion") == 1
        and output.get("kind") == "kraken-line-recognition"
        and (output.get("source") or {}).get("layoutSha256")
        == sha256_file(layout_path)
        and (output.get("source") or {}).get("imageSha256")
        == sha256_file(image_path)
        and (output.get("model") or {}).get("sha256") == model_sha256
    )


def main() -> None:
    args = parse_args()
    layout_run = args.layout_run.resolve()
    model_path = args.model.resolve()
    output_root = args.output_root.resolve()
    run_manifest_path = layout_run / "run.v2.json"
    run_manifest = json.loads(run_manifest_path.read_text(encoding="utf-8"))
    selected = set(args.page_keys or [])
    pages = [
        page for page in run_manifest["pages"]
        if page["status"] == "succeeded"
        and (not selected or page["pageKey"] in selected)
    ]
    unknown = selected - {page["pageKey"] for page in pages}
    if unknown:
        raise ValueError(
            f"Requested pages are missing or unsuccessful: {sorted(unknown)}",
        )
    pages.sort(key=lambda page: page["pageKey"])

    started_at = time.time()
    model_sha256 = sha256_file(model_path)
    model_load_start = time.monotonic()
    model = RecognitionTaskModel.load_model(model_path)
    model_load_seconds = time.monotonic() - model_load_start
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, page in enumerate(pages, start=1):
        page_key = page["pageKey"]
        page_root = layout_run / "pages" / page_key
        layout_path = page_root / "normalized-layout.v1.json"
        image_path = page_root / "prepared.png"
        output_path = output_root / "pages" / page_key / "recognition.v1.json"
        if reusable_output_matches(
            output_path,
            layout_path=layout_path,
            image_path=image_path,
            model_sha256=model_sha256,
        ):
            cached = json.loads(output_path.read_text(encoding="utf-8"))
            results.append(
                {
                    "pageKey": page_key,
                    "status": "reused",
                    "output": str(output_path.relative_to(output_root)),
                    "summary": cached["summary"],
                    "elapsedSeconds": cached["runtime"]["elapsedSeconds"],
                },
            )
            print(
                json.dumps(
                    {
                        "progress": f"{index}/{len(pages)}",
                        "pageKey": page_key,
                        "status": "reused",
                    },
                ),
                flush=True,
            )
            continue
        try:
            result = recognize(
                layout_path=layout_path,
                image_path=image_path,
                model_path=model_path,
                output_path=output_path,
                loaded_model=model,
            )
            results.append(
                {
                    "pageKey": page_key,
                    "status": "succeeded",
                    "output": str(output_path.relative_to(output_root)),
                    "summary": result["summary"],
                    "elapsedSeconds": result["runtime"]["elapsedSeconds"],
                },
            )
            print(
                json.dumps(
                    {
                        "progress": f"{index}/{len(pages)}",
                        "pageKey": page_key,
                        "status": "succeeded",
                        "seconds": round(
                            result["runtime"]["elapsedSeconds"],
                            3,
                        ),
                    },
                ),
                flush=True,
            )
        except Exception as error:  # noqa: BLE001 - retain per-page diagnostics
            failure = {
                "pageKey": page_key,
                "status": "failed",
                "errorType": type(error).__name__,
                "message": str(error),
            }
            failures.append(failure)
            print(
                json.dumps(
                    {
                        "progress": f"{index}/{len(pages)}",
                        **failure,
                    },
                ),
                flush=True,
            )

    completed_at = time.time()
    manifest = {
        "schemaVersion": 1,
        "kind": "kraken-cohort-recognition-run",
        "runId": output_root.name,
        "state": "completed" if not failures else "completed-with-failures",
        "source": {
            "layoutRunId": run_manifest["runId"],
            "layoutRunManifest": str(run_manifest_path),
            "layoutRunManifestSha256": sha256_file(run_manifest_path),
        },
        "model": {
            "path": str(model_path),
            "sha256": model_sha256,
            "segmentationType": model.seg_type,
        },
        "environment": {
            "platform": platform.platform(),
            "pythonVersion": platform.python_version(),
            "execution": "sequential-local-cpu",
        },
        "timing": {
            "startedAtUnix": started_at,
            "completedAtUnix": completed_at,
            "elapsedSeconds": completed_at - started_at,
            "modelLoadSeconds": model_load_seconds,
        },
        "summary": {
            "requestedPageCount": len(pages),
            "succeededPageCount": len(results),
            "failedPageCount": len(failures),
            "recognizedLineCount": sum(
                result["summary"]["recognizedLineCount"]
                for result in results
            ),
        },
        "pages": results,
        "failures": failures,
    }
    manifest_path = output_root / "run.v1.json"
    atomic_write_json(manifest_path, manifest)
    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "state": manifest["state"],
                "summary": manifest["summary"],
                "elapsedSeconds": manifest["timing"]["elapsedSeconds"],
            },
        ),
    )
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
