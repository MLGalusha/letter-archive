# Processing Ownership Map

Last verified: July 23, 2026

This is a map of the queue-backed processing stages that exist today, not every API
action that happens to call AI and not the intended end state. The lightweight boundary
test at `backend/src/services/__tests__/processing-ownership.architecture.test.ts`
guards known stage-entrypoint names, canonical claim callers, direct `RUNNING` writes,
and recovery calls. It is a review tripwire rather than an AST-level proof: deleting an
existing owner remains frictionless, while behavior tests remain the authority.

## Current Execution Paths

| Entry point | Runtime owner | Stages | Execution model | Control and recovery |
| --- | --- | --- | --- | --- |
| `worker.ts` polling loop | Worker process | Transcription, extra content, metadata, entity extraction | Queries durable eligible `PENDING` rows and invokes the pipeline directly | Worker availability is persisted but does not yet carry an execution owner token. Transcription, extra content, and metadata have run-bound database-clock leases and heartbeats; entity extraction has a run/revision commit fence but no lease. Polling, wake checks, queue snapshots, and both exit checks share stage-specific eligibility. The worker publishes idle before its final recheck so stage-only work cannot disappear in the handoff. |
| `POST /admin/processing/processes/:key/start` | API process | Transcription, metadata, entity extraction, extra content | `processes/runner.ts` starts a fire-and-forget in-memory batch through `letter-process-helpers.ts` | Pause, abort, progress, and the batch mutex live only in API memory. Transcription, metadata, and extra-content attempts have persisted, run-ID-bound database-clock leases and explicit queued/requested intent. |
| Filtered starts and post-upload auto-start | Worker process | Transcription, extra content, metadata, entity extraction | The API counts or observes durable eligible rows and optionally wakes the configured Cloud Run Job; local development relies on the separately running worker | No legacy process-local execution or controls remain. Filters scope the reported count and wake decision, not the worker's global drain. Upload auto-processing and recovery use the complete four-stage durable predicate. |
| Bulk transcription and metadata operations | Worker process | Transcription, metadata | Guarded updates reset only exact observed eligible rows to durable `PENDING`, then optionally wake the configured worker | Full source/job compare-and-set prevents a stale selection from reporting stranded work. Metadata never bypasses transcript confirmation. |
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Transcription, metadata, and extra content share their respective canonical persisted ownership/lease boundaries with batch and automatic work. |

The transcription, metadata, and extra-content lifecycle helpers own their
compare-and-swap claims and terminal publication. Entity extraction separately owns an
atomic run/revision projection commit. The process registry's shared runner adds UI
lifecycle state around those functions; it is not a durable job runner.

## Recovery Coverage

Main transcription, metadata, and extra content now have durable, stage-specific
liveness contracts. Every claim stores a run ID, a PostgreSQL-clock lease expiry, explicit
`QUEUED` or `REQUESTED` intent, and a lease-run binding to the run that created that
metadata. All three canonical producers use the same immediate,
non-overlapping heartbeat scheduler, but their claims, terminal writes, and recovery
policies remain separate.

Only an exact clean run with a live lease may publish. Main queued expiry returns to
`PENDING`/`UPLOADED`; main requested expiry becomes visibly `FAILED` in place. Metadata
queued expiry returns to `PENDING`/`TRANSCRIBED`; requested expiry fails while preserving
committed metadata and restores its prior content-stage workflow. Extra
dirty expiry always requeues, clean queued expiry requeues, and clean requested expiry
fails without replacing previously committed content or verification. Unknown legacy
unleased attempts—and any stage's attempts whose lease binding does not match the
current run—remain visible for exact-run administrative cancellation.

A serialized composite coordinator runs at API and worker startup and every 60
seconds. It invokes transcription, metadata, and extra reconciliation sequentially with independent error
containment, so failure in one stage does not suppress the other and same-table recovery
does not create avoidable lock ordering. Conditional `UPDATE ... RETURNING` operations
make overlapping API/worker reconcilers report and transition each expiry once.

After API reconciliation, configured-worker wakeup is level-triggered: the API asks the
database whether eligible transcription, extra-content, metadata, or entity work remains `PENDING`,
awaits the Cloud Run trigger, and retries on a later tick if the trigger fails. A Cloud
Run exit-when-empty worker projects queued transcription, metadata, and extra-content
recovery/leases plus all four stages' current pending state into its exit decision.
It also waits for a dirty requested extra-content lease because expiry converts that
attempt into queued worker work. It publishes idle,
then repeats reconciliation and the durable queue check. A failed required idle write
propagates so the job exits nonzero, while successful/rejected duplicate cleanup is
memoized inside one execution. The deployment supplies the worker job identity so a
final non-empty recheck can request a successor execution.

That availability row is not yet fenced across worker executions. A main or metadata
AI call can outlive the two-minute freshness window because availability is currently
published around work, not continuously during it. The API can then request an
overlapping execution, and either execution can overwrite the singleton availability
row. Stage run IDs still prevent stale content publication, so the residual is
redundant execution and inaccurate availability rather than an unfenced content
commit. The registry-removal slice must add an execution-owned availability
compare-and-set or equivalent continuously renewed lease.

