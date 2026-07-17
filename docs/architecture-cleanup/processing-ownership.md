# Processing Ownership Map

Last verified: July 17, 2026

This is a map of the queue-backed processing stages that exist today, not every API
action that happens to call AI and not the intended end state. The lightweight boundary
test at `backend/src/services/__tests__/processing-ownership.architecture.test.ts`
guards known stage-entrypoint names, canonical claim callers, direct `RUNNING` writes,
and recovery calls. It is a review tripwire rather than an AST-level proof: deleting an
existing owner remains frictionless, while behavior tests remain the authority.

## Current Execution Paths

| Entry point | Runtime owner | Stages | Execution model | Control and recovery |
| --- | --- | --- | --- | --- |
| `worker.ts` polling loop | Worker process | Transcription, metadata, entity extraction | Queries `PENDING` rows and invokes the pipeline directly | Worker availability is persisted; transcription attempts have their own database-clock lease and heartbeat. Expired transcription leases are reconciled at startup and every 60 seconds. Exit-when-empty waits for an in-flight queued lease, rechecks before relinquishing availability, and exits nonzero if that strict handoff fails. |
| `POST /admin/letters/processing/processes/:key/start` | API process | Transcription, metadata, entity extraction, extra content | `processes/runner.ts` starts a fire-and-forget in-memory batch through `letter-process-helpers.ts` | Pause, abort, progress, and the batch mutex live only in API memory; extra-content attempts additionally use a persisted run-ID fence |
| Legacy processing endpoints and post-upload auto-start | Worker in configured production, otherwise API process | Transcription, metadata, entity extraction | `processing-queue.ts` triggers a Cloud Run Job when configured and otherwise falls back to `processLettersAsync()` | Legacy pause, abort, and progress live only in API memory. API startup and the worker safely reconcile expired leased transcription attempts; blind metadata/entity startup resets have been removed. |
| Bulk transcription and metadata operations | Worker in configured production, otherwise API process | Transcription, metadata | `bulk-operations.ts` repeats the Cloud Run versus `processLettersAsync()` choice | Uses the same legacy in-memory state but bypasses `startQueuedProcessing()` |
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Main transcription and extra content share their respective canonical, persisted run-ID owners with batch/automatic work |

The transcription and extra-content lifecycle helpers own their compare-and-swap claims
and terminal publication. The process registry's shared runner adds UI lifecycle state
around those functions; it is not a durable job runner.

## Recovery Coverage

Main transcription is the first stage with a durable liveness contract. A claim stores
a run ID, a PostgreSQL-clock lease expiry, and a `QUEUED` or `REQUESTED` claim kind.
The canonical producer renews that lease with one non-overlapping heartbeat and must
still own the exact live lease to publish success or failure. Recovery changes only a
provably expired leased attempt: queued work returns to `PENDING`/`UPLOADED`, while
requested work becomes visibly `FAILED` without discarding its previous content or
workflow. A rolling-deployment-era `RUNNING` row without a lease remains visible but is
never guessed dead; an administrator can cancel it explicitly.

Safe transcription reconciliation runs at API startup while API-owned execution still
exists, and at worker startup plus every 60 seconds. A Cloud Run exit-when-empty worker
waits for a queued lease it can observe, rechecks the queue before relinquishing worker
availability, and propagates a failed relinquish so the job exits nonzero. The deployment
retains three job retries. Two reconcilers can race, but conditional updates return each
expired attempt only once.

The old startup reset of `RUNNING` metadata and entity rows was deleted. Those stages do
not yet have a run token or lease, so resetting them merely because another process
started could duplicate live work. Until their lifecycle owners are repaired, an
orphaned `RUNNING` row stays visible for deliberate intervention instead of being
silently made claimable again. Extra content has a run-ID fence but still has no lease.

| Failure | Current result |
| --- | --- |
| API restarts while a worker transcribes | Only an expired leased attempt is reconciled; an active heartbeat remains authoritative |
| API crashes during queued transcription | The expired lease is returned to `PENDING` for a later worker attempt |
| API crashes during requested transcription | The expired lease becomes `FAILED` in place; it is not silently converted to queued work |
| API or worker crashes during metadata/entity work | The row remains `RUNNING` and visible; automatic recovery is intentionally deferred until these stages have fenced lifecycle owners |
| API crashes during extra-content work | The run ID prevents stale publication, but no lease yet recovers the abandoned attempt |
| Two reconcilers overlap | Exact expired-lease compare-and-swap lets only one report and transition an attempt |
| Legacy unleased transcription is encountered | It remains visible for explicit cancellation; automatic recovery does not invent liveness evidence |

