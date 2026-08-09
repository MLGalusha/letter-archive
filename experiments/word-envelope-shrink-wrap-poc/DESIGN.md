# Design

## Boundary of the experiment

This is a standalone proof of concept under `experiments/`. It does not call the
Letter Archive API, modify the database, train a model, or integrate with review
flows. The original page files are read-only inputs. The only retained image
copies are explicitly bounded crops: the original three feasibility crops plus
20 stress crops totaling 1,535,505 decoded pixels. The largest stress crop is
386,400 pixels; no full page is copied.

The output is an **approximate semantic word envelope**, not an exact word or ink
boundary. Cleanup can select or edit ink, but it never supplies the final polygon.

The wrapper has no lexical or ownership model. Synthetic assessment therefore
separates `truth_target_mask`, `cleaned_selected_mask`, `semantic_neighbor_mask`,
and generic cleanup artifacts whenever those roles are available. Real examples
keep plausible neighboring handwriting separate from discarded ruling and threshold
noise. Polygon validity is reported separately from semantic assessment.

## Coordinate and determinism contract

- Crop geometry uses continuous pixel-edge XY coordinates. Crop bounds are
  `[0,width] x [0,height]`; pixel centers are `(column + 0.5, row + 0.5)`.
- Crop-to-source projection is an exact translation by the integer crop origin.
  Both 3x3 affine directions are recorded.
- Rings are rounded to 0.001 px, made counter-clockwise, rotated to a stable
  lexicographic starting vertex, and closed exactly once.
- Polygon JSON is canonical, contains no timestamps or timing data, and is hashed
  with a framed coordinate/quantization payload.
- Source bytes, crop PNG bytes and decoded RGB pixels, mask PNG bytes and canonical
  mask pixels, cleanup revisions, and polygons all have SHA-256 provenance.
- Rebuilding verifies that decoded crop pixels exactly match the recorded integer
  source-image region, not only that the two files have individually valid hashes.

## Direction estimate

Direction priority is explicit angle, then a supplied centerline, then ink PCA.
Centerline direction uses a length-weighted double-angle mean, so the result is
independent of endpoint direction. Curved writing still receives one global angle;
local tangent morphology is deliberately outside this POC.

## Approach A: morphological distance-field envelope

1. Rasterize an odd, centrosymmetric ellipse analytically at the writing angle.
   `along_bridge_px` and `cross_bridge_px` represent approximate maximum gaps;
   the footprint semi-axes are half those values.
2. Pad the mask, apply binary closing, and OR the original selected ink back in.
3. Compute the background Euclidean distance transform and threshold it at
   `padding_px`.
4. Fill holes and require exactly one 8-connected envelope region.
5. Extract the outer half-pixel contour.

No mask rotation or resampling is used. A 4096-cell footprint cap and projected RSS
reserve check reject large morphology requests before allocation.

## Approach B: oriented soft union

1. Expand a deterministic core around selected ink by `padding_px`.
2. Convolve it with a normalized oriented Gaussian. Bridge parameters map to
   Gaussian sigmas by `sigma = bridge / 2.355`.
3. Threshold the scalar field at `soft_threshold`, OR selected ink back in, fill
   holes, and require one 8-connected region.
4. Use the same contour and polygon pipeline as Approach A.

This approach joins sparse islands more readily, but the same property can create
an overly broad bubble. The threshold and bridge values therefore cannot be tuned
only for connectivity. Because the Gaussian is normalized, increasing its size can
lower local field values and disconnect a shape that a smaller kernel joined.

## Shared polygon post-processing

The outside contour is simplified with topology preservation, then smoothed with
closed-ring Chaikin corner cutting. Every candidate must remain one valid, simple
Polygon with no holes, remain inside the crop or supplied allowed boundary, and
cover all selected ink.

Smoothing uses a deterministic fallback ladder: requested simplification tolerance
down through successive halvings to zero, and requested Chaikin iterations down to
zero for each tolerance. Coverage is checked after final coordinate quantization.
Each selected ink pixel is tested at its center and four inset corners, preventing
a visually smooth curve from slicing through thin one-pixel support.

