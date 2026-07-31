ALTER TABLE "page_recognition_artifacts"
  DROP CONSTRAINT "page_recognition_schema_version_valid";
--> statement-breakpoint

ALTER TABLE "page_recognition_artifacts"
  ADD CONSTRAINT "page_recognition_schema_version_valid"
  CHECK ("schema_version" IN (1, 2));
--> statement-breakpoint

ALTER TABLE "page_recognition_artifacts"
  ADD CONSTRAINT "page_recognition_v2_evidence_valid"
  CHECK (
    "schema_version" <> 2
    OR (
      jsonb_typeof("artifact"->'evidence') = 'object'
      AND jsonb_typeof("artifact"#>'{evidence,inference}') = 'object'
      AND jsonb_typeof("artifact"#>'{evidence,raster}') = 'object'
      AND jsonb_typeof("artifact"#>'{evidence,normalization}') = 'object'
      AND "artifact"#>>'{evidence,raster,checksumAlgorithm}'
        = 'sha256-rgb8-v1'
      AND "artifact"#>>'{evidence,normalization,normalized,mode}' = 'RGB'
    )
  );
