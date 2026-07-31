from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from layout_benchmark.normalization import normalize_kraken
from layout_benchmark.page_mask_stage import (
    ENGINE_INPUT_FILENAME,
    INPUT_STAGE_FILENAME,
    PAGE_MASK_FILENAME,
)
from layout_benchmark.paths import RUNS_ROOT
from layout_benchmark.preparation import fingerprint_prepared_png
from rotation_geometry import merge_rotation_passes
from layout_benchmark.rotation_source_projection import (
    compose_page_evidence,
    external_snapshot_paths,
    load_source_context,
)
from layout_benchmark.util import (
    BenchmarkError,
    canonical_json_bytes,
    read_json,
    sha256_file,
    write_json,
)


PAGE_KEY = "014-18780127-L01-01"
FAILED_PAGE_KEY = "003-18880810-L01-03"
SOURCE_RUN_ID = "trusted-rot4-source"
SOURCE_ENGINE_ID = "kraken7-rot4-union"
ROTATIONS = (0, 90, 180, 270)
SOURCE_SHA256 = "d" * 64


def _line(
    line_id: str,
    boundary: list[list[int]],
    baseline: list[list[int]],
) -> dict:
    return {
        "id": line_id,
        "type": "baselines",
        "boundary": boundary,
        "baseline": baseline,
        "regions": [],
        "providerOrdinal": 0,
    }


def _segmentation(*lines: dict) -> dict:
    return {
        "type": "baselines",
        "textDirection": "horizontal-lr",
        "scriptDetection": False,
        "lineOrders": [],
        "language": None,
        "regions": {},
        "lines": list(lines),
    }


def _outcome(rotation: int, status: str = "succeeded") -> dict:
    attempts = [
        {
            "raiseOnError": True,
            "outcome": "succeeded" if status == "succeeded" else "failed",
        }
    ]
    if status == "partial":
        attempts.append({"raiseOnError": False, "outcome": "succeeded"})
    return {
        "rotationDegrees": rotation,
        "status": status,
        "error": (
            None
            if status == "succeeded"
            else {"type": "ProviderError", "message": f"{rotation} failed"}
        ),
        "attempts": attempts,
        "fallback": {
            "attempted": status == "partial",
            "outcome": "succeeded" if status == "partial" else None,
        },
    }


def _native_passes() -> list[dict]:
    baseline = _line(
        "baseline",
        [[10, 5], [90, 5], [90, 15], [10, 15]],
        [[10, 10], [90, 10]],
    )
    vertical_90 = _line(
        "vertical-90",
        [[20, 5], [80, 5], [80, 15], [20, 15]],
        [[20, 10], [80, 10]],
    )
    upside_down_only = _line(
        "upside-down-only",
        [[10, 15], [30, 15], [30, 25], [10, 25]],
        [[10, 20], [30, 20]],
    )
    vertical_270 = _line(
        "vertical-270",
        [[19, 84], [79, 84], [79, 94], [19, 94]],
        [[19, 89], [79, 89]],
    )
    return [
        _segmentation(baseline),
        _segmentation(vertical_90),
        _segmentation(upside_down_only),
        _segmentation(vertical_270),
    ]


