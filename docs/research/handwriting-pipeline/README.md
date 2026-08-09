# Handwriting word-pipeline research hub

This is the central map for the Letter Archive work that turns photographed
handwriting into one-word ink ownership and fitted word geometry. Large masks,
rendered boards, and frozen run artifacts stay where they were generated; this
hub records what exists, what it proved, what failed, and which result the
current agent workflow uses.

## Current pipeline decision

The agent should not begin by drawing a word box from nothing.

1. Kraken and deterministic line/word geometry provide disposable candidate
   regions and reading-order hints.
2. The current word opens as one shared-coordinate workspace: original crop,
   V4 Clean Ink, and V4 High Recall ink.
3. A fitted line reduces the problem to an ordered one-dimensional span. The
   actor chooses among software proposals, then adds, removes, or transfers exact
   numbered connected pieces. A rough drag remains available when no proposal is
   usable.
4. A bounded envelope search tries standard, fragmented-word, and detached-mark
   profiles. Multiple selected islands are valid input; the smallest result
   that covers all selected ink without unsafe excluded-ink contamination wins.
5. Ownership is unique but provisional while a local line conflict is open.
   Explicit component transfers are allowed between neighboring words. Once the
   local owner is resolved, the accepted word is committed and erased from the
   page-level residual view. Remaining ink controls completeness and can inject
   words the proposals missed.

An explicit counterfactual now removes candidate regions entirely: the reviewer
or agent sees the original and strong-ink full pages, selects one word with one
or more rough rectangles, presses Enter, and repeats. This isolates whether the
Kraken/proposal viewport improves accuracy or merely adds workflow steps. It does
not replace the proposal-driven pipeline until the two frozen runs are compared.

A second counterfactual removed the visible extracted-ink page. The person selected
directly on the original photograph while a hidden conservative layer seeded local
source-color and brightness growth. The trial exposed harder paper/ink boundary
control and higher interaction latency, so it is not the active selection design.
The original remains read-only context; the actor now switches between the exact
clean and high-recall extracted masks, with one chosen mask bound to each word.

The current 007 pair now comes from the frozen V4 context-shape result, not the
smaller ownership-proposal mask. **Clean Ink** is V4 `likely-handwriting`
(625,101 source pixels). **High Recall** is the exact union of that layer and V4
`uncertain-evidence` (686,035 source pixels; 60,934 additions). The union retained
99.98% across the seven predeclared held-out real-ink examples used in that
experiment; strict Clean retained 87.59% across their union.
High Recall is intentionally noisier and is not pixel truth. Neither selection
layer contains synthetic bridge pixels; the actor still owns the semantic choice.

## Findings promoted into the workflow

| Research result | What it established | Current use |
|---|---|---|
| Page 007 full-resolution guarded neighbor growth V2 | Native-resolution color-continuity growth restored marked missing strokes while retaining the native seed, but added too much unsupported paper evidence for a default mask. | Research input only; superseded for the 007 selector by the cleaner V4 partition. |
| V4 likely/uncertain partition on held-out 007 | Local paper-normalized color, Sato ridge evidence, and bidirectional line context produced a useful low-noise layer while its uncertain partition preserved nearly all marked ink. | Clean = likely; High Recall = likely ∪ uncertain. One exact layer is bound per word. |
| V3–V6b cleanup series | Aggressive cleanup can look cleaner while destroying faint writing. V6b improved one fold case but still did not make Kraken detect it. | Preserve Clean and High Recall views simultaneously; do not delete uncertain ink before agent review. |
| Page 014 line→word hierarchy | Line rhythm and local whitespace produced useful word proposals; rotated margins/signatures need separate orientation groups. | Software proposals are starting viewports, not ownership answers. |
| Kraken duplicate-crop A/B | Context duplication changes detections but does not generalize as a default; different passes find complementary ink. | Kraken remains proposal evidence; source-coordinate fusion and residual ink audit remain required. |
| Consensus residual word boxes | OCR ranges are representative anchors, not exact word boxes; boundary-crossing residual ink is an ambiguity cue. | Never stretch a box to satisfy transcript text; preserve residual components. |
| Sequential ownership and knockout experiments | Token queues alone skip visible omissions; exact residual accounting and global disjoint ownership are required. | One software-owned cursor, append-only claims, and a final residual gate. |
| Line-coordinate ownership and semantic binding | Fitted lines produce useful exclusive proposals. A sealed many-to-many ledger leaves 71 exactly scorable units: transcript global is 55/71, line + rough span is 57/71, eight-way frozen choice is 65/71, and one component edit is 68/71. A staged fitted-line pool reaches complete target-component availability at 45% along-line expansion, but with much more distraction. | Start with a 0–15% component pool, escalate to 45% only on defer/missing ink, preserve provisional exclusive ownership and transfer, and never select the expanded pool wholesale. |
| Candidate-word shrink-wrap limits | Fragmented input can be one semantic word; final topology, coverage, area, and contamination—not input component count—determine safety. | Adaptive bounded fitting profiles with visible trial receipts. |

