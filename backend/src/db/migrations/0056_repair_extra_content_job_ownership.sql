-- 0045 was reused during development after some databases had already
-- recorded its journal timestamp. Those databases advanced through later
-- migrations without receiving these two ownership columns. Reintroduce the
-- shape under a new forward-only journal entry so both fresh and already
-- advanced databases converge.
ALTER TABLE "letters"
  ADD COLUMN IF NOT EXISTS "extra_content_job_run_id" uuid;
ALTER TABLE "letters"
  ADD COLUMN IF NOT EXISTS "extra_content_job_dirty" boolean DEFAULT false NOT NULL;

UPDATE "letters"
SET "extra_content_job_dirty" = false
WHERE "extra_content_job_dirty" IS NULL;

ALTER TABLE "letters"
  ALTER COLUMN "extra_content_job_dirty" SET DEFAULT false;
ALTER TABLE "letters"
  ALTER COLUMN "extra_content_job_dirty" SET NOT NULL;

-- A RUNNING row without an owner predates the ownership boundary and cannot be
-- resumed safely. Return it to the durable queue and clear any later lease
-- metadata that cannot be bound to a run.
UPDATE "letters"
SET "extra_content_job_status" = 'PENDING',
    "extra_content_job_error" = NULL,
    "extra_content_job_run_id" = NULL,
    "extra_content_job_lease_expires_at" = NULL,
    "extra_content_job_lease_run_id" = NULL,
    "extra_content_job_claim_kind" = NULL,
    "extra_content_job_dirty" = false,
    "updated_at" = clock_timestamp()
WHERE "extra_content_job_status" = 'RUNNING'
  AND "extra_content_job_run_id" IS NULL;

-- Normalize any partial legacy ownership tuple before validating the canonical
-- constraints. Current valid RUNNING attempts retain their owner and dirty bit.
UPDATE "letters"
SET "extra_content_job_run_id" = NULL,
    "extra_content_job_lease_expires_at" = NULL,
    "extra_content_job_lease_run_id" = NULL,
    "extra_content_job_claim_kind" = NULL,
    "extra_content_job_dirty" = false,
    "updated_at" = clock_timestamp()
WHERE "extra_content_job_status" <> 'RUNNING'
  AND (
    "extra_content_job_run_id" IS NOT NULL
    OR "extra_content_job_dirty"
    OR "extra_content_job_lease_expires_at" IS NOT NULL
    OR "extra_content_job_lease_run_id" IS NOT NULL
    OR "extra_content_job_claim_kind" IS NOT NULL
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extra_content_job_run_id_matches_running'
      AND conrelid = 'public.letters'::regclass
  ) THEN
    ALTER TABLE "letters"
      ADD CONSTRAINT "extra_content_job_run_id_matches_running"
      CHECK (
        ("extra_content_job_status" = 'RUNNING')
        = ("extra_content_job_run_id" IS NOT NULL)
      ) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extra_content_job_dirty_requires_running'
      AND conrelid = 'public.letters'::regclass
  ) THEN
    ALTER TABLE "letters"
      ADD CONSTRAINT "extra_content_job_dirty_requires_running"
      CHECK (
        NOT "extra_content_job_dirty"
        OR "extra_content_job_status" = 'RUNNING'
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE "letters"
  VALIDATE CONSTRAINT "extra_content_job_run_id_matches_running";
ALTER TABLE "letters"
  VALIDATE CONSTRAINT "extra_content_job_dirty_requires_running";
