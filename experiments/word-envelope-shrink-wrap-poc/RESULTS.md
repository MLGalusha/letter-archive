# Results

## Verdict

The geometry is useful, deterministic, and bounded, but it is not a semantic word
detector. Tight morphology works well when a cleaned word has a consistent direction
and moderate gaps. Soft union handles larger gaps and curvature, but it is broader
near neighboring ink. A valid polygon must therefore be treated as a geometry result,
not proof that the correct word was selected.

The safe recommendation from this POC is:

- consider tight morphology only after independent ink ownership is established and
  all semantic-neighbor and quality gates pass; agent-owned masks are not currently
  eligible for automatic acceptance;
- route soft-union-only results to review;
- reject disconnected, clipped, contaminated, or excessively broad results;
- never infer missing or foreign ink from geometry alone.

The detailed failure families and measured boundaries are in `LIMITS.md`.

## Visual evidence

- `artifacts/stress-real/gallery-method-comparison.png`
- `artifacts/stress-real/gallery-six-panel.png`
- `artifacts/real/gallery-method-comparison.png`
- `artifacts/real/gallery-six-panel.png`
- `artifacts/synthetic/gallery-method-comparison.png`
- `artifacts/synthetic/gallery-six-panel.png`
- `artifacts/limits/sweep-grid.png`
- `artifacts/limits/gallery-adversarial.png`

## Synthetic feasibility suite

Ten deterministic cases cover horizontal, 23° slanted, curved, disconnected,
detached-mark, ascender/descender, nearby-neighbor, touching-word cleanup,
sparse-multi-island, and faint-stroke restoration behavior.

- Soft union produced valid geometry in all 10 cases.
- Morphology produced valid geometry in 8; it safely rejected the strongly slanted
  and sparse multi-island cases rather than dropping components.
- The sparse soft result remains `partial`: background reduction is 70.6% but its
  envelope/ink ratio is 9.88, inside the proposed review band.
- Every accepted polygon has 100% selected center and five-point pixel-support
  coverage.
- The touching-word case uses the complete raw-but-removed mask and records 1.05%
  morphology / 2.82% soft-union support contamination rather than reporting a
  misleading zero.

These shapes test topology and safeguards. They are simplified glyph primitives,
not a handwriting accuracy corpus.

## Failure characterization

The limit suite records 170 deterministic outcomes: 82 valid, 6 review-broad,
15 contaminated, 54 disconnected, 9 guard failures, and 4 semantic false successes.
Those counts are not an accuracy rate; the suite intentionally pushes each fixed
configuration across its boundary.

At the recorded scale and parameters:

| Stress variable | Morphology | Soft union |
|---|---:|---:|
| Inter-letter gap | valid through 28 px; fails at 32 | valid through 40 px; fails at 48 |
| Detached-mark gap | valid through 15 px; fails at 20 | valid through 25 px; fails at 30 |
| Curvature amplitude | valid through 50 px; fails at 60 | valid through 80 px; fails at 90 |
| Supplied-angle error | valid through 10°; fails at 15° | valid through 20°; fails at 25° |
| Known-neighbor clearance | clean from 4 px | clean from 18 px |
| Fixed parameters after scale-up | fails at 2x and 3x | fails at 2x and 3x |

Short/tall PCA is unstable: the estimated direction moves from 90° for three stems,
to 45.64° for four, to 0° for five. A remote-mark sandwich has no safe global
setting: once it connects, it captures the known intervening neighbor. Increasing a
soft bridge is also non-monotonic; bridge 80 succeeds at threshold 0.18 while 85
disconnects, and lowering the threshold reconnects only as review-broad geometry.

Most importantly, both methods generate confident false successes when cleanup
omits a true dot or retains a connected second word. The real replay also shows why
crop validity has to be checked before geometry is scored: clipped targets can still
produce plausible polygons around the visible fragment. See `LIMITS.md` and the
adversarial galleries for the product implications.

## Messy real-word stress replay

