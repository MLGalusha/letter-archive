from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from PIL import Image

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import line_finder
from kraken.containers import BBoxLine, BaselineLine, Region, Segmentation


def source_fixture(width: int = 200, height: int = 300) -> dict:
    return {
        "name": "fixture.png",
        "coordinateSpace": "normalized-image-pixels",
        "original": {
            "sha256": "a" * 64,
            "width": width,
            "height": height,
            "mode": "RGB",
            "exifOrientation": 1,
        },
        "normalized": {
            "sha256": "b" * 64,
            "width": width,
            "height": height,
            "mode": "RGB",
            "format": "PNG",
        },
        "normalization": {
            "operation": "identity",
            "applied": False,
            "exifReadError": False,
        },
    }


def build_layout(
    segmentation: Segmentation,
    *,
    source: dict | None = None,
) -> dict:
    image = Image.new("RGB", (200, 300), "white")
    return line_finder.build_page_layout(
        segmentation,
        image,
        source=source or source_fixture(),
        model_provenance={
            "name": "blla.mlmodel",
            "kind": "test",
            "sha256": "c" * 64,
            "sizeBytes": 123,
        },
        inference_config={
            "accelerator": "cpu",
            "device": "auto",
            "precision": "32-true",
            "batchSize": 1,
            "raiseOnError": True,
            "numThreads": 1,
            "inputPadding": 0,
            "textDirection": segmentation.text_direction,
        },
    )


def rotation_segmentations(prefix: str) -> list[Segmentation]:
    base = Segmentation(
        type="baselines",
        imagename="fixture.png",
        text_direction="horizontal-lr",
        script_detection=False,
        lines=[
            BaselineLine(
                id=f"{prefix}-base",
                baseline=[(100, 700), (900, 700)],
                boundary=[
                    (100, 688),
                    (900, 688),
                    (900, 712),
                    (100, 712),
                    (100, 688),
                ],
            )
        ],
    )
    rotated_90 = Segmentation(
        type="baselines",
        imagename="fixture.png",
        text_direction="horizontal-lr",
        script_detection=False,
        lines=[
            BaselineLine(
                id=f"{prefix}-left-{index}",
                baseline=[(100, native_y), (220, native_y)],
                boundary=[
                    (95, native_y - 9),
                    (225, native_y - 9),
                    (225, native_y + 9),
                    (95, native_y + 9),
                    (95, native_y - 9),
                ],
            )
            for index, native_y in enumerate((799, 739, 679))
        ],
    )
    rotated_270 = Segmentation(
        type="baselines",
        imagename="fixture.png",
        text_direction="horizontal-lr",
        script_detection=False,
        lines=[
            BaselineLine(
                id=f"{prefix}-right-{index}",
                baseline=[(1499, native_y), (1379, native_y)],
                boundary=[
                    (1504, native_y - 9),
                    (1374, native_y - 9),
                    (1374, native_y + 9),
                    (1504, native_y + 9),
                    (1504, native_y - 9),
                ],
            )
            for index, native_y in enumerate((700, 760, 820))
        ],
    )
    return [base, rotated_90, rotated_270]


class FakeRotationTaskModel:
    def __init__(
        self,
        segmentations: list[Segmentation],
        *,
        fail_on_call: int | None = None,
    ) -> None:
        self.segmentations = segmentations
        self.fail_on_call = fail_on_call
        self.calls: list[tuple[int, int]] = []

    def predict(self, image, _config):
        self.calls.append(image.size)
        call_number = len(self.calls)
        if self.fail_on_call == call_number:
            raise RuntimeError(f"rotation pass {call_number} failed")
        return self.segmentations[call_number - 1]


def loaded_rotation_model(task_model: FakeRotationTaskModel) -> line_finder.LoadedModel:
    return line_finder.LoadedModel(
        task_model=task_model,
        provenance={
            "name": "blla.mlmodel",
            "kind": "test",
            "sha256": "d" * 64,
            "sizeBytes": 99,
        },
    )


