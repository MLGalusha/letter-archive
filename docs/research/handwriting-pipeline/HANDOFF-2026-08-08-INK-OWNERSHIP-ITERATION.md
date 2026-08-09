# Handoff — agent-first word ink ownership iteration

Date: 2026-08-08
Primary page: `007-p02` (`007-19430411-L01-02.jpg`)
Status: active research; accuracy before speed

## Read this first

This file is the durable continuation point for the current word-localization,
ink-ownership, and fitted-envelope work. Also read, in order:

1. [`README.md`](README.md) — promoted architecture and product rules.
2. [`SOURCE-INDEX.md`](SOURCE-INDEX.md) — central index of prior experiments.
3. This handoff.

Then read the latest bounded checkpoint:

4. [`CHECKPOINT-2026-08-08-LINE-COORDINATE-OWNERSHIP.md`](CHECKPOINT-2026-08-08-LINE-COORDINATE-OWNERSHIP.md)
   — line-coordinate proposals, corrected canonical binding, component-transfer
   results, acting-only packets, and the active continuation sequence.
5. [`BINDING-AUDIT-2026-08-08.md`](BINDING-AUDIT-2026-08-08.md) — critical
   correction: completed masks are not one-to-one semantic token truth; all
   page-007 per-word accuracy counts are quarantined pending adjudication.

