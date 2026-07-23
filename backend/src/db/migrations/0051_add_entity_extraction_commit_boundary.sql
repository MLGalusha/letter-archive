ALTER TABLE "letters" ADD COLUMN "entity_extraction_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_run_id" uuid;--> statement-breakpoint
ALTER TABLE "letters" ADD COLUMN "entity_extraction_run_revision" integer;--> statement-breakpoint
ALTER TABLE "letter_persons" ADD COLUMN "entity_extraction_revision" integer;--> statement-breakpoint
ALTER TABLE "letter_places" ADD COLUMN "entity_extraction_revision" integer;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD COLUMN "entity_extraction_revision" integer;--> statement-breakpoint
ALTER TABLE "entity_review_queue" ADD COLUMN "entity_extraction_revision" integer;--> statement-breakpoint

-- Expand/drain rollout contract:
--   * existing tokenless RUNNING attempts may finish under the legacy binary;
--   * every new RUNNING transition must carry the current ownership tuple;
--   * output inserted by a draining legacy attempt receives its pending
--     revision at the database boundary instead of becoming ambiguous NULL
--     provenance;
--   * an old terminal writer cannot overwrite a current owned attempt.
ALTER TABLE "letters" ADD CONSTRAINT "entity_extraction_revision_nonnegative"
  CHECK ("entity_extraction_revision" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "entity_extraction_owner_shape" CHECK (
  (
    "entity_extraction_run_id" IS NULL
    AND "entity_extraction_run_revision" IS NULL
  ) OR (
    "entity_extraction_status" = 'RUNNING'
    AND "entity_extraction_run_id" IS NOT NULL
    AND "entity_extraction_run_revision" IS NOT NULL
    AND "entity_extraction_run_revision" = "entity_extraction_revision" + 1
  )
) NOT VALID;--> statement-breakpoint
ALTER TABLE "letter_persons" ADD CONSTRAINT "letter_persons_extraction_revision_nonnegative"
  CHECK ("entity_extraction_revision" IS NULL OR "entity_extraction_revision" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "letter_places" ADD CONSTRAINT "letter_places_extraction_revision_nonnegative"
  CHECK ("entity_extraction_revision" IS NULL OR "entity_extraction_revision" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_extraction_revision_nonnegative"
  CHECK ("entity_extraction_revision" IS NULL OR "entity_extraction_revision" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "entity_review_queue" ADD CONSTRAINT "review_queue_extraction_revision_nonnegative"
  CHECK ("entity_extraction_revision" IS NULL OR "entity_extraction_revision" >= 0) NOT VALID;--> statement-breakpoint

CREATE FUNCTION stamp_legacy_entity_extraction_output() RETURNS trigger AS $$
DECLARE
  source_letter_id uuid;
  pending_revision integer;
BEGIN
  IF NEW.entity_extraction_revision IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'person_relationships' THEN
    source_letter_id := NEW.discovered_in_letter_id;
  ELSE
    source_letter_id := NEW.letter_id;
  END IF;

  IF source_letter_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT letter.entity_extraction_revision + 1
    INTO pending_revision
  FROM letters AS letter
  WHERE letter.id = source_letter_id
    AND letter.entity_extraction_status = 'RUNNING'
    AND letter.entity_extraction_run_id IS NULL
    AND letter.entity_extraction_run_revision IS NULL;

  IF pending_revision IS NOT NULL THEN
    NEW.entity_extraction_revision := pending_revision;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER legacy_letter_person_extraction_revision
  BEFORE INSERT ON "letter_persons"
  FOR EACH ROW
  EXECUTE FUNCTION stamp_legacy_entity_extraction_output();--> statement-breakpoint
CREATE TRIGGER legacy_letter_place_extraction_revision
  BEFORE INSERT ON "letter_places"
  FOR EACH ROW
  EXECUTE FUNCTION stamp_legacy_entity_extraction_output();--> statement-breakpoint
CREATE TRIGGER legacy_person_relationship_extraction_revision
  BEFORE INSERT ON "person_relationships"
  FOR EACH ROW
  EXECUTE FUNCTION stamp_legacy_entity_extraction_output();--> statement-breakpoint
CREATE TRIGGER legacy_review_queue_extraction_revision
  BEFORE INSERT ON "entity_review_queue"
  FOR EACH ROW
  EXECUTE FUNCTION stamp_legacy_entity_extraction_output();--> statement-breakpoint

CREATE FUNCTION commit_legacy_entity_extraction_projection(
  source_letter_id uuid,
  previous_revision integer,
  committed_revision integer,
  extraction_json jsonb
) RETURNS void AS $$
BEGIN
  -- Rows inserted after this migration are already stamped with
  -- committed_revision. Promote matching pre-migration/prior-projection rows
  -- that the legacy binary encountered through ON CONFLICT DO NOTHING.
  UPDATE "letter_persons" AS link
  SET "entity_extraction_revision" = committed_revision
  FROM "canonical_persons" AS person
  WHERE link."letter_id" = source_letter_id
    AND link."person_id" = person."id"
    AND link."confirmed_at" IS NULL
    AND (
      link."entity_extraction_revision" IS NULL
      OR link."entity_extraction_revision" = previous_revision
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(extraction_json->'people') = 'array'
            THEN extraction_json->'people'
          ELSE '[]'::jsonb
        END
      ) AS extracted
      WHERE extracted->>'role' = link."role"::text
        AND (
          lower(btrim(extracted->>'name')) = lower(btrim(person."canonical_name"))
          OR lower(btrim(extracted->>'name')) = lower(btrim(COALESCE(link."name_as_written", '')))
          OR EXISTS (
            SELECT 1
            FROM unnest(COALESCE(person."aliases", ARRAY[]::text[])) AS alias
            WHERE lower(btrim(extracted->>'name')) = lower(btrim(alias))
          )
        )
    );

  UPDATE "letter_places" AS link
  SET "entity_extraction_revision" = committed_revision
  FROM "canonical_places" AS place
  WHERE link."letter_id" = source_letter_id
    AND link."place_id" = place."id"
    AND link."confirmed_at" IS NULL
    AND (
      link."entity_extraction_revision" IS NULL
      OR link."entity_extraction_revision" = previous_revision
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(extraction_json->'places') = 'array'
            THEN extraction_json->'places'
          ELSE '[]'::jsonb
        END
      ) AS extracted
      WHERE extracted->>'role' = link."role"::text
        AND (
          lower(btrim(extracted->>'name')) = lower(btrim(place."canonical_name"))
          OR lower(btrim(extracted->>'name')) = lower(btrim(COALESCE(link."name_as_written", '')))
          OR EXISTS (
            SELECT 1
            FROM unnest(COALESCE(place."aliases", ARRAY[]::text[])) AS alias
            WHERE lower(btrim(extracted->>'name')) = lower(btrim(alias))
          )
        )
    );

  UPDATE "person_relationships" AS relationship
  SET "entity_extraction_revision" = committed_revision
  FROM
    "canonical_persons" AS person_a,
    "canonical_persons" AS person_b
  WHERE relationship."discovered_in_letter_id" = source_letter_id
    AND relationship."person_a_id" = person_a."id"
    AND relationship."person_b_id" = person_b."id"
    AND relationship."confirmed_at" IS NULL
    AND (
      relationship."entity_extraction_revision" IS NULL
      OR relationship."entity_extraction_revision" = previous_revision
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(extraction_json->'relationships') = 'array'
            THEN extraction_json->'relationships'
          ELSE '[]'::jsonb
        END
      ) AS extracted
      WHERE extracted->>'relationship_type' = relationship."relationship_type"::text
        AND (
          (
            lower(btrim(extracted->>'person_a')) = lower(btrim(person_a."canonical_name"))
            AND lower(btrim(extracted->>'person_b')) = lower(btrim(person_b."canonical_name"))
          )
          OR (
            lower(btrim(extracted->>'person_a')) = lower(btrim(person_b."canonical_name"))
            AND lower(btrim(extracted->>'person_b')) = lower(btrim(person_a."canonical_name"))
          )
        )
    );

  UPDATE "entity_review_queue" AS item
  SET "entity_extraction_revision" = committed_revision
  WHERE item."letter_id" = source_letter_id
    AND item."status" = 'pending'
    AND (
      item."entity_extraction_revision" IS NULL
      OR item."entity_extraction_revision" = previous_revision
    )
    AND (
      (
        item."entity_type" = 'person'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(extraction_json->'people') = 'array'
                THEN extraction_json->'people'
              ELSE '[]'::jsonb
            END
          ) AS extracted
          WHERE lower(btrim(extracted->>'name')) = lower(btrim(item."extracted_text"))
        )
      )
      OR (
        item."entity_type" = 'place'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(extraction_json->'places') = 'array'
                THEN extraction_json->'places'
              ELSE '[]'::jsonb
            END
          ) AS extracted
          WHERE lower(btrim(extracted->>'name')) = lower(btrim(item."extracted_text"))
        )
      )
    );
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION discard_legacy_entity_extraction_projection(
  source_letter_id uuid,
  abandoned_revision integer
) RETURNS void AS $$
BEGIN
  -- A draining legacy producer may have committed child inserts before it
  -- failed or was cancelled. Remove only that uncommitted candidate revision;
  -- confirmed/human rows and the previous committed revision are untouched.
  DELETE FROM "letter_persons"
  WHERE "letter_id" = source_letter_id
    AND "entity_extraction_revision" = abandoned_revision
    AND "confirmed_at" IS NULL;

  DELETE FROM "letter_places"
  WHERE "letter_id" = source_letter_id
    AND "entity_extraction_revision" = abandoned_revision
    AND "confirmed_at" IS NULL;

  DELETE FROM "person_relationships"
  WHERE "discovered_in_letter_id" = source_letter_id
    AND "entity_extraction_revision" = abandoned_revision
    AND "confirmed_at" IS NULL;

  DELETE FROM "entity_review_queue"
  WHERE "letter_id" = source_letter_id
    AND "entity_extraction_revision" = abandoned_revision
    AND "status" = 'pending';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION enforce_entity_extraction_status_transition() RETURNS trigger AS $$
