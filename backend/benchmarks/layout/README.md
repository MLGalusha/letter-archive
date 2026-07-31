# Layout benchmark

This directory defines the fixed source cohort used to compare document-layout
engines such as Kraken and Eynollah. The source images remain in backend
storage; the cohort records stable filename-derived identities, SHA-256
checksums, and encoded dimensions instead of copying images or depending on
database UUIDs.

The completed benchmark findings and production migration recommendation are
in [`RESULTS-2026-07-28.md`](RESULTS-2026-07-28.md).

## Cohort

`cohort.v1.json` contains one complete `L` record from each collection that
existed when the cohort was selected:

- six letters explicitly selected by the archive owner;
- one representative letter from each of the other eight collections;
- every page owned by each selected `L` record;
- 14 letters and 66 page images in total.

Companion `C`, `T`, `E`, `P`, or other sibling records are not silently
included. They can be added later as explicitly identified benchmark subjects.

The current database's `lineSegments` are intentionally not ground truth. They
are prior detector/editor output and cannot faithfully represent stable IDs,
orientation, or reading order.

## Image preparation

Manifest dimensions describe encoded source pixels before EXIF normalization.
Every detector must receive the same prepared input. A run must:

1. verify the source SHA-256;
2. apply EXIF orientation;
3. preserve the full source frame unless the shared preprocessing profile says
   otherwise;
4. record its encoded prepared-input SHA-256, canonical decoded RGB8 raster
   fingerprint, and dimensions.

The encoded SHA protects the exact PNG artifact. Cross-engine coordinate-space
comparisons use
`SHA-256("rgb8:<width>x<height>\n" + row-major RGB8 pixels)` so equivalent
pixels remain comparable when different platforms emit different PNG bytes.
Legacy immutable runs are not rewritten; the evaluator verifies their encoded
artifact and derives this fingerprint lazily.

This is especially important for the selected letters in collections 002, 012,
and 013, whose JPEGs use EXIF Orientation 6.

For `014-18780127-L01`, pages 2 and 3 show part of the neighboring physical
page. This is adjacent-page contamination, not bleed-through. Ground truth
should give the photographed target page its own boundary and mark the
neighboring-page sliver as a `foreign_page` exclusion region. Lines detected in
that sliver should count as out-of-target detections rather than successful
recall. Pages 1 and 4 contain real 90-degree marginal notes that should retain
their orientation and reading-order relationship instead of being ignored.

## Challenge tags

Tags describe known evaluation challenges, not exhaustive ground truth:

- `ordinary-horizontal`
- `dense-handwriting`
- `faint-ink`
- `bleed-through`
- `adjacent-page-text`
- `background-clutter`
- `skewed-page`
- `curved-lines`
- `marginalia`
- `sideways-text`
- `vertical-text`
- `multi-column`
- `mixed-image-and-text`
- `low-resolution`
- `cropped-text`
- `typed-text`
- `strikeovers`
- `sparse-page`
- `ruled-paper`
- `folded-paper`
- `printed-letterhead`
- `exif-orientation`

Empty tag arrays mean that the page has not yet received page-level challenge
annotation. They do not imply an easy page.

## Ground truth and detector runs

Provider-neutral page annotations belong under:

`ground-truth/<page-key>.layout.v1.json`

Detector output must stay out of the tracked cohort:

`backend/test-results/layout-benchmark/runs/<run-id>/`

A run should retain raw provider output, normalized layout JSON, overlays,
engine and model versions/checksums, configuration, preprocessing metadata,
runtime, memory use, and source/prepared checksums. Evaluation results should
be stored separately so the same immutable run can be rescored as annotations
improve.

## Running the benchmark

Run commands from `backend/`:

```sh
npm run benchmark:layout -- list-pages --scope full
npm run benchmark:layout -- setup --engine kraken7
npm run benchmark:layout -- setup --engine kraken7-orli
npm run benchmark:layout -- preflight --engine kraken7-orli-cpu
npm run benchmark:layout -- preflight --engine kraken7-orli-cpu-cap128
npm run benchmark:layout -- preflight --engine all
npm run benchmark:layout -- run --engine kraken6 --scope full
npm run benchmark:layout -- run --engine kraken7 --scope full
npm run benchmark:layout -- run --engine kraken7-orli --scope full
```

