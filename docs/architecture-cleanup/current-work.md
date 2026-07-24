# Architecture Cleanup Current Work

Last updated: July 24, 2026

## Resume Here

- Working branch: `architecture-cleanup`
- Recovery base: `admin-main-redesign` at `bb0bfb29`
- Program guide: [README.md](README.md)
- Current checkpoint: 022 — Letter transcription workspace
- Last sealed cleanup implementation: Letter transcription workspace at `2f9e17bc`
- Feedback reliability prerequisite: Express request deadlines at `c8ac080b`
- Current slice: 023 — single transcript-editor DOM owner

Before editing, run `git status --short --branch` and confirm the current slice still
matches the working tree.

## Baseline

Measured on `bb0bfb29` before cleanup:

| Check | Result |
| --- | --- |
| Backend tests | 41 files, 292 tests passed |
| Frontend tests | 85 files, 588 tests passed |
| Backend typecheck | Passed |
| Frontend production build | Passed, with large-chunk warnings |
| Mocked browser suite | 30 passed, 5 failed on stale `.admin-header` readiness waits |
| Frontend lint | 154 errors and 28 warnings across 57 files |
| Git state | Clean; redesign branch pushed and 150 commits ahead of `main` |

Architecture indicators:

These are historical measurements from the recovery base, not claims about the current
tree:

- Three batch execution paths were active—autonomous worker, legacy queue, and
  API-process registry runner—plus direct request-owned AI actions.
- API and worker startup both blindly recovered `RUNNING` transcription, metadata, and
  entity extraction rows, allowing an API restart to reset work owned by a live worker.
  Extra-content jobs had a separate status and were not recovered by that function.
- Letter lifecycle state was mutated directly in about 80 production call sites across
  18 files.
- Dashboard query/filter state was repeated across state, persistence, saved views,
  chips, API serialization, selection, and UI prop contracts.
- `AdminDashboard.css` was 4,448 lines with overlapping global ownership.
- The largest mixed-responsibility frontend route was `LetterReviewPage.tsx` at about
  1,871 lines; the largest public backend route is `routes/letters.ts` at about 2,230
  lines, though its search section is comparatively cohesive.
- Redesign and refactoring docs contained stale active-phase claims.

## Prioritized Program

### A. Trustworthy feedback

- [x] Replace stale dashboard readiness assertions with accessible behavior contracts.
- [x] Make the aggregate verification command run the mocked browser suite.
- [ ] Classify and eliminate lint debt by touched subsystem, then require lint in CI.
- [ ] Separate deterministic regression E2E from benchmarks and UI-audit projects.

### B. Processing correctness and ownership

- [x] Characterize every API- and worker-owned execution/recovery path in tests.
- [x] Give extra-content jobs a truthful claimed/success/failed lifecycle.
- [x] Require letter-only transcription to claim the job before AI execution.
- [x] Add persisted owner/lease/heartbeat semantics and expiry-aware reconciliation to
  the canonical main-transcription lifecycle.
- [x] Add a revision-bound canonical metadata owner, lease, terminal publication, and
  expiry-aware reconciliation path.
- [x] Add a run- and revision-bound entity-extraction owner with atomic projection
  replacement, database-clock liveness, expiry-aware recovery, and explicit rollout
  compatibility.
- [ ] After the scheduled wake is deployed and proven, remove API startup/periodic
  recovery so reconciliation is worker-owned.
- [x] Establish one eligibility definition per processing stage.
- [x] Make the worker the sole automatic executor; APIs enqueue, cancel, retry, and
  report.
- [x] Remove the legacy queue executor and its processing import cycle.
- [x] Remove the remaining registry execution and queue-management duplication.
- [x] Separate metadata completion from entity-persistence completion.

### C. Domain state ownership

- [ ] Centralize explicit letter stage, content-review, and publication transitions.
- [x] Replace public admin-DTO reuse with positive allowlist read models and enforce
  publication gates before matching, ranking, aggregation, or response projection.
- [x] Introduce a correspondence-group seam for keying, representative selection,
  visibility, deletion, and companion lookup.
- [ ] Finish compensation or recoverability across database/filesystem ingestion
  changes. Primary-page writes are now commit-safe; orphan-object collection remains.
- [ ] Extract explicit public summary/detail and admin detail read models.

### D. Frontend change isolation

- [ ] Replace field-by-field dashboard filter plumbing with one serializable query
  state, reducer/actions, and pure adapters.
- [ ] Model explicit versus all-filtered selection and make counts truthful.
- [ ] Delete verified dead dashboard CSS and establish one style owner per surface.
- [x] Give Photo Description and Extra Content one verified-editor interaction owner
  and remove their unused imperative editor contract.
- [x] Give Letter Review one route-visit identity, target-wide autosave coordinator,
  counted saving leases, and ordered identity/retag workflow.
- [ ] Refactor Letter Review by vertical workspace, one characterized domain at a time.
- [ ] Extract and test pure geometry, history, and viewport state from interaction-heavy
  React modules.
- [ ] Move shared contracts out of component files to break import cycles.

### E. Contracts and entropy cleanup

- [ ] Create one source for duplicated frontend/backend contracts where it removes real
  drift; do not create a generic shared package without a concrete consumer.
- [ ] Remove proven-unused dependencies, exports, scripts, and obsolete configuration.
- [ ] Make tracked `docs/` the single documentation source and archive stale plans.

## Slice 001 — Honest Browser Baseline

Status: complete in this checkpoint

Problem:

Five mocked dashboard tests wait for `.admin-header`, but the empty header is
intentionally hidden. The dashboard is rendered correctly. The aggregate verification
script then claims completion without running that mocked suite.

Invariant:

Dashboard readiness is defined by the accessible `Dashboard controls` region, which
only renders after the initial request succeeds. Error-path tests continue to assert
the error outcome directly.

Scope:

- Centralize successful dashboard readiness in the shared E2E helper.
- Repair stale mocked, live dashboard-shell, and navigation assertions.
- Run mocked E2E from `verify-all.mjs` by default with an explicit opt-out for focused
  local work.
- Correct documentation and CI labels that imply lint is already part of the gate.

Non-goals:

- No production UI behavior or styling changes.
- No lint suppression or bulk lint rewrite.
- No live-data E2E redesign.

Acceptance:

- Targeted mocked dashboard spec passes.
- Full mocked browser suite passes.
- `./scripts/verify-all.sh` runs backend/frontend checks and mocked E2E successfully.
- Frontend lint debt remains explicitly recorded, not hidden.

Evidence:

- Targeted mocked dashboard: 6/6 passed.
- Full mocked browser suite: 35/35 passed, replacing the 30/35 baseline.
- Aggregate `./scripts/verify-all.sh`: backend 292/292, backend typecheck,
  frontend 588/588, frontend production build, and mocked browser 35/35 passed.
- `git diff --check`: passed.
- Four affected live specs (`admin-auth`, `admin-dashboard`, `error-handling`, and
  `navigation`) discovered 85 tests successfully. The data-dependent dashboard spec
  was not executed because local Postgres was offline; its updated filter flows remain
  a recorded verification gap rather than a claimed pass.
- No frontend production code or styles changed.

## Slice 002 — Processing Ownership Safety Characterization

Status: complete in this checkpoint

Problem:

API startup and worker startup both call `recoverOrphanedJobs()`, which resets
`RUNNING` transcription, metadata, and entity-extraction jobs to `PENDING`. An API
restart can therefore make a live worker's job claimable a second time. However, the
API process still executes work through the process registry and a legacy queue
fallback. Removing API recovery first would trade duplicate execution for a different
failure: API-owned work could remain `RUNNING` indefinitely after an API crash while
the worker stays alive.

Target invariant:

Every execution must first acquire a durable, fenced claim, and every `RUNNING` status
must correspond to exactly one live claim. Recovery ownership must not move until that
invariant can remain true.

Planned minimum:

- Trace and document all code paths that claim, execute, and recover each job stage.
- Add a lightweight one-way architecture boundary over known stage-entrypoint names,
  canonical claim callers, direct `RUNNING` writers, and recovery callers. Existing
  owners may be deleted without changing the allowlists.
- Use the evidence to frame the smallest safe behavior-changing slices before leases
  or executor migration. The first two are the extra-content lifecycle and the
  unclaimed letter-only path identified below.
- Run the focused tests, backend typecheck, and full backend suite.

Non-goal:

Do not remove API recovery in this characterization slice. Two workers can still reset
each other's work, and extra-content jobs still lack recovery; both risks remain
explicit until ownership and lease semantics are implemented coherently.

Discoveries so far:

- The exact hybrid topology and failure matrix are recorded in
  [processing-ownership.md](processing-ownership.md).
- Extra-content batches never transition `extraContentJobStatus`, so completed rows can
  remain `PENDING` and eligible forever.
- `transcribeLetterOnly()` performs AI work while its job status is `PENDING`, allowing
  a worker to claim the same letter concurrently.
- The root architecture README described a target state that does not exist: API-owned
  AI execution and in-memory pause/abort are active today. It now describes the current
  transitional architecture and links the ownership map.
- The architecture test is intentionally a lightweight, one-way tripwire rather than
  an AST-level proof. It permits deletion of every allowlisted owner and does not assert
  blind startup recovery as desired behavior.

Acceptance evidence:

- Ownership map covers the worker loop, registry runner, legacy fallback, bulk
  fallback, direct content routes, claim writers, and both recovery callers.
- Focused architecture boundary: 4/4 tests passed.
- Backend typecheck: passed.
- Full backend suite: 42 files and 296 tests passed.
- `git diff --check`: passed before checkpoint review.
- No production runtime behavior changed in this slice.

## Decision Log

- The May dashboard redesign remains a recovery branch; cleanup proceeds on a new
  branch rather than rewriting its history.
- The program optimizes responsibility ownership and change isolation, not raw file
  counts.
- Existing lint failures are debt to eliminate, not rules to disable or a numeric
  baseline to normalize.
- The worker is the intended processing executor. The process catalog may remain UI
  metadata, but API-process execution is not the target architecture.
- Process startup is not evidence that another attempt died. Automatic recovery is
  permitted only when persisted liveness evidence has expired.
- A rollout-safe `NOT VALID` database check is preferable to either accepting new
  cross-stage conflicts or blocking deployment on already-existing conflicts. Legacy
  violations must be repaired and the constraint validated in a later operational step.
- Worker availability handoff is correctness state: a failed final unavailable write
  must fail the Cloud Run attempt so configured retries can reconcile it.
- Metadata `SUCCESS` and its workflow advance are one publication boundary; exposing a
  terminal status before the workflow write creates a claim window for the next stage.
- Worker wakeups are level-triggered from durable eligible `PENDING` transcription
  state. A one-shot recovery result is not a durable handoff and cannot be the only
  reason the API asks a configured worker to run.
- Lease metadata introduced during a rolling deployment must be bound to the current
  run ID when an older revision can replace the run ID without touching the new lease
  fields. Run-ID fencing prevents stale publication but does not make inherited lease
  metadata authoritative for the replacement attempt.
- A lease-run binding added after its lease pair must remain nullable, unbackfilled,
  and temporarily unconstrained. The immediately previous revision can clear the
  expiry/kind fields but cannot clear the new binding; even `NOT VALID` checks would
  reject that legitimate rolling-deployment write. New claims overwrite residue and
  automatic ownership requires exact equality instead.

## Checkpoint Log

### Slice 001

- Replaced the hidden `.admin-header` wait with the named `Dashboard controls`
  region and updated stale search/filter interactions to use rendered controls.
- Corrected live dashboard-shell and navigation assertions that encoded the removed
  header layout.
- Made the aggregate verifier run mocked Playwright by default; `VERIFY_SKIP_E2E=1`
  remains an explicit focused-work escape hatch and all skipped gates are reported.
- Renamed CI and README labels so they describe the gates that actually run, while
  retaining the frontend lint failure count as explicit debt.
- Linked this program from the documentation index and marked the old redesign queue
  as historical.
- Green checkpoint: `01879bd9`.

### Slice 002

- Replaced the unsafe worker-only-recovery proposal with an evidence-backed map of all
  queue-backed execution, claim, and recovery owners.
- Added a one-way architecture tripwire for known execution entrypoints, canonical
  claim callers, direct `RUNNING` writes, and recovery callers; deletion remains easy.
- Corrected the root README's false worker-only and durable-pause claims.
- Recorded the extra-content lifecycle and letter-only claim defects as the next two
  contained correctness slices before lease-aware recovery.
- Independent backend review found no blockers; skeptical review findings about
  overclaiming and incomplete claim tracking were incorporated before checkpointing.
- Green checkpoint: `32631a9e`.

### Slice 003

- Added one claimed lifecycle for every extra-content producer and fenced late AI
  publication, cancellation, human edits, and page-source invalidation by run ID.
- Removed duplicate regeneration and false dashboard completion paths while preserving
  the local line-review workflow.
- Green implementation checkpoint: `fc99e2d8`; checkpoint record: `10d3ecd7`.

### Slice 004

- Made the pipeline the only main-transcription producer and routed queued, worker,
  batch, direct, and regeneration work through one exact-state claim owner.
- Added persisted run-ID fencing, neutral ownership-loss outcomes, truthful reporting,
  and atomic human supersession/verification rules.
- Removed the duplicate direct AI loop and stale server-side line-detection side effect.
- Final independent audit found two additional ownership defects; the route-level
  duplicate update was deleted and explicit bulk retries now clear dead-letter state.
- Green implementation checkpoint: `7156492d`.

### Slice 005

- Added a database-clock lease and queued/requested recovery semantics to every new
  canonical main-transcription claim. An immediate serialized heartbeat renews only
  the exact live run, and stale producers cannot publish.
- Replaced blind startup recovery with exact expired-lease reconciliation. API startup
  retains the safe reconciler during the hybrid-executor phase; the worker also runs it
  at startup and periodically.
- Removed unsafe metadata/entity startup resets because those stages cannot yet prove
  an observed `RUNNING` attempt is abandoned.
- Closed worker enqueue-versus-exit lost wakeups with a serialized availability
  publisher, queue rechecks, queued-lease waiting, strict relinquish, and three Cloud
  Run retries.
- Added application and database cross-stage exclusion. Conditional route, reset, and
  bulk operations preserve that invariant; metadata success and its workflow advance
  now publish atomically, and entity claims require exact metadata success.
- Final adversarial concurrency and simplicity reviews found no remaining P1/P2 issue.
- Green implementation checkpoint: `985b8172`.

### Slice 006

- Added explicit queued/requested intent, a PostgreSQL-clock lease, and a run-ID-bound
  lease owner to every canonical extra-content claim.
- Shared only the immediate, serialized heartbeat scheduler and the serialized
  reconciliation coordinator; stage claims, terminal publication, dirty-source rules,
  and recovery policies remain separate.
- Replaced isolated recovery calls with stage-contained composite reconciliation at
  API and worker startup and every 60 seconds. Failure in one stage no longer suppresses
  another stage's recovery.
- Made configured worker wakeups re-derive from durable eligible `PENDING`
  transcription state, await the trigger, and retry on later reconciliation ticks.
- Adversarial audits caught and drove fixes for partial composite recovery, optional
  claim intent, a lost recovery-to-worker wake, and mixed-version lease inheritance.
- Green implementation checkpoint: `b0f98db6`.

### Slice 007

