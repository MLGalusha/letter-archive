from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest

from pathlib import Path

from PIL import Image, PngImagePlugin

from layout_benchmark.page_mask_input import (
    MASK_COORDINATE_SPACE,
    MASK_POLARITY,
    MAX_ABS_PADDING_PIXELS,
    MAX_BOUNDARY_VERTICES,
    MAX_IMAGE_DIMENSION,
    MaskedKrakenInput,
    VerifiedPageBoundary,
    build_masked_kraken_input,
)
from layout_benchmark.preparation import rgb8_raster_sha256
from layout_benchmark.util import canonical_json_bytes


PAGE_KEY = "014-18780127-L01-02"
RUN_ID = "eynollah-v091-full-no-cl-cloud-20260728"
ENGINE_ID = "eynollah-v091"
MANIFEST_SHA256 = "a" * 64
PREPARED_ENCODED_SHA256 = "b" * 64
SOURCE_SHA256 = "c" * 64


def _normalized_layout_bytes(
    *,
    width: int,
    height: int,
    boundary: list[dict[str, int]],
    warnings: list[dict[str, str]] | None = None,
    page_key: str = PAGE_KEY,
    run_id: str = RUN_ID,
    engine_id: str = ENGINE_ID,
) -> bytes:
    return canonical_json_bytes(
        {
            "schemaVersion": 1,
            "pageKey": page_key,
            "runId": run_id,
            "engineId": engine_id,
            "image": {
                "width": width,
                "height": height,
                "coordinateSpace": MASK_COORDINATE_SPACE,
                "sourceSha256": SOURCE_SHA256,
                "preparedSha256": PREPARED_ENCODED_SHA256,
            },
            "pageBoundary": boundary,
            "regions": [],
            "lines": [],
            "warnings": [] if warnings is None else warnings,
        }
    )


def _verified_boundary(
    *,
    width: int,
    height: int,
    boundary: list[dict[str, int]],
    raster_sha256: str,
    warnings: list[dict[str, str]] | None = None,
    engine_id: str = ENGINE_ID,
) -> VerifiedPageBoundary:
    normalized = _normalized_layout_bytes(
        width=width,
        height=height,
        boundary=boundary,
        warnings=warnings,
        engine_id=engine_id,
    )
    return VerifiedPageBoundary.from_normalized_layout(
        normalized,
        expected_page_key=PAGE_KEY,
        expected_run_id=RUN_ID,
        expected_engine_id=engine_id,
        expected_manifest_sha256=MANIFEST_SHA256,
        expected_normalized_artifact_sha256=hashlib.sha256(
            normalized
        ).hexdigest(),
        normalized_artifact_reference=(
            f"pages/{PAGE_KEY}/normalized-layout.v1.json"
        ),
        verified_prepared_raster_sha256=raster_sha256,
    )


def _write_prepared(
    directory: Path,
    image: Image.Image,
    *,
    metadata: bool = False,
) -> Path:
    path = directory / "prepared.png"
    pnginfo = None
    if metadata:
        pnginfo = PngImagePlugin.PngInfo()
        pnginfo.add_text("should-be-stripped", "yes")
    image.save(
        path,
        format="PNG",
        compress_level=9,
        optimize=False,
        interlace=False,
        pnginfo=pnginfo,
    )
    return path


def _raster_sha256(image: Image.Image) -> str:
    return rgb8_raster_sha256(
        image.width,
        image.height,
        image.tobytes(),
    )


def _decode_png(value: bytes) -> Image.Image:
    with Image.open(io.BytesIO(value)) as image:
        image.load()
        return image.copy()