A frozen development corpus now exercises 20 difficult crops from Collections 007
and 014 with two methods per crop. It includes the sideways `P.S.` / `Did` island,
detached punctuation, folds, faint pencil, narrow vertical words, and multi-word
vertical phrases. Seventeen crops contain an evaluable target; three objectively bad
inputs are retained as visible diagnostic controls but are not scored. The assigned
wrapping profile is chosen from observable source scale and orientation; individual
cases cannot override bridge, padding, threshold, or smoothing parameters. Target
cleanup is still human-authored, so this is a stress replay, not a held-out accuracy
estimate.

- Across the 17 evaluable cases, 20 of 34 method attempts produced geometrically
  valid polygons and 14 safely rejected disconnected, contaminated, or out-of-region
  masks.
- Twelve of 17 evaluable cases had at least one geometrically valid method. Ten had
  at least one human-approved result, two had only review-required partial results,
  and five had no usable result.
- Human review labeled the 34 evaluated attempts as 12 successes, 8 partials, and
  14 failures. Geometry validity is intentionally reported separately.
- The three invalid-input controls contribute six diagnostic-only attempts: three
  produced geometry and three rejected. None affects the evaluation totals.

The requested examples are covered directly:

| Target / method | Assessment | Selected support | Background reduction | Envelope / ink | Neighbor contamination |
|---|---|---:|---:|---:|---:|
| `P.S.` / morphology | disconnected failure | — | — | — | — |
| `P.S.` / soft union | success; includes both periods | 100% | 83.6% | 7.98 | 0% / 0% |
| `Did` / morphology | disconnected failure | — | — | — | — |
| `Did` / soft union | partial; review required | 100% | 86.1% | 6.57 | 2.10% / 24.61% |
| `We will` / morphology | partial; scalloped edge | 100% | 86.0% | 4.96 | 0% / 0% |
| `We will` / soft union | success, vertical | 100% | 78.9% | 6.95 | 0.04% / 2.13% |

`P.S.` and `Did` need soft union because their selected strokes and punctuation are
too fragmented for the assigned morphology profile. `Did` is close to the 25%
per-neighbor-component contamination cap, so it remains review-only rather than
silently auto-accepted. `P.S.` is a human visual success, but its 7.98 area ratio is
only 0.02 below the proposed auto-pass ceiling and the soft-only product policy would
still route it to review. For the 90-degree `We will` phrase, morphology is connected
but visibly scalloped; soft union expands along the vertical writing axis and is the
approved result. Regression tests prove that 90°, -90°, and 270° canonicalize
identically and that the same fixture fails when incorrectly wrapped horizontally.

The corrected vertical targets at the top of Collection 14 also establish the
useful boundary: morphology succeeds on `with a`, `letter`, and `would`; both methods
succeed on `table`; and morphology succeeds on `over`. The broader soft results for
`letter`, `would`, and `over` remain partial. Semantic-neighbor truth is available
for `table` and `over`, but not for `with a`, `letter`, or `would`, so those three
cannot claim a measured zero-contamination result.

Other approved results are `I Love` with both methods, `Think` with soft union, and
`Come` with soft union. `good` has only partial results. `Love you`, `a few`,
`dropped`, `big fat`, and `gobbler` have no valid geometry under either method with
their assigned profile. `Cabbage` and `Seed` are clipped crops, while the fold
fragment has no trustworthy single-word target; all three are labeled
`INVALID INPUT, NOT SCORED` in the galleries.

Exact frozen inputs, operations, hashes, and assessments are in
`corpus/real-stress-v1.json`; generated outcomes and measurements are in
`artifacts/stress-real/summary.json`. The method-comparison gallery preserves every
per-method rejection, while the six-panel gallery shows the best valid diagnostic
method for each row.

## Original three real examples

The three real examples use independent masks for selected target ink and plausible
semantic-neighbor handwriting. Generic ruling, stains, and threshold debris remain
in a separate cleanup-discard mask so they cannot dilute the neighbor metric.

`neighbor contamination` below reports global five-point support capture followed
by the maximum capture of any independently labeled neighbor component.