- Added a nullable, unbackfilled main-transcription lease-run binding and made every
  current claim bind its lease metadata to the run that created it.
- Required exact binding for renewal, terminal publication, automatic recovery, and
  worker leased-work projection while keeping exact-run administrative cancellation
  available for rollout-era mismatches.
- Updated every queue, retry, reset, human-edit, version-restore, bulk, and terminal
  path to clear the complete ownership tuple.
- Made cancellation trust queued/requested intent only when it belongs to the current
  run; mismatched attempts derive the safe workflow from current observable state.
- Kept migration 0049 free of a backfill or binding-shape constraint so the immediately
  previous revision can still complete/cancel new-bound work during rolling overlap.
- Green implementation checkpoint: `a2989756`.

## Slice 003 — Extra-Content Job Lifecycle

Status: complete in this checkpoint

Problem:

Three paths produce extra-content transcripts, but none originally claimed or completed
`extraContentJobStatus`. Successful work remained `PENDING`, active/recent reporting
was false, and the same work remained eligible to run again. The first status-only
repair exposed four deeper correctness requirements: cancellation must fence late AI
results, regeneration must not run two extra producers, empty letters must not become
successful extra jobs, and later T/C/E uploads must invalidate derived content.

Invariant:

Every eligible extra-content execution owns a unique persisted run ID. The producer
calculates a content patch but cannot publish it; one fenced terminal update atomically
commits the patch with `SUCCESS`, or records `FAILED`. Cancellation, immediate retry,
and a committed source change cannot leave an older attempt as terminal `SUCCESS`.
New or changed T/C/E pages either reset an idle representative L job to `PENDING` or
mark a running attempt dirty so its stale patch is discarded and requeued. Human edits
revoke an active AI publisher in the same atomic write; verification also checks the
content revision the reviewer observed.

Scope:

- Add a specialized extra-content run-ID claim and atomic patch/status publication
  boundary; keep the generic stage claim helper unchanged.
- Extract the three extra-content producers from the transcription and regeneration
  pipelines. Preserve their distinct text-check, trimming, and header-format contracts
  behind one lifecycle owner.
- Make automatic work establish related-item eligibility before claiming, claim only
  `PENDING`, compare the observed letter revision, and reload source pages after claim.
- Suppress automatic extras inside regeneration. `includeExtras=false` now runs no
  extra producer; `true` runs the regeneration producer exactly once. Commit history
  confirms that this is the intended optional contract and the nested execution was a
  composition defect.
- Persist run ID and dirty-source state. Persist a changed T/C/E page and invalidate
  only its matching L-type correspondence identity in one database transaction.
- Enforce at the database boundary that `RUNNING` has exactly one run ID and dirty
  state cannot exist outside a running attempt.
- Make cancellation a conditional `RUNNING` compare-and-swap and clear the extra run
  fence only when cancellation wins. Queue removal, retry, and bulk clear also recheck
  the state they intend to mutate.
- Make manual edits clear verification metadata unconditionally and atomically revoke
  an active run. Verification itself compares the observed content revision.
- Represent batch claim loss, supersession, missing work, and eligibility loss as
  neutral `skipped` outcomes across backend state, SSE contracts, and the processing
  UI. They do not emit failure notifications.
- Reconcile the Processing page periodically because worker writes occur outside the
  API process's in-memory SSE broadcaster.
- Add focused lifecycle race, source invalidation, producer-format, pipeline-wiring,
  batch-outcome, route-contract, and UI-progress tests.

Non-goals:

- Do not add blind extra-content startup recovery, lease expiry, or heartbeats. Run IDs
  fence attempts but do not prove liveness.
- Do not change the three existing prompt/format variants.
- Do not migrate the other processing stages to run IDs in this slice.
- Do not add extra job state to the Letter Review DTO; direct contention remains an
  explicit request-correlated 409, while the Processing page owns queue visibility.
- Do not claim filesystem rollback: forced file replacement still happens before the
  page/invalidation database transaction and remains tracked ingestion debt.

Acceptance:

- Eligible work alone can claim; normal success and failure leave truthful terminal
  state, while cancellation/retry and a committed source-page transaction cannot
  leave stale content as terminal `SUCCESS`.
- All three formatting contracts and the one-producer regeneration contract are
  executable tests.
- Dashboard contention is skipped, direct contention is a request-correlated 409, and
  mixed completed/failed/skipped progress reaches 100%.
- Migration validation, backend typecheck/full suite, frontend test/build, aggregate
  verification, and independent review pass before checkpointing.

Evidence:

- Full backend suite: 47 files and 340 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 592 tests passed; the production build passed with
  the pre-existing large-chunk warning.
- Mocked browser suite: 35/35 passed in both the aggregate verifier and an isolated
  single-worker CI-mode run.
- Aggregate `./scripts/verify-all.sh`: backend tests/typecheck, frontend tests/build,
  and mocked browser tests completed successfully.
- Migration validation: 5/5 structural checks passed. All 46 migrations also applied
  successfully to a disposable PostgreSQL 17 cluster, where both new ownership
  constraints were present.
- `git diff --check`: passed.
- Three independent first-pass reviews stopped the checkpoint over source, admin-CAS,
  and human-edit races. Those findings were fixed; two focused second-pass reviews
  found no remaining P1 extra-content integrity blocker.
- Residuals remain explicit: run IDs are not leases, forced filesystem replacement is
  outside the page/invalidation transaction, and legacy non-extra lifecycle routes
  still need consolidation.
- Green implementation checkpoint: `fc99e2d8`.

## Slice 004 — Canonical Direct Transcription Ownership

Status: complete in this checkpoint

Problem:

`transcribeLetterOnly()` contains a second, stale copy of the transcription producer.
It resets even a `RUNNING` row to `PENDING`, performs AI work without a claim, and
publishes by letter ID. A worker can therefore run the same job concurrently, and a
cancelled or superseded request can overwrite newer state. The duplicate has also
drifted from intentional pipeline decisions: it retains an unreliable non-letter text
precheck and server-side line detection that were separately removed from the canonical
pipeline.

Invariant:

Every transcription attempt in this slice must atomically move an eligible row to
`RUNNING` with a unique persisted run ID before AI work. Direct and queued requests
must claim from the exact job/content state they preflighted instead of exposing a
reset-through-`PENDING` window. Success, empty success, and failure may mutate the row
only while that attempt still owns its run ID. Human transcript changes revoke that
ownership atomically. Claim loss or supersession is a neutral typed outcome, and a
synchronous direct request maps it to a request-correlated 409 rather than reporting
false success.

Scope:

- Make `pipeline/transcription.ts` the only main-transcription AI producer.
- Add a specialized atomic transcription claim that changes status, workflow, and a
  persisted run ID in one write; remove transcription from the generic claim caller.
- Return a discriminated outcome with truthful page/text metrics from the canonical
  runner and fence all terminal writes on the owning run ID.
- Replace both direct transcription/regeneration reset paths with one preflighted
  manual-claim entrypoint. Preserve typed 404/400 validation, the synchronous response,
  all transcribable document types, and `extraContent: 'skip'` composition.
- Make queued claims compare their observed eligibility and content state, then reload
  page sources after the claim. Preserve source-array order even when page numbers are
  sparse.
- Make manual transcript edits and version restores revoke an active producer in the
  same write; verification rejects a revision while AI owns it.
- Propagate neutral transcription outcomes through the processor, worker, and legacy
  batch runner so cancelled or lost work is not counted or announced as success.
- Delete the duplicate AI loop and intentionally adopt the canonical semantics for
  bounded L-page concurrency, non-L transcription, whitespace, empty content,
  `transcribedAt`, progress, abort, and failure reporting.
- Remove the stale server-side line-detection side effect. History explicitly moved
  line detection to the standalone local workflow because it did not fit Cloud Run.
- Add a one-way architecture tripwire so raw main-transcription AI calls cannot quietly
  spread outside the canonical producer.

Non-goals:

- Run IDs fence late terminal publication and prevent a stale recovery snapshot from
  resetting a replacement run. They do not prove that the observed attempt is dead;
  startup recovery can still reset live work until Slice 005 adds leases, heartbeats,
  and expiry-aware reconciliation.
- Reloading page sources after claim narrows, but does not close, the source-change
  window. A main-transcription source revision or dirty marker remains future work.
- Do not decide broader derived-data invalidation here. Existing regeneration already
  leaves legacy structured transcription JSON, reading text, confirmation, metadata,
  and publication fields attached to the new text; that product contract needs its own
  characterized slice.
- Do not change prompt text, add features, or make the API asynchronous.
- Do not preserve the unreliable non-letter text precheck or automatic server-side line
  detection merely because they survived in the duplicate path; repository history
  identifies both as stale omissions.

Acceptance:

- A direct request cannot clobber observed `RUNNING` work, and a worker cannot claim the
  same row through a reset window.
- Claim loss and terminal supersession perform no false publication and return 409 for
  direct callers.
- Completed and empty results expose truthful page/text metrics; automatic extras run
  zero times for letter-only work and at most once when explicitly requested by the
  regeneration route.
- Focused ownership, producer, service, and route tests pass before the full backend
  suite and typecheck.

Evidence:

- Full backend suite: 51 files and 393 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 593 tests passed. The production build passed with
  the pre-existing large-chunk warning.
- Mocked browser suite: 35/35 passed inside the aggregate verifier.
- Aggregate `./scripts/verify-all.sh`: backend tests/typecheck, frontend tests/build,
  and mocked browser tests completed successfully. Its first run hit one unrelated
  dashboard-test timeout under full-suite load; the isolated case, complete file,
  standalone full frontend suite, and full aggregate rerun all passed without changing
  the test or its timeout.
- Migration validation: 5/5 structural checks passed. All 47 migrations applied to a
  disposable PostgreSQL 17 cluster; `transcription_run_id` was UUID-typed and the
  `transcription_run_id_matches_running` constraint was present.
- Focused race coverage includes cancel/retry ABA, stale bulk and legacy queue writes,
  dead-letter requeueing, post-claim source reload, sparse page numbers, human
  edit/restore supersession, verification conflict, neutral worker/batch reporting,
  and stale recovery snapshots.
- `git diff --check`: passed.
- Independent reviewers stopped the checkpoint over terminal ownership, stale
  queued/source state, sparse page ordering, human mutation races, false success
  reporting, recovery ABA, a duplicate route-level transcript write, and dead-lettered
  rows reported as queued. The final two findings were fixed by giving `updateLetter()`
  one write owner and atomically reviving explicit bulk retries. The final focused
  second pass found no remaining P1/P2 issue.
- Explicit residuals: run IDs are fences rather than liveness leases; a post-reload page
  change can still race main transcription; regeneration still leaves broader derived
  data attached to replacement text; and the dashboard timing test remains load-sensitive.

## Slice 005 — Durable Main-Transcription Lease

Status: complete in this checkpoint

Problem:

The run ID from Slice 004 proves which attempt may publish, but it does not prove that
the attempt is still alive. Startup recovery therefore still resets the same observed
run even when another API or worker process is actively transcribing it. Conversely,
recovery only runs at startup, so a crashed attempt can remain `RUNNING` while another
long-lived process stays healthy. The existing reset also erases a contract boundary:
queued transcription may be retried automatically, while a synchronous requested
regeneration must not silently become a later automatic run with different options.

Invariant:

Every newly claimed main-transcription attempt has one persisted run ID, a database-
clock lease expiry, and a persisted `QUEUED` or `REQUESTED` claim kind. Only the exact
unexpired run may renew or publish. Heartbeats extend but cannot resurrect an expired
lease. Recovery changes only expired leased attempts and uses the persisted kind:
queued work returns to `PENDING`, while request-owned work fails visibly without
discarding its existing content or being converted to automatic work. A legacy
`RUNNING` row with no lease is unknown and is never automatically reset.

Scope:

- Add nullable transcription lease-expiry and claim-kind columns, a partial expiry
  index, and rollout-safe one-way database checks. Do not fabricate leases for existing
  `RUNNING` rows.
- Use PostgreSQL time for claim, renewal, terminal, and expiry comparisons. Keep the run
  ID as the authority token; do not add a redundant process-owner field or a second
  heartbeat timestamp.
- Start one serialized, unref'ed heartbeat immediately after the canonical claim and
  stop it in `finally`, covering queued, worker, registry, legacy, bulk, and direct
  execution without caller-specific timers.
- Require exact run ID plus an unexpired lease for AI success/failure publication.
  Cancellation and human edits may intentionally revoke either an active or expired
  observed run and clear the full claim tuple.
- Keep requested work's prior workflow visible while it runs. On expiry or producer
  failure, queued work returns to `UPLOADED`; requested work remains on its prior
  workflow with a visible failed job status.
- Move transcription expiry recovery into the transcription lifecycle owner as
  conditional `UPDATE ... RETURNING` operations. Keep the existing API and worker
  startup callers during the hybrid-executor phase, and reconcile periodically from
  the long-lived worker.
- Return actual recovered rows so two reconcilers racing the same expiry report it only
  once. Keep unknown unleased attempts visible for explicit admin cancellation.
- Extend the architecture tripwire so non-null transcription leases and claim kinds
  cannot be written outside the lifecycle owner.

Non-goals:

- Do not lease metadata or entity extraction yet. Their boolean/pre-claimed paths and
  unfenced terminal writes must first move behind canonical lifecycle owners; entity
  side effects also need a retry-safe completion boundary.
- Do not add an attempts table or generic lease framework for one ready consumer.
- Do not move recovery exclusively to the worker while API-owned execution remains.
- Do not add extra-content lease recovery in this slice; its fenced lifecycle is the
  next concrete consumer.
- Do not change prompts, transcription output, synchronous response contracts, or add
  product features.

Acceptance:

- Two claims still produce one owner, and every new owner receives a database-clock
  lease and claim kind.
- A heartbeat renews only the exact unexpired run, remains active during one slow AI
  promise, never overlaps itself, and stops after the attempt exits.
- Expired, cancelled, or replaced owners cannot renew or publish; database errors leave
  ownership unknown rather than manufacturing success or failure.
- Recovery ignores unexpired and null leases, loses safely to a concurrent heartbeat,
  and reports an expired attempt once even with two reconcilers.
- Queued expiry requeues; requested expiry fails in place and preserves existing
  content/workflow.
- The migration applies over a database containing a legacy unleased `RUNNING` row.
- Focused lifecycle/pipeline/recovery tests, migration validation, backend typecheck,
  the full backend suite, and the aggregate repository gate pass before checkpointing.

Evidence:

- Full backend suite: 56 files and 448 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 593 tests passed. The production build passed with
  the pre-existing large-chunk warning.
- Mocked browser suite: 35/35 passed inside the final aggregate verifier.
- Aggregate `./scripts/verify-all.sh`: backend tests/typecheck, frontend tests/build,
  and mocked browser tests completed successfully after all final fixes.
- PostgreSQL 17 migration proof: all migrations applied; a legacy conflicting
  main/downstream `RUNNING` row did not block migration, while a new conflicting write
  and a partial lease tuple were rejected. A valid leased row succeeded; the expiry
  precision and partial expiry index matched the schema.
- Focused coverage includes database-clock claim/renewal, one slow AI heartbeat,
  expiry/cancellation/replacement fencing, queued versus requested recovery, racing
  reconcilers, startup and periodic reconciliation, exit-when-empty handoff, stale
  confirmation/regeneration snapshots, conditional bulk clears, and cross-stage claims.