The engine also rejects disconnected results, empty or oversized masks, invalid
parameters, fewer than eight selected pixels, selected ink touching an unapproved
crop boundary, rough regions that fail to contain both ink and envelope, envelopes
consuming too much of the rough region, envelope/ink area ratios above 12, excessive
global or per-neighbor-component contamination (including one-pixel semantic marks),
and morphology or soft-union work unsafe for this POC.

## Cleanup replay tool

Connected components use 8-connectivity and stable IDs sorted by half-open bounding
box geometry. The CLI inventories IDs, areas, boxes, centroids, anchors, border
contact, and optionally all pixel coordinates. It supports ordered:

- component keep/remove;
- positive, restore, or negative polygons;
- positive, restore, or negative scribbles;
- narrow cuts followed by relabeling.

Every operation may require the exact input mask-pixel hash; replay logs both input
and output hashes. The final polygon is always generated from the resulting mask by
one of the two wrapping algorithms.

## Frozen real-word stress replay

`corpus/real-stress-v1.json` freezes 20 Collection 007/014 crops, source and crop
hashes, extraction profiles, cleanup operations, supplied orientation, method
profiles, neighbor masks, input validity, and visual assessments. Seventeen cases
contain an evaluable target; three invalid-input cases remain as diagnostic controls
and are excluded from scored totals. The assigned profile is chosen only from
observable source scale/orientation: large blue oblique writing or small gray
vertical writing. Individual cases cannot override bridge, padding, threshold, or
smoothing parameters.

The Collection 14 cleanup uses four hash-guarded corridor cuts before component
selection. Those cuts sever threshold components that otherwise connect a vertical
target to a neighboring word or crop edge; they are semantic mask edits, never final
polygon vertices. The replay aborts on any source, crop, or raw-mask hash drift, but
also fails closed if a labeled target mask overlaps its semantic-neighbor mask. A
known `EnvelopeError` is recorded as a method failure and replay continues; an
unexpected exception aborts the suite. Per-case diagnostics are emitted during the
serial replay. Only the aggregate summary and contact sheets are published after all
cases finish, and stale aggregate files are removed before replay begins. The summary
is the suite completion record: after an abort, per-case directories may be partial
and must not be consumed without a matching summary. Full atomic directory replacement
is intentionally outside this rapid POC. A small managed-case ownership index survives
an abort, allowing the next replay to prune both completed and abandoned generated
case directories before rebuilding them.

## Diagnostics and resources

`word-envelope-diagnostic.v2` records inputs, hashes, transforms, component
inventories, cleanup operations, requested/effective wrapping parameters, both
coordinate-space polygons, checksums, coverage, area, perimeter, vertex count,
background reduction, global and maximum per-component excluded-ink contamination,
assessment, and runtime versions. The ordinary wrapper uses
`word-envelope-failure.v2`; stress-replay method failures use
`word-envelope-stress-failure.v1` with the same input hashes and requested
parameters. Outputs are staged after geometry,
rendering, and final resource checks succeed; the diagnostic commit marker is
published last, and a publication error clears partial state. A new attempt clears
only known result-state files so stale success and failure records cannot coexist.
`word-envelope-wrap-summary.v2` calls these `geometry_successes` and records semantic
assessment plus `review_required` separately, so a broad partial polygon cannot be
mistaken for semantic approval.

The CLI warns when current plus reserved work projects to 300 MiB and rejects work
projecting to 450 MiB, leaving margin below the required 500 MiB ceiling. Masks,
crops, source provenance decodes, padded rasters, morphology footprints, soft-union
kernels/FFT workspaces, component inventories, exported coordinates, and gallery
dimensions are independently bounded. Examples and approaches run serially.

Byte determinism is tested within and across fresh processes in the recorded Python
environment. It is not claimed across arbitrary future versions of SciPy,
scikit-image, Shapely, Pillow, NumPy, or GEOS; every diagnostic records those runtime
versions so an environment can be reproduced.