def _page_mask_evidence(
    page_directory: Path,
    prepared_path: Path,
) -> tuple[dict, dict[str, Path], list[dict[str, int]]]:
    page_mask_path = page_directory / PAGE_MASK_FILENAME
    engine_input_path = page_directory / ENGINE_INPUT_FILENAME
    provenance_path = page_directory / INPUT_STAGE_FILENAME
    Image.new("L", (100, 100), 255).save(page_mask_path, format="PNG")
    engine_input_path.write_bytes(prepared_path.read_bytes())
    boundary = [
        {"x": 10, "y": 10},
        {"x": 89, "y": 10},
        {"x": 89, "y": 89},
        {"x": 10, "y": 89},
    ]
    prepared_sha256 = sha256_file(prepared_path)
    page_mask_artifact = {
        "sha256": sha256_file(page_mask_path),
        "sizeBytes": page_mask_path.stat().st_size,
        "width": 100,
        "height": 100,
    }
    engine_input_artifact = {
        "sha256": sha256_file(engine_input_path),
        "sizeBytes": engine_input_path.stat().st_size,
        "width": 100,
        "height": 100,
    }
    boundary_manifest_sha256 = "e" * 64
    boundary_layout_sha256 = "f" * 64
    boundary_run_id = "eynollah-boundary-source"
    boundary_engine_id = "eynollah-v091"
    provenance = {
        "schemaVersion": 1,
        "pageKey": PAGE_KEY,
        "targetPrepared": {
            "encodedSha256": prepared_sha256,
        },
        "coordinateTransform": {
            "name": "identity",
            "width": 100,
            "height": 100,
        },
        "sourceBoundary": {
            "runId": boundary_run_id,
            "engineId": boundary_engine_id,
            "manifestSha256": boundary_manifest_sha256,
            "normalizedArtifactSha256": boundary_layout_sha256,
            "boundary": {
                "closedPolygon": [*boundary, boundary[0]],
            },
        },
        "includeMask": {
            "artifact": page_mask_artifact,
        },
        "engineInput": {
            "artifact": engine_input_artifact,
        },
    }
    provenance_bytes = canonical_json_bytes(provenance)
    provenance_path.write_bytes(provenance_bytes)
    source_layout = {
        "schemaVersion": 1,
        "pageKey": PAGE_KEY,
        "runId": boundary_run_id,
        "engineId": boundary_engine_id,
        "image": {
            "width": 100,
            "height": 100,
            "sourceSha256": SOURCE_SHA256,
            "preparedSha256": prepared_sha256,
        },
        "pageBoundary": boundary,
        "regions": [],
        "lines": [],
        "warnings": [],
    }
    stage = {
        "schemaVersion": 1,
        "type": "eynollah-page-mask",
        "durationMs": 10,
        "policy": {
            "paddingPixels": 0,
        },
        "artifacts": {
            "pageMask": {
                "filename": PAGE_MASK_FILENAME,
                **page_mask_artifact,
            },
            "engineInput": {
                "filename": ENGINE_INPUT_FILENAME,
                **engine_input_artifact,
            },
            "provenance": {
                "filename": INPUT_STAGE_FILENAME,
                "sha256": sha256_file(provenance_path),
                "sizeBytes": provenance_path.stat().st_size,
            },
        },
        "provenance": provenance,
        "controlEvidence": {
            "sourceBindings": {
                "pageBoundary": {
                    "runId": boundary_run_id,
                    "engineId": boundary_engine_id,
                    "manifest": {
                        "sha256": boundary_manifest_sha256,
                    },
                    "normalizedLayout": {
                        "sha256": boundary_layout_sha256,
                    },
                    "prepared": {
                        "encodedSha256": prepared_sha256,
                    },
                },
            },
            "sourceLayouts": {
                "pageBoundary": source_layout,
            },
        },
    }
    return (
        stage,
        {
            "pageMask": page_mask_path,
            "engineInput": engine_input_path,
            "inputStage": provenance_path,
        },
        boundary,
    )