Each page runs in a fresh isolated process (or, for Eynollah, a fresh
container). Therefore `engineMs`, CPU, and peak RSS describe **cold per-page**
execution. Kraken additionally records provider model-load and inference
timings. Eynollah cannot expose that split without patching upstream internals,
so those fields remain null. Do not interpret these measurements as
persistent-worker or batched throughput; that requires a separate benchmark
with models kept resident.

## Kraken rotation diagnostics

The `kraken7-rot4-union`, `kraken7-rot4-consensus`,
`kraken7-rot3-zones`, and `kraken7-rot3-safe-zones` profiles are non-ranked
experiments under the
`native-and-source-projected-v2` evidence contract. Each rotation-pass record
keeps two distinct segmentation objects:

- `nativeSegmentation` is an untouched serialization in that rotated input's
  own pixel coordinates;
- `sourceProjectedSegmentation` is a separate deterministic projection into
  prepared-image coordinates using the named
  `pil-pixel-centers-to-source-v1` transform.

The record also identifies both coordinate-space dimensions, pass status,
strict/fallback attempts, and fallback outcome. Partial and failed pass geometry
remains raw evidence only and can never contribute a displayed proposal.
Baseline-plus policies fail the page unless the 0-degree pass fully succeeds.
Added nonzero-rotation proposals deliberately have unresolved reading order;
only retained 0-degree lines preserve provider order.

`baseline-plus-vertical-zones` is a spatial recall heuristic, not a
cross-rotation consensus rule. Two nearby strong vertical hypotheses from one
fully successful 90- or 270-degree pass may establish a zone, after which
nearby shorter hypotheses from fully successful passes can be included. Raw
selection evidence records the successful rotations contributing to every
zone. This is intentional because useful sideways writing may appear in only
one upright rotation, but it also means borders or neighboring-page artifacts
can form a false zone. The profile must remain diagnostic and requires visual
review across the fixed cohort before any production design is considered.

`baseline-plus-nonoverlapping-vertical-zones` adds a conservative
horizontal-interference gate to that policy. A rotated vertical proposal is
displayed only when it belongs to a supported vertical zone and does not
substantially cross retained 0-degree handwriting. It keeps the native
0-degree result intact, adds only the spatially justified rotated geometry,
and records every acceptance or rejection in `raw.json`. It is still a
diagnostic heuristic, not learned reading order or ground truth.

The exact four-pass ablation uses one immutable 0/90/180/270-degree source run
and derives five policies from those same provider results:

- three-pass raw union, cross-rotation consensus, and safe vertical zones use
  only 0/90/270;
- four-pass consensus and safe vertical zones additionally admit the
  180-degree evidence.

The source-run projection adapter validates and snapshots the entire immutable
source run before deriving a result. A source run may be terminal with
explicit page failures, but any requested failed page fails closed in the
derived run. Non-terminal source states, invalid manifests, artifact drift,
pixel-identity mismatches, and missing pass evidence stop preflight.

## Orli precision and geometry contract