The old startup reset remains deleted. Entity extraction now has a run token and
reserved revision, so only its exact owner can publish a replacement projection. It
still has no lease, so a current entity orphan stays visible for exact administrative
cancellation instead of being silently made claimable again. Migration-era tokenless
entity attempts follow an explicit drain/cancel contract. Rollout-era tokenless
metadata attempts are likewise kept manual until old executables have drained.

| Failure | Current result |
| --- | --- |
| API restarts while a worker transcribes | Only an expired, run-bound authoritative attempt is reconciled; an active heartbeat remains authoritative |
| API crashes during queued transcription | Expiry returns the attempt to durable `PENDING`; periodic API reconciliation re-derives and retries configured-worker wakeup |
| API crashes during requested transcription | Expiry makes the attempt visibly `FAILED` in place rather than silently converting it to queued work |
| API crashes during extra-content work | Dirty or queued expiry requeues and keeps/drives the worker drain; clean requested expiry fails in place. Legacy or lease-mismatched attempts remain manual |
| API or worker crashes during metadata work | Queued expiry requeues; requested expiry fails without replacing committed metadata. Legacy tokenless attempts remain manual |
| API or worker crashes during current entity work | The exact run remains `RUNNING` and visible; its incomplete materialization rolls back, and automatic recovery remains deferred until the stage has a lease |
| Old entity executor is still running during migration 0051 | It may drain its already-claimed tokenless attempt; new tokenless claims are rejected and its output is database-stamped as one candidate revision |
| Drained/terminated old entity executor left a tokenless orphan | Exact legacy cancellation discards only its abandoned candidate revision before a current retry can reuse that revision |
| Two reconcilers overlap | Exact expired-lease compare-and-swap lets only one report and transition an attempt; one stage failure does not suppress the other |
| A worker AI call outlives the availability freshness window | Stage ownership fences content, but the ownerless availability singleton can cause a redundant worker launch and competing status writes; execution-owned availability remains Slice 011 work |
| Legacy unleased or lease-mismatched transcription/metadata/extra attempt is encountered | It remains visible for deliberate reconciliation or exact-run cancellation; automatic recovery does not invent or misattribute liveness evidence |

API startup still calls the safe processing reconciler because the process-registry
runner remains an API-owned batch executor. Recovery can become worker-only after that
last automatic API executor is removed.

## Entity-Extraction Ownership Repair

Entity extraction now preserves the last committed public projection while a
replacement is in flight:

- a claim stores a unique run ID and reserves `committed revision + 1`;
- AI materialization and terminal publication share one database transaction;
- the transaction deletes only the prior extraction-owned projection, preserves human
  rows, writes every child row with the reserved revision, and publishes the letter
  JSON/status/revision only while the exact run still owns the claim;
- ambiguous revisionless conflicts abort instead of producing a false success;
- public entity queries trust either explicit human confirmation or exact current
  extraction provenance backed by the discovery letter's committed JSON;
- merge collision, merge undo, manual relationship confirmation, and participant sync
  preserve or deliberately replace one complete content/provenance tuple;
- identity metadata plus its participant projection commit atomically.

Migration 0051 is deliberately expand/drain rather than pretending old processes know
the new fields. It rejects new tokenless claims, stamps output from a pre-existing
tokenless run, atomically promotes that output on legacy success, rejects an old
terminal write over a current owner, and discards an abandoned candidate on
legacy failure/cancellation. Operationally, old entity executors must finish or be
terminated before tokenless leftovers are cancelled and new claimers are started.

This stage is fenced but not leased. Adding a lease is not the immediate next step:
first remove the duplicate API batch executors so one runtime owns automatic work.

## Extra-Content Ownership Repair

Extra content now has one lifecycle boundary shared by worker queues, automatic
transcription, regeneration, the direct route, and the temporary dashboard batches:

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

Migration 0044 initialized historical rows as `PENDING`. Now that the worker treats an
L record with related T/C/E sources as ordinary durable queued work, deployment must
first inspect that historical eligible count and deliberately accept or reconcile the
resulting AI backlog. This checkpoint changes repository code only; it does not deploy
or launch external worker executions.

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
6. **Completed in Slice 008:** give metadata one revision-bound claim/publication
   owner, database-clock lease and shared heartbeat, queued/requested expiry policy,
   exact administrative cancellation, and rolling-deploy tokenless compatibility.
   Follow with a separate retry-safe entity lifecycle boundary.
7. **Completed in Slice 009:** give entity extraction a run/revision claim, atomic
   projection replacement, public provenance boundary, merge/undo integrity, and an
   explicit mixed-version drain contract.
8. **Completed in Slice 010:** move legacy batch entry points to enqueue/trigger only,
   delete `processLettersAsync()` plus its process-local control state, centralize the
   three worker eligibility predicates, and close the entity-only exit handoff.
9. Delete the API registry executor after its route/UI contract is characterized.
   With the worker as the sole batch owner, make recovery worker-owned, consolidate
   eligibility queries, and keep direct request-owned regeneration as an explicitly
   separate contract if the UI still requires synchronous completion.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