class NativeLayoutContractTests(unittest.TestCase):
    def test_invalid_exif_orientation_is_sanitized_to_null(self) -> None:
        image = Image.new("RGB", (20, 10), "white")
        exif = image.getexif()
        exif[0x0112] = 0
        encoded = io.BytesIO()
        image.save(encoded, format="JPEG", exif=exif)

        corrected, metadata = line_finder.normalize_orientation_with_metadata(
            encoded.getvalue(),
        )

        self.assertIsNone(metadata["originalExifOrientation"])
        self.assertEqual(metadata["operation"], "identity")
        self.assertFalse(metadata["applied"])
        self.assertEqual(Image.open(io.BytesIO(corrected)).size, (20, 10))

    def test_preserves_curved_baseline_region_and_provider_orders(self) -> None:
        first = BaselineLine(
            id="line-curved",
            baseline=[(10, 30), (40, 35), (80, 28)],
            boundary=[(8, 18), (82, 16), (85, 42), (9, 45), (8, 18)],
            tags={"type": [{"name": "marginalia"}]},
            regions=["region-main"],
            language=["eng"],
        )
        second = BaselineLine(
            id="line-second",
            baseline=[(12, 80), (90, 80)],
            boundary=[(10, 68), (92, 68), (92, 90), (10, 90), (10, 68)],
        )
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=True,
            lines=[first, second],
            regions={
                "TextRegion": [
                    Region(
                        id="region-main",
                        boundary=[
                            (0, 0),
                            (100, 0),
                            (100, 100),
                            (0, 100),
                            (0, 0),
                        ],
                        tags={"role": [{"name": "body"}]},
                    )
                ]
            },
            line_orders=[[1, 0]],
            language=["eng"],
        )

        layout = build_layout(segmentation)
        curved = layout["segmentation"]["lines"][0]
        second_native = layout["segmentation"]["lines"][1]
        region = layout["segmentation"]["regions"][0]

        self.assertEqual(layout["schemaVersion"], 2)
        self.assertEqual(curved["providerId"], "line-curved")
        self.assertEqual(second_native["providerId"], "line-second")
        self.assertTrue(curved["id"].startswith("line-sha256-"))
        self.assertEqual(
            layout["segmentation"]["readingOrder"]["lineIds"],
            [curved["id"], second_native["id"]],
        )
        self.assertEqual(
            layout["segmentation"]["alternateReadingOrders"][0],
            {
                "providerOrdinal": 0,
                "providerIndices": [1, 0],
                "lineIds": [second_native["id"], curved["id"]],
                "complete": True,
            },
        )
        self.assertEqual(
            curved["geometry"]["baseline"],
            [{"x": 10, "y": 30}, {"x": 40, "y": 35}, {"x": 80, "y": 28}],
        )
        self.assertEqual(curved["providerRegionIds"], ["region-main"])
        self.assertEqual(curved["regionIds"], [region["id"]])
        self.assertEqual(curved["unresolvedProviderRegionIds"], [])
        self.assertEqual(region["providerId"], "region-main")
        self.assertTrue(region["id"].startswith("region-sha256-"))
        self.assertEqual(region["class"], "TextRegion")
        json.dumps(layout)

    def test_baseline_only_line_does_not_gain_an_invented_boundary(self) -> None:
        line = BaselineLine(
            id="baseline-only",
            baseline=[(15, 25), (50, 33), (75, 30)],
            boundary=None,
        )
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[line],
        )

        layout = build_layout(segmentation)
        native = layout["segmentation"]["lines"][0]

        self.assertIsNone(native["geometry"]["boundary"])
        self.assertEqual(
            native["displayExtent"],
            {
                "bbox": [15, 25, 75, 33],
                "source": "derived-baseline-aabb",
                "derived": True,
            },
        )

    def test_bbox_line_preserves_vertical_direction_without_baseline(self) -> None:
        line = BBoxLine(
            id="vertical-box",
            bbox=(30, 10, 55, 180),
            text_direction="vertical-lr",
            regions=["side-note"],
        )
        segmentation = Segmentation(
            type="bbox",
            imagename="fixture.png",
            text_direction="vertical-lr",
            script_detection=False,
            lines=[line],
        )

        layout = build_layout(segmentation)
        native = layout["segmentation"]["lines"][0]

        self.assertEqual(
            native["geometry"],
            {
                "type": "bbox",
                "bbox": [30, 10, 55, 180],
                "textDirection": "vertical-lr",
            },
        )
        self.assertNotIn("baseline", native["geometry"])
        self.assertNotIn("boundary", native["geometry"])
        self.assertEqual(native["displayExtent"]["source"], "native-bbox")

    def test_native_reading_order_keeps_provider_order_not_geometry_sort(self) -> None:
        first = BaselineLine(
            id="provider-first",
            baseline=[(10, 150), (90, 150)],
            boundary=[(10, 140), (90, 140), (90, 160), (10, 160), (10, 140)],
        )
        second = BaselineLine(
            id="provider-second",
            baseline=[(10, 40), (90, 40)],
            boundary=[(10, 30), (90, 30), (90, 50), (10, 50), (10, 30)],
        )
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[first, second],
        )

        layout = build_layout(segmentation)
        self.assertEqual(
            layout["segmentation"]["readingOrder"]["lineIds"],
            [
                layout["segmentation"]["lines"][0]["id"],
                layout["segmentation"]["lines"][1]["id"],
            ],
        )
        self.assertEqual(
            [
                line["providerId"]
                for line in layout["segmentation"]["lines"]
            ],
            ["provider-first", "provider-second"],
        )

    def test_canonical_ids_ignore_unstable_provider_uuids(self) -> None:
        def segmentation_with_ids(
            line_id: str,
            region_id: str,
        ) -> Segmentation:
            return Segmentation(
                type="baselines",
                imagename="fixture.png",
                text_direction="horizontal-lr",
                script_detection=False,
                lines=[
                    BaselineLine(
                        id=line_id,
                        baseline=[(10, 30), (80, 32)],
                        boundary=[
                            (8, 18),
                            (82, 18),
                            (82, 44),
                            (8, 44),
                            (8, 18),
                        ],
                        regions=[region_id],
                    )
                ],
                regions={
                    "TextRegion": [
                        Region(
                            id=region_id,
                            boundary=[
                                (0, 0),
                                (100, 0),
                                (100, 100),
                                (0, 100),
                                (0, 0),
                            ],
                        )
                    ]
                },
            )

        first = build_layout(segmentation_with_ids("uuid-run-a", "region-run-a"))
        second = build_layout(segmentation_with_ids("uuid-run-b", "region-run-b"))
        first_line = first["segmentation"]["lines"][0]
        second_line = second["segmentation"]["lines"][0]
        first_region = first["segmentation"]["regions"][0]
        second_region = second["segmentation"]["regions"][0]

        self.assertNotEqual(first_line["providerId"], second_line["providerId"])
        self.assertEqual(first_line["id"], second_line["id"])
        self.assertNotEqual(first_region["providerId"], second_region["providerId"])
        self.assertEqual(first_region["id"], second_region["id"])
        self.assertEqual(first_line["regionIds"], [first_region["id"]])
        self.assertEqual(second_line["regionIds"], [second_region["id"]])

    def test_canonical_ids_ignore_png_encoder_byte_differences(self) -> None:
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[
                BaselineLine(
                    id="provider-random",
                    baseline=[(10, 30), (80, 32)],
                    boundary=[
                        (8, 18),
                        (82, 18),
                        (82, 44),
                        (8, 44),
                        (8, 18),
                    ],
                )
            ],
        )
        first_source = source_fixture()
        second_source = source_fixture()
        second_source["normalized"]["sha256"] = "f" * 64

        first = build_layout(segmentation, source=first_source)
        second = build_layout(segmentation, source=second_source)

        self.assertNotEqual(
            first["source"]["normalized"]["sha256"],
            second["source"]["normalized"]["sha256"],
        )
        self.assertEqual(
            first["source"]["normalized"]["rasterSha256"],
            second["source"]["normalized"]["rasterSha256"],
        )
        self.assertEqual(
            first["segmentation"]["lines"][0]["id"],
            second["segmentation"]["lines"][0]["id"],
        )
        self.assertEqual(
            first["segmentation"]["lines"][0]["idSource"],
            "derived-source-raster-model-provider-order-geometry-v2",
        )

    def test_segment_image_uses_task_api_and_records_explicit_provenance(self) -> None:
        line = BaselineLine(
            id="task-line",
            baseline=[(5, 20), (80, 20)],
            boundary=[(5, 10), (80, 10), (80, 30), (5, 30), (5, 10)],
        )
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[line],
        )

        class FakeTaskModel:
            def __init__(self) -> None:
                self.config = None

            def predict(self, _image, config):
                self.config = config
                return segmentation

        fake_model = FakeTaskModel()
        loaded = line_finder.LoadedModel(
            task_model=fake_model,
            provenance={
                "name": "blla.mlmodel",
                "kind": "test",
                "sha256": "d" * 64,
                "sizeBytes": 99,
            },
        )
        image = Image.new("RGB", (200, 300), "white")
        with patch.object(line_finder, "load_default_model", return_value=loaded):
            layout = line_finder.segment_image(
                image,
                source=source_fixture(),
                text_direction="horizontal-lr",
            )

        self.assertEqual(
            layout["producer"]["api"],
            "kraken.tasks.SegmentationTaskModel",
        )
        self.assertEqual(layout["producer"]["engineVersion"], "7.0.3")
        self.assertEqual(layout["producer"]["model"]["sha256"], "d" * 64)
        self.assertEqual(layout["producer"]["config"]["precision"], "32-true")
        effective = layout["producer"]["config"]["effective"]
        self.assertEqual(
            set(effective),
            {
                "accelerator",
                "baseline_ro_fn",
                "batch_size",
                "bbox_line_padding",
                "bbox_ro_fn",
                "compile_config",
                "device",
                "input_padding",
                "legacy_black_colseps",
                "legacy_maxcolseps",
                "legacy_no_hlines",
                "legacy_scale",
                "num_threads",
                "precision",
                "raise_on_error",
                "text_direction",
            },
        )
        self.assertEqual(
            effective["baseline_ro_fn"],
            {
                "kind": "python-callable",
                "module": "kraken.lib.segmentation",
                "qualname": "polygonal_reading_order",
            },
        )
        self.assertEqual(
            layout["producer"]["runtime"]["packages"]["kraken"],
            "7.0.3",
        )
        self.assertEqual(
            set(layout["producer"]["runtime"]["packages"]),
            set(line_finder.RUNTIME_DISTRIBUTIONS),
        )
        self.assertEqual(
            layout["producer"]["runtime"]["artifacts"]["adapter"]["name"],
            "letter-archive-kraken-native-layout",
        )
        self.assertEqual(
            layout["producer"]["runtime"]["execution"],
            {
                "processMode": "one-shot",
                "accelerator": "cpu",
                "configuredDevice": "auto",
                "resolvedDevice": "cpu",
                "resolutionSource": "configured-accelerator",
                "precision": "32-true",
                "modelParameterDevices": [],
                "modelParameterDtypes": [],
            },
        )
        self.assertEqual(fake_model.config.text_direction, "horizontal-lr")
        self.assertTrue(fake_model.config.raise_on_error)

    def test_cli_emits_only_strict_native_json(self) -> None:
        line = BaselineLine(
            id="cli-line",
            baseline=[(5, 20), (80, 20)],
            boundary=[(5, 10), (80, 10), (80, 30), (5, 30), (5, 10)],
        )
        segmentation = Segmentation(
            type="baselines",
            imagename="fixture.png",
            text_direction="horizontal-lr",
            script_detection=False,
            lines=[line],
        )
        layout = build_layout(segmentation)

        native_output = io.StringIO()
        with (
            patch.object(
                line_finder,
                "find_lines",
                return_value=(b"normalized", layout),
            ),
            patch.object(
                sys,
                "argv",
                ["line_finder.py", "fixture.png", "--native-json"],
            ),
            redirect_stdout(native_output),
        ):
            line_finder.main()
        native = json.loads(native_output.getvalue())
        self.assertEqual(native["schemaVersion"], 2)
        self.assertEqual(
            native["segmentation"]["lines"][0]["providerId"],
            "cli-line",
        )
        self.assertTrue(
            native["segmentation"]["lines"][0]["id"].startswith("line-sha256-")
        )


