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
| `worker.ts` polling loop | Worker process | Transcription, extra content, metadata, entity extraction | Acquires the singleton worker execution lease, queries durable eligible `PENDING` rows, and invokes the pipeline directly | Acquisition uses the PostgreSQL clock and a 120-second lease; contenders that lose the atomic claim exit before recovery or queue scans. An independent heartbeat confirms ownership immediately and then every 30 seconds. Every automatic stage claim and worker recovery mutation includes the exact live execution token in the same SQL statement. Transcription, extra content, and metadata also have their own run-bound leases; entity extraction has a run/revision commit fence but no stage lease. |
| Upload, retry, and global wake | API producer / worker executor | Transcription, extra content, metadata, entity extraction | The API persists or observes durable eligible rows and optionally wakes the configured Cloud Run Job; local development relies on the separately running worker | No process-local execution or controls remain. The explicit admin wake has no stage or filter because every worker execution drains the global queue. All wake paths use the complete four-stage durable predicate and suppress a redundant trigger while a live worker execution lease exists. |
| Expired-stage recovery | API and worker during rollout | Transcription, extra content, metadata | A shared serialized coordinator applies each stage's queued/requested expiry policy | Worker mutations require its exact live global execution token in addition to the stage lease predicate. Transitional API recovery omits only that global worker-execution predicate until the scheduled worker wake is deployed and proven; stage compare-and-set rules keep concurrent reconcilers idempotent. |
| Bulk transcription and metadata operations | Worker process | Transcription, metadata | Guarded updates reset only exact observed eligible rows to durable `PENDING`, then optionally wake the configured worker | Full source/job compare-and-set prevents a stale selection from reporting stranded work. Metadata never bypasses transcript confirmation. |
| Letter content actions | API request process | Letter-only transcription, metadata, entity extraction, extra content | The route awaits pipeline or regeneration functions directly | Transcription, metadata, and extra content share their respective canonical persisted ownership/lease boundaries with batch and automatic work. |

The transcription, metadata, and extra-content lifecycle helpers own their
compare-and-swap claims and terminal publication. Entity extraction separately owns an
atomic run/revision projection commit. Automatic batch execution has no API-process
runner; the Processing page reads and mutates only durable state.

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
seconds. It invokes transcription, metadata, and extra reconciliation sequentially
with independent error containment, so failure in one stage does not suppress the
others and same-table recovery does not create avoidable lock ordering. Conditional
`UPDATE ... RETURNING` operations make overlapping API/worker reconcilers report and
transition each expiry once. The worker passes its current execution token through the
coordinator, and every worker recovery `UPDATE` also requires that token's unexpired
singleton row. The transitional API caller omits that additional predicate.

After API reconciliation, configured-worker wakeup is level-triggered: the API asks the
database whether eligible transcription, extra-content, metadata, or entity work remains `PENDING`,
awaits the Cloud Run trigger, and retries on a later tick if the trigger fails. A Cloud
Run exit-when-empty worker projects queued transcription, metadata, and extra-content
recovery/leases plus all four stages' current pending state into its exit decision. It
also waits for a dirty requested extra-content lease because expiry converts that
attempt into queued worker work. Once the empty decision is durable, cleanup stops
periodic recovery, stops the execution heartbeat, and releases only the exact execution
token. On normal completion after a successful release, it performs a required
post-release queue recheck/wake. That ordering closes work committed while producers
still observed the departing lease. Best-effort state reports are individually bounded
to five seconds and cannot indefinitely hold the required release behind one stuck
report.

The worker execution lease is now the availability authority. If renewal rejects the
token or the local confirmed lease window elapses, that process stops future scans,
claims, and recovery. Even if a preflight query raced the loss, every automatic stage
claim and recovery mutation rejects the stale token atomically. A stage already owned
when global ownership is lost may settle under its separate run/revision and stage
lease fence; global ownership is not substituted for the stage's publication contract.
SIGTERM similarly stops future work while allowing the current stage to settle. If it
cannot settle inside the eight-second shutdown buffer, the process exits nonzero and
leaves the global token to expire instead of releasing ownership while AI work may
still be active.

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
| Two worker executions launch concurrently | PostgreSQL grants the singleton execution lease to one; every loser exits before recovery, queue discovery, or a stage claim |
| A worker AI call runs longer than the old observation window | Independent renewal keeps the execution lease live; trigger paths see the live lease and contenders cannot begin automatic work |
| Global lease renewal is rejected or its locally confirmed window expires | The worker starts no new scan, claim, or recovery; atomic SQL rejects a stale-token race, while an already-owned stage may settle through its own publication fence |
| SIGTERM arrives during a long stage | Future work stops and ownership remains live while the stage drains; the eight-second forced path exits nonzero and leaves the token to expire rather than releasing early |
| Legacy unleased or lease-mismatched transcription/metadata/extra attempt is encountered | It remains visible for deliberate reconciliation or exact-run cancellation; automatic recovery does not invent or misattribute liveness evidence |

API startup still calls the safe processing reconciler even though the worker is now
the sole automatic executor. The execution-fencing boundary is closed, and an
OAuth-authenticated five-minute Cloud Scheduler target is checked in. Its build flag
defaults to `false`, however, and this repository checkpoint has not deployed or
observed it. API recovery remains the rollout bridge until migration 0052 and the
lease-aware worker are deployed, old executions drain, the schedule is enabled, and
at least two ticks plus an overlapping manual wake prove the path. Only a later
deployment may remove API startup and periodic recovery.

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
transcription, regeneration, and the direct route:

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
- worker ownership loss is `skipped`, not a false completion or failure;
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

Queue work, the polling worker, letter-only transcription, and main-transcription
regeneration now enter one canonical producer:

- automatic work claims only an eligible `PENDING` row and compares the workflow,
  dead-letter flag, attempt state, and observed transcript content state;
- direct request work uses a separate explicit claim policy but the same producer, and
  keeps its existing no-extras contract;
- every active attempt has a persisted run ID. Completion, failure, and cancellation
  must still own that run ID before changing terminal state;
- page sources are reloaded after the claim so work does not continue from the preflight
  page snapshot;
- human transcript writes revoke an active AI attempt before publishing the human value;
- ownership loss and stale eligibility propagate as `skipped`, so the worker does not
  announce a false transcription success.

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
9. **Completed in Slice 011A:** make the worker consume queued extra-content work and
   move its durable observation, mutation, recovery, wake, and exit decisions onto the
   shared stage predicate.
10. **Completed in Slice 011B:** delete the API registry executor, its process-local
    progress/pause/abort/SSE state, duplicate queue CRUD, and filtered-start illusion.
    The Processing page now polls the durable queue and offers only exact mutations
    plus one truthful global wake.
11. **Completed in repository Slice 011C:** add a database-clock execution lease to
    `worker_state`; fence state reports, release, every automatic stage claim, and every
    worker recovery mutation by the exact token; renew independently; and check in a
    default-disabled five-minute scheduled reconciliation target.
12. **Operational follow-up:** deploy migration 0052 and the lease-aware worker, drain
    pre-lease executions, enable the schedule, observe at least two ticks plus a manual
    overlap, and only then remove API startup and periodic recovery in a later
    deployment.

This order keeps behavior recoverable at each checkpoint while reducing, rather than
temporarily increasing, the number of ambiguous owners.
