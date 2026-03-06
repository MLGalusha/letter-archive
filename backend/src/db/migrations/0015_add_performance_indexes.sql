-- Add missing indexes for performance optimization
-- Checksum lookup for file deduplication during uploads
CREATE INDEX IF NOT EXISTS idx_pages_checksum ON letter_pages USING btree (checksum_sha256);

-- Composite index for person+role queries (sync, merge, stats)
CREATE INDEX IF NOT EXISTS idx_letter_persons_person_role ON letter_persons USING btree (person_id, role);

-- Composite index for place+role queries (sync, merge, stats)
CREATE INDEX IF NOT EXISTS idx_letter_places_place_role ON letter_places USING btree (place_id, role);

-- Index for bulk relationship cleanup by letter
CREATE INDEX IF NOT EXISTS idx_person_rel_discovered ON person_relationships USING btree (discovered_in_letter_id);