class RotationSourceProjectionTests(unittest.TestCase):
    def setUp(self) -> None:
        RUNS_ROOT.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(
            dir=RUNS_ROOT,
            prefix=".rotation-projection-test-",
        )
        self.runs_root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _fixture(
        self,
        *,
        run_state: str = "completed",
        include_failed_page: bool = False,
        statuses: tuple[str, ...] = (
            "succeeded",
            "succeeded",
            "succeeded",
            "succeeded",
        ),
        corrupt_projection_rotation: int | None = None,
        with_page_mask: bool = False,
    ) -> tuple[dict, Path, Path]:
        run_directory = self.runs_root / SOURCE_RUN_ID
        page_directory = run_directory / "pages" / PAGE_KEY
        page_directory.mkdir(parents=True)
        prepared_path = page_directory / "prepared.png"
        Image.new("RGB", (100, 100), "white").save(
            prepared_path,
            format="PNG",
        )
        outcomes = [
            _outcome(rotation, status)
            for rotation, status in zip(ROTATIONS, statuses, strict=True)
        ]
        merged = merge_rotation_passes(
            _native_passes(),
            rotations=ROTATIONS,
            source_width=100,
            source_height=100,
            merge_policy="evidence-union",
            pass_outcomes=outcomes,
        )
        if corrupt_projection_rotation is not None:
            record = next(
                item
                for item in merged["rotationPasses"]
                if item["rotationDegrees"] == corrupt_projection_rotation
            )
            record["sourceProjectedSegmentation"]["lines"][0]["baseline"][0][
                0
            ] += 1
        raw = {
            "provider": "kraken-blla-rotation-ensemble",
            "providerVersion": "7.0.3",
            "api": "segmentation-task",
            "inferenceProvider": "torch-cpu",
            "runtimeInference": {"inferenceProvider": "torch-cpu"},
            "model": {"name": "blla.mlmodel", "sha256": "a" * 64},
            "parameters": {
                "rotationsDegrees": list(ROTATIONS),
                "rotationMergePolicy": "evidence-union",
            },
            "timings": {},
            "image": {
                "filename": "prepared.png",
                "width": 100,
                "height": 100,
                "mode": "RGB",
            },
            "segmentation": merged["segmentation"],
            "rotationPasses": merged["rotationPasses"],
        }
        page_mask_paths: dict[str, Path] = {}
        if with_page_mask:
            stage, page_mask_paths, _ = _page_mask_evidence(
                page_directory,
                prepared_path,
            )
            raw["image"]["filename"] = ENGINE_INPUT_FILENAME
            raw["inputStage"] = stage
        raw_path = page_directory / "raw.json"
        write_json(raw_path, raw)
        prepared_reference = f"pages/{PAGE_KEY}/prepared.png"
        raw_reference = f"pages/{PAGE_KEY}/raw.json"
        manifest = {
            "schemaVersion": 2,
            "runId": SOURCE_RUN_ID,
            "state": run_state,
            "engine": {
                "id": SOURCE_ENGINE_ID,
                "adapterVersion": "6",
                "configuration": {
                    "values": {
                        "rotationEvidenceContract": (
                            "native-and-source-projected-v2"
                        ),
                        "parameters": {
                            "rotationsDegrees": list(ROTATIONS),
                        },
                        **(
                            {
                                "inputStage": {
                                    "type": "eynollah-page-mask",
                                    "paddingPixels": 0,
                                }
                            }
                            if with_page_mask
                            else {}
                        ),
                    }
                },
            },
            "cohort": {
                "sha256": "b" * 64,
                "selection": {
                    "scope": "explicit",
                    "pageKeys": [PAGE_KEY],
                },
            },
            "preprocessing": {"profileSha256": "c" * 64},
            "pages": [
                {
                    "pageKey": PAGE_KEY,
                    "status": "succeeded",
                    "source": {"sha256": SOURCE_SHA256},
                    "prepared": {
                        "artifact": prepared_reference,
                        "sha256": sha256_file(prepared_path),
                        "width": 100,
                        "height": 100,
                        "rasterFingerprint": {
                            "algorithm": "sha256-rgb8-v1",
                            "sha256": fingerprint_prepared_png(
                                prepared_path,
                                expected_width=100,
                                expected_height=100,
                            ),
                        },
                    },
                    "artifacts": {
                        "raw": raw_reference,
                        **(
                            {
                                kind: (
                                    f"pages/{PAGE_KEY}/{path.name}"
                                )
                                for kind, path in page_mask_paths.items()
                            }
                            if with_page_mask
                            else {}
                        ),
                    },
                }
            ],
            "integrity": {
                "algorithm": "sha256",
                "artifacts": {
                    prepared_reference: {
                        "sha256": sha256_file(prepared_path),
                        "sizeBytes": prepared_path.stat().st_size,
                    },
                    raw_reference: {
                        "sha256": sha256_file(raw_path),
                        "sizeBytes": raw_path.stat().st_size,
                    },
                },
            },
        }
        for kind, path in page_mask_paths.items():
            reference = f"pages/{PAGE_KEY}/{path.name}"
            manifest["integrity"]["artifacts"][reference] = {
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        if include_failed_page:
            failed_page_directory = run_directory / "pages" / FAILED_PAGE_KEY
            failed_page_directory.mkdir(parents=True)
            failed_prepared_path = failed_page_directory / "prepared.png"
            Image.new("RGB", (100, 100), "white").save(
                failed_prepared_path,
                format="PNG",
            )
            failed_error_path = failed_page_directory / "error.json"
            write_json(
                failed_error_path,
                {
                    "code": "SOURCE_PAGE_UNAVAILABLE",
                    "message": "Frozen source page failed",
                    "stage": "engine-composition",
                },
            )
            failed_prepared_reference = (
                f"pages/{FAILED_PAGE_KEY}/prepared.png"
            )
            failed_error_reference = f"pages/{FAILED_PAGE_KEY}/error.json"
            manifest["cohort"]["selection"]["pageKeys"].append(
                FAILED_PAGE_KEY
            )
            manifest["pages"].append(
                {
                    "pageKey": FAILED_PAGE_KEY,
                    "status": "failed",
                    "source": {"sha256": "e" * 64},
                    "prepared": {
                        "artifact": failed_prepared_reference,
                        "sha256": sha256_file(failed_prepared_path),
                        "width": 100,
                        "height": 100,
                        "rasterFingerprint": {
                            "algorithm": "sha256-rgb8-v1",
                            "sha256": fingerprint_prepared_png(
                                failed_prepared_path,
                                expected_width=100,
                                expected_height=100,
                            ),
                        },
                    },
                    "artifacts": {"error": failed_error_reference},
                    "error": {
                        "code": "SOURCE_PAGE_UNAVAILABLE",
                        "message": "Frozen source page failed",
                        "stage": "engine-composition",
                    },
                }
            )
            manifest["integrity"]["artifacts"].update(
                {
                    failed_prepared_reference: {
                        "sha256": sha256_file(failed_prepared_path),
                        "sizeBytes": failed_prepared_path.stat().st_size,
                    },
                    failed_error_reference: {
                        "sha256": sha256_file(failed_error_path),
                        "sizeBytes": failed_error_path.stat().st_size,
                    },
                }
            )
        manifest_path = run_directory / "run.v2.json"
        write_json(manifest_path, manifest)
        config = {
            "schemaVersion": 1,
            "engineId": "derived-rotation-view",
            "adapter": "layout-run-rotation-projection",
            "adapterVersion": "1",
            "provider": "letter-archive-rotation-projection",
            "package": {
                "name": "letter-archive-rotation-projection",
                "version": "1",
            },
            "sourceRuns": {
                "rotationEvidence": {
                    "role": "rotation-native-evidence",
                    "runId": SOURCE_RUN_ID,
                    "expectedEngineId": SOURCE_ENGINE_ID,
                    "expectedAdapterVersion": "6",
                    "manifestSha256": sha256_file(manifest_path),
                    "expectedRotationsDegrees": list(ROTATIONS),
                }
            },
            "parameters": {
                "sourceRotationsDegrees": list(ROTATIONS),
                "rotationMergePolicy": "evidence-union",
                "requireSuccessfulBaselinePass": True,
            },
            **(
                {
                    "sourceEvidence": {
                        "pageMaskArtifacts": "copy-and-bind-v1",
                    }
                }
                if with_page_mask
                else {}
            ),
        }
        return config, prepared_path, raw_path

    def _compose(
        self,
        config: dict,
        prepared_path: Path,
    ) -> dict:
        context = load_source_context(
            config,
            runs_root=self.runs_root,
            validate_authoritatively=False,
        )
        return compose_page_evidence(
            context,
            config,
            page_key=PAGE_KEY,
            prepared_path=prepared_path,
        )

    def test_one_raw_source_yields_union_consensus_and_three_pass_views(
        self,
    ) -> None:
        config, prepared_path, _ = self._fixture()
        union = self._compose(config, prepared_path)
        consensus_config = copy.deepcopy(config)
        consensus_config["parameters"]["rotationMergePolicy"] = (
            "baseline-plus-consensus"
        )
        consensus = self._compose(consensus_config, prepared_path)
        ablation_config = copy.deepcopy(config)
        ablation_config["parameters"]["sourceRotationsDegrees"] = [
            0,
            90,
            270,
        ]
        ablation = self._compose(ablation_config, prepared_path)

        self.assertEqual(len(union["segmentation"]["lines"]), 3)
        self.assertEqual(len(consensus["segmentation"]["lines"]), 2)
        self.assertEqual(len(ablation["segmentation"]["lines"]), 2)
        self.assertEqual(
            ablation["projection"]["selectedRotationsDegrees"],
            [0, 90, 270],
        )
        self.assertEqual(
            union["sourceBinding"]["rawSha256"],
            consensus["sourceBinding"]["rawSha256"],
        )
        self.assertEqual(
            union["sourceRawEvidence"],
            consensus["sourceRawEvidence"],
        )
        self.assertFalse(
            union["runtimeInference"]["modelInferencePerformed"]
        )

    def test_terminal_source_run_with_page_failures_is_accepted(self) -> None:
        config, prepared_path, _ = self._fixture(
            run_state="completed_with_failures",
            include_failed_page=True,
        )

        context = load_source_context(
            config,
            runs_root=self.runs_root,
            validate_authoritatively=False,
        )
        result = compose_page_evidence(
            context,
            config,
            page_key=PAGE_KEY,
            prepared_path=prepared_path,
        )

        self.assertEqual(len(result["segmentation"]["lines"]), 3)
        self.assertEqual(
            context.selected_page_keys,
            (PAGE_KEY, FAILED_PAGE_KEY),
        )
        with self.assertRaises(BenchmarkError) as raised:
            compose_page_evidence(
                context,
                config,
                page_key=FAILED_PAGE_KEY,
                prepared_path=prepared_path,
            )
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_PAGE_UNAVAILABLE",
        )
        self.assertEqual(
            raised.exception.details["sourceError"]["code"],
            "SOURCE_PAGE_UNAVAILABLE",
        )
        snapshot_paths = external_snapshot_paths(
            config,
            runs_root=self.runs_root,
        )
        self.assertIn(
            self.runs_root
            / SOURCE_RUN_ID
            / "pages"
            / FAILED_PAGE_KEY
            / "error.json",
            snapshot_paths,
        )

    def test_nonterminal_source_run_is_rejected(self) -> None:
        config, _, _ = self._fixture(run_state="running")

        with self.assertRaises(BenchmarkError) as raised:
            load_source_context(
                config,
                runs_root=self.runs_root,
                validate_authoritatively=False,
            )

        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_RUN_INCOMPLETE",
        )

    def test_partial_pass_geometry_is_preserved_but_never_displayed(
        self,
    ) -> None:
        config, prepared_path, _ = self._fixture(
            statuses=("succeeded", "partial", "succeeded", "succeeded")
        )
        result = self._compose(config, prepared_path)

        self.assertEqual(
            next(
                record
                for record in result["rotationPasses"]
                if record["rotationDegrees"] == 90
            )["status"],
            "partial",
        )
        displayed_rotations = {
            rotation
            for line in result["segmentation"]["lines"]
            for rotation in line["ensembleEvidence"][
                "sourceRotationsDegrees"
            ]
        }
        self.assertNotIn(90, displayed_rotations)
        self.assertTrue(
            result["sourceRawEvidence"]["rotationPasses"][1][
                "nativeSegmentation"
            ]["lines"]
        )
        self.assertFalse(
            result["projection"][
                "partialAndFailedGeometryDisplayEligible"
            ]
        )

    def test_baseline_pass_must_fully_succeed(self) -> None:
        config, prepared_path, _ = self._fixture(
            statuses=("partial", "succeeded", "succeeded", "succeeded")
        )
        with self.assertRaises(BenchmarkError) as raised:
            self._compose(config, prepared_path)
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_BASELINE_NOT_SUCCEEDED",
        )

    def test_reprojection_must_exactly_match_frozen_source_projection(
        self,
    ) -> None:
        config, prepared_path, _ = self._fixture(
            corrupt_projection_rotation=90
        )
        with self.assertRaises(BenchmarkError) as raised:
            self._compose(config, prepared_path)
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_COORDINATE_PROJECTION_MISMATCH",
        )

    def test_raw_artifact_integrity_is_fail_closed(self) -> None:
        config, prepared_path, raw_path = self._fixture()
        raw_path.write_text("{}\n", encoding="utf-8")
        with self.assertRaises(BenchmarkError) as raised:
            self._compose(config, prepared_path)
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_ARTIFACT_INTEGRITY_MISMATCH",
        )

    def test_snapshot_set_contains_exact_manifest_and_raw_artifact(
        self,
    ) -> None:
        config, _, raw_path = self._fixture()
        paths = external_snapshot_paths(
            config,
            runs_root=self.runs_root,
        )
        self.assertEqual(
            set(paths),
            {
                self.runs_root / SOURCE_RUN_ID / "run.v2.json",
                raw_path,
            },
        )

    def test_masked_projection_copies_and_promotes_exact_evidence(
        self,
    ) -> None:
        config, source_prepared_path, source_raw_path = self._fixture(
            with_page_mask=True,
        )
        target_directory = self.runs_root / "derived" / "pages" / PAGE_KEY
        target_directory.mkdir(parents=True)
        target_prepared_path = target_directory / "prepared.png"
        target_prepared_path.write_bytes(source_prepared_path.read_bytes())

        result = self._compose(config, target_prepared_path)
        source_raw = read_json(source_raw_path)
        self.assertEqual(result["inputStage"], source_raw["inputStage"])
        self.assertEqual(
            result["sourceBinding"]["inheritedPageMask"]["contract"],
            "copy-and-bind-v1",
        )
        for filename in (
            PAGE_MASK_FILENAME,
            ENGINE_INPUT_FILENAME,
            INPUT_STAGE_FILENAME,
        ):
            self.assertEqual(
                (target_directory / filename).read_bytes(),
                (source_prepared_path.parent / filename).read_bytes(),
            )

        normalized = normalize_kraken(
            engine_id=config["engineId"],
            run_id="derived-run",
            page_key=PAGE_KEY,
            raw=result,
            width=100,
            height=100,
            source_sha256=SOURCE_SHA256,
            prepared_sha256=sha256_file(target_prepared_path),
        )
        expected_boundary = source_raw["inputStage"]["controlEvidence"][
            "sourceLayouts"
        ]["pageBoundary"]["pageBoundary"]
        self.assertEqual(normalized["pageBoundary"], expected_boundary)
        warning_codes = {
            warning["code"] for warning in normalized["warnings"]
        }
        self.assertIn("PAGE_BOUNDARY_FROM_INPUT_STAGE", warning_codes)
        self.assertNotIn("PAGE_BOUNDARY_UNAVAILABLE", warning_codes)

        snapshots = set(
            external_snapshot_paths(
                config,
                runs_root=self.runs_root,
            )
        )
        for filename in (
            PAGE_MASK_FILENAME,
            ENGINE_INPUT_FILENAME,
            INPUT_STAGE_FILENAME,
        ):
            self.assertIn(source_prepared_path.parent / filename, snapshots)

    def test_each_inherited_mask_artifact_fails_closed_on_tamper(
        self,
    ) -> None:
        config, source_prepared_path, _ = self._fixture(
            with_page_mask=True,
        )
        for filename in (
            PAGE_MASK_FILENAME,
            ENGINE_INPUT_FILENAME,
            INPUT_STAGE_FILENAME,
        ):
            with self.subTest(filename=filename):
                path = source_prepared_path.parent / filename
                original = path.read_bytes()
                path.write_bytes(b"tampered")
                target_directory = (
                    self.runs_root / f"derived-{filename}" / PAGE_KEY
                )
                target_directory.mkdir(parents=True)
                target_prepared_path = target_directory / "prepared.png"
                target_prepared_path.write_bytes(
                    source_prepared_path.read_bytes()
                )
                with self.assertRaises(BenchmarkError) as raised:
                    self._compose(config, target_prepared_path)
                self.assertEqual(
                    raised.exception.code,
                    "ROTATION_SOURCE_ARTIFACT_INTEGRITY_MISMATCH",
                )
                self.assertFalse(
                    any(
                        (target_directory / inherited_name).exists()
                        for inherited_name in (
                            PAGE_MASK_FILENAME,
                            ENGINE_INPUT_FILENAME,
                            INPUT_STAGE_FILENAME,
                        )
                    )
                )
                path.write_bytes(original)

    def test_standalone_mask_provenance_must_match_raw_evidence(
        self,
    ) -> None:
        config, source_prepared_path, _ = self._fixture(
            with_page_mask=True,
        )
        provenance_path = (
            source_prepared_path.parent / INPUT_STAGE_FILENAME
        )
        provenance = json.loads(provenance_path.read_bytes())
        provenance["coordinateTransform"]["name"] = "tampered"
        provenance_path.write_bytes(canonical_json_bytes(provenance))

        manifest_path = (
            self.runs_root / SOURCE_RUN_ID / "run.v2.json"
        )
        manifest = read_json(manifest_path)
        reference = f"pages/{PAGE_KEY}/{INPUT_STAGE_FILENAME}"
        manifest["integrity"]["artifacts"][reference] = {
            "sha256": sha256_file(provenance_path),
            "sizeBytes": provenance_path.stat().st_size,
        }
        write_json(manifest_path, manifest)
        config["sourceRuns"]["rotationEvidence"]["manifestSha256"] = (
            sha256_file(manifest_path)
        )
        target_directory = self.runs_root / "derived-provenance" / PAGE_KEY
        target_directory.mkdir(parents=True)
        target_prepared_path = target_directory / "prepared.png"
        target_prepared_path.write_bytes(source_prepared_path.read_bytes())

        with self.assertRaises(BenchmarkError) as raised:
            self._compose(config, target_prepared_path)
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_PAGE_MASK_ARTIFACT_BINDING_INVALID",
        )
        self.assertFalse(
            (target_directory / PAGE_MASK_FILENAME).exists()
        )

    def test_failed_source_page_copies_no_mask_artifacts(self) -> None:
        config, source_prepared_path, _ = self._fixture(
            run_state="completed_with_failures",
            include_failed_page=True,
            with_page_mask=True,
        )
        context = load_source_context(
            config,
            runs_root=self.runs_root,
            validate_authoritatively=False,
        )
        target_directory = self.runs_root / "derived-failed" / FAILED_PAGE_KEY
        target_directory.mkdir(parents=True)
        target_prepared_path = target_directory / "prepared.png"
        target_prepared_path.write_bytes(source_prepared_path.read_bytes())

        with self.assertRaises(BenchmarkError) as raised:
            compose_page_evidence(
                context,
                config,
                page_key=FAILED_PAGE_KEY,
                prepared_path=target_prepared_path,
            )
        self.assertEqual(
            raised.exception.code,
            "ROTATION_SOURCE_PAGE_UNAVAILABLE",
        )
        self.assertFalse(
            any(
                (target_directory / filename).exists()
                for filename in (
                    PAGE_MASK_FILENAME,
                    ENGINE_INPUT_FILENAME,
                    INPUT_STAGE_FILENAME,
                )
            )
        )

    def test_preflight_rejects_implicit_safe_zone_thresholds(self) -> None:
        config, _, _ = self._fixture()
        config["parameters"]["rotationMergePolicy"] = (
            "baseline-plus-nonoverlapping-vertical-zones"
        )
        with self.assertRaises(BenchmarkError) as raised:
            load_source_context(
                config,
                runs_root=self.runs_root,
                validate_authoritatively=False,
            )
        self.assertEqual(
            raised.exception.code,
            "ROTATION_PROJECTION_PARAMETERS_INVALID",
        )


if __name__ == "__main__":
    unittest.main()