class VerifiedBoundaryTests(unittest.TestCase):
    def test_rejects_wrong_artifact_hash_identity_or_engine(self) -> None:
        normalized = _normalized_layout_bytes(
            width=5,
            height=4,
            boundary=[
                {"x": 0, "y": 0},
                {"x": 4, "y": 0},
                {"x": 4, "y": 3},
                {"x": 0, "y": 3},
            ],
        )
        common = {
            "normalized_layout_bytes": normalized,
            "expected_page_key": PAGE_KEY,
            "expected_run_id": RUN_ID,
            "expected_engine_id": ENGINE_ID,
            "expected_manifest_sha256": MANIFEST_SHA256,
            "expected_normalized_artifact_sha256": hashlib.sha256(
                normalized
            ).hexdigest(),
            "normalized_artifact_reference": "normalized-layout.v1.json",
            "verified_prepared_raster_sha256": "d" * 64,
        }
        for changed in (
            {"expected_normalized_artifact_sha256": "e" * 64},
            {"expected_page_key": "different-page"},
            {"expected_run_id": "different-run"},
            {"expected_engine_id": "kraken7"},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                VerifiedPageBoundary.from_normalized_layout(
                    **{**common, **changed}
                )

    def test_rejects_page_boundary_unavailable_fallback(self) -> None:
        image = Image.new("RGB", (5, 4), "black")
        with self.assertRaisesRegex(ValueError, "unavailable"):
            _verified_boundary(
                width=5,
                height=4,
                boundary=[
                    {"x": 0, "y": 0},
                    {"x": 4, "y": 0},
                    {"x": 4, "y": 3},
                    {"x": 0, "y": 3},
                ],
                raster_sha256=_raster_sha256(image),
                warnings=[
                    {
                        "code": "PAGE_BOUNDARY_UNAVAILABLE",
                        "message": "frame fallback",
                    }
                ],
            )

    def test_rejects_invalid_contours_and_resource_excess(self) -> None:
        image = Image.new("RGB", (5, 5), "black")
        invalid = [
            [],
            [{"x": 0, "y": 0}, {"x": 1, "y": 1}],
            [
                {"x": 0, "y": 0},
                {"x": 4, "y": 4},
                {"x": 0, "y": 4},
                {"x": 4, "y": 0},
            ],
            [
                {"x": 0, "y": 0},
                {"x": 5, "y": 0},
                {"x": 0, "y": 4},
            ],
            [
                {"x": 0.0, "y": 0},
                {"x": 4, "y": 0},
                {"x": 0, "y": 4},
            ],
        ]
        for contour in invalid:
            with self.subTest(contour=contour), self.assertRaises(ValueError):
                _verified_boundary(
                    width=5,
                    height=5,
                    boundary=contour,
                    raster_sha256=_raster_sha256(image),
                )

        too_many = [
            {"x": index % 5, "y": (index // 5) % 5}
            for index in range(MAX_BOUNDARY_VERTICES + 2)
        ]
        with self.assertRaisesRegex(ValueError, "exceeds"):
            _verified_boundary(
                width=5,
                height=5,
                boundary=too_many,
                raster_sha256=_raster_sha256(image),
            )
        with self.assertRaisesRegex(ValueError, "limits"):
            _verified_boundary(
                width=MAX_IMAGE_DIMENSION + 1,
                height=1,
                boundary=[
                    {"x": 0, "y": 0},
                    {"x": 1, "y": 0},
                    {"x": 0, "y": 0},
                ],
                raster_sha256=_raster_sha256(image),
            )


class MaskedKrakenInputTests(unittest.TestCase):
    def test_eynollah_full_frame_pixel_contour_retains_every_pixel(self) -> None:
        """
        Golden contract for normalized Eynollah/OpenCV contour coordinates.

        The real normalizer's full frame is `(0,0)..(width-1,height-1)`.
        This must not lose the final row/column as an edge-space rasterizer
        would.
        """

        image = Image.new("RGB", (5, 4))
        image.putdata(
            [
                (index, index + 1, index + 2)
                for index in range(image.width * image.height)
            ]
        )
        contour = [
            {"x": 0, "y": 0},
            {"x": 4, "y": 0},
            {"x": 4, "y": 3},
            {"x": 0, "y": 3},
        ]
        boundary = _verified_boundary(
            width=5,
            height=4,
            boundary=contour,
            raster_sha256=_raster_sha256(image),
        )
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(Path(temporary), image)
            result = build_masked_kraken_input(
                prepared,
                boundary,
                page_key=PAGE_KEY,
            )

        mask = _decode_png(result.include_mask_png)
        engine_input = _decode_png(result.engine_input_png)
        self.assertEqual(mask.mode, "L")
        self.assertEqual(mask.getextrema(), (255, 255))
        self.assertEqual(mask.tobytes().count(255), 20)
        self.assertEqual(engine_input.mode, "RGB")
        self.assertEqual(engine_input.tobytes(), image.tobytes())
        provenance = json.loads(result.provenance_json)
        self.assertEqual(
            provenance["includeMask"]["artifact"]["rasterFingerprint"][
                "sha256"
            ],
            "8bcf7327fff646e207cecc8e5b9a9b92d0c947b5efee14eb2564bd2515f79310",
        )

    def test_partial_contour_whitens_only_outside_with_identity_geometry(
        self,
    ) -> None:
        image = Image.new("RGB", (5, 5), (10, 20, 30))
        boundary = _verified_boundary(
            width=5,
            height=5,
            boundary=[
                {"x": 1, "y": 1},
                {"x": 3, "y": 1},
                {"x": 3, "y": 3},
                {"x": 1, "y": 3},
            ],
            raster_sha256=_raster_sha256(image),
        )
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(Path(temporary), image)
            result = build_masked_kraken_input(
                prepared,
                boundary,
                page_key=PAGE_KEY,
            )

        mask = _decode_png(result.include_mask_png)
        engine_input = _decode_png(result.engine_input_png)
        self.assertEqual(mask.tobytes().count(255), 9)
        self.assertEqual(engine_input.size, image.size)
        self.assertEqual(engine_input.getpixel((2, 2)), (10, 20, 30))
        self.assertEqual(engine_input.getpixel((0, 0)), (255, 255, 255))

    def test_reversed_winding_and_concave_contours_are_stable(self) -> None:
        image = Image.new("RGB", (6, 6), "black")
        contour = [
            {"x": 1, "y": 1},
            {"x": 4, "y": 1},
            {"x": 4, "y": 2},
            {"x": 2, "y": 2},
            {"x": 2, "y": 4},
            {"x": 1, "y": 4},
        ]
        boundaries = [
            _verified_boundary(
                width=6,
                height=6,
                boundary=value,
                raster_sha256=_raster_sha256(image),
            )
            for value in (contour, list(reversed(contour)))
        ]
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(Path(temporary), image)
            results = [
                build_masked_kraken_input(
                    prepared,
                    boundary,
                    page_key=PAGE_KEY,
                )
                for boundary in boundaries
            ]
        self.assertEqual(
            results[0].include_mask_png,
            results[1].include_mask_png,
        )
        mask = _decode_png(results[0].include_mask_png)
        self.assertEqual(mask.getpixel((1, 1)), 255)
        self.assertEqual(mask.getpixel((3, 3)), 0)

    def test_padding_is_bounded_chebyshev_morphology_with_black_exterior(
        self,
    ) -> None:
        image = Image.new("RGB", (5, 5), "black")
        full_frame = _verified_boundary(
            width=5,
            height=5,
            boundary=[
                {"x": 0, "y": 0},
                {"x": 4, "y": 0},
                {"x": 4, "y": 4},
                {"x": 0, "y": 4},
            ],
            raster_sha256=_raster_sha256(image),
        )
        small = _verified_boundary(
            width=5,
            height=5,
            boundary=[
                {"x": 1, "y": 1},
                {"x": 3, "y": 1},
                {"x": 3, "y": 3},
                {"x": 1, "y": 3},
            ],
            raster_sha256=_raster_sha256(image),
        )
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(Path(temporary), image)
            eroded = build_masked_kraken_input(
                prepared,
                full_frame,
                page_key=PAGE_KEY,
                padding_pixels=-1,
            )
            dilated = build_masked_kraken_input(
                prepared,
                small,
                page_key=PAGE_KEY,
                padding_pixels=1,
            )
            with self.assertRaisesRegex(ValueError, "between"):
                build_masked_kraken_input(
                    prepared,
                    full_frame,
                    page_key=PAGE_KEY,
                    padding_pixels=MAX_ABS_PADDING_PIXELS + 1,
                )

        self.assertEqual(
            _decode_png(eroded.include_mask_png).tobytes().count(255),
            9,
        )
        self.assertEqual(
            _decode_png(dilated.include_mask_png).getextrema(),
            (255, 255),
        )

    def test_rejects_same_size_wrong_raster_and_wrong_page_key(self) -> None:
        source = Image.new("RGB", (5, 5), "black")
        wrong = Image.new("RGB", (5, 5), "white")
        boundary = _verified_boundary(
            width=5,
            height=5,
            boundary=[
                {"x": 0, "y": 0},
                {"x": 4, "y": 0},
                {"x": 4, "y": 4},
                {"x": 0, "y": 4},
            ],
            raster_sha256=_raster_sha256(source),
        )
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(Path(temporary), wrong)
            with self.assertRaisesRegex(ValueError, "decoded raster"):
                build_masked_kraken_input(
                    prepared,
                    boundary,
                    page_key=PAGE_KEY,
                )
            with self.assertRaisesRegex(ValueError, "page key"):
                build_masked_kraken_input(
                    prepared,
                    boundary,
                    page_key="different-page",
                )

    def test_outputs_are_immutable_deterministic_and_metadata_stripped(
        self,
    ) -> None:
        image = Image.new("RGB", (5, 5), (10, 20, 30))
        boundary = _verified_boundary(
            width=5,
            height=5,
            boundary=[
                {"x": 1, "y": 1},
                {"x": 3, "y": 1},
                {"x": 3, "y": 3},
                {"x": 1, "y": 3},
            ],
            raster_sha256=_raster_sha256(image),
        )
        with tempfile.TemporaryDirectory() as temporary:
            prepared = _write_prepared(
                Path(temporary),
                image,
                metadata=True,
            )
            first = build_masked_kraken_input(
                prepared,
                boundary,
                page_key=PAGE_KEY,
            )
            second = build_masked_kraken_input(
                prepared,
                boundary,
                page_key=PAGE_KEY,
            )

        self.assertIsInstance(first, MaskedKrakenInput)
        self.assertEqual(first, second)
        self.assertIsInstance(first.include_mask_png, bytes)
        self.assertIsInstance(first.engine_input_png, bytes)
        self.assertIsInstance(first.provenance_json, bytes)
        with Image.open(io.BytesIO(first.include_mask_png)) as mask:
            self.assertEqual(mask.info, {})
        with Image.open(io.BytesIO(first.engine_input_png)) as engine:
            self.assertEqual(engine.info, {})

        provenance = json.loads(first.provenance_json)
        self.assertEqual(
            provenance["includeMask"]["polarity"],
            MASK_POLARITY,
        )
        self.assertEqual(
            provenance["coordinateTransform"]["name"],
            "identity",
        )
        self.assertEqual(
            provenance["sourceBoundary"]["manifestSha256"],
            MANIFEST_SHA256,
        )
        self.assertEqual(
            provenance["sourceBoundary"][
                "preparedRasterFingerprint"
            ]["sha256"],
            _raster_sha256(image),
        )
        self.assertEqual(
            provenance["includeMask"]["artifact"]["sha256"],
            hashlib.sha256(first.include_mask_png).hexdigest(),
        )
        self.assertEqual(
            provenance["engineInput"]["artifact"]["sha256"],
            hashlib.sha256(first.engine_input_png).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