DECLARE
  next_revision integer;
BEGIN
  -- Old binaries may drain work they claimed before this migration, but may
  -- not create another tokenless attempt after the boundary is installed.
  IF NEW.entity_extraction_status = 'RUNNING'
    AND (TG_OP = 'INSERT' OR OLD.entity_extraction_status <> 'RUNNING')
    AND (
      NEW.entity_extraction_run_id IS NULL
      OR NEW.entity_extraction_run_revision IS NULL
    ) THEN
    RAISE EXCEPTION 'new entity extraction RUNNING transitions require ownership'
      USING ERRCODE = '23514',
            CONSTRAINT = 'entity_extraction_running_requires_owner';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.entity_extraction_status = 'RUNNING'
    AND OLD.entity_extraction_run_id IS NOT NULL
    AND NEW.entity_extraction_status = 'RUNNING'
    AND (
      NEW.entity_extraction_run_id IS DISTINCT FROM OLD.entity_extraction_run_id
      OR NEW.entity_extraction_run_revision IS DISTINCT FROM OLD.entity_extraction_run_revision
      OR NEW.entity_extraction_revision IS DISTINCT FROM OLD.entity_extraction_revision
      OR NEW.entity_extraction_json IS DISTINCT FROM OLD.entity_extraction_json
    ) THEN
    RAISE EXCEPTION 'owned entity extraction RUNNING attempts must preserve ownership and committed output'
      USING ERRCODE = '23514',
            CONSTRAINT = 'entity_extraction_running_owner_cannot_be_stripped';
  END IF;

  -- A draining old binary cannot write the revision fields. Commit its
  -- database-stamped output and JSON as one legacy revision in this statement.
  IF TG_OP = 'UPDATE'
    AND OLD.entity_extraction_status = 'RUNNING'
    AND OLD.entity_extraction_run_id IS NULL
    AND OLD.entity_extraction_run_revision IS NULL
    AND NEW.entity_extraction_status = 'SUCCESS' THEN
    IF NEW.entity_extraction_json IS NULL THEN
      RAISE EXCEPTION 'legacy entity extraction SUCCESS requires committed JSON'
        USING ERRCODE = '23514',
              CONSTRAINT = 'legacy_entity_extraction_success_requires_json';
    END IF;

    next_revision := OLD.entity_extraction_revision + 1;
    PERFORM commit_legacy_entity_extraction_projection(
      OLD.id,
      OLD.entity_extraction_revision,
      next_revision,
      NEW.entity_extraction_json
    );
    NEW.entity_extraction_revision := next_revision;
    NEW.entity_extraction_run_id := NULL;
    NEW.entity_extraction_run_revision := NULL;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.entity_extraction_status = 'RUNNING'
    AND OLD.entity_extraction_run_id IS NULL
    AND OLD.entity_extraction_run_revision IS NULL
    AND NEW.entity_extraction_status <> 'RUNNING'
    AND NEW.entity_extraction_status <> 'SUCCESS' THEN
    PERFORM discard_legacy_entity_extraction_projection(
      OLD.id,
      OLD.entity_extraction_revision + 1
    );
  END IF;

  -- A terminal write from an old executor that lost its RUNNING state must not
  -- resurrect itself after cancellation/supersession.
  IF TG_OP = 'UPDATE'
    AND OLD.entity_extraction_status <> 'RUNNING'
    AND NEW.entity_extraction_status = 'SUCCESS'
    AND (
      NEW.entity_extraction_status IS DISTINCT FROM OLD.entity_extraction_status
      OR NEW.entity_extraction_json IS DISTINCT FROM OLD.entity_extraction_json
    ) THEN
    RAISE EXCEPTION 'entity extraction SUCCESS requires the active RUNNING owner'
      USING ERRCODE = '23514',
            CONSTRAINT = 'entity_extraction_success_requires_running_owner';
  END IF;

  -- Current completions and supersessions clear the exact owner. SUCCESS also
  -- publishes exactly the revision reserved by that owner; failure preserves
  -- the previously committed revision.
  IF TG_OP = 'UPDATE'
    AND OLD.entity_extraction_status = 'RUNNING'
    AND OLD.entity_extraction_run_id IS NOT NULL
    AND NEW.entity_extraction_status <> 'RUNNING'
    AND NOT (
      NEW.entity_extraction_run_id IS NULL
      AND NEW.entity_extraction_run_revision IS NULL
      AND (
        (
          NEW.entity_extraction_status = 'SUCCESS'
          AND NEW.entity_extraction_revision = OLD.entity_extraction_run_revision
        )
        OR (
          NEW.entity_extraction_status <> 'SUCCESS'
          AND NEW.entity_extraction_revision = OLD.entity_extraction_revision
        )
      )
    ) THEN
    RAISE EXCEPTION 'owned entity extraction terminal transitions must clear and reconcile ownership'
      USING ERRCODE = '23514',
            CONSTRAINT = 'entity_extraction_terminal_requires_owner_reconciliation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER entity_extraction_status_transition_guard
  BEFORE INSERT OR UPDATE OF
    entity_extraction_status,
    entity_extraction_revision,
    entity_extraction_run_id,
    entity_extraction_run_revision,
    entity_extraction_json
  ON "letters"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_entity_extraction_status_transition();--> statement-breakpoint

