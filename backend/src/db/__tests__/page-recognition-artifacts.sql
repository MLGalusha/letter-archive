INSERT INTO collections (id, collection_code)
VALUES (
  '61000000-0000-4000-8000-000000000000',
  'T61'
);

INSERT INTO letters (
  id,
  collection_id,
  date_raw,
  type,
  type_sequence
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000000',
  '19000101',
  'L',
  1
);

INSERT INTO letter_pages (
  id,
  letter_id,
  page_number,
  storage_path,
  original_filename,
  checksum_sha256
) VALUES (
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  1,
  'test/page.jpg',
  'T61-19000101-L01-01.jpg',
  repeat('a', 64)
);

INSERT INTO page_recognition_artifacts (
  id,
  page_id,
  artifact_checksum_sha256,
  schema_version,
  primary_source_revision,
  source_checksum_sha256,
  geometry_revision,
  geometry_checksum_sha256,
  line_segments_checksum_sha256,
  alignment_segment_input_checksum_sha256,
  profile_checksum_sha256,
  engine,
  engine_version,
  model_name,
  model_checksum_sha256,
  config_checksum_sha256,
  state,
  artifact,
  created_at
) VALUES (
  '61000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000002',
  repeat('1', 64),
  1,
  0,
  repeat('a', 64),
  0,
  repeat('b', 64),
  repeat('c', 64),
  repeat('4', 64),
  repeat('d', 64),
  'kraken',
  '7.0.3',
  'McCATMuS',
  repeat('e', 64),
  repeat('f', 64),
  'completed',
  jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'page-line-recognition',
    'pageId', '61000000-0000-4000-8000-000000000002',
    'source', jsonb_build_object(
      'primarySourceRevision', 0,
      'sourceChecksumSha256', repeat('a', 64),
      'geometryRevision', 0,
      'geometryChecksumSha256', repeat('b', 64),
      'lineSegmentsChecksumSha256', repeat('c', 64),
      'alignmentSegmentInputChecksumSha256', repeat('4', 64)
    ),
    'profile', jsonb_build_object(
      'profileChecksumSha256', repeat('d', 64),
      'engine', 'kraken',
      'engineVersion', '7.0.3',
      'modelName', 'McCATMuS',
      'modelChecksumSha256', repeat('e', 64),
      'configChecksumSha256', repeat('f', 64)
    ),
    'state', 'completed',
    'records', jsonb_build_array(jsonb_build_object(
      'segmentId', 'legacy:0:1',
      'segmentGeometryChecksumSha256', repeat('9', 64),
      'text', 'rough text',
      'meanConfidence', 0.8,
      'state', 'recognized',
      'binding', jsonb_build_object(
        'kind', 'exact-current-input',
        'adapter', 'direct-baseline'
      )
    )),
    'createdAt', '2026-07-30T12:00:00.000Z'
  ),
  '2026-07-30T12:00:00.000Z'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM page_recognition_artifacts
    WHERE id = '61000000-0000-4000-8000-000000000003'
      AND artifact#>>'{records,0,segmentGeometryChecksumSha256}'
        = repeat('9', 64)
      AND artifact#>>'{source,lineSegmentsChecksumSha256}'
        = line_segments_checksum_sha256
  ) THEN
    RAISE EXCEPTION 'recognition artifact lost exact record/source evidence';
  END IF;

  BEGIN
    INSERT INTO page_recognition_artifacts (
      page_id,
      artifact_checksum_sha256,
      schema_version,
      primary_source_revision,
      source_checksum_sha256,
      geometry_revision,
      geometry_checksum_sha256,
      line_segments_checksum_sha256,
      alignment_segment_input_checksum_sha256,
      profile_checksum_sha256,
      engine,
      engine_version,
      model_name,
      model_checksum_sha256,
      config_checksum_sha256,
      state,
      artifact,
      created_at
    )
    SELECT
      page_id,
      repeat('2', 64),
      schema_version,
      primary_source_revision,
      source_checksum_sha256,
      geometry_revision,
      geometry_checksum_sha256,
      repeat('8', 64),
      alignment_segment_input_checksum_sha256,
      profile_checksum_sha256,
      engine,
      engine_version,
      model_name,
      model_checksum_sha256,
      config_checksum_sha256,
      state,
      artifact,
      created_at
    FROM page_recognition_artifacts
    WHERE id = '61000000-0000-4000-8000-000000000003';

    RAISE EXCEPTION 'mismatched artifact envelope unexpectedly persisted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
