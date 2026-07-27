# Cloud Run Deployment Templates

These templates assume:

- frontend and backend are deployed separately
- the backend runs on Cloud Run
- the processing worker runs as a Cloud Run job
- when enabled, Cloud Scheduler invokes the worker job every five minutes for eventual
  reconciliation
- database migrations run as a Cloud Run job
- letter images are stored on a mounted Cloud Storage bucket at `/mnt/archive`

## Templates

- `backend-service.yaml` — public API service
- `backend-worker-job.yaml` — background processing worker
- `backend-migrate-job.yaml` — one-off migration job
- `frontend-service.yaml` — frontend nginx container

## Manifest rendering

`render-manifests.sh` replaces the templates' collision-resistant `__NAME__`
placeholders, validates every value, and atomically writes a separate rendered
directory. It fails without modifying the templates if a value is missing or invalid
or any placeholder remains. `cloudbuild.deploy.yaml` supplies the required values as
step environment data during the controlled deployment. Keep environment variable
names such as `CLOUD_RUN_REGION` outside the placeholder tokens.

Required render values:

- `LETTER_ARCHIVE_PROJECT_ID`
- `LETTER_ARCHIVE_REGION`
- `LETTER_ARCHIVE_BACKEND_IMAGE` / `LETTER_ARCHIVE_FRONTEND_IMAGE`
- `LETTER_ARCHIVE_BACKEND_SERVICE_ACCOUNT`
- `LETTER_ARCHIVE_FRONTEND_SERVICE_ACCOUNT`
- `LETTER_ARCHIVE_WORKER_SERVICE_ACCOUNT`
- `LETTER_ARCHIVE_MIGRATE_SERVICE_ACCOUNT`
- `LETTER_ARCHIVE_BACKFILL_SERVICE_ACCOUNT`
- `LETTER_ARCHIVE_MIGRATION_RELEASE_MODE`
- `LETTER_ARCHIVE_RELEASE_SHA`
- `LETTER_ARCHIVE_CLOUD_SQL_INSTANCE`
- `LETTER_ARCHIVE_ARCHIVE_BUCKET`
- `LETTER_ARCHIVE_DOMAIN`

## Release lock prerequisite

Before any controlled or automatic production build, create the regional,
uniform-access bucket `gs://letter-archive-485110-release-lock` in `US-EAST1`
with public access prevention enforced. Grant
`letter-archive-build@letter-archive-485110.iam.gserviceaccount.com` object
create, read, and delete access on this bucket only (for example,
bucket-scoped `roles/storage.objectAdmin`).

The three production build configurations fail closed without this bucket.
Their scripts use object-generation preconditions so only one build owns the
lock and only the observed generation can be reaped or released. Do not replace
those operations with unconditional object writes or deletes.

## Secrets

Store sensitive values in Secret Manager and reference them in YAML:

```bash
gcloud secrets create jwt-secret --replication-policy="automatic"
echo -n "your-random-secret" | gcloud secrets versions add jwt-secret --data-file=-

gcloud secrets create database-url-api --replication-policy="automatic"
gcloud secrets create database-url-worker --replication-policy="automatic"
gcloud secrets create database-url-migrate --replication-policy="automatic"
gcloud secrets create database-url-backfill --replication-policy="automatic"

gcloud secrets create openai-api-key --replication-policy="automatic"
echo -n "sk-..." | gcloud secrets versions add openai-api-key --data-file=-
```

Add each database URL as a secret version without writing it to shell history.
The API and worker database roles are DML-only, the migration role owns
migration-managed objects, and the backfill role is limited to reading and
updating `letter_pages`. Grant each runtime service account access only to its
matching secret. The shared legacy `database-url` secret is not used by these
templates.

The release architecture, identity boundaries, migration policy, and rollback
behavior are documented in [`docs/deployment.md`](../../docs/deployment.md).

## Push-time build validation

