from __future__ import annotations

import copy
import unittest

from layout_benchmark.boundary_filter import (
    external_snapshot_paths,
    line_inclusion_decision,
    normalize_composition_evidence,
)
from layout_benchmark.engines import EngineAdapter
from layout_benchmark.util import BenchmarkError


PAGE_KEY = "014-18780127-L01-02"
SOURCE_SHA256 = "a" * 64
PREPARED_SHA256 = "b" * 64
RASTER_SHA256 = "c" * 64
PAGE_BOUNDARY = [
    {"x": 0, "y": 0},
    {"x": 10, "y": 0},
    {"x": 10, "y": 10},
    {"x": 0, "y": 10},
]


def _line(
    line_id: str,
    *,
    baseline: list[dict[str, int]] | None,
    boundary: list[dict[str, int]],
    baseline_source: str | None = "provider",
    boundary_source: str | None = "provider-polygon",
) -> dict:
    return {
        "id": line_id,
        "class": "text",
        "boundary": boundary,
        "baseline": baseline,
        "orientationDegrees": 0.0,
        "readingOrder": {
            "index": 0,
            "scope": "page",
            "source": "provider",
        },
        "confidence": None,
        "regionId": f"{PAGE_KEY}-region-0001",
        "provenance": {
            "provider": "kraken",
            "providerId": line_id,
            "rawClass": None,
            "attributes": {
                "baselineSource": baseline_source,
                "boundarySource": boundary_source,
            },
        },
    }


def _sampling(
    *,
    inside: int,
    total: int,
    geometry_source: str,
) -> dict:
    return {
        "provider": "pure-python-sampled-path",
        "geometrySource": geometry_source,
        "providerGeometrySource": (
            "provider" if geometry_source == "native-baseline"
            else "provider-polygon"
        ),
        "closedPath": geometry_source == "native-boundary",
        "sampleSpacingPixels": 4.0,
        "insideSampleCount": inside,
        "totalSampleCount": total,
        "insideRatio": inside / total if total else 0.0,
        "insideRatioThresholdExclusive": 0.5,
    }


def _raw_evidence() -> dict:
    included = _line(
        f"{PAGE_KEY}-line-0001",
        baseline=[{"x": 1, "y": 3}, {"x": 9, "y": 3}],
        boundary=[
            {"x": 1, "y": 2},
            {"x": 9, "y": 2},
            {"x": 9, "y": 4},
            {"x": 1, "y": 4},
        ],
    )
    excluded = _line(
        f"{PAGE_KEY}-line-0002",
        baseline=[{"x": 11, "y": 7}, {"x": 19, "y": 7}],
        boundary=[
            {"x": 11, "y": 6},
            {"x": 19, "y": 6},
            {"x": 19, "y": 8},
            {"x": 11, "y": 8},
        ],
    )
    image = {
        "width": 20,
        "height": 20,
        "coordinateSpace": "prepared-pixels-top-left",
        "sourceSha256": SOURCE_SHA256,
        "preparedSha256": "source-encoded-sha",
    }
    line_layout = {
        "schemaVersion": 1,
        "pageKey": PAGE_KEY,
        "runId": "source-lines",
        "engineId": "kraken7-rot3-zones",
        "image": image,
        "pageBoundary": [
            {"x": 0, "y": 0},
            {"x": 20, "y": 0},
            {"x": 20, "y": 20},
            {"x": 0, "y": 20},
        ],
        "regions": [
            {
                "id": f"{PAGE_KEY}-region-0001",
                "class": "text",
                "boundary": [
                    {"x": 0, "y": 0},
                    {"x": 20, "y": 0},
                    {"x": 20, "y": 20},
                    {"x": 0, "y": 20},
                ],
                "orientationDegrees": None,
                "readingOrder": None,
                "confidence": None,
                "lineIds": [included["id"], excluded["id"]],
                "provenance": {
                    "provider": "kraken",
                    "providerId": "region-1",
                    "rawClass": "text",
                    "attributes": {},
                },
            }
        ],
        "lines": [included, excluded],
        "warnings": [],
    }
    boundary_layout = {
        "schemaVersion": 1,
        "pageKey": PAGE_KEY,
        "runId": "source-boundary",
        "engineId": "eynollah-v091",
        "image": image,
        "pageBoundary": PAGE_BOUNDARY,
        "regions": [],
        "lines": [],
        "warnings": [],
    }
    return {
        "schemaVersion": 1,
        "kind": "BoundaryFilterCompositionEvidence",
        "engineId": "kraken7-rot3-eyno-boundary-filter",
        "contract": {
            "enforcement": "adapter-enforced-v2",
            "qualityRankable": False,
            "groundTruth": False,
            "productionPageLayoutV2": False,
            "limitation": "typed derivation is intentionally deferred",
        },
        "sourceBindings": {
            "lineGeometry": {
                "runId": "source-lines",
                "engineId": "kraken7-rot3-zones",
            },
            "pageBoundary": {
                "runId": "source-boundary",
                "engineId": "eynollah-v091",
            },
        },
        "targetPrepared": {
            "encodedSha256": PREPARED_SHA256,
            "width": 20,
            "height": 20,
            "rasterFingerprint": {
                "algorithm": "sha256-rgb8-v1",
                "sha256": RASTER_SHA256,
            },
        },
        "sourceLayouts": {
            "lineGeometry": line_layout,
            "pageBoundary": boundary_layout,
        },
        "pageBoundary": {
            "points": PAGE_BOUNDARY,
            "sourceRunId": "source-boundary",
        },
        "lineEvidence": [
            {
                "sourceOrdinal": 0,
                "sourceLineId": included["id"],
                "includedInProjection": True,
                "projectedLineId": included["id"],
                "reason": (
                    "sampled-native-geometry-primarily-inside-page-boundary"
                ),
                "sampling": _sampling(
                    inside=2,
                    total=2,
                    geometry_source="native-baseline",
                ),
                "sourceLine": copy.deepcopy(included),
            },
            {
                "sourceOrdinal": 1,
                "sourceLineId": excluded["id"],
                "includedInProjection": False,
                "projectedLineId": None,
                "reason": (
                    "sampled-native-geometry-not-primarily-inside-page-boundary"
                ),
                "sampling": _sampling(
                    inside=0,
                    total=2,
                    geometry_source="native-baseline",
                ),
                "sourceLine": copy.deepcopy(excluded),
            },
        ],
        "projection": {
            "includedSourceLineIds": [included["id"]],
            "excludedSourceLineIds": [excluded["id"]],
            "includedCount": 1,
            "excludedCount": 1,
            "totalSourceLineCount": 2,
        },
    }


