import { beforeEach, describe, expect, it, vi } from 'vitest';

const { randomUUIDMock, dbUpdateMock, updateSetMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: randomUUIDMock }));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
}));

vi.mock('../../db/index.js', () => ({
  db: { update: dbUpdateMock },
  letters: {
    id: 'letters.id',
    workflow: 'letters.workflow',
    transcriptionStatus: 'letters.transcriptionStatus',
    transcriptionText: 'letters.transcriptionText',
    transcriptionError: 'letters.transcriptionError',
    transcriptionAttemptCount: 'letters.transcriptionAttemptCount',
    transcriptionRunId: 'letters.transcriptionRunId',
    deadLetter: 'letters.deadLetter',
    transcriptStatus: 'letters.transcriptStatus',
  },
}));

import {
  claimQueuedTranscription,
  claimRequestedTranscription,
  completeTranscription,
  failTranscription,
  type ObservedTranscriptionState,
} from '../letter/transcription-job.js';

interface TranscriptionRow {
  id: string;
  workflow: 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED';
  transcriptionStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  transcriptionRunId: string | null;
  transcribedAt: Date | null;
  deadLetter: boolean;
  transcriptStatus: 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';
  transcriptVerifiedAt: Date | null;
  transcriptVerifiedBy: string | null;
  updatedAt: Date;
}

let row: TranscriptionRow;

function observed(overrides: Partial<ObservedTranscriptionState> = {}): ObservedTranscriptionState {
  return {
    status: row.transcriptionStatus,
    workflow: row.workflow,
    transcriptionText: row.transcriptionText,
    transcriptionError: row.transcriptionError,
    transcriptionAttemptCount: row.transcriptionAttemptCount,
    deadLetter: row.deadLetter,
    transcriptStatus: row.transcriptStatus,
    ...overrides,
  };
}

function matches(condition: unknown): boolean {
  const clause = condition as {
    kind: 'and' | 'eq' | 'isNull';
    clauses?: unknown[];
    field?: string;
    value?: unknown;
  };
  if (clause.kind === 'and') return clause.clauses?.every(matches) ?? false;
  if (!clause.field) return false;
  const key = clause.field.slice('letters.'.length) as keyof TranscriptionRow;
  if (clause.kind === 'isNull') return row[key] === null;
  return clause.kind === 'eq' && row[key] === clause.value;
}

function installStatefulDatabase() {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation((updates: Partial<TranscriptionRow>) => ({
    where: (condition: unknown) => ({
      returning: async () => {
        if (!matches(condition)) return [];
        Object.assign(row, updates);
        return [{ id: row.id }];
      },
    }),
  }));
}

describe('transcription job lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = {
      id: 'letter-1',
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionText: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      transcriptionRunId: null,
      transcribedAt: null,
      deadLetter: false,
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    randomUUIDMock.mockReturnValue('run-a');
    installStatefulDatabase();
  });

  it('claims exact eligible queued state and enters TRANSCRIBING with a run ID', async () => {
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toEqual({ runId: 'run-a' });

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it('does not claim stale, dead-lettered, or non-upload queued state', async () => {
    await expect(claimQueuedTranscription(row.id, observed({
      transcriptionText: 'Stale snapshot',
    }))).resolves.toBeNull();

    row.deadLetter = true;
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();

    row.deadLetter = false;
    row.workflow = 'TRANSCRIBED';
    await expect(claimQueuedTranscription(row.id, observed())).resolves.toBeNull();

    expect(row.transcriptionStatus).toBe('PENDING');
    expect(row.transcriptionRunId).toBeNull();
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

    await expect(claimRequestedTranscription(row.id, observed())).resolves.toEqual({
      runId: 'run-a',
    });

    expect(row).toMatchObject({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      transcriptionText: 'Existing transcript',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: expect.any(Date),
      transcriptVerifiedBy: 'admin',
    });
  });

  it('publishes success or failure only for the owning run ID', async () => {
    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-a';

    await expect(completeTranscription(row.id, 'run-a', 'Dear family')).resolves.toBe(true);
    expect(row).toMatchObject({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionText: 'Dear family',
      transcriptStatus: 'AI_DRAFT',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
    });

    row.transcriptionStatus = 'RUNNING';
    row.transcriptionRunId = 'run-b';
    await expect(failTranscription(row.id, 'run-a', 'late failure')).resolves.toBe(false);
    expect(row.transcriptionStatus).toBe('RUNNING');
    expect(row.transcriptionRunId).toBe('run-b');
  });

  it('prevents a cancelled attempt from publishing into a retried run', async () => {
    randomUUIDMock.mockReturnValueOnce('run-a').mockReturnValueOnce('run-b');
    const firstClaim = await claimQueuedTranscription(row.id, observed());
    expect(firstClaim).toEqual({ runId: 'run-a' });

    row.transcriptionStatus = 'FAILED';
    row.transcriptionRunId = null;
    row.workflow = 'UPLOADED';
    row.transcriptionStatus = 'PENDING';

    const secondClaim = await claimQueuedTranscription(row.id, observed());
    expect(secondClaim).toEqual({ runId: 'run-b' });

    await expect(completeTranscription(row.id, 'run-a', 'Old content')).resolves.toBe(false);
    expect(row).toMatchObject({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-b',
      transcriptionText: null,
    });

    await expect(completeTranscription(row.id, 'run-b', null)).resolves.toBe(true);
    expect(row).toMatchObject({
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionText: null,
      transcriptStatus: 'EMPTY',
    });
  });
});
