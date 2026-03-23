CREATE TABLE IF NOT EXISTS "admin_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL UNIQUE,
  "email" text,
  "invited_by" uuid NOT NULL REFERENCES "admin_users"("id"),
  "used_by" uuid REFERENCES "admin_users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
