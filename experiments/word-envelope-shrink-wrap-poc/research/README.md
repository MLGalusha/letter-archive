# Word selection research index

This directory is the stable entry point for the otherwise append-only experiment
artifacts. Artifact records are proposals or measurements unless explicitly
identified as human ground truth.

## Durable navigation

Start with the central cross-worktree documents. They inventory evidence outside
this POC and distinguish acting-visible material from sealed evaluation:

- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/README.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/SOURCE-INDEX.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/RESEARCH-MAP.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/ARTIFACT-REGISTRY.json`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/CHECKPOINT-2026-08-08-DISJOINT-COMPONENT-OWNERSHIP.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/CHECKPOINT-2026-08-08-LINE-COORDINATE-OWNERSHIP.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/BINDING-AUDIT-2026-08-08.md`
- `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md`

The POC source, tests, research documents, every primary record in the central
33-entry registry, and representative visual receipts are Git-tracked at the
latest 2026-08-08 snapshot. The remaining 1.3 GiB generated artifact store stays
local and ignored. Treat hashes and the central indexes as required durability,
not as optional notes.

## Current promoted direction

The current workflow is: show original context plus clean and high-recall ink;
use the fitted line and rough locators to present a few exact component proposals;
choose one, add/remove/transfer numbered components, visually verify green, then
commit it red. A rough rectangle remains a fallback. Source-supported recovery
and persistent cuts are optional exception tools. Ownership stays unique but may
be transferred between local neighbors before commit.

The timing of final word-envelope fitting is unresolved: some supervisor paths fit
per word as a safety diagnostic, while the minimal selector defers fitting until
page finish. Do not silently merge these policies. Record which timing a run uses
and compare correction burden, latency, premature fit rejection, and final residual.

- Human selector implementation: `simple_selector/`,
  `src/word_envelope/simple_page_selector.py`
- Transparent agent runner: `src/word_envelope/simple_page_agent.py`
- Frozen agent prompt and response schema: `prompts/simple-page-word-selector-v2.md`,
  `schemas/simple-page-agent-decision-v2.schema.json`
- First bound real-agent observation:
  `artifacts/simple-page-agent-v2/007-p02-live-trial/TWO-LINE-OBSERVATION.md`
- Latest completed-page algorithm comparison:
  `artifacts/completed-page-next-iteration-v6/007-p02/manifest.json`
- Current explicit V4 Clean/High Recall sequential supervisor, revision 0:
  `artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4/`
- Frozen ten-word isolated-model sample, revision 0 and infrastructure-blocked:
  `artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4-sample10/`
- Acting-packet boundary validator and first passing receipt:
  `src/word_envelope/acting_packet_boundary.py`,
  `scripts/validate_acting_packet_boundary.py`, and
  `artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4-sample10/boundary-validation-r000000-u000000-t0000.json`
- Spacing-fixed line-coordinate sweep and corrected sealed audits:
  `artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed/`
- Eight acting-only line-choice/component-toggle packets, all boundary-clean:
  `artifacts/line-choice-agent-packets-v1/007-p02-acting-only-disagreement8/`

## Current deterministic ownership result

- Failure atlas:
  `artifacts/auto-selection-failure-atlas-v1/007-p02-transcript-margin0/`
- Corrected recovery-conditioning sweep:
  `artifacts/recovery-conditioning-sweep-v2/007-p02-ten-word-mixed/`
- Independent/order/global-exclusive comparison:
  `artifacts/disjoint-component-ownership-v1/007-p02-body77/`
- Score-weight sweep, preserved fragile gain:
  `artifacts/component-score-weight-sweep-v1/007-p02-body77/`
- Blanket cross-line penalty, rejected:
  `artifacts/cross-line-component-abstention-v1/007-p02-body77/`
- Global line-field blending, rejected:
  `artifacts/component-line-field-sweep-v1/007-p02-body77/`
- Conservative cross-dispute line-field candidate:
  `artifacts/component-line-field-cross-dispute-v2/007-p02-body77-min50/`

