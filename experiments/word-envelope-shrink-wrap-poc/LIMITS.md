# Operating Limits

## Bottom line

The algorithms do not understand words. They create geometry around the ink in a
cleaned mask. If cleanup omits a dot or retains part of the next word, both methods
can return a perfectly valid polygon around the wrong semantic group. Geometry can
reject many unsafe cases, but it cannot prove word ownership without independent
target and neighbor evidence.

The deterministic characterization is in:

- `artifacts/limits/summary.json` — exact masks, hashes, parameters, outcomes, and
  measurements;
- `artifacts/limits/sweep-grid.png` — pass/review/failure boundaries;
- `artifacts/limits/gallery-adversarial.png` — semantic false successes and guarded
  failures.

The pixel values below are calibration results for the recorded synthetic shapes
and fixed parameters. They are not universal constants and must scale with scan
resolution and stroke geometry.

## Measured fixed-parameter boundaries

| Stress variable | Morphology | Soft union | First important limit |
|---|---:|---:|---|
| Inter-letter gap | valid through 28 px | valid through 40 px | disconnected at 32 / 48 px |
| Detached-mark gap | valid through 15 px | valid through 25 px | disconnected at 20 / 30 px |
| Curvature amplitude | valid through 50 px | valid through 80 px | disconnected at 60 / 90 px |
| Supplied-angle error | valid through 10° | valid through 20° | disconnected at 15° / 25° |
| Known-neighbor clearance | clean from 4 px | clean from 18 px | closer results capture neighbor ink |
| Same mask enlarged with fixed pixel parameters | valid at 1x | valid at 1x | both disconnect at 2x and 3x |

Soft union reaches larger gaps and curvature, but its bubble stays wider near other
ink. In the clearance sweep, morphology captured a known neighbor at 0–2 px while
soft union captured it through 14 px. The normal contamination gate would reject
those outcomes.

## Word shapes most likely to fail

- Very short or tall words such as `I`, `i`, `ill`, initials, and narrow abbreviations.
  PCA direction changed from 90° to 45.64° to 0° as the synthetic stem count changed
  from three to five. Morphology passed one and four-or-more stems but disconnected
  at two and three; soft union stayed connected but that does not prove correctness.
- Words with remote dots, apostrophes, accents, or crossbars. If neighboring ink lies
  between the word body and the mark, there may be no safe global bridge setting.
- Curved signatures and S-shaped baselines. One global angle cannot follow local
  tangents; `Sincerely,` is the real example of this limit.
- Words with large or uneven internal gaps, broken strokes, widely spaced capitals,
  or hyphens. Increasing the bridge can connect a neighboring word before it joins
  the intended component.
- Ascenders, descenders, swashes, underlines, and closed flourishes. Outliers can
  dominate PCA; a hole-free envelope must include any foreign ink enclosed by a
  target loop.
- Touching words, corrections, and crossed-out text. A cleanup cut can remove real
  target pixels or retain foreign pixels, and the wrapper cannot recover the intent.
- Tiny, faint, clipped, or low-resolution writing. Missing mask pixels are invisible
  to the geometry; border-touching ink is deliberately rejected and requests a
  larger crop.
- Mixed scan scales. Bridge and padding values are pixels, so unchanged parameters
  failed the same topology at 2x and 3x scale.

## Non-monotonic behavior

“Increase the bridge until it connects” is not a safe tuning strategy. A normalized
Gaussian spreads the same total mass over a larger kernel. In the recorded U-shaped
soft-union sweep, threshold 0.18 was valid for bridge values 40–80 but disconnected
again at 85. Lowering the threshold to 0.12 reconnected every value, but every result
became review-broad with envelope/ink area ratios from 9.58 to 11.31.

The remote-mark sandwich is a stronger semantic conflict. Morphology remained
disconnected through cross bridge 50, then connected at 60 while capturing 26.33%
of the intervening neighbor. Soft union remained disconnected through 40, then
captured 57.0% at 50 and 97.87% at 85. The characterization temporarily relaxes the
contamination gate to measure those polygons; normal validation rejects them.

## Dangerous false successes

Two adversarial cases pass every geometric check:

1. `truth-omission`: cleanup omits a detached target dot. Both methods report 100%
   selected-mask support, while the missing component has 0% support.
2. `two-selected-words`: cleanup retains a connected second word. Both methods cover
   100% of that foreign selected ink because no independent neighbor truth says it
   is foreign.

Global contamination percentages can also hide a small swallowed neighbor when
diluted by distant extraction debris. The engine therefore gates the maximum
capture of each independently labeled neighbor component as well as the global
fraction, down to a one-pixel known mark. Real examples keep semantic-neighbor masks
separate from generic cleanup
discards for this reason.

