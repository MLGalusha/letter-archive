# Experiment protocol v1

## Invariants

- Never mutate letters, pages, transcripts, segments, metadata, or entity rows.
- Never silently invent a page break.
- Never flatten a curved baseline or polygon into a rectangle.
- Preserve stable transcript-line and geometry IDs.
- Keep the selected LLM/human reference transcript as displayed text; never
  let rough local HTR silently replace it.
- Treat local HTR as matching evidence, not final transcription.
- Preserve `unlocated`, `skipped`, `split`, `merge`, and ambiguity states.
- No cloud compute unless local measurement proves it necessary.
- No OpenAI request without a pre-call budget reservation.
- Do not auto-retry paid calls.

## Corpus

The layout cohort contains all pages for the six user-selected letters and one
complete letter from every other collection: 14 letters and 66 pages.

Current local transcript inventory:

| Letter | Pages | Source tier |
|---|---:|---|
| `003-18880810-L01` | 4 | unconfirmed AI draft |
| `005-19150813-L01` | 1 | human version; legacy confirmation |
| `007-19181119-L01` | 8 | unconfirmed AI draft |
| `008-18850922-L01` | 2 | unconfirmed AI draft |
| `009-19470830-L01` | 9 | human version; stale legacy confirmation caution |
| `011-19450424-L01` | 2 | human version; unconfirmed |

That is 26 pages with usable transcript text, 12 pages whose current text
matches a saved human version, and 14 pages backed only by AI drafts. None is
modernly verified. Results must always be broken out by source tier.

The other 40 pages stay in the geometry/recognition corpus. They cannot be
scored for transcript alignment until a trustworthy page transcript is frozen.

## Phase order

### Phase 0 — seal inputs

1. Snapshot exact transcript UTF-8 bytes and SHA-256 values in a repeatable-read,
   read-only transaction.
2. Validate page markers or single-page ownership.
3. Verify cohort, source-image, prepared-image, layout, model, and run hashes.
4. Record transcript provenance instead of calling all usable text “confirmed.”

Exit condition: a reproducible 6-letter/26-page bundle with no database writes.

### Phase 1 — local handwriting fingerprints

1. Load McCATMuS once.
2. Process the 66 pages sequentially on CPU, FP32, batch size 1, zero line
   workers, one thread.
3. Retain text, per-character confidence, cuts, stable segment ID, elapsed time,
   and peak memory.
4. Do not judge mapping quality from HTR confidence or CER alone.

Exit condition: one successful immutable recognition artifact per page, or an
explicit failure artifact.

### Phase 2 — content-aware line assignment

Compare:

1. Existing positional assignment.
2. Global one-to-one text alignment.
3. Many-to-many alignment with skipped/unlocated lines.
4. The preceding result with affine gaps and strong anchors.
5. The preceding result with standalone-placeholder abstention, dominant-flow
   partitioning, and geometry-gated adjacent inversion repair.
6. The preceding result with calibrated confidence and abstention.

Allowed transitions are `1↔1`, `1↔2`, `2↔1`, `0↔1`, and `1↔0`.
Direct opposing gap transitions are prohibited so the matcher cannot cheaply
abandon both remaining sequences.

The main path remains monotonic except for a single adjacent inversion when
preserved geometry proves the detections are reversed and both text matches
improve. Minority-orientation detections are deferred, not erased, until the
targeted rotated-flow phase. Do not discount a segment merely because its OCR
reading is short; real content such as `P.E.I.` can produce one-character HTR.

Exit condition: human-labeled mapping truth exists for ordinary pages and every
Set 14 challenge, and precision-versus-coverage can be plotted.

### Phase 3 — targeted recovery

Only unresolved spans enter:

- 90°, 180°, and 270° local recognition.
- Eynollah physical-page or region proposals.
- Neighboring-page block rejection.
- Duplicate proposal suppression.

Each addition is an ablation. Keep it only if it adds correct mappings or
reduces review time without worsening high-confidence errors.

### Phase 4 — forced character placement

Assign the selected reference text to accepted lines, normalize it to model codec
expectations, and run Kraken forced alignment. Measure success, dropped
characters, word/cut accuracy, and whether it makes editing faster.

### Phase 5 — isolated OpenAI model comparison

Run only after the local alignment baseline and budget ledger are sealed.
Transcription/entity outputs go to benchmark artifacts, never application
tables. Blind model identity during human review.

## Human labeling

For each transcript line, record:

- Correct segment IDs, including valid split/merge relationships.
- `not found on page` when appropriate.
- Best and second-best candidate verdict.
- Failure mode.
- Repair action count.
- Active review seconds.

Once a human resolves a mapping, lock it as an anchor and recompute only between
neighboring locked anchors.

## Metrics and gates

Primary:

- Exact mapping precision/recall/F1.
- Accepted precision at 25%, 50%, 75%, 90%, and maximum coverage.
- Catastrophic high-confidence page shifts.
- Top-two candidate recall.
- Median and p90 human seconds per page.
- Median repair actions per page.

Secondary:

- Split/merge accuracy.
- Skipped false-line accuracy.
- Missed-line detection accuracy.
- Forced-alignment success and codec loss.
- Runtime and peak resident memory.
- Results by challenge and transcript source tier.

Initial safety gate:

- No automatic acceptance threshold may ship until a held-out set measures it.
- Prefer 75% coverage at 99% mapping precision over 98% coverage with hidden
  cascading errors.
- Any high-confidence catastrophic shift blocks production adoption.

## OpenAI budget

- User authorization: $20.00.
- Local usable ceiling: $18.00.
- Safety reserve: $2.00.
- Current spend at protocol creation: $0.00.
- Reservations plus settled spend must remain at or below $18.
- Unknown/time-out reservations remain charged.
- Pricing is snapshotted in `openai-budget-policy.v1.json`.