- `git diff --check`: passed.
- Independent adversarial reviews repeatedly stopped the slice over legacy
  cancellation, rolling deployment, worker exit races, unsafe downstream startup
  resets, stale route snapshots, direct/bulk reset windows, and metadata's terminal
  publication gap. After those fixes, final concurrency and simplicity passes found no
  remaining P1/P2 issue.
- Green implementation checkpoint: `985b8172`.

Residuals carried forward:

- Metadata and entity extraction still lack run IDs and leases; explicit cancellation
  can still race a late terminal write, and entity/junction persistence is neither
  transactional nor retry-token-fenced.
- Extra content has a run-ID fence but no lease or recovery yet; this is Slice 006.
- Legacy unleased main-transcription attempts require explicit administrative
  cancellation. A legacy cross-stage conflict must be repaired before the new
  `NOT VALID` constraint can later be validated.
- An old binary in a rolling deployment can still reset a new leased main attempt. The
  run-ID fence blocks stale publication, but duplicate compute remains possible until
  old instances are gone.
- Main-page source revisions and the broader invalidation contract for derived
  transcript/metadata/publication data remain unowned.
- API batch execution and its in-memory registry/legacy loop remain active, so recovery
  cannot yet become exclusively worker-owned.

## Slice 006 — Durable Extra-Content Lease

Status: complete in this checkpoint

Problem:

Extra-content attempts already have one canonical run-ID fence, but a crashed process
can leave that attempt `RUNNING` forever. Status alone cannot determine how to recover
it: automatic and Processing-page work is queued intent, while direct transcription
and regeneration are synchronous requested intent, and either kind can begin from a
`PENDING` row. A fast API restart can also observe an unexpired abandoned lease and
skip it; startup-only reconciliation would then provide no eventual recovery when no
long-lived worker is active.

Invariant:

Every newly claimed extra-content attempt has one run ID, a database-clock lease, and
an explicit `QUEUED` or `REQUESTED` claim kind. Only the exact clean run with a live
lease may renew or publish content. A committed source change marks the exact attempt
dirty and takes precedence over claim kind. Expiry requeues queued or dirty work, but
fails a clean requested attempt in place without changing the last committed content.
Legacy unleased attempts remain visible and manually cancellable rather than being
guessed dead. API and worker reconciliation are serialized, periodic, and safe to run
concurrently.

Scope:

- Add stage-named extra-content lease, lease-run binding, and claim-kind columns, a
  partial expiry index, and a rollout-safe complete-tuple check. Do not backfill
  existing `RUNNING` rows.
- Map automatic post-transcription and Processing-page batches to `QUEUED`; map direct
  `/transcribe-extras` and regeneration extras to `REQUESTED` even when they claim a
  `PENDING` row.
- Extract only the identical immediate/non-overlapping heartbeat scheduler shared by
  main and extra transcription. Keep claim SQL, dirty handling, cancellation, terminal
  publication, and recovery stage-specific.
- Use PostgreSQL time for lease creation, renewal, terminal fencing, and expiry.
  Heartbeats do not mutate user-visible `updatedAt`; producers stop between external
  AI calls after authoritative ownership loss.
- Move extra-content cancellation behind its lifecycle owner. Every terminal, dirty
  requeue, human supersession, source invalidation, queue control, and bulk clear
  either preserves the complete live tuple or clears it together.
- Recover expired dirty attempts first to `PENDING`, then clean queued attempts to
  `PENDING`, and clean requested attempts to visible `FAILED`. Conditional
  `UPDATE ... RETURNING` makes concurrent reconcilers report each row once.
- Generalize the serialized recovery timer, not the stage lifecycle. Run one composite
  main/extra reconciliation loop at API and worker startup and periodically, and stop
  it during graceful shutdown.
- Keep worker exit decisions projected only onto main-transcription requeues/leases.
  Standalone extra-content remains the Processing-page queue; adding a new worker
  executor is outside this slice.

Non-goals:

- Do not introduce a generic jobs table, generic lifecycle framework, or shared claim
  and terminal SQL.
- Do not add standalone extra-content polling to `worker.ts` or change synchronous API
  response behavior.
- Do not normalize the existing no-related-items status contract or make requested
  main-plus-extra regeneration transactional; both require separate behavior framing.
- Do not lease metadata or entity extraction in this slice.
- Do not replace the global `updatedAt` claim guard with a source-specific revision yet.

Acceptance:

- All four producers persist the correct claim kind and receive a database-clock lease.
- Immediate heartbeats serialize slow renewals, tolerate transient database errors,
  stop on authoritative ownership loss, and leave `updatedAt` unchanged.
- Expired, cancelled, replaced, or dirty attempts cannot publish. Dirty expiry always
  requeues; clean queued expiry requeues; clean requested expiry fails without changing
  prior content or verification.
- Legacy unleased attempts are ignored by recovery but remain exact-run cancellable.
- API and worker periodic reconciliation cannot overlap itself, worker shutdown drains
  it, and extra-only recovery cannot keep an exit-when-empty worker alive.
- Migration validation includes a legacy unleased row, rolling-deploy stale metadata,
  paired-metadata rejection, expiry index, and recovery race proof on PostgreSQL 17.
- Focused lifecycle/recovery/route tests, backend typecheck/full suite, and the aggregate
  repository verifier pass before checkpointing.

Evidence:

- Full backend suite: 56 files and 469 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 593 tests passed. The production build passed with
  the pre-existing large-chunk warning.
- Mocked browser suite: 35/35 passed in CI mode inside the definitive aggregate
  verifier.
- Aggregate `CI=1 ./scripts/verify-all.sh`: backend tests/typecheck, frontend
  tests/build, and mocked browser tests completed successfully.
- PostgreSQL 17 migration proof applied migrations through 0047, preserved a legacy
  unleased extra-content `RUNNING` row while applying 0048, rejected partial ownership
  metadata, accepted a terminal row retaining a complete stale tuple, and proved that
  an old-style replacement run inheriting a prior run's lease metadata is not selected
  by recovery. The partial expiry index was present.
- Focused race coverage includes queued/requested/dirty expiry, renewal loss,
  concurrent reconcilers, composite partial failure, graceful shutdown, exact-run
  cancellation, source invalidation, and durable API worker wake retry.
- `git diff --check`: passed.
- Independent final concurrency, migration/orchestration, and simplicity audits found
  no remaining P1/P2 issue.
- Green implementation checkpoint: `b0f98db6`.

Residuals carried forward:

- Standalone extra-content queue execution remains owned by the Processing page/API;
  this slice deliberately did not add another worker polling path.
- Legacy unleased or mixed-version lease-mismatched extra-content attempts remain
  visible for exact-run administrative cancellation rather than automatic recovery.
- The existing no-related-items status contract remains unchanged.
- The global `updatedAt` source guard and forced filesystem replacement compensation
  gap remain ingestion/domain-state work.
- Main transcription's lease pair is not yet bound to its run ID and therefore has the
  analogous mixed-version inheritance hazard. Slice 007 closes that narrow gap before
  downstream lifecycle work.
- Metadata and entity extraction still lack fenced lifecycle owners and durable
  liveness evidence.

## Slice 007 — Bind Main-Transcription Leases to Their Runs

Status: complete in this checkpoint

Problem:

Slice 005 added a main-transcription lease and claim kind, but the pair is not bound to
the run ID that created it. During rolling overlap, an older revision can finish run A
without clearing fields it does not know about, then claim run B by changing only the
run ID. A newer reconciler can mistake B for an expired attempt under A's inherited
lease. The run-ID fence still blocks A's late publication, but recovery can revoke a
live B attempt and apply the wrong queued/requested recovery policy.

Invariant:

Automatic renewal, terminal publication, and recovery may treat lease metadata as
authoritative only when its persisted lease-owner run ID equals the current
transcription run ID. New claims always bind all ownership metadata to one run. Legacy
unleased or mismatched attempts remain visible and exact-run cancellable rather than
being guessed dead.

Scope:

- Add a nullable, unbackfilled main-transcription lease-run binding in migration 0049.
  Keep the existing expiry/kind pair check, but add no binding-shape constraint until
  older revisions are drained; old terminal writers must be allowed to leave binding-
  only residue that a new claim can overwrite.
- Bind every canonical new main-transcription claim to its run ID and require exact
  binding for active ownership, renewal, terminal publication, and automatic recovery.
- Audit every human, cancellation, reset, retry, queue, and terminal path so it either
  preserves one complete live ownership tuple or clears it together.
- Add the old-style mixed-version replacement scenario to behavior tests and the real
  PostgreSQL migration/recovery proof.

Non-goals:

- Do not lease or otherwise refactor metadata/entity extraction in this slice.
- Do not change prompts, output, API response contracts, or user-facing behavior.
- Do not introduce a generic jobs or lease framework.

Acceptance:

- Every current claim stores a matching lease-run binding, and only that exact bound
  run may renew or publish.
- Recovery ignores an old-style replacement run that inherited another run's metadata;
  explicit cancellation can still close it safely.
- All ownership-clear paths manage the binding with the existing run ID, expiry, and
  claim kind.
- Focused concurrency and migration tests, a PostgreSQL 17 proof, backend full suite
  and typecheck, and the aggregate repository verifier pass before checkpointing.

Evidence:

- Full backend suite: 56 files and 476 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 593 tests passed. The production build passed with
  the pre-existing large-chunk warning.
- Mocked browser suite: 35/35 passed in CI mode inside the final aggregate verifier.
- Aggregate `CI=1 ./scripts/verify-all.sh`: backend tests/typecheck, frontend
  tests/build, and mocked browser tests completed successfully after the final
  cancellation-policy fix.
- Focused ownership surface: 9 files and 126 tests passed, covering claims, observed
  CAS, heartbeat/terminal fencing, both recovery policies, every clear/reset/human
  path, worker exit projection, and architecture boundaries.
- Migration registration: 5/5 tests passed; `drizzle-kit check` reported no drift.
- PostgreSQL 17 upgrade proof applied through 0048, preserved a legacy unbound running
  attempt under 0049, allowed the previous revision's binding-only terminal residue,
  ignored an expired replacement run inheriting another run's binding, allowed exact
  cancellation, and selected a newly bound expired run. The existing pair constraint
  and partial index remained present.
- The PostgreSQL proof also exercised both cross-kind cancellation hazards: actual
  requested work with inherited `QUEUED` preserved `TRANSCRIBED`, while actual queued
  work with inherited `REQUESTED` left `TRANSCRIBING` for `UPLOADED`.
- `git diff --check`: passed.
- Independent final migration, ownership-path, and adversarial concurrency/simplicity
  audits found no remaining P1/P2 issue.
- Green implementation checkpoint: `a2989756`.

Residuals carried forward:

- Legacy unbound or mismatched main-transcription attempts remain intentionally
  ineligible for automatic recovery and exact-run cancellable by an administrator.
- The binding remains temporarily unconstrained while older revisions can write. A
  later operational cleanup may add a stronger constraint only after those revisions
  are drained and transitional residue is reconciled.
- Main-page source revisions and the broader invalidation contract for derived
  transcript/metadata/publication data remain unowned.
- Metadata and entity extraction still lack run IDs, leases, canonical terminal
  publication, and safe automatic recovery. Metadata becomes Slice 008; entity
  persistence remains a separate retry-safe slice.
- API batch execution and its in-memory registry/legacy loop remain active, so recovery
  cannot yet become exclusively worker-owned.

## Slice 008 — Canonical Metadata Lifecycle Boundary

Status: complete in this checkpoint

Delivered invariant:

Every metadata producer enters one canonical exact-state owner and receives a unique
run ID bound to the metadata revision, a PostgreSQL-clock lease, a matching lease-run
ID, and explicit `QUEUED` or `REQUESTED` intent. The shared heartbeat renews only a
still-live exact owner. Content, terminal status, revision advancement, and workflow
publish atomically only for that owner and a live lease. Human/source supersession,
administrative cancellation, and expiry all fence late results without using the
letter's unrelated `updated_at` field.

Recovery policy:

- Expired queued/confirmation work returns to `PENDING`/`TRANSCRIBED` so the worker can
  drain it; expired requested replacement work becomes `FAILED` while preserving
  committed metadata and restoring the content-stage workflow.
- API and worker reuse the serialized recovery coordinator. Configured API wakeup and
  exit-when-empty worker handoff now include eligible queued metadata.
- Concurrent reconcilers use conditional `UPDATE ... RETURNING`, so only one reports
  and transitions an expiry. Administrative cancellation may revoke an exact owner
  even after expiry.
- Expansion migration 0050 deliberately leaves pre-migration tokenless `RUNNING` rows
  manual. New tokenless transitions are rejected, and an owned `RUNNING` row cannot be
  stripped back to the legacy shape.

Evidence:

- Focused lifecycle/pipeline/recovery/architecture suite: 71 tests passed before final
  integration; the final ownership, projection, route-outcome, queue, publication, and
  legacy-document regression surfaces also passed after adversarial review fixes.
- Full backend suite: 61 files and 556 tests passed; backend typecheck passed.
- Full frontend suite: 86 files and 593 tests passed; frontend typecheck passed.
- Migration journal validation: 5/5 passed. `drizzle-kit check` and `git diff --check`
  passed.
- A disposable PostgreSQL 17 proof applied the full journal through 0050 over a legacy
  tokenless `RUNNING` row; it rejected new tokenless ownership, real input mutation,
  and owner stripping, allowed same-value input writes and heartbeat renewal, fenced
  expired publication, recovered queued intent, and preserved legacy drain behavior.
- The PostgreSQL proof also exercised current completion, queued/requested expiry,
  plain terminal-write rejection, and human `EDITED` publication. Independent final
  review remapped every production metadata-status writer against the database trigger
  and found no remaining P0/P1 lifecycle blocker.
- Request-owned routes now report a conflict when a run is superseded instead of
  returning a false success. Direct, bulk, and auto-publication share one eligibility
  rule based on the last committed verified content. A running or failed replacement
  attempt does not invalidate that committed review or make it impossible to
  republish.
- Historical camelCase `metadata_json` and snake_case V2 documents are projected
  independently; legacy rows are never silently promoted into an invalid V2 shape.
- `db:test-migrations` was found to swallow Docker startup failures in its EXIT trap.
  The trap now preserves the real exit code. Docker was offline for the final standard
  fresh-container run, so that command is recorded as unavailable rather than green;
  the independent PostgreSQL 17 full-journal proof above remains the runtime evidence.

Entity extraction remains the intentionally separate next lifecycle slice.

Separate UI contract residual: Date, Emotional Tone, Relationship, and Primary Topics
look editable in admin Letter Review but are not part of its save contract. Navigation
can silently discard those local edits. Fix or make those controls read-only in a
dedicated vertical slice; do not hide the issue inside entity ownership work.

## Slice 008B — Explicit Public Read Boundary Correction

Status: complete in this checkpoint

Problem:

Unauthenticated routes reused the broad admin letter DTO and several queries applied
publication checks after selecting, matching, ranking, aggregating, or linking data.
Hidden letters and unpublished transcript/metadata fields could therefore leak
directly or through search facets, previews, names, collection profiles, entity pages,
and relationship provenance.

Delivered invariant:

