-- Drop the constraint that required verified status before publishing
-- Admins can now publish letters regardless of verification status
ALTER TABLE "letters" DROP CONSTRAINT IF EXISTS "published_requires_verified";