## What the messy real-word replay confirms

The frozen 20-case Collection 007/014 stress corpus turns these synthetic limits into
visible handwriting examples. Seventeen inputs contain an evaluable target; three
bad crops are retained as diagnostic-only controls. Across the 34 evaluated method
attempts, 20 produced valid geometry and 14 were rejected. Twelve of 17 targets had
at least one valid geometry. Human review classified those attempts as 12 successes,
8 partials, and 14 failures.

- The sideways `P.S.` target succeeds with soft union, including both periods, while
  morphology rejects it as disconnected. `Did` also connects only with soft union,
  but reaches 24.61% maximum capture of one labeled neighbor component and therefore
  stays review-only.
- The vertical two-word `We will` target works geometrically with both methods at a
  supplied 90° axis. Morphology is visibly scalloped and partial; soft union expands
  correctly along the vertical line and is approved. Equivalent 90°, -90°, and 270°
  inputs are regression-tested to produce the same canonical polygon.
- At the top of Collection 14, morphology succeeds on the corrected `with a`,
  `letter`, and `would` targets, and both methods succeed on `table`. The broader
  soft results for `letter` and `would` remain partial. Semantic-neighbor masks are
  unavailable for the first three, so their contamination is unknown rather than 0%.
- `I Love` works with both methods; `Think` and `Come` have a soft-union success.
- `good` has only partial results; the soft results for `over` and morphology for
  `Come` are also partial, but each of those latter cases has an approved alternative.
- Five evaluable targets—`Love you`, `a few`, `dropped`, `big fat`, and `gobbler`—
  have no valid result under either method with their assigned profile.

The three invalid-input controls expose a separate upstream limit. `Cabbage` clips
the end of the word, `Seed` clips the final stroke and contains an ambiguous mark,
and the fold fragment has no trustworthy single-word target. They remain visible in
the galleries with diagnostic outcomes, but their six method runs are excluded from
all evaluation counts. A clipped target can produce a plausible polygon around the
visible fragment; geometry cannot know that truth continues outside the crop.

These are development stress cases with human-authored cleanup, not a representative
sample or an accuracy estimate. Exact inputs and cleanup operations are in
`corpus/real-stress-v1.json`; generated results are in
`artifacts/stress-real/summary.json` and the two stress galleries.

## Proposed acceptance policy

The agent-ownership follow-up closes none of the semantic limits by itself. Terra
and Sol both made confident incomplete or over-large claims; Sol candidate review
preserved known false selections, and a before/after reviewer approved an unsafe
erase on clipped `Seed`. Until a sealed holdout validates a verifier, the following
geometry list is necessary but **not sufficient** for automatic acceptance.

Any future automatic result should require all of the following:

- one simple, valid, hole-free polygon inside the crop, allowed boundary, and rough
  region;
- 100% selected-ink center and five-point pixel-support coverage;
- 100% truth-target support per component when independent truth exists;
- no crop-boundary contact and no selected component silently discarded;
- no known semantic-neighbor component above the strict capture tolerance;
- at least 65% background reduction;
- envelope/ink area ratio at or below 8 for auto-accept, 8–12 for review, and above
  12 rejected;
- stability under angle perturbation of roughly ±3–5°, parameter perturbation of
  ±10%, and one-pixel erosion/dilation, with polygon IoU around 0.85 or better;
- scale-adjusted equivalence, with normalized polygon IoU around 0.9 or better.

These stability and held-out semantic criteria are proposed next-stage gates; this
POC measures the geometry and adversarial cases but does not yet implement the full
perturbation/IoU policy.

For agent-owned masks, also require software preflight for clipped/invalid inputs,
hash-bound internal prior state, deterministic replay, and a frozen independent
verification policy. Exact Terra/Sol agreement is currently only a review-queue
signal, not a semantic safety proof. Model self-confidence and same-model
candidate-aware critique are not acceptance evidence in the observed pilots.

## Safe product stance

- Prefer tight morphology when it passes all gates.
- Treat a soft-union-only result as review-required until held-out evidence shows
  otherwise.
- Never increase bridge parameters solely until connectivity appears.
- Request crop expansion for clipped ink and human cleanup for ambiguous ownership.
- Do not auto-accept based on polygon validity alone.

The next meaningful evaluation is a fresh 20–30-word held-out cohort from pages and
collections not used for profile or cleanup development, stratified across short
tokens, detached marks, signatures, crowded neighbors, folds, and scan scales. Each
needs independent target and semantic-neighbor masks plus a human “correct hover
region” rating. The original three examples and the 20-case stress corpus are
development evidence, not an accuracy estimate.
