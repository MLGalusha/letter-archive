from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/build_residual_review_regions_v2.py"
SPEC = importlib.util.spec_from_file_location("residual_review_regions_v2", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_package(root: Path, *, size: tuple[int, int] = (1200, 1600)) -> tuple[Path, Path, list[dict]]:
    root.mkdir(parents=True, exist_ok=True)
    source_path = root / "source.png"
    Image.new("RGB", size, (238, 226, 200)).save(source_path, format="PNG")
    residual = np.zeros((size[1], size[0]), dtype=bool)
    # Two marks sit in the first line's spatial neighbourhood, one is on a
    # second line, and two intentionally old-excluded marks are outside lines.
    residual[215:222, 150:165] = True
    residual[228:235, 415:430] = True
    residual[620:632, 300:322] = True
    residual[1040:1042, 1020:1023] = True
    residual[0:3, 30:34] = True  # legacy border exclusion, still must review
    mask_path = root / "knockout/masks/exact-candidate-residual.png"
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(residual.astype(np.uint8) * 255, mode="L").save(mask_path, format="PNG")
    inventory = builder._component_inventory(residual)
    candidates, excluded = [], []
    for item in inventory:
        entry = {key: item[key] for key in ("component_id", "area_px", "bbox_source_xywh", "centroid_source_xy")}
        if item["touches_source_border"]:
            excluded.append(entry | {"reason": "touches_source_border_background_region"})
        elif entry["bbox_source_xywh"][1] > 900:
            excluded.append(entry | {"reason": "outside_packet_derived_page_analysis_window"})
        else:
            candidates.append(entry | {"disposition": "unreviewed_residual_candidate"})
    record = {
        "schema_version": "full-page-residual-candidates.v2",
        "page_id": "test-p01",
        "candidate_count": len(candidates),
        "excluded_count": len(excluded),
        "candidates": candidates,
        "excluded_components": excluded,
    }
    record_path = root / "knockout/residual-candidates/residual-candidates.json"
    write_json(record_path, record)

    packet = {
        "schema_version": "test-packet.v2",
        "page_id": "test-p01",
        "source": {"path": str(source_path), "sha256": builder.sha256_file(source_path), "size": list(size)},
        "lines": [
            {"line_id": "body-01", "box_proposals": [{"source_axis_aligned_bbox_xywh": [100, 190, 450, 55]}]},
            {"line_id": "body-02", "box_proposals": [{"source_axis_aligned_bbox_xywh": [210, 590, 350, 70]}]},
        ],
    }
    packet["packet_sha256"] = builder.canonical_hash(packet)
    packet_path = root / "public/run-packet.json"
    write_json(packet_path, packet)
    output_paths = [
        ("masks/exact-candidate-residual.png", mask_path),
        ("residual-candidates/residual-candidates.json", record_path),
    ]
    manifest = {
        "schema_version": "full-page-ownership-knockout-manifest.v2",
        "page_id": "test-p01",
        "inputs": {
            "public_packet": {"file_sha256": builder.sha256_file(packet_path), "packet_sha256": packet["packet_sha256"]},
            "source": {"file_sha256": packet["source"]["sha256"], "size": list(size)},
        },
        "outputs": [{"path": relative, "file_sha256": builder.sha256_file(path), "bytes": path.stat().st_size} for relative, path in output_paths],
    }
    manifest["manifest_sha256"] = builder.canonical_hash(manifest)
    manifest_path = root / "knockout/manifest.json"
    write_json(manifest_path, manifest)
    return manifest_path, packet_path, inventory


class ResidualReviewRegionsTests(unittest.TestCase):
    def test_exact_once_partition_includes_line_and_outside_regions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            knockout, packet, inventory = make_package(root)
            output = root / "regions"
            manifest = json.loads(builder.build(knockout, packet_path=packet, output_dir=output).read_text())

            flattened = [component_id for region in manifest["regions"] for component_id in region["component_ids"]]
            expected = [item["component_id"] for item in inventory]
            self.assertEqual(sorted(flattened), sorted(expected))
            self.assertEqual(len(flattened), len(set(flattened)))
            self.assertEqual(manifest["component_count"], len(expected))
            self.assertEqual(manifest["normalized_residual_pixel_count"], sum(item["area_px"] for item in inventory))
            self.assertTrue(any(region["association"]["line_id"] == "body-01" for region in manifest["regions"]))
            outside = [region for region in manifest["regions"] if region["association"]["line_id"] is None]
            self.assertTrue(outside)
            self.assertTrue(any("touches_source_border" in hint for region in outside for hint in region["component_legacy_hints"]))
            self.assertTrue(all(region["bbox_source_xywh"] != [0, 0, 1200, 1600] for region in manifest["regions"]))
            for region in manifest["regions"]:
                self.assertTrue((output / region["board"]["path"]).is_file())
                self.assertLessEqual(region["board"]["display_size"][0], 1400)
                self.assertLessEqual(region["board"]["display_size"][1], 1100)

    def test_rebuild_is_deterministic_and_configuration_scales(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            knockout, packet, _ = make_package(root)
            first = json.loads(builder.build(knockout, packet_path=packet, output_dir=root / "first").read_text())
            second = json.loads(builder.build(knockout, packet_path=packet, output_dir=root / "second").read_text())
            self.assertEqual(first, second)
            self.assertEqual(first["configuration"]["source_scale"], 0.4)
            self.assertEqual(first["configuration"]["max_region_source_width_px"], 480)

            large_root = root / "large"
            knockout, packet, _ = make_package(large_root, size=(3000, 4000))
            large = json.loads(builder.build(knockout, packet_path=packet, output_dir=large_root / "regions").read_text())
            self.assertEqual(large["configuration"]["source_scale"], 1.0)
            self.assertEqual(large["configuration"]["max_region_source_width_px"], 1200)

    def test_rejects_stale_knockout_output_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            knockout, packet, _ = make_package(root)
            mask_path = knockout.parent / "masks/exact-candidate-residual.png"
            with Image.open(mask_path) as image:
                changed = image.convert("L")
            changed.putpixel((700, 700), 255)
            changed.save(mask_path, format="PNG")
            with self.assertRaisesRegex(RuntimeError, "Knockout output hash changed"):
                builder.build(knockout, packet_path=packet, output_dir=root / "should-not-exist")

    def test_refuses_to_overwrite_an_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            knockout, packet, _ = make_package(root)
            output = root / "regions"
            builder.build(knockout, packet_path=packet, output_dir=output)
            with self.assertRaisesRegex(RuntimeError, "Refusing to overwrite"):
                builder.build(knockout, packet_path=packet, output_dir=output)


if __name__ == "__main__":
    unittest.main()