Public responses are explicit positive projections. A public letter must be visible;
transcript-derived fields exist only when `transcriptPublished` is true, and
metadata-derived fields exist only when `metadataPublished` is true. Query-time search,
sort, facets, adjacent navigation, aggregations, entity discovery, relationships, and
sitemap inclusion apply those gates before data can influence a result. Adding a field
to a public response is now an explicit publication decision covered by a matrix test.

Scope:

- Converted public letter list, detail, summaries, search, adjacent navigation,
  collections, collection profiles, featured content, content pages, persons, places,
  relationships, relationship paths/graphs, and sitemap routes.
- Rejected public hidden/workflow filters and internal sort oracles.
- Exposed generated collection profiles and person biographies only after verification.
- Hid collections with no public primary letters and removed the unauthenticated
  `/collections/next-number` administration utility plus its unused frontend wrapper.
- Kept the documented all-photo exception only for photo descriptions; it does not
  expose OCR, filenames, notes, extraction state, or other metadata.
- Projected transcript pages explicitly, excluding raw structured OCR pages, and
  required supplemental transcript content to be independently `VERIFIED` before it
  can appear in payloads, shelf search text, archive matching, ranking, or previews.
- Removed public search and collection payload caches until publication writers own a
  single invalidation/revision seam; visibility or content revocation now takes effect
  on the next request.
- Added an explicit frontend `PublicLetter` contract and kept the full workflow-aware
  `Letter` contract behind admin APIs. Public components no longer compile against
  fields the backend intentionally omits.

Evidence:

- Focused public-boundary matrix: 49/49 tests passed. The lifecycle/publication
  correction surface passed 60/60 before its separate `8547874c` checkpoint.
- Integrated full backend suite: 61 files and 563 tests passed; backend typecheck
  passed.
- Focused frontend public-contract surface: 5 files and 110 tests passed.
- Full frontend suite: 86 files and 593 tests passed; frontend typecheck and production
  build passed with the pre-existing large-chunk warning.
- Aggregate `CI=1 ./scripts/verify-all.sh` passed the backend suite/typecheck, frontend
  suite/build, and mocked browser gate. The browser suite was also rerun with the line
  reporter and passed 35/35.
- `git diff --check` passed.

Residuals carried forward:

- Entity junctions do not yet identify which extraction run produced them, and reruns
  append rather than atomically replacing a letter-owned projection. Public aliases,
  place notes, and place themes remain intentionally omitted because their canonical
  rows cannot prove public provenance. Slice 009 adds run provenance and atomic
  replacement before richer fields can be restored safely. This residual is closed by
  Slice 009 below.
- Admin DTO/read-model separation remains broader than this correction. This slice
  establishes the public side of the boundary without combining it with an admin API
  rewrite.

## Slice 008C — Public Delivery, Image Authorization, and Navigation Cleanup

Status: complete at `97bca4a3`

Problem:

Private image bytes shared the general API-token boundary, credential-bearing URLs
could escape into browser/cache history, public transform caching was vulnerable to
credential-shaped cache fragmentation, and image telemetry accepted more data than the
server needed. Collection navigation simultaneously retained a second cache/scrubber
state model, while featured/start-here repair writes could overwrite a newer curator
selection.

Delivered invariant:

- Hidden images require a purpose-bound, host-only, `HttpOnly` image-session cookie.
  General API verification rejects image tokens, deleted or hidden records are checked
  at the image boundary, and credential-bearing responses are `private, no-store`.
- Public transforms share one content-versioned encode cache even when a request
  carries irrelevant query, bearer, or cookie data. Public bytes remain revalidated;
  private bytes never enter that cache.
- Image URLs are scrubbed of credential-shaped query parameters. Telemetry is a
  bounded chronological queue, sends at most 20 sanitized records, and dequeues only
  after `sendBeacon` accepts the batch. Server parsing, rate limiting, body size, and
  malformed-body logging are bounded.
- Featured-setting normalization/deletion and collection start-here repair use
  compare-and-swap. A lost repair rereads the curator winner, collection selections
  cannot point into another collection, and the selected ID plus reason are one
  coherent snapshot.
- Public collection navigation has one fresh request per route generation. The
  duplicate cache, scrubber hook, adjacent-collection hook, and no-op image-access prop
  plumbing are deleted.

Entropy removed:

- Deleted the retired collection-analysis producer, prompt, endpoint/client surface,
  and stale browser test—roughly 900 lines from a UI path removed in March 2026.
- Deleted the old collection navigation cache and overlapping hooks rather than
  adapting them to the new public contract.

Evidence:

- Definitive `CI=1 ./scripts/verify-all.sh`: backend 76 files / 669 tests, backend
  typecheck, frontend 91 files / 610 tests, production build, and mocked browser suite
  35/35 all passed.
- Image route integration surface passed 15/15; bounded frontend telemetry passed 5/5.
- Featured/start-here and navigation concurrency regressions passed before the
  aggregate gate, including lost compare-and-swap and A→B→A failed-refresh cases.
- Full frontend execution is capped at 25% of machine-relative workers. The prior
  unrestricted JSDOM run timed out only under worker oversubscription; isolated tests
  and the complete 91-file suite pass with their real five-second assertions intact.
- `git diff --check` and the retired-symbol repository sweep passed.

Residuals carried forward:

- The production build still reports the existing large-chunk warning, including the
  editor and review surfaces. This checkpoint did not hide or raise that limit.
- Public read models are explicit, but broader admin DTO decomposition remains future
  work.

## Slice 009 — Retry-Safe Entity Extraction Projection

Status: complete at `97bca4a3`

Problem:

Entity reruns appended into shared junction tables and then marked the letter
successful in a separate write. A cancelled, retried, old-version, or concurrent run
could therefore leave a mixed projection or report success after losing ownership.
Relationships and merge/undo paths could also combine content from one source with
provenance from another.

Delivered invariant:

- A claim reserves the next entity revision under a unique run ID without replacing
  the last committed projection. One transaction materializes people, places,
  relationships, and review items, verifies the exact owner, and publishes the JSON,
  revision, status, and complete projection together.
- Ambiguous revisionless conflicts abort the transaction. Revision-0 legacy rows are
  promoted only when their stored extraction document proves the match. Backfill uses
  exact compare-and-swap and never reports a skipped conflict as inserted.
- Public entity and relationship queries accept only human-confirmed rows or rows whose
  discovery letter still commits that exact revision and non-null extraction document.
- Merge collision selection keeps a complete content/provenance tuple. Merges lock
  canonical and affected child rows in stable order; undo verifies the recorded
  post-merge state, refuses partial/diverged restores, and rolls back without a false
  audit entry.
- Manual participant and relationship edits atomically switch to the complete human
  provenance tuple. Letter identity metadata and its participant projection now share
  one transaction, so projection failure cannot return HTTP success after committing
  only the letter.
- Migration 0051 is an expand/drain boundary: it blocks new tokenless runs, stamps and
  atomically promotes output from a pre-existing old run, rejects stale old terminal
  writes over a current owner, and discards an abandoned candidate before its revision
  can be reused.

Evidence:

- Definitive `CI=1 ./scripts/verify-all.sh`: backend 76 files / 669 tests, backend
  typecheck, frontend 91 files / 610 tests, production build, and mocked browser suite
  35/35 all passed.
- Focused migration/lifecycle coverage passed 102 tests; final merge/provenance coverage
  passed 81 tests; the transactional identity and manual-provenance affected surface
  passed 100 tests.
- Migration registration validation passed 7/7 and `drizzle-kit check` reported no
  drift. `bash -n scripts/test-migrations.sh` and `git diff --check` passed.
- An isolated PostgreSQL 17 cluster applied the complete 0000–0051 journal and proved
  malformed-JSON safety, all four provenance indexes, mixed-version drain, stale
  terminal fencing, and legacy crash → cancellation → current revision reuse without
  inheriting partial output.
- Docker was offline, so the standard container wrapper could not run. Its persistent
  migration regression and shell syntax are checked in; the equivalent native
  PostgreSQL 17 execution is the runtime evidence for this checkpoint.
- Multiple adversarial review passes found and corrected lost curator updates,
  cross-collection selection, stale navigation, partial merge undo, child-row merge
  races, false-success identity saves, mixed provenance, and legacy revision reuse
  before the aggregate gate.

Residuals carried forward:

- This checkpoint intentionally left current entity runs unleased. Slice 013 later
  closed that residual with run-bound leases, heartbeats, and intent-specific recovery.
- Migration 0051 is drain-only: deploy the boundary, let or terminate old entity
  executors, then cancel remaining tokenless rows before starting new claimers. Do not
  cancel a tokenless row while its old executor is still materializing child output.
- The largest UI and route files remain. This checkpoint made their data boundaries
  safer; it did not yet decompose `AdminDashboard.css`, `LineReviewMode.tsx`,
  `LetterReviewPage.tsx`, or the public letters route.

## Slice 010 — Retire the Legacy In-Process Batch Executor

Status: complete at `a8359250`

Problem:

`processing-queue.ts` still owns a mutable in-memory `processingState` and
`processLettersAsync()` loop in addition to the polling worker and the process-registry
runner. Legacy start routes, upload auto-start, and bulk operations choose between a
configured Cloud Run job and this API-process fallback. Pause/abort semantics are
therefore process-local, execution ownership depends on deployment configuration, and
the legacy loop participates in the processing import cycle.

Delivered invariant:

Batch entry points persist eligible `PENDING` work and optionally wake a configured
worker; they never execute AI work in the API process. Local development uses the
documented separate worker process. One durable eligibility definition includes entity
work in wake/exit decisions, and the documented transcript-confirmation gate applies
to every metadata producer.

What changed:

- Deleted `processLettersAsync()`, its module-global state and counters, its local
  fallback, and the legacy status/pause/resume/abort HTTP, dashboard, API-client, CSS,
  E2E, and admin-CLI surfaces.
- Filtered starts, post-upload auto-start, and bulk transcription/metadata now only
  preserve or compare-and-set durable queue state and request a configured-worker
  wake. Their responses distinguish a matching queued count from execution scope;
  local execution requires the separate worker.
- Added `processing-eligibility.ts` as the one stage-specific predicate boundary used
  by enqueue/reset/retry operations, worker polling, wake/exit decisions, queue
  snapshots, filtered starts, registry eligibility, and queue clearing. Transcription
  requires a transcribable type and a page; metadata requires a confirmed nonblank
  transcript and idle downstream stages; entity work requires successful metadata.
  All three exclude dead-letter rows once queued.
- Entity-only work now participates in level-triggered wakeups and both empty-worker
  checks. The worker publishes idle before its final database recheck, and repeated
  cleanup cannot overwrite a replacement worker heartbeat with a second old-worker
  idle write. The worker deployment now includes the region/job identity needed to
  request a successor execution when that final recheck finds work.
- Removed the contradictory `skipConfirmationCheck` contract. Queued and requested
  metadata claims both enforce confirmation, while the transcript-confirm-and-claim
  operation remains the sole atomic exception. Bulk metadata uses the complete observed
  source/job compare-and-set, resets retry/dead-letter state, and cannot report a row
  queued after confirmation or downstream state changes.
- Explicit entity requeues clear stale dead-letter state. Metadata confirmation and
  successful publication also establish the non-dead-letter invariant needed by the
  entity worker.
- Pipelines now import progress/abort state directly from the temporary registry
  runner, removing the queue compatibility shims and three processing import cycles.
  Architecture tests reject any return of the retired executor or queue-to-pipeline
  ownership.

Evidence:

- Backend typecheck and the complete backend suite passed: 76 files / 693 tests.
- Frontend complete suite and production build passed: 92 files / 612 tests.
- Playwright discovered 547 tests in 36 files after obsolete legacy-control coverage
  was removed; the deterministic mocked browser gate passed 35/35.
- Focused queue, bulk, metadata-claim, worker-state, worker-handoff, route, pipeline,
  and architecture characterization passed before the aggregate runs.
- No schema or migration changed. Stale-symbol search and `git diff --check` passed.

Residuals carried forward:

- The process-registry runner still starts API-memory batches and owns process-local
  pause, abort, progress, and mutex state. Its Processing-page contract is deliberately
  retained for one separately characterized deletion.
- Explicit single-letter regeneration still runs synchronously in the request process
  behind the canonical persisted claim/publication owners.
- Recovery still runs in both API and worker because one API batch executor remains.
- The durable queue and registry APIs still duplicate snapshot and queue-management
  scaffolding; consolidation belongs with registry retirement, not this slice.
- Filtered start endpoints count matching globally queued rows, but they do not persist
  a scoped batch selection. The wake is deliberately documented as global; a future
  scoped-batch feature would need durable selection state rather than another
  process-local list.
- `worker_state` is still an ownerless singleton. Stage run fences protect content, but
  an AI call longer than the two-minute availability window can make a replacement
  worker appear necessary, and overlapping executions can publish competing
  availability. Slice 011 must choose an execution token/compare-and-set boundary or a
  continuously renewed availability lease before claiming singleton ownership.

## Slice 011A — Move Queued Extra Content to the Durable Worker

Status: complete at `fa7eedb8`

Problem:

The process registry was the only executor and management surface for standalone
`extraContentJobStatus = PENDING` work. Deleting it directly would strand jobs created
when supplementary T/C/E pages change after the primary letter has already completed
main transcription.

Delivered invariant:

- Primary letters with related T/C/E records use one shared extra-content prerequisite
  and queue predicate across the worker, wake/exit checks, the temporary registry
  adapter, snapshots, queue clearing, and retries.
- The worker claims queued extra content through the canonical run/lease boundary,
  processes it before metadata, publishes normal stage failure notifications, and
  includes queued or dirty-recoverable leases in its empty-job decision.
- Durable queue observation and remove/clear/retry/cancel operations cover extra
  content. Every mutation clears or revokes the complete ownership tuple and uses the
  same compare-and-set protections as the existing lifecycle owner.
- Automatic upload processing asks whether *any* durable stage needs a worker, so an
  extra-only invalidation is not ignored. Cancelling a dirty extra attempt rechecks for
  its persisted PENDING replacement and requests a contained worker wake.
- Extra-content recent and queued timestamps are not fabricated from the letter-wide
  `updatedAt`/`createdAt` fields. The durable snapshot reports no extra terminal history
  and a null queued timestamp until a stage-specific timestamp exists.

Evidence:

- Focused eligibility, queue, recovery, ownership, route, and upload coverage passed:
  6 files / 104 tests.
- Definitive `CI=1 ./scripts/verify-all.sh` passed: backend 76 files / 711 tests,
  backend typecheck, frontend 92 files / 612 tests, production build, and mocked
  browser suite 35/35. The existing large-chunk build warning remains visible.
- `git diff --check` passed.
- Independent adversarial review found and drove fixes for extra-only upload wake,
  dirty-requested exit liveness, dirty-cancellation wake, and fabricated history. It
  reported no remaining P1 correctness blocker in the slice.

Rollout note:

Migration 0044 initialized historical extra-content job rows as `PENDING`. This slice
now gives that durable state its ordinary meaning: a primary L record with related
T/C/E sources is worker-eligible. Before deployment, inspect the historical eligible
count and either deliberately accept the AI backlog or reconcile rows that already
have authoritative extra content. No deployment or external job launch is part of this
checkpoint.

Residuals:

- The API registry executor can still race the worker for an extra-content claim during
  this transitional checkpoint; the canonical compare-and-set lets only one own it.
