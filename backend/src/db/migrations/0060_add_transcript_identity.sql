ALTER TABLE "letters"
  ADD COLUMN "transcript_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "letters"
  ADD COLUMN "transcript_checksum_sha256" text
    DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    NOT NULL;
--> statement-breakpoint

-- PostgreSQL's built-in sha256(bytea) hashes the exact UTF-8 bytes without
-- requiring pgcrypto. NULL and the empty transcript share the empty-byte
-- checksum; the monotonic revision still records transitions between them.
UPDATE "letters"
SET "transcript_checksum_sha256" =
  encode(
    sha256(convert_to(COALESCE("transcription_text", ''), 'UTF8')),
    'hex'
  );
--> statement-breakpoint

ALTER TABLE "letters"
  ADD CONSTRAINT "transcript_revision_nonnegative"
  CHECK ("transcript_revision" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "letters"
  VALIDATE CONSTRAINT "transcript_revision_nonnegative";
--> statement-breakpoint
ALTER TABLE "letters"
  ADD CONSTRAINT "transcript_checksum_sha256_valid"
  CHECK ("transcript_checksum_sha256" ~ '^[0-9a-f]{64}$') NOT VALID;
--> statement-breakpoint
ALTER TABLE "letters"
  VALIDATE CONSTRAINT "transcript_checksum_sha256_valid";
--> statement-breakpoint

CREATE OR REPLACE FUNCTION maintain_letter_transcript_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.transcript_revision := 0;
    NEW.transcript_checksum_sha256 :=
      encode(
        sha256(convert_to(COALESCE(NEW.transcription_text, ''), 'UTF8')),
        'hex'
      );
  ELSIF OLD.transcription_text IS DISTINCT FROM NEW.transcription_text THEN
    NEW.transcript_revision := OLD.transcript_revision + 1;
    NEW.transcript_checksum_sha256 :=
      encode(
        sha256(convert_to(COALESCE(NEW.transcription_text, ''), 'UTF8')),
        'hex'
      );
  ELSE
    -- Transcript identity is database-owned. Unrelated updates and direct
    -- attempts to rewrite the identity cannot forge or advance it.
    NEW.transcript_revision := OLD.transcript_revision;
    NEW.transcript_checksum_sha256 := OLD.transcript_checksum_sha256;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER maintain_letter_transcript_identity
BEFORE INSERT OR UPDATE ON "letters"
FOR EACH ROW
EXECUTE FUNCTION maintain_letter_transcript_identity();
