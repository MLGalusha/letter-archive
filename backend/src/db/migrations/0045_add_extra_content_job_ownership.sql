ALTER TABLE "letters" ADD COLUMN "extra_content_job_run_id" uuid;
ALTER TABLE "letters" ADD COLUMN "extra_content_job_dirty" boolean DEFAULT false NOT NULL;
ALTER TABLE "letters" ADD CONSTRAINT "extra_content_job_run_id_matches_running"
  CHECK (("extra_content_job_status" = 'RUNNING') = ("extra_content_job_run_id" IS NOT NULL));
ALTER TABLE "letters" ADD CONSTRAINT "extra_content_job_dirty_requires_running"
  CHECK (NOT "extra_content_job_dirty" OR "extra_content_job_status" = 'RUNNING');
