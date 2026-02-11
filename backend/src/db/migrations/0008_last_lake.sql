ALTER TABLE "letters" ADD COLUMN "entity_extraction_json" jsonb;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_status" "job_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_error" text;