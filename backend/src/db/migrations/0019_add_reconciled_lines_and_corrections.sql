ALTER TABLE letter_pages ADD COLUMN IF NOT EXISTS reconciled_lines jsonb;

CREATE TABLE IF NOT EXISTS line_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES letter_pages(id) ON DELETE CASCADE,
  letter_id UUID NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  collection_code TEXT,
  correction_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_output JSONB NOT NULL,
  corrected_bbox JSONB,
  corrected_is_deleted BOOLEAN,
  source_segment_ids JSONB NOT NULL,
  error_region_pixel_stats JSONB,
  page_context JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_line_corrections_page ON line_corrections(page_id);
CREATE INDEX IF NOT EXISTS idx_line_corrections_collection ON line_corrections(collection_code);
