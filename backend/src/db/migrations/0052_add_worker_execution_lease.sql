-- Expand-only worker execution ownership. Existing worker revisions do not know
-- these columns, so ownership is intentionally nullable and never backfilled.
ALTER TABLE "worker_state" ADD COLUMN "execution_token" uuid;
ALTER TABLE "worker_state" ADD COLUMN "execution_lease_expires_at" timestamp(3) with time zone;

ALTER TABLE "worker_state" ADD CONSTRAINT "worker_execution_lease_shape"
  CHECK (
    ("execution_token" IS NULL)
    = ("execution_lease_expires_at" IS NULL)
  );

INSERT INTO "worker_state" ("id")
VALUES ('singleton')
ON CONFLICT DO NOTHING;
