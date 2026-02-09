CREATE TYPE "public"."content_status" AS ENUM('EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED');--> statement-breakpoint
CREATE TABLE "letter_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"field_type" text NOT NULL,
	"version_number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_type_valid" CHECK (field_type IN ('transcript', 'metadata')),
	CONSTRAINT "source_valid" CHECK (source IN ('ai', 'human')),
	CONSTRAINT "version_number_positive" CHECK (version_number >= 1)
);
--> statement-breakpoint
ALTER TABLE "letters" ALTER COLUMN "visibility" SET DEFAULT 'HIDDEN';--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_status" "content_status" DEFAULT 'EMPTY' NOT NULL;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_content_status" "content_status" DEFAULT 'EMPTY' NOT NULL;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_verified_by" text;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "metadata_verified_by" text;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "transcript_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "letter_versions" ADD CONSTRAINT "letter_versions_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "letter_versions_unique" ON "letter_versions" USING btree ("letter_id","field_type","version_number");--> statement-breakpoint
CREATE INDEX "idx_versions_letter" ON "letter_versions" USING btree ("letter_id");--> statement-breakpoint
ALTER TABLE "public"."letters" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."letter_type";--> statement-breakpoint
CREATE TYPE "public"."letter_type" AS ENUM('L', 'P', 'E', 'V', 'A', 'D', 'C', 'N', 'T');--> statement-breakpoint
ALTER TABLE "public"."letters" ALTER COLUMN "type" SET DATA TYPE "public"."letter_type" USING "type"::"public"."letter_type";--> statement-breakpoint
ALTER TABLE "public"."letters" ALTER COLUMN "visibility" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."visibility_state";--> statement-breakpoint
CREATE TYPE "public"."visibility_state" AS ENUM('PUBLISHED', 'HIDDEN');--> statement-breakpoint
ALTER TABLE "public"."letters" ALTER COLUMN "visibility" SET DATA TYPE "public"."visibility_state" USING "visibility"::"public"."visibility_state";