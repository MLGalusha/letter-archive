# Cloud Run Deployment Templates

These templates assume:

- frontend and backend are deployed separately
- the backend runs on Cloud Run
- the processing worker runs as a Cloud Run worker pool
- database migrations run as a Cloud Run job
- letter images are stored on a mounted Cloud Storage bucket at `/mnt/archive`

## Templates

- `backend-service.yaml` — public API service
- `backend-workerpool.yaml` — background processing worker
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

## Manual deployment flow

1. Build and push the backend + frontend images.
2. Run the migration job with the new image.
3. Deploy the API service.
4. Deploy the frontend service.
5. Deploy or update the worker pool revision.
6. Verify `/health`, `/health/ready`, admin login, upload, and background processing.

## Health checks

- `GET /health` — liveness probe (always returns ok)
- `GET /health/ready` — readiness probe (validates DB connectivity)

Official references:

- https://docs.cloud.google.com/run/docs/reference/yaml/v1
- https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts
- https://docs.cloud.google.com/sql/docs/postgres/connect-run
- https://docs.cloud.google.com/run/docs/managing/workerpools
