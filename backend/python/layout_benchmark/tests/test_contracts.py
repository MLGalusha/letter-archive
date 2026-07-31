from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image

from layout_benchmark.cohort import CohortPage, canonical_page_key
from layout_benchmark.engines import (
    EngineAdapter,
    _install_eynollah_models,
    _normalize_docker_platform,
    _parse_macos_time_ms,
    _verify_eynollah_model_directory,
    _without_time_metrics,
)
from layout_benchmark.kraken_worker import (
    RotationBaselinePassError,
    _inference_provider,
    _provider_json_default,
    segment,
)
from layout_benchmark.normalization import (
    CANONICAL_CLASSES,
    _polygon,
    normalize_provider_output,
    normalize_kraken,
    normalize_pagexml,
)
from layout_benchmark.preparation import prepare_page, rgb8_raster_sha256
from layout_benchmark.runner import (
    _build_artifact_integrity,
    _empty_timings,
    _layout_quality_error,
    _prepared_raster_sha256,
    _process_page,
    _resource_values,
    _snapshot_source_files,
    _source_paths,
    _source_provenance,
    _validate_and_publish_staged_run,
    _verify_source_snapshot,
    _verify_source_provenance,
    run_benchmark,
)
from layout_benchmark.util import (
    SAFE_ID_RE,
    BenchmarkError,
    canonical_json_bytes,
)


class CohortIdentityTests(unittest.TestCase):
    def test_legacy_filename_gets_explicit_page_suffix(self) -> None:
        self.assertEqual(
            canonical_page_key("005-19150813-L01.jpg", 1),
            "005-19150813-L01-01",
        )

    def test_unknown_date_filename_matches_shared_page_key_contract(self) -> None:
        self.assertEqual(
            canonical_page_key("015-19XX0101-L01-02.jpg", 2),
            "015-19XX0101-L01-02",
        )
        self.assertEqual(
            canonical_page_key("015-19XX0101-L01.jpg", 2),
            "015-19XX0101-L01-02",
        )


