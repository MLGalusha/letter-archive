-- GIN indexes for array and JSONB columns
CREATE INDEX IF NOT EXISTS idx_letters_tags_gin ON letters USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_letters_metadata_json_gin ON letters USING GIN (metadata_json);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DO $$ BEGIN
  CREATE TRIGGER trg_letters_updated_at
  BEFORE UPDATE ON letters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_pages_updated_at
  BEFORE UPDATE ON letter_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
