# Fresh-agent continuation prompt

Continue the Letter Archive agent-first word ink ownership research exactly from
the durable checkpoint. Work autonomously through focused experiments and
implementation iterations; do not stop for routine approval. Give the user
frequent, candid updates showing what improved, what regressed, what the model
saw and chose, its precise struggle, timing, and fitted-box/ownership visuals.

Start by reading these files completely and in this order:

1. `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/README.md`
2. `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/SOURCE-INDEX.md`
3. `/Users/masongalusha/Workspace/projects/letter-archive/docs/research/handwriting-pipeline/HANDOFF-2026-08-08-INK-OWNERSHIP-ITERATION.md`

The active implementation is mainly in:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc`

The source repository is:

`/Users/masongalusha/Workspace/projects/letter-archive`

Preserve the user's core interaction: software proposes the next word; the
agent selects exactly one complete semantic word's ink; optional recovery adds
source-supported selectable evidence but does not auto-select it; persistent
cuts separate shared ink; commit erases owned ink and advances; the fragmented
envelope fitter runs downstream; residual ink detects omissions. Disconnected
components may be one valid word. Do not make the model draw every bounding box
from scratch.

Accuracy comes before speed. The user has observed that a larger approximate
box often restores much more ink. The frozen automatic experiment proves that
this is useful for recovery conditioning but unsafe as automatic ownership:
the best tight transcript-conditioned variant had 73.2% median precision and
100% median recall, while an 18% larger anchor fell to 44.6% precision at the
same recall. Separate the large recovery-conditioning box from the narrower
component ownership decision. Never optimize raw recovered-pixel count.

Do not continue the Sol pass of
`artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v1`; it is a
frozen wiring-failure baseline that used the old 314,630-pixel proposal mask as
both Clean and Strong. Build a fresh accuracy-v2 sibling using the bound V4
Clean/High Recall pair after adding and testing explicit mask inputs.

Use the owner's completed 100-word page only as sealed, post-freeze evaluation:
`artifacts/source-color-selector-v2/007-p02-next-iteration-reset-23c97df1a695-reset-ba7be47e2edc`.
Never expose its masks, boxes, or decisions to the acting agent.

Immediate sequence:

1. Build a failure atlas from the frozen auto shrink→select→fit result.
2. Test large recovery-conditioning anchors with independent component
   suggestions and ownership, using correct word-level locators.
3. Improve the target-first evidence workspace: upright line context, original
   focus, Clean, optional recovery variants, selected overlay, small full-page
   locator last.
4. Add explicit V4 Clean and High Recall bindings to the sequential initializer,
   with fail-closed tests and provenance.
5. Run a sealed 10-word sample, then a full page only if accuracy improves.
6. Record exact masks, boxes, hashes, timings, actions, corrections, residual,
   qualitative failures, and metric disagreements. Use independent semantic,
   contamination, envelope, and residual gates so Goodhart's law does not turn
   one score into fake progress.

Control memory and disk: work in bounded batches, persist results in immutable
artifacts and short checkpoint documents, update the central source index,
inspect only narrow JSON/Markdown fields, avoid printing binary or giant files,
retire worker context after each batch, and prune only reproducible render
caches. Never delete user notes, screenshots, decisions, masks, or run history.

Read the full handoff before taking action; it contains exact hashes, run state,
artifact locations, research conclusions, and measurement rules.
