# Architecture Cleanup Current Work

Last updated: July 17, 2026

## Resume Here

- Working branch: `architecture-cleanup`
- Recovery point: `admin-main-redesign` at `bb0bfb29`
- Program guide: [README.md](README.md)
- Current checkpoint: 001 — complete; commit this checkpoint before new edits
- Next queued slice: 002 — characterize processing ownership and recovery safety

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

- Three processing execution paths remain active: autonomous worker, legacy queue,
  and API-process registry runner.
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

- [ ] Characterize every API- and worker-owned execution/recovery path in tests.
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

Status: queued; start only after the Slice 001 checkpoint is committed cleanly

Problem:

API startup and worker startup both call `recoverOrphanedJobs()`, which resets
`RUNNING` transcription, metadata, and entity-extraction jobs to `PENDING`. An API
restart can therefore make a live worker's job claimable a second time. However, the
API process still executes work through the process registry and a legacy queue
fallback. Removing API recovery first would trade duplicate execution for a different
failure: API-owned work could remain `RUNNING` indefinitely after an API crash while
the worker stays alive.

Invariant to establish:

Every transition to `RUNNING` has an explicit owner and a tested, time-bounded recovery
path. Recovery ownership must not move until that invariant can remain true.

Planned minimum:

- Trace and document all code paths that claim, execute, and recover each job stage.
- Add focused characterization tests for the API process-registry runner, legacy queue
  fallback, worker claim path, and startup recovery behavior.
- Use the evidence to frame the smallest safe behavior-changing slice: either leases
  and periodic expiry-aware reconciliation first, or removal of API execution while
  retaining recovery until worker-only ownership is complete.
- Run the focused tests, backend typecheck, and full backend suite.

Non-goal:

Do not remove API recovery in this characterization slice. Two workers can still reset
each other's work, and extra-content jobs still lack recovery; both risks remain
explicit until ownership and lease semantics are implemented coherently.

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
