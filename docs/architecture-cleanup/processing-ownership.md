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
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Extra content uses the same persisted run-ID owner as batch/automatic work; other direct actions retain the mixed claim behavior described below |

The pipeline functions themselves own most compare-and-swap claims and terminal status
updates. The process registry's shared runner adds UI lifecycle state around those
functions; it is not a durable job runner.

## Recovery Coverage

`recoverOrphanedJobs()` currently resets every `RUNNING` transcription, metadata, and
entity-extraction row to `PENDING`, regardless of which process owns it or whether that
owner is still alive. It runs at both API and worker startup.

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

## Safe Simplification Sequence

1. **Completed in Slice 003:** give extra-content work a tested, fenced
   `PENDING` → `RUNNING` → terminal lifecycle, including source invalidation and
   cancellation-safe content publication.
2. Make letter-only transcription acquire a claim before performing AI work, then
   characterize whether its duplicate pipeline can be replaced by the canonical
   transcription pipeline without changing its no-extras contract.
3. Add durable, stage-specific execution leases. Instrument every existing executor
   before changing recovery; during rollout, an unleased `RUNNING` row is unknown and
   must not be reset automatically.
4. Make recovery expiry-aware and periodic. Recovery must acquire the expired lease and
   re-read job status before resetting it.
5. Move batch entry points to enqueue/trigger only, then delete the API registry runner
   and legacy in-process batch loop once no caller executes through them.
6. With the worker as the sole batch owner, consolidate eligibility queries and keep
   direct request-owned regeneration as an explicitly separate contract if the UI
   still requires synchronous completion.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
