CREATE TYPE "public"."date_confidence" AS ENUM('exact', 'unknown', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."letter_type" AS ENUM('L', 'C', 'E');--> statement-breakpoint
CREATE TYPE "public"."visibility_state" AS ENUM('DRAFT', 'PUBLISHED', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'METADATA_EXTRACTING', 'METADATA_DRAFTED', 'REVIEWED');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_code" text NOT NULL,
	"title" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_collection_code_unique" UNIQUE("collection_code")
);
--> statement-breakpoint
CREATE TABLE "letter_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_number_positive" CHECK (page_number >= 1)
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"date_raw" text NOT NULL,
	"letter_date" date,
	"date_confidence" date_confidence DEFAULT 'unknown' NOT NULL,
	"type" "letter_type" NOT NULL,
	"type_sequence" integer NOT NULL,
	"workflow" "workflow_state" DEFAULT 'UPLOADED' NOT NULL,
	"visibility" "visibility_state" DEFAULT 'DRAFT' NOT NULL,
	"transcription_status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"transcription_text" text,
	"transcription_error" text,
	"transcription_attempt_count" integer DEFAULT 0 NOT NULL,
	"transcribed_at" timestamp with time zone,
	"sender" text,
	"recipient" text,
	"location_written" text,
	"extracted_date" date,
	"extracted_date_confidence" date_confidence,
	"summary" text,
	"tags" text[],
	"metadata_json" jsonb,
	"metadata_status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"metadata_error" text,
	"metadata_attempt_count" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_requires_review" CHECK (visibility <> 'PUBLISHED' OR reviewed_at IS NOT NULL),
	CONSTRAINT "type_sequence_positive" CHECK (type_sequence >= 1),
	CONSTRAINT "transcription_attempt_count_positive" CHECK (transcription_attempt_count >= 0),
	CONSTRAINT "metadata_attempt_count_positive" CHECK (metadata_attempt_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "letter_pages" ADD CONSTRAINT "letter_pages_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "letter_pages_unique" ON "letter_pages" USING btree ("letter_id","page_number");--> statement-breakpoint
CREATE INDEX "idx_pages_letter" ON "letter_pages" USING btree ("letter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "letters_identity_unique" ON "letters" USING btree ("collection_id","date_raw","type","type_sequence");--> statement-breakpoint
CREATE INDEX "idx_letters_collection" ON "letters" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_letters_visibility" ON "letters" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_letters_workflow" ON "letters" USING btree ("workflow");--> statement-breakpoint
CREATE INDEX "idx_letters_letter_date" ON "letters" USING btree ("letter_date");--> statement-breakpoint
CREATE INDEX "idx_letters_extracted_date" ON "letters" USING btree ("extracted_date");