class BoundarySamplingTests(unittest.TestCase):
    def test_strict_majority_includes_inside_and_excludes_exact_half(self) -> None:
        mostly_inside = _line(
            "inside",
            baseline=[{"x": -1, "y": 5}, {"x": 9, "y": 5}],
            boundary=PAGE_BOUNDARY,
        )
        exactly_half = _line(
            "half",
            baseline=[{"x": -10, "y": 5}, {"x": 10, "y": 5}],
            boundary=PAGE_BOUNDARY,
        )
        inside_decision = line_inclusion_decision(
            mostly_inside,
            PAGE_BOUNDARY,
            sample_spacing_pixels=1,
            threshold_exclusive=0.5,
        )
        half_decision = line_inclusion_decision(
            exactly_half,
            PAGE_BOUNDARY,
            sample_spacing_pixels=1,
            threshold_exclusive=0.5,
        )
        self.assertTrue(inside_decision["included"])
        self.assertEqual(
            inside_decision["sampling"]["geometrySource"],
            "native-baseline",
        )
        self.assertFalse(half_decision["included"])
        self.assertEqual(half_decision["sampling"]["insideRatio"], 0.5)

    def test_page_edge_counts_inside_and_native_boundary_is_fallback(self) -> None:
        edge = _line(
            "edge",
            baseline=[{"x": 0, "y": 1}, {"x": 0, "y": 9}],
            boundary=PAGE_BOUNDARY,
        )
        boundary_only = _line(
            "boundary-only",
            baseline=None,
            boundary=[
                {"x": 1, "y": 1},
                {"x": 9, "y": 1},
                {"x": 9, "y": 9},
                {"x": 1, "y": 9},
            ],
            baseline_source=None,
        )
        edge_decision = line_inclusion_decision(
            edge,
            PAGE_BOUNDARY,
            sample_spacing_pixels=1,
            threshold_exclusive=0.5,
        )
        boundary_decision = line_inclusion_decision(
            boundary_only,
            PAGE_BOUNDARY,
            sample_spacing_pixels=1,
            threshold_exclusive=0.5,
        )
        self.assertTrue(edge_decision["included"])
        self.assertEqual(edge_decision["sampling"]["insideRatio"], 1.0)
        self.assertTrue(boundary_decision["included"])
        self.assertEqual(
            boundary_decision["sampling"]["geometrySource"],
            "native-boundary",
        )

    def test_derived_or_unproven_geometry_is_preserved_but_excluded(self) -> None:
        line = _line(
            "derived",
            baseline=[{"x": 1, "y": 5}, {"x": 9, "y": 5}],
            boundary=PAGE_BOUNDARY,
            baseline_source="derived",
            boundary_source="baseline-envelope",
        )
        decision = line_inclusion_decision(
            line,
            PAGE_BOUNDARY,
            sample_spacing_pixels=1,
            threshold_exclusive=0.5,
        )
        self.assertFalse(decision["included"])
        self.assertEqual(
            decision["reason"],
            "source-line-has-no-provider-native-sampleable-geometry",
        )
        self.assertEqual(decision["sampling"]["totalSampleCount"], 0)


