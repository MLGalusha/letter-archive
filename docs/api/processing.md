# Processing API

Routes: `backend/src/routes/admin/letters/processing.ts` and
`backend/src/routes/admin/letters/processes.ts`

All routes are prefixed with `/admin/processing`.

## Worker-Owned Queue

### GET /queue

Returns the durable active, queued, and recent transcription, metadata, and entity
projection.

### POST /start-transcription
### POST /start-metadata
### POST /start-entities

Body: optional collection, visibility, search, and date filters.

These endpoints do not execute AI work in the API process. They count eligible durable
`PENDING` rows and optionally wake the configured Cloud Run worker. A successful
request with work returns:

```json
{
  "message": "Worker requested; matching letters are already queued",
  "total": 20
}
```

Filters scope only this count and whether the API requests a wake. They are not a
persisted batch selection: the worker polls the global durable queue and may consume
other eligible rows. The response intentionally says “matching letters” rather than
claiming the eventual worker execution is filter-scoped.

Local development must run `npm run worker` separately.

Transcription eligibility requires a transcribable type, at least one page, an uploaded
pending workflow, idle downstream stages, a valid claim tuple, and a non-dead-letter
row. Metadata eligibility requires letter type, `TRANSCRIBED` workflow, a confirmed,
non-empty transcript, idle downstream stages, a clear ownership tuple, and a
non-dead-letter row. Entity eligibility requires successful metadata and a pending,
non-dead-letter entity stage. Enqueue/reset/retry paths, the API snapshot, worker
poller, configured-worker wake check, and worker exit recheck reuse these stage
prerequisites.

### POST /cancel
### POST /queue/remove
### POST /queue/clear
### POST /queue/retry

These mutate persisted queue state. Job types are `transcription`, `metadata`, and
`entity_extraction`. Retry clears the stage's stale ownership and dead-letter state
before requesting a worker wake.

The old process-local `/status`, `/pause`, `/resume`, and `/abort` endpoints were
retired with the duplicate in-process executor.

## Temporary Process Registry

The admin Processing page currently uses a separate API-memory registry runner:

- `GET /snapshot`
- `GET /processes/:key/eligibility`
- `GET /processes/:key/queue`
- `GET /processes/:key/recent`
- `POST /processes/:key/start`
- `POST /batch/pause`, `/batch/resume`, `/batch/abort`
- process-scoped queue remove, clear, retry, and cancel routes

Its progress, mutex, pause, and abort state are process-local. It is intentionally
separate from worker availability and is the next executor scheduled for retirement;
clients must not treat its controls as durable worker controls.

## Recovery and Ownership

Transcription and metadata claims use persisted run IDs, claim kinds, database-clock
leases, lease-run bindings, and exact terminal compare-and-set writes. Extra-content
work has its own equivalent lifecycle. Entity extraction has a run/revision publication
fence but no lease; an orphan remains visible for exact administrative cancellation
instead of being guessed dead.

The API and worker currently run the shared lease reconciler. A configured-worker wake
is derived from durable eligible queue state after reconciliation. Recovery can become
worker-only after the remaining registry executor is removed.
