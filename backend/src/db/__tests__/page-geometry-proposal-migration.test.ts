import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationReleasePolicies } from '../migration-release-policy.js';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    'migrations',
    '0063_add_page_geometry_proposals.sql',
  ),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  join(__dirname, '..', 'migrations', 'meta', '_journal.json'),
  'utf8',
)) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

describe('page geometry proposal migration', () => {
  it('registers an automatic additive migration', () => {
    expect(journal.entries.find(({ tag }) => (
      tag === '0063_add_page_geometry_proposals'
    ))).toMatchObject({
      idx: 63,
      tag: '0063_add_page_geometry_proposals',
    });
    expect(
      migrationReleasePolicies['0063_add_page_geometry_proposals'],
    ).toBe('automatic');
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
  });

  it('fails closed when required artifact identity is absent', () => {
    expect(migration).toMatch(
      /page_geometry_proposal_candidate_count_matches[\s\S]*?\) IS TRUE/,
    );
    expect(migration).toMatch(
      /page_geometry_proposal_artifact_identity_matches[\s\S]*?\) IS TRUE/,
    );
    expect(migration).toContain('!exists(@.ocrText)');
    expect(migration).toContain('!exists(@.bbox)');
    expect(migration).toContain(
      '!exists(@.geometryProvenance.operation)',
    );
    expect(migration).toContain(
      '!exists(@.geometryProvenance.parentSegmentIds)',
    );
  });

  it('makes evidence immutable but preserves owning-page cascade erasure', () => {
    expect(migration).toContain(
      'CREATE FUNCTION protect_page_geometry_proposal_history()',
    );
    expect(migration).toContain(
      "TG_OP = 'UPDATE'",
    );
    expect(migration).toContain(
      "TG_OP = 'DELETE' AND pg_trigger_depth() = 1",
    );
    expect(migration).toContain(
      'CREATE TRIGGER page_geometry_proposals_immutable',
    );
    expect(migration).toContain(
      'CREATE TRIGGER page_geometry_proposal_events_immutable',
    );
  });
});
