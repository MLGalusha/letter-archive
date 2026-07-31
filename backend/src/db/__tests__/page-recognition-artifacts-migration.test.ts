import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationReleasePolicies } from '../migration-release-policy.js';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0061_add_page_recognition_artifacts.sql',
  ),
  'utf8',
);
const evidenceMigration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0062_version_page_recognition_evidence.sql',
  ),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  join(__dirname, '..', 'migrations', 'meta', '_journal.json'),
  'utf8',
)) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe('page recognition artifact migration', () => {
  it('registers one automatic additive migration after transcript identity', () => {
    expect(journal.entries.find(({ tag }) => (
      tag === '0061_add_page_recognition_artifacts'
    ))).toMatchObject({
      idx: 61,
      tag: '0061_add_page_recognition_artifacts',
    });
    expect(
      migrationReleasePolicies['0061_add_page_recognition_artifacts'],
    ).toBe('automatic');
  });

  it('persists exact projection, profile, artifact, and per-record evidence', () => {
    expect(migration).toContain(
      'CREATE TABLE "page_recognition_artifacts"',
    );
    expect(migration).toContain('"artifact" jsonb NOT NULL');
    expect(migration).toContain('"line_segments_checksum_sha256" text NOT NULL');
    expect(migration).toContain(
      '"alignment_segment_input_checksum_sha256" text NOT NULL',
    );
    expect(migration).toContain(
      '"page_recognition_artifacts_checksum_unique"',
    );
    expect(migration).toContain(
      '"page_recognition_artifact_identity_matches"',
    );
    expect(migration).toContain(
      `"artifact"#>>'{source,lineSegmentsChecksumSha256}'`,
    );
    expect(migration).toContain(
      'CHECK (jsonb_typeof("artifact"->\'records\') = \'array\')',
    );
    expect(migration).not.toMatch(/UPDATE\s+"page_recognition_artifacts"/i);
  });

  it('versions richer evidence without rewriting retained v1 rows', () => {
    expect(journal.entries.find(({ tag }) => (
      tag === '0062_version_page_recognition_evidence'
    ))).toMatchObject({
      idx: 62,
      tag: '0062_version_page_recognition_evidence',
    });
    expect(
      migrationReleasePolicies['0062_version_page_recognition_evidence'],
    ).toBe('automatic');
    expect(evidenceMigration).toContain(
      'CHECK ("schema_version" IN (1, 2))',
    );
    expect(evidenceMigration).toContain(
      '"page_recognition_v2_evidence_valid"',
    );
    expect(evidenceMigration).not.toMatch(
      /UPDATE\s+"page_recognition_artifacts"/i,
    );
    expect(evidenceMigration).not.toMatch(
      /DELETE\s+FROM\s+"page_recognition_artifacts"/i,
    );
  });

  it('keeps every source and model digest constrained to lowercase SHA-256', () => {
    for (const [constraint, column] of [
      ['artifact_checksum_valid', 'artifact_checksum_sha256'],
      ['source_checksum_valid', 'source_checksum_sha256'],
      ['geometry_checksum_valid', 'geometry_checksum_sha256'],
      ['line_segments_checksum_valid', 'line_segments_checksum_sha256'],
      [
        'alignment_input_checksum_valid',
        'alignment_segment_input_checksum_sha256',
      ],
      ['profile_checksum_valid', 'profile_checksum_sha256'],
      ['model_checksum_valid', 'model_checksum_sha256'],
      ['config_checksum_valid', 'config_checksum_sha256'],
    ]) {
      expect(migration).toContain(
        `CONSTRAINT "page_recognition_${constraint}"\n`
        + `    CHECK ("${column}" ~ '^[0-9a-f]{64}$')`,
      );
    }
  });
});
