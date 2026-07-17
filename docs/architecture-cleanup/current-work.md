# Architecture Cleanup Current Work

Last updated: July 17, 2026

## Resume Here

- Working branch: `architecture-cleanup`
- Recovery point: `admin-main-redesign` at `bb0bfb29`
- Program guide: [README.md](README.md)
- Current checkpoint: 004 — complete, pending checkpoint commit
- Last green checkpoint: Slice 003 at `fc99e2d8`
- Current slice: canonicalize and claim direct transcription
- Next queued slice: 005 — add leases, heartbeats, and expiry-aware recovery

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

- Three batch execution paths remain active—autonomous worker, legacy queue, and
  API-process registry runner—plus direct request-owned AI actions.
- API and worker startup both recover `RUNNING` transcription, metadata, and entity
  extraction rows, allowing an API restart to reset work owned by a live worker.
  Extra-content jobs have a separate status and are not recovered by this function.
- Letter lifecycle state is mutated directly in about 80 production call sites across
  18 files.
- Dashboard query/filter state is repeated across state, persistence, saved views,
  chips, API serialization, selection, and UI prop contracts.
- `AdminDashboard.css` is 4,448 lines with overlapping global ownership.
- The largest mixed-responsibility frontend route is `LetterReviewPage.tsx` at about
  1,871 lines; the largest public backend route is `routes/letters.ts` at about 2,230
  lines, though its search section is comparatively cohesive.
- Redesign and refactoring docs contain stale active-phase claims.

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
- [ ] Add persisted owner/lease/heartbeat semantics and expiry-aware reconciliation.
- [ ] Make recovery worker-owned so API startup cannot reset active work.
- [ ] Establish one eligibility definition per processing stage.
- [ ] Make the worker the sole executor; APIs enqueue, cancel, retry, and report.
- [ ] Remove legacy queue/registry execution duplication and the processing import cycle.
- [ ] Separate metadata completion from entity-persistence completion.

### C. Domain state ownership

- [ ] Centralize explicit letter stage, content-review, and publication transitions.
- [ ] Introduce a correspondence-group seam for keying, representative selection,
  visibility, deletion, and companion lookup.
- [ ] Add compensation or recoverability around database/filesystem ingestion changes.
- [ ] Extract explicit public summary/detail and admin detail read models.

### D. Frontend change isolation

- [ ] Replace field-by-field dashboard filter plumbing with one serializable query
  state, reducer/actions, and pure adapters.
- [ ] Model explicit versus all-filtered selection and make counts truthful.
- [ ] Delete verified dead dashboard CSS and establish one style owner per surface.
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