- Metadata and entity recent activity still inherit the pre-existing letter-wide
  timestamp ambiguity. This slice did not expand that known reporting flaw to the new
  stage.
- `worker.ts` now exposes the fourth repeated stage loop. Registry retirement should
  first delete the competing executor; a later contained worker-loop extraction can
  consolidate repetition without mixing that refactor into the ownership move.

## Slice 011B — Retire the Process-Registry Batch Executor

Status: complete at `9e480383`

Problem:

The Processing page still starts `processes/runner.ts` batches inside the API process.
Its mutex, progress, pause, and abort state disappear on restart and cannot control the
separate worker. The registry also duplicates eligibility, queue snapshots, and CRUD
already exposed by the durable worker-owned queue.

Delivered invariant:

Automatic/batch AI work has one runtime owner: the worker. The Processing page observes
and mutates durable four-stage state and may request one global worker drain; it never
creates a second executor or claims a stage/filter-scoped batch exists. Direct
single-letter requests remain explicit and separately fenced. Recovery ownership stays
transitional until worker availability and its eventual wake are durable.

What changed:

- Deleted the complete `services/processes/` registry island, its API routes, duplicate
  queue CRUD, fire-and-forget runner, mutex, pause/abort state, process-local progress
  map, processing SSE/token path, and batch notification wrapper. Pipeline owners no
  longer import control or progress state from an unrelated API process.
- Deleted filtered transcription/metadata/entity starts. They counted matching
  already-pending rows but woke a global worker, so their apparent scope was not a
  durable execution contract. One unfiltered `/admin/processing/wake` now distinguishes
  empty durable state, absent managed-worker configuration, and an actual request; a
  Cloud Run trigger failure remains an API error.
- Rebuilt the Processing page directly over `/admin/processing/queue`. One static
  frontend descriptor defines the four display stages; active jobs remain arrays, queue
  counts are explicitly labelled as rows shown, stage-ambiguous queue/active times are
  not rendered, and shared recent timestamps are labelled as reported observations.
  The page uses one non-overlapping five-second poll plus manual refresh. A refresh
  requested while a read is active queues exactly one follow-up read, so mutation
  invalidation cannot settle on a pre-mutation snapshot.
- Split the 769-line route into a thin coordinator and focused stage summary, queue,
  recent activity, worker observation, stage descriptor, and formatting modules. The
  removed SSE hook and registry API client were not replaced with compatibility layers.
- Dashboard processing now requires explicit selected IDs. Zero-selection actions are
  disabled, select-all-filtered IDs are all sent to the bulk API instead of being
  silently reduced to the currently loaded page, transcription's real overwrite flag
  is explicit, and the nonexistent bulk-metadata overwrite promise was removed.
- The admin CLI now observes extra-content queue rows and exposes only queue inspection
  plus the same truthful global worker wake.

Evidence:

- Focused backend ownership/route/queue/pipeline coverage passed: 7 files / 138 tests.
- Complete backend suite passed: 75 files / 678 tests. Backend typecheck and the
  standalone admin CLI typecheck passed.
- Focused frontend processing/dashboard coverage passed: 5 files / 30 tests, including
  mid-flight and completion-boundary queued-refresh race regressions.
- Definitive `CI=1 ./scripts/verify-all.sh` passed: backend 75 files / 678 tests,
  backend typecheck, frontend 92 files / 615 tests, production build, and the mocked
  browser suite 37/37. The existing large-chunk build warning remains visible.
- Rewritten mocked Processing browser coverage passed 6/6, including all four stages,
  multiple same-stage active rows, durable mutations and errors, truthful wake
  outcomes, and a 390-pixel overflow/control check.
- A real Chromium render with route-mocked durable data was inspected at 1440×1000 and
  390×844. Both retained the four-stage hierarchy and controls; the narrow document
  measured exactly 390 pixels wide with no horizontal overflow, and the truthful
  unconfigured-worker wake outcome was visible.
- Backend and frontend stale-symbol searches and scoped `git diff --check` passed.
- Independent adversarial review found one stale-snapshot race in refresh coalescing.
  The fix queues a single post-flight read without overlap, has focused regression
  coverage, and no other P1/P2 ownership or correctness blocker was reported.

Residuals carried forward:

- API startup and its periodic timer still run safe lease reconciliation. This is no
  longer justified by an API batch executor; it remains because the ownerless
  `worker_state` singleton and enqueue-time wakeups do not yet guarantee eventual
  recovery after an exhausted or quiet failure.
- `worker_state` is last-reported observation, not authoritative liveness. Slice 011C
  must add an execution-token lease, token-fenced writes/releases, independent renewal,
  and an external scheduled job invocation before recovery moves out of the API.
- Entity extraction remains run/revision fenced but unleased. Current orphans stay
  visible for exact administrative cancellation rather than being guessed dead.
- Metadata/entity recent reporting still uses a shared letter timestamp. The UI labels
  it as reported activity rather than exact completion time; stage-specific timestamps
  remain separate schema debt.
- Explicit single-letter regeneration remains request-owned behind the canonical claim
  and publication boundaries. This slice removes automatic execution duplication, not
  intentionally synchronous admin actions.

## Slice 011C — Fence Worker Execution and Prepare Recovery Handoff

Status: repository implementation complete at `931ee06d`; operational recovery
contraction remains gated

Target invariant:

Exactly one worker execution owns availability through a database-clock lease and
token-fenced writes. Producers use persisted PENDING state for low-latency wakes, while
a scheduled Cloud Run Job invocation provides eventual reconciliation after exhausted
retries or a quiet API. API startup and its periodic timer stop mutating processing
recovery state only after the scheduled path is deployed and proven.

Delivered repository invariant:

- The `worker_state` singleton has a paired nullable UUID execution token and
  PostgreSQL-clock expiry. One atomic compare-and-set acquires it, exact live-token
  renewal extends it, and exact-token release cannot clear a successor.
- A contender that loses acquisition exits before recovery or queue discovery. The
  winner confirms ownership immediately and every 30 seconds through an independent,
  non-overlapping heartbeat with a local monotonic safety window.
- Every automatic transcription, extra-content, metadata, and entity claim includes
  the live worker token in the same SQL statement. Every worker-owned transcription,
  extra-content, and metadata recovery mutation has the same fence. A preflight that
  races ownership loss therefore cannot begin or recover new work.
- Signal handling stops future work but keeps the global lease alive while an already
  fenced stage settles. Cleanup stops recovery, stops renewal, and releases the exact
  token. On normal completion after a successful release, it performs a required
  post-release durable queue recheck/wake. The forced Cloud Run path exits nonzero
  after eight seconds and leaves the token to expire rather than releasing while an AI
  call may still be active.
- Public worker state never exposes the token. `isPolling` is derived from the live
  database lease; tick, batch, and error values remain exact-owner observations.
- Cloud Run trigger suppression uses the active database lease instead of a
  process-clock freshness guess. Cloud Build contains an OAuth-authenticated UTC
  five-minute Scheduler target with Scheduler retries disabled, but its substitution
  defaults to `false`.
- Database shutdown is explicitly owned by the API and worker entry points after their
  lifecycle cleanup; the shared database module no longer installs signal handlers
  that can close the pool before a worker drain finishes.

Evidence:

- Focused worker state, heartbeat, claim/recovery ownership, lifecycle, queue, and
  pipeline suites passed.
- Definitive `CI=1 ./scripts/verify-all.sh` passed: backend 80 files / 712 tests,
  backend typecheck, frontend 92 files / 615 tests, production build, and mocked
  browser 37/37. The existing large-chunk warning remains visible.
- `drizzle-kit check`, migration-script shell syntax, Cloud Build YAML parsing, both
  embedded Scheduler shell scripts, and `git diff --check` passed.
- A disposable native PostgreSQL 17 instance applied the complete migration journal
  through 0052. It passed the lease SQL contract, a genuinely blocked two-session
  acquisition race, actual Drizzle acquire/renew/publish/stale-release/release/active
  behavior, and inspection of the generated stage-admission token predicate.
- Independent concurrency and failure-mode review found no P0/P1 implementation
  blocker after fixes for database-close ordering, renewal/report time bounds,
  stage/recovery fencing, Cloud Run shutdown timing, and concurrent migration proof.

Rollout boundary:

This checkpoint does not deploy migration 0052, replace the worker, enable Scheduler,
or remove API recovery. The checked-in build flag is only a create/update gate and
does not pause an existing schedule. The operational sequence is:

1. Apply migration 0052 and deploy the lease-aware API and worker while API recovery
   remains active.
2. Drain or terminate executions launched from the pre-lease job definition.
3. Manually prove lease acquisition, renewal, exact release, and idle exit.
4. Enable the scheduled target in a later build, observe at least two ticks, and
   overlap a manual wake with one tick. One execution must own the lease and every
   contender must exit without processing.
5. Only in a later deployment remove API startup and periodic recovery.

Residuals:

- This checkpoint intentionally left entity extraction without a stage lease. Slice
  013 later closed that residual with exact liveness and expiry-aware recovery.
- Best-effort state reports are individually bounded, but the complete cleanup queue
  and required database release do not yet have an aggregate statement deadline.
- Worker lifecycle tests combine executable heartbeat/state tests with source-order
  assertions for the still-executable outer lifecycle. The processing cycle itself is
  now import-safe and behavior-tested; a later lifecycle seam can replace the
  remaining boot/signal/cleanup ordering assertions.
- The repeated discovery and four stage loops have moved out of `worker.ts`; Slice 012
  below records that completed boundary.

## Slice 012 — Extract the Worker Processing-Cycle Boundary

Status: complete at `45903733`

Problem:

`worker.ts` owned process boot, global execution leasing, recovery scheduling, polling,
signals, shutdown, final handoff, four queue queries, and four nearly identical stage
loops. A change to one stage required editing a large executable module, while most
cycle coverage asserted source ordering because importing the file starts the process.

Target invariant:

The executable owns only process lifecycle and the outer poll/drain loop. An
import-safe processing-cycle module owns one ordered cycle through the four explicit
stages and is exercised behaviorally through its production module wiring. Stage
eligibility, order, token forwarding, error isolation, notifications, and exit
semantics are unchanged.

Delivered invariant:

- `worker.ts` fell from 621 to 301 lines and now owns boot, the singleton execution
  lease, recovery scheduling, the outer poll/drain decision, signals, release,
  post-release handoff, and database close. It no longer imports pipeline producers or
  stage eligibility predicates.
- `worker-processing-cycle.ts` is import-safe and exposes only the batch-size constant,
  a three-member control contract, and `processWorkerCycle(control)`. Four private
  processors keep transcription, extra-content, metadata, and entity outcome contracts
  explicit. Only state/timing/error mechanics are shared.
- The cycle snapshots all four bounded, oldest-first durable queries before execution,
  checks live global ownership before and after each query and before every item, and
  preserves exact stage order, producer options, notifications, fixed discovered-size
  reporting, per-item failure isolation, and discovery-error propagation.
- No dependency container, normalized result union, generic stage framework, or
  request-owned abstraction was introduced. Tests mock the real production modules,
  so predicate-to-stage mapping, selected columns, limit 5, ordering, and producer
  calls are exercised without widening the production API for tests.
- Source-position assertions for the cycle were replaced with executable behavior
  tests covering ownership loss at every scan and stage, a deferred active producer,
  all neutral outcomes, exact failure/state sequences, notification envelopes, and
  the discovered-work result that drives exit-when-empty reconciliation.

Non-goals:

- No entity-extraction lease or recovery policy yet.
- No new concurrency, queue semantics, retry policy, notification behavior, or stage
  eligibility.
- No generic job framework or abstraction shared with request-owned processing.
- No frontend or API contract changes.

Evidence:

- Focused cycle, lifecycle, ownership, and real eligibility coverage passed: 4 files /
  52 tests. Backend typecheck and `git diff --check` passed.
- The complete backend suite passed: 81 files / 728 tests.
- Definitive `CI=1 ./scripts/verify-all.sh` passed the same backend suite and
  typecheck, frontend 92 files / 615 tests, the production build, and mocked browser
  37/37.
- Independent behavior, simplicity, and adversarial reviews found no remaining P0–P2
  issue after removing redundant source regexes and locking batch size, outer
  discovered-work wiring, and both normal/fallback notification contracts.

Residuals:

- The outer lifecycle remains an executable entry point, so acquisition, signal,
  cleanup, release, and fatal-exit composition still has small source-order tripwires.
  Heartbeat/state behavior and the complete processing cycle are executable tests.
- Entity extraction was the only automatic stage without stage liveness at this
  checkpoint. Slice 013 later added its lease, heartbeat, and expiry-aware recovery.

## Slice 013 — Durable Entity-Extraction Liveness

Status: complete at `0b76d592`

Problem:

Entity extraction atomically reserves a run/revision and publishes one complete
projection, but the active attempt has no database-clock lease, heartbeat, or persisted
queued-versus-requested intent. A killed worker or API request therefore leaves a
current `RUNNING` row indefinitely. The singleton worker lease prevents overlapping
automatic executors; it cannot prove that a particular entity attempt survived after
the process owning that global lease disappeared.

Delivered invariant:

Every new entity attempt has one run/revision-bound liveness contract before AI work
starts. Renewal and terminal projection publication must still own that exact live
attempt. Expiry reconciliation follows explicit persisted intent, reports one
compare-and-set winner, and never guesses that a tokenless, mismatched, or
rolling-deployment attempt is abandoned.

What changed:

- `entity-extraction-job.ts` now owns exact observed-state `QUEUED` and `REQUESTED`
  claims, the complete ownership tuple, renewal, failure, cancellation, and recovery.
  Every current claim binds its run and reserved revision to a five-minute deadline
  from the PostgreSQL clock.
- The shared heartbeat now awaits its initial renewal before any provider work. Entity
  extraction reloads authoritative source data after claiming, filters explicit
  sender/recipient corrections independently when a newer identity superseded them,
  and reports neutral ownership outcomes instead of false completion.
- Projection materialization refreshes the lease while acquiring the letter row lock.
  It holds that lock through child replacement and publishes only the unchanged exact
  run/revision tuple; the terminal predicate deliberately does not require the
  deadline to outlive database-only work while the heartbeat waits on that lock.
- Queued expiry returns to durable `PENDING`; requested expiry becomes visibly
  `FAILED`. Both preserve the last committed entity projection. Legacy, unleased,
  partially populated, or lease-mismatched attempts remain manual.
- Entity and extra-content claims are mutually exclusive. The current entity producer
  also self-fences at renewal, post-claim reload, transaction entry, and publication
  if an older extra-content executable starts during rolling overlap.
- Every entity status reset or invalidation clears the complete ownership tuple.
  Architecture tests constrain the sole `RUNNING` owner, every non-null ownership
  writer, all terminal/reset writers, recovery callers, worker-token admission, and
  the entity/extra-content exclusion.
- Worker recovery, wake, drain, and exit observations now include exact queued entity
  leases. The atomic projection model from Slice 009 remains unchanged.
- Migration 0053 is expand-only: nullable liveness fields are not backfilled, the
  shape check permits all-null or all-present metadata, and a trigger prevents a
  same-run current `RUNNING` writer from stripping its liveness while still allowing
  an older terminal writer to leave non-authoritative residue.

Evidence:

- Focused final ownership, pipeline, queue, route, and architecture coverage passed:
  7 files / 151 tests. Reviewer-specific focused suites also passed.
