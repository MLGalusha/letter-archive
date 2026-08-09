# Human Word-Review Console

This console lets a person take the exact seat used by the word-ownership agent.
The supervisor chooses one current word, provides immutable evidence and legal
actions, and advances only after one validated action. The console does not add a
second cursor or reinterpret the workflow in the browser.

## Candidate-first word workflow

The console now opens on the real ownership loop, not the older blind rectangle
inventory experiment:

1. Software chooses one bound upstream candidate in reading order.
2. One ordered collage shows the remaining page, surrounding context, proposal
   viewport, and extracted selectable ink.
3. The proposal rectangle is only a disposable viewport. The reviewer classifies
   it as one complete word, clipped, multiword, partial letters, wrong region,
   shared/touching ink, or uncertain.
4. Three synchronized panels show the original crop, lower-noise clean ink, and
   higher-recall strong ink. A rough drag selects likely components in bulk;
   point clicks and the checklist then add or remove exact pieces.
5. Crop reopening, expansion, exclusion, and Sol-only precise cutting all create a
   fresh turn on the same word.
6. A claim runs standard, fragmented-word, and detached-mark parameter profiles
   across both deterministic envelope methods in an isolated worker. Disconnected
   selected ink is allowed; the final fitted envelope must pass coverage,
   contamination, boundary, area, and topology gates.
7. Approval commits the exact selected mask, visually erases it from the next
   remaining-page collage, and lets software load the next candidate.

The **Agent view** exposes the exact prompt, work packet, legal actions, ordered
content contract, current model tier, reason a model turn exists, current choice,
envelope state, and bounded experience telemetry. Every action also records a
concise observable decision summary, crop state, difficulty, struggle flags,
evidence used, and confidence. It intentionally does not request or store private
hidden chain-of-thought.

### Honest current boundary

The live 007 walkthrough uses frozen pass-1 adjudicated candidate geometry, the
normalized ink mask, pass-2 receipts, and the sequential ownership queue. The exact
packet does **not** contain a direct Kraken execution receipt for each proposal, so
the Agent view says so. The generic source-picker-to-Kraken/consensus candidate
initializer remains upstream work; arbitrary catalog pages must not be presented as
ready for this word loop until that receipt-producing transition exists.

The preserved first 007 trial is isolated from the agent benchmark at:

`artifacts/candidate-word-human-walkthrough-v1/007-p02-fresh`

The upgraded clean/strong trial is at:

`artifacts/candidate-word-human-walkthrough-v2/007-p02-strong-clean`

## Open the prepared trial

From this experiment directory, run:

```sh
PYTHON=/Users/masongalusha/Workspace/projects/letter-archive/backend/python/venv/bin/python
PYTHONPATH=src "$PYTHON" scripts/human_review_console.py \
  --run-dir artifacts/candidate-word-human-walkthrough-v2/007-p02-strong-clean \
  --port 8766
```

Then open <http://127.0.0.1:8766>.

The server binds only to the local computer. Each launch creates a new browser
write token, rejects non-local host names and cross-origin writes, and serializes
actions against the run so two tabs cannot both advance the same packet.

## What to do in the console

1. Read the current page, line, word, tier, revision, and stated next effect.
2. Compare the original, clean ink, and strong ink panels. Drag a rough box around
   the word, then point-click pieces to refine it. Use the larger context and
   remaining-page evidence when ownership is unclear.
3. Select one legal move supplied by the current packet. Controls are not guessed
   from the model tier.
4. Open **Notebook** the moment something is confusing, missing, slow, or wrong.
   Attach the active evidence view and optionally paste, drop, or upload a PNG,
   JPEG, or WebP screenshot.
5. Save the note. Notes never complete, skip, or otherwise mutate a word.

Text drafts are stored locally per run and packet. Notes and screenshots are
append-only sidecar evidence bound to the exact run, packet hash, revision, unit,
turn, and evidence view. Automatic interaction events record dwell time, choices,
selection changes, validation failures, and successful actions so forgotten
friction can still be found later.

## Tool semantics

- **Keep selected ink** assigns the chosen connected pieces to the current word,
  closes it, and advances.
- **Remove selected ink** removes pieces only from this word's local candidate and
  regenerates the same word. It is not global erasure.
- **Sever a thin bridge** is a Sol-only source-oriented cut. Connected-component
  numbers may change after it.
- **Correct the word box** creates an append-only box override and regenerates the
  local candidate. It retains the original box in history, but also resets local
  crop cleanup.
- **Enlarge the view** widens the crop using existing source pixels. It does not
  enhance resolution or invent detail.
- **Set aside for Sol** advances the Terra queue and leaves a later Sol task. It
  does not run Sol immediately.
- **Mark for human review** advances the machine queue but leaves a production
  blocker.

## Deliberate limits in this trial

- Clean and strong are synchronized views over one bound high-recall component
  universe. Switching views never changes selected pixels silently. If the strong
  extractor connects a target to a neighbor, the agent must cut or exclude it;
  this version does not maintain two independent claim ledgers.
- There is no true undo or version restore for an accepted cleanup/action. The
  dedicated human run prevents experimentation from altering the agent benchmark,
  but decisions inside this trial remain append-only.
- Prior red claims can be inspected but not yet challenged or reassigned here.
- Transcript correction, word split/merge, and inserting a newly noticed word are
  not yet ownership-stage actions.
- One screenshot can be attached to each note; multiple attachments are future
  work.

These limits are part of the experiment. Record where they cause friction rather
than working around them silently; that evidence determines the next software
iteration.

## Observation data

The console writes only inside the selected trial run:

- `human-observations/note-events/` — append-only note revisions
- `human-observations/attachments/` — validated screenshot bytes
- `human-observations/interaction-events/` — append-only UI telemetry
- `human-observations/notes-index.json` — current note index

Ownership state remains in the supervisor's existing immutable revision chain.
Uploaded names and paths are never trusted; saved attachments receive generated
IDs and content hashes.

## Verification

```sh
PYTHON=/Users/masongalusha/Workspace/projects/letter-archive/backend/python/venv/bin/python
PYTHONPATH=src "$PYTHON" -m unittest tests/test_human_review_console.py -v
node --check review_console/app.js
```

The focused tests cover exact packet binding, stale action rejection, one-commit
two-tab races, note history, historical evidence, upload validation, path and
symlink containment, host/origin/token protection, static security headers, and
telemetry summaries.