| Target / method | Assessment | Selected support | Background reduction | Envelope / ink | Neighbor contamination | Area px² | Vertices |
|---|---|---:|---:|---:|---:|---:|---:|
| `mountain` / morphology | success | 100% | 83.1% | 4.15 | 0.09% / 1.73% | 6,979 | 304 |
| `mountain` / soft union | success, broader | 100% | 73.8% | 5.88 | 0.50% / 7.75% | 9,878 | 132 |
| `Sincerely,` / morphology | disconnected failure | — | — | — | — | — | — |
| `Sincerely,` / soft union | partial, review required | 100% | 58.1% | 5.63 | 1.51% / 3.84% | 45,170 | 292 |
| `haven't` / morphology | success | 100% | 77.2% | 2.66 | 0% / 0% | 15,724 | 280 |
| `haven't` / soft union | success | 100% | 75.4% | 2.79 | 0% / 0% | 16,507 | 244 |

`Sincerely,` stays partial because one global direction cannot follow the curved
signature tightly and its 58.1% background reduction misses the proposed 65%
auto-pass bar. The result is geometrically valid; that is precisely why geometry
validity and semantic assessment are stored separately.

Every accepted polygon is simple, hole-free, inside its crop and rough region, and
round-trips between crop and source coordinates with measured 0.0 px error.

## Source provenance

| Target | Source SHA-256 | Exact crop `(x,y,w,h)` | Crop SHA-256 |
|---|---|---|---|
| `mountain` | `1ac198ce711cf57c1525d1a7d08182ee253f2dcf43c4b9b10d30840ff9ad6af6` | `(100,160,450,220)` | `592e71ed27e771836d4363f3d15c29738fc9af545be765247d1a39f6b3975131` |
| `Sincerely,` | `ee7b45b66c28464bcf7618bf9ebb194a1ca53a6588a0120a2afd84158a0bfb09` | `(1550,1500,700,450)` | `9fae421ce07924d05c043e8cde6531df1bd7579fd483e47a599aadfb97b65acf` |
| `haven't` | `869570d8217947612cbb0b5363342bf7f413bcad3587f1941dc3ebfd3b293d5e` | `(900,2450,600,280)` | `5001067317f38821790b897fe6712af00b8efb7f1808dcca99b46b852921a19a` |

The 014 source has WebP content despite its `.jpg` extension. Provenance validation
checks source bytes and dimensions, crop bytes and decoded pixels, the exact decoded
source region, integer translation metadata, masks, and canonical polygons.

## Cleanup effort and evaluation caveat

No external LLM was called for these original three geometry examples. Their cleanup
used stable numbered components and one hash-guarded `keep_components` operation per
real example:

- `mountain`: kept 2 of 80 raw components, 1,681 of 8,195 extracted pixels;
- `Sincerely,`: kept 4 of 10, 8,020 of 14,461 pixels;
- `haven't`: kept 2 of 10, 5,918 of 10,517 pixels.

Parameters were manually tuned on these same three examples, and the exploratory
attempt history is not complete. They demonstrate feasibility, not held-out
accuracy. A line-level component-to-token assignment would reduce the ambiguity and
manual effort seen in the crowded `mountain` crop.

The 20-case stress corpus starts from 735 raw connected components and retains 182
components after its target-specific cleanup recipes (median 31.5 raw and 5.5 cleaned;
maximum 123 raw and 55 cleaned). Collection 14 cases also use four hash-guarded
corridor cuts before stable component selection because thresholding connects faint
vertical writing to neighboring ink and crop edges. Shared extraction and wrapping
profiles are frozen, but case selection, cleanup, and visual assessments were done
during development. These results characterize difficult examples; they do not
measure generalization.

## Agent-first ownership experiments

The follow-on ownership pilot tests whether Terra or Sol can assign the connected
components before the deterministic wrapper runs. Across a nine-case matched V2
pilot and a ten-case messy V3 expansion, Sol completed more hard first-turn claims
than Terra but still produced confident incomplete and over-large selections. On
the V3 messy red-only cohort, Terra recorded 2 strict passes and 6 false accepts;
Sol recorded 3 strict passes, 3 false accepts, and correctly deferred the clipped
invalid `Cabbage` input.

The strongest workflow result was multi-turn cleanup: after five sealed-safe Terra
exclusions were replayed into fresh task states, Terra made four pixel-exact claims
and deferred one. A fresh Sol pass on those same states made four strict claims but
also falsely over-selected vertical `We will`. Candidate-aware critics did not fix
the semantic errors: a Sol critic retained all three false V3 claims, and a Terra
critic damaged an exact `Love you` claim. A Sol before/after reviewer also approved
an unsafe `Seed` exclusion.

