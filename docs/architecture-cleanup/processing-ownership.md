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
| `worker.ts` polling loop | Worker process | Transcription, metadata, entity extraction | Queries `PENDING` rows and invokes the pipeline directly | Worker availability is persisted. Main transcription has a run-bound database-clock lease and heartbeat; the worker runs stage-contained main/extra reconciliation at startup and every 60 seconds. Exit decisions project only authoritative main-transcription work, wait for an in-flight queued lease, recheck before relinquishing availability, and fail if that strict handoff fails. |
| `POST /admin/letters/processing/processes/:key/start` | API process | Transcription, metadata, entity extraction, extra content | `processes/runner.ts` starts a fire-and-forget in-memory batch through `letter-process-helpers.ts` | Pause, abort, progress, and the batch mutex live only in API memory. Extra-content attempts have a persisted, run-ID-bound database-clock lease and explicit queued/requested intent. |
| Legacy processing endpoints and post-upload auto-start | Worker in configured production, otherwise API process | Transcription, metadata, entity extraction | `processing-queue.ts` triggers a Cloud Run Job when configured and otherwise falls back to `processLettersAsync()` | Legacy pause, abort, and progress live only in API memory. API and worker safely reconcile leased main/extra attempts; blind metadata/entity startup resets have been removed. The API re-derives configured-worker wakeups from durable eligible `PENDING` transcription state. |
| Bulk transcription and metadata operations | Worker in configured production, otherwise API process | Transcription, metadata | `bulk-operations.ts` repeats the Cloud Run versus `processLettersAsync()` choice | Uses the same legacy in-memory state but bypasses `startQueuedProcessing()` |
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Main transcription and extra content share their respective canonical persisted ownership/lease boundaries with batch and automatic work. |

The transcription and extra-content lifecycle helpers own their compare-and-swap claims
and terminal publication. The process registry's shared runner adds UI lifecycle state
around those functions; it is not a durable job runner.

## Recovery Coverage

Main transcription and extra content now have durable, stage-specific liveness
contracts. Both claims store a run ID, a PostgreSQL-clock lease expiry, explicit
`QUEUED` or `REQUESTED` intent, and a lease-run binding to the run that created that
metadata. Both canonical producers use the same immediate,
non-overlapping heartbeat scheduler, but their claims, terminal writes, and recovery
policies remain separate.

Only an exact clean run with a live lease may publish. Main queued expiry returns to
`PENDING`/`UPLOADED`; main requested expiry becomes visibly `FAILED` in place. Extra
dirty expiry always requeues, clean queued expiry requeues, and clean requested expiry
fails without replacing previously committed content or verification. Unknown legacy
unleased attempts—and either stage's attempts whose lease binding does not match the
current run—remain visible for exact-run administrative cancellation.

A serialized composite coordinator runs at API and worker startup and every 60
seconds. It invokes main and extra reconciliation sequentially with independent error
containment, so failure in one stage does not suppress the other and same-table recovery
does not create avoidable lock ordering. Conditional `UPDATE ... RETURNING` operations
make overlapping API/worker reconcilers report and transition each expiry once.

After API reconciliation, configured-worker wakeup is level-triggered: the API asks the
database whether eligible main transcription remains `PENDING`, awaits the Cloud Run
trigger, and retries on a later tick if the trigger fails. A Cloud Run exit-when-empty
worker projects only main-transcription recovery/leases into its exit decision; extra
recovery alone cannot keep it alive. It waits for a queued lease it can observe,
rechecks before relinquishing worker availability, and propagates a failed relinquish
so the job exits nonzero.

The old startup reset of `RUNNING` metadata and entity rows remains deleted. Those
stages do not yet have a run token or lease, so an orphan stays visible for deliberate
intervention instead of being silently made claimable again.