The two checked-in configurations that may be selected by main-watching triggers are
build-only: `cloudbuild.yaml` validates both production Docker contexts and
`cloudbuild-frontend.yaml` validates the frontend context. Neither pushes image tags,
runs migrations, or replaces Cloud Run services/jobs.

Cloud Build trigger configuration is external to this repository. Before pushing a
release to `main`, enumerate every main-watching trigger and verify that each is
file-backed to one of those two validation configs, with no inline or alternate
deployment config. This separation is intentional: migrations 0054/0055 and the
atomic first-page writer cannot be introduced safely while an older API or worker can
still write.

## Controlled baseline deployment

Use `cloudbuild.deploy.yaml` only for the one-time maintenance baseline. The
operator authorizes a maintenance window; the pipeline then establishes and
verifies write quiescence itself:

1. Fetch `origin/main`, confirm the reviewed commit is the clean local and remote
   `main`, then submit the remote repository pinned to that full commit SHA. This
   prevents a dirty local directory from being uploaded and merely labelled as the
   reviewed commit:

   ```bash
   git fetch origin main
   test -z "$(git status --porcelain --untracked-files=all)"
   DEPLOY_SHA="$(git rev-parse --verify HEAD)"
   test "$(git rev-parse --verify main)" = "$DEPLOY_SHA"
   test "$(git rev-parse --verify origin/main)" = "$DEPLOY_SHA"
   DEPLOY_SOURCE="$(git remote get-url origin)"
   gcloud builds submit "$DEPLOY_SOURCE" \
     --project=letter-archive-485110 \
     --region=us-east1 \
     --git-source-revision="$DEPLOY_SHA" \
     --service-account=projects/letter-archive-485110/serviceAccounts/letter-archive-build@letter-archive-485110.iam.gserviceaccount.com \
     --config=cloudbuild.deploy.yaml \
     --substitutions=_TAG="$DEPLOY_SHA",_CONFIRM_WRITE_QUIESCENCE=true
   ```

2. The build removes public backend invocation, routes traffic to a non-writing
   maintenance revision, pauses reconciliation if present, verifies no active worker,
   and waits beyond the old request timeout before migration.
3. Route 100% of API traffic to the new revision, confirm old revisions are gone,
   perform the migration 0054/upload/manual-worker-wake smoke checks recorded in
   `docs/architecture-cleanup/current-work.md`, and only then reopen administrative
   writes. Keep `letter-archive-worker-reconcile` paused or absent and keep
   `_ENABLE_WORKER_RECONCILIATION_SCHEDULE=false`; Scheduler enablement is the
   separate, later proof sequence below.

The deployment graph rejects an omitted confirmation and any `_TAG` that is not a
full lowercase Git SHA. The confirmation authorizes downtime; the build still has to
establish and verify the drain before its migration step can start.

The checked-in build keeps scheduled reconciliation disabled by default. This is a
rollout gate: replacing a Cloud Run Job does not stop an older execution that began
without the database lease. After the lease-aware worker is deployed, all pre-lease
executions are drained or terminated, and competing manual wakes prove that exactly
one execution owns the lease, set
`_ENABLE_WORKER_RECONCILIATION_SCHEDULE=true` on a later build to grant the Scheduler
identity and create or update `letter-archive-worker-reconcile`. Then perform the
post-enable scheduled-tick proof below before relying on Scheduler for reconciliation.

The flag is a create/update gate, not a runtime kill switch. Setting it back to
`false` skips Scheduler IAM and configuration steps but does not pause or delete an
already-existing job. Pause an existing schedule explicitly during rollback:

```bash
gcloud scheduler jobs pause letter-archive-worker-reconcile \
  --project=PROJECT_ID \
  --location=REGION
```

Before the first Scheduler-enabled deployment:

- enable `cloudscheduler.googleapis.com`;
- create `letter-archive-scheduler@PROJECT_ID.iam.gserviceaccount.com` in the
  deployment project;
- let the Cloud Build identity create, read, and update Scheduler jobs (for example,
  `roles/cloudscheduler.admin`) and grant it `iam.serviceAccounts.actAs` on that
  dedicated account (for example, service-account-scoped
  `roles/iam.serviceAccountUser`);