- Complete backend suite: 83 files / 765 tests. Backend typecheck, `drizzle-kit check`,
  migration validation 11/11, migration-script shell syntax, and `git diff --check`
  passed.
- Definitive `CI=1 ./scripts/verify-all.sh` passed: backend 765/765, frontend 92 files /
  615 tests, production build, and mocked browser suite 37/37. The existing large-
  chunk warning remains visible.
- A disposable native PostgreSQL 17 cluster applied the complete journal through 0053
  and passed the strengthened liveness fixture, a staged 0050 → 0051/0052 → 0053
  mixed-version replay, and both real two-session lock orders: recovery-first blocks
  stale publication, while publication-first blocks stale recovery.
- Docker was unavailable locally, so the container wrapper itself did not run. Its SQL
  and session interleavings were exercised against native PostgreSQL 17.
- Independent lifecycle, migration, pipeline, and simplicity reviews found no
  remaining P0–P2 issue after fixes for initial-renewal ordering, row-lock deadline
  semantics, stale explicit corrections, and mixed-version extra-content overlap.

Rollout boundary:

1. Schedule migration 0053 during a low-write window because its ordinary partial
   index creation can briefly block writes.
2. Apply 0053 before deploying the liveness-aware binary; it is safe while 0051-aware
   executors remain.
3. Drain or terminate older entity executors. Inspect tokenless, unleased, partial, and
   lease-mismatched `RUNNING` rows; cancel only an exact abandoned attempt after its
   producer is known to be gone.
4. Deploy the current API and worker. Unknown rollout residue remains deliberately
   excluded from automatic recovery and is overwritten only by a later exact claim.

This repository checkpoint did not deploy a migration, replace a worker, enable
Scheduler, or remove transitional API recovery.

Residuals:

- Migration 0053's ordinary index build is operationally scheduled rather than
  concurrent. A later contract migration may validate/tighten rollout-era shapes only
  after old binaries and residue are gone.
- API startup and periodic reconciliation remain until the already-documented worker
  schedule rollout is deployed and proven.
- The writer audit exposed the next correctness seam: inserting a new primary `L`
  page or force-replacing its stored source mutates transcription input without
  invalidating transcription, metadata, entity, review, or publication state.

## Slice 014 — Primary-Letter Page Source Commit Boundary

Status: complete at `9ae1a7cb`

Problem:

`findOrCreatePage()` couples T/C/E page changes to extra-content invalidation in the
same database transaction, but L-page insert/force-replacement passes no corresponding
effect. A changed image can therefore remain paired with a transcript, metadata,
entity projection, review state, and public visibility derived from the previous
source. Forced storage also unlinks the live object before copying its replacement.
The production Cloud Storage FUSE mount has no cross-instance file locking, so even a
local temp-and-rename overwrite would still let filesystem and database commit order
diverge across API instances.

Delivered invariant:

A meaningful primary-letter page change switches the page to a new immutable object
and revokes every source-derived processing/publication authority in one explicit
database boundary. The old referenced object is never overwritten before commit.
Unchanged uploads are no-ops. An active producer or stale page-annotation client cannot
publish against the replaced source, and the durable queue truthfully reflects the
work required to rebuild it. A failed database transaction may leave an unreferenced
object, never new bytes behind an old published page pointer.

What changed:

- Migration 0054 adds monotonic letter/version source revisions, a revision/fingerprint
  contract for collection profiles, the profile fingerprint function, and constrained
  highlight cleanup. Primary page DTOs now carry their committed revision.
- New and forced page bytes are written to checksum-verified immutable objects. The
  database transaction locks the complete correspondence group, switches the page
  pointer, increments the source revision, and invokes one canonical invalidation
  owner. Unchanged uploads retain the current revision and do no derived-state work.
- Source invalidation revokes stale transcription, metadata, entity, review,
  annotation, version, profile, and publication authority. It creates truthful queued
  rebuild state and emits notifications/wakes only after commit.
- All active producers and direct editor mutations now compare the source revision
  they observed. Notes use one source-plus-metadata compare-and-set owner, line
  mappings and reading-view mutations are fenced, and stale clients receive the shared
  terminal `SOURCE_REVISION_CHANGED` conflict.
- Processing queue snapshots carry source and stage tokens. Bulk actions reject stale
  snapshots, while a clear operation remains explicitly tied to the frozen snapshot it
  reports.
- Canonical publication, collection-profile publication, and public collection reads
  have final atomic authority checks. Companion-page content ownership stays distinct
  from the canonical catalogue publication root.
- Correspondence deletion locks and fences every observed member, commits database
  deletion first, and treats object removal as best-effort cleanup. Collection edits,
  identity changes, bulk operations, verification, versions, and direct publication
  all use named mutation owners instead of reproducing partial reset patches.
- Multi-page uploads propagate the committed successor revision only within the
  matching correspondence identity. Force upload is deliberately single-file so one
  replacement cannot ambiguously advance several source owners.
- Letter Review guards both same-letter DTO adoption and cross-letter async responses:
  a stale revision becomes a sticky terminal editor conflict, and a slow response for
  letter A cannot hydrate the route after navigation to letter B.

This was a broad integrity slice, not the structural simplification finish line. Its
size is mostly executable ownership coverage and explicit safety owners. Large route
and component files remain the next architecture concern.

Evidence:

- Complete backend suite: 101 files / 1,007 tests. Backend typecheck, migration
  validation 12/12, `drizzle-kit check`, harness syntax, migration-script syntax, and
  `git diff --check` passed.
- Complete frontend suite: 108 files / 718 tests. TypeScript production build and
  ESLint across all 74 changed or new TypeScript files passed.
- The settled mocked browser suite passed 40/40.
- A disposable native PostgreSQL 17 database applied the journal through 0054 and
  passed the page-source ownership and concurrency interleaving harness.
- Independent data-integrity and adversarial reviews found no remaining P0 or P1
  issue after fixes for deletion fencing, queue snapshot ownership, note resolution,
  companion publication, public profile revocation, stale route responses, and
  multi-page force uploads.
- The existing production-build warning remains for the large `LetterReviewPage` and
  `UpdateEditorPage` chunks.

Rollout boundary:

Migration 0054 is not mixed-binary write-safe. Roll it out as a write-quiesced
boundary:

1. Pause workers and administrative writes.
2. Drain every old API and worker process.
3. Apply migration 0054 while writes remain closed.
4. Deploy the new API and worker, route 100% of traffic to them, and confirm old
   processes are gone before reopening writes.
5. Smoke-test unchanged upload, replacement/revision advancement, stale-editor
   conflict, derived-state invalidation, worker rebuild, and public/profile gating.
6. Resume workers and administrative writes.

Rollback keeps migration 0054 and immutable candidate objects in place and rolls
forward with a corrected binary. An older binary may be used only for read-only
diagnosis. This repository checkpoint did not apply a production migration, deploy a
binary, resume a worker, or change external infrastructure.

Residuals:

- Failed or ambiguous database commits can leave safe unreferenced immutable objects;
  a grace-period orphan collector is still needed.
- Correspondence deletion fences every member observed under lock, but group membership
  itself has no revision/fingerprint. A same-revision concurrent insertion seam should
  be closed in a later lifecycle slice.
- Dormant linked-person/place mutation endpoints have no current UI caller and remain
  outside the source-revision contract.
- Content autosave and version-history append still use two commits. Legacy collection
  profiles without a fingerprint are withheld until regeneration rather than
  backfilled from uncertain source.
- Several ownership tests are curated source-level tripwires rather than an exhaustive
  writer manifest. Selecting multiple rows from one correspondence for bulk deletion
  can also report one success followed by a harmless 404 after the group is gone.
- Structural debt remains visible: `LetterReviewPage`, `LineReviewMode`, processing
  queue, public letter routes, and the dashboard stylesheet still own too much.

## Slice 015 — Shared Reviewable-Editor Interaction Ownership

Status: complete at `70ef6f3c`

Supporting feedback fix: `c8ac080b`

Problem:

Photo Description and Extra Content each rendered the same `DynamicEditor` verified
flow, but `LetterReviewPage` owned two tooltip controllers, two unused imperative
editor refs, and six nearly identical Tab/click/double-click callbacks. Both passive
sections exposed 15 props. Double-clicking a verified editor also duplicated each
domain's already source-fenced unverify mutation.

Delivered invariant:

The route owns domain mutations and source-conflict handling. One small, UI-only
component owns verified contenteditable locking, tooltip placement/dismissal,
double-click gating, and Tab indentation for both real consumers. The adopted backend
status is the sole editability authority: a pending, failed, wrong-letter, or
source-revision-conflicted unverify response cannot unlock the editor locally.

What changed:

- `ReviewableDynamicEditor` is an 87-line, five-prop interaction boundary used only by
  Photo Description and Extra Content. It knows nothing about letter IDs, source
  revisions, APIs, DTO adoption, notifications, or autosave.
- Both sections retain their domain-specific header/actions while delegating the
  shared editor surface. Each section contract dropped from 15 props to 7.
- `LetterReviewPage` dropped from 2,005 to 1,823 lines. Direct callback ownership fell
  from 39 to 33, refs from 6 to 4, and tooltip owners from 2 to 0. State and effect
  counts deliberately did not change; the line-review interaction gate still owns the
  two explicit editing flags until that behavior is characterized.
- Across the six affected/new production files, physical source fell from 2,484 to
  2,271 lines: 213 lines removed rather than merely moved.
- Each domain now has one source-fenced unverify handler. The wrapper remains locked
  until the guarded Letter DTO adopts the returned editable status.
- The unused four-method `DynamicEditorRef`, both forwarding refs, and the public type
  export were deleted. `DynamicEditor` remains the low-level controlled editor.
- Unit coverage now owns verified locking, tooltip/edit delegation, one-change Tab
  reporting, both domain section states, and the architecture boundary. Mocked browser
  coverage proves successful verified Extra Content unlocking and fail-closed
  `SOURCE_REVISION_CHANGED` behavior.

The first aggregate run exposed an unrelated but repeated false failure: the shared
Express test helper treated any mocked request exceeding 50 ms as hung. `c8ac080b`
replaced that scheduler-sensitive threshold with a one-second default below Vitest's
five-second deadline, retained caller-controlled short deadlines, removed the
incorrect `headersSent` completion exemption, and added delayed-success plus
never-completes regression tests.

Evidence:

- Focused editor/section/ownership coverage passed 5 files / 17 tests. The two new
  browser interactions passed in isolation.
- Complete backend suite: 102 files / 1,009 tests. Backend typecheck passed.
- Complete frontend suite: 111 files / 727 tests. TypeScript production build and
  ESLint across every changed/new frontend TypeScript file passed.
- Definitive `CI=1 ./scripts/verify-all.sh` passed the same backend and frontend suites,
  production build, and mocked browser suite 42/42 after the harness fix.
- `git diff --check` passed. The rendered wrapper/classes did not change, and the full
  browser suite found no layout or interaction regression.
- Independent ownership, simplicity, and adversarial reviews found no remaining P0 or
  P1 issue. The duplicate Chromium Tab change callback found in review was removed and
  is now constrained to exactly one report.
- The existing build warning remains: `LetterReviewPage` is 502.72 kB and
  `UpdateEditorPage` is 1,182.96 kB after minification.

Residuals:

- This is honestly a shared interaction boundary, not a vertical domain-workspace
  extraction. Route-owned state/effects and mutation coordination remain for Slice
  016.
- The two explicit supplemental-editor editing flags still gate entry into line
  review. Combining or deleting them without first characterizing simultaneous edits
  would change behavior.
- Verified editor discovery remains pointer-oriented (tooltip plus double-click), an
  existing accessibility debt this slice did not worsen.
- `DynamicEditor` now has one production consumer while remaining a common low-level
  export. Revisit that placement only if another real consumer does not emerge.

No product feature, API, backend production behavior, database schema, deployment, or
external state changed in this slice.

## Slice 016 — First Letter Review Vertical Workspace

Status: complete at `fdb7acfd`

Problem:

Photo Description was rendered by its own section, but `LetterReviewPage` still owned
its draft/context/dialog state, generation, editing, verification, and autosave
callbacks, API imports, and inline context modal. That left six related operations
scattered through a 1,823-line route. The guarded Letter DTO setter returned no
adoption outcome, so a rejected stale response could still be followed by local
success state and a success toast. A response from an earlier A visit also needed to
remain stale after an A → B → A navigation.

Delivered invariant:

One per-route-visit owner now coordinates the complete Photo Description workflow.
Async completion can update local state or report success only while its originating
route visit is current and its returned Letter DTO passes guarded adoption. Busy state
is also route-visit scoped, so a late completion cannot clear the active workspace's
lock. The section remains in the scrollable editor content and the non-portaled modal
remains at the route tail, preserving their existing DOM ancestry and layout.

What changed:

- `usePhotoDescriptionWorkspace` owns description/context/dialog state plus generation,
  edit, verify, unverify, and scheduled autosave behavior. The route consumes two
  declarative render contracts rather than reproducing the workflow.
- `PhotoDescriptionContextModal` extracts the existing modal without nesting it below
  the editor section. Controls remain locked during generation.
- `useGuardedLetterState` now exposes the boolean result of `tryAdoptLetter()`.
  Workspace-local success state and notifications occur only after adoption succeeds.
- `useLetterSavingState` scopes saving ownership to a route-visit identity. Late
  completion from A cannot clear B or a fresh A visit.
- The explicit photo line-review editing flag was removed after characterization
  proved it unreachable: photo workflows cannot also satisfy the primary-transcript
  content predicate used by image line review.
- `LetterReviewPage` fell from 1,823 to 1,633 lines. Direct route state calls fell from
  35 to 28 and callbacks from 33 to 27; refs and effects stayed at 4 and 7.
- Across the affected/new production files, physical source rose from 2,520 to 2,681
  lines. The 161-line increase is explicit ownership and stale-response safety rather
  than a raw line-reduction win; no new production file exceeds 204 lines.
- The mocked Letter Review API now models photo generation, edit, verification,
  unverification, context, request capture, and coded source conflicts. Browser tests
  cover the complete workflow and fail-closed conflict behavior.

Evidence:

- Focused frontend coverage passed 9 files / 43 tests, including route-visit and
  A → B → A generation/autosave interleavings. ESLint passed on every changed/new
  frontend TypeScript file.
- Complete backend suite passed 102 files / 1,009 tests and backend typecheck passed.
- Complete frontend suite passed 114 files / 745 tests and the production build
  succeeded.
- The complete mocked browser suite passed 45/45 in its settled run. During the
  definitive aggregate verification, one unrelated Processing Queue timing assertion
  required Playwright's automatic retry; it then passed and also passed immediately
  when rerun alone.
- `CI=1 ./scripts/verify-all.sh` completed successfully, and `git diff --check` passed.
- Independent ownership, UI/test, simplicity, and adversarial reviews found no
  remaining P0 or P1 issue.
- The existing build warning remains: `LetterReviewPage` is 503.85 kB and
  `UpdateEditorPage` is 1,182.96 kB after minification.

Residuals:

- All Letter Review workspaces still share one debounced-save timer and status label.
  A deliberately ignored stale photo-save rejection can therefore briefly present
  `Saved`, although it cannot mutate or block the active workspace. Characterize that
  coordinator before extracting Extra Content.
