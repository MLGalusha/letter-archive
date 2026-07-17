ALTER TABLE "letters" ADD COLUMN "transcription_run_id" uuid;

-- Fence any attempt that was already RUNNING during rollout. Old binaries do
-- not know this ID and therefore cannot publish through the new constraint.
UPDATE "letters"
SET "transcription_run_id" = gen_random_uuid()
WHERE "transcription_status" = 'RUNNING';

ALTER TABLE "letters" ADD CONSTRAINT "transcription_run_id_matches_running"
  CHECK (("transcription_status" = 'RUNNING') = ("transcription_run_id" IS NOT NULL));
