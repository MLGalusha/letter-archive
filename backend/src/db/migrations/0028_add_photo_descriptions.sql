ALTER TABLE "letters"
  ADD COLUMN "photo_description" text,
  ADD COLUMN "photo_description_status" "content_status" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "photo_description_verified_at" timestamp with time zone,
  ADD COLUMN "photo_description_verified_by" text,
  ADD COLUMN "photo_description_context" text;