- Saving remains a Boolean within one route visit rather than an operation lease or
  counter. This preserves existing same-visit semantics but should be revisited with
  the shared mutation scheduler.
- Fresh nested prop objects prevent `PhotoDescriptionSection`'s `React.memo` from
  skipping parent rerenders. Treat this as measured performance debt, not a reason to
  add memoization machinery speculatively.
- This slice improves ownership and shrinks the route, but does not yet reduce total
  affected production lines. Continue reducing the parent through characterized
  vertical workspaces.

No product feature, public API, backend production behavior, database schema,
deployment, or external state changed in this slice.

## Slice 017 — Letter Review Mutation Scheduling Ownership

Status: complete at `9775a30a`

Problem:

Letter Review used one mutable debounce timer and one Boolean saving flag for unrelated
domains. Scheduling an Extra Content save could cancel a metadata save; immediate
verify/delete/direct actions could overtake queued edits; concurrent operations could
unlock the page when only one finished; and a slow response from an earlier A visit
could still affect a fresh A visit after A → B → A navigation. Identity changes were
also split across an identity write and metadata retag without one ordering owner.
Finally, the visible date, emotional-tone, relationship, and primary-topic editors
changed local state but did not all persist through the admin update contract.

Delivered invariant:

Every Letter Review mutation belongs to an opaque route visit and a source-revision
target. Autosaves are cumulative, typed by domain lane, and executed by one
target-wide serial pump. A direct mutation first flushes every queued lane and stops if
any unresolved save remains. A lane failure remains unresolved until that producer
successfully persists the complete intent or the user deliberately returns the field
to the persisted baseline. Identity compare-and-set and required retagging form one
ordered workflow. Async completion may update visible state only if its originating
visit is still active and the returned DTO passes guarded adoption.

What changed:

- `LetterReviewAutosaveCoordinator` owns four explicit lanes—letter fields, identity,
  Extra Content, and Photo Description—under one per-target serial queue. One domain
  cannot cancel another, delayed tasks preserve target order, flush is a real barrier,
  and failures survive unrelated success.
- Letter-field and identity producers retain failed intent and merge it beneath newer
  partial edits. Reverting a failed identity edit to the persisted baseline explicitly
  resolves the lane without issuing a second API mutation.
- `useIdentityAutoSave` now owns the countdown, compare-and-set payload, pending
  identity intent, ordered retag continuation, retry, and visible status. A second
  identity cannot overtake the first retag, a failed retag is repaired before the next
  identity, and in-app unmount does not interrupt the continuation.
- `useLetterReviewVisit` replaces route-ID equality with an opaque visit token, so
  first-A work is stale during a fresh A visit. Guarded DTO adoption, source-conflict
  ownership, timers, drafts, and delayed delete navigation use that fence.
- `useLetterSavingState` now returns counted, idempotent operation leases. Explicit
  mutation controls remain disabled until every overlapping operation releases its
  own lease.
- Direct route mutations flush queued saves before executing and adopt/hydrate only a
  current response. Deletion also uses the flush barrier and visit-fenced navigation.
- The existing date, emotional-tone, relationship, and primary-topic controls now
  persist canonical values through the frontend client, validated backend schema,
  flattened columns, structured metadata projection, version history, and derived
  participant relationship where applicable. This repairs existing nonfunctional
  controls; it does not add a new workflow.
- Browser coverage proves immediate verification waits for structured metadata,
  immediate Extra Content verification waits for its edit, and independent domains no
  longer cancel one another.

Evidence:

- Focused autosave, identity, and coordinator coverage passed 3 files / 48 tests,
  including cumulative failure recovery, A → B → A isolation, ordered retagging,
  intentional revert, unmount continuation, and flush behavior.
- Focused backend metadata contract coverage passed 48 tests.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- Complete frontend suite passed 118 files / 801 tests. Frontend TypeScript build,
  production build, and ESLint over every changed/new frontend TypeScript file passed.
- The complete mocked browser suite passed 47/47; the changed Letter Review spec passed
  21/21 in isolation.
- `git diff --check` passed. Independent implementation, UI/test, simplicity, and
  repeated adversarial reviews found no remaining correctness finding after fixes for
  cross-lane failure masking, cumulative retry intent, retag ordering, countdown
  ownership, intentional failure abandonment, and fresh-visit isolation.
- Existing production-build warnings remain. The Letter Review chunk is 520.37 kB and
  the Update Editor chunk is 1,182.96 kB after minification.

Residuals:

- `LetterReviewPage.tsx` is now 1,861 lines with 30 `useCallback` owners. The explicit
  safety protocol exposed rather than removed a repeated pattern across roughly a
  dozen direct handlers: acquire lease, flush, call API, adopt, hydrate/report, handle
  error, and release. Extract that protocol before the next vertical workspace.
- Identity-to-retag continuation survives route changes and React unmounts while the
  page process remains alive, but it is still client-owned. Closing the tab after the
  identity commit and before retag completion can leave derived metadata stale. A
  future backend transaction, durable job, or outbox is the reliable boundary.
- The identity metadata synchronization callback still uses a ref to bridge hook
  construction order. Remove that cycle when route mutation/hydration ownership moves.
- The coordinator and identity modules are intentionally cohesive but substantial.
  Do not split them by file length alone; first measure whether the direct-mutation
  extraction produces a clearer caller boundary.

No product feature, visual redesign, database migration, deployment, or external state
changed in this slice.

## Slice 018 — Letter Review Direct-Mutation Execution Boundary

Status: complete at `dc946648`

Problem:

Fourteen `LetterReviewPage` handlers independently reproduced some version of acquire
a saving lease, flush every autosave lane, call an API, reject a stale route response,
adopt and hydrate a returned Letter DTO, report a result, handle failure, and release.
The repetition made later workspace extraction risky. Counted saving leases prevented
an early visual unlock, but did not order overlapping full-Letter responses; a slower
older response could still overwrite a newer adopted DTO within the same route visit.

Delivered invariant:

Letter-returning direct mutations execute in call order within one opaque route visit.
Each call acquires its own saving lease at enqueue time, waits for the previous direct
mutation, verifies that its visit is still active, flushes all autosave lanes, performs
the request, adopts and fully hydrates only an accepted DTO, runs at most one
synchronous domain completion, and releases exactly once. Flush and request failures
use the established mutation-error owner. Post-adoption programming errors reject and
release, but are never misreported as a failed server mutation that is safe to retry.
A fresh A visit has a fresh queue, so queued or in-flight work from an earlier
A → B → A sequence fails closed.

What changed:

- `useLetterReviewMutationExecutor` is a 101-line visit-bound owner with one request,
  one failure message, and one optional synchronous `afterAdopt`. It has no action
  registry, selectors, lifecycle callback bag, command names, or generic result
  protocol.
- Visibility, content publication, Extra Content verify/unverify, flagging, and both
  structured-note mutations now use the same ordered boundary. Stateful AI,
  confirmation, deletion, and navigation workflows remain explicit.
- `useStructuredNoteActions` owns the add and resolve/dismiss requests, their
  source-revision payloads, and success copy. The route no longer imports or defines
  those mutations.
- Structured-note categories, priorities, resolution triggers, persisted notes, and
  drafts now have one frontend contract in `types/Letter.ts`. The previous component
  export, dynamic import cast, unused `letterId` prop, and stringly typed note draft
  contract were removed.
- `LetterReviewPage.tsx` fell from 1,861 to 1,745 lines and from 30 to 28 direct
  `useCallback` owners. The change removed 116 lines from the route while adding the
  executable ownership boundary and domain tests.
- The deterministic browser API now models note-status requests, revision conflicts,
  DTO hydration, and request capture. Browser coverage resolves a real structured note
  through the rendered Letter Review UI and verifies the exact revision-bound request.

Evidence:

- Focused executor, structured-note action, and architecture coverage passed 3 files /
  19 tests. It proves exact successful ordering, flush and inactive exits, one request
  failure report, stale-adoption rejection, per-visit serialization, counted overlap,
  A → B → A isolation, and truthful post-adoption failure semantics.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- Complete frontend suite passed 120 files / 814 tests; frontend TypeScript and the
  production build passed. One first full-suite run hit an unrelated five-second
  Admin Dashboard test timeout under load; that test passed in isolation and the
  complete suite then passed without changing it.
- Changed/new frontend ESLint passed without warnings, and `git diff --check` passed.
- The complete mocked browser suite passed 48/48 after the final concurrency repair.
- The production build retains its existing large-chunk warning:
  `LetterReviewPage` is 521.70 kB and `UpdateEditorPage` is 1,182.96 kB after
  minification.
- The first independent adversarial review stopped the checkpoint over false
  post-commit failure reporting and unordered full-DTO adoption. Both were repaired;
  the second pass found no remaining P0/P1 or checkpoint-blocking P2 issue.

Residuals:

- Seven stateful or non-Letter direct workflows remain explicit in the route:
  letter transcription, Extra Content transcription, transcript confirmation,
  metadata regeneration, metadata re-extraction, deletion, and reading-view
  generation. They should move with their actual domain state rather than widening the
  executor.
- `afterAdopt` is documented and currently used only synchronously, but TypeScript's
  `void` callback assignability cannot mechanically reject an accidentally async
  callback.
- The source-level architecture tripwire still enumerates several route callback
  names. The behavior tests are authoritative; move or reduce those source assertions
  as the named handlers enter vertical workspaces.
- Flagging still uses a backend endpoint without a source-revision precondition. It is
  visit-ordered and guarded on DTO adoption here, but is not claimed to be a
  source-fenced server mutation.
- The route remains 1,745 lines with 28 callback owners. The executor removes
  duplicated safety machinery; it is a seam for the next vertical extraction, not the
  end of Letter Review simplification.

No product feature, visual layout, backend production behavior, database schema,
deployment, or external state changed in this slice.

## Slice 023 — Single Transcript-Editor DOM Owner

Status: next

Problem:

The transcript contenteditable has three production DOM writers. `LetterReviewPage`
reprojects highlighted HTML from a route effect keyed to transcript and Line Review
mode; `TranscriptionSection` repeats that projection when Reading View closes, but
skips empty text; and `useTranscriptEditing` writes the DOM imperatively after Revert.
The route also owns editor-specific Tab insertion and page-separator deletion rules.
The route effect currently masks the section's empty-text bug: removing or reordering
one writer can leave the previous letter's transcript visible when the next
authoritative transcript is empty.

Target invariant:

React transcript state is the sole content authority and `TranscriptionSection` is the
sole owner that projects it into the contenteditable DOM, including an explicit empty
value. The section also owns its keyboard/structural rules. Route and domain-mutation
hooks never write editor HTML, so Line Review exit, Revert, generation, same-letter
adoption, and A → B navigation all reach the same tested projection boundary.

Planned minimum:

- Characterize nonempty marker projection, nonempty → empty reconciliation, Tab
  insertion, and adjacent page-separator deletion protection in section tests.
- Make the section reconcile every authoritative transcript while its editor surface
  is active, including the empty string.
- Move the existing editor keydown behavior and page-separator helper into the section
  boundary; remove the route callback/prop contract.
- Remove the route transcript DOM effect and highlighter import.
- Remove `editorRef` and the imperative highlighter write from
  `useTranscriptEditing`; successful Revert should update React state only.
- Add an ownership tripwire and a discriminating browser transition or Line Review
  exit case proving stale text is cleared without the route effect.

Non-goals:

- No transcript edit-session, autosave, verification, Revert request ordering, marker
  syntax, Reading View, generation, Line Review state, layout, CSS, or backend change.
- No replacement of the existing `execCommand` Tab behavior in this structural slice.
- No generic contenteditable framework.

Acceptance:

- One production module writes transcript editor HTML.
- Empty authoritative text clears stale DOM on the same render path as nonempty text.
- Existing typing, markers, Tab insertion, separator protection, Revert, Reading View,
  and Line Review behavior remain executable and green.
- Focused component/hook/ownership tests, relevant mocked browser behavior, complete
  frontend/backend suites, production build, touched-file lint, CI-mode mocked browser
  suite, and `git diff --check` pass.

## Slice 022 — Letter Transcription Workspace

Status: complete at `2f9e17bc`

Problem:

Letter transcription still has three route-owned state cells, visit-reset writes, a
manual request boundary, and an inline cross-domain chooser. Its handler repeats
saving-lease, autosave-flush, request, guarded adoption, hydration, error, and release
logic instead of adapting its response envelope to the shared mutation executor. The
replacement warning reads persisted `letter.transcript.fullText`, while the visible
editor and user intent read the live `transcript` draft. A locally typed draft can
therefore be flushed and immediately overwritten without a warning; a locally cleared
draft can prompt even though the visible editor is empty. An older completion-reset
timer can also clear the progress of a newer run in the same visit.

Delivered invariant:

One visit-owned Letter transcription workspace owns request-envelope adaptation,
progress/message state, accepted-result truth, success copy, and replacement intent
based on the visible transcript. It reuses the ordered direct-mutation executor and
fails closed across A → B → A. A thin presentational chooser renders the existing
options, while `LetterReviewPage` retains only the intentional cross-domain
composition: Letter first, then Extra Content only after an accepted Letter result
from the same active visit.

What changed:

- `useLetterTranscriptionWorkspace` is a 241-line visit-owned boundary constructed
  after the direct-mutation executor. It owns visible-draft replacement intent,
  progress/message state, response-envelope adaptation, accepted-result truth, and
  transcription success copy.
- The route no longer imports `transcribeLetter` or manually owns its
  saving/flush/request/adopt/hydrate/error/release sequence. The workspace adapts the
  `{ letter, transcribed }` envelope to the shared Letter-returning executor and
  reports `true` only from the guarded `afterAdopt` boundary.
- Replacement intent now reads the live `transcript` draft. A local nonempty draft
  prompts even while the Letter DTO is empty, while a visibly cleared draft proceeds
  without prompting solely because the DTO still contains old text.
- Progress belongs to the opaque route visit and exact attempt. Mismatched visits
  render idle/closed synchronously, captured old controls fail closed, and rejected
  adoption or request failure clears only the attempt that actually started.
- The existing shared visit-aware status-reset scheduler regained its `transcription`
  lane. The workspace contributes only the domain predicate—current owner, `done`
  phase, and exact attempt—so an older three-second reset cannot erase a newer run
  without duplicating timer storage or visit cleanup.
- `TranscriptionRegenerationDialog` is an 81-line presentation-only rendering
  boundary. It renders only the options supplied by the route, provides an accessible
  dialog name, and owns no API, visit, sequencing, or domain state.
- `LetterReviewPage` keeps the intentional cross-domain composition and closes each
  chooser selection once: Letter alone, Extras alone, or Letter followed by Extras
  only after accepted Letter adoption and a still-active visit.
- `LetterReviewPage.tsx` fell from 1,553 to 1,440 lines. Direct route state cells fell
  from 22 to 19 and callback owners from 21 to 20; effect and ref counts did not
  change. Across the five affected/new production files, physical source rose from
  1,933 to 2,148 lines because the explicit visit/attempt owner and presentation
  boundary replace implicit route coupling rather than optimizing only for raw LOC.
- The mocked browser regression deliberately lets the visible editor diverge from
  the authoritative DTO: it waits for a forced-failure autosave before clicking
  Regenerate. The old persisted-DTO gate therefore cannot false-pass under a slow or
  contended run.

Evidence:

