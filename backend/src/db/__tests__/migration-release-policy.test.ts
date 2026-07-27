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
    ]);
  });

  it('allows an automatic release with no pending migrations after baseline', () => {
    expect(assertMigrationReleaseAllowed({
      journal,
      appliedMigrations: appliedPrefix(journal.length),
      mode: 'automatic',
    })).toEqual([]);
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
