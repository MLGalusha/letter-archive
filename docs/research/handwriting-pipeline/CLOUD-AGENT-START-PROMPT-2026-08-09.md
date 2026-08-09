# Copy/paste prompt for the cloud agent

Continue the Letter Archive agent-first word ink ownership and fitted-perimeter
research from the acting-safe cloud repository.

Repository: `https://github.com/MLGalusha/letter-archive-handwriting-acting-safe`

Branch: `main`

First verify that the checked-out branch is exactly
`main`, that the repository has exactly one history root, and that the tag
`acting-safe-root-2026-08-09` resolves to that root. Do not clone, add as a
remote, fetch, browse, or inspect `MLGalusha/letter-archive`; it contains sealed
evaluator history. Then completely read these files in order:

1. `AGENTS.md`
2. `docs/research/handwriting-pipeline/README.md`
3. `docs/research/handwriting-pipeline/SOURCE-INDEX.md`
4. `docs/research/handwriting-pipeline/HANDOFF-2026-08-08-INK-OWNERSHIP-ITERATION.md`
5. `docs/research/handwriting-pipeline/RESEARCH-MAP.md`
6. `docs/research/handwriting-pipeline/PAGE-012-MISSED-INK-REFERENCE-AND-ADAPTIVE-GROUPING-2026-08-09.md`
7. `docs/research/handwriting-pipeline/CLOUD-HANDOFF-2026-08-09.md`

The active implementation is:
`experiments/word-envelope-shrink-wrap-poc`.

Run `bash scripts/setup-handwriting-cloud.sh` if the three research runtimes are
not already present. Check free disk before and after setup. This environment has
about 20 GiB RAM and 50 GiB storage; preserve at least 10 GiB free. Run one model
on one page at a time, save its float16 probability array, terminate the model
process, and do feature analysis in a fresh process.

Before experimenting, run
`python3 scripts/validate-handwriting-acting-tree.py` and
`python3 scripts/validate-handwriting-cloud-seed.py`. Require the acting tree,
all reachable Git history, tracked acting-safe sources, and current page-012
records to pass before opening a source image or running an experiment.
For the append-only historical registry, use
`python3 docs/research/handwriting-pipeline/validate_artifact_registry.py --portable-seed-manifest docs/research/handwriting-pipeline/CLOUD-SEED-MANIFEST.json`.
The frozen baseline may reference intentionally omitted local artifacts; every
newly appended cloud record must have a present, hash-matching primary file.

Continue autonomously in bounded experiments. Accuracy is more important than
speed. Persist exact input hashes, model hashes, probability arrays, masks, group
IDs, fitted boxes/perimeters, timings, failures, boards, and decisions. Update the
central source index and artifact registry after meaningful work. Commit and push
durable checkpoints frequently.

Never expose a completed human page, sealed ownership answer, sealed mask, or
sealed evaluation board to an acting agent. Those may be used only by an isolated
post-freeze evaluator. Do not treat OCR, Kraken boxes, Eynollah masks, local model
outputs, or visually cleaner ink as truth. Never optimize recall alone or assume
that more recovered ink is better. Temporary bridge pixels may establish an
association but must never enter final ink labels.

Current working architecture:

- Eynollah is a conservative anchor and page-specific ink/stroke-width teacher.
- Kraken supplies independent line/search geometry.
- Positive-unknown page-local features recover faint exact source pixels.
- Stroke-width-scaled temporary associations group fragments inside exclusive
  line ownership.
- Group-level ranking focuses review without deleting evidence.
- A person/agent resolves word ownership with split/merge/transfer actions.
- The deterministic fitted perimeter runs only after exact word ink is accepted.

Start by reproducing the tracked page-012 group-triage checkpoint without changing
its mask. The current result has 72 groups: 54 Eynollah-anchor-backed groups and 18
wholly new groups. Of the wholly new groups, only five substantial faint candidates
remain; ten are micro-fragments, two need crop context, and one is elongated-risk.
The group-triage manifest SHA-256 is
`3c8444c8b34119fa6be010019f4bb2fa7838412eaa2a8eaddafca129c219313e`.

After the reproduction gate passes, proceed in this order:

1. Apply the unchanged page-012 policy to at least two independent acting-safe
   pages/lines and report both gains and regressions visually.
2. Run the bounded white-background Eynollah ablation: exact binary recovered ink,
   soft source-darkness ink, and anchor-backed-only ink. Determine whether it
   denoises, preserves specks, or worsens fragmentation; never union automatically.
3. Build and compare an exact-fragment relationship graph. Score same-word edges
   using stroke-normalized gap, endpoint direction, line position, whitespace
   valleys, local ink similarity, and anchor membership. Compare morphology,
   transparent pair scoring, and positive-unlabeled propagation.
4. Integrate the best proposals into the existing human workspace as editable
   colored groups with accept/split/merge/transfer/remove/grow/undo. Save every
   correction as training data.
5. Prepare a three-state `ink`/`paper`/`unknown-ignore` student-model dataset and
   a collection-separated held-out evaluation plan. Do not train Eynollah misses
   as background.

Give frequent candid updates with rendered boards: what the model saw, what it
selected, what improved, what regressed, specific failure examples, and what each
result means. Continue researching alternative ML and document-binarization
techniques when a failure suggests a new hypothesis, but freeze each experiment
before evaluating it and preserve negative results.
