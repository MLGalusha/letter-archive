ALTER TABLE letters ADD COLUMN transcript_published boolean NOT NULL DEFAULT false;
ALTER TABLE letters ADD COLUMN metadata_published boolean NOT NULL DEFAULT false;

-- Backfill: published + verified → content published
UPDATE letters SET transcript_published = true
WHERE visibility = 'PUBLISHED' AND transcript_status = 'VERIFIED';

UPDATE letters SET metadata_published = true
WHERE visibility = 'PUBLISHED' AND metadata_content_status = 'VERIFIED';