-- Revision 0 is an immutable legacy projection. Only rows that can be matched
-- back to the stored extraction JSON receive that provenance; ambiguous NULL
-- rows remain intact for admins but are not trusted by public queries.
UPDATE "letter_persons" AS link
SET "entity_extraction_revision" = 0
FROM "letters" AS letter, "canonical_persons" AS person
WHERE link."letter_id" = letter."id"
  AND link."person_id" = person."id"
  AND link."confirmed_at" IS NULL
  AND letter."entity_extraction_json" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(letter."entity_extraction_json"->'people') = 'array'
          THEN letter."entity_extraction_json"->'people'
        ELSE '[]'::jsonb
      END
    ) AS extracted
    WHERE extracted->>'role' = link."role"::text
      AND (
        lower(btrim(extracted->>'name')) = lower(btrim(person."canonical_name"))
        OR lower(btrim(extracted->>'name')) = lower(btrim(COALESCE(link."name_as_written", '')))
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(person."aliases", ARRAY[]::text[])) AS alias
          WHERE lower(btrim(extracted->>'name')) = lower(btrim(alias))
        )
      )
  );--> statement-breakpoint

UPDATE "letter_places" AS link
SET "entity_extraction_revision" = 0
FROM "letters" AS letter, "canonical_places" AS place
WHERE link."letter_id" = letter."id"
  AND link."place_id" = place."id"
  AND link."confirmed_at" IS NULL
  AND letter."entity_extraction_json" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(letter."entity_extraction_json"->'places') = 'array'
          THEN letter."entity_extraction_json"->'places'
        ELSE '[]'::jsonb
      END
    ) AS extracted
    WHERE extracted->>'role' = link."role"::text
      AND (
        lower(btrim(extracted->>'name')) = lower(btrim(place."canonical_name"))
        OR lower(btrim(extracted->>'name')) = lower(btrim(COALESCE(link."name_as_written", '')))
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(place."aliases", ARRAY[]::text[])) AS alias
          WHERE lower(btrim(extracted->>'name')) = lower(btrim(alias))
        )
      )
  );--> statement-breakpoint

