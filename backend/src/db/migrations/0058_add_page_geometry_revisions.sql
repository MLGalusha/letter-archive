ALTER TABLE "letter_pages"
  ADD COLUMN "geometry_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "geometry_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "approved_geometry_revision" integer;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "approved_geometry_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "geometry_approved_by" text;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "geometry_approved_at" timestamp with time zone;
--> statement-breakpoint

-- A legacy "trusted" bit has no reviewer or exact-geometry receipt. Preserve
-- its geometry, but require a reviewer to approve the new durable identity.
UPDATE "letter_pages"
SET "segment_trust_state" = 'unverified'
WHERE "segment_trust_state" = 'trusted';
--> statement-breakpoint

CREATE TABLE "page_geometry_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "primary_source_revision" integer NOT NULL,
  "source_checksum_sha256" text,
  "base_page_layout_checksum_sha256" text,
  "geometry_checksum_sha256" text NOT NULL,
  "geometry_snapshot" jsonb NOT NULL,
  "change_summary" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "page_geometry_revision_positive"
    CHECK ("revision" >= 1),
  CONSTRAINT "page_geometry_revision_source_revision_nonnegative"
    CHECK ("primary_source_revision" >= 0),
  CONSTRAINT "page_geometry_revision_source_checksum_valid"
    CHECK (
      "source_checksum_sha256" IS NULL
      OR "source_checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "page_geometry_revision_base_layout_checksum_valid"
    CHECK (
      "base_page_layout_checksum_sha256" IS NULL
      OR "base_page_layout_checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "page_geometry_revision_checksum_valid"
    CHECK ("geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_revision_snapshot_array"
    CHECK (jsonb_typeof("geometry_snapshot") = 'array'),
  CONSTRAINT "page_geometry_revision_change_summary_object"
    CHECK (jsonb_typeof("change_summary") = 'object'),
  CONSTRAINT "page_geometry_revisions_page_id_letter_pages_id_fk"
    FOREIGN KEY ("page_id")
    REFERENCES "public"."letter_pages"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "page_geometry_revisions_page_source_revision_unique"
  ON "page_geometry_revisions" USING btree (
    "page_id",
    "primary_source_revision",
    "revision"
  );
--> statement-breakpoint
CREATE INDEX "idx_page_geometry_revisions_page_created"
  ON "page_geometry_revisions" USING btree ("page_id", "created_at");
--> statement-breakpoint

CREATE TABLE "page_geometry_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "primary_source_revision" integer NOT NULL,
  "source_checksum_sha256" text,
  "geometry_revision" integer NOT NULL,
  "geometry_checksum_sha256" text NOT NULL,
  "decision" text NOT NULL,
  "reviewed_by" text NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "page_geometry_review_event_revision_nonnegative"
    CHECK ("geometry_revision" >= 0),
  CONSTRAINT "page_geometry_review_event_source_revision_nonnegative"
    CHECK ("primary_source_revision" >= 0),
  CONSTRAINT "page_geometry_review_event_source_checksum_valid"
    CHECK (
      "source_checksum_sha256" IS NULL
      OR "source_checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "page_geometry_review_event_checksum_valid"
    CHECK ("geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_review_event_decision_valid"
    CHECK ("decision" IN ('trusted', 'unverified')),
  CONSTRAINT "page_geometry_review_events_page_id_letter_pages_id_fk"
    FOREIGN KEY ("page_id")
    REFERENCES "public"."letter_pages"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_page_geometry_review_events_page_reviewed"
  ON "page_geometry_review_events" USING btree ("page_id", "reviewed_at");
--> statement-breakpoint

ALTER TABLE "letter_pages"
  ADD CONSTRAINT "geometry_revision_nonnegative"
  CHECK ("geometry_revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "geometry_checksum_valid"
  CHECK (
    "geometry_checksum_sha256" IS NULL
    OR "geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "geometry_revision_checksum_presence"
  CHECK (
    "geometry_revision" = 0
    OR "geometry_checksum_sha256" IS NOT NULL
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "geometry_approval_shape"
  CHECK (
    (
      "approved_geometry_revision" IS NULL
      AND "approved_geometry_checksum_sha256" IS NULL
      AND "geometry_approved_by" IS NULL
      AND "geometry_approved_at" IS NULL
    )
    OR (
      "approved_geometry_revision" IS NOT NULL
      AND "approved_geometry_checksum_sha256" IS NOT NULL
      AND "geometry_approved_by" IS NOT NULL
      AND "geometry_approved_at" IS NOT NULL
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "geometry_approval_matches_current"
  CHECK (
    "approved_geometry_revision" IS NULL
    OR (
      "approved_geometry_revision" = "geometry_revision"
      AND "approved_geometry_checksum_sha256" = "geometry_checksum_sha256"
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "segment_trust_bound_to_geometry"
  CHECK (
    (
      "segment_trust_state" = 'unverified'
      AND "approved_geometry_revision" IS NULL
    )
    OR (
      "segment_trust_state" = 'trusted'
      AND "approved_geometry_revision" IS NOT NULL
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "geometry_revision_nonnegative";
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "geometry_checksum_valid";
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "geometry_revision_checksum_presence";
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "geometry_approval_shape";
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "geometry_approval_matches_current";
--> statement-breakpoint
ALTER TABLE "letter_pages" VALIDATE CONSTRAINT "segment_trust_bound_to_geometry";
