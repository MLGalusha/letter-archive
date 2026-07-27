# Production Deployment

## Release authority

GitHub Actions is the only automatic production release authority. Required CI
must pass on protected `main` before the `Production Release` job authenticates
to Google Cloud with short-lived Workload Identity Federation credentials.
GitHub stores no Google service-account key.

The release job submits the exact remote commit to a regional Cloud Build and
passes the same full SHA as `_TAG`. The build verifies that Cloud Build's
resolved source provenance equals that SHA before it builds or pushes an image.
After acquiring the GCP-side release lock, the build also verifies that the SHA
is still the current remote `main`. A newer deployment is never allowed to be
rolled back by an older queued build.

The repository variable `AUTOMATIC_RELEASES_ENABLED` is the production kill
switch:

- `false` — CI still runs, but merges do not start a release.
- `true` — successful pushes to protected `main` start a release.

The variable must remain `false` until the one-time maintenance baseline through
migration `0056_repair_extra_content_job_ownership` is complete.

## Release selection

`deploy/cloudrun/select-release-scope.sh` compares the exact release SHA exposed by
each live service with the new `main` commit, then selects one serialized release:

- `frontend` for frontend-only changes;
- `full` for backend, deploy, release-workflow, or full-release-config changes;
- `none` for changes that do not affect a production artifact.

If either service does not expose a valid reachable commit, selection fails safe to a
full release. This also means a later merge cannot skip backend work left behind by a
failed earlier release merely because the later commit changed only the frontend.

Frontend-only releases use `cloudbuild.frontend-release.yaml`. They never replace
a backend job, connect to the database, or run a migration.

Full releases use `cloudbuild.release.yaml`. They build both immutable images,
run the migration gate and migration job, update the worker and backfill jobs,
then release backend followed by frontend.

All production builds also acquire
`gs://letter-archive-485110-release-lock/production.lock`. Object-generation
preconditions make lock creation, stale-owner cleanup, and release atomic. A
later build may reap the lock only after Cloud Build reports its owner in a
terminal state; an active or unverifiable owner fails closed. The build identity
therefore needs object create, read, and delete access on this bucket only.

## Candidate promotion and rollback

Images are tagged with the full Git SHA for traceability, resolved to an Artifact
Registry digest, and deployed by digest. `latest` exists only as a Docker layer
cache and is never a deployment reference.

Each service release:

1. records the one revision receiving 100% of current traffic;
2. deploys a uniquely tagged candidate revision with zero traffic;
3. verifies the candidate URL and exact release SHA;
4. verifies backend database readiness and public auth status, or the frontend
   admin shell;
5. promotes the candidate to 100%;
6. repeats the probes through the production domain;
7. removes the temporary tag and pins traffic to the exact revision.

A failed candidate receives no production traffic. A failed post-promotion smoke
test restores the previously serving revision. Automatic rollback is valid only
because the migration gate permits rolling-compatible migrations.

Before backend promotion, the full release snapshots the worker and backfill job
definitions, worker invocation IAM, and Scheduler state. A failure restores and
verifies those snapshots. Once the backend candidate has committed successfully,
the pipeline does not roll jobs back to an incompatible older version; a later
Scheduler failure is reported as a distinct critical recovery condition.

## Migration release policy

`backend/src/db/migration-release-policy.ts` defines the production baseline and
classifies every later migration:

- `automatic` — expand-only and safe while the previous application revision
  remains available for rollback;
- `maintenance` — requires a controlled write-quiesced deployment.

CI fails when a post-baseline migration is unclassified. The migration executable
also verifies that the live Drizzle ledger is the exact ordered prefix of the
repository journal, including every migration timestamp and SHA-256 SQL hash.
An automatic release fails before running SQL when the ledger diverges,
production is behind the baseline, or any pending migration is unclassified or
maintenance-only.

## Identities

Runtime identities are separate:

- `letter-archive-frontend` — no database, secret, bucket, or worker access;
- `letter-archive-backend` — API-specific database, secret, bucket, and worker
  invocation access;
- `letter-archive-worker` — worker-specific database, OpenAI secret, and bucket
  access;
- `letter-archive-migrate` — database migration access only;
- `letter-archive-backfill` — database and read-only archive access;
- `letter-archive-build` — Artifact Registry writer and Cloud Run deployer that
  may act as only the Letter Archive runtime identities;
- `letter-archive-github` — may submit Cloud Builds and act as the dedicated
  build identity.

Database credentials are split on the same boundary:

- `database-url-api` and `database-url-worker` use separate DML-only roles;
- `database-url-migrate` owns migration-managed objects and may create schema
  objects; and
- `database-url-backfill` may only read and update `letter_pages`.

The shared legacy `database-url` secret is not granted to these runtime
identities.

The GitHub Workload Identity provider admits only the numeric Letter Archive
repository and owner IDs, `refs/heads/main`, and this repository's
`.github/workflows/ci.yml` workflow reference.

## One-time maintenance baseline

`cloudbuild.deploy.yaml` is the one-time maintenance pipeline. It requires an
explicit maintenance authorization, but it also establishes and verifies the
maintenance state itself:

1. build and push the exact reviewed release first;
2. execute the migration image in preflight-only mode to verify the exact
   ledger, database connection, and schema-creation privilege without applying
   a migration;
3. remove the public backend invoker binding;
4. route backend traffic to a static maintenance revision with no database,
   secret, archive, or worker access;
5. pause scheduled reconciliation when present;
6. revoke both API-to-worker and worker self-handoff invocation;
7. remove the legacy worker pool and wait longer than the old API request
   timeout;
8. require two consecutive observations with no active worker execution;
9. run migrations in `maintenance` mode;
10. deploy the new jobs and backend identities;
11. privately verify backend release identity, DB readiness, and auth status;
12. reopen the public backend and promote the frontend candidate.

Preflight failure leaves the existing public release untouched. If the pipeline
fails after maintenance begins, the backend remains closed instead of reopening
an unverified or mixed-version release.

The deployed migration job defaults to `--preflight`. Release orchestration must
explicitly override its arguments to apply migrations after the relevant
quiescence or rolling-safety gate, so an ad hoc job execution cannot apply
maintenance migrations early.

## External controls

- The legacy `deploy-full` and `deploy-frontend` Cloud Build triggers are
  build-only until the baseline release is proven, then retired.
- `main` requires the GitHub quality, mocked E2E, and real-server smoke checks.
- Production releases use GitHub concurrency
  `letter-archive-production` with cancellation disabled, so releases queue
  rather than race. The GCS generation-checked lock preserves serialization if
  a GitHub runner disappears after submitting Cloud Build.
- The one-time bootstrap may temporarily require project-level Cloud Run
  administration to create missing Letter Archive jobs. Immediately after that
  bootstrap, grant the build identity administration only on the exact Letter
  Archive services/jobs and remove its project-level Cloud Run administrator
  role.
- SpecFinder has separate services and identities and is not a release target or
  permission member in this workflow.
