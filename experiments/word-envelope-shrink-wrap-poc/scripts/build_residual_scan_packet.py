#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from word_envelope.io_utils import canonical_json_bytes, sha256_file  # noqa: E402
from word_envelope.simple_page_agent import _hash_record  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--knockout-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    knockout_dir = args.knockout_dir.resolve()
    output = args.output_dir.resolve()
    if output.exists() or output.is_symlink():
        raise ValueError("residual scan packet already exists")
    knockout = json.loads((knockout_dir / "knockout.json").read_text("utf-8"))
    if knockout["knockout_sha256"] != _hash_record(knockout, "knockout_sha256"):
        raise ValueError("knockout record changed")
    output.mkdir(parents=True)
    prompt_source = ROOT / "prompts/residual-missing-line-scan-v1.md"
    schema_source = ROOT / "schemas/residual-missing-line-scan-v1.schema.json"
    shutil.copyfile(prompt_source, output / "prompt.md")
    shutil.copyfile(schema_source, output / "response-schema.json")
    collage_source = knockout_dir / knockout["evidence"]["residual_collage"]["path"]
    shutil.copyfile(collage_source, output / "collage.png")
    packet = {
        "schema_version": "residual-missing-line-scan-packet.v1",
        "knockout_sha256": knockout["knockout_sha256"],
        "content_order": ["prompt", "packet", "response_schema", "collage"],
        "prompt": {"path": "prompt.md", "file_sha256": sha256_file(output / "prompt.md")},
        "response_schema": {
            "path": "response-schema.json",
            "file_sha256": sha256_file(output / "response-schema.json"),
        },
        "collage": {"path": "collage.png", "file_sha256": sha256_file(output / "collage.png")},
        "coordinate_space": {
            "origin": "right_residual_panel_content_top_left",
            "size_wh": [900, 1200],
            "units": "integer_preview_pixels",
        },
        "knockout_counts": knockout["counts"],
    }
    packet["packet_sha256"] = _hash_record(packet, "packet_sha256")
    (output / "packet.json").write_bytes(canonical_json_bytes(packet) + b"\n")
    print(json.dumps(packet, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
