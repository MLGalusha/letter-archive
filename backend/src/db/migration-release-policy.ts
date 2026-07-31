export type MigrationReleaseMode = 'automatic' | 'maintenance';

export interface MigrationJournalEntry {
  idx: number;
  when: number;
  tag: string;
  hash: string;
}

export interface AppliedMigrationEntry {
  createdAt: number;
  hash: string;
}

/**
 * Production must cross this baseline through the one-time maintenance release
 * before ordinary rolling deployments may apply migrations automatically.
 */
export const automaticMigrationBaselineTag =
  '0056_repair_extra_content_job_ownership';

/**
 * Every migration after the automatic baseline must be classified explicitly.
 * "automatic" means expand-only and safe while the previous application
 * revision is still serving. "maintenance" requires a quiesced deployment.
 */
export const migrationReleasePolicies: Readonly<
  Record<string, MigrationReleaseMode>
> = Object.freeze({
  '0057_add_page_layout_v2': 'automatic',
  // Converts the old provenance-free trust bit into exact revision receipts.
  '0058_add_page_geometry_revisions': 'maintenance',
  // Expand-only relaxation needed before lazy revision-zero baselines.
  '0059_allow_page_geometry_revision_zero': 'automatic',
  // Adds database-owned transcript identity while remaining compatible with
  // application revisions that only write transcription_text.
  '0060_add_transcript_identity': 'automatic',
  // Append-only recognition evidence is additive and ignored by older
  // application revisions.
  '0061_add_page_recognition_artifacts': 'automatic',
  // Strict v2 evidence is additive; retained v1 rows remain readable only as
  // historical evidence and are excluded from production lookup.
  '0062_version_page_recognition_evidence': 'automatic',
  // Append-only rotation proposals and their review events are additive and
  // ignored by application revisions that predate geometry recovery.
  '0063_add_page_geometry_proposals': 'automatic',
});

function assertValidJournal(
  journal: readonly MigrationJournalEntry[],
): void {
  for (const [position, entry] of journal.entries()) {
    if (!Number.isInteger(entry.idx) || entry.idx < 0) {
      throw new Error(
        `Migration journal idx must be a nonnegative integer at position ${position}`,
      );
    }
    if (
      position > 0
      && entry.idx <= journal[position - 1].idx
    ) {
      throw new Error('Migration journal indexes must be strictly increasing');
    }
    if (!Number.isSafeInteger(entry.when) || entry.when < 0) {
      throw new Error(
        `Migration journal timestamp must be a nonnegative safe integer: ${entry.tag}`,
      );
    }
    if (
      position > 0
      && entry.when <= journal[position - 1].when
    ) {
      throw new Error('Migration journal timestamps must be strictly increasing');
    }
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      throw new Error(`Migration journal tag is invalid at position ${position}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.hash)) {
      throw new Error(`Migration journal hash is invalid: ${entry.tag}`);
    }
  }
}

export function pendingMigrationEntries(
  journal: readonly MigrationJournalEntry[],
  appliedMigrations: readonly AppliedMigrationEntry[],
): readonly MigrationJournalEntry[] {
  assertValidJournal(journal);

  if (appliedMigrations.length > journal.length) {
    throw new Error(
      `Database reports ${appliedMigrations.length} migrations, but the image contains only `
      + `${journal.length}`,
    );
  }

  for (const [position, applied] of appliedMigrations.entries()) {
    if (
      !Number.isSafeInteger(applied.createdAt)
      || applied.createdAt < 0
      || !/^[0-9a-f]{64}$/.test(applied.hash)
    ) {
      throw new Error(
        `Applied migration ledger entry is invalid at position ${position}`,
      );
    }

    const expected = journal[position];
    if (
      applied.createdAt !== expected.when
      || applied.hash !== expected.hash
    ) {
      throw new Error(
        `Applied migration ledger diverges at position ${position}; expected `
        + `${expected.tag} (${expected.when}, ${expected.hash}), found `
        + `(${applied.createdAt}, ${applied.hash})`,
      );
    }
  }

  return journal.slice(appliedMigrations.length);
}

export function assertMigrationReleaseAllowed(input: {
  journal: readonly MigrationJournalEntry[];
  appliedMigrations: readonly AppliedMigrationEntry[];
  mode: MigrationReleaseMode;
}): readonly MigrationJournalEntry[] {
  const { journal, appliedMigrations, mode } = input;
  const baselineIndex = journal.findIndex(
    ({ tag }) => tag === automaticMigrationBaselineTag,
  );

  if (baselineIndex < 0) {
    throw new Error(
      `Automatic migration baseline is missing from the journal: `
      + automaticMigrationBaselineTag,
    );
  }

  const pending = pendingMigrationEntries(journal, appliedMigrations);
  if (mode === 'maintenance') return pending;

  const baseline = journal[baselineIndex];
  const appliedBaseline = appliedMigrations[baselineIndex];
  if (
    !appliedBaseline
    || appliedBaseline.createdAt !== baseline.when
    || appliedBaseline.hash !== baseline.hash
  ) {
    throw new Error(
      'Production has not crossed the maintenance migration baseline; '
      + 'run the controlled bootstrap deployment',
    );
  }

  const unsafe = pending.filter(
    ({ tag }) => migrationReleasePolicies[tag] !== 'automatic',
  );
  if (unsafe.length > 0) {
    throw new Error(
      'Automatic deployment refused unclassified or maintenance migrations: '
      + unsafe.map(({ tag }) => tag).join(', '),
    );
  }

  return pending;
}