class RotationProfileTests(unittest.TestCase):
    def run_profile(
        self,
        prefix: str,
    ) -> tuple[dict, FakeRotationTaskModel]:
        model = FakeRotationTaskModel(rotation_segmentations(prefix))
        image = Image.new("RGB", (1_000, 1_600), "white")
        with patch.object(
            line_finder,
            "load_default_model",
            return_value=loaded_rotation_model(model),
        ):
            layout = line_finder.segment_image(
                image,
                source=source_fixture(1_000, 1_600),
                rotations_degrees=[0, 90, 270],
            )
        return layout, model

    def test_default_remains_one_pass_and_rotation_preserves_base_line(self) -> None:
        default_model = FakeRotationTaskModel(rotation_segmentations("same"))
        image = Image.new("RGB", (1_000, 1_600), "white")
        with patch.object(
            line_finder,
            "load_default_model",
            return_value=loaded_rotation_model(default_model),
        ):
            default_layout = line_finder.segment_image(
                image,
                source=source_fixture(1_000, 1_600),
            )

        rotated_layout, rotated_model = self.run_profile("same")

        self.assertEqual(default_model.calls, [(1_000, 1_600)])
        self.assertEqual(
            rotated_model.calls,
            [(1_000, 1_600), (1_600, 1_000), (1_600, 1_000)],
        )
        self.assertNotIn(
            "rotationProfile",
            default_layout["producer"]["config"],
        )
        self.assertEqual(
            rotated_layout["segmentation"]["lines"][0],
            default_layout["segmentation"]["lines"][0],
        )
        self.assertEqual(
            rotated_layout["segmentation"]["lines"][0]["id"],
            default_layout["segmentation"]["lines"][0]["id"],
        )

    def test_rotation_profile_appends_only_selected_directional_proposals(
        self,
    ) -> None:
        layout, _ = self.run_profile("directions")
        lines = layout["segmentation"]["lines"]
        appended = lines[1:]

        self.assertEqual(len(lines), 7)
        self.assertEqual(
            [line["providerTextDirection"] for line in appended],
            ["vertical-lr"] * 3 + ["vertical-rl"] * 3,
        )
        self.assertTrue(
            all(line["identityVersion"] == 3 for line in appended)
        )
        self.assertTrue(
            all(
                line["idSource"]
                == "derived-source-raster-model-rotation-provider-geometry-v3"
                for line in appended
            )
        )
        self.assertTrue(
            all(
                line["providerRegionIds"] == []
                and line["regionIds"] == []
                and line["unresolvedProviderRegionIds"] == []
                for line in appended
            )
        )
        evidence_keys = {
            "evidenceContract",
            "mergePolicy",
            "clusterIndex",
            "supportCount",
            "sourceRotationsDegrees",
            "sourcePassStatuses",
            "representativeRotationDegrees",
            "representativeProviderOrdinal",
            "memberProviderIds",
            "readingOrderSource",
        }
        self.assertTrue(
            all(set(line["rotationEvidence"]) == evidence_keys for line in appended)
        )
        self.assertTrue(
            all(
                line["rotationEvidence"]["readingOrderSource"]
                == "unresolved-rotated-proposal"
                for line in appended
            )
        )
        self.assertEqual(
            layout["segmentation"]["readingOrder"]["lineIds"],
            [line["id"] for line in lines],
        )
        profile = layout["producer"]["config"]["rotationProfile"]
        self.assertEqual(
            profile,
            {
                "name": "sideways-recovery-v1",
                "evidenceContract": "native-and-source-projected-v2",
                "rotationsDegrees": [0, 90, 270],
                "mergePolicy": (
                    "baseline-plus-nonoverlapping-vertical-zones"
                ),
                "coordinateTransform": "pil-pixel-centers-to-source-v1",
                "selectionParameters": (
                    line_finder.ROTATION_PROFILE_SELECTION_PARAMETERS
                ),
                "selectionSummary": {
                    "rawInputLineCount": 7,
                    "inputLineCount": 7,
                    "clusterCount": 7,
                    "includedClusterCount": 7,
                    "rejectedClusterCount": 0,
                    "appendedRotatedLineCount": 6,
                },
            },
        )

    def test_rotated_ids_ignore_provider_id_drift(self) -> None:
        first, _ = self.run_profile("provider-run-a")
        second, _ = self.run_profile("provider-run-b")
        first_lines = first["segmentation"]["lines"][1:]
        second_lines = second["segmentation"]["lines"][1:]

        self.assertEqual(
            [line["id"] for line in first_lines],
            [line["id"] for line in second_lines],
        )
        self.assertNotEqual(
            [line["providerId"] for line in first_lines],
            [line["providerId"] for line in second_lines],
        )

    def test_any_rotation_pass_failure_aborts_the_page(self) -> None:
        model = FakeRotationTaskModel(
            rotation_segmentations("failure"),
            fail_on_call=3,
        )
        image = Image.new("RGB", (1_000, 1_600), "white")
        with (
            patch.object(
                line_finder,
                "load_default_model",
                return_value=loaded_rotation_model(model),
            ),
            self.assertRaisesRegex(RuntimeError, "rotation pass 3 failed"),
        ):
            line_finder.segment_image(
                image,
                source=source_fixture(1_000, 1_600),
                rotations_degrees=[0, 90, 270],
            )
        self.assertEqual(len(model.calls), 3)

    def test_rotation_profile_rejects_non_horizontal_page_before_inference(
        self,
    ) -> None:
        model = FakeRotationTaskModel(rotation_segmentations("direction"))
        with (
            patch.object(
                line_finder,
                "load_default_model",
                return_value=loaded_rotation_model(model),
            ),
            self.assertRaisesRegex(ValueError, "requires horizontal-lr"),
        ):
            line_finder.segment_image(
                Image.new("RGB", (1_000, 1_600), "white"),
                source=source_fixture(1_000, 1_600),
                text_direction="vertical-lr",
                rotations_degrees=[0, 90, 270],
            )
        self.assertEqual(model.calls, [])

    def test_cli_passes_the_explicit_rotation_profile(self) -> None:
        layout = {"schemaVersion": 2, "kind": "PageLayout"}
        stdout = io.StringIO()
        with (
            patch.object(
                line_finder,
                "find_lines",
                return_value=(b"normalized", layout),
            ) as find_lines,
            patch.object(
                sys,
                "argv",
                [
                    "line_finder.py",
                    "fixture.png",
                    "--native-json",
                    "--rotations",
                    "0",
                    "90",
                    "270",
                ],
            ),
            redirect_stdout(stdout),
        ):
            line_finder.main()

        self.assertEqual(json.loads(stdout.getvalue()), layout)
        find_lines.assert_called_once_with(
            "fixture.png",
            text_direction="horizontal-lr",
            rotations_degrees=(0, 90, 270),
        )


