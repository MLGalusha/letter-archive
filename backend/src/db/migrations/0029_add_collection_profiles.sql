ALTER TABLE "collections"
  ADD COLUMN "profile_narrative" text,
  ADD COLUMN "profile_start_here_letter_id" uuid,
  ADD COLUMN "profile_start_here_reason" text,
  ADD COLUMN "profile_reading_paths" jsonb,
  ADD COLUMN "profile_gap_analysis" jsonb,
  ADD COLUMN "profile_themes" jsonb,
  ADD COLUMN "profile_status" "content_status" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "profile_generated_at" timestamp with time zone;

ALTER TABLE "collections"
  ADD CONSTRAINT "collections_profile_start_here_letter_id_letters_id_fk"
  FOREIGN KEY ("profile_start_here_letter_id") REFERENCES "letters"("id")
  ON DELETE SET NULL;