class PreparationTests(unittest.TestCase):
    def test_rgb8_raster_fingerprint_matches_cross_language_vector(self) -> None:
        pixels = bytes([255, 0, 0, 0, 255, 0])
        self.assertEqual(
            rgb8_raster_sha256(2, 1, pixels),
            "26124663c1a612b12452329a6ea42dec60ab15e2c42676ec8d3dde537e62bb70",
        )

    def test_comparison_hashes_pixels_and_rejects_forged_declarations(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runs_root = Path(temporary)
            prepared_records: list[tuple[dict, dict]] = []
            for run_id, compress_level in (("run-a", 0), ("run-b", 9)):
                page_root = runs_root / run_id / "pages" / "page"
                page_root.mkdir(parents=True)
                prepared_path = page_root / "prepared.png"
                image = Image.new("RGB", (2, 1))
                image.putdata([(255, 0, 0), (0, 255, 0)])
                image.save(
                    prepared_path,
                    format="PNG",
                    compress_level=compress_level,
                )
                encoded_sha256 = hashlib.sha256(
                    prepared_path.read_bytes()
                ).hexdigest()
                prepared_records.append(
                    (
                        {"runId": run_id},
                        {
                            "artifact": "pages/page/prepared.png",
                            "sha256": encoded_sha256,
                            "width": 2,
                            "height": 1,
                        },
                    )
                )

            self.assertNotEqual(
                prepared_records[0][1]["sha256"],
                prepared_records[1][1]["sha256"],
            )
            cache: dict[tuple[str, int, int], str] = {}
            with patch("layout_benchmark.runner.RUNS_ROOT", runs_root):
                left = _prepared_raster_sha256(
                    *prepared_records[0],
                    cache,
                )
                right = _prepared_raster_sha256(
                    *prepared_records[1],
                    cache,
                )
                self.assertEqual(left, right)
                self.assertEqual(
                    left,
                    "26124663c1a612b12452329a6ea42dec60ab15e2c42676ec8d3dde537e62bb70",
                )

                forged = {
                    **prepared_records[1][1],
                    "rasterFingerprint": {
                        "algorithm": "sha256-rgb8-v1",
                        "sha256": "0" * 64,
                    },
                }
                with self.assertRaises(BenchmarkError) as context:
                    _prepared_raster_sha256(
                        prepared_records[1][0],
                        forged,
                        cache,
                    )
                self.assertEqual(
                    context.exception.code,
                    "PREPARED_RASTER_FINGERPRINT_MISMATCH",
                )

    def test_exif_transpose_is_deterministic_and_strips_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "002-19001113-L01-01.jpg"
            image = Image.new("RGB", (3, 2))
            pixels = image.load()
            pixels[0, 0] = (255, 0, 0)
            pixels[2, 1] = (0, 0, 255)
            exif = Image.Exif()
            exif[274] = 6
            image.save(source, format="JPEG", quality=100, exif=exif)
            source_bytes = source.read_bytes()
            page = CohortPage(
                page_key="002-19001113-L01-01",
                collection_code="002",
                date_raw="19001113",
                document_type="L",
                type_sequence=1,
                page_number=1,
                original_filename=source.name,
                checksum_sha256=hashlib.sha256(source_bytes).hexdigest(),
                width=3,
                height=2,
                challenge_tags=("exif-orientation",),
                source_path=source,
            )
            first = root / "first.png"
            second = root / "second.png"
            prepared_first = prepare_page(page, first)
            prepared_second = prepare_page(page, second)

            self.assertEqual((prepared_first.width, prepared_first.height), (2, 3))
            self.assertEqual(prepared_first.source_exif_orientation, 6)
            self.assertEqual(prepared_first.sha256, prepared_second.sha256)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with Image.open(first) as result:
                self.assertEqual(result.mode, "RGB")
                self.assertNotIn(274, result.getexif())


class ResourceMetricTests(unittest.TestCase):
    def test_macos_time_parser_accepts_current_label_first_format(self) -> None:
        stderr = "real 35.01\nuser 31.56\nsys 6.02\n123 maximum resident set size\n"
        self.assertEqual(_parse_macos_time_ms(stderr, "user"), 31560)
        self.assertEqual(_parse_macos_time_ms(stderr, "sys"), 6020)
        self.assertEqual(_without_time_metrics(stderr), "")

    def test_macos_time_parser_accepts_legacy_value_first_format(self) -> None:
        stderr = "35.01 real\n31.56 user\n6.02 sys\n"
        self.assertEqual(_parse_macos_time_ms(stderr, "user"), 31560)
        self.assertEqual(_parse_macos_time_ms(stderr, "sys"), 6020)
        self.assertEqual(_without_time_metrics(stderr), "")

    def test_inference_provider_tracks_configured_device(self) -> None:
        self.assertEqual(
            _inference_provider({"parameters": {"device": "cpu"}}),
            "torch-cpu",
        )
        self.assertEqual(
            _inference_provider({"parameters": {"device": "mps"}}),
            "torch-mps",
        )
        self.assertEqual(
            _inference_provider({"parameters": {"device": "cuda:0"}}),
            "torch-cuda",
        )

    def test_rotation_caveat_uses_configured_passes_and_v2_evidence_contract(
        self,
    ) -> None:
        zones = EngineAdapter("kraken7-rot3-zones")
        union = EngineAdapter("kraken7-rot4-union")
        consensus = EngineAdapter("kraken7-rot4-consensus")

        self.assertIn("0°, 90°, 270°", zones.platform_caveat)
        self.assertNotIn("180°", zones.platform_caveat)
        self.assertIn("0°, 90°, 180°, 270°", union.platform_caveat)
        self.assertIn(
            "0°, 90°, 180°, 270°", consensus.platform_caveat
        )
        self.assertIn(
            "native-and-source-projected-v2", zones.platform_caveat
        )
        self.assertIn("single-pass heuristic", zones.platform_caveat)
        self.assertEqual(zones.config["adapterVersion"], "2")
        self.assertEqual(union.config["adapterVersion"], "6")
        self.assertEqual(consensus.config["adapterVersion"], "6")
        for adapter in (zones, union, consensus):
            self.assertEqual(
                adapter.config["rotationEvidenceContract"],
                "native-and-source-projected-v2",
            )
            self.assertFalse(
                adapter.config["diagnostic"]["equivalentToDefaultProfile"]
            )

    def test_safe_rotation_projection_is_pinned_non_rankable_and_no_inference(
        self,
    ) -> None:
        adapter = EngineAdapter("kraken7-rot3-safe-zones")
        masked = EngineAdapter(
            "kraken7-rot3-eyno-mask-p16-safe-zones"
        )

        self.assertEqual(
            adapter.config["adapter"], "layout-run-rotation-projection"
        )
        self.assertFalse(
            adapter.config["diagnostic"]["equivalentToDefaultProfile"]
        )
        self.assertFalse(adapter.config["diagnostic"]["rankable"])
        self.assertEqual(
            adapter.config["sourceRuns"]["rotationEvidence"]["manifestSha256"],
            "4e4e2913dba57265fca8136e24cf3b1c7992a7e7c8c59429a8cc37c55b65eb7d",
        )
        self.assertIn("performs no model inference", adapter.platform_caveat)
        self.assertIn("Rejected candidate zones", adapter.platform_caveat)
        self.assertFalse(
            masked.config["diagnostic"]["equivalentToDefaultProfile"]
        )
        self.assertEqual(
            masked.config["sourceRuns"]["rotationEvidence"]["runId"],
            "kraken7-rot3-eyno-mask-p16-targeted9-20260728",
        )
        self.assertEqual(
            masked.config["sourceRuns"]["rotationEvidence"][
                "manifestSha256"
            ],
            "5426e01189f63fe3f2e446b567aa64ae0296dbf70c757cc754f6bf0083673aae",
        )

    def test_rot3_strict_mask_profile_is_pinned_and_non_rankable(
        self,
    ) -> None:
        adapter = EngineAdapter("kraken7-rot3-eyno-mask-p0")

        self.assertEqual(
            adapter.config["inputStage"]["type"],
            "eynollah-page-mask",
        )
        self.assertEqual(
            adapter.config["inputStage"]["paddingPixels"],
            0,
        )
        self.assertEqual(
            adapter.config["parameters"]["rotationsDegrees"],
            [0, 90, 270],
        )
        self.assertEqual(
            adapter.config["rotationEvidenceContract"],
            "native-and-source-projected-v2",
        )
        self.assertFalse(adapter.config["diagnostic"]["rankable"])
        safe = EngineAdapter("kraken7-rot3-eyno-mask-p0-safe-zones")
        self.assertEqual(
            safe.config["sourceRuns"]["rotationEvidence"]["manifestSha256"],
            "ff53a687f03fd12a8b84001cc2eaabc9f3d846142c7aad8d2e5995ef57c227bd",
        )
        self.assertEqual(
            safe.config["parameters"]["rotationMergePolicy"],
            "baseline-plus-nonoverlapping-vertical-zones",
        )
        self.assertFalse(safe.config["diagnostic"]["rankable"])

    def test_rot4_ablation_matrix_shares_one_frozen_source(self) -> None:
        expected_manifest_sha256 = (
            "3f4f662eb8e66d57125fe84bafa2e935"
            "9ec1df7c5e1e14d99ad0ec562d4be0bd"
        )
        expected = {
            "kraken7-rot3-union-ablation": (
                [0, 90, 270],
                "evidence-union",
            ),
            "kraken7-rot3-consensus-ablation": (
                [0, 90, 270],
                "baseline-plus-consensus",
            ),
            "kraken7-rot3-safe-zones-ablation": (
                [0, 90, 270],
                "baseline-plus-nonoverlapping-vertical-zones",
            ),
            "kraken7-rot4-consensus-replay": (
                [0, 90, 180, 270],
                "baseline-plus-consensus",
            ),
            "kraken7-rot4-safe-zones-replay": (
                [0, 90, 180, 270],
                "baseline-plus-nonoverlapping-vertical-zones",
            ),
        }

        for engine_id, (rotations, merge_policy) in expected.items():
            with self.subTest(engine_id=engine_id):
                adapter = EngineAdapter(engine_id)
                binding = adapter.config["sourceRuns"]["rotationEvidence"]
                parameters = adapter.config["parameters"]
                self.assertEqual(
                    binding["runId"],
                    "kraken7-rot4-union-targeted8-v2-20260728",
                )
                self.assertEqual(
                    binding["manifestSha256"],
                    expected_manifest_sha256,
                )
                self.assertEqual(
                    binding["expectedRotationsDegrees"],
                    [0, 90, 180, 270],
                )
                self.assertEqual(
                    parameters["sourceRotationsDegrees"],
                    rotations,
                )
                self.assertEqual(
                    parameters["rotationMergePolicy"],
                    merge_policy,
                )
                self.assertTrue(
                    parameters["requireSuccessfulBaselinePass"]
                )
                self.assertFalse(
                    adapter.config["diagnostic"]["rankable"]
                )

    def test_failed_zero_rotation_writes_raw_evidence_then_fails_page(
        self,
    ) -> None:
        empty_segmentation = SimpleNamespace(
            type="baselines",
            text_direction="horizontal-lr",
            script_detection=False,
            line_orders=[],
            language=None,
            regions={},
            lines=[],
        )
        model = SimpleNamespace()
        model.predict = Mock(
            side_effect=[
                RuntimeError("zero-degree provider failure"),
                empty_segmentation,
            ]
        )
        config = {
            "adapter": "kraken",
            "api": "segmentation-task",
            "provider": "kraken-test",
            "rotationEvidenceContract": "native-and-source-projected-v2",
            "parameters": {
                "textDirection": "horizontal-lr",
                "device": "cpu",
                "precision": "32-true",
                "batchSize": 1,
                "numThreads": 1,
                "inputPadding": 0,
                "raiseOnError": True,
                "rotationFallbackRaiseOnErrorFalse": False,
                "rotationsDegrees": [0, 90],
                "rotationMergePolicy": "baseline-plus-consensus",
            },
        }
        metadata = {
            "package": {"name": "kraken", "version": "7.0.3"},
            "plugins": [],
            "models": [{"path": "/not-read/model.mlmodel"}],
            "inferenceProvider": "torch-cpu",
            "runtimeInference": {},
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "prepared.png"
            output_path = root / "raw.json"
            Image.new("RGB", (20, 30), "white").save(input_path)
            with (
                patch(
                    "layout_benchmark.kraken_worker.describe",
                    return_value=metadata,
                ),
                patch(
                    "kraken.tasks.SegmentationTaskModel.load_model",
                    return_value=model,
                ),
                patch(
                    "layout_benchmark.kraken_worker._task_inference_config",
                    return_value=object(),
                ),
                self.assertRaises(RotationBaselinePassError),
            ):
                segment(
                    config,
                    root / "config.json",
                    input_path,
                    output_path,
                )
            raw = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(
            raw["qualityError"]["code"],
            "ROTATION_BASELINE_PASS_NOT_SUCCEEDED",
        )
        self.assertEqual(raw["rotationPasses"][0]["status"], "failed")
        self.assertEqual(
            raw["rotationPasses"][0]["nativeSegmentation"]["lines"], []
        )
        self.assertEqual(
            raw["rotationPasses"][0][
                "sourceProjectedSegmentation"
            ]["lines"],
            [],
        )
        self.assertEqual(raw["rotationPasses"][1]["status"], "succeeded")

    def test_orli_profiles_pin_required_bfloat16_mps_runtime(self) -> None:
        for engine_id in ("kraken7-orli", "kraken7-orli-cap128"):
            adapter = EngineAdapter(engine_id)
            self.assertEqual(adapter.config["adapterVersion"], "2")
            self.assertEqual(adapter.config["parameters"]["device"], "mps")
            self.assertEqual(
                adapter.config["parameters"]["precision"],
                "bf16-mixed",
            )
            self.assertFalse(adapter.config["parameters"]["polygonize"])
            self.assertIn("32-true output is invalid", adapter.platform_caveat)

    def test_orli_cpu_profile_changes_only_runtime_device_for_diagnosis(self) -> None:
        mps = EngineAdapter("kraken7-orli")
        cpu = EngineAdapter("kraken7-orli-cpu")

        self.assertEqual(cpu.config["parameters"]["device"], "cpu")
        self.assertEqual(cpu.config["parameters"]["precision"], "bf16-mixed")
        self.assertFalse(cpu.config["parameters"]["polygonize"])
        self.assertEqual(cpu.config["parameters"]["maxPredictedLines"], 768)
        self.assertEqual(cpu.config["execution"]["timeoutSeconds"], 3600)
        self.assertEqual(
            cpu.config["execution"]["python"],
            mps.config["execution"]["python"],
        )
        self.assertEqual(cpu.config["model"], mps.config["model"])
        self.assertEqual(cpu.config["package"], mps.config["package"])
        self.assertEqual(cpu.config["plugins"], mps.config["plugins"])
        self.assertFalse(cpu.config["diagnostic"]["equivalentToDefaultProfile"])
        self.assertIn("distinguish Apple MPS", cpu.platform_caveat)
        self.assertIn("non-viable", mps.platform_caveat)
        with (
            patch.object(cpu, "_setup_kraken_runtime") as setup_runtime,
            patch.object(
                cpu,
                "preflight",
                return_value={"id": "kraken7-orli-cpu"},
            ),
        ):
            self.assertEqual(cpu.setup()["id"], "kraken7-orli-cpu")
        setup_runtime.assert_called_once_with()

    def test_orli_cpu_cap_profile_is_a_shared_runtime_fail_fast_gate(self) -> None:
        cpu = EngineAdapter("kraken7-orli-cpu")
        capped = EngineAdapter("kraken7-orli-cpu-cap128")

        self.assertEqual(capped.config["parameters"]["device"], "cpu")
        self.assertEqual(capped.config["parameters"]["precision"], "bf16-mixed")
        self.assertFalse(capped.config["parameters"]["polygonize"])
        self.assertEqual(capped.config["parameters"]["maxPredictedLines"], 128)
        self.assertEqual(
            capped.config["execution"]["python"],
            cpu.config["execution"]["python"],
        )
        self.assertEqual(capped.config["model"], cpu.config["model"])
        self.assertEqual(capped.config["package"], cpu.config["package"])
        self.assertEqual(capped.config["plugins"], cpu.config["plugins"])
        self.assertFalse(capped.config["diagnostic"]["equivalentToDefaultProfile"])
        self.assertTrue(capped.config["diagnostic"]["capReachedIsQualityFailure"])
        self.assertIn("CPU with bf16-mixed", capped.platform_caveat)
        self.assertIn("stops generation at 128 lines", capped.platform_caveat)

    def test_orli_preflight_validates_and_records_device_precision(self) -> None:
        adapter = EngineAdapter("kraken7-orli")
        observed = {
            "package": {"name": "kraken", "version": "7.0.3"},
            "pythonVersion": "3.12.12",
            "dependencies": {"kraken": "7.0.3", "orli": "0.0.2"},
            "models": [{"name": "orli.safetensors", "sha256": "a" * 64, "sizeBytes": 1}],
            "inferenceProvider": "torch-mps",
            "runtimeInference": {
                "configuredDevice": "mps",
                "configuredPrecision": "bf16-mixed",
                "inferenceProvider": "torch-mps",
                "accelerator": "mps",
                "devices": "auto",
                "resolvedDevice": "mps:0",
                "precisionPlugin": "MixedPrecision",
            },
        }
        completed = subprocess.CompletedProcess(
            args=["worker", "--describe"],
            returncode=0,
            stdout=json.dumps(observed),
            stderr="",
        )
        with (
            patch.object(adapter, "_python_path", return_value=Path(__file__)),
            patch(
                "layout_benchmark.engines.run_capture",
                return_value=completed,
            ),
        ):
            preflight = adapter._preflight_kraken()

        self.assertEqual(preflight["execution"]["inferenceProvider"], "torch-mps")
        self.assertEqual(
            preflight["execution"]["runtimeInference"],
            observed["runtimeInference"],
        )
        self.assertEqual(
            preflight["configuration"]["values"]["parameters"]["precision"],
            "bf16-mixed",
        )
        self.assertEqual(
            preflight["configuration"]["values"]["parameters"]["device"],
            "mps",
        )

    def test_orli_preflight_rejects_device_precision_drift(self) -> None:
        adapter = EngineAdapter("kraken7-orli")
        observed = {
            "package": {"name": "kraken", "version": "7.0.3"},
            "pythonVersion": "3.12.12",
            "dependencies": {},
            "models": [],
            "inferenceProvider": "torch-cpu",
            "runtimeInference": {
                "configuredDevice": "cpu",
                "configuredPrecision": "32-true",
                "inferenceProvider": "torch-cpu",
            },
        }
        completed = subprocess.CompletedProcess(
            args=["worker", "--describe"],
            returncode=0,
            stdout=json.dumps(observed),
            stderr="",
        )
        with (
            patch.object(adapter, "_python_path", return_value=Path(__file__)),
            patch(
                "layout_benchmark.engines.run_capture",
                return_value=completed,
            ),
            self.assertRaises(BenchmarkError) as caught,
        ):
            adapter._preflight_kraken()

        self.assertEqual(caught.exception.code, "ENGINE_INFERENCE_CONFIG_DRIFT")

    def test_provider_json_encoder_preserves_numpy_geometry(self) -> None:
        import numpy as np

        self.assertEqual(
            _provider_json_default(np.array([[1, 2], [3, 4]])),
            [[1, 2], [3, 4]],
        )
        self.assertEqual(_provider_json_default(np.int64(7)), 7)

    def test_failed_kraken_invocation_preserves_peak_rss_and_method(self) -> None:
        adapter = EngineAdapter("kraken7")
        result = subprocess.CompletedProcess(
            args=["worker"],
            returncode=9,
            stdout="provider stdout",
            stderr=(
                "provider stderr\n"
                "real 2.00\nuser 1.25\nsys 0.50\n"
                "987654 maximum resident set size\n"
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prepared = root / "prepared.png"
            prepared.write_bytes(b"input")
            with patch(
                "layout_benchmark.engines.run_capture",
                return_value=result,
            ):
                with self.assertRaises(BenchmarkError) as caught:
                    adapter._run_kraken(prepared, root / "raw.json")

        details = caught.exception.details
        self.assertEqual(details["peakRssBytes"], 987654)
        self.assertEqual(
            details["resourceMeasurement"]["method"], "usr-bin-time"
        )
        self.assertEqual(details["engineUserCpuMs"], 1250)
        peak_rss, measurement = _resource_values(None, caught.exception)
        self.assertEqual(peak_rss, 987654)
        self.assertEqual(measurement["method"], "usr-bin-time")

    def test_failed_kraken_page_preserves_measured_cpu_timings(self) -> None:
        class FailingAdapter:
            engine_id = "kraken7"
            raw_filename = "raw.json"

            def run_page(self, _page_directory):
                raise BenchmarkError(
                    "engine-inference",
                    "ENGINE_FAILED",
                    "Synthetic engine failure",
                    {
                        "peakRssBytes": 987654,
                        "resourceMeasurement": {
                            "method": "usr-bin-time",
                            "caveat": "Synthetic isolated worker measurement.",
                        },
                        "engineUserCpuMs": 1250,
                        "engineSystemCpuMs": 500,
                    },
                )

        test_results = Path(__file__).parents[3] / "test-results"
        test_results.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_results) as temporary:
            root = Path(temporary)
            source = root / "001-18881103-L01-01.jpg"
            Image.new("RGB", (3, 2), color="white").save(source, "JPEG")
            source_bytes = source.read_bytes()
            page = CohortPage(
                page_key="001-18881103-L01-01",
                collection_code="001",
                date_raw="18881103",
                document_type="L",
                type_sequence=1,
                page_number=1,
                original_filename=source.name,
                checksum_sha256=hashlib.sha256(source_bytes).hexdigest(),
                width=3,
                height=2,
                challenge_tags=("ordinary-horizontal",),
                source_path=source,
            )
            run_directory = root / "run"
            run_directory.mkdir()

            result = _process_page(
                adapter=FailingAdapter(),
                page=page,
                run_id="failure-timing-test",
                run_directory=run_directory,
                preflight_error=None,
            )
            failure_without_details = _process_page(
                adapter=FailingAdapter(),
                page=page,
                run_id="failure-without-details-test",
                run_directory=root / "run-without-details",
                preflight_error=BenchmarkError(
                    "engine-preflight",
                    "ENGINE_UNAVAILABLE",
                    "Synthetic preflight failure without details",
                ),
            )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["timings"]["engineUserCpuMs"], 1250)
        self.assertEqual(result["timings"]["engineSystemCpuMs"], 500)
        self.assertEqual(failure_without_details["status"], "failed")
        self.assertIsNone(
            failure_without_details["timings"]["engineUserCpuMs"]
        )
        self.assertIsNone(
            failure_without_details["timings"]["engineSystemCpuMs"]
        )

    def test_eynollah_exit_zero_without_xml_preserves_process_output(self) -> None:
        adapter = EngineAdapter("eynollah")
        result = subprocess.CompletedProcess(
            args=["docker"],
            returncode=0,
            stdout="provider completed without XML",
            stderr="provider warning",
        )
        cleanup = subprocess.CompletedProcess(
            args=["docker", "rm"],
            returncode=0,
            stdout="",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prepared = root / "prepared.png"
            prepared.write_bytes(b"input")
            models = root / "models"
            models.mkdir()
            with (
                patch.object(
                    adapter,
                    "_eynollah_models_directory",
                    return_value=models,
                ),
                patch.object(
                    adapter,
                    "_docker_prefix",
                    return_value=["docker", "run", "--rm"],
                ),
                patch(
                    "layout_benchmark.engines._inspect_container_state",
                    return_value={"OOMKilled": False},
                ),
                patch(
                    "layout_benchmark.engines.run_capture",
                    side_effect=[result, cleanup],
                ),
            ):
                with self.assertRaises(BenchmarkError) as caught:
                    adapter._run_eynollah(
                        root,
                        prepared,
                        root / "raw.xml",
                    )
            self.assertFalse((root / "provider-output").exists())

        self.assertEqual(caught.exception.code, "RAW_OUTPUT_MISSING")
        self.assertEqual(
            caught.exception.details["stdout"],
            "provider completed without XML",
        )
        self.assertEqual(
            caught.exception.details["stderr"], "provider warning"
        )

    def test_successful_eynollah_removes_provider_output_after_raw_copy(
        self,
    ) -> None:
        adapter = EngineAdapter("eynollah")
        result = subprocess.CompletedProcess(
            args=["docker"],
            returncode=0,
            stdout="provider complete",
            stderr="",
        )
        cleanup = subprocess.CompletedProcess(
            args=["docker", "rm"],
            returncode=0,
            stdout="",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prepared = root / "prepared.png"
            prepared.write_bytes(b"input")
            models = root / "models"
            models.mkdir()
            raw_path = root / "raw.xml"

            def run_capture_side_effect(*args, **kwargs):
                command = args[0]
                if command[:3] == ["docker", "run", "--rm"]:
                    provider_output = root / "provider-output"
                    (provider_output / "page.xml").write_text(
                        "<PcGts/>",
                        encoding="utf-8",
                    )
                    (provider_output / "cgroup-memory-peak.txt").write_text(
                        "1234",
                        encoding="utf-8",
                    )
                    return result
                return cleanup

            with (
                patch.object(
                    adapter,
                    "_eynollah_models_directory",
                    return_value=models,
                ),
                patch.object(
                    adapter,
                    "_docker_prefix",
                    return_value=["docker", "run", "--rm"],
                ),
                patch(
                    "layout_benchmark.engines._inspect_container_state",
                    return_value={"OOMKilled": False},
                ),
                patch(
                    "layout_benchmark.engines.run_capture",
                    side_effect=run_capture_side_effect,
                ),
            ):
                invocation = adapter._run_eynollah(
                    root,
                    prepared,
                    raw_path,
                )

            self.assertEqual(raw_path.read_text(encoding="utf-8"), "<PcGts/>")
            self.assertEqual(invocation.peak_rss_bytes, 1234)
            self.assertFalse((root / "provider-output").exists())


class RunPublicationTests(unittest.TestCase):
    def test_interrupting_active_page_publishes_exact_failure_artifacts(
        self,
    ) -> None:
        class InterruptingAdapter:
            engine_id = "interrupt-engine"
            raw_filename = "raw.json"
            platform_caveat = None

            def __init__(self) -> None:
                self.calls = 0

            def preflight(self) -> dict:
                return {
                    "id": self.engine_id,
                    "adapterVersion": "test-1",
                    "package": {"name": "interrupt-engine", "version": "1.0"},
                    "models": [],
                    "configuration": {
                        "path": "benchmarks/layout/engine-configs/test.v1.json",
                        "sha256": "a" * 64,
                        "values": {},
                    },
                    "execution": {
                        "kind": "venv",
                        "commandFingerprint": "b" * 64,
                        "pythonVersion": "3.12",
                        "inferenceProvider": "test",
                        "dependencies": {},
                    },
                }

            def run_page(self, page_directory: Path):
                self.calls += 1
                (page_directory / "raw.json").write_text(
                    '{"partial":true',
                    encoding="utf-8",
                )
                provider_output = page_directory / "provider-output"
                provider_output.mkdir()
                (provider_output / "scratch.bin").write_bytes(b"scratch")
                (page_directory / ".overlay.png.tmp").write_bytes(b"partial")
                time.sleep(0.01)
                raise KeyboardInterrupt()

        test_results = Path(__file__).parents[3] / "test-results"
        test_results.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_results) as temporary:
            root = Path(temporary)
            pages: list[CohortPage] = []
            for page_number in (1, 2):
                filename = f"001-18881103-L01-{page_number:02d}.jpg"
                source = root / filename
                Image.new("RGB", (3, 2), color="white").save(source, "JPEG")
                source_bytes = source.read_bytes()
                pages.append(
                    CohortPage(
                        page_key=Path(filename).stem,
                        collection_code="001",
                        date_raw="18881103",
                        document_type="L",
                        type_sequence=1,
                        page_number=page_number,
                        original_filename=filename,
                        checksum_sha256=hashlib.sha256(source_bytes).hexdigest(),
                        width=3,
                        height=2,
                        challenge_tags=("ordinary-horizontal",),
                        source_path=source,
                    )
                )

            adapter = InterruptingAdapter()
            runs_root = root / "runs"
            events: list[str] = []

            def verify_source(*_args) -> None:
                events.append("verify")

            def validate_exact_coverage(
                staging_directory: Path,
                _run_id: str,
            ) -> None:
                events.append("validate")
                manifest = json.loads(
                    (staging_directory / "run.v2.json").read_text(
                        encoding="utf-8"
                    )
                )
                expected = {
                    "run.v2.json",
                    *manifest["integrity"]["artifacts"].keys(),
                }
                actual = {
                    path.relative_to(staging_directory).as_posix()
                    for path in staging_directory.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(actual, expected)

            with (
                patch(
                    "layout_benchmark.runner.EngineAdapter",
                    return_value=adapter,
                ),
                patch(
                    "layout_benchmark.runner.load_cohort",
                    return_value=SimpleNamespace(
                        cohort_id="interrupt-cohort",
                        sha256="c" * 64,
                    ),
                ),
                patch(
                    "layout_benchmark.runner.select_pages",
                    return_value=(tuple(pages), "full"),
                ),
                patch(
                    "layout_benchmark.runner.RUNS_ROOT",
                    runs_root,
                ),
                patch(
                    "layout_benchmark.runner._create_source_snapshot",
                    return_value={
                        "algorithm": "sha256",
                        "bundleSha256": "d" * 64,
                        "files": {},
                    },
                ),
                patch(
                    "layout_benchmark.runner.preprocessing_metadata",
                    return_value={
                        "profileId": "test-profile",
                        "path": (
                            "benchmarks/layout/engine-configs/"
                            "shared-preprocessing.v1.json"
                        ),
                        "profileSha256": "e" * 64,
                        "values": {},
                    },
                ),
                patch(
                    "layout_benchmark.runner.git_metadata",
                    return_value={"commit": "test", "dirty": False},
                ),
                patch(
                    "layout_benchmark.runner.host_metadata",
                    return_value={"hostname": "test"},
                ),
                patch(
                    "layout_benchmark.runner.docker_metadata",
                    return_value=None,
                ),
                patch(
                    "layout_benchmark.runner._verify_engine_identity",
                ),
                patch(
                    "layout_benchmark.runner._verify_source_snapshot",
                    side_effect=verify_source,
                ),
                patch(
                    "layout_benchmark.runner._validate_staged_run",
                    side_effect=validate_exact_coverage,
                ),
            ):
                result = run_benchmark(
                    engine_id="interrupt-engine",
                    scope="full",
                    requested_run_id="interrupt-publication-test",
                )

            self.assertEqual(adapter.calls, 1)
            self.assertEqual(events, ["verify", "validate", "verify"])
            self.assertEqual(result["state"], "completed_with_failures")
            self.assertEqual(result["failed"], 2)
            final_directory = runs_root / "interrupt-publication-test"
            self.assertTrue(final_directory.is_dir())
            manifest = json.loads(
                (final_directory / "run.v2.json").read_text(encoding="utf-8")
            )
            active, unstarted = manifest["pages"]
            self.assertEqual(active["error"]["code"], "RUN_INTERRUPTED")
            self.assertEqual(
                active["error"]["details"]["interruptedStage"],
                "engine-inference",
            )
            self.assertIn("while processing", active["error"]["message"])
            self.assertGreaterEqual(active["durationMs"], 1)
            self.assertGreaterEqual(active["timings"]["engineMs"], 1)
            self.assertIsNotNone(active["prepared"])
            self.assertEqual(
                set(active["artifacts"]),
                {"raw", "error"},
            )
            self.assertFalse(
                (final_directory / "pages" / active["pageKey"] / "provider-output").exists()
            )
            self.assertEqual(unstarted["durationMs"], 0)
            self.assertIn("before this page started", unstarted["error"]["message"])
            self.assertEqual(set(unstarted["artifacts"]), {"error"})

    def test_final_source_verification_blocks_post_validation_drift(
        self,
    ) -> None:
        test_results = Path(__file__).parents[3] / "test-results"
        test_results.mkdir(parents=True, exist_ok=True)
        with (
            tempfile.TemporaryDirectory(dir=test_results) as source_temporary,
            tempfile.TemporaryDirectory() as run_temporary,
        ):
            source = Path(source_temporary) / "source.py"
            source.write_bytes(b"before\n")
            run_root = Path(run_temporary)
            staging = run_root / "staging"
            staging.mkdir()
            final = run_root / "published"
            snapshot = _snapshot_source_files(staging, (source,))
            adapter = EngineAdapter("kraken6")

            def mutate_after_validation(
                _staging_directory: Path,
                _run_id: str,
            ) -> None:
                source.write_bytes(b"after\n")

            with (
                patch(
                    "layout_benchmark.runner._source_paths",
                    return_value=(source,),
                ),
                patch(
                    "layout_benchmark.runner._validate_staged_run",
                    side_effect=mutate_after_validation,
                ),
                self.assertRaisesRegex(
                    BenchmarkError,
                    "changed while the run was active",
                ),
            ):
                _validate_and_publish_staged_run(
                    adapter,
                    staging,
                    final,
                    "source-race-test",
                    snapshot,
                )

            self.assertTrue(staging.is_dir())
            self.assertFalse(final.exists())


class EynollahModelIntegrityTests(unittest.TestCase):
    def test_v091_profiles_pin_real_boundary_flags_and_distinct_fingerprints(
        self,
    ) -> None:
        straight = EngineAdapter("eynollah-v091")
        curved = EngineAdapter("eynollah-v091-cl")

        straight_command = straight._eynollah_layout_command()
        curved_command = curved._eynollah_layout_command()
        self.assertEqual(straight.raw_filename, "raw.xml")
        self.assertTrue(straight.page_boundary_available)
        self.assertIn("-fl", straight_command)
        self.assertNotIn("-cl", straight_command)
        self.assertNotIn("-ipe", straight_command)
        self.assertIn("-cl", curved_command)
        self.assertNotIn("-ipe", curved_command)
        self.assertNotEqual(
            straight._eynollah_command_fingerprint(),
            curved._eynollah_command_fingerprint(),
        )
        self.assertEqual(
            straight._eynollah_command_fingerprint(),
            hashlib.sha256(
                canonical_json_bytes({"argv": straight_command})
            ).hexdigest(),
        )
        self.assertRegex(
            straight.config["models"]["publishedSha256"],
            r"^[a-f0-9]{64}$",
        )
        self.assertIn(
            "models_eynollah/model_eynollah_page_extraction_20250915.onnx",
            straight.config["models"]["requiredFiles"],
        )

    def test_nested_archive_root_is_preserved_and_stale_models_are_rejected(
        self,
    ) -> None:
        payload = b"pinned page model"
        relative_path = "models_eynollah/page-extraction.onnx"
        required = {
            relative_path: {
                "sha256": hashlib.sha256(payload).hexdigest(),
                "sizeBytes": len(payload),
            }
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "models.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(relative_path, payload)
            models_directory = root / "models"

            _install_eynollah_models(
                archive_path,
                models_directory,
                required,
            )

            nested_model = models_directory / relative_path
            self.assertEqual(nested_model.read_bytes(), payload)
            self.assertFalse(
                (models_directory / "page-extraction.onnx").exists()
            )
            inventory = _verify_eynollah_model_directory(
                models_directory,
                required,
            )
            self.assertEqual(
                [item["name"] for item in inventory],
                [relative_path],
            )

            nested_model.write_bytes(b"stale")
            with self.assertRaises(BenchmarkError) as caught:
                _verify_eynollah_model_directory(
                    models_directory,
                    required,
                )
            self.assertEqual(
                caught.exception.code,
                "MODEL_MANIFEST_MISMATCH",
            )
            self.assertEqual(
                caught.exception.details["mismatched"],
                [relative_path],
            )


class ProvenanceTests(unittest.TestCase):
    def test_adapter_source_bundle_is_stable_and_guarded(self) -> None:
        adapter = EngineAdapter("kraken6")
        first = _source_provenance(adapter)
        second = _source_provenance(adapter)
        self.assertEqual(first, second)
        self.assertRegex(first["sha256"], r"^[a-f0-9]{64}$")
        self.assertGreater(first["fileCount"], 5)
        changed = {**first, "sha256": "0" * 64}
        with self.assertRaisesRegex(
            Exception, "changed while the run was active"
        ):
            _verify_source_provenance(adapter, changed)

    def test_docker_source_bundle_uses_configured_build_and_dependency_files(
        self,
    ) -> None:
        adapter = EngineAdapter("eynollah")
        paths = {
            path.relative_to(Path(__file__).parents[3]).as_posix()
            for path in _source_paths(adapter)
        }
        self.assertIn(
            adapter.config["execution"]["dockerfile"],
            paths,
        )
        self.assertIn("package.json", paths)
        self.assertIn("package-lock.json", paths)
        self.assertIn("python/requirements.txt", paths)

    def test_source_snapshot_copies_bytes_and_hashes_canonical_map(self) -> None:
        test_results = Path(__file__).parents[3] / "test-results"
        test_results.mkdir(parents=True, exist_ok=True)
        with (
            tempfile.TemporaryDirectory(dir=test_results) as source_temporary,
            tempfile.TemporaryDirectory() as run_temporary,
        ):
            source_root = Path(source_temporary)
            first = source_root / "alpha.py"
            second = source_root / "nested" / "beta.json"
            second.parent.mkdir()
            first.write_bytes(b"alpha\n")
            second.write_bytes(b'{"beta":true}\n')
            run_root = Path(run_temporary)

            snapshot = _snapshot_source_files(
                run_root,
                (second, first),
            )
            original_to_hash = {
                path: metadata["sha256"]
                for path, metadata in snapshot["files"].items()
            }

            self.assertEqual(snapshot["algorithm"], "sha256")
            self.assertEqual(
                snapshot["bundleSha256"],
                hashlib.sha256(
                    canonical_json_bytes(original_to_hash)
                ).hexdigest(),
            )
            for metadata in snapshot["files"].values():
                copied = run_root / metadata["snapshotPath"]
                self.assertTrue(copied.is_file())
                self.assertEqual(copied.stat().st_size, metadata["sizeBytes"])
                self.assertEqual(
                    hashlib.sha256(copied.read_bytes()).hexdigest(),
                    metadata["sha256"],
                )

    def test_source_snapshot_detects_live_source_drift(self) -> None:
        test_results = Path(__file__).parents[3] / "test-results"
        test_results.mkdir(parents=True, exist_ok=True)
        with (
            tempfile.TemporaryDirectory(dir=test_results) as source_temporary,
            tempfile.TemporaryDirectory() as run_temporary,
        ):
            source = Path(source_temporary) / "source.py"
            source.write_bytes(b"before\n")
            run_root = Path(run_temporary)
            snapshot = _snapshot_source_files(run_root, (source,))
            source.write_bytes(b"after\n")
            adapter = EngineAdapter("kraken6")
            with patch(
                "layout_benchmark.runner._source_paths",
                return_value=(source,),
            ):
                with self.assertRaisesRegex(
                    BenchmarkError, "changed while the run was active"
                ):
                    _verify_source_snapshot(
                        adapter,
                        run_root,
                        snapshot,
                    )

    def test_integrity_map_exactly_covers_referenced_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {
                "pages/a/prepared.png": b"prepared",
                "pages/a/raw.json": b"raw",
                "pages/a/normalized-layout.v1.json": b"normalized",
                "pages/a/overlay.png": b"overlay",
                "pages/b/error.json": b"error",
                "source-snapshot/python/runner.py": b"source",
                "run.v2.json": b"manifest-is-excluded",
            }
            for relative, content in paths.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            pages = [
                {
                    "prepared": {"artifact": "pages/a/prepared.png"},
                    "artifacts": {
                        "raw": "pages/a/raw.json",
                        "normalized": "pages/a/normalized-layout.v1.json",
                        "overlay": "pages/a/overlay.png",
                    },
                },
                {
                    "prepared": None,
                    "artifacts": {"error": "pages/b/error.json"},
                },
            ]
            source_snapshot = {
                "files": {
                    "python/runner.py": {
                        "snapshotPath": "source-snapshot/python/runner.py"
                    }
                }
            }

            integrity = _build_artifact_integrity(
                root,
                pages,
                source_snapshot,
            )

            expected = set(paths) - {"run.v2.json"}
            self.assertEqual(set(integrity["artifacts"]), expected)
            self.assertEqual(integrity["algorithm"], "sha256")
            for relative in expected:
                self.assertEqual(
                    integrity["artifacts"][relative],
                    {
                        "sha256": hashlib.sha256(paths[relative]).hexdigest(),
                        "sizeBytes": len(paths[relative]),
                    },
                )

    def test_unattempted_stage_timings_are_nullable(self) -> None:
        timings = _empty_timings()
        for stage in (
            "preparationMs",
            "engineMs",
            "normalizationMs",
            "overlayMs",
        ):
            self.assertIsNone(timings[stage])
        self.assertEqual(timings["totalMs"], 0)

    def test_docker_platform_aliases_are_normalized(self) -> None:
        self.assertEqual(_normalize_docker_platform("linux/aarch64"), "linux/arm64")
        self.assertEqual(_normalize_docker_platform("linux/x86_64"), "linux/amd64")

    def test_orli_cap_profile_is_explicitly_non_equivalent_and_failing(self) -> None:
        adapter = EngineAdapter("kraken7-orli-cap128")
        self.assertEqual(adapter.config["parameters"]["maxPredictedLines"], 128)
        self.assertEqual(adapter.config["parameters"]["device"], "mps")
        self.assertEqual(adapter.config["parameters"]["precision"], "bf16-mixed")
        self.assertFalse(adapter.config["parameters"]["polygonize"])
        self.assertFalse(adapter.config["diagnostic"]["equivalentToDefaultProfile"])
        self.assertTrue(adapter.config["diagnostic"]["capReachedIsQualityFailure"])
        self.assertEqual(
            adapter.config["execution"]["python"],
            "python/layout_benchmark/.runtime/kraken7-orli/bin/python",
        )
        error = _layout_quality_error(
            adapter,
            {
                "lines": [{} for _ in range(128)],
                "warnings": [
                    {
                        "code": "PREDICTED_LINE_CAP_REACHED",
                        "message": "cap",
                    }
                ],
            },
            observed_provider_line_count=128,
        )
        self.assertIsNotNone(error)
        self.assertEqual(error.code, "PREDICTED_LINE_CAP_REACHED")
        self.assertEqual(error.stage, "engine-quality")
        self.assertEqual(error.details["maxPredictedLines"], 128)
        self.assertEqual(error.details["observedProviderLineCount"], 128)
        self.assertEqual(error.details["normalizedUsableLineCount"], 128)


class NormalizationContractTests(unittest.TestCase):
    def test_polygon_removes_repeated_provider_closure_after_deduplication(self) -> None:
        warnings: list[dict[str, str]] = []
        polygon = _polygon(
            [[1, 1], [8, 1], [8, 8], [1, 1], [1, 1]],
            10,
            10,
            warnings,
            "line",
        )
        self.assertEqual(
            polygon,
            [{"x": 1, "y": 1}, {"x": 8, "y": 1}, {"x": 8, "y": 8}],
        )
        self.assertEqual(warnings, [])

    def test_kraken_output_uses_safe_stable_ids_and_native_baseline(self) -> None:
        raw = {
            "segmentation": {
                "textDirection": "horizontal-lr",
                "regions": {
                    "text": [
                        {
                            "id": "_random-provider-id",
                            "providerOrdinal": 0,
                            "boundary": [[1, 1], [90, 1], [90, 90], [1, 90], [1, 1]],
                            "tags": {},
                            "language": None,
                        }
                    ]
                },
                "lines": [
                    {
                        "id": "_another-random-id",
                        "providerOrdinal": 0,
                        "boundary": [[5, 5], [80, 5], [80, 20], [5, 20], [5, 5]],
                        "baseline": [[5, 18], [80, 18]],
                        "regions": ["_random-provider-id"],
                        "tags": {},
                    }
                ],
            }
        }
        layout = normalize_kraken(
            engine_id="kraken6",
            run_id="test-run",
            page_key="014-18780127-L01-01",
            raw=raw,
            width=100,
            height=100,
            source_sha256="a" * 64,
            prepared_sha256="b" * 64,
        )

        region = layout["regions"][0]
        line = layout["lines"][0]
        self.assertRegex(region["id"], SAFE_ID_RE)
        self.assertRegex(line["id"], SAFE_ID_RE)
        self.assertNotIn(":", region["id"])
        self.assertEqual(line["regionId"], region["id"])
        self.assertEqual(region["lineIds"], [line["id"]])
        self.assertEqual(line["baseline"], [{"x": 5, "y": 18}, {"x": 80, "y": 18}])
        self.assertEqual(line["orientationDegrees"], 0.0)
        self.assertEqual(
            line["provenance"]["attributes"]["orientationSource"],
            "baseline-chord",
        )
        self.assertNotEqual(line["boundary"][0], line["boundary"][-1])
        self._assert_layout_contract(layout)

    def test_rotated_proposals_have_unresolved_order_and_explicit_zone_warning(
        self,
    ) -> None:
        raw = {
            "provider": "kraken-blla-orientation-zones",
            "rotationPasses": [
                {"rotationDegrees": 0, "status": "succeeded"},
                {"rotationDegrees": 90, "status": "succeeded"},
                {"rotationDegrees": 270, "status": "succeeded"},
            ],
            "segmentation": {
                "type": "baselines",
                "textDirection": "horizontal-lr",
                "regions": {},
                "lineOrders": [],
                "rotationEnsemble": {
                    "rotationsDegrees": [0, 90, 270],
                    "mergePolicy": "baseline-plus-vertical-zones",
                    "inputLineCount": 2,
                    "excludedInputLineCount": 0,
                    "includedClusterCount": 2,
                    "selectionEvidence": {
                        "contributingSuccessfulRotationsDegrees": [90]
                    },
                },
                "lines": [
                    {
                        "id": "rot0:base",
                        "providerOrdinal": 0,
                        "boundary": [
                            [5, 5],
                            [80, 5],
                            [80, 20],
                            [5, 20],
                        ],
                        "baseline": [[5, 18], [80, 18]],
                        "ensembleEvidence": {
                            "readingOrderSource": "provider-unrotated",
                            "representativeRotationDegrees": 0,
                        },
                    },
                    {
                        "id": "rot90:proposal",
                        "providerOrdinal": 1,
                        "boundary": [
                            [85, 5],
                            [95, 5],
                            [95, 80],
                            [85, 80],
                        ],
                        "baseline": [[90, 5], [90, 80]],
                        "ensembleEvidence": {
                            "readingOrderSource": (
                                "unresolved-rotated-proposal"
                            ),
                            "representativeRotationDegrees": 90,
                        },
                    },
                ],
            },
        }
        layout = normalize_kraken(
            engine_id="kraken7-rot3-zones",
            run_id="rotation-order-test",
            page_key="014-18780127-L01-01",
            raw=raw,
            width=100,
            height=100,
            source_sha256="a" * 64,
            prepared_sha256="b" * 64,
        )

        self.assertEqual(
            layout["lines"][0]["readingOrder"],
            {"index": 0, "scope": "page", "source": "provider"},
        )
        self.assertIsNone(layout["lines"][1]["readingOrder"])
        self.assertIn(
            "ROTATION_SINGLE_PASS_ZONE_HEURISTIC",
            {warning["code"] for warning in layout["warnings"]},
        )
        self.assertIn(
            "Independent rotation consensus is not required",
            next(
                warning["message"]
                for warning in layout["warnings"]
                if warning["code"]
                == "ROTATION_SINGLE_PASS_ZONE_HEURISTIC"
            ),
        )
        self._assert_layout_contract(layout)

    def test_safe_rotation_projection_warns_about_source_and_rejected_zones(
        self,
    ) -> None:
        raw = {
            "kind": "RotationSourceProjectionEvidence",
            "provider": "letter-archive-rotation-projection",
            "sourceBinding": {"runId": "frozen-rot3-source"},
            "rotationPasses": [
                {"rotationDegrees": 0, "status": "succeeded"},
                {"rotationDegrees": 90, "status": "succeeded"},
                {"rotationDegrees": 270, "status": "succeeded"},
            ],
            "segmentation": {
                "type": "baselines",
                "textDirection": "horizontal-lr",
                "regions": {},
                "lineOrders": [],
                "rotationEnsemble": {
                    "rotationsDegrees": [0, 90, 270],
                    "mergePolicy": (
                        "baseline-plus-nonoverlapping-vertical-zones"
                    ),
                    "inputLineCount": 4,
                    "excludedInputLineCount": 0,
                    "includedClusterCount": 1,
                    "selectionEvidence": {
                        "minimumProposalClustersPerZone": 3,
                        "maximumHorizontalBaselineCentroidRatioPerZone": 0.1,
                        "minimumHorizontalBaselineCentroidAllowancePerZone": 2,
                        "acceptedZoneCount": 0,
                        "rejectedZoneCount": 1,
                        "zones": [
                            {
                                "rejectionReasons": [
                                    (
                                        "SUBSTANTIAL_HORIZONTAL_"
                                        "BASELINE_INTERFERENCE"
                                    )
                                ]
                            }
                        ],
                    },
                },
                "lines": [
                    {
                        "id": "rot0:base",
                        "providerOrdinal": 0,
                        "boundary": [
                            [5, 5],
                            [80, 5],
                            [80, 20],
                            [5, 20],
                        ],
                        "baseline": [[5, 18], [80, 18]],
                        "ensembleEvidence": {
                            "readingOrderSource": "provider-unrotated",
                            "representativeRotationDegrees": 0,
                        },
                    }
                ],
            },
        }
        layout = normalize_kraken(
            engine_id="kraken7-rot3-safe-zones",
            run_id="safe-rotation-test",
            page_key="009-19470830-L01-03",
            raw=raw,
            width=100,
            height=100,
            source_sha256="a" * 64,
            prepared_sha256="b" * 64,
        )

        warnings = {
            warning["code"]: warning["message"]
            for warning in layout["warnings"]
        }
        self.assertIn("ROTATION_SOURCE_PROJECTION", warnings)
        self.assertIn("No new model inference", warnings["ROTATION_SOURCE_PROJECTION"])
        self.assertIn("ROTATION_SAFE_VERTICAL_ZONE_GATE", warnings)
        self.assertIn(
            "SUBSTANTIAL_HORIZONTAL_BASELINE_INTERFERENCE",
            warnings["ROTATION_SAFE_VERTICAL_ZONE_GATE"],
        )
        self._assert_layout_contract(layout)

    def test_kraken_bbox_and_alternative_order_are_preserved_without_fake_baselines(
        self,
    ) -> None:
        raw = {
            "provider": "kraken-bbox-test",
            "segmentation": {
                "type": "bbox",
                "textDirection": "vertical-lr",
                "regions": {},
                "lineOrders": [[1, 0]],
                "lines": [
                    {
                        "id": "_line-a",
                        "providerOrdinal": 0,
                        "bbox": [5, 10, 20, 80],
                        "text_direction": "vertical-lr",
                    },
                    {
                        "id": "_line-b",
                        "providerOrdinal": 1,
                        "bbox": [30, 15, 45, 90],
                        "text_direction": "vertical-lr",
                    },
                ],
            },
        }
        layout = normalize_kraken(
            engine_id="kraken7",
            run_id="bbox-test",
            page_key="014-18780127-L01-01",
            raw=raw,
            width=100,
            height=100,
            source_sha256="a" * 64,
            prepared_sha256="b" * 64,
        )

        self.assertEqual(len(layout["lines"]), 2)
        first, second = layout["lines"]
        self.assertIsNone(first["baseline"])
        self.assertEqual(first["orientationDegrees"], 90.0)
        self.assertEqual(first["readingOrder"]["index"], 0)
        self.assertEqual(second["readingOrder"]["index"], 1)
        self.assertEqual(
            first["provenance"]["attributes"]["boundarySource"],
            "provider-bbox",
        )
        self.assertEqual(
            first["provenance"]["attributes"]["alternativeReadingOrders"],
            [{"orderIndex": 0, "position": 1}],
        )
        self.assertEqual(
            second["provenance"]["attributes"]["alternativeReadingOrders"],
            [{"orderIndex": 0, "position": 0}],
        )
        self._assert_layout_contract(layout)

    def test_orli_keeps_true_baselines_primary_order_and_no_fake_regions(
        self,
    ) -> None:
        raw = {
            "provider": "kraken-orli",
            "parameters": {"maxPredictedLines": 1},
            "segmentation": {
                "type": "baselines",
                "textDirection": "horizontal-lr",
                "regions": {},
                "lineOrders": [],
                "lines": [
                    {
                        "id": "_orli-a",
                        "providerOrdinal": 0,
                        "baseline": [[10, 10], [12, 70]],
                        "boundary": [[5, 5], [18, 5], [20, 75], [7, 75]],
                        "tags": {"type": [{"type": "default"}]},
                    }
                ],
            },
        }
        layout = normalize_kraken(
            engine_id="kraken7-orli",
            run_id="orli-test",
            page_key="014-18780127-L01-01",
            raw=raw,
            width=100,
            height=100,
            source_sha256="a" * 64,
            prepared_sha256="b" * 64,
        )

        self.assertEqual(layout["regions"], [])
        self.assertEqual(len(layout["lines"]), 1)
        line = layout["lines"][0]
        self.assertEqual(
            line["baseline"],
            [{"x": 10, "y": 10}, {"x": 12, "y": 70}],
        )
        self.assertAlmostEqual(line["orientationDegrees"], 88.091)
        self.assertEqual(line["readingOrder"]["index"], 0)
        self.assertIsNone(line["regionId"])
        self.assertEqual(line["provenance"]["provider"], "kraken-orli")
        self.assertEqual(line["provenance"]["rawClass"], "default")
        self.assertIn(
            "not a physical page boundary",
            layout["warnings"][0]["message"],
        )
        self.assertIn(
            "PREDICTED_LINE_CAP_REACHED",
            {warning["code"] for warning in layout["warnings"]},
        )
        self._assert_layout_contract(layout)

    def test_baseline_only_kraken_lines_get_provenance_marked_corridors(self) -> None:
        raw = {
            "provider": "kraken-orli",
            "parameters": {"maxPredictedLines": 10},
            "segmentation": {
                "type": "baselines",
                "regions": {},
                "lines": [
                    {"providerOrdinal": index, "baseline": [[1, index], [9, index]]}
                    for index in range(3)
                ],
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            raw_path = Path(temporary) / "raw.json"
            raw_path.write_text(json.dumps(raw), encoding="utf-8")
            layout = normalize_provider_output(
                engine_id="kraken7-orli-cpu",
                run_id="orli-cpu-missing-boundaries",
                page_key="014-18780127-L01-01",
                raw_path=raw_path,
                width=100,
                height=100,
                source_sha256="a" * 64,
                prepared_sha256="b" * 64,
            )

        boundary_warnings = [
            warning
            for warning in layout["warnings"]
            if warning["code"] == "LINE_BOUNDARY_DERIVED_FROM_BASELINE"
        ]
        self.assertEqual(len(boundary_warnings), 1)
        self.assertIn(
            "3 baseline-only Kraken lines",
            boundary_warnings[0]["message"],
        )
        self.assertEqual(len(layout["lines"]), 3)
        for line in layout["lines"]:
            self.assertGreaterEqual(len(line["boundary"]), 3)
            self.assertEqual(
                line["provenance"]["attributes"]["boundarySource"],
                "baseline-envelope",
            )
            self.assertEqual(
                line["provenance"]["attributes"]["boundaryEnvelopeHalfWidthPx"],
                1,
            )
        self._assert_layout_contract(layout)

    def test_pagexml_keeps_region_order_orientation_and_classes(self) -> None:
        pagexml = """<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15">
  <Page imageFilename="prepared.png" imageWidth="120" imageHeight="160">
    <Border><Coords points="2,2 117,2 117,157 2,157"/></Border>
    <ReadingOrder><OrderedGroup id="ro"><RegionRefIndexed index="0" regionRef="r2"/><RegionRefIndexed index="1" regionRef="r1"/></OrderedGroup></ReadingOrder>
    <TextRegion id="r1" type="marginalia" orientation="90" conf="0.8">
      <Coords points="5,5 30,5 30,100 5,100"/>
      <TextLine id="l1" conf="0.7"><Coords points="8,8 25,8 25,90 8,90"/><Baseline points="20,8 20,90"/></TextLine>
    </TextRegion>
    <TextRegion id="r2" type="paragraph"><Coords points="40,20 110,20 110,140 40,140"/></TextRegion>
  </Page>
</PcGts>
"""
        with tempfile.TemporaryDirectory() as temporary:
            xml_path = Path(temporary) / "raw.xml"
            xml_path.write_text(pagexml, encoding="utf-8")
            layout = normalize_pagexml(
                engine_id="eynollah",
                run_id="test-run",
                page_key="014-18780127-L01-01",
                xml_path=xml_path,
                width=120,
                height=160,
                source_sha256="a" * 64,
                prepared_sha256="b" * 64,
            )
        self.assertEqual(layout["regions"][0]["provenance"]["providerId"], "r2")
        marginalia = layout["regions"][1]
        self.assertEqual(marginalia["class"], "marginalia")
        self.assertEqual(marginalia["orientationDegrees"], 90.0)
        self.assertEqual(layout["lines"][0]["class"], "marginalia")
        self.assertEqual(layout["lines"][0]["orientationDegrees"], 90.0)
        self._assert_layout_contract(layout)

    def test_pagexml_distinguishes_absent_and_malformed_baselines(self) -> None:
        template = """<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15">
  <Page imageFilename="prepared.png" imageWidth="120" imageHeight="160">
    <TextRegion id="r1" type="paragraph">
      <Coords points="5,5 115,5 115,155 5,155"/>
      <TextLine id="l1">
        <Coords points="10,10 110,10 110,30 10,30"/>
        {baseline}
      </TextLine>
    </TextRegion>
  </Page>
</PcGts>
"""

        def normalize(baseline: str) -> dict[str, Any]:
            with tempfile.TemporaryDirectory() as temporary:
                xml_path = Path(temporary) / "raw.xml"
                xml_path.write_text(
                    template.format(baseline=baseline),
                    encoding="utf-8",
                )
                return normalize_pagexml(
                    engine_id="eynollah-v091",
                    run_id="baseline-semantics",
                    page_key="014-18780127-L01-02",
                    xml_path=xml_path,
                    width=120,
                    height=160,
                    source_sha256="a" * 64,
                    prepared_sha256="b" * 64,
                )

        absent = normalize("")
        malformed = normalize('<Baseline points="not-a-point"/>')

        self.assertIsNone(absent["lines"][0]["baseline"])
        self.assertNotIn(
            "INVALID_BASELINE_DROPPED",
            {warning["code"] for warning in absent["warnings"]},
        )
        self.assertIsNone(malformed["lines"][0]["baseline"])
        self.assertIn(
            "INVALID_BASELINE_DROPPED",
            {warning["code"] for warning in malformed["warnings"]},
        )
        self._assert_layout_contract(absent)
        self._assert_layout_contract(malformed)

    def test_distinct_eynollah_profile_uses_or_rejects_provider_boundary(
        self,
    ) -> None:
        pagexml = """<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15">
  <Page imageFilename="prepared.png" imageWidth="120" imageHeight="160">
    <Border><Coords points="2,3 117,3 117,156 2,156"/></Border>
  </Page>
</PcGts>
"""
        with tempfile.TemporaryDirectory() as temporary:
            xml_path = Path(temporary) / "raw.xml"
            xml_path.write_text(pagexml, encoding="utf-8")
            predicted = normalize_provider_output(
                engine_id="eynollah-v091",
                run_id="v091-boundary",
                page_key="014-18780127-L01-02",
                raw_path=xml_path,
                width=120,
                height=160,
                source_sha256="a" * 64,
                prepared_sha256="b" * 64,
            )
            unavailable = normalize_provider_output(
                engine_id="eynollah-v091",
                run_id="v091-no-boundary",
                page_key="014-18780127-L01-02",
                raw_path=xml_path,
                width=120,
                height=160,
                source_sha256="a" * 64,
                prepared_sha256="b" * 64,
                page_boundary_available=False,
            )

        self.assertEqual(
            predicted["pageBoundary"][0],
            {"x": 2, "y": 3},
        )
        self.assertNotIn(
            "PAGE_BOUNDARY_UNAVAILABLE",
            {warning["code"] for warning in predicted["warnings"]},
        )
        self.assertEqual(
            unavailable["pageBoundary"][0],
            {"x": 0, "y": 0},
        )
        self.assertIn(
            "PAGE_BOUNDARY_UNAVAILABLE",
            {warning["code"] for warning in unavailable["warnings"]},
        )

    def test_pagexml_orientation_falls_back_to_canonical_baseline_chord(
        self,
    ) -> None:
        pagexml = """<?xml version="1.0" encoding="UTF-8"?>
<PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15">
  <Page imageFilename="prepared.png" imageWidth="120" imageHeight="160">
    <TextRegion id="r1" type="marginalia">
      <Coords points="5,5 115,5 115,155 5,155"/>
      <TextLine id="vertical">
        <Coords points="10,10 30,10 30,140 10,140"/>
        <Baseline points="20,10 20,140"/>
      </TextLine>
      <TextLine id="reverse-horizontal">
        <Coords points="10,40 110,40 110,70 10,70"/>
        <Baseline points="105,50 15,60"/>
      </TextLine>
    </TextRegion>
  </Page>
</PcGts>
"""
        with tempfile.TemporaryDirectory() as temporary:
            xml_path = Path(temporary) / "raw.xml"
            xml_path.write_text(pagexml, encoding="utf-8")
            layout = normalize_pagexml(
                engine_id="eynollah",
                run_id="orientation-fallback",
                page_key="014-18780127-L01-01",
                xml_path=xml_path,
                width=120,
                height=160,
                source_sha256="a" * 64,
                prepared_sha256="b" * 64,
            )

        vertical, reverse_horizontal = layout["lines"]
        self.assertEqual(vertical["orientationDegrees"], 90.0)
        self.assertAlmostEqual(
            reverse_horizontal["orientationDegrees"],
            -6.34,
            places=2,
        )
        for line in layout["lines"]:
            self.assertEqual(
                line["provenance"]["attributes"]["orientationSource"],
                "baseline-chord",
            )
            self.assertGreaterEqual(line["orientationDegrees"], -90)
            self.assertLessEqual(line["orientationDegrees"], 90)
        self._assert_layout_contract(layout)

    def _assert_layout_contract(self, layout: dict) -> None:
        self.assertEqual(layout["schemaVersion"], 1)
        self.assertRegex(layout["runId"], SAFE_ID_RE)
        region_ids = {region["id"] for region in layout["regions"]}
        line_ids = {line["id"] for line in layout["lines"]}
        self.assertEqual(len(region_ids), len(layout["regions"]))
        self.assertEqual(len(line_ids), len(layout["lines"]))
        for region in layout["regions"]:
            self.assertIn(region["class"], CANONICAL_CLASSES)
            self.assertGreaterEqual(len(set(_point_key(p) for p in region["boundary"])), 3)
            for line_id in region["lineIds"]:
                self.assertIn(line_id, line_ids)
        for line in layout["lines"]:
            self.assertIn(line["class"], CANONICAL_CLASSES)
            self.assertGreaterEqual(len(set(_point_key(p) for p in line["boundary"])), 3)
            if line["baseline"] is not None:
                self.assertGreaterEqual(len(set(_point_key(p) for p in line["baseline"])), 2)
            if line["regionId"] is not None:
                self.assertIn(line["regionId"], region_ids)


def _point_key(point: dict[str, int]) -> tuple[int, int]:
    return point["x"], point["y"]


if __name__ == "__main__":
    unittest.main()
