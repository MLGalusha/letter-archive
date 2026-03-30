ALTER TABLE "collections"
ADD COLUMN IF NOT EXISTS "profile_correspondents" jsonb;
