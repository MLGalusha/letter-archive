# Cloud handoff: agent-first word ink ownership research

Date: 2026-08-09

Acting branch: `main`

Acting repository: `https://github.com/MLGalusha/letter-archive-handwriting-acting-safe`

This private repository is a history-free, acting-safe export of research source
commit `d8c6afce0dc4919c93c4c61d2d2f66cbd6ee7918` plus the cloud-boundary
validators and setup hardening in this root. The source research commit merged
the active implementation lineage ending at `42a16ad3` with the durable
research-document lineage ending at `dd599d63`. The ordinary
`MLGalusha/letter-archive` repository and its `handwriting-cloud-handoff` branch
contain inherited evaluator-only history and must not be connected to an acting
cloud agent. Use only the acting-safe repository above.

## Objective

Make historical handwriting extraction and one-word ink ownership accurate and
fast enough that a person can create high-quality training truth with minimal
correction, while steadily moving the same pipeline toward autonomy.

The desired final output for each word is not a normal rectangle. It is:

1. exact source-ink ownership for that semantic word;
2. a deterministic fitted perimeter/envelope around that accepted ink;
3. an append-only provenance record of proposals and human/agent corrections.

## Mandatory reading order

1. `README.md` in this directory;
2. `SOURCE-INDEX.md`;
3. `HANDOFF-2026-08-08-INK-OWNERSHIP-ITERATION.md`;
4. `RESEARCH-MAP.md`;
5. `PAGE-012-MISSED-INK-REFERENCE-AND-ADAPTIVE-GROUPING-2026-08-09.md`;
6. this file.

Use `ARTIFACT-REGISTRY.json` for exact predecessor links and primary-record
hashes. Do not read every historical artifact into context. Load only the current
experiment and the directly relevant negative controls.

## Evidence boundary

The acting agent must never inspect or render a completed human page, sealed word
mask, sealed answer ledger, or sealed evaluation board. Those are post-freeze
evaluation evidence only. The acting-safe repository contains only acting-safe
source photographs and frozen software outputs. Its root commit has no parent,
and the `acting-safe-root-2026-08-09` tag is the history boundary.

Do not use OCR/transcript text as permission to consume visible ink. Do not call a
Kraken polygon, Eynollah mask, local classifier output, or prettier image ground
truth. Preserve uncertainty and abstain.

## Current best pipeline

1. Apply EXIF orientation exactly once and establish one source coordinate frame.
2. Run the frozen 2022-08-16 SBB/Eynollah hybrid model once per page. Treat its
   conservative core as a precision-oriented anchor, not a recall-complete mask.
3. Use upright Kraken 7 BLLA output as line/search geometry, not ink truth.
4. Learn page-local ink appearance from Eynollah `p>=0.95` positives and safe
   textured interline-paper negatives. Pixels missed by Eynollah remain unknown.
5. Recover exact source pixels inside plausible line regions from local LAB
   residual, blackhat, multiscale ridge, and edge-coherence features.
6. Estimate stroke width from the Eynollah-core skeleton. On page 012 the
   median/q75/q90 widths were `4.0/5.6/6.4 px`.
7. Associate fragments temporarily inside exclusive Kraken line ownership. The
   current review preset is a `5x35` support kernel. Project every group back to
   exact evidence pixels; retain zero bridge pixels.
8. Rank groups by anchor contact, positive-prototype similarity, crop boundary,
   size, and elongated-structure risk. Ranking changes review order, never truth.
9. Let the person/agent split, merge, transfer, accept, or reject exact groups.
10. Run the fitted word perimeter only after semantic ownership is accepted.

## Current page-012 result

Acting-safe page: `012-18630108-L01-04`.

Important frozen facts:

- original Eynollah core: `51,176` pixels in the selected Kraken lines;
- local-reference weak evidence: `59,192` pixels;
- current exact accepted evidence: `75,822` pixels;
- additions outside Eynollah core: `24,646` pixels;
- additions with Eynollah probability below `0.01`: `11,582` pixels;
- final groups in six lines: `72`;
- Eynollah-anchor-backed groups: `54`, totaling `75,199` pixels;
- wholly new groups: `18`, totaling only `623` pixels;
- wholly new substantial faint candidates: `5`, totaling `293` pixels;
- micro-fragments: `10`, totaling `35` pixels;
- crop-context groups: `2`, totaling `282` pixels;
- elongated-risk group: `1`, totaling `13` pixels.

Primary manifests:

- local reference:
  `e50e1d3fb8bf2693c3b771777e9b3741c8d294e75c7b3b911b6d78c6c3d63668`;
- Kraken layout:
  `82ddcde07a20d38493e0f33df2bb955336d1f70b02d704856c8a70076cd44344`;
- `5x35` adaptive grouping:
  `1bc4d60ec58477e623b38358cde636e0e9d87bc4dabd279a6e1b422ac91b6c1d`;
- one-class group triage:
  `3c8444c8b34119fa6be010019f4bb2fa7838412eaa2a8eaddafca129c219313e`.

## What is supported and what is not

Supported:

- Eynollah is useful as a conservative anchor and page-specific teacher.
- Kraken reaches faint line starts that Eynollah misses.
- A trustworthy fragment can anchor recovery of much of a faint word.
- Page-learned source features recover meaningful evidence even where Eynollah is
  below 1%.