The software layer is now hash-bound, versioned, replayable, and capable of
truth-free exact action agreement and conservative add/remove risk challenges. The
current verifier deliberately escalates aggressively and is not approved for
auto-acceptance. Exact per-case results, caveats, artifacts, and the provisional
Terra/Sol/human routing policy are in `AGENT_WORKFLOW_RESULTS.md`.

## Determinism and tests

All 113 focused `unittest` cases pass. Coverage includes fresh processes with two
`PYTHONHASHSEED` values, byte-identical repeated polygon records, cleanup hash replay,
source/crop provenance mismatch and overwrite rejection, crop/source transforms,
explicit mask polarity, finite/integer parameter validation, semantic-neighbor gates,
one-pixel per-component anti-dilution, border and tiny-ink guards, rough-region
containment, pre-allocation morphology/FFT limits, vertical-angle equivalence, frozen
stress-profile and explicit input-validity checks, hash-drift rejection,
target/neighbor overlap rejection, stale assessment correction, stale case-output
pruning, failure continuation, byte-identical stress replay, bound agent actions,
public-only staging, multi-turn exclusion lineage, candidate/version review,
internal verifier-state binding, counterfactual risk checks, and exact action
agreement.

The canonical `mountain` morphology polygon checksum is
`8f45482adb3c566051135b11afe57b767f7d4fa480cac03b91fa9091df8b0247`;
its polygon JSON file hash is
`0241f7d6bc1f46a154d7dfa053a627de7bec2bd5cd32c4c9e5120edcbdf51b4b`.

Determinism is guaranteed for the recorded runtime and inputs, not across arbitrary
future dependency versions. Diagnostics record Python, NumPy, Pillow, SciPy,
scikit-image, Shapely, and GEOS versions.

## Runtime observation

One noncanonical five-run benchmark recorded these median core wrapping times on the
development machine:

| Example / method | Median |
|---|---:|
| `mountain` morphology | 31.7 ms |
| `mountain` soft union | 13.3 ms |
| `Sincerely,` soft union | 46.7 ms |
| `haven't` morphology | 289.6 ms |
| `haven't` soft union | 27.6 ms |

This looks interactive for one bounded word crop, but it is not an end-to-end
throughput or batching benchmark. Semantic cleanup and ink ownership are likely the
bottleneck, and line-level component assignment appears preferable to launching a
full crop/provenance/render cycle per word; that batching design remains untested.
Timings stay outside deterministic diagnostics and are recorded separately in
`artifacts/runtime-benchmark.json`.

## Resources and incident

The CLI warns when current plus reserved work projects to 300 MiB and stops before
450 MiB, leaving margin below 500 MiB. The final synthetic suite peaked at about
193 MiB RSS, the final limit suite at about 186 MiB, and the 20-case stress replay at
about 340 MiB; all ran serially. The stress crops total 1,535,505 decoded pixels and
the largest is 386,400 pixels.

One early exploratory `Sincerely,` morphology setting (`along=120`, `cross=100`)
allocated about 1.0 GiB inside SciPy before the original post-stage guard could
abort. That violated the experiment ceiling. Its success-looking files were removed,
and only a v2 failure plus incident record remain under
`artifacts/real/sincerely/unsafe-morphology-attempt/`.

The remediation is a 4,096-cell morphology-footprint cap, soft-kernel/FFT caps,
projected-memory reserve checks before allocation, staged commit-marker publication,
stale-state cleanup, and regression tests. No accepted result uses the unsafe
setting.

## Next experiment

Evaluate a new 20–30-word held-out cohort from pages and collections not used to
choose the stress profiles or cleanup recipes. Stratify it by short/tall tokens,
detached marks, curved signatures, crowded neighbors, folds, and scan scale. Prepare
independent truth-target and semantic-neighbor masks, apply the frozen parameter
policy, add perturbation and scale-equivalence checks, and collect human “correct
hover region” ratings. That independent study—not further tuning on the 23 development
examples—should decide whether this belongs in the review flow.