The primary `kraken7-orli` profile is pinned to Apple MPS and
`bf16-mixed`. This is a correctness requirement, not a performance tuning
choice: the [Orli model documentation](https://github.com/mittagessen/orli#model)
states that the published base model only works in bfloat16 and that other
precisions are likely to cause runaway generation. Any earlier local output
created with `32-true` is invalid configuration evidence and must not be used to
judge Orli's line or reading-order quality. Results from this profile are also
hardware- and precision-specific; a cloud CUDA comparison needs its own hashed
profile with `device: cuda:0` and the same `bf16-mixed` precision.

The valid MPS/bfloat16 quality smoke is non-viable: set 14 page 1 ran into the
768-line ceiling, while page 2 produced 105 lines with duplicated and missed
geometry. `kraken7-orli-cpu` changed only the device to CPU, retaining
`bf16-mixed`, the same pinned environment and model, `polygonize: false`, and
the generation guard. CPU diagnostics repeated the failure: set 14 page 1 and
an ordinary collection 001 control page hit the 128-line ceiling, while set 14
page 2 returned 109 similarly duplicated and missed lines. The published Orli
base model is therefore not a viable drop-in candidate for this archive. This
does not rule out future domain fine-tuning.
Run `kraken7-orli-cpu-cap128` first: it uses the same CPU/bfloat16 runtime but
fails at 128 predicted lines, cheaply identifying another runaway before the
768-line CPU profile is allowed to proceed. Like the MPS cap-128 profile, it is
a deliberately non-equivalent diagnostic and cannot be ranked as a quality
candidate.

Preflight resolves the configured device and precision through the installed
Kraken/Lightning runtime, rejects drift, and records both the observed runtime
evidence and the hashed engine configuration in the run manifest. The long-lived
768-line generation ceiling remains a safety guard: reaching it fails the page
as truncated. The
`kraken7-orli-cap128` profile uses the same MPS/bfloat16 settings but remains a
non-equivalent diagnostic ceiling, not a quality candidate.

Orli natively returns ordered baseline polylines. The primary profile keeps
`polygonize: false` so provider quality is not confounded by Kraken's separate
polygonizer. Because the common benchmark schema, exclusion checks, and review
canvas require a boundary, normalization derives a narrow deterministic
baseline corridor with a half-width of 0.25% of the prepared image long edge
(rounded, minimum 1 pixel). Provenance labels it `baseline-envelope`, and a
warning explicitly states that it is not a provider-predicted line polygon.
Line matching uses the native baselines whenever both sides provide them.

The orchestrator writes to a hidden staging directory, validates the completed
manifest and every referenced artifact against the authoritative TypeScript
schemas and integrity checks, and only then atomically publishes
`runs/<run-id>/`. One page failure is retained as a measured page result and
does not abort the remaining cohort.

Eynollah 0.9.0 full-layout mode requires roughly 6.0 GiB for its five
persistent model workers before Python, OpenCV, input-image, and output
overhead. Its preflight therefore refuses to run on the local Docker VM's
roughly 4 GiB memory allocation. Use a container with at least 8 GiB, on a host
with at least 16 GiB, rather than treating an out-of-memory termination as a
detector-quality result. The pinned base-image digest is a multi-architecture
OCI index with both `linux/amd64` and `linux/arm64` images. Eynollah builds and
runs on the Docker server's native architecture, records the inspected image
platform and digest, and rejects a mismatched image instead of silently using
CPU emulation.

The accepted model-bundle 0.9.1 CPU cloud run completed 65 of 66 pages and
reached about 7.74 GiB maximum container memory. Its line output is not viable:
36 successful pages contained no lines, and its nonzero polygons were often
small word/blob fragments. Its physical-page boundary remains promising as an
optional mask before Kraken; set 14 page 2 correctly excluded the neighboring
visible page. See the results document for the complete evidence and limits.

## Eynollah-boundary composition diagnostic

`kraken7-eyno-boundary-filter` is a local, source-run-driven composition
diagnostic. It performs no Eynollah, Kraken, cloud, database, or production
inference. Its configuration binds two immutable benchmark runs by run ID,
expected engine ID, and manifest checksum:

- `lineGeometry` supplies a normalized line layout. The initial profile uses
  `kraken7-blla-v2-full-20260728`, but another immutable line run, including a
  multi-orientation Kraken run, can use the same adapter through a distinct
  hashed engine configuration.
- `pageBoundary` supplies Eynollah's exact provider-predicted physical-page
  boundary from `eynollah-v091-full-no-cl-cloud-20260728`.

Preflight authoritatively validates both source runs, verifies every consumed
source artifact against its manifest, and compares decoded
`sha256-rgb8-v1` raster identity and dimensions. Encoded PNG checksums are not
used for cross-run equality because equivalent prepared pixels can have
different PNG encodings. Missing source artifacts, mismatched pixels, a
`PAGE_BOUNDARY_UNAVAILABLE` warning, or a failed source page fail closed; the
adapter never substitutes the image frame. Consequently, a full composition
using the accepted Eynollah run must retain its failed
`003-18880810-L01-03` page as one explicit derived-page failure.

For each source line, the adapter samples the provider-native baseline at
four-pixel spacing, falling back only to a provider-native polygon boundary.
Points exactly on the Eynollah boundary count as inside. A line enters the
display projection only when its inside ratio is strictly greater than 0.5.
Provider-derived substitute geometry is preserved as evidence but excluded.
No included geometry is clipped, averaged, sorted again, or flattened.

Every page's `raw.json` retains both exact source normalized layouts and every
line's original geometry/provenance, sample counts, inside ratio, threshold,
decision, projected ID or null, and exact reason. The strict
`normalized-layout.v1.json` contains only included lines, their consistently
filtered owning regions, and the exact Eynollah boundary so the existing
Layout Lab can render it. Source manifests, consumed normalized layouts, and
source-page error artifacts are copied into the derived run's normal
checksummed source snapshot. Source runs are never mutated.

This is adapter-enforced experimental evidence under the immutable v2 run
contract. Manifest v2 validates all snapshotted bytes and standard artifact
identity, but does not independently type or cross-validate derivation roles.
That limitation is recorded in the engine config, raw evidence, and normalized
warnings. The profile declares `equivalentToDefaultProfile: false`, so it is
inspectable in Layout Lab but cannot receive human quality-ranking decisions.
It is not ground truth, a production PageLayoutV2, or a detector that may be
promoted without full-cohort visual evidence and a stronger typed contract.

Run it from `backend/` after both bound source runs validate:

```sh
npm run benchmark:layout -- preflight --engine kraken7-eyno-boundary-filter
npm run benchmark:layout -- run --engine kraken7-eyno-boundary-filter --scope full
```

## Eynollah page-mask → Kraken diagnostics

Four source-bound profiles test Eynollah and Kraken as complementary stages
without changing either model:

- `kraken7-eyno-mask-p0` uses the exact Eynollah physical-page contour;
- `kraken7-eyno-mask-p16` expands that contour by 16 Chebyshev pixels to
  protect ink near a slightly conservative predicted edge;
- `kraken7-rot3-eyno-mask-p0` applies the exact contour before the canonical
  0/90/270-degree Kraken diagnostic;
- `kraken7-rot3-eyno-mask-p16` applies the same 16-pixel mask in canonical
  coordinates, then runs the existing Kraken 0/90/270-degree
  `native-and-source-projected-v2` diagnostic over that masked image.

Two source-projected profiles then apply
`baseline-plus-nonoverlapping-vertical-zones` to the immutable p0 and p16
multi-rotation source runs:

- `kraken7-rot3-eyno-mask-p0-safe-zones`;
- `kraken7-rot3-eyno-mask-p16-safe-zones`.

This separation is deliberate: Eynollah decides which physical-page pixels
reach Kraken; Kraken alone supplies every displayed line; and the deterministic
projection policy decides whether a nonzero-rotation proposal is safe to add.
The two safe projection configs explicitly declare the
`copy-and-bind-v1` source-evidence contract. The adapter verifies the source
manifest and raw bindings, freezes all three source artifacts, copies their
exact bytes into the derived page, and promotes the verified input stage into
the derived raw record. Consequently the normalized Eynollah boundary and the
Page mask, Masked engine input, and Mask provenance links remain available in
Layout Lab; a missing, changed, or cross-bound artifact fails closed.

The four model-inference profiles bind the immutable
`kraken7-blla-v2-full-20260728` run as the unmasked control and
`eynollah-v091-full-no-cl-cloud-20260728` as the page-boundary source,
including exact manifest checksums. The two safe projections bind the
resulting immutable masked rotation runs. Preflight validates every direct
source run and decoded prepared-raster identity. A failed or
`PAGE_BOUNDARY_UNAVAILABLE` source page fails closed; no frame fallback is
silently treated as a prediction.

The canonical `prepared.png` remains unchanged. Each attempted page separately
records:

- `page-mask.png`: an L8 mask where 255 retains pixels and 0 excludes them;
- `engine-input.png`: the identity-sized RGB image Kraken actually receives,
  with excluded pixels replaced by opaque white;
- `input-stage.v1.json`: algorithms, coordinate contract, source identities,
  hashes, pixel counts, encoder identity, and mask/input artifact hashes;
- `raw.json`: Kraken provider evidence plus both exact source layouts,
  source-run bindings, the unmasked-control projection, and the same
  input-stage evidence.

`inputStageMs` measures source verification, deterministic rasterization,
masking, encoding, and artifact writes separately from provider model-load and
inference timings. The normalized layout uses Eynollah only for the physical
page boundary; every displayed line remains Kraken geometry. These profiles
declare `equivalentToDefaultProfile: false` and `rankable: false`, so they are
visual/measurement diagnostics and cannot receive saved quality verdicts.

Preflight the profiles from `backend/` before any run:

```sh
npm run benchmark:layout -- preflight --engine kraken7-eyno-mask-p0
npm run benchmark:layout -- preflight --engine kraken7-eyno-mask-p16
npm run benchmark:layout -- preflight --engine kraken7-rot3-eyno-mask-p0
npm run benchmark:layout -- preflight --engine kraken7-rot3-eyno-mask-p16
npm run benchmark:layout -- preflight --engine kraken7-rot3-eyno-mask-p0-safe-zones
npm run benchmark:layout -- preflight --engine kraken7-rot3-eyno-mask-p16-safe-zones
```

Run directories are immutable once their staging directory is renamed into
`runs/`. The API validates each manifest, every referenced artifact path, the
actual encoded `prepared.png` checksum and dimensions, and overlay dimensions
before caching the run.

Reviewer decisions are stored outside the production database:

`backend/test-results/layout-benchmark/evaluations/<admin-id>.evaluation.v1.json`

Each page comparison records a shared preference, confidence, elapsed review
time, and separate left/right flags and repair counts so error burden remains
attributable to an engine. A positive timed review is required, each
page/run-pair verdict is write-once, and the UI keeps identities and
provider-specific warnings hidden until that verdict is saved. Diagnostic
profiles whose configuration declares `equivalentToDefaultProfile: false`
remain inspectable but cannot be written into human quality rankings. Writes
use temporary files, fsync, and atomic rename.

## Local evaluation API

Authenticated JSON routes are mounted at `/admin/layout-benchmark`. Prepared
images, overlays, and frozen source scans use cookie-authenticated
`/images/layout-benchmark` URLs so they can be rendered directly by the Admin
UI without putting bearer tokens in image URLs.

The API is enabled outside production. In production it returns 404 unless
`LAYOUT_BENCHMARK_ENABLED=true` is explicitly set.

The Admin `Layout Lab` route/navigation is enabled automatically by Vite in
local development. A production frontend also requires
`VITE_LAYOUT_BENCHMARK_ENABLED=true`; enable both flags together so the UI
cannot advertise a benchmark API that the backend intentionally hides.

Scorecards distinguish:

- accuracy against complete human ground truth;
- cross-provider agreement proxies where ground truth is absent;
- incomparable pages whose decoded prepared rasters, preprocessing profiles,
  or dimensions differ;
- missed, spurious, split, merged, orientation, and reading-order outcomes;
- ordinary-region precision/recall/F1 and class agreement, with
  `foreign_page` exclusions scored separately;
- page-boundary polygon IoU using deterministic cell-center rasterization at a
  256-pixel prepared-image long edge;
- unavailable provider page boundaries, including Kraken's explicit
  `PAGE_BOUNDARY_UNAVAILABLE` image-frame fallback, as null evidence excluded
  from boundary means rather than perfect frame predictions;
- foreign-page line and region outcomes;
- engine failures, successful/failed duration distributions, stage timings,
  memory measurement methods and caveats;
- reviewer preference, per-engine flags and repair counts, and median/p95
  review time.

Geometric tolerance is scaled per page from a 1600-pixel prepared-image long
edge. Every page score records the effective pixel tolerance so differing scan
resolutions do not silently change the standard.
