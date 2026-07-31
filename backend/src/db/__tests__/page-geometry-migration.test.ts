import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationReleasePolicies } from '../migration-release-policy.js';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0058_add_page_geometry_revisions.sql',
  ),
  'utf8',
);
const revisionZeroMigration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0059_allow_page_geometry_revision_zero.sql',
  ),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  join(__dirname, '..', 'migrations', 'meta', '_journal.json'),
  'utf8',
)) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe('page geometry revision migration', () => {
  it('registers the maintenance schema and its expand-only baseline relaxation', () => {
    expect(journal.entries.find(({ tag }) => (
      tag === '0058_add_page_geometry_revisions'
    ))).toMatchObject({
      idx: 58,
      tag: '0058_add_page_geometry_revisions',
    });
    expect(journal.entries.find(({ tag }) => (
      tag === '0059_allow_page_geometry_revision_zero'
    ))).toMatchObject({
      idx: 59,
      tag: '0059_allow_page_geometry_revision_zero',
    });
    expect(migrationReleasePolicies['0058_add_page_geometry_revisions'])
      .toBe('maintenance');
    expect(migrationReleasePolicies['0059_allow_page_geometry_revision_zero'])
      .toBe('automatic');
  });

  it('preserves geometry while removing provenance-free legacy approval', () => {
    expect(migration).toContain('CREATE TABLE "page_geometry_revisions"');
    expect(migration).toContain('CREATE TABLE "page_geometry_review_events"');
    expect(migration).toContain('"geometry_snapshot" jsonb NOT NULL');
    expect(migration).toContain('"created_by" text NOT NULL');
    expect(migration).toContain('"reviewed_by" text NOT NULL');
    expect(migration).toMatch(
      /UPDATE "letter_pages"\s+SET "segment_trust_state" = 'unverified'/,
    );
    expect(migration).not.toMatch(/UPDATE "letter_pages"[\s\S]*"line_segments"\s*=/);
  });

  it('enforces exact approval identity and append-only page revision numbering', () => {
    expect(migration).toContain(
      '"page_geometry_revisions_page_source_revision_unique"',
    );
    expect(migration).toContain('"geometry_approval_matches_current"');
    expect(migration).toContain('"segment_trust_bound_to_geometry"');
    expect(migration).toContain(
      '"approved_geometry_checksum_sha256" = "geometry_checksum_sha256"',
    );
    expect(revisionZeroMigration).toContain(
      'CONSTRAINT "page_geometry_revision_nonnegative"',
    );
    expect(revisionZeroMigration).toContain('CHECK ("revision" >= 0)');
  });
});