- Temporary stroke-width-scaled associations reduce fragmentation without
  manufacturing final ink.
- Group-level triage can reduce the uncertain review surface dramatically.

Not yet supported:

- formal Eynollah precision or recovered-ink recall across the archive;
- automatic acceptance of local-vector additions as training truth;
- a universal `5x35` kernel across resolutions and writers;
- autonomous word ownership from the colored groups;
- automatic deletion of tiny dots;
- a trained model that reliably handles completely seedless words.

## Important negative results

- Moving Eynollah's tile grid moved damage; it did not eliminate it. Blind tile
  unions are rejected.
- Merely widening the Eynollah-derived body corridor admitted almost no missed
  writing. The evidence score, not only the gate, had to improve.
- Broad q95 hysteresis thickened ink and paper structure.
- GrabCut flooded aged paper and is rejected.
- Explicit synthetic bridges were worse than source-only reconnection in the
  previous reinference experiment. Connect fragments logically; do not paint
  bridge pixels into truth.
- Directly clipping vector evidence to a fitted line destroyed an almost-erased
  word when the line anchors were sparse. Quality-gated abstention is mandatory.

## Next bounded sequence

### 1. Verify the cloud checkpoint

- Run `bash scripts/setup-handwriting-cloud.sh`.
- Run `python3 scripts/validate-handwriting-acting-tree.py` and require a clean
  current-tree, root-tree, and all-reachable-history result.
- Run `python3 scripts/validate-handwriting-cloud-seed.py` and require a clean
  result before using the tracked cloud-seed files.
- Run the artifact registry validator with
  `--portable-seed-manifest docs/research/handwriting-pipeline/CLOUD-SEED-MANIFEST.json`.
  It permits absent files only for the exact 65-record pre-export prefix; every
  later cloud record must exist and match its declared hash.
- Re-run only the current group-ranking script first. Its mask/group IDs must stay
  bit-identical. Do not start expensive model inference until this passes.

### 2. Independent frozen-policy replication

Apply the unchanged page-012 policy to at least two acting-safe pages or lines:

- one faint page/line;
- one folded or cluttered page/line.

Do not tune on both and then call them held out. Freeze a development choice, then
run a distinct check. Record target recovery proxies, foreign structure, group
count, merges/splits, runtime, and review burden together.

### 3. White-background Eynollah second-pass test

Test the user's proposal as an ablation, not an automatic union:

- exact recovered pixels rendered black on white;
- soft grayscale ink preserving source darkness;
- anchor-backed groups only.

Measure retention of fixed core, faint additions, micro-dots, components, splits,
merges, and pixels created outside the input. The model may preserve all dark
specks because it is a binarizer rather than a semantic denoiser; the experiment
must decide.

### 4. Learned fragment relationship graph

Build nodes from exact connected fragments. Score candidate edges using gap divided
by learned stroke width, endpoint direction, curvature continuity, Kraken-line
coordinate, whitespace valleys, source-feature similarity, anchor membership, and
prior human split/merge decisions. Produce editable colored word groups.

First compare:

- current anisotropic morphology baseline;
- deterministic transparent pair score;
- positive-unlabeled/label-propagation challenger.

Do not generate final pixels. A connection is an ownership proposal only.

### 5. Human workspace and training loop

Expose anchor-backed groups first, substantial seedless groups second, and tiny
marks last. Preserve one-click accept, split, merge, transfer, remove, grow-ink,
and undo. Save every initial proposal and final decision with source/model hashes
and time.

Train the first student segmentation model only after genuine corrected examples
exist. Use `ink`, `paper`, and `unknown/ignore` states. Never train all Eynollah
misses as paper. Reserve whole letters/pages by collection for evaluation.

## Cloud storage and memory plan

The cloud target has approximately 20 GiB RAM and 50 GiB disk. That is enough if
the workflow stays bounded:

- repository history is several GiB, not tens of GiB;
- the current page-012 seed is about 55 MiB;
- three additional acting-safe source pages are about 32 MiB;
- Eynollah and Kraken runtimes/checkpoints should remain well below the budget;
- do not transfer the 1.8 GiB local historical artifact tree or 1.1 GiB complete
  local storage tree unless a later experiment specifically requires a subset;
- preserve at least 10 GiB free and remove only disposable package/download caches,
  never immutable experiment evidence.

The prior 8 GiB laptop overload came from retaining TensorFlow plus full-resolution
feature arrays together. The cloud must still run model inference in one process,
save float16 probabilities, exit, and start model-free analysis in a new process.

## Git and durability

- Work only from `MLGalusha/letter-archive-handwriting-acting-safe` on `main`.
- Never add the ordinary Letter Archive repository as a remote in an acting
  environment. It contains evaluator-only history even if the current checkout
  appears harmless.
- Keep research branches free of unrelated application changes.
- Commit meaningful scripts and compact manifests/boards frequently.
- Before ending a bounded experiment, update `SOURCE-INDEX.md`, append the artifact
  registry, validate it, and write a continuation checkpoint.
- Push the branch so the next cloud container does not depend on ephemeral disk.
