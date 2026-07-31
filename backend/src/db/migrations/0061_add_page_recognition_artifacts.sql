CREATE TABLE "page_recognition_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "artifact_checksum_sha256" text NOT NULL,
  "schema_version" integer NOT NULL,
  "primary_source_revision" integer NOT NULL,
  "source_checksum_sha256" text NOT NULL,
  "geometry_revision" integer NOT NULL,
  "geometry_checksum_sha256" text NOT NULL,
  "line_segments_checksum_sha256" text NOT NULL,
  "alignment_segment_input_checksum_sha256" text NOT NULL,
  "profile_checksum_sha256" text NOT NULL,
  "engine" text NOT NULL,
  "engine_version" text NOT NULL,
  "model_name" text NOT NULL,
  "model_checksum_sha256" text NOT NULL,
  "config_checksum_sha256" text NOT NULL,
  "state" text NOT NULL,
  "artifact" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "persisted_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "page_recognition_artifact_checksum_valid"
    CHECK ("artifact_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_source_revision_nonnegative"
    CHECK ("primary_source_revision" >= 0),
  CONSTRAINT "page_recognition_geometry_revision_nonnegative"
    CHECK ("geometry_revision" >= 0),
  CONSTRAINT "page_recognition_source_checksum_valid"
    CHECK ("source_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_geometry_checksum_valid"
    CHECK ("geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_line_segments_checksum_valid"
    CHECK ("line_segments_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_alignment_input_checksum_valid"
    CHECK ("alignment_segment_input_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_profile_checksum_valid"
    CHECK ("profile_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_model_checksum_valid"
    CHECK ("model_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_config_checksum_valid"
    CHECK ("config_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_recognition_schema_version_valid"
    CHECK ("schema_version" = 1),
  CONSTRAINT "page_recognition_state_valid"
    CHECK ("state" IN ('completed', 'partial')),
  CONSTRAINT "page_recognition_artifact_object"
    CHECK (jsonb_typeof("artifact") = 'object'),
  CONSTRAINT "page_recognition_artifact_records_array"
    CHECK (jsonb_typeof("artifact"->'records') = 'array'),
  CONSTRAINT "page_recognition_artifact_identity_matches"
    CHECK (
      "artifact"->>'kind' = 'page-line-recognition'
      AND "artifact"->>'pageId' = "page_id"::text
      AND ("artifact"->>'schemaVersion')::integer = "schema_version"
      AND "artifact"#>>'{source,primarySourceRevision}'
        = "primary_source_revision"::text
      AND "artifact"#>>'{source,sourceChecksumSha256}'
        = "source_checksum_sha256"
      AND "artifact"#>>'{source,geometryRevision}'
        = "geometry_revision"::text
      AND "artifact"#>>'{source,geometryChecksumSha256}'
        = "geometry_checksum_sha256"
      AND "artifact"#>>'{source,lineSegmentsChecksumSha256}'
        = "line_segments_checksum_sha256"
      AND "artifact"#>>'{source,alignmentSegmentInputChecksumSha256}'
        = "alignment_segment_input_checksum_sha256"
      AND "artifact"#>>'{profile,profileChecksumSha256}'
        = "profile_checksum_sha256"
      AND "artifact"#>>'{profile,engine}' = "engine"
      AND "artifact"#>>'{profile,engineVersion}' = "engine_version"
      AND "artifact"#>>'{profile,modelName}' = "model_name"
      AND "artifact"#>>'{profile,modelChecksumSha256}'
        = "model_checksum_sha256"
      AND "artifact"#>>'{profile,configChecksumSha256}'
        = "config_checksum_sha256"
      AND "artifact"->>'state' = "state"
      AND ("artifact"->>'createdAt')::timestamptz = "created_at"
    ),
  CONSTRAINT "page_recognition_artifacts_page_id_letter_pages_id_fk"
    FOREIGN KEY ("page_id")
    REFERENCES "public"."letter_pages"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX "page_recognition_artifacts_checksum_unique"
  ON "page_recognition_artifacts" USING btree ("artifact_checksum_sha256");
--> statement-breakpoint

CREATE INDEX "idx_page_recognition_artifacts_current_profile"
  ON "page_recognition_artifacts" USING btree (
    "page_id",
    "primary_source_revision",
    "source_checksum_sha256",
    "geometry_revision",
    "geometry_checksum_sha256",
    "line_segments_checksum_sha256",
    "alignment_segment_input_checksum_sha256",
    "profile_checksum_sha256",
    "created_at"
  );
