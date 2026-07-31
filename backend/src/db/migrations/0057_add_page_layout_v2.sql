ALTER TABLE "letter_pages"
  ADD COLUMN "page_layout" jsonb;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD COLUMN "page_layout_checksum_sha256" text;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "page_layout_v2_envelope"
  CHECK (
    "page_layout" IS NULL
    OR (
      jsonb_typeof("page_layout") = 'object'
      AND COALESCE(
        "page_layout"->'schemaVersion' = '2'::jsonb,
        false
      )
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "page_layout_checksum_valid"
  CHECK (
    "page_layout_checksum_sha256" IS NULL
    OR "page_layout_checksum_sha256" ~ '^[0-9a-f]{64}$'
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "page_layout_checksum_presence"
  CHECK (
    ("page_layout" IS NULL)
    = ("page_layout_checksum_sha256" IS NULL)
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "page_layout_page_id_matches_row"
  CHECK (
    "page_layout" IS NULL
    OR "page_layout"->>'pageId' = "id"::text
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  ADD CONSTRAINT "page_layout_source_checksum_matches_row"
  CHECK (
    "page_layout" IS NULL
    OR (
      "checksum_sha256" IS NOT NULL
      AND COALESCE(
        "page_layout"#>>'{image,source,checksumSha256}',
        "page_layout"#>>'{image,checksumSha256}'
      ) = "checksum_sha256"
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letter_pages"
  VALIDATE CONSTRAINT "page_layout_v2_envelope";
--> statement-breakpoint
ALTER TABLE "letter_pages"
  VALIDATE CONSTRAINT "page_layout_checksum_valid";
--> statement-breakpoint
ALTER TABLE "letter_pages"
  VALIDATE CONSTRAINT "page_layout_checksum_presence";
--> statement-breakpoint
ALTER TABLE "letter_pages"
  VALIDATE CONSTRAINT "page_layout_page_id_matches_row";
--> statement-breakpoint
ALTER TABLE "letter_pages"
  VALIDATE CONSTRAINT "page_layout_source_checksum_matches_row";
