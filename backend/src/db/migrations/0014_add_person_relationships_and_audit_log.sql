-- Create person_relationship_type enum
CREATE TYPE "public"."person_relationship_type" AS ENUM('spouse', 'fiancé/fiancée', 'romantic-partner', 'parent-child', 'sibling', 'grandparent-grandchild', 'aunt-uncle-niece-nephew', 'cousin', 'in-law', 'friend', 'acquaintance', 'business-associate', 'employer-employee', 'unknown');--> statement-breakpoint

-- Create person_relationships table
CREATE TABLE "person_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"relationship_type" "person_relationship_type" NOT NULL,
	"notes" text,
	"discovered_in_letter_id" uuid,
	"confidence" integer DEFAULT 100 NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_range_rel" CHECK (confidence >= 0 AND confidence <= 100),
	CONSTRAINT "no_self_relationship" CHECK (person_a_id <> person_b_id)
);--> statement-breakpoint

-- Create audit_log table
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign keys for person_relationships
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_person_a_id_canonical_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."canonical_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_person_b_id_canonical_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."canonical_persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_discovered_in_letter_id_letters_id_fk" FOREIGN KEY ("discovered_in_letter_id") REFERENCES "public"."letters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Indexes for person_relationships
CREATE UNIQUE INDEX "person_relationships_unique" ON "person_relationships" USING btree ("person_a_id","person_b_id");--> statement-breakpoint
CREATE INDEX "idx_person_rel_a" ON "person_relationships" USING btree ("person_a_id");--> statement-breakpoint
CREATE INDEX "idx_person_rel_b" ON "person_relationships" USING btree ("person_b_id");--> statement-breakpoint

-- Indexes for audit_log
CREATE INDEX "idx_audit_log_timestamp" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_user" ON "audit_log" USING btree ("user_id");
