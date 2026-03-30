ALTER TABLE "admin_users"
ADD COLUMN IF NOT EXISTS "can_delete_admin_profiles" boolean NOT NULL DEFAULT false;

UPDATE "admin_users"
SET "can_delete_admin_profiles" = CASE
  WHEN lower(trim("admin_users"."email")) = 'masonlgalusha@gmail.com' THEN true
  ELSE false
END;

DELETE FROM "admin_invites"
WHERE "used_by" IS NOT NULL
   OR "expires_at" < now();
