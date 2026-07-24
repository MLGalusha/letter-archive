# Processing API

Route: `backend/src/routes/admin/letters/processing.ts`

All routes are prefixed with `/admin/processing`.

## Worker-Owned Queue

### GET /queue

Returns durable active and queued transcription, extra-content, metadata, and entity
state; recent main-stage activity; and persisted worker observation. Extra content does
not yet have a stage-specific queue/completion timestamp, so its queued timestamp is
`null` and it is omitted from recent activity rather than borrowing the letter-wide
timestamp.

### POST /wake

Request a global worker drain after rechecking the complete durable queue. The endpoint
accepts no stage and no filters because worker execution is not scoped to a temporary
batch:

```json
{ "requested": true }
```

When there is no durable work or no configured production worker job, the response is
respectively `{ "requested": false, "reason": "queue_empty" }` or
`{ "requested": false, "reason": "worker_not_configured" }`. Trigger failures surface
as request errors. Local development must run `npm run worker` separately.

Transcription eligibility requires a transcribable type, at least one page, an uploaded
pending workflow, idle downstream stages, a valid claim tuple, and a non-dead-letter
row. Metadata eligibility requires letter type, `TRANSCRIBED` workflow, a confirmed,
non-empty transcript, idle downstream stages, a clear ownership tuple, and a
non-dead-letter row. Entity eligibility requires successful metadata and a pending,
non-dead-letter entity stage. Extra-content eligibility requires a primary L record
with a related T/C/E source and a pending extra-content stage. Enqueue/reset/retry
paths, the durable queue snapshot, worker poller, configured-worker wake check, and
worker exit recheck reuse these stage prerequisites.

### POST /cancel
### POST /queue/remove
### POST /queue/clear
### POST /queue/retry

These mutate persisted queue state. Job types are `transcription`, `metadata`,
`entity_extraction`, and `extra_content`. Retry clears the stage's stale ownership
tuple (and dead-letter state where applicable) before requesting a worker wake.

The old filtered starts, registry snapshot/routes, process SSE, process-local
status/pause/resume/abort controls, and in-memory progress map were retired with the
duplicate API executor. The Processing page polls this durable projection directly and
does not recreate their capability or batch abstractions.

## Recovery and Ownership

Transcription and metadata claims use persisted run IDs, claim kinds, database-clock
leases, lease-run bindings, and exact terminal compare-and-set writes. Extra-content
work has its own equivalent lifecycle. Entity extraction has a run/revision publication
fence but no lease; an orphan remains visible for exact administrative cancellation
instead of being guessed dead.

The API and worker currently run the shared lease reconciler. A configured-worker wake
is derived from durable eligible queue state after reconciliation. API reconciliation
remains transitional even though batch execution is worker-only: worker availability
still needs a token-fenced execution lease and an external scheduled wake before
recovery can safely move entirely out of the API process.