| Failure | Current result |
| --- | --- |
| API restarts while a worker transcribes | Only an expired, run-bound authoritative attempt is reconciled; an active heartbeat remains authoritative |
| API crashes during queued transcription | Expiry returns the attempt to durable `PENDING`; periodic API reconciliation re-derives and retries configured-worker wakeup |
| API crashes during requested transcription | Expiry makes the attempt visibly `FAILED` in place rather than silently converting it to queued work |
| API crashes during extra-content work | Dirty or queued expiry requeues; clean requested expiry fails in place. Legacy or lease-mismatched attempts remain manual |
| API or worker crashes during metadata/entity work | The row remains `RUNNING` and visible; automatic recovery is deferred until these stages have fenced lifecycle owners |
| Two reconcilers overlap | Exact expired-lease compare-and-swap lets only one report and transition an attempt; one stage failure does not suppress the other |
| Legacy unleased or lease-mismatched main/extra attempt is encountered | It remains visible for exact-run cancellation; automatic recovery does not invent or misattribute liveness evidence |

API startup still calls the safe processing reconciler because API-owned execution has
not yet been removed. Recovery can become worker-only after batch execution becomes
worker-only; that executor migration remains a separate simplification.

## Extra-Content Ownership Repair

Extra content now has one lifecycle boundary shared by automatic transcription,
regeneration, the direct route, and dashboard batches:

- related T/C/E eligibility is established before a claim;
- automatic work claims only `PENDING`; explicit regeneration may replace a completed
  result, and every claim compares the revision observed during preflight;
- one persisted run ID fences every active attempt, and a separate lease-run field
  binds the lease and claim kind to that exact run;
- every current claim receives a PostgreSQL-clock lease and starts an immediate,
  serialized heartbeat through the shared scheduler;
- database checks require `RUNNING` exactly when a run ID exists, and allow dirty
  source state only while that attempt is running;
- producers return patches and cannot write letter content directly;
- content plus `SUCCESS` is committed in one run-ID-guarded update;
- page persistence and invalidation share a transaction. Once that transaction commits,
  an older source result cannot remain terminal `SUCCESS`; it is requeued if the AI
  publication serialized first;
- human edits, clears, and verification changes atomically close the job as
  `SUCCESS` and clear its complete ownership tuple. Human edits clear verification
  metadata, while verification compares the content revision the reviewer observed;
- dashboard ownership loss is `skipped`, not a false completion or failure;
- regeneration suppresses the automatic producer and runs its optional producer once.

Expired dirty and queued attempts return to `PENDING`; an expired clean requested
attempt becomes `FAILED` without replacing prior content. Recovery additionally
requires the persisted lease-run binding to equal the current run ID, so an older
binary cannot make its inherited lease fields authoritative for a replacement run.
Forced file replacement still precedes the database transaction and cannot be rolled
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
The producer starts an immediate, serialized heartbeat, and exact run ID, matching
lease-run binding, and a live lease are required for renewal and terminal publication.
Recovery likewise requires binding equality before applying queued/requested policy.
Cancellation and human replacement revoke the entire ownership tuple atomically.

The binding column is nullable, unbackfilled, and temporarily unconstrained for rolling
compatibility. The immediately previous revision knows how to clear expiry/kind but
cannot clear the new binding; a database shape check would reject that legitimate
terminal write even if declared `NOT VALID`. New claims overwrite binding-only residue,
while automatic ownership ignores unbound or mismatched metadata. Cancellation trusts
intent only for a matching binding; otherwise `TRANSCRIBING` returns to `UPLOADED` and
other current workflows are preserved.

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
4. **Completed in Slice 006:** apply a stage-specific, run-bound lease to the already-
   fenced extra-content lifecycle, share only heartbeat/reconciliation scheduling, and
   make configured-worker wakeups level-triggered from durable queue state.
5. **Completed in Slice 007:** bind main-transcription lease metadata to the run that
   created it, ignore inherited metadata automatically, and keep safe exact-run manual
   cancellation during mixed-version overlap.
6. **Slice 008:** give metadata one fenced claim/terminal publication owner before
   considering a lease. Follow with a separate retry-safe entity lifecycle boundary.
7. Move batch entry points to enqueue/trigger only, then delete the API registry runner
   and legacy in-process batch loop once no caller executes through them.
8. With the worker as the sole batch owner, make recovery worker-owned, consolidate
   eligibility queries, and keep direct request-owned regeneration as an explicitly
   separate contract if the UI still requires synchronous completion.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
