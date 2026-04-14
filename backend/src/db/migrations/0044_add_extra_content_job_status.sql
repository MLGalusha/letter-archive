ALTER TABLE "letters" ADD COLUMN "extra_content_job_status" "job_status" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "letters" ADD COLUMN "extra_content_job_error" text;
