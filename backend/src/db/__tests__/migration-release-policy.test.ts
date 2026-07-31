import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertMigrationReleaseAllowed,
  automaticMigrationBaselineTag,
  migrationReleasePolicies,
  type AppliedMigrationEntry,
  type MigrationJournalEntry,
} from '../migration-release-policy.js';

const migrationsDirectory = join(__dirname, '..', 'migrations');
const rawJournal = JSON.parse(
  readFileSync(
    join(migrationsDirectory, 'meta', '_journal.json'),
    'utf8',
  ),
) as { entries: Omit<MigrationJournalEntry, 'hash'>[] };
const journal: MigrationJournalEntry[] = rawJournal.entries.map((entry) => ({
  ...entry,
  hash: createHash('sha256')
    .update(readFileSync(join(migrationsDirectory, `${entry.tag}.sql`), 'utf8'))
    .digest('hex'),
}));
const baselineIndex = journal.findIndex(
  ({ tag }) => tag === automaticMigrationBaselineTag,
);
const maintenanceStartIndex = journal.findIndex(
  ({ tag }) => tag === '0054_add_page_source_revisions',
);

function appliedPrefix(count: number): AppliedMigrationEntry[] {
  return journal.slice(0, count).map(({ hash, when }) => ({
    createdAt: when,
    hash,
  }));
}

