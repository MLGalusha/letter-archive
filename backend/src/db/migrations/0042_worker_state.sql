-- Worker state singleton: lets the API process observe the background worker
-- process (which runs independently, possibly on a separate Cloud Run service).
-- The worker writes once per poll cycle; the API reads on demand.

CREATE TABLE IF NOT EXISTS "worker_state" (
  "id" text PRIMARY KEY DEFAULT 'singleton',
  "last_tick_at" timestamp with time zone,
  "is_polling" boolean NOT NULL DEFAULT false,
  "last_error" text,
  "current_batch_size" integer,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO "worker_state" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
