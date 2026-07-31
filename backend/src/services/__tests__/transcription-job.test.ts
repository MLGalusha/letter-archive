import { beforeEach, describe, expect, it, vi } from 'vitest';

const { randomUUIDMock, dbUpdateMock, updateSetMock, loggerWarnMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: randomUUIDMock }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  gt: vi.fn((field: unknown, value: unknown) => ({ kind: 'gt', field, value })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray) => ({
    kind: 'sql',
    text: Array.from(strings).join('?'),
  })),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ warn: loggerWarnMock })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    primarySourceRevision: 'letters.primarySourceRevision',
    workflow: 'letters.workflow',
    transcriptionStatus: 'letters.transcriptionStatus',
    transcriptionText: 'letters.transcriptionText',
    transcriptionError: 'letters.transcriptionError',
    transcriptionAttemptCount: 'letters.transcriptionAttemptCount',
    transcriptionRunId: 'letters.transcriptionRunId',
    transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
    transcriptionLeaseRunId: 'letters.transcriptionLeaseRunId',
    transcriptionClaimKind: 'letters.transcriptionClaimKind',
    metadataStatus: 'letters.metadataStatus',
    entityExtractionStatus: 'letters.entityExtractionStatus',
    deadLetter: 'letters.deadLetter',
    transcriptStatus: 'letters.transcriptStatus',
    dateRaw: 'letters.dateRaw',
  },
}));

import {
  claimQueuedTranscription,
  claimRequestedTranscription,
  cancelTranscriptionAttempt,
  completeTranscription,
  failTranscription,
  recoverExpiredTranscriptions,
  renewTranscriptionLease,
  withTranscriptionHeartbeat,
  type ObservedTranscriptionState,
} from '../letter/transcription-job.js';
import {
  DEVELOPMENT_STUB_PERSISTENCE_ERROR,
  DEVELOPMENT_STUB_TRANSCRIPTION_TEXT,
} from '../../ai/openai/transcription-stub.js';

interface TranscriptionRow {
  id: string;
  primarySourceRevision: number;
  workflow: 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED';
  transcriptionStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  transcriptionRunId: string | null;
  transcriptionLeaseExpiresAt: Date | null;
  transcriptionLeaseRunId: string | null;
  transcriptionClaimKind: 'QUEUED' | 'REQUESTED' | null;
  metadataStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  entityExtractionStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  transcribedAt: Date | null;
  deadLetter: boolean;
  transcriptStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  transcriptConfirmedAt: Date | null;
  transcriptConfirmedBy: string | null;
  transcriptVerifiedAt: Date | null;
  transcriptVerifiedBy: string | null;
  transcriptPublished: boolean;
  updatedAt: Date;
  dateRaw: string;
}

let row: TranscriptionRow;
let databaseNow: Date;
let returningError: Error | null;
let returningBarrier: Promise<void> | null;

function observed(overrides: Partial<ObservedTranscriptionState> = {}): ObservedTranscriptionState {
  return {
    primarySourceRevision: row.primarySourceRevision,
    status: row.transcriptionStatus,
    workflow: row.workflow,
    transcriptionText: row.transcriptionText,
    transcriptionError: row.transcriptionError,
    transcriptionAttemptCount: row.transcriptionAttemptCount,
    transcriptionLeaseExpiresAt: row.transcriptionLeaseExpiresAt,
    transcriptionLeaseRunId: row.transcriptionLeaseRunId,
    transcriptionClaimKind: row.transcriptionClaimKind,
    metadataStatus: row.metadataStatus,
    entityExtractionStatus: row.entityExtractionStatus,
    deadLetter: row.deadLetter,
    transcriptStatus: row.transcriptStatus,
    ...overrides,
  };
}