UPDATE "person_relationships" AS relationship
SET "entity_extraction_revision" = 0
FROM
  "letters" AS letter,
  "canonical_persons" AS person_a,
  "canonical_persons" AS person_b
WHERE relationship."discovered_in_letter_id" = letter."id"
  AND relationship."person_a_id" = person_a."id"
  AND relationship."person_b_id" = person_b."id"
  AND relationship."confirmed_at" IS NULL
  AND letter."entity_extraction_json" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(letter."entity_extraction_json"->'relationships') = 'array'
          THEN letter."entity_extraction_json"->'relationships'
        ELSE '[]'::jsonb
      END
    ) AS extracted
    WHERE extracted->>'relationship_type' = relationship."relationship_type"::text
      AND (
        (
          lower(btrim(extracted->>'person_a')) = lower(btrim(person_a."canonical_name"))
          AND lower(btrim(extracted->>'person_b')) = lower(btrim(person_b."canonical_name"))
        )
        OR (
          lower(btrim(extracted->>'person_a')) = lower(btrim(person_b."canonical_name"))
          AND lower(btrim(extracted->>'person_b')) = lower(btrim(person_a."canonical_name"))
        )
      )
  );--> statement-breakpoint

UPDATE "entity_review_queue" AS item
SET "entity_extraction_revision" = 0
FROM "letters" AS letter
WHERE item."letter_id" = letter."id"
  AND item."status" = 'pending'
  AND letter."entity_extraction_json" IS NOT NULL
  AND (
    (
      item."entity_type" = 'person'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(letter."entity_extraction_json"->'people') = 'array'
              THEN letter."entity_extraction_json"->'people'
            ELSE '[]'::jsonb
          END
        ) AS extracted
        WHERE lower(btrim(extracted->>'name')) = lower(btrim(item."extracted_text"))
      )
    )
    OR (
      item."entity_type" = 'place'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(letter."entity_extraction_json"->'places') = 'array'
              THEN letter."entity_extraction_json"->'places'
            ELSE '[]'::jsonb
          END
        ) AS extracted
        WHERE lower(btrim(extracted->>'name')) = lower(btrim(item."extracted_text"))
      )
    )
  );--> statement-breakpoint

CREATE INDEX "idx_letter_persons_extraction_revision"
  ON "letter_persons" ("letter_id", "entity_extraction_revision");--> statement-breakpoint
CREATE INDEX "idx_letter_places_extraction_revision"
  ON "letter_places" ("letter_id", "entity_extraction_revision");--> statement-breakpoint
CREATE INDEX "idx_person_rel_extraction_revision"
  ON "person_relationships" ("discovered_in_letter_id", "entity_extraction_revision");--> statement-breakpoint
CREATE INDEX "idx_review_queue_extraction_revision"
  ON "entity_review_queue" ("letter_id", "entity_extraction_revision");
