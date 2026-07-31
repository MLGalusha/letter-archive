# Transcript-to-image alignment benchmark

## Product question

Can the archive place the better LLM/human transcript under the correct
handwritten image line reliably enough that an administrator can verify and
repair a page faster?

The selected LLM/human transcript is the reference text shown to the reviewer;
its provenance still matters because some references are unconfirmed AI
drafts. Kraken supplies geometry. A local handwriting recognizer supplies a
noisy textual fingerprint that joins the two. The system must abstain whenever
that join is uncertain.

## Intended pipeline

1. Preserve Kraken 7 baselines and polygons with stable segment IDs.
2. Recognize each detected line locally with McCATMuS.
3. Align noisy recognition to reference transcript lines with a page-scoped,
   mostly monotonic many-to-many matcher.
4. Keep skipped detections, missing transcript lines, splits, and merges
   explicit.
5. Keep secondary-orientation detections visible as deferred work and allow an
   adjacent reorder only when preserved geometry and both text matches agree.
6. Ask a human to resolve uncertain mappings.
7. Only after line assignment, use Kraken forced alignment for approximate
   character or word locations.
8. Try rotated regional recovery only for still-unlocated or deferred text.

Page isolation and Eynollah are optional proposal filters. They are not the
foundation of the transcript mapping.

## Current local artifacts

- Alignment implementation:
  `src/services/transcript-alignment/aligner.ts`
- OpenAI experiment budget guard:
  `src/benchmarks/transcript-alignment/openai-budget.ts`
- Budget policy:
  `benchmarks/transcript-alignment/openai-budget-policy.v1.json`
- Transcript snapshot command:
  `npm run benchmark:alignment:snapshot`
- Local Kraken recognizer:
  `python/transcript_alignment/recognize_layout.py`
- Reusable cohort recognizer:
  `python/transcript_alignment/recognize_cohort.py`
- Alignment command:
  `npm run benchmark:alignment:run`
- Local review workspace:
  `http://localhost:5174/admin/layout-benchmark/alignment`
- Reviewer-scoped scorecard:
  `GET /admin/layout-benchmark/alignment/runs/:runId/scorecard`

Generated models, snapshots, recognition results, alignments, overlays, and
human verdicts live under `test-results/transcript-alignment/` and are ignored
by Git.

Human verdicts are bound to the exact alignment artifact SHA-256. Regenerating
an experiment cannot silently reuse judgments made against older geometry or
mappings.

## Safety rules

- Local first. Cloud compute is not required for the initial experiment.
- Benchmark commands never write to production application tables.
- AI model comparisons are isolated from the Kraken/alignment experiment.
- The user-authorized OpenAI maximum is $20.
- The local dispatcher ceiling is $18, leaving a $2 enforcement reserve.
- Every call is reserved in a locked ledger before dispatch.
- Timed-out or otherwise uncertain calls remain charged until reconciled.
- No automatic API retries and concurrency is one.
- At the time this README was created, OpenAI API spend for this experiment was
  **$0.00**.

## What counts as success

The central measurement is reduced human effort without hidden mapping errors.
Report at least:

- Correct transcript-line-to-segment precision, recall, and F1.
- Accepted precision versus automatically accepted coverage.
- Catastrophic page-shift rate.
- Split, merge, skipped-line, and unlocated-line accuracy.
- Top-two candidate recall for uncertain mappings.
- Human review seconds, clicks, and corrections per page.
- Results broken out by sideways text, neighboring-page contamination,
  writer, collection, and page quality.
- Local runtime and peak memory.

OCR character error rate is useful diagnostic evidence, but it is not the
product objective. Rough OCR can be valuable if it reliably fingerprints the
right line.

See `EXPERIMENT.v1.md` for the frozen test order and
`RESEARCH-2026-07-29.md` for the evidence behind the design.