describe('migration release policy', () => {
  it('requires an explicit policy for every post-baseline migration', () => {
    expect(baselineIndex).toBeGreaterThanOrEqual(0);
    expect(
      journal
        .slice(baselineIndex + 1)
        .filter(({ tag }) => migrationReleasePolicies[tag] === undefined)
        .map(({ tag }) => tag),
    ).toEqual([]);
  });

  it('blocks automatic migration before the maintenance baseline', () => {
    expect(() => assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(maintenanceStartIndex),
      mode: 'automatic',
    })).toThrow(/controlled bootstrap deployment/);
  });

  it('allows the controlled maintenance release to cross the baseline', () => {
    expect(assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(maintenanceStartIndex),
      mode: 'maintenance',
    }).map(({ tag }) => tag)).toEqual([
      '0054_add_page_source_revisions',
      '0055_add_transcript_confirmation_intent',
      '0056_repair_extra_content_job_ownership',
      '0057_add_page_layout_v2',
      '0058_add_page_geometry_revisions',
      '0059_allow_page_geometry_revision_zero',
      '0060_add_transcript_identity',
      '0061_add_page_recognition_artifacts',
      '0062_version_page_recognition_evidence',
      '0063_add_page_geometry_proposals',
    ]);
  });

  it('allows an automatic release with no pending migrations after baseline', () => {
    expect(assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(journal.length),
      mode: 'automatic',
    })).toEqual([]);
  });

  it('allows the expand-only PageLayoutV2 migration during an automatic release', () => {
    const pageLayoutIndex = journal.findIndex(
      ({ tag }) => tag === '0057_add_page_layout_v2',
    );
    expect(assertMigrationReleaseAllowed({
      journal: journal.slice(0, pageLayoutIndex + 1),
      appliedMigrations: appliedPrefix(baselineIndex + 1),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0057_add_page_layout_v2',
    ]);
  });

  it('requires maintenance mode for the exact geometry-approval migration', () => {
    const geometryMigrationIndex = journal.findIndex(
      ({ tag }) => tag === '0058_add_page_geometry_revisions',
    );
    expect(() => assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(geometryMigrationIndex),
      mode: 'automatic',
    })).toThrow(/0058_add_page_geometry_revisions/);
  });

  it('allows the revision-zero constraint relaxation after geometry tables exist', () => {
    const revisionZeroIndex = journal.findIndex(
      ({ tag }) => tag === '0059_allow_page_geometry_revision_zero',
    );
    expect(assertMigrationReleaseAllowed({
      journal: journal.slice(0, revisionZeroIndex + 1),
      appliedMigrations: appliedPrefix(revisionZeroIndex),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0059_allow_page_geometry_revision_zero',
    ]);
  });

  it('allows database-owned transcript identity during an automatic release', () => {
    const transcriptIdentityIndex = journal.findIndex(
      ({ tag }) => tag === '0060_add_transcript_identity',
    );
    expect(assertMigrationReleaseAllowed({
      journal: journal.slice(0, transcriptIdentityIndex + 1),
      appliedMigrations: appliedPrefix(transcriptIdentityIndex),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0060_add_transcript_identity',
    ]);
  });

  it('allows append-only page recognition artifacts during an automatic release', () => {
    const artifactIndex = journal.findIndex(
      ({ tag }) => tag === '0061_add_page_recognition_artifacts',
    );
    expect(assertMigrationReleaseAllowed({
      journal: journal.slice(0, artifactIndex + 1),
      appliedMigrations: appliedPrefix(artifactIndex),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0061_add_page_recognition_artifacts',
    ]);
  });

  it('allows append-only geometry proposals during an automatic release', () => {
    expect(assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(journal.length - 1),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0063_add_page_geometry_proposals',
    ]);
  });

  it('allows strict v2 recognition evidence during an automatic release', () => {
    const evidenceIndex = journal.findIndex(
      ({ tag }) => tag === '0062_version_page_recognition_evidence',
    );
    expect(assertMigrationReleaseAllowed({
      journal: journal.slice(0, evidenceIndex + 1),
      appliedMigrations: appliedPrefix(evidenceIndex),
      mode: 'automatic',
    }).map(({ tag }) => tag)).toEqual([
      '0062_version_page_recognition_evidence',
    ]);
  });

  it('fails closed when a future migration lacks an automatic policy', () => {
    const last = journal.at(-1);
    if (!last) throw new Error('Expected a nonempty migration journal');
    expect(() => assertMigrationReleaseAllowed({
      journal: [
        ...journal,
        {
          idx: last.idx + 1,
          when: last.when + 86_400_000,
          tag: '0057_unclassified',
          hash: 'a'.repeat(64),
        },
      ],
      appliedMigrations: appliedPrefix(journal.length),
      mode: 'automatic',
    })).toThrow(/0057_unclassified/);
  });

  it('requires the exact baseline record instead of accepting the same row count', () => {
    const malformed = appliedPrefix(baselineIndex + 1);
    malformed[baselineIndex] = malformed[baselineIndex - 1];

    expect(() => assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: malformed,
      mode: 'automatic',
    })).toThrow(/ledger diverges/);
  });

  it.each([
    {
      name: 'missing applied row',
      mutate: (applied: AppliedMigrationEntry[]) => {
        applied.splice(10, 1);
        return applied;
      },
    },
    {
      name: 'out-of-order applied rows',
      mutate: (applied: AppliedMigrationEntry[]) => {
        [applied[10], applied[11]] = [applied[11], applied[10]];
        return applied;
      },
    },
    {
      name: 'wrong applied hash',
      mutate: (applied: AppliedMigrationEntry[]) => {
        applied[10] = {
          ...applied[10],
          hash: 'f'.repeat(64),
        };
        return applied;
      },
    },
  ])('rejects $name', ({ mutate }) => {
    expect(() => assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: mutate(appliedPrefix(journal.length)),
      mode: 'maintenance',
    })).toThrow(/ledger diverges/);
  });

  it('rejects non-increasing journal indexes', () => {
    const malformed = journal.map((entry) => ({ ...entry }));
    malformed[11].idx = malformed[10].idx;

    expect(() => assertMigrationReleaseAllowed({
      journal: malformed,
      appliedMigrations: [],
      mode: 'maintenance',
    })).toThrow(/indexes must be strictly increasing/);
  });

  it('rejects non-increasing journal timestamps', () => {
    const malformed = journal.map((entry) => ({ ...entry }));
    malformed[11].when = malformed[10].when;

    expect(() => assertMigrationReleaseAllowed({
      journal: malformed,
      appliedMigrations: [],
      mode: 'maintenance',
    })).toThrow(/timestamps must be strictly increasing/);
  });
});