Implementation and current artifacts live primarily in the isolated POC:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc`

The Letter Archive source repository is:

`/Users/masongalusha/Workspace/projects/letter-archive`

Do not assume the newest artifact is the best. Bind every claim to exact files,
hashes, and evidence roles.

## Owner intent — preserve this exactly

The desired human and agent loop is deliberately simple:

1. Software proposes the next approximate word location. The model should not
   draw every box from scratch.
2. The model sees useful context plus the word workspace in the same coordinate
   system.
3. It selects exactly one complete semantic word's ink. A word may contain
   multiple disconnected components.
4. If Clean Ink omitted strokes, it can recover source-supported ink and choose
   among controlled recovery variants. Recovery expands what is selectable; it
   must not silently select the additions.
5. If two words share ink, a cut line is a persistent geometric barrier. The
   model can then select one side.
6. During local line resolution, every component has at most one provisional
   owner but may be explicitly transferred to a neighboring word. Commit/Enter
   makes the resolved claim irreversible, erases it from the remaining page,
   advances to the next word, and leaves residual ink visible.
7. The envelope fitter runs on the selected mask and produces the fitted word
   boundary. Envelope geometry must never certify incorrect ownership.
8. Notes and screenshots are page-level documentation, primarily at the end,
   so annotation does not dominate the selection loop.

The owner completed a high-quality 007 page manually with this interaction.
That run is valuable evaluation evidence and must not be exposed as a hint to an
acting model:

`artifacts/source-color-selector-v2/007-p02-next-iteration-reset-23c97df1a695-reset-ba7be47e2edc`

It has 100 committed masks at revision 103 and includes page notes. Treat its
word masks, fitted envelopes, rectangles, recoveries, and timings as a sealed
evaluation set until an acting experiment has frozen its decisions.

## Current product conclusions

### Ink views

The current promoted 007 V4 masks are:

`artifacts/agent-ink-variants-v2/007-p02-v4-quality/manifest.json`

- Clean Ink: `clean.mask.png`, 625,101 pixels, pixel SHA-256
  `3283b1d85cedbf6479f865f3ad2f97b014cc28176862f0a964821bf015c8ed66`.
- High Recall: `strong.mask.png`, 686,035 pixels, pixel SHA-256
  `599bc5c99ad9591295111ee0330450e12e52c8a3cd07ae24eb35dcfc78777458`.
- High Recall adds 60,934 source-supported pixels and is an exact superset of
  Clean.

The acting workspace should normally begin with Original + Clean. It should
offer conservative, balanced, and maximum source-supported recovery only when
needed. One exact chosen mask/variant must be bound per word.

### Latest line-coordinate and ownership-order result

The fitted body lines can serve as a one-dimensional word coordinate system and
produce useful exclusive proposal alternatives. Under the original one-to-one
geometry proxy, the spacing-fixed transcript line + rough-span configuration
changed 56 to 58 high-quality words out of 77 while reducing foreign and missed
pixels. The later binding audit proves those are not semantic accuracy counts.

Do not use the first 68/77 cross-locator oracle: 18 unit IDs had been matched to
different completed-page targets depending on locator family. The later 64/77
and 70/77 values fixed cross-family consistency but still forced split/combined
completed masks into one-to-one semantic targets. Retain them only as interaction
capacity proxies.

Unique but provisional ownership remains a useful architecture hypothesis while
resolving local conflicts. The reported same-line transfer gains and direction
counts used the unadjudicated proxy binding and cannot yet reject or promote a
specific processing order.

Eight acting-only line-choice/component-toggle packets are frozen and pass the
boundary validator. No isolated model response exists because all local acting
routes remain unavailable. Do not use the current evaluator as the actor.

The sealed many-to-many evaluator ledger is now complete at
`artifacts/semantic-binding-adjudication-v1/007-p02-completed-evaluator-v1/` and
passes the strict gate with zero violations: 71 scorable units, 6 excluded merged
units, and all 77 body masks resolved. The first trustworthy reevaluation gives
55/71 for transcript global, 57/71 for transcript line + rough span, 65/71 for
eight-way proposal choice, and 68/71 after one whole-component edit. Two edits add
zero. A fitted-line pool sweep shows 0–15% is a compact default and 45% is a
complete-availability recovery view, not an auto-selection policy. See
[`CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md`](CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md).

### Context hierarchy

The model's ordered evidence should be target-first:

1. upright directed line context with the approximate target indicated;
2. original-color focus crop;
3. Clean selectable ink in identical coordinates;
4. optional recovery variants in identical coordinates;
5. selected-versus-unselected overlay;
6. small full-page locator last.

The previous collage overemphasized a tiny full page, a crowded numbered
context panel, and sparse ink. It made a simple human decision difficult for the
model. Full-page context is navigation evidence, not the main decision surface.

### Larger approximate selection anchors

The owner observed that a larger approximate selection rectangle often restores
substantially more of the intended word. Preserve that insight, but do not turn
recovered-pixel count into the objective.

Current diagnostic sweeps:

- `artifacts/recovery-anchor-size-v1/007-p02-ps-02-U02`
- `artifacts/recovery-anchor-size-v1/007-p02-body-02-U04`
- `artifacts/recovery-anchor-size-v1/007-p02-body-08-U03`

These runs established a crucial interaction:

- a larger anchor helps when the locator is centered on the correct word;
- a larger anchor around a stale line-sized or cross-line locator restores more
  neighboring ink too;
- therefore locator quality and recovery margin must be measured separately.

The next prompt revision must remove the old blanket recommendation to use a
tiny `12–30 px` seed. Start with a generous word-interior rectangle or a
software-prefilled word-level anchor, then refine. Keep tiny point rectangles
for detached-stroke cleanup only.

## The current wiring regression

The frozen accuracy-first sequential run is:

`artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v1`

Final Terra state:

- revision 110;
- 101/101 terminal in the first queue;
- 39 claimed;
- 62 deferred to Sol;
- 0 human;
- `machine_status=awaiting_tier_requeue`;
- state SHA-256
  `7aac4421103d899abdca9d18c47bfa9e416086e497412a3e5f6fcb371abb2775`;
- checkpoint SHA-256
  `965c680cdb697e24d8febd4304d671fe58da1f18bdc65c55e3b9f1e908894eb1`.

Do **not** requeue its Sol pass yet. The run accidentally used the old
314,630-pixel knockout proposal mask as both Clean and Strong. Its manifest
policy literally says `single_bound_mask_shown_as_both_clean_and_strong`.
That explains the sparse/broken selectable ink and the 62/101 Sol deferrals.
Preserve it as a baseline demonstrating the wiring failure; do not overwrite or
repair it in place.

The old mask and V4 masks are materially different:

- old: 314,630 pixels;
- V4 Clean: 625,101;
- V4 High Recall: 686,035;
- old/V4 Clean IoU: approximately 0.495;
- old has 3,379 pixels absent from V4 Clean and 3,285 absent from V4 High
  Recall.

A fresh accuracy-v2 run should bind V4 Clean as the clean reference and a
validated claim universe that retains V4 High Recall and any upstream pixels
needed by imported claims. Never silently relabel the old mask as Clean.

## Current automatic-easy-word experiment

The owner proposed this software-only path:

1. take a Kraken/deterministic word proposal;
2. shrink it to the supported ink inside it;
3. let the tightened box select complete ink components;
4. run the fragmented-word envelope fitter;
5. auto-accept only conservative easy cases;
6. send failures to the LLM, and the hardest remaining cases to a human.

The implementation is:

`scripts/experiment_auto_shrink_select_fit.py`

It compares two locator families and two anchor margins over the 77 body-word
positions:

- reviewed/Kraken-derived proposal boxes;
- transcript-conditioned line/word boxes;
- ink-tight anchor margin 0%;
- ink-tight anchor margin 18%.

It freezes every acting candidate before loading the manual page. The manual
page is then used only for pixel precision/recall diagnostics. The acting gate
does not receive human data. The known transcript omission on body line 6 must
cause the transcript-conditioned locator to abstain on unavailable positions,
not shift later words.

The corrected frozen run is:

`artifacts/auto-shrink-select-fit-v1/007-p02-body77-v3`

Experiment SHA-256:
`0f99252cd612ce3c5fe275919ac61d9fd18273dc3ee65422f99f0676f7f5726a`.

| Locator and anchor | High-quality by sealed evaluation | Acting auto-easy accepted | Accepted and high-quality | Acting-gate precision | Median pixel precision | Median target recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reviewed/Kraken, 0% | 23/78 | 30 | 16 | 53.3% | 53.8% | 100% |
| Reviewed/Kraken, 18% | 14/78 | 18 | 10 | 55.6% | 41.8% | 100% |
| Transcript-conditioned, 0% | 31/77 | 40 | 28 | 70.0% | 73.2% | 100% |
| Transcript-conditioned, 18% | 17/77 | 18 | 13 | 72.2% | 44.6% | 100% |

This simple automatic path is not safe enough to ship. The transcript locator
is the stronger starting point, but even its conservative gate falsely accepts
too many masks. The larger 18% anchor proves the owner's recovery observation:
it retains full target recall, but automatic whole-component ownership captures
more neighboring ink and sharply lowers precision.

The design pivot is to separate two boxes that the first experiment conflated:

1. a **larger recovery-conditioning box** may gather enough target color and
   stroke evidence to restore faint or missing pixels;
2. a separate **ownership selector** must choose among recovered components and
   may remain narrower, exclude components, or cut shared ink.

Never auto-own every component touched by the larger recovery box. Show the
recovered evidence as selectable red ink with a software-suggested green subset,
then require the LLM or conservative independent gates to approve ownership.

Interpretation rules:

- high human-mask precision/recall on this one page is diagnostic, not proof;
- the auto-easy gate must remain independent of human masks;
- measure false automatic approvals more severely than abstentions;
- preserve the rejected-case atlas, not just aggregate scores;
- check whether a broad proposal selects a neighboring word or an entire shared
  component;
- compare residual ink after all accepted words.

## Relevant prior research

Do not redo these from memory. Read their results and reuse their immutable
artifacts:

- Kraken native layout baseline: `backend/benchmarks/layout/`.
- Duplicate-crop Kraken A/B on 007:
  `backend/test-results/reassembly-poc/duplicate-crop-kraken-ab-007-20260803/`.
  Deterministic context changes find complementary ink but increase fragments;
  duplicate crops are auxiliary, not the default.
- Transcript-conditioned word localization:
  `backend/test-results/reassembly-poc/transcript-conditioned-word-localization-20260803/`.
  It produced 77 body polygons and good valley cuts, but forced the wrong token
  count over a visible omitted word. Use as a locator prior, never truth.
- Consensus residual word boxes:
  `backend/test-results/reassembly-poc/consensus-residual-word-boxes-20260804/`.
  OCR ranges are representative anchors; protruding/crossing residual ink is an
  ambiguity cue.
- H1 fragment-bridge anchors:
  `backend/test-results/reassembly-poc/h1-fragment-bridge-anchor-probe-20260804/`.
  Stable geometry can bridge Kraken fragments even when OCR text is poor.
- Page 014 line-to-word boxes:
  `backend/test-results/reassembly-poc/page014-line-word-box-poc-20260803/`.
- V4 ink work and later cleanup/recovery series are indexed in
  [`SOURCE-INDEX.md`](SOURCE-INDEX.md).

## Next implementation and experiment sequence

Proceed autonomously and report each iteration's result/regression without
waiting for permission unless an irreversible or scope-expanding action is
required.

1. Inspect the frozen auto shrink→select→fit result and render representative
   good/failure crops. Diagnose false positives by shared component, adjacent
   component, cross-line locator, fold/noise, and detached-mark categories.
2. Sweep larger **recovery-conditioning** margins around correct word-level
   locators while keeping ownership selection independent. Recommended
   initial margins: 0%, 10%, 18%, 30%, and 45%. Measure target recall, foreign
   word capture, detached-mark recovery, component extension, correction need,
   and residual effects. Do not optimize recovered-pixel count alone.
3. Compare locators on the same word set: reviewed/Kraken proposal,
   transcript-conditioned polygon, fused source-coordinate proposal, and a
   no-locator baseline. Locators are proposals; omissions and residual ink may
   create new word slots.
4. Modify sequential ownership initialization to accept an explicit bound Clean
   reference path plus High Recall claim-universe path. Validate dimensions,
   hashes, Clean⊆High Recall, upstream imported-claim compatibility, and evidence
   rendering. Add focused regression tests and CLI arguments.
5. Rebuild a fresh accuracy-v2 007 run with the correct V4 pair and improved
   target-first context. Do not mutate accuracy-v1.
6. Run a sealed 10-word accuracy sample including ordinary body words,
   fragmented words, punctuation, the `By/now/you/know` region, a known omitted
   transcript case, and rotated P.S. writing. Compare direct approval,
   correction actions, Sol escalation, final ownership, and residual.
7. Only after the 10-word sample improves, run the full page and time it.
8. Speed work comes after accuracy. Still record wall time, model time, tool
   actions, image renders, context requests, cuts, recoveries, and retries now so
   the later speed optimization has a baseline.

## Measurement contract and Goodhart guardrails

The owner explicitly wants extensive measurement but warned against chasing a
metric until it stops representing quality. Record:

- exact source and artifact hashes;
- proposal, tightened, anchor, selected, and fitted geometry;
- exact selected-mask hashes and pixel counts;
- selected and rejected components;
- chosen ink/recovery variant;
- target recall and foreign-ink capture after freeze;
- envelope coverage and contamination;
- residual components and pixels;
- action count, retries, cuts, recoveries, context requests, tier upgrades;
- wall time per word, median, tail, and model/tool/render breakdown;
- qualitative failure category and screenshot/crop evidence.

Never let one metric certify a word. Required independent gates are semantic
one-word ownership, no unacceptable neighbor capture, fitted-envelope safety,
and residual completeness. Keep a metric-disagreement report: cases where IoU,
pixel F1, envelope contamination, residual, and visual judgment disagree are
especially valuable.

Boxes and masks are data, not truth. Preserve every version append-only and
label whether it is acting input, software proposal, model decision, human
evaluation, or post-freeze analysis.

## Memory and workspace discipline

This task previously accumulated too much conversational and raster context.
Use these rules:

- keep durable state in this handoff, the research hub, immutable manifests,
  and short checkpoint files;
- work in bounded iterations (usually 10 words or one focused experiment);
- summarize and retire an agent/worker context after each bounded batch;
- do not repeatedly load full JSON masks, giant logs, or all prior screenshots
  into conversation;
- inspect JSON/Markdown with narrow field queries; never print binary files;
- render a small number of purposeful comparison boards;
- update [`SOURCE-INDEX.md`](SOURCE-INDEX.md) for every meaningful experiment;
- preserve decisions, states, notes, screenshots, and exact evaluation masks;
- prune only reproducible render caches, with a marker documenting what was
  removed and how to regenerate it;
- monitor free disk space before model or raster-heavy runs;
- never delete user evidence or immutable run history to make space.

## Communication style

The owner wants candid, frequent, concrete updates. Lead with what improved or
regressed, show visual results and fitted boxes as the run progresses, explain
what the model saw and chose, name its exact struggle, and state what the result
means for the next iteration. Do not hide failures behind aggregate metrics.
Continue iterating without stopping for routine confirmation; the owner will
interject while work proceeds.