class BoundaryProjectionTests(unittest.TestCase):
    def test_projection_filters_lines_without_losing_raw_source_evidence(self) -> None:
        raw = _raw_evidence()
        normalized = normalize_composition_evidence(
            raw=raw,
            engine_id=raw["engineId"],
            run_id="derived-run",
            page_key=PAGE_KEY,
            width=20,
            height=20,
            source_sha256=SOURCE_SHA256,
            prepared_sha256=PREPARED_SHA256,
        )
        self.assertEqual(normalized["pageBoundary"], PAGE_BOUNDARY)
        self.assertEqual(len(normalized["lines"]), 1)
        self.assertEqual(
            normalized["lines"][0]["id"],
            f"{PAGE_KEY}-line-0001",
        )
        self.assertEqual(
            normalized["regions"][0]["lineIds"],
            [f"{PAGE_KEY}-line-0001"],
        )
        self.assertEqual(len(raw["lineEvidence"]), 2)
        self.assertIsNone(raw["lineEvidence"][1]["projectedLineId"])
        self.assertEqual(
            normalized["image"]["rasterFingerprint"]["sha256"],
            RASTER_SHA256,
        )
        self.assertFalse(raw["contract"]["qualityRankable"])

    def test_projection_rejects_tampered_source_line_or_decision(self) -> None:
        for mutation in ("source-line", "decision"):
            raw = _raw_evidence()
            if mutation == "source-line":
                raw["lineEvidence"][0]["sourceLine"]["boundary"][0]["x"] = 7
            else:
                raw["lineEvidence"][0]["includedInProjection"] = False
            with self.subTest(mutation=mutation), self.assertRaises(
                BenchmarkError
            ):
                normalize_composition_evidence(
                    raw=raw,
                    engine_id=raw["engineId"],
                    run_id="derived-run",
                    page_key=PAGE_KEY,
                    width=20,
                    height=20,
                    source_sha256=SOURCE_SHA256,
                    prepared_sha256=PREPARED_SHA256,
                )


class BoundarySourceBindingTests(unittest.TestCase):
    def test_config_is_source_run_driven_and_non_rankable(self) -> None:
        adapter = EngineAdapter("kraken7-eyno-boundary-filter")
        self.assertEqual(
            adapter.config["sourceRuns"]["lineGeometry"]["runId"],
            "kraken7-blla-v2-full-20260728",
        )
        self.assertEqual(
            adapter.config["sourceRuns"]["pageBoundary"]["runId"],
            "eynollah-v091-full-no-cl-cloud-20260728",
        )
        self.assertFalse(
            adapter.config["diagnostic"]["equivalentToDefaultProfile"]
        )
        self.assertEqual(
            adapter.config["diagnostic"]["contractEnforcement"],
            "adapter-enforced-v2",
        )

    def test_external_snapshot_includes_manifests_layouts_and_failed_page_error(
        self,
    ) -> None:
        adapter = EngineAdapter("kraken7-eyno-boundary-filter")
        paths = {
            path.as_posix()
            for path in external_snapshot_paths(adapter.config)
        }
        self.assertTrue(
            any(
                path.endswith(
                    "kraken7-blla-v2-full-20260728/run.v2.json"
                )
                for path in paths
            )
        )
        self.assertTrue(
            any(
                path.endswith(
                    "eynollah-v091-full-no-cl-cloud-20260728/"
                    f"pages/{PAGE_KEY}/normalized-layout.v1.json"
                )
                for path in paths
            )
        )
        self.assertTrue(
            any(
                path.endswith(
                    "eynollah-v091-full-no-cl-cloud-20260728/"
                    "pages/003-18880810-L01-03/error.json"
                )
                for path in paths
            )
        )

    def test_manifest_checksum_mismatch_fails_closed(self) -> None:
        adapter = EngineAdapter("kraken7-eyno-boundary-filter")
        config = copy.deepcopy(adapter.config)
        config["sourceRuns"]["lineGeometry"]["manifestSha256"] = "0" * 64
        with self.assertRaises(BenchmarkError) as context:
            external_snapshot_paths(config)
        self.assertEqual(
            context.exception.code,
            "SOURCE_RUN_MANIFEST_CHECKSUM_MISMATCH",
        )


if __name__ == "__main__":
    unittest.main()
