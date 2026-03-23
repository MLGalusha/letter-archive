-- Migration: Convert ai_notes from text to jsonb for structured notes
ALTER TABLE letters ALTER COLUMN ai_notes TYPE jsonb USING
  CASE WHEN ai_notes IS NULL THEN NULL
  ELSE '[]'::jsonb END;
