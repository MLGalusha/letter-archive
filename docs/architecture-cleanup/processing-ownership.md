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
| `worker.ts` polling loop | Worker process | Transcription, metadata, entity extraction | Queries `PENDING` rows and invokes the pipeline directly | Heartbeat is persisted; recovery runs once at worker startup |
| `POST /admin/letters/processing/processes/:key/start` | API process | Transcription, metadata, entity extraction, extra content | `processes/runner.ts` starts a fire-and-forget in-memory batch through `letter-process-helpers.ts` | Pause, abort, progress, and the batch mutex live only in API memory; extra-content attempts additionally use a persisted run-ID fence |
| Legacy processing endpoints and post-upload auto-start | Worker in configured production, otherwise API process | Transcription, metadata, entity extraction | `processing-queue.ts` triggers a Cloud Run Job when configured and otherwise falls back to `processLettersAsync()` | Legacy pause, abort, and progress live only in API memory; API and worker startup both run recovery |
| Bulk transcription and metadata operations | Worker in configured production, otherwise API process | Transcription, metadata | `bulk-operations.ts` repeats the Cloud Run versus `processLettersAsync()` choice | Uses the same legacy in-memory state but bypasses `startQueuedProcessing()` |
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Main transcription and extra content share their respective canonical, persisted run-ID owners with batch/automatic work |

The transcription and extra-content lifecycle helpers own their compare-and-swap claims
and terminal publication. The process registry's shared runner adds UI lifecycle state
around those functions; it is not a durable job runner.

## Recovery Coverage

`recoverOrphanedJobs()` currently attempts to reset each `RUNNING` transcription,
metadata, and entity-extraction row to `PENDING`. Every update must still match
`RUNNING`; transcription also matches the observed run ID, so its stale startup snapshot
cannot overwrite a replacement attempt. Metadata and entity recovery remain status-only.
No stage has a lease or liveness signal, so recovery can reset the same attempt while its
owner is alive. Recovery runs at both API and worker startup.

| Failure | Current result |
| --- | --- |
| API restarts while a worker is active | API recovery can reset the worker's live job, making it claimable twice |
| API crashes during API-owned transcription, metadata, or entity work | A later API or worker startup resets the row |
| API crashes during extra-content work | No recovery covers `extraContentJobStatus` |
| Two workers overlap at startup | Either worker can reset work owned by the other |
| A long-running process stays alive after another process crashes | Recovery is startup-only, so an orphan can remain until a later restart |

Removing API recovery before removing API execution is therefore unsafe: it would
replace the duplicate-execution risk with indefinitely stuck API-owned jobs.

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

As with extra content, this run ID prevents stale publication but does not yet provide
lease expiry or a heartbeat. Startup recovery still resets a candidate when that same
observed run remains `RUNNING`, so it remains unsafe while valid work may be running
elsewhere.

## Safe Simplification Sequence

1. **Completed in Slice 003:** give extra-content work a tested, fenced
   `PENDING` → `RUNNING` → terminal lifecycle, including source invalidation and
   cancellation-safe content publication.
2. **Completed in Slice 004:** replace the duplicate letter-only producer with the
   canonical transcription pipeline, add per-attempt run-ID fencing, and preserve its
   no-extras request contract.
3. **Slice 005:** add a database-clock lease and heartbeat at the canonical main-
   transcription owner, persist queued versus requested recovery semantics, and make
   transcription recovery expiry-aware. During rollout, an unleased `RUNNING` row is
   unknown and must not be reset automatically.
4. Apply the same stage-specific lease only to lifecycles that already have fenced
   claims and publication. Extra content is ready next; metadata and entity extraction
   first need canonical terminal owners, and entity persistence must become retry-safe.
5. Move batch entry points to enqueue/trigger only, then delete the API registry runner
   and legacy in-process batch loop once no caller executes through them.
6. With the worker as the sole batch owner, make recovery worker-owned, consolidate
   eligibility queries, and keep direct request-owned regeneration as an explicitly
   separate contract if the UI still requires synchronous completion.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
