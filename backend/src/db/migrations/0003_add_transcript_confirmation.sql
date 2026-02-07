-- Add transcript confirmation fields
-- These fields gate metadata extraction - metadata is only extracted after transcript is confirmed

ALTER TABLE letters ADD COLUMN transcript_confirmed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE letters ADD COLUMN transcript_confirmed_by TEXT;