- Focused workspace, dialog, section, reset-owner, and architecture coverage passed
  5 files / 22 tests. The five workspace tests cover both live-versus-persisted intent
  directions, exact envelope/request behavior, accepted and rejected adoption,
  A → B → fresh A plus captured controls, and the older-reset/newer-attempt race.
- The full Letter Review mocked browser spec passed 28/28. It proves the local-draft
  chooser, exact source-revision request, coded source-conflict ownership,
  Letter-before-Extras ordering, Letter failure short-circuiting, and stale-visit
  short-circuiting.
- Complete frontend suite passed 125 files / 839 tests. Frontend TypeScript and the
  production build passed.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- Definitive `CI=1 ./scripts/verify-all.sh` passed those suites, the production build,
  and the complete mocked browser suite 54/54.
- Touched frontend ESLint and `git diff --check` passed. Whole-frontend lint remains
  the known backlog at 161 problems (141 errors and 20 warnings).
- Three independent lifecycle, coverage, and architecture/simplicity reviews found no
  remaining P0–P2 issue after a potentially false-passing browser proof, duplicated
  timer infrastructure, ineffective dialog memoization, and duplicate close ownership
  were challenged and repaired.
- Existing production-build warnings remain: `LetterReviewPage` is 525.12 kB and
  `UpdateEditorPage` is 1,182.96 kB after minification.

Residuals:

- The transcript contenteditable still has three DOM writers plus route-owned
  keyboard rules. Slice 023 consolidates that smaller, already-characterized boundary
  before beginning another stateful workspace.
- Metadata/entity regeneration is the next coherent Letter Review boundary, but its
  current labels and backend behavior do not yet describe distinct operations.
  Characterize that contract before moving state or changing user-visible copy.
- Dashboard committed query state remains repeated through filter controls,
  persistence, saved views, list fetching, filtered selection, chips, and sort. A
  canonical contract/reducer slice is ready after the narrower editor-owner repair;
  do not migrate all consumers in one uncharacterized rewrite.
- `LetterReviewPage` remains 1,440 lines with 20 direct callback owners. Transcript
  confirmation, analysis regeneration/re-extraction, deletion, and Line Review
  composition remain explicit until their own invariants are characterized.
- Letter/Extras/Both stays route composition deliberately; merging it into either
  workspace or inventing a generic action/dialog framework would blur domain
  ownership.
- The whole-frontend lint backlog remains explicit; every file touched by this slice
  passes lint.

No new product feature, visual-layout change, Extra Content behavior, transcript
editing/verification behavior, Reading View behavior, backend production behavior,
API, prompt, database schema, deployment, or external state changed in this slice.

## Slice 021 — Reading View Workspace

Status: complete at `e1ede201`

Problem:

Reading View currently has two mode owners: `TranscriptionSection` stores the mode that
actually opens the overlay, while `LetterReviewPage` separately stores
`transcriptViewMode` to resize the split pane. They can disagree after route changes.
The route also keeps a shadow `readerText` draft. Moving from A with reading text to B
without it can leave A's text visible because the synchronization effects only adopt a
truthy replacement. `onReaderTextChange` is passed into the section but never read, so
its reading-text autosave path is dead. Generation manually repeats the direct-mutation
boundary already owned by the executor.

Delivered invariant:

One visit-owned Reading View workspace controls preview mode, open/close behavior,
generation progress, and the section contract. Displayed text is derived from the
guarded authoritative Letter, so a letter without `readingText` is empty immediately.
Generation reuses the ordered mutation executor, and neither late work nor captured
controls from an older visit—or from the same visit while Line Review owns the
surface—can repaint, reopen, or generate against an unavailable surface. The exact
same normalized open value drives the portal and forced split ratio.

What changed:

- `useReadingViewWorkspace` is a 146-line domain boundary constructed after the
  direct-mutation executor. One opaque route visit owns its open and progress state;
  mismatched visits render closed/idle synchronously.
- `TranscriptionSection` is controlled. Its toggle, portal, Escape/backdrop/Close
  actions, body-overflow cleanup, and the route's `forceSplit` all consume the same
  workspace value.
- Displayed text is now `letter.readingText ?? ''`. The route shadow draft, two
  truthy-only synchronization paths, hydrator write, unused edit prop/callback, and
  dead reading-text autosave field were removed.
- Generation uses `executeLetterMutation`, so target-wide autosaves flush first and
  guarded Letter adoption remains the only success boundary. Progress begins when the
  queued request actually starts.
- A latest committed availability guard rejects controls captured before Line Review
  or another eligibility loss. Owner-aware functional updates prevent late work from
  mutating B or a fresh A visit.
- `LetterReviewPage.tsx` fell from 1,615 to 1,553 lines. Route state calls fell from
  15 to 14, effects from 7 to 6, and callback owners from 24 to 21. Across the four
  affected/new production files, physical source rose by 76 lines because the
  explicit visit owner and guards replaced implicit coupling rather than merely
  moving route code.
- The mocked Letter Review API now models revision-bound reading generation. Its
  browser case leaves A's portal open during an SPA transition to B and proves the
  portal, body lock, divider lock, split ratio, and authoritative empty text all reset
  together.

Evidence:

- Focused workspace, controlled-section, and ownership coverage passed 3 files /
  16 tests. It covers same-visit authoritative updates, A → B → fresh A, missing
  reading text, exact request/progress/adoption, failure cleanup, late completion,
  captured controls, Line Review inactivity, and portal cleanup.
- The discriminating mocked browser case measured a 60% → 40% → 60% split, divider
  locking, body-scroll locking, exact revision payload, generated text adoption, and
  the open-A → B reset. The complete mocked browser suite passed 53/53.
- Complete frontend suite passed 123 files / 832 tests. Frontend TypeScript and the
  production build passed.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- Touched frontend ESLint and `git diff --check` passed. Whole-frontend lint remains
  the known backlog at 161 problems (141 errors and 20 warnings).
- Three independent lifecycle, adversarial, and architecture/simplicity reviews found
  no remaining P0–P2 issue after captured Line Review controls, callback stability,
  impossible revision fixtures, and a non-discriminating first browser draft were
  challenged and repaired.
- Existing production-build warnings remain: `LetterReviewPage` is 523.46 kB and
  `UpdateEditorPage` is 1,182.96 kB after minification.

Residuals:

- Letter transcription still owns a manual mutation boundary and uses persisted,
  rather than visible, transcript content for replacement intent. Slice 022 owns that
  narrow correction.
- Metadata/entity regeneration is the next coherent workspace after transcription,
  but its current “Metadata Only” and “Both” labels do not describe distinct backend
  work: both paths run entity analysis. Characterize that contract and deterministic
  dialog/API behavior before extracting it.
- The dashboard's serializable query state remains repeated through filter state,
  persistence, saved views, API adapters, chips, and selection. Begin that later with
  a pure canonical query-state characterization, not a sweeping reducer migration.
- The whole-frontend lint backlog remains explicit; touched files are clean.

No product feature, visual layout, backend production behavior, database schema,
deployment, or external state changed in this slice.

## Slice 020 — Transcript Editing Visit Isolation

Status: complete at `7fe9d46e`

Problem:

`useTranscriptEditing` owned the verified-edit session, original transcript baseline,
dirty state, and tooltip without keying them to the opaque route visit. After
unverify/edit on A, navigating to verified B could leave B editable and keep A's
header Revert intent alive, creating a path that submitted A's text against B. A late
first-A response could also target a fresh A visit if local effects escaped the guarded
Letter adoption boundary.

Delivered invariant:

Every transcript edit session belongs to exactly one `LetterReviewVisit`. A mismatched
owner renders a fresh locked session synchronously; a layout effect then commits that
owner and closes raw tooltip state. Session updates and interaction entry points reject
captured older visits. In-flight responses still pass through the visit-bound guarded
Letter adoption boundary before changing the route transcript, session, or toast.
Same-visit DTO rerenders preserve the active edit session, while A → B → A creates a
fresh owner.

What changed:

- Four independent edit-session state fields became one small owner-keyed session.
  `LetterReviewVisit` itself is the owner; no second ID, symbol, registry, reducer, or
  generic session framework was introduced.
- The visible edit flag, dirty flag, and Revert baseline fail closed during the first
  new-visit render. Owner-aware functional updates prevent late callbacks from writing
  into the new session.
- Tooltip visibility is owner-gated before paint, reset on visit commit, and protected
  against captured old click/double-click handlers. Transcript input, verify, unverify,
  and Revert entry points also reject an inactive captured visit.
- The baseline remains private to the hook. The now-dead public
  `originalTranscriptText` output and the unused `hasTranscriptChanges` and
  `originalTranscriptText` section props were removed.
- The `originalTranscriptVerified` flag and its false branch were removed. A Revert
  baseline can only be created by double-clicking a verified transcript, so successful
  Revert always restores verification just as the reachable path did before.
- `LetterReviewPage.tsx` fell from 1,618 to 1,615 lines. The header retains only the
  two values it actually needs to compose the Revert action.

Evidence:

- Focused visit/session/component coverage passed 5 files / 22 tests. The four new
  behavior cases prove same-visit preservation, verified B locking, an inert B Revert,
  late first-A response rejection during fresh A, no stale transcript/toast effect,
  tooltip reset, and captured-tooltip-handler isolation.
- Complete frontend suite passed 122 files / 826 tests. Frontend TypeScript,
  changed-file ESLint, and the production build passed.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- The CI-mode mocked browser suite passed 52/52. Two resource-contended local
  four-worker runs timed out only on the existing five-second load-error readiness
  assertion at 51/52; that case passed alone and the full one-worker CI configuration
  passed without a code change.
- `git diff --check` passed. Three independent lifecycle, coverage, and
  architecture/simplicity reviews found no remaining P0–P2 blocker after stale
  external effects, tooltip ownership, and unnecessary identity/state layers were
  challenged and repaired.
- The production build retains its existing large-chunk warning:
  `LetterReviewPage` is 523.00 kB and `UpdateEditorPage` is 1,182.96 kB after
  minification.

Residuals:

- Reading View still has duplicate mode owners, a route-level shadow text copy, a dead
  edit/autosave prop, and manual generation orchestration. Slice 021 owns that narrow
  correction.
- `useTranscriptEditing` remains 324 lines because it cohesively owns transcript
  typing/autosave, verification, unverify-to-edit, Revert, and the verified tooltip.
  Do not split it by length or merge it with generation/Reading View without a clearer
  responsibility boundary.
- Whole-frontend lint remains an explicit repository backlog. Every file touched by
  this slice passes lint; unrelated findings were not mixed into the correctness
  repair.

No product feature, visual layout, backend production behavior, database schema,
deployment, or external state changed in this slice.

## Slice 019 — Extra Content Vertical Workspace

Status: complete at `bf3be7dd`

Problem:

The route still owned every part of the Extra Content workflow in disconnected regions:
draft and progress state, route reset, initial and direct-response hydration,
replacement confirmation, transcription, verification, autosave, line-review gating,
section props, and regeneration-popup callbacks. A returned autosave DTO could repaint
an older draft over newer typing. Replacement confirmation read the persisted Letter
DTO rather than the visible draft. The popup's “Both” action always started Extras
after the Letter promise settled, even when Letter transcription failed, its flush was
blocked, its response was rejected, or its route visit became stale.

Delivered invariant:

One workspace owns Extra Content state and behavior for exactly one opaque Letter
Review visit/source target. Its draft is reconciled from authoritative DTOs without
overwriting newer local intent. Autosave remains in the target-wide Extra Content lane;
transcription and verify/unverify reuse the ordered direct-mutation executor. Progress,
hydration, edit-session gating, and success reporting are visit-fenced. Cross-domain
“Both” remains route composition, runs Letter before Extras, and stops unless the first
half was accepted and the originating visit is still active.

What changed:

- `useExtraContentWorkspace` now owns the visible draft, persisted baseline,
  transcription progress, line-review edit-session gate, autosave request/payload,
  response-envelope adaptation, verify/unverify selection, success copy, and thin
  `ExtraContentSection` props.
- Workspace ownership is keyed by the opaque route visit plus letter/source identity.
  A fresh A visit resets immediately after A → B → A, and late first-A transcription
  or autosave completion cannot hydrate, clear progress, or publish a toast.
- Same-owner reconciliation advances the persisted baseline while preserving a newer
  dirty draft. Autosave response hydration only replaces the exact draft that produced
  that response.
- The route's global Letter hydrator no longer writes Extra Content. This keeps hook
  construction acyclic: shared autosave and existing domain hooks, global non-Extra
  hydration, direct-mutation executor, then the Extra Content workspace.
- Confirmation now reads the visible owned draft. Tests cover both directions:
  nonempty local content prompts even when the DTO is empty, and a locally cleared
  draft does not prompt merely because the DTO is stale and nonempty.
- Letter transcription now reports an accepted boolean to the popup orchestrator.
  “Both” stops after failure, blocked flush, rejected adoption, or navigation and never
  issues the Extras request or stale success report in those cases.
- `LetterReviewPage.tsx` fell from 1,745 to 1,618 lines and from 28 to 24 direct
  `useCallback` owners. It no longer imports Extra Content APIs, stores Extra Content
  state, hydrates that state, or defines Extra Content handlers.
- The deterministic browser API now models `/transcribe-extras`, its revision-bound
  payload, response envelope, failures, and request capture. Browser coverage proves
  sequential same-revision “Both,” failure and stale-visit short-circuiting, and the
  real viewer-click line-review gate after accepted unverify.

Evidence:

- Focused workspace and ownership coverage passed 3 files / 17 tests. The workspace's
  8 behavior tests cover both confirmation directions, queued progress, accepted and
  rejected adoption, exact autosave lane/payload, newer-draft preservation,
  verification transitions, late autosave, and late transcription across A → B → A.
- Complete frontend suite passed 121 files / 822 tests. Frontend TypeScript, changed
  frontend ESLint, and the production build passed.
- Complete backend suite passed 104 files / 1,016 tests; backend typecheck passed.
- The complete mocked browser suite passed 52/52; the Letter Review spec passed 26/26.
- `git diff --check` passed. Three independent lifecycle, architecture/simplicity, and
  coverage reviews found no remaining checkpoint blocker after the four explicit gap
  cases were added.
- The production build retains its existing large-chunk warning:
  `LetterReviewPage` is 522.67 kB and `UpdateEditorPage` is 1,182.96 kB after
  minification.

Residuals:

- Extra Content autosave preserves the visible draft after failure, and the shared
  lane blocks direct work until resolved, but this producer does not yet retain and
  reschedule failed intent automatically. A subsequent edit retries it. Repair this
  only through a coherent producer retry contract, not a workspace-local scheduler.
- `lineReviewBlocked` intentionally preserves the historical “successfully unverified
  in this visit” behavior. The warning banner's Map/Review controls still bypass the
  viewer-click gate, so line-review entry does not yet have one comprehensive owner.
- The verified status control remains a clickable `div` without keyboard semantics.
  That DOM/accessibility correction was outside this no-visual-change slice.
- The cross-domain regeneration popup and Letter transcription remain in the route.
  The source-level architecture tests still enumerate some callback/property names;
  behavior tests are authoritative and those assertions should shrink as owners move.
- The 288-line workspace is cohesive around one domain state machine. Do not split it
  by length alone or introduce a generic workspace/action framework.

No product feature, visual layout, backend production behavior, database schema,
deployment, or external state changed in this slice.
