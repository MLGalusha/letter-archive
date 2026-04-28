-- Adds DB-backed pause state to the worker_state singleton so the Cloud Run
-- worker job can honor a pause toggled from the admin UI. The previous
-- in-memory flag in processing-queue.ts only worked for the long-running
-- in-process worker; Cloud Run job invocations couldn't see it.

ALTER TABLE "worker_state" ADD COLUMN IF NOT EXISTS "is_paused" boolean NOT NULL DEFAULT false;
ALTER TABLE "worker_state" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE "worker_state" ADD COLUMN IF NOT EXISTS "paused_reason" text;
