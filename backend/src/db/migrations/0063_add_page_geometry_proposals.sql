CREATE TABLE "page_geometry_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "artifact_checksum_sha256" text NOT NULL,
  "schema_version" integer NOT NULL,
  "kind" text NOT NULL,
  "primary_source_revision" integer NOT NULL,
  "source_checksum_sha256" text NOT NULL,
  "base_geometry_revision" integer NOT NULL,
  "base_geometry_checksum_sha256" text NOT NULL,
  "base_line_segments_checksum_sha256" text NOT NULL,
  "run_id" text NOT NULL,
  "artifact" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "page_geometry_proposal_artifact_checksum_valid"
    CHECK ("artifact_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_schema_version_valid"
    CHECK ("schema_version" = 1),
  CONSTRAINT "page_geometry_proposal_kind_valid"
    CHECK ("kind" = 'rotation-recovery'),
  CONSTRAINT "page_geometry_proposal_source_revision_nonnegative"
    CHECK ("primary_source_revision" >= 0),
  CONSTRAINT "page_geometry_proposal_base_revision_nonnegative"
    CHECK ("base_geometry_revision" >= 0),
  CONSTRAINT "page_geometry_proposal_source_checksum_valid"
    CHECK ("source_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_base_geometry_checksum_valid"
    CHECK ("base_geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_base_segments_checksum_valid"
    CHECK ("base_line_segments_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_run_id_nonempty"
    CHECK (length(btrim("run_id")) > 0),
  CONSTRAINT "page_geometry_proposal_created_by_nonempty"
    CHECK (length(btrim("created_by")) > 0),
  CONSTRAINT "page_geometry_proposal_artifact_object"
    CHECK (jsonb_typeof("artifact") = 'object'),
  CONSTRAINT "page_geometry_proposal_candidates_nonempty"
    CHECK (
      (
        jsonb_typeof("artifact"->'candidates') = 'array'
        AND jsonb_array_length("artifact"->'candidates') > 0
      ) IS TRUE
    ),
  CONSTRAINT "page_geometry_proposal_candidate_count_matches"
    CHECK (
      (
        "artifact"#>>'{rotationProfile,selectionSummary,appendedRotatedLineCount}'
          = jsonb_array_length("artifact"->'candidates')::text
      ) IS TRUE
    ),
  CONSTRAINT "page_geometry_proposal_candidates_geometry_only"
    CHECK (
      NOT jsonb_path_exists(
        "artifact",
        '$.candidates[*] ? (
          exists(@.excluded)
          || exists(@.segmentClass)
          || exists(@.isMapped)
          || exists(@.mappedText)
          || exists(@.words)
          || exists(@.group)
          || exists(@.regionIds)
          || exists(@.providerOrdinal)
          || !exists(@.ocrText)
          || @.ocrText.type() != "string"
          || @.ocrText != ""
        )'
      )
    ),
  CONSTRAINT "page_geometry_proposal_candidates_machine_only"
    CHECK (
      NOT jsonb_path_exists(
        "artifact",
        '$.candidates[*] ? (
          !exists(@.id)
          || @.id.type() != "string"
          || !exists(@.geometryType)
          || @.geometryType.type() != "string"
          || !exists(@.line)
          || @.line.type() != "number"
          || @.line != -1
          || !exists(@.bbox)
          || @.bbox.type() != "array"
          || @.bbox.size() != 4
          || !exists(@.geometryProvenance.source)
          || @.geometryProvenance.source != "machine"
          || !exists(@.geometryProvenance.operation)
          || @.geometryProvenance.operation != "detected"
          || !exists(@.geometryProvenance.parentSegmentIds)
          || @.geometryProvenance.parentSegmentIds.type() != "array"
          || @.geometryProvenance.parentSegmentIds.size() != 0
          || !exists(@.rotationEvidence.representativeRotationDegrees)
          || @.rotationEvidence.representativeRotationDegrees == 0
          || !exists(@.rotationEvidence.readingOrderSource)
          || @.rotationEvidence.readingOrderSource
            != "unresolved-rotated-proposal"
          || !exists(@.providerTextDirection)
          || (
            @.providerTextDirection != "vertical-lr"
            && @.providerTextDirection != "vertical-rl"
          )
        )'
      )
    ),
  CONSTRAINT "page_geometry_proposal_candidates_in_image"
    CHECK (
      NOT jsonb_path_exists(
        "artifact",
        '$.candidates[*] ? (
          @.bbox[0] < 0
          || @.bbox[1] < 0
          || @.bbox[2] <= @.bbox[0]
          || @.bbox[3] <= @.bbox[1]
          || @.bbox[2] > $width
          || @.bbox[3] > $height
        )',
        jsonb_build_object(
          'width',
          ("artifact"#>>'{source,image,width}')::numeric,
          'height',
          ("artifact"#>>'{source,image,height}')::numeric
        )
      )
      AND NOT jsonb_path_exists(
        "artifact",
        '$.candidates[*].baseline[*] ? (
          @[0] < 0 || @[1] < 0 || @[0] > $width || @[1] > $height
        )',
        jsonb_build_object(
          'width',
          ("artifact"#>>'{source,image,width}')::numeric,
          'height',
          ("artifact"#>>'{source,image,height}')::numeric
        )
      )
      AND NOT jsonb_path_exists(
        "artifact",
        '$.candidates[*].boundary[*] ? (
          @.x < 0 || @.y < 0 || @.x > $width || @.y > $height
        )',
        jsonb_build_object(
          'width',
          ("artifact"#>>'{source,image,width}')::numeric,
          'height',
          ("artifact"#>>'{source,image,height}')::numeric
        )
      )
    ),
  CONSTRAINT "page_geometry_proposal_artifact_identity_matches"
    CHECK (
      (
        "artifact"->>'kind' = "kind"
        AND "artifact"->>'pageId' = "page_id"::text
        AND ("artifact"->>'schemaVersion')::integer = "schema_version"
        AND "artifact"#>>'{source,primarySourceRevision}'
          = "primary_source_revision"::text
        AND "artifact"#>>'{source,sourceChecksumSha256}'
          = "source_checksum_sha256"
        AND "artifact"#>>'{source,baseGeometryRevision}'
          = "base_geometry_revision"::text
        AND "artifact"#>>'{source,baseGeometryChecksumSha256}'
          = "base_geometry_checksum_sha256"
        AND "artifact"#>>'{source,baseLineSegmentsChecksumSha256}'
          = "base_line_segments_checksum_sha256"
        AND ("artifact"#>>'{source,image,width}')::integer > 0
        AND ("artifact"#>>'{source,image,height}')::integer > 0
        AND "artifact"#>>'{run,id}' = "run_id"
      ) IS TRUE
    ),
  CONSTRAINT "page_geometry_proposals_page_id_letter_pages_id_fk"
    FOREIGN KEY ("page_id")
    REFERENCES "public"."letter_pages"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX "page_geometry_proposals_artifact_checksum_unique"
  ON "page_geometry_proposals" USING btree ("artifact_checksum_sha256");
--> statement-breakpoint

CREATE INDEX "idx_page_geometry_proposals_current_identity"
  ON "page_geometry_proposals" USING btree (
    "page_id",
    "primary_source_revision",
    "source_checksum_sha256",
    "base_geometry_revision",
    "base_geometry_checksum_sha256",
    "base_line_segments_checksum_sha256",
    "created_at"
  );
--> statement-breakpoint

CREATE TABLE "page_geometry_proposal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "proposal_segment_id" text NOT NULL,
  "decision" text NOT NULL,
  "observed_primary_source_revision" integer NOT NULL,
  "observed_source_checksum_sha256" text NOT NULL,
  "observed_geometry_revision" integer NOT NULL,
  "observed_geometry_checksum_sha256" text NOT NULL,
  "observed_line_segments_checksum_sha256" text NOT NULL,
  "result_segment_id" text,
  "result_geometry_revision" integer,
  "result_geometry_checksum_sha256" text,
  "reviewed_by" text NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "note" text,
  CONSTRAINT "page_geometry_proposal_event_segment_id_valid"
    CHECK (
      "proposal_segment_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
  CONSTRAINT "page_geometry_proposal_event_decision_valid"
    CHECK ("decision" IN ('promoted', 'rejected')),
  CONSTRAINT "page_geometry_proposal_event_source_revision_nonnegative"
    CHECK ("observed_primary_source_revision" >= 0),
  CONSTRAINT "page_geometry_proposal_event_geometry_revision_nonnegative"
    CHECK ("observed_geometry_revision" >= 0),
  CONSTRAINT "page_geometry_proposal_event_source_checksum_valid"
    CHECK ("observed_source_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_event_geometry_checksum_valid"
    CHECK ("observed_geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_event_segments_checksum_valid"
    CHECK ("observed_line_segments_checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_geometry_proposal_event_reviewed_by_nonempty"
    CHECK (length(btrim("reviewed_by")) > 0),
  CONSTRAINT "page_geometry_proposal_event_result_shape"
    CHECK (
      (
        "decision" = 'promoted'
        AND "result_segment_id" IS NOT NULL
        AND "result_segment_id"
          ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
        AND "result_geometry_revision" IS NOT NULL
        AND "result_geometry_revision" >= 0
        AND "result_geometry_checksum_sha256" IS NOT NULL
        AND "result_geometry_checksum_sha256" ~ '^[0-9a-f]{64}$'
      )
      OR (
        "decision" = 'rejected'
        AND "result_segment_id" IS NULL
        AND "result_geometry_revision" IS NULL
        AND "result_geometry_checksum_sha256" IS NULL
      )
    ),
  CONSTRAINT "page_geometry_proposal_events_proposal_id_fk"
    FOREIGN KEY ("proposal_id")
    REFERENCES "public"."page_geometry_proposals"("id")
    ON DELETE cascade
    ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX "page_geometry_proposal_events_one_promotion_unique"
  ON "page_geometry_proposal_events" USING btree (
    "proposal_id",
    "proposal_segment_id"
  )
  WHERE "decision" = 'promoted';
--> statement-breakpoint

CREATE INDEX "idx_page_geometry_proposal_events_proposal_reviewed"
  ON "page_geometry_proposal_events" USING btree (
    "proposal_id",
    "reviewed_at"
  );
--> statement-breakpoint

CREATE INDEX "idx_page_geometry_proposal_events_batch"
  ON "page_geometry_proposal_events" USING btree ("batch_id");
--> statement-breakpoint

-- Proposal evidence and reviewer decisions are immutable while their page
-- exists. Direct UPDATE/DELETE statements are rejected. Cascades initiated by
-- deleting the owning page remain permitted as an explicit source-lifecycle
-- erasure; nested FK actions run at trigger depth greater than one.
CREATE FUNCTION protect_page_geometry_proposal_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    OR (TG_OP = 'DELETE' AND pg_trigger_depth() = 1)
  THEN
    RAISE EXCEPTION '% rows are immutable and append-only', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER page_geometry_proposals_immutable
  BEFORE UPDATE OR DELETE ON "page_geometry_proposals"
  FOR EACH ROW
  EXECUTE FUNCTION protect_page_geometry_proposal_history();
--> statement-breakpoint

CREATE TRIGGER page_geometry_proposal_events_immutable
  BEFORE UPDATE OR DELETE ON "page_geometry_proposal_events"
  FOR EACH ROW
  EXECUTE FUNCTION protect_page_geometry_proposal_history();
