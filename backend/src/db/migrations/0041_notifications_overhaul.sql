-- Notification system overhaul: severity, status, source linkage, dedupe, retention.
-- Also adds dead-letter flag to letters for max-retry enforcement.

-- ============================================================================
-- admin_notifications: new columns
-- ============================================================================

ALTER TABLE "admin_notifications"
  ADD COLUMN IF NOT EXISTS "severity" text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "source_type" text,
  ADD COLUMN IF NOT EXISTS "source_id" text,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "dedupe_key" text,
  ADD COLUMN IF NOT EXISTS "dedupe_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "last_occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "resolved_by" text;

-- Backfill existing rows: read=true rows become 'resolved', everything else stays 'open'
UPDATE "admin_notifications"
SET "status" = 'resolved',
    "resolved_at" = "created_at"
WHERE "read" = true AND "status" = 'open';

-- Backfill source_type/source_id from link where parseable (e.g., '/admin/letters/<uuid>')
UPDATE "admin_notifications"
SET "source_type" = 'letter',
    "source_id" = substring("link" from '/admin/letters/([0-9a-f-]+)')
WHERE "source_type" IS NULL
  AND "link" IS NOT NULL
  AND "link" ~ '^/admin/letters/[0-9a-f-]+';

-- Map legacy `error` type to severity='error' so the new UI surfaces them correctly
UPDATE "admin_notifications" SET "severity" = 'error' WHERE "type" = 'error';

-- Severity check (cheap CHECK so bad inserts fail loud)
ALTER TABLE "admin_notifications"
  ADD CONSTRAINT "admin_notifications_severity_check"
  CHECK ("severity" IN ('info', 'warn', 'error', 'critical'));

ALTER TABLE "admin_notifications"
  ADD CONSTRAINT "admin_notifications_status_check"
  CHECK ("status" IN ('open', 'acknowledged', 'resolved', 'archived'));

-- ============================================================================
-- admin_notifications: new indexes
-- ============================================================================

-- Primary list query: status + severity + recency
CREATE INDEX IF NOT EXISTS "idx_notifications_status_severity_created"
  ON "admin_notifications" ("status", "severity", "created_at" DESC);

-- Group-by-source lookups
CREATE INDEX IF NOT EXISTS "idx_notifications_source"
  ON "admin_notifications" ("source_type", "source_id")
  WHERE "source_type" IS NOT NULL;

-- Dedupe lookup (only open notifications can absorb duplicates)
CREATE INDEX IF NOT EXISTS "idx_notifications_dedupe_open"
  ON "admin_notifications" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" = 'open';

-- Retention sweep
CREATE INDEX IF NOT EXISTS "idx_notifications_expires_at"
  ON "admin_notifications" ("expires_at")
  WHERE "expires_at" IS NOT NULL;

-- ============================================================================
-- letters: dead_letter flag for max-retry enforcement
-- ============================================================================

ALTER TABLE "letters"
  ADD COLUMN IF NOT EXISTS "dead_letter" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_letters_dead_letter"
  ON "letters" ("dead_letter")
  WHERE "dead_letter" = true;