function sqlValue(value: unknown): Date | unknown {
  const expression = value as { kind?: string; text?: string };
  if (expression?.kind === 'sql' && expression.text?.includes('clock_timestamp()')) {
    return databaseNow;
  }
  return value;
}

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq' | 'gt' | 'isNotNull' | 'isNull' | 'lte';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (!clause.field) return false;
  const key = clause.field.slice('letters.'.length) as keyof TranscriptionRow;
  if (clause.kind === 'isNull') return row[key] === null;
  if (clause.kind === 'isNotNull') return row[key] !== null;
  if (clause.kind === 'eq') {
    if (typeof clause.value === 'string' && clause.value.startsWith('letters.')) {
      const valueKey = clause.value.slice('letters.'.length) as keyof TranscriptionRow;
      return row[key] === row[valueKey];
    }
    return row[key] === clause.value;
  }
  const actual = row[key];
  const expected = sqlValue(clause.value);
  if (!(actual instanceof Date) || !(expected instanceof Date)) return false;
  if (clause.kind === 'gt') return actual > expected;
  return clause.kind === 'lte' && actual <= expected;
}

function evaluatedUpdates(updates: Partial<TranscriptionRow>): Partial<TranscriptionRow> {
  return Object.fromEntries(Object.entries(updates).map(([key, value]) => {
    const expression = value as { kind?: string; text?: string };
    if (expression?.kind === 'sql' && expression.text?.includes("interval '5 minutes'")) {
      return [key, new Date(databaseNow.getTime() + 5 * 60_000)];
    }
    if (expression?.kind === 'sql' && expression.text?.includes('CASE')) {
      if (expression.text.includes("'TRANSCRIBING'")) {
        if (row.transcriptionLeaseRunId === row.transcriptionRunId) {
          return [key, row.transcriptionClaimKind === 'REQUESTED' ? row.workflow : 'UPLOADED'];
        }
        return [key, row.workflow === 'TRANSCRIBING' ? 'UPLOADED' : row.workflow];
      }
      return [key, row.transcriptionClaimKind === 'REQUESTED' ? row.workflow : 'UPLOADED'];
    }
    return [key, value];
  })) as Partial<TranscriptionRow>;
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<TranscriptionRow>) => ({
    where: (condition: unknown) => ({
      returning: async () => {
        if (returningBarrier) await returningBarrier;
        if (returningError) {
          const error = returningError;
          returningError = null;
          throw error;
        }
        if (!matches(condition)) return [];
        Object.assign(row, evaluatedUpdates(updates));
        return [{ id: row.id, dateRaw: row.dateRaw }];
      },
    }),
  }));
}

