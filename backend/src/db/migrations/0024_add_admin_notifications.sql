CREATE TABLE IF NOT EXISTS "admin_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text,
  "link" text,
  "read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX idx_notifications_created_at ON admin_notifications(created_at DESC);
CREATE INDEX idx_notifications_read ON admin_notifications(read) WHERE read = false;
