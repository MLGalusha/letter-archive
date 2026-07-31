import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationReleasePolicies } from '../migration-release-policy.js';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0060_add_transcript_identity.sql',
  ),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  join(__dirname, '..', 'migrations', 'meta', '_journal.json'),
  'utf8',
)) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe('transcript identity migration', () => {
  it('registers the expand-only migration after the geometry lineage', () => {
    expect(journal.entries.find(({ tag }) => (
      tag === '0060_add_transcript_identity'
    ))).toMatchObject({
      idx: 60,
      tag: '0060_add_transcript_identity',
    });
    expect(migrationReleasePolicies['0060_add_transcript_identity'])
      .toBe('automatic');
  });

  it('owns transcript revision and exact UTF-8 checksum in the database', () => {
    expect(migration).toContain(
      'ADD COLUMN "transcript_revision" integer DEFAULT 0 NOT NULL',
    );
    expect(migration).toContain(
      'ADD COLUMN "transcript_checksum_sha256" text',
    );
    expect(migration).toContain('sha256(convert_to(COALESCE(');
    expect(migration).toContain(
      'OLD.transcription_text IS DISTINCT FROM NEW.transcription_text',
    );
    expect(migration).toContain(
      'NEW.transcript_revision := OLD.transcript_revision + 1',
    );
    expect(migration).toContain(
      'NEW.transcript_revision := OLD.transcript_revision',
    );
    expect(migration).toContain(
      'CREATE TRIGGER maintain_letter_transcript_identity',
    );
    expect(migration).not.toMatch(/CREATE\s+EXTENSION\s+pgcrypto/i);
    expect(migration).not.toMatch(/\bdigest\s*\(/i);
  });
});