Retained decision: transcript-locator global-exclusive component ownership is the
baseline software suggestion, not an automatic answer. Its 77-word development
run has zero duplicate claims. Earlier 56/58/64/70 HQ counts are quarantined: the
completed page is a disjoint ink partition but not a one-mask-per-semantic-token
target. The sealed many-to-many ledger is now complete: 71 exact units are
scorable and 6 merged-mask units are excluded. Transcript global scores 55/71;
line + rough span scores 57/71; frozen proposal choice reaches 65/71; one whole-
component edit reaches 68/71. The staged fitted-line pool makes all target
components available at 45% along-line expansion, but 0–15% is the compact first
view and 45% is recovery-only.

## Research streams

- Ink extraction and dual-layer selection: `artifacts/agent-ink-variants-v1/`,
  `artifacts/agent-ink-variants-v2/`, `artifacts/source-color-selector-v2/`
- Source-supported local ink recovery:
  `src/word_envelope/local_ink_recovery.py`
- Fragmented-word geometry and final envelopes:
  `src/word_envelope/fragmented_envelope.py`, `artifacts/limits/`,
  `artifacts/real/`, `artifacts/stress-real/`
- Full-page ownership and residual knockout:
  `artifacts/full-page-supervisor-trial-v2/`,
  `artifacts/full-page-sequential-ownership-v1/`,
  `src/word_envelope/sequential_ownership.py`, and
  `src/word_envelope/sequential_residual_audit.py`
- Disjoint component scoring and acting-only ink-line support:
  `src/word_envelope/component_assignment.py`
- Line-coordinate proposal assignment and interaction audits:
  `src/word_envelope/line_word_assignment.py`,
  `scripts/experiment_line_coordinate_word_ownership.py`,
  `scripts/analyze_one_toggle_affordances.py`, and
  `scripts/analyze_exclusive_component_transfers.py`
- Validated semantic binding, staged candidate pools, and corrected transfer
  evaluation: `src/word_envelope/semantic_binding_validation.py`,
  `scripts/reevaluate_line_candidates_semantic_binding.py`,
  `scripts/experiment_line_component_pool_expansion.py`, and
  `scripts/analyze_semantic_exclusive_component_transfers.py`
- Inventory/alignment experiments:
  `artifacts/full-page-inventory-alignment-trial-v3/`
- Human pipeline and review-console experiments:
  `artifacts/full-pipeline-human-walkthrough-v1/`,
  `artifacts/full-page-human-review-v1/`

## Important negative results

- Requiring one connected selected island rejects valid fragmented words.
- Selecting directly from source-color regions is less controllable than using
  extracted ink as the ownership surface; source pixels remain useful for local
  recovery.
- Drawing boxes from scratch is unnecessary work for both person and model.
- Fitting an envelope on every word interaction adds delay and premature failure;
  fitting belongs at page finish.
- Caching the three static agent-collage panels did not materially improve the
  selection action. Component labeling was the bottleneck. Guarded incremental
  component state reduced the measured normal next-word selection from 256.7 ms
  to 82.3 ms on the 3000×4000 007 page.
- Reading-order knockout is better than reverse order but still unsafe as truth;
  41 transcript-locator components changed owners between forward and reverse.
- Single-component transfer gains run in both directions. Irreversible universal
  reading order can lock in an early wrong owner; keep local claims provisional
  until neighboring conflicts are resolved or deferred.
- Independently binding each locator family to sealed word masks invalidated the
  first 68/77 cross-family oracle. Reusing one binding produced a consistent 64/77
  proxy, but later physical and visual audits proved the target masks themselves
  require many-to-many semantic adjudication.
- Globally reweighting locator features produced only one fragile corrected word
  and line-held-out configuration selection fell to 51/77.
- A blanket cross-line ambiguity margin trades one foreign correction for more
  missed target ink. Global line-field blending similarly fixed `answer.` but broke
  `now`. Line support must be limited to the disputed cross-line components.