describe('transcription job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      id: 'letter-1',
      primarySourceRevision: 4,
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionText: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      transcribedAt: null,
      deadLetter: false,
      transcriptStatus: 'EMPTY',
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      dateRaw: '1944-01-01',
    };
    databaseNow = new Date('2026-07-17T12:00:00.000Z');
    returningError = null;
    returningBarrier = null;
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('claims exact eligible queued state and enters TRANSCRIBING with a run ID', async () => {
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toEqual({ runId: 'run-a' });

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      transcriptionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      transcriptionLeaseRunId: 'run-a',
      transcriptionClaimKind: 'QUEUED',
    });
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it('does not claim stale, malformed, dead-lettered, or non-upload queued state', async () => {
    await expect(claimQueuedTranscription(row.id, observed({
      transcriptionText: 'Stale snapshot',
    }))).resolves.toBeNull();
    await expect(claimQueuedTranscription(row.id, observed({
      transcriptionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
    }))).resolves.toBeNull();
    await expect(claimRequestedTranscription(row.id, observed({
      transcriptionClaimKind: 'REQUESTED',
    }))).resolves.toBeNull();

    const beforeBindingChange = observed();
    row.transcriptionLeaseRunId = 'old-run';
    await expect(claimQueuedTranscription(row.id, beforeBindingChange)).resolves.toBeNull();
    row.transcriptionLeaseRunId = null;

    row.deadLetter = true;
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();

    row.deadLetter = false;
    row.workflow = 'TRANSCRIBED';
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();

    expect(row.transcriptionStatus).toBe('PENDING');
    expect(row.transcriptionRunId).toBeNull();
    expect(row.transcriptionLeaseExpiresAt).toBeNull();
    expect(row.transcriptionClaimKind).toBeNull();
  });

  it('overwrites a fully bound stale lease tuple when claiming queued work', async () => {
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T11:00:00.000Z');
    row.transcriptionLeaseRunId = 'old-run';
    row.transcriptionClaimKind = 'REQUESTED';

    await expect(claimQueuedTranscription(row.id, observed())).resolves.toEqual({ runId: 'run-a' });

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      transcriptionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      transcriptionLeaseRunId: 'run-a',
      transcriptionClaimKind: 'QUEUED',
    });
  });

  it('overwrites binding-only residue left by an older terminal writer', async () => {
    row.transcriptionLeaseRunId = 'old-run';

    await expect(claimQueuedTranscription(row.id, observed())).resolves.toEqual({ runId: 'run-a' });

    expect(row).toMatchObject({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      transcriptionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      transcriptionLeaseRunId: 'run-a',
      transcriptionClaimKind: 'QUEUED',
    });
  });

  it('claims exact requested job state without invalidating existing reviewed content', async () => {
    row.workflow = 'TRANSCRIBED';
    row.transcriptionStatus = 'SUCCESS';
    row.transcriptionText = 'Existing transcript';
    row.transcriptionError = 'Old error';
    row.transcriptionAttemptCount = 2;
    row.deadLetter = true;
    row.transcriptStatus = 'VERIFIED';
    row.transcriptVerifiedAt = new Date('2026-07-16T12:00:00.000Z');
    row.transcriptVerifiedBy = 'admin';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T11:00:00.000Z');
    row.transcriptionClaimKind = 'QUEUED';

    await expect(claimRequestedTranscription(row.id, observed())).resolves.toEqual({
      runId: 'run-a',
    });

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      transcriptionLeaseExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
      transcriptionLeaseRunId: 'run-a',
      transcriptionClaimKind: 'REQUESTED',
      transcriptionText: 'Existing transcript',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: expect.any(Date),
      transcriptVerifiedBy: 'admin',
    });
  });

  it('blocks transcription claims while downstream stages run and fences requested races', async () => {
    row.metadataStatus = 'RUNNING';
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();
    await expect(claimRequestedTranscription(row.id, observed())).resolves.toBeNull();

    row.metadataStatus = 'PENDING';
    row.entityExtractionStatus = 'RUNNING';
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();
    await expect(claimRequestedTranscription(row.id, observed())).resolves.toBeNull();

    row.entityExtractionStatus = 'PENDING';
    const beforeMetadataRace = observed();
    row.metadataStatus = 'RUNNING';
    await expect(claimRequestedTranscription(row.id, beforeMetadataRace)).resolves.toBeNull();

    row.metadataStatus = 'PENDING';
    const beforeEntityRace = observed();
    row.entityExtractionStatus = 'RUNNING';
    await expect(claimRequestedTranscription(row.id, beforeEntityRace)).resolves.toBeNull();

    expect(row.transcriptionStatus).toBe('PENDING');
    expect(row.transcriptionRunId).toBeNull();
  });

  it('fences requested claim and publication to one primary source revision', async () => {
    const staleObservation = observed();
    row.primarySourceRevision = 5;

    await expect(
      claimRequestedTranscription(row.id, staleObservation),
    ).resolves.toBeNull();

    row.primarySourceRevision = 4;
    await expect(
      claimRequestedTranscription(row.id, observed()),
    ).resolves.toEqual({ runId: 'run-a' });
    row.primarySourceRevision = 5;

    await expect(
      completeTranscription(
        row.id,
        'run-a',
        { text: 'Stale transcript', isStub: false },
        4,
      ),
    ).resolves.toBe(false);
    expect(row.transcriptionText).toBeNull();
    expect(row.transcriptionStatus).toBe('RUNNING');
  });

  it('publishes success or failure only for the owning run ID', async () => {
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
    row.transcriptionLeaseRunId = 'run-a';
    row.transcriptionClaimKind = 'QUEUED';
    row.transcriptConfirmedAt = new Date('2026-07-16T12:00:00.000Z');
    row.transcriptConfirmedBy = 'reviewer-1';
    row.transcriptPublished = true;

    await expect(completeTranscription(
      row.id,
      'run-a',
      { text: 'Dear family', isStub: false },
    )).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionText: 'Dear family',
      transcriptStatus: 'AI_DRAFT',
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
    });

    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-b';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
    row.transcriptionLeaseRunId = 'run-b';
    row.transcriptionClaimKind = 'QUEUED';
    await expect(failTranscription(row.id, 'run-a', 'late failure')).resolves.toBe(false);
    expect(row.transcriptionStatus).toBe('RUNNING');
    expect(row.transcriptionRunId).toBe('run-b');
  });

  it('refuses stub provenance and the known legacy stub before any database write', async () => {
    await expect(completeTranscription(
      row.id,
      'run-a',
      { text: 'Development preview', isStub: true },
    )).rejects.toThrow(DEVELOPMENT_STUB_PERSISTENCE_ERROR);
    await expect(completeTranscription(
      row.id,
      'run-a',
      { text: DEVELOPMENT_STUB_TRANSCRIPTION_TEXT, isStub: false },
    )).rejects.toThrow(DEVELOPMENT_STUB_PERSISTENCE_ERROR);

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      transcriptionStatus: 'PENDING',
      transcriptionText: null,
      transcriptStatus: 'EMPTY',
    });
  });

  it('prevents a cancelled attempt from publishing into a retried run', async () => {
    randomUUIDMock.mockReturnValueOnce('run-a').mockReturnValueOnce('run-b');
    const firstClaim = await claimQueuedTranscription(row.id, observed());
    expect(firstClaim).toEqual({ runId: 'run-a' });

    row.transcriptionStatus = 'FAILED';
    row.transcriptionRunId = null;
    row.transcriptionLeaseExpiresAt = null;
    row.transcriptionClaimKind = null;
    row.workflow = 'UPLOADED';
    row.transcriptionStatus = 'PENDING';

    const secondClaim = await claimQueuedTranscription(row.id, observed());
    expect(secondClaim).toEqual({ runId: 'run-b' });

    await expect(completeTranscription(
      row.id,
      'run-a',
      { text: 'Old content', isStub: false },
    )).resolves.toBe(false);
    expect(row).toMatchObject({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-b',
      transcriptionText: null,
    });

    await expect(completeTranscription(
      row.id,
      'run-b',
      { text: null, isStub: false },
    )).resolves.toBe(true);
    expect(row).toMatchObject({
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionText: null,
      transcriptStatus: 'EMPTY',
    });
  });

  it('requires a live lease for terminal writes but lets exact-run cancellation revoke expiry', async () => {
    row.workflow = 'TRANSCRIBING';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T11:59:59.000Z');
    row.transcriptionLeaseRunId = 'run-a';
    row.transcriptionClaimKind = 'QUEUED';

    await expect(completeTranscription(
      row.id,
      'run-a',
      { text: 'Too late', isStub: false },
    )).resolves.toBe(false);
    await expect(failTranscription(row.id, 'run-a', 'Too late')).resolves.toBe(false);
    await expect(cancelTranscriptionAttempt(row.id, 'run-a')).resolves.toBe(true);

    expect(row).toMatchObject({
      workflow: 'UPLOADED',
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Cancelled by admin',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });
  });

  it('never auto-recovers a legacy unleased run but lets an exact admin cancellation revoke it', async () => {
    row.workflow = 'TRANSCRIBING';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'legacy-run';

    await expect(recoverExpiredTranscriptions()).resolves.toEqual({ requeued: [], failed: [] });
    expect(row).toMatchObject({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'legacy-run',
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });

    await expect(cancelTranscriptionAttempt(row.id, 'different-run')).resolves.toBe(false);
    expect(row.transcriptionStatus).toBe('RUNNING');

    await expect(cancelTranscriptionAttempt(row.id, 'legacy-run')).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'UPLOADED',
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Cancelled by admin',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });
  });

  it('does not renew or publish a replacement run that inherited another run lease', async () => {
    row.workflow = 'TRANSCRIBING';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'replacement-run';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
    row.transcriptionLeaseRunId = 'original-run';
    row.transcriptionClaimKind = 'QUEUED';

    await expect(renewTranscriptionLease(row.id, 'replacement-run')).resolves.toBe(false);
    await expect(
      completeTranscription(
        row.id,
        'replacement-run',
        { text: 'Inherited lease publication', isStub: false },
      ),
    ).resolves.toBe(false);
    await expect(
      failTranscription(row.id, 'replacement-run', 'Inherited lease failure'),
    ).resolves.toBe(false);

    expect(row).toMatchObject({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'replacement-run',
      transcriptionLeaseRunId: 'original-run',
      transcriptionText: null,
    });
  });

  it('does not recover a replacement run under inherited metadata but allows exact cancellation', async () => {
    row.workflow = 'TRANSCRIBING';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'replacement-run';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T11:00:00.000Z');
    row.transcriptionLeaseRunId = 'original-run';
    row.transcriptionClaimKind = 'QUEUED';

    await expect(recoverExpiredTranscriptions()).resolves.toEqual({
      requeued: [],
      failed: [],
    });
    expect(row.transcriptionStatus).toBe('RUNNING');

    row.workflow = 'TRANSCRIBED';
    row.transcriptionClaimKind = 'REQUESTED';
    await expect(recoverExpiredTranscriptions()).resolves.toEqual({
      requeued: [],
      failed: [],
    });
    expect(row.transcriptionStatus).toBe('RUNNING');

    await expect(cancelTranscriptionAttempt(row.id, 'replacement-run')).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });
  });

  it.each([
    {
      actualIntent: 'requested',
      workflow: 'TRANSCRIBED',
      inheritedClaimKind: 'QUEUED',
      expectedWorkflow: 'TRANSCRIBED',
    },
    {
      actualIntent: 'queued',
      workflow: 'TRANSCRIBING',
      inheritedClaimKind: 'REQUESTED',
      expectedWorkflow: 'UPLOADED',
    },
  ] as const)(
    'cancels a mismatched $actualIntent replacement without trusting inherited intent',
    async ({ workflow, inheritedClaimKind, expectedWorkflow }) => {
      row.workflow = workflow;
      row.transcriptionStatus = 'RUNNING';
      row.transcriptionRunId = 'replacement-run';
      row.transcriptionLeaseExpiresAt = new Date('2026-07-17T11:00:00.000Z');
      row.transcriptionLeaseRunId = 'original-run';
      row.transcriptionClaimKind = inheritedClaimKind;

      await expect(cancelTranscriptionAttempt(row.id, 'replacement-run')).resolves.toBe(true);

      expect(row).toMatchObject({
        workflow: expectedWorkflow,
        transcriptionStatus: 'FAILED',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
      });
    },
  );

  it('preserves requested workflow and content when failure revokes its live lease', async () => {
    row.workflow = 'TRANSCRIBED';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
    row.transcriptionLeaseRunId = 'run-a';
    row.transcriptionClaimKind = 'REQUESTED';
    row.transcriptionText = 'Reviewed text';
    row.transcriptStatus = 'VERIFIED';

    await expect(failTranscription(row.id, 'run-a', 'Provider failed')).resolves.toBe(true);

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Provider failed',
      transcriptionText: 'Reviewed text',
      transcriptStatus: 'VERIFIED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });
  });

  it('renews from the PostgreSQL clock without changing updatedAt', async () => {
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:01:00.000Z');
    row.transcriptionLeaseRunId = 'run-a';
    row.transcriptionClaimKind = 'QUEUED';
    const visibleUpdatedAt = row.updatedAt;

    databaseNow = new Date('2026-07-17T12:00:30.000Z');
    await expect(renewTranscriptionLease(row.id, 'run-a')).resolves.toBe(true);

    expect(row.transcriptionLeaseExpiresAt).toEqual(new Date('2026-07-17T12:05:30.000Z'));
    expect(row.updatedAt).toBe(visibleUpdatedAt);

    databaseNow = new Date('2026-07-17T12:06:00.000Z');
    await expect(renewTranscriptionLease(row.id, 'run-a')).resolves.toBe(false);
  });

  it('heartbeats immediately, retries database errors, and reports authoritative ownership loss', async () => {
    vi.useFakeTimers();
    try {
      row.transcriptionStatus = 'RUNNING';
      row.transcriptionRunId = 'run-a';
      row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
      row.transcriptionLeaseRunId = 'run-a';
      row.transcriptionClaimKind = 'QUEUED';
      returningError = new Error('database unavailable');

      let finishOperation!: () => void;
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve;
      });
      let heartbeat: { hasOwnership(): boolean } | undefined;

      const running = withTranscriptionHeartbeat(row.id, 'run-a', async (activeHeartbeat) => {
        heartbeat = activeHeartbeat;
        await operationDone;
        return 'done';
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ letterId: row.id, runId: 'run-a' }),
        'Failed to renew transcription lease; will retry',
      );
      expect(heartbeat?.hasOwnership()).toBe(true);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(row.transcriptionLeaseExpiresAt).toEqual(new Date('2026-07-17T12:05:00.000Z'));

      row.transcriptionRunId = 'replacement-run';
      await vi.advanceTimersByTimeAsync(30_000);
      expect(heartbeat?.hasOwnership()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      finishOperation();
      await expect(running).resolves.toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes slow renewals and clears the timer after normal completion', async () => {
    vi.useFakeTimers();
    try {
      row.transcriptionStatus = 'RUNNING';
      row.transcriptionRunId = 'run-a';
      row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:05:00.000Z');
      row.transcriptionLeaseRunId = 'run-a';
      row.transcriptionClaimKind = 'QUEUED';

      let releaseRenewal!: () => void;
      returningBarrier = new Promise<void>((resolve) => {
        releaseRenewal = resolve;
      });
      let finishOperation!: () => void;
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve;
      });

      const running = withTranscriptionHeartbeat(row.id, 'run-a', async () => {
        await operationDone;
      });

      await vi.advanceTimersByTimeAsync(90_000);
      expect(dbUpdateMock).toHaveBeenCalledTimes(1);

      releaseRenewal();
      await vi.advanceTimersByTimeAsync(0);
      finishOperation();
      await running;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers only expired lease tuples with claim-kind-specific policy', async () => {
    row.workflow = 'TRANSCRIBING';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:01:00.000Z');
    row.transcriptionLeaseRunId = 'run-a';
    row.transcriptionClaimKind = 'QUEUED';

    await expect(recoverExpiredTranscriptions()).resolves.toEqual({
      requeued: [],
      failed: [],
    });

    databaseNow = new Date('2026-07-17T12:01:00.000Z');
    await expect(recoverExpiredTranscriptions()).resolves.toEqual({
      requeued: [{ id: row.id, dateRaw: row.dateRaw }],
      failed: [],
    });
    expect(row).toMatchObject({
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });

    row.workflow = 'TRANSCRIBED';
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-b';
    row.transcriptionLeaseExpiresAt = new Date('2026-07-17T12:00:00.000Z');
    row.transcriptionLeaseRunId = 'run-b';
    row.transcriptionClaimKind = 'REQUESTED';
    row.transcriptionText = 'Reviewed text';

    await expect(recoverExpiredTranscriptions()).resolves.toEqual({
      requeued: [],
      failed: [{ id: row.id, dateRaw: row.dateRaw }],
    });
    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Transcription lease expired before the attempt completed',
      transcriptionText: 'Reviewed text',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
    });
  });
});