API startup still calls the safe transcription reconciler because API-owned execution
has not yet been removed. Recovery can become worker-only after batch execution becomes
worker-only; that executor migration remains a separate simplification.

## Extra-Content Ownership Repair

Extra content now has one lifecycle boundary shared by automatic transcription,
regeneration, the direct route, and dashboard batches:

- related T/C/E eligibility is established before a claim;
- automatic work claims only `PENDING`; explicit regeneration may replace a completed
  result, and every claim compares the revision observed during preflight;
- one persisted run ID fences every active attempt;
- database checks require `RUNNING` exactly when a run ID exists, and allow dirty
  source state only while that attempt is running;
- producers return patches and cannot write letter content directly;
- content plus `SUCCESS` is committed in one run-ID-guarded update;
- page persistence and invalidation share a transaction. Once that transaction commits,
  an older source result cannot remain terminal `SUCCESS`; it is requeued if the AI
  publication serialized first;
- human edits, clears, and verification changes atomically close the job as
  `SUCCESS` and clear its run ID. Human edits clear verification metadata, while
  verification compares the content revision the reviewer observed;
- dashboard ownership loss is `skipped`, not a false completion or failure;
- regeneration suppresses the automatic producer and runs its optional producer once.

The run ID is a fence, not a lease. There is still no expiry, heartbeat, or automatic
recovery for an extra-content attempt whose process crashes while `RUNNING`.
Forced file replacement also precedes the database transaction and cannot be rolled
back with it; that broader filesystem/database compensation gap remains ingestion debt.

## Main-Transcription Ownership Repair

Queue work, the polling worker, dashboard batches, letter-only transcription, and main
transcription regeneration now enter one canonical producer:

- automatic work claims only an eligible `PENDING` row and compares the workflow,
  dead-letter flag, attempt state, and observed transcript content state;
- direct request work uses a separate explicit claim policy but the same producer, and
  keeps its existing no-extras contract;
- every active attempt has a persisted run ID. Completion, failure, and cancellation
  must still own that run ID before changing terminal state;
- page sources are reloaded after the claim so work does not continue from the preflight
  page snapshot;
- human transcript writes revoke an active AI attempt before publishing the human value;
- ownership loss and stale eligibility propagate as `skipped`, so the worker and both
  batch reporters do not announce a false transcription success.

Each new claim now also stores a database-clock expiry and queued/requested claim kind.
The producer starts an immediate, serialized heartbeat, and exact run ID plus a live
lease is required for renewal and terminal publication. Recovery can therefore act on
expired attempts without treating process startup as evidence of death. Cancellation
and human replacement revoke the entire ownership tuple atomically.

Main transcription is also excluded from downstream work in both application claims
and a rollout-safe database check. The check is `NOT VALID`: it blocks every newly
introduced main-versus-downstream `RUNNING` conflict without making deployment fail on
a legacy conflicting row. Metadata success and its `METADATA_DRAFTED` workflow publish
atomically, and entity extraction can claim only exact metadata `SUCCESS`. Route and
bulk reset paths use conditional updates rather than briefly reopening all stages.

## Safe Simplification Sequence

1. **Completed in Slice 003:** give extra-content work a tested, fenced
   `PENDING` → `RUNNING` → terminal lifecycle, including source invalidation and
   cancellation-safe content publication.
2. **Completed in Slice 004:** replace the duplicate letter-only producer with the
   canonical transcription pipeline, add per-attempt run-ID fencing, and preserve its
   no-extras request contract.
3. **Completed in Slice 005:** add a database-clock lease and heartbeat at the canonical main-
   transcription owner, persist queued versus requested recovery semantics, and make
   transcription recovery expiry-aware. During rollout, an unleased `RUNNING` row is
   unknown and must not be reset automatically.
4. **Slice 006:** apply the same stage-specific lease only to the already-fenced extra-
   content lifecycle. Metadata and entity extraction first need canonical terminal
   owners, and entity persistence must become retry-safe.
5. Move batch entry points to enqueue/trigger only, then delete the API registry runner
   and legacy in-process batch loop once no caller executes through them.
6. With the worker as the sole batch owner, make recovery worker-owned, consolidate
   eligibility queries, and keep direct request-owned regeneration as an explicitly
   separate contract if the UI still requires synchronous completion.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
