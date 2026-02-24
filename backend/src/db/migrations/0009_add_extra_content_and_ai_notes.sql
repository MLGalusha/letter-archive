-- Migration: Add extra_content and ai_notes columns to letters table
-- These columns were in schema.ts but never had a migration generated
-- (they were applied via db:push on the old database)

ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "extra_content_transcript" text;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "extra_content_status" "content_status" NOT NULL DEFAULT 'EMPTY';
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "extra_content_verified_at" timestamp with time zone;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "extra_content_verified_by" text;
ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "ai_notes" text;
