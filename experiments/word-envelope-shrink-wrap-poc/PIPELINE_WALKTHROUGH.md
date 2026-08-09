# Letter Pipeline Walkthrough

This console lets a person enter the same constrained seat as the acting agent,
starting from a selected source image. It is an inspection experiment, not a
claim that the current proof of concept already has a complete raw-page pipeline.

## Run the walkthrough

From this proof-of-concept directory, start the local walkthrough with:

```sh
PYTHONPATH=src /Users/masongalusha/Workspace/projects/letter-archive/backend/python/venv/bin/python \
  scripts/pipeline_walkthrough_console.py \
  --workspace-dir artifacts/full-pipeline-human-walkthrough-v1 \
  --letter-archive-root /Users/masongalusha/Workspace/projects/letter-archive \
  --port 8766
```

Then open `http://127.0.0.1:8766`. The console creates a separate immutable
session for every selection, so experimenting there does not alter the agent
benchmark runs.

For the first complete hands-on loop, choose Collection 014, page 04. It can
start a fresh Stage A and Stage B run. Choose Collection 007, page 02—or any
other catalog page—to inspect the real source-intake experience and document
the currently missing page-structure preparation tools. The console must stop
there instead of borrowing an older page record.

## Truth contract

The walkthrough must never fill a missing transition with old answers or splice
stages from different runs.

- A selected image is immutable and bound by byte hash and pixel dimensions.
- Every acting turn has exactly one current stage, one current item, one packet,
  one legal-action set, and one completion condition.
- **Agent view** contains only the prompt, packet, schema, and evidence available
  to the actor on that turn.
- **Pipeline inspector** may show software receipts, named withheld fields,
  provenance, hashes, and missing capabilities. It may not reveal withheld field
  values or future decisions.
- New live turns snapshot the exact prompt bytes, response-schema bytes, packet
  bytes, evidence hashes, model/tier declaration, and validation receipt. Old
  recordings that did not preserve these bindings are labelled as recordings,
  never as verified exact views.
- Notes, screenshots, and interaction telemetry are append-only sidecars. They
  never advance the workflow.

## Real stage graph

| Stage | Current capability | Actor or software | Provenance label |
| --- | --- | --- | --- |
| Source selection | Real | Human/software | `live_same_run` |
| Source preparation | Missing for arbitrary images | Future agent + software | `blocked_missing_transition` |
| Visible-span inventory | Real for prepared 014 lines | Agent/human | `live_same_run` |
| Many-to-many alignment | Real for prepared 014 lines | Agent/human | `live_same_run` |
| Ownership knockout | Implemented; 014-specific mask path | Deterministic software | `available_not_started` |
| Per-word ownership/cleanup | Real | Agent/human | `available_not_started` |
| Fresh residual audit | Real after a complete ownership run | Agent/human | `available_not_started` |
| Claimed-mask to envelope handoff | Missing | Deterministic software | `blocked_missing_transition` |
| Envelope geometry | Real standalone | Deterministic software | `available_but_disconnected` |

The legacy 007 run is shown separately as `recorded_legacy_evidence`. It must not
be joined to a new 014 inventory session.

## Missing source-preparation output

An arbitrary image cannot yet enter visible-span inventory. The upstream stage
must produce all of the following as reviewed, versioned data:

1. page/paper bounds and excluded surround;
2. every writing island and line band, including marginal and diagonal text;
3. directed line order and directed reading order;
4. source-to-upright transforms;
5. rejectable transcript proposals or a transcription-stage result; and
6. a generic full-page ink proposal with exact retained/suppressed accounting.

The first walkthrough renders this as the current blocked work item for an
unprepared source. That blocker is a useful result: it identifies the first real
tool we need to build rather than hiding it behind a pre-existing page record.

## Desktop structure

- **Header:** source identity, session, current stage, provenance badge, revision.
- **Left rail:** ordered stage graph, completed receipts, loops, blockers, and the
  exact next transition. The rail does not scroll the evidence pane.
- **Center:** one authoritative evidence scroll area. Source imagery stays large;
  overlays and transforms are reversible views over the same immutable pixels.
- **Right panel:** `Action`, `Instructions`, `Inspector`, and `Notebook` tabs.
- **Mobile:** one section at a time with a pinned stage/action summary and an
  unsaved-note guard before navigation.

## Stage interaction

### Source selection and preparation

The image picker displays only resolved catalog entries. Selection creates a new
isolated session; it never writes into an agent benchmark run. The source screen
shows the full image and capability report. A prepared source may explicitly
start its named protocol. An unprepared source stays at the missing-preparation
work item and can collect notes/screenshots there.

### Visible-span inventory (Stage A)

The transcript and detector regions are physically absent. The person draws
ordered rough rectangles on the upright/plain evidence, then records visual
kind, word-count range, boundary status, uncertainty flags, and an evidence note.
The UI builds the strict decision object and the existing validator owns
acceptance. `Defer line` is visibly marked as a downstream blocker because the
current adapter cannot resolve or requeue it.

### Many-to-many alignment (Stage B)

The stable Stage-A spans, rejectable transcript nodes, untrusted proposal nodes,
and allocated IDs are shown as separate node families. The person creates word
units, connects each to one source span, optionally connects transcript and
proposal nodes, and gives every unconnected node an explicit gap reason. The UI
may compute edge tables and gap rows, but the existing strict graph validator
owns acceptance.

### Ownership, residual, and envelope

These stages reuse their existing engines only after the same session has
actually produced the required inputs. A deterministic transition receipt is
shown between stages. Missing bridges are rendered as blockers, not simulated
successes.

## Observation record

Every note binds to session ID, source hash, stage, item, revision, agent-turn
hash, active evidence, and UI version. It supports text, category, severity, and
one or more validated screenshots. Automatic telemetry records packet open,
dwell, view changes, drawing/edit operations, validation failures, context or
transform requests, successful transitions, and stage exit. A summary surfaces
the slowest items, retried actions, and repeatedly requested missing tools.

## Acceptance gates

- Selecting an arbitrary archive image cannot expose transcript, detector, or
  prior review values and cannot skip the missing preparation stage.
- Starting prepared 014 creates a fresh isolated workflow and its first public
  Stage-A image is transcript/detector blind.
- The instructions, schema, packet, and every evidence file shown in Agent view
  match their turn manifest hashes.
- A stale or illegal submission cannot advance the current stage.
- A valid Stage-A submission advances to Stage B for the same line; a valid
  Stage-B submission advances to Stage A for the next line.
- Notes and screenshots survive stage transitions without mutating decisions.
- The UI never presents a legacy recording, deterministic receipt, or missing
  transition as a live agent turn.
