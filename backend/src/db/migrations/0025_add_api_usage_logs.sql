CREATE TABLE IF NOT EXISTS "api_usage_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "letter_id" uuid,
  "call_type" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL,
  "output_tokens" integer NOT NULL,
  "total_tokens" integer NOT NULL,
  "input_cost" text NOT NULL,
  "output_cost" text NOT NULL,
  "total_cost" text NOT NULL,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_letter_id_letters_id_fk"
    FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_usage_logs_letter" ON "api_usage_logs" USING btree ("letter_id");
CREATE INDEX IF NOT EXISTS "idx_usage_logs_call_type" ON "api_usage_logs" USING btree ("call_type");
CREATE INDEX IF NOT EXISTS "idx_usage_logs_created_at" ON "api_usage_logs" USING btree ("created_at");
