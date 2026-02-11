-- Add biography fields to canonical_persons table
ALTER TABLE "canonical_persons" ADD COLUMN IF NOT EXISTS "biography" text;
ALTER TABLE "canonical_persons" ADD COLUMN IF NOT EXISTS "biography_status" "content_status" DEFAULT 'EMPTY' NOT NULL;
ALTER TABLE "canonical_persons" ADD COLUMN IF NOT EXISTS "biography_verified_at" timestamp with time zone;
ALTER TABLE "canonical_persons" ADD COLUMN IF NOT EXISTS "biography_verified_by" text;
