ALTER TABLE letters ADD COLUMN flagged boolean NOT NULL DEFAULT false;
ALTER TABLE letters ADD COLUMN flagged_at timestamptz;
ALTER TABLE letters ADD COLUMN flagged_by text;
CREATE INDEX idx_letters_flagged ON letters (flagged) WHERE flagged = true;
