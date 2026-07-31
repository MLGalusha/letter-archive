INSERT INTO collections (id, collection_code)
VALUES (
  '60000000-0000-4000-8000-000000000000',
  'T60'
);

-- INSERT identity is database-owned even when a caller attempts to provide it.
INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence,
  transcription_text,
  transcript_revision,
  transcript_checksum_sha256
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000000',
  '19000101',
  'L',
  1,
  E'Café\n',
  99,
  repeat('f', 64)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '60000000-0000-4000-8000-000000000001'
      AND transcript_revision = 0
      AND transcript_checksum_sha256 =
        'ab4ff0780be67e1eef32bd012331f8896311f5fbe326c1d65dc542b99987aca3'
  ) THEN
    RAISE EXCEPTION 'insert did not create exact transcript identity';
  END IF;
END $$;

-- Unrelated writes and direct identity tampering do not advance or forge it.
UPDATE letters
SET notes = 'unrelated',
    transcript_revision = 88,
    transcript_checksum_sha256 = repeat('a', 64)
WHERE id = '60000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '60000000-0000-4000-8000-000000000001'
      AND transcript_revision = 0
      AND transcript_checksum_sha256 =
        'ab4ff0780be67e1eef32bd012331f8896311f5fbe326c1d65dc542b99987aca3'
  ) THEN
    RAISE EXCEPTION 'unrelated update changed transcript identity';
  END IF;
END $$;

-- Empty and NULL have the same empty-byte checksum but distinct revisions.
UPDATE letters
SET transcription_text = ''
WHERE id = '60000000-0000-4000-8000-000000000001';

UPDATE letters
SET transcription_text = NULL
WHERE id = '60000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '60000000-0000-4000-8000-000000000001'
      AND transcript_revision = 2
      AND transcript_checksum_sha256 =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  ) THEN
    RAISE EXCEPTION 'NULL/empty transitions did not advance transcript revision';
  END IF;
END $$;

UPDATE letters
SET transcription_text = 'Hi 👋'
WHERE id = '60000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM letters
    WHERE id = '60000000-0000-4000-8000-000000000001'
      AND transcript_revision = 3
      AND transcript_checksum_sha256 =
        '53598e5889aee1195046a92895a1abdda999aa7712d2233427ec522212fdc7f3'
  ) THEN
    RAISE EXCEPTION 'UTF-8 transcript update did not refresh exact identity';
  END IF;
END $$;
