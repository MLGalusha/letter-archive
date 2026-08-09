"""Local, anchor-conditioned recovery of source-supported handwriting pixels.

This is deliberately not a page-wide threshold.  The already selected fragments
define the local ink colour, stroke scale, and writing axis.  Candidate additions
remain proposals from exact source pixels and are never automatic ownership.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np
from scipy import ndimage
from skimage.filters import sato

from .engine import EnvelopeError


@dataclass(frozen=True)
class RecoveryProfile:
    name: str
    score_threshold: float
    minimum_component_pixels: int
    maximum_anchor_distance_fraction: float
    along_extension_fraction: float
    across_extension_fraction: float
    maximum_straight_artifact: float
    straight_artifact_ridge_override: float


DEFAULT_PROFILES = (
    RecoveryProfile("conservative", 0.68, 3, 0.30, 0.08, 0.38, 0.56, 1.10),
    RecoveryProfile("balanced", 0.55, 2, 0.43, 0.14, 0.52, 0.72, 0.88),
    RecoveryProfile("maximum_recall", 0.44, 2, 0.58, 0.24, 0.68, 0.88, 0.72),
)


def _mask(value: np.ndarray, *, name: str, shape: tuple[int, int]) -> np.ndarray:
    result = np.asarray(value)
    if result.shape != shape or result.ndim != 2:
        raise EnvelopeError(f"{name} must match the source dimensions")
    if result.dtype == bool:
        return result.copy()
    unique = np.unique(result)
    if not set(unique.tolist()).issubset({0, 1, 255}):
        raise EnvelopeError(f"{name} must be binary")
    return result > 0


def _normalized_from_anchor(values: np.ndarray, anchor: np.ndarray) -> np.ndarray:
    samples = values[anchor]
    low = float(np.quantile(samples, 0.10))
    high = float(np.quantile(samples, 0.78))
    high = max(high, low + 1e-5)
    return np.clip((values - low * 0.28) / (high - low * 0.28), 0.0, 1.0)


def _oriented_support(
    anchor: np.ndarray,
    *,
    along_extension_fraction: float,
    across_extension_fraction: float,
) -> np.ndarray:
    ys, xs = np.nonzero(anchor)
    points = np.column_stack((xs, ys)).astype(np.float64)
    center = points.mean(axis=0)
    if len(points) >= 2:
        _u, _s, axes = np.linalg.svd(points - center, full_matrices=False)
        along = axes[0]
    else:
        along = np.array([1.0, 0.0])
    if along[0] < 0:
        along = -along
    across = np.array([-along[1], along[0]])
    along_projection = (points - center) @ along
    across_projection = (points - center) @ across
    along_span = max(12.0, float(np.ptp(along_projection)))
    across_span = max(8.0, float(np.ptp(across_projection)))
    yy, xx = np.indices(anchor.shape)
    grid = np.stack((xx - center[0], yy - center[1]), axis=-1)
    grid_along = grid @ along
    grid_across = grid @ across
    along_margin = max(10.0, along_span * along_extension_fraction)
    across_margin = max(14.0, across_span * across_extension_fraction)
    return (
        (grid_along >= float(along_projection.min()) - along_margin)
        & (grid_along <= float(along_projection.max()) + along_margin)
        & (grid_across >= float(across_projection.min()) - across_margin)
        & (grid_across <= float(across_projection.max()) + across_margin)
    )


def _filter_components(
    candidate: np.ndarray,
    score: np.ndarray,
    distance: np.ndarray,
    *,
    minimum_pixels: int,
    maximum_distance: float,
) -> np.ndarray:
    labels, count = ndimage.label(
        candidate,
        structure=np.ones((3, 3), dtype=np.uint8),
    )
    if count == 0:
        return np.zeros_like(candidate)
    keep = np.zeros(count + 1, dtype=bool)
    for component_id in range(1, count + 1):
        component = labels == component_id
        area = int(component.sum())
        if area < minimum_pixels:
            continue
        if float(distance[component].min()) <= maximum_distance or float(
            score[component].max()
        ) >= 0.82:
            keep[component_id] = True
    return keep[labels]


def recover_local_ink_candidates(
    source_rgb: np.ndarray,
    anchor_mask: np.ndarray,
    forbidden_mask: np.ndarray,
    recovery_bbox_xywh: list[int] | tuple[int, int, int, int],
    *,
    profiles: tuple[RecoveryProfile, ...] = DEFAULT_PROFILES,
) -> dict[str, Any]:
    """Return conservative through high-recall exact-source candidate masks.

    Masks in the result are local to ``crop_bbox_xywh``. Candidate masks include
    the original anchor so callers can preview a complete proposed word; additions
    contain only newly recovered source positions.
    """

    source = np.asarray(source_rgb)
    if source.ndim != 3 or source.shape[2] != 3 or source.dtype != np.uint8:
        raise EnvelopeError("source_rgb must be an unsigned 8-bit RGB image")
    height, width = source.shape[:2]
    anchor = _mask(anchor_mask, name="anchor mask", shape=(height, width))
    forbidden = _mask(
        forbidden_mask,
        name="forbidden mask",
        shape=(height, width),
    )
    if not np.any(anchor):
        raise EnvelopeError("Local recovery requires selected anchor ink")
    if np.any(anchor & forbidden):
        raise EnvelopeError("Anchor and forbidden ownership overlap")
    if (
        len(recovery_bbox_xywh) != 4
        or any(not isinstance(value, int) for value in recovery_bbox_xywh)
    ):
        raise EnvelopeError("Recovery bbox must be four integer source coordinates")
    x, y, box_width, box_height = recovery_bbox_xywh
    if (
        x < 0
        or y < 0
        or box_width < 1
        or box_height < 1
        or x + box_width > width
        or y + box_height > height
    ):
        raise EnvelopeError("Recovery bbox falls outside the source")
    local_anchor = anchor[y : y + box_height, x : x + box_width]
    if not np.any(local_anchor):
        raise EnvelopeError("Recovery bbox does not contain the selected anchor")
    local_forbidden = forbidden[y : y + box_height, x : x + box_width]
    local_source = source[y : y + box_height, x : x + box_width]

    rgb = local_source.astype(np.float32) / np.float32(255.0)
    gray = (
        rgb[:, :, 0] * np.float32(0.2126)
        + rgb[:, :, 1] * np.float32(0.7152)
        + rgb[:, :, 2] * np.float32(0.0722)
    )
    scale = max(width, height) / 1600.0
    local_sigma = max(5.0, 7.0 * scale)
    broad_sigma = max(13.0, 22.0 * scale)
    local_background = ndimage.gaussian_filter(gray, local_sigma, mode="nearest")
    broad_background = ndimage.gaussian_filter(gray, broad_sigma, mode="nearest")
    darkness = np.maximum(
        local_background - gray,
        (broad_background - gray) * np.float32(0.72),
    )

    colour_sigma = max(4.0, 6.0 * scale)
    residual = np.empty_like(rgb)
    for channel in range(3):
        residual[:, :, channel] = ndimage.gaussian_filter(
            rgb[:, :, channel],
            colour_sigma,
            mode="nearest",
        ) - rgb[:, :, channel]
    anchor_vector = np.median(residual[local_anchor], axis=0)
    vector_norm = float(np.linalg.norm(anchor_vector))
    if vector_norm < 1e-6:
        raise EnvelopeError("Selected anchor does not provide a usable ink colour")
    unit_vector = anchor_vector / np.float32(vector_norm)
    colour_projection = np.maximum(residual @ unit_vector, 0.0)
    residual_norm = np.linalg.norm(residual, axis=2)
    colour_cosine = np.clip(
        (residual @ unit_vector) / np.maximum(residual_norm, 1e-6),
        0.0,
        1.0,
    )

    ridge_sigmas = tuple(max(0.8, sigma * scale) for sigma in (1.0, 2.0, 3.0))
    ridge = sato(gray, sigmas=ridge_sigmas, black_ridges=True).astype(np.float32)
    darkness_score = _normalized_from_anchor(darkness, local_anchor)
    colour_score = _normalized_from_anchor(colour_projection, local_anchor)
    ridge_score = _normalized_from_anchor(ridge, local_anchor)
    distance = ndimage.distance_transform_edt(~local_anchor)
    proximity_scale = max(18.0, max(box_width, box_height) * 0.32)
    proximity_score = np.exp(-distance / proximity_scale)

    # Reuse the frozen V4 insight that folds are long background transitions.
    # Unlike V4, this is only a local penalty around one selected word. Strong
    # ridge evidence can still survive it, while a straight fold edge cannot win
    # merely because its colour residual resembles blue ink under a shadow.
    artifact_background = ndimage.gaussian_filter(
        gray,
        max(4.0, 7.0 * scale),
        mode="nearest",
    )
    background_y, background_x = np.gradient(artifact_background)
    long_window = max(35, int(round(181.0 * scale)) | 1)
    cross_window = max(5, int(round(5.0 * scale)) | 1)
    vertical_transition = ndimage.uniform_filter(
        np.abs(background_x),
        size=(long_window, cross_window),
        mode="nearest",
    )
    horizontal_transition = ndimage.uniform_filter(
        np.abs(background_y),
        size=(cross_window, long_window),
        mode="nearest",
    )
    straight_artifact = np.clip(
        (np.maximum(vertical_transition, horizontal_transition) - 0.0015)
        / 0.006,
        0.0,
        1.0,
    ).astype(np.float32)
    # A fold can be too broad for the local ridge-shaped V4 vote but remain a
    # coherent low-frequency transition across most of the crop. Aggregate the
    # blurred gradient by full rows/columns so ordinary letter strokes cannot
    # dominate this evidence merely by being locally dark.
    column_transition = np.mean(np.abs(background_x), axis=0)
    row_transition = np.mean(np.abs(background_y), axis=1)

    def coherent_score(values: np.ndarray) -> np.ndarray:
        low = float(np.quantile(values, 0.62))
        high = max(low + 1e-6, float(np.quantile(values, 0.96)))
        return np.clip((values - low) / (high - low), 0.0, 1.0)

    coherent_vertical = np.broadcast_to(
        coherent_score(column_transition)[None, :],
        gray.shape,
    )
    coherent_horizontal = np.broadcast_to(
        coherent_score(row_transition)[:, None],
        gray.shape,
    )
    coherent_fold = np.maximum(coherent_vertical, coherent_horizontal)
    straight_artifact = np.maximum(straight_artifact, coherent_fold).astype(
        np.float32
    )
    score = np.clip(
        colour_score * 0.38
        + colour_cosine * 0.18
        + ridge_score * 0.25
        + darkness_score * 0.12
        + proximity_score * 0.07
        - straight_artifact * (1.0 - ridge_score) * 0.38,
        0.0,
        1.0,
    ).astype(np.float32)
    anchor_projection_floor = max(
        0.004,
        float(np.quantile(colour_projection[local_anchor], 0.08)) * 0.22,
    )
    anchor_ridge_floor = max(
        0.0015,
        float(np.quantile(ridge[local_anchor], 0.08)) * 0.18,
    )
    source_evidence = (
        (
            (colour_cosine >= 0.30)
            & (colour_projection >= anchor_projection_floor)
        )
        | (ridge >= anchor_ridge_floor)
    )
    candidates: dict[str, dict[str, Any]] = {}
    previous = np.zeros_like(local_anchor)
    for profile in profiles:
        spatial = _oriented_support(
            local_anchor,
            along_extension_fraction=profile.along_extension_fraction,
            across_extension_fraction=profile.across_extension_fraction,
        )
        eligible = (
            spatial
            & source_evidence
            & ~local_forbidden
            & ~local_anchor
            & (
                (straight_artifact <= profile.maximum_straight_artifact)
                | (ridge_score >= profile.straight_artifact_ridge_override)
            )
        )
        raw = eligible & (score >= np.float32(profile.score_threshold))
        additions = _filter_components(
            raw,
            score,
            distance,
            minimum_pixels=profile.minimum_component_pixels,
            maximum_distance=max(box_width, box_height)
            * profile.maximum_anchor_distance_fraction,
        )
        additions |= previous
        previous = additions
        proposed = local_anchor | additions
        candidates[profile.name] = {
            "mask": proposed,
            "additions": additions,
            "added_pixels": int(additions.sum()),
            "added_component_count": int(
                ndimage.label(
                    additions,
                    structure=np.ones((3, 3), dtype=np.uint8),
                )[1]
            ),
            "score_threshold": profile.score_threshold,
            "minimum_component_pixels": profile.minimum_component_pixels,
            "along_extension_fraction": profile.along_extension_fraction,
            "across_extension_fraction": profile.across_extension_fraction,
            "maximum_straight_artifact": profile.maximum_straight_artifact,
            "straight_artifact_ridge_override": profile.straight_artifact_ridge_override,
            "source_supported_only": True,
        }

    return {
        "crop_bbox_xywh": [x, y, box_width, box_height],
        "anchor_pixels": int(local_anchor.sum()),
        "anchor_colour_residual_vector": [round(float(v), 8) for v in anchor_vector],
        "features": {
            "paper_normalization": "local_and_broad_gaussian_source_background",
            "local_sigma_px": local_sigma,
            "broad_sigma_px": broad_sigma,
            "colour_sigma_px": colour_sigma,
            "ridge_sigmas_px": [float(value) for value in ridge_sigmas],
            "selection_conditioning": "anchor_colour_stroke_shape_axis_and_distance",
        },
        "candidates": candidates,
    }
