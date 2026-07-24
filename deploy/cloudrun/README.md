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

## Required substitutions

Replace the placeholder values before applying:

- `PROJECT_NUMBER` / `PROJECT_ID`
- `REGION`
- `BACKEND_IMAGE` / `FRONTEND_IMAGE`
- `SERVICE_ACCOUNT_EMAIL`
- `CLOUD_SQL_INSTANCE`
- `ARCHIVE_BUCKET`
- `YOUR_DOMAIN`

## Secrets

Store sensitive values in Secret Manager and reference them in YAML:

```bash
gcloud secrets create jwt-secret --replication-policy="automatic"
echo -n "your-random-secret" | gcloud secrets versions add jwt-secret --data-file=-

gcloud secrets create database-url --replication-policy="automatic"
echo -n "postgresql://..." | gcloud secrets versions add database-url --data-file=-

gcloud secrets create openai-api-key --replication-policy="automatic"
echo -n "sk-..." | gcloud secrets versions add openai-api-key --data-file=-
```

## Automated deployment

Use the `cloudbuild.yaml` in the repository root for fully automated builds:

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_DOMAIN=letterarchive.org
```

The checked-in build keeps scheduled reconciliation disabled by default. This is a
rollout gate: replacing a Cloud Run Job does not stop an older execution that began
without the database lease. After the lease-aware worker is deployed, all pre-lease
executions are drained or terminated, and the overlap proof below passes, set
`_ENABLE_WORKER_RECONCILIATION_SCHEDULE=true` on a later build to grant the Scheduler
identity and create or update `letter-archive-worker-reconcile`.

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
4. Manually wake the new worker and verify lease acquisition, independent renewal,
   token-fenced release, and an idle exit.
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
