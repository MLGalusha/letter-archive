ALTER TABLE "collections"
  ADD COLUMN "profile_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "collections"
  ADD COLUMN "profile_source_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "letters"
  ADD COLUMN "primary_source_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "letter_versions"
  ADD COLUMN "primary_source_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "collections"
  ADD CONSTRAINT "collection_profile_revision_nonnegative"
  CHECK ("profile_revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "collections"
  ADD CONSTRAINT "collection_profile_source_fingerprint_valid"
  CHECK (
    "profile_source_fingerprint" IS NULL
    OR "profile_source_fingerprint" ~ '^[0-9a-f]{32}$'
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letters"
  ADD CONSTRAINT "primary_source_revision_nonnegative"
  CHECK ("primary_source_revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_versions"
  ADD CONSTRAINT "letter_version_primary_source_revision_nonnegative"
  CHECK ("primary_source_revision" >= 0) NOT VALID;
--> statement-breakpoint
UPDATE "collections" AS c
SET
  "highlight_image_id" = NULL,
  "profile_revision" = c."profile_revision" + 1,
  "profile_status" = CASE
    WHEN c."profile_status" = 'VERIFIED'::content_status
      THEN 'EDITED'::content_status
    ELSE c."profile_status"
  END
WHERE c."highlight_image_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "letter_pages" AS lp
    INNER JOIN "letters" AS l ON l."id" = lp."letter_id"
    WHERE lp."id" = c."highlight_image_id"
      AND l."collection_id" = c."id"
  );
--> statement-breakpoint
ALTER TABLE "collections"
  ADD CONSTRAINT "collections_highlight_image_id_letter_pages_id_fk"
  FOREIGN KEY ("highlight_image_id")
  REFERENCES "public"."letter_pages"("id")
  ON DELETE SET NULL
  NOT VALID;
--> statement-breakpoint
CREATE FUNCTION compute_collection_profile_source_fingerprint(
  target_collection_id uuid
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT md5(
    jsonb_build_object(
      'title', c.title,
      'description', c.description,
      'letters', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', l.id,
              'letterDate', l.letter_date,
              'dateRaw', l.date_raw,
              'sender', l.sender,
              'recipient', l.recipient,
              'summary', l.summary,
              'hook', l.hook,
              'entityExtractionJson', l.entity_extraction_json,
              'primarySourceRevision', l.primary_source_revision
            )
            ORDER BY l.letter_date NULLS LAST, l.date_raw, l.id
          )
          FROM letters l
          WHERE l.collection_id = c.id
            AND l.type = 'L'
            AND l.visibility = 'PUBLISHED'
            AND l.metadata_published = true
        ),
        '[]'::jsonb
      )
    )::text
  )
  FROM collections c
  WHERE c.id = target_collection_id
$$;
