# Letter Archive cloud research instructions

This repository is the history-free, acting-safe cloud handoff for agent-first
handwriting ink ownership and fitted word-perimeter research. Do not add, clone,
fetch, browse, or inspect `MLGalusha/letter-archive` from an acting environment;
that repository contains evaluator-only history.

## Read first, in order

1. `docs/research/handwriting-pipeline/README.md`
2. `docs/research/handwriting-pipeline/SOURCE-INDEX.md`
3. `docs/research/handwriting-pipeline/HANDOFF-2026-08-08-INK-OWNERSHIP-ITERATION.md`
4. `docs/research/handwriting-pipeline/RESEARCH-MAP.md`
5. `docs/research/handwriting-pipeline/PAGE-012-MISSED-INK-REFERENCE-AND-ADAPTIVE-GROUPING-2026-08-09.md`
6. `docs/research/handwriting-pipeline/CLOUD-HANDOFF-2026-08-09.md`

The active implementation is
`experiments/word-envelope-shrink-wrap-poc`.

## Non-negotiable evidence boundary

- Never show a completed human page, sealed ownership answer, sealed mask, or
  sealed evaluation board to an acting agent.
- Sealed human evidence may be opened only by an explicitly isolated post-freeze
  evaluator after inputs, parameters, outputs, and hashes are frozen.
- Source photographs and frozen software outputs marked acting-safe may be used.
- Do not infer truth from OCR text, Kraken boxes, Eynollah output, or a prettier
  mask. They are proposal evidence.

## Research method

- Work in bounded experiments and persist exact inputs, hashes, masks, boxes,
  timings, failures, and decisions before starting another experiment.
- Update `SOURCE-INDEX.md` and `ARTIFACT-REGISTRY.json` after meaningful runs.
- Keep exact source pixels separate from temporary morphology or generated bridge
  pixels. Bridge pixels may support associations but never become final ink truth.
- Optimize target-ink recovery, foreign ink, split/merge errors, fitted geometry,
  correction actions, and human time together. Never optimize recall alone.
- Preserve uncertain evidence in a visible review tier. In particular, do not
  automatically delete tiny dots that may be punctuation or detached marks.
- Give frequent candid updates with visual boards, what improved or regressed,
  what the model selected, and what remains difficult.
- Freeze policies before independent or sealed evaluation. Preserve failed and
  superseded results rather than rewriting history.

## Current architecture

Use Eynollah as a conservative anchor and page-specific ink teacher, Kraken as
line/search geometry, local positive-unknown source features for faint recovery,
stroke-width-scaled temporary associations for fragments, group-level ranking for
review, semantic ownership for each word, and deterministic fitted perimeters only
after the word's exact ink is accepted.

## Cloud resource discipline

- The target has about 20 GiB RAM and 50 GiB disk. Keep at least 10 GiB free.
- Run one model process on one page at a time. Save its probability array, exit the
  model process, then run model-free analysis in a fresh process.
- Do not clone/copy the full local artifact archive. Use the tracked cloud seed and
  add only current manifests, compact boards, and arrays needed to reproduce a run.
- Do not cache duplicate model checkpoints or package downloads.

## Repository conventions

- Do not add `codex/` to branch names.
- Preserve unrelated changes. Do not use destructive Git commands.
- Use `apply_patch` for source edits.
- Use `rg` or `rg --files` for searches.

## Project commands

- Cloud research setup: `bash scripts/setup-handwriting-cloud.sh`
- Acting-tree and all-history validation:
  `python3 scripts/validate-handwriting-acting-tree.py`
- Cloud seed validation: `python3 scripts/validate-handwriting-cloud-seed.py`
- POC tests:
  `cd experiments/word-envelope-shrink-wrap-poc && PYTHONPATH=src ../../.venvs/word-ink/bin/python -m unittest discover -s tests -v`
- Artifact registry validation:
  `.venvs/word-ink/bin/python docs/research/handwriting-pipeline/validate_artifact_registry.py --portable-seed-manifest docs/research/handwriting-pipeline/CLOUD-SEED-MANIFEST.json`