- retain `roles/cloudscheduler.serviceAgent` on
  `service-PROJECT_NUMBER@gcp-sa-cloudscheduler.iam.gserviceaccount.com`; and
- do not use that Google-managed service agent as the Scheduler job's client identity.

The deployment grants the dedicated client identity job-scoped `roles/run.invoker`.
It also retains the backend runner's existing binding because durable enqueue paths
use that identity for low-latency worker wakeups.

## Scheduled reconciliation semantics

Cloud Scheduler sends an OAuth-authenticated `POST` to:

```text
https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/letter-archive-worker:run
```

OAuth is required because `run.googleapis.com` is a Google API; OIDC is not the
correct token type for this target. The UTC `*/5 * * * *` schedule is the eventual
fallback for a lost enqueue-time wake or an exhausted worker attempt. Scheduler
request retries are disabled deliberately: the next five-minute tick is the retry,
while the Cloud Run job retains its separate three-retry task budget.

Cloud Scheduler is an at-least-once system. The `jobs.run` call returns an asynchronous
operation once Cloud Run accepts creation of an execution, so a successful Scheduler
attempt does not mean the worker execution succeeded. `taskCount: 1` and
`parallelism: 1` constrain tasks within one execution; they do not prevent a manual
wake, enqueue-time wake, later schedule, or duplicate delivery from creating
overlapping executions. The worker's database-clock execution lease and token-fenced
claims remain the authority for which execution may begin automatic stage work or
mutate worker/recovery state. Each stage's applicable run/lease or run/revision fences
remain the authority for terminal content publication.

Monitor the two layers separately:

- Cloud Scheduler attempt logs prove whether the `jobs.run` request was accepted.
- Cloud Run execution/task status and worker logs prove whether the worker acquired
  its lease, reconciled/drained work, and exited successfully.
- The durable processing queue and worker-state lease prove application-level
  liveness; Scheduler success alone does not.

## Manual deployment flow

1. Apply the execution-lease migration.
2. Deploy the lease-aware API and worker while API lease reconciliation remains active.
3. Drain or terminate worker executions started from the pre-lease job definition.
4. Issue competing manual wakes against the new worker and verify one lease owner,
   contender exit without processing, independent renewal, token-fenced release, and
   an idle exit.
5. Run a later build with
   `_ENABLE_WORKER_RECONCILIATION_SCHEDULE=true`; this grants the dedicated Scheduler
   identity and creates or updates the OAuth-authenticated UTC five-minute target.
6. Observe at least two ticks and overlap a manual wake with one tick; one execution
   must own the lease while contenders exit without processing.
7. Only in a later deployment, after the scheduled path is proven, remove API startup
   and periodic lease reconciliation.
8. Verify `/health`, `/health/ready`, admin login, upload, queue drain, Scheduler
   attempts, and Cloud Run execution results.

If scheduled reconciliation or lease telemetry is unhealthy, pause the Scheduler job
with the command above and retain or restore API reconciliation before changing worker
ownership again. A later build with the schedule flag enabled updates configuration but
does not substitute for deliberately resuming a paused job:

```bash
gcloud scheduler jobs resume letter-archive-worker-reconcile \
  --project=PROJECT_ID \
  --location=REGION
```

## Health checks

- `GET /health` — liveness probe (always returns ok)
- `GET /health/ready` — readiness probe (validates DB connectivity)

Official references:

- https://docs.cloud.google.com/run/docs/reference/yaml/v1
- https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts
- https://docs.cloud.google.com/sql/docs/postgres/connect-run
- https://docs.cloud.google.com/run/docs/create-jobs
- https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule
- https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/scheduler/docs/overview
- https://docs.cloud.google.com/scheduler/docs/http-target-auth
- https://docs.cloud.google.com/scheduler/docs/configuring/retry-jobs
- https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/create/http
- https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/update/http
