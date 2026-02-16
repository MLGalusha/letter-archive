CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."entity_review_status" AS ENUM('pending', 'confirmed', 'rejected', 'new_entity');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('sender', 'recipient', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."place_role" AS ENUM('written_from', 'mentioned', 'destination');--> statement-breakpoint
CREATE TYPE "public"."place_type" AS ENUM('city', 'region', 'country', 'street', 'landmark', 'other');--> statement-breakpoint
CREATE TABLE "canonical_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}',
	"place_type" "place_type",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"extracted_text" text NOT NULL,
	"letter_id" uuid NOT NULL,
	"suggested_entity_id" uuid,
	"context" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"status" "entity_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letter_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "person_role" NOT NULL,
	"name_as_written" text,
	"relationship_to_sender" text,
	"context" text,
	"confidence" integer DEFAULT 100 NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_range" CHECK (confidence >= 0 AND confidence <= 100)
);
--> statement-breakpoint
CREATE TABLE "letter_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"role" "place_role" NOT NULL,
	"name_as_written" text,
	"context" text,
	"confidence" integer DEFAULT 100 NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_range_place" CHECK (confidence >= 0 AND confidence <= 100)
);
--> statement-breakpoint
ALTER TABLE "entity_review_queue" ADD CONSTRAINT "entity_review_queue_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_persons" ADD CONSTRAINT "letter_persons_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_persons" ADD CONSTRAINT "letter_persons_person_id_canonical_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."canonical_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_places" ADD CONSTRAINT "letter_places_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_places" ADD CONSTRAINT "letter_places_place_id_canonical_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."canonical_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_persons_name_trgm" ON "canonical_persons" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_persons_aliases" ON "canonical_persons" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "idx_places_name_trgm" ON "canonical_places" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_places_aliases" ON "canonical_places" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "idx_review_queue_status" ON "entity_review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_review_queue_letter" ON "entity_review_queue" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "idx_review_queue_entity_type" ON "entity_review_queue" USING btree ("entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "letter_persons_unique" ON "letter_persons" USING btree ("letter_id","person_id","role");--> statement-breakpoint
CREATE INDEX "idx_letter_persons_letter" ON "letter_persons" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "idx_letter_persons_person" ON "letter_persons" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "letter_places_unique" ON "letter_places" USING btree ("letter_id","place_id","role");--> statement-breakpoint
CREATE INDEX "idx_letter_places_letter" ON "letter_places" USING btree ("letter_id");--> statement-breakpoint
CREATE INDEX "idx_letter_places_place" ON "letter_places" USING btree ("place_id");