class NativeWorkerProtocolTests(unittest.TestCase):
    def test_loads_once_isolates_request_errors_and_shuts_down_cleanly(self) -> None:
        layout = {"schemaVersion": 2, "kind": "PageLayout"}
        stdin = io.StringIO(
            "\n".join(
                [
                    json.dumps(
                        {
                            "type": "detect",
                            "id": "request-failure",
                            "imagePath": "missing.jpg",
                            "textDirection": "horizontal-lr",
                        }
                    ),
                    json.dumps(
                        {
                            "type": "detect",
                            "id": "request-success",
                            "imagePath": "fixture.jpg",
                            "textDirection": "horizontal-lr",
                            "rotationsDegrees": [0, 90, 270],
                        }
                    ),
                    json.dumps({"type": "shutdown", "id": "shutdown-1"}),
                ]
            )
            + "\n"
        )
        stdout = io.StringIO()
        loaded = line_finder.LoadedModel(
            task_model=object(),
            provenance={
                "name": "blla.mlmodel",
                "kind": "test",
                "sha256": "d" * 64,
                "sizeBytes": 99,
            },
        )

        with (
            patch.object(sys, "stdin", stdin),
            redirect_stdout(stdout),
            patch.object(
                line_finder,
                "load_default_model",
                return_value=loaded,
            ) as load_model,
            patch.object(
                line_finder,
                "find_lines",
                side_effect=[
                    FileNotFoundError("missing fixture"),
                    (b"normalized", layout),
                ],
            ) as find_lines,
        ):
            exit_code = line_finder.run_native_json_worker()

        messages = [
            json.loads(line)
            for line in stdout.getvalue().splitlines()
        ]
        self.assertEqual(exit_code, 0)
        self.assertEqual(
            [message["type"] for message in messages],
            ["ready", "result", "result", "stopped"],
        )
        self.assertEqual(messages[0]["protocol"], line_finder.WORKER_PROTOCOL)
        self.assertEqual(messages[0]["version"], 2)
        self.assertFalse(messages[1]["ok"])
        self.assertEqual(messages[1]["id"], "request-failure")
        self.assertEqual(messages[1]["error"]["type"], "FileNotFoundError")
        self.assertTrue(messages[2]["ok"])
        self.assertEqual(messages[2]["layout"], layout)
        self.assertEqual(messages[3]["id"], "shutdown-1")
        load_model.assert_called_once_with()
        self.assertEqual(find_lines.call_count, 2)
        self.assertEqual(
            find_lines.call_args_list[1].kwargs,
            {
                "text_direction": "horizontal-lr",
                "process_mode": "persistent-worker",
                "rotations_degrees": (0, 90, 270),
            },
        )

    def test_rejects_a_bad_request_without_ending_the_stream(self) -> None:
        stdin = io.StringIO(
            "\n".join(
                [
                    json.dumps(
                        {
                            "type": "detect",
                            "id": "bad",
                            "imagePath": "fixture.jpg",
                            "unexpected": True,
                        }
                    ),
                    json.dumps({"type": "shutdown", "id": "shutdown-2"}),
                ]
            )
            + "\n"
        )
        stdout = io.StringIO()
        loaded = line_finder.LoadedModel(
            task_model=object(),
            provenance={
                "name": "blla.mlmodel",
                "kind": "test",
                "sha256": "d" * 64,
                "sizeBytes": 99,
            },
        )

        with (
            patch.object(sys, "stdin", stdin),
            redirect_stdout(stdout),
            patch.object(
                line_finder,
                "load_default_model",
                return_value=loaded,
            ),
        ):
            exit_code = line_finder.run_native_json_worker()

        messages = [
            json.loads(line)
            for line in stdout.getvalue().splitlines()
        ]
        self.assertEqual(exit_code, 0)
        self.assertFalse(messages[1]["ok"])
        self.assertIn("unknown fields", messages[1]["error"]["message"])
        self.assertEqual(messages[2]["type"], "stopped")

    def test_rotation_request_parsing_is_strict_and_versioned(self) -> None:
        self.assertEqual(
            line_finder._parse_worker_detect_request(
                {
                    "type": "detect",
                    "id": "rotated",
                    "imagePath": "fixture.jpg",
                    "rotationsDegrees": [0, 90, 270],
                }
            ),
            (
                "rotated",
                "fixture.jpg",
                "horizontal-lr",
                (0, 90, 270),
            ),
        )
        self.assertEqual(line_finder.WORKER_PROTOCOL_VERSION, 2)
        for invalid in (
            [0, 270, 90],
            [0, 90],
            [0, 90, 180, 270],
            [0, 90, True],
            "0,90,270",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                line_finder._parse_worker_detect_request(
                    {
                        "type": "detect",
                        "id": "invalid",
                        "imagePath": "fixture.jpg",
                        "rotationsDegrees": invalid,
                    }
                )


class ImageNormalizationTests(unittest.TestCase):
    def test_records_exif_rotation_and_normalized_dimensions(self) -> None:
        image = Image.new("RGB", (40, 20), "white")
        exif = image.getexif()
        exif[0x0112] = 6
        source = io.BytesIO()
        image.save(source, format="JPEG", exif=exif)

        corrected, metadata = line_finder.normalize_orientation_with_metadata(
            source.getvalue()
        )
        normalized = Image.open(io.BytesIO(corrected))

        self.assertEqual(metadata["operation"], "rotate-90-cw")
        self.assertTrue(metadata["applied"])
        self.assertEqual(metadata["original"]["width"], 40)
        self.assertEqual(metadata["original"]["height"], 20)
        self.assertEqual(normalized.size, (20, 40))
        self.assertEqual(metadata["normalized"]["width"], 20)
        self.assertEqual(metadata["normalized"]["height"], 40)


if __name__ == "__main__":
    unittest.main()