## What is deliberately not promoted

- Broad possible-ink masks are not production handwriting truth.
- A Kraken box is not an exact word box and does not prove transcription.
- Duplicate crops are not independent votes.
- Synthetic bridge pixels are geometry support, not recovered source pixels.
- OCR text cannot consume visible ink merely to make the transcript align.
- A successful word envelope does not prove the page is complete; residual ink
  and unresolved human items remain separate gates.

## Active implementation and evidence

- Ink-recovery experiment log:
  [`backend/benchmarks/ink-recovery/EXPERIMENT-LOG.md`](../../../backend/benchmarks/ink-recovery/EXPERIMENT-LOG.md)
- Detailed experiment/source map: [`SOURCE-INDEX.md`](SOURCE-INDEX.md)
- Cross-worktree research/navigation map: [`RESEARCH-MAP.md`](RESEARCH-MAP.md)
- SBB checkpoint architecture, training provenance, probability sweep, data plan,
  and recommended extractor → word ownership → deterministic fitter design:
  [`SBB-BINARIZATION-MODEL-RESEARCH-2026-08-09.md`](SBB-BINARIZATION-MODEL-RESEARCH-2026-08-09.md)
- Machine-readable current-iteration registry:
  [`ARTIFACT-REGISTRY.json`](ARTIFACT-REGISTRY.json) with
  `validate_artifact_registry.py`
- Isolated agent workflow implementation:
  `/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc`
- Bound 007 V4 Clean/High Recall bundle:
  `artifacts/agent-ink-variants-v2/007-p02-v4-quality/manifest.json` inside that isolated POC
- Current human/agent walkthrough run:
  `artifacts/candidate-word-human-walkthrough-v2/007-p02-strong-clean`
- Minimal free full-page selection experiment:
  `artifacts/simple-page-selector-v1/007-p02-human`
- Original-only, hidden-seed color-guided experiment:
  `artifacts/source-color-selector-v1/007-p02-human`
- Frozen automatic-selection failure atlas:
  `artifacts/auto-selection-failure-atlas-v1/007-p02-transcript-margin0`
- Ownership-independent recovery-conditioning sweep:
  `artifacts/recovery-conditioning-sweep-v2/007-p02-ten-word-mixed`
- Disjoint connected-component ownership comparison:
  `artifacts/disjoint-component-ownership-v1/007-p02-body77`
- Component score-weight and cross-line-abstention diagnostics:
  `artifacts/component-score-weight-sweep-v1/007-p02-body77` and
  `artifacts/cross-line-component-abstention-v1/007-p02-body77`
- Acting-only line-field experiments:
  `artifacts/component-line-field-sweep-v1/007-p02-body77` (global negative) and
  `artifacts/component-line-field-cross-dispute-v2/007-p02-body77-min50`
  (page-bound conservative candidate)
- Spacing-fixed line-coordinate ownership sweep and sealed audits:
  `artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed`
- Acting-only line-choice/component-toggle packets:
  `artifacts/line-choice-agent-packets-v1/007-p02-acting-only-disagreement8`
- Accuracy-v2 explicit Clean/High Recall supervisor:
  `artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4`
- Current durable component-ownership checkpoint:
  [`CHECKPOINT-2026-08-08-DISJOINT-COMPONENT-OWNERSHIP.md`](CHECKPOINT-2026-08-08-DISJOINT-COMPONENT-OWNERSHIP.md)
- Current durable line-coordinate/transfer checkpoint:
  [`CHECKPOINT-2026-08-08-LINE-COORDINATE-OWNERSHIP.md`](CHECKPOINT-2026-08-08-LINE-COORDINATE-OWNERSHIP.md)
- Critical sealed-target binding audit:
  [`BINDING-AUDIT-2026-08-08.md`](BINDING-AUDIT-2026-08-08.md)
- Current semantic-binding and fitted-line pool checkpoint:
  [`CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md`](CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md)
- Acting-packet boundary validator:
  `src/word_envelope/acting_packet_boundary.py` and
  `scripts/validate_acting_packet_boundary.py` inside the isolated POC
- Sealed semantic-binding completion gate and negative control:
  `src/word_envelope/semantic_binding_validation.py`,
  `scripts/validate_semantic_binding_adjudication.py`, and
  `artifacts/semantic-binding-validation-v1/007-p02-template-negative-control`
  inside the isolated POC

## Research hygiene

Every new experiment should add one row to `SOURCE-INDEX.md` and record:

- source and configuration hashes;
- development, held-out, diagnostic, or synthetic evidence role;
- exact output location;
- pass/fail decision and limitation;
- whether an acting agent may see it or it is evaluation-only;
- which production/workflow decision, if any, changed because of it.

Do not copy large artifact trees into this directory. Link them and keep their
immutable manifests and checksums at the generation site.
