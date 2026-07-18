import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  notifyMock,
  clearJobProgressMock,
  recordJobStartMock,
  recordJobCompletedMock,
  recordJobFailedMock,
  recordJobSkippedMock,
  cancelTranscriptionAttemptMock,
  cancelExtraContentAttemptMock,
  cancelMetadataAttemptMock,
  tryTranscribeExtrasMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  notifyMock: vi.fn(),
  clearJobProgressMock: vi.fn(),
  recordJobStartMock: vi.fn(),
  recordJobCompletedMock: vi.fn(),
  recordJobFailedMock: vi.fn(),
  recordJobSkippedMock: vi.fn(),
  cancelTranscriptionAttemptMock: vi.fn(),
  cancelExtraContentAttemptMock: vi.fn(),
  cancelMetadataAttemptMock: vi.fn(),
  tryTranscribeExtrasMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  return {
    db: {
      query: { letters: { findFirst: findFirstMock, findMany: findManyMock } },
      update: dbUpdateMock,
      select: vi.fn(),
    },
    letters: {
      id: 'letters.id',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionRunId: 'letters.transcriptionRunId',
      transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
      transcriptionLeaseRunId: 'letters.transcriptionLeaseRunId',
      transcriptionClaimKind: 'letters.transcriptionClaimKind',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataRevision: 'letters.metadataRevision',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      extraContentJobRunId: 'letters.extraContentJobRunId',
      extraContentJobDirty: 'letters.extraContentJobDirty',
      updatedAt: 'letters.updatedAt',
    },
  };
});

vi.mock('../../pipeline/processor.js', () => ({
  processLetter: vi.fn(),
  processMetadata: vi.fn(),
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../letter/extra-content.js', () => ({
  tryTranscribeExtras: tryTranscribeExtrasMock,
}));

vi.mock('../letter/transcription-job.js', () => ({
  cancelTranscriptionAttempt: cancelTranscriptionAttemptMock,
}));

vi.mock('../letter/extra-content-job.js', () => ({
  cancelExtraContentAttempt: cancelExtraContentAttemptMock,
}));

vi.mock('../letter/metadata-job.js', () => ({
  cancelMetadataAttempt: cancelMetadataAttemptMock,
}));

vi.mock('../notifications.js', () => ({ notify: notifyMock }));

vi.mock('../processes/filter-helpers.js', () => ({ allOf: vi.fn() }));

vi.mock('../processes/runner.js', () => ({
  clearJobProgress: clearJobProgressMock,
  recordJobStart: recordJobStartMock,
  recordJobCompleted: recordJobCompletedMock,
  recordJobFailed: recordJobFailedMock,
  recordJobSkipped: recordJobSkippedMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));

import {
  cancelActive,
  clearQueue,
  letterProcessSpecs,
  removeFromQueue,
  retryJob,
  runLetterBatch,
  type LetterProcessSpec,
} from '../processes/letter-process-helpers.js';

const extraSpec: LetterProcessSpec = {
  processKey: 'extra_content',
  label: 'Extra content transcription',
  statusColumn: 'extraContentJobStatus',
  errorColumn: 'extraContentJobError',
  runOne: vi.fn(),
  failedNotificationType: 'extra_content_failed',
};

const transcriptionSpec: LetterProcessSpec = {
  processKey: 'transcription',
  label: 'Transcription',
  statusColumn: 'transcriptionStatus',
  errorColumn: 'transcriptionError',
  retryWorkflow: 'UPLOADED',
  runOne: vi.fn(),
  failedNotificationType: 'transcription_failed',
};

const metadataSpec = letterProcessSpecs.metadata;

const context = {
  onProgress: vi.fn(),
  shouldAbort: vi.fn(() => false),
  waitWhilePaused: vi.fn(async () => {}),
  emit: vi.fn(),
};

describe('letter process helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelTranscriptionAttemptMock.mockResolvedValue(true);
    cancelExtraContentAttemptMock.mockResolvedValue(true);
    cancelMetadataAttemptMock.mockResolvedValue(true);
    findManyMock.mockResolvedValue([]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
  });

  it('marks Processing-page extra-content claims as queued intent', async () => {
    tryTranscribeExtrasMock.mockResolvedValue({ kind: 'completed', value: {} });

    await letterProcessSpecs.extra_content.runOne('letter-1');

    expect(tryTranscribeExtrasMock).toHaveBeenCalledWith('letter-1', {
      expectedStatus: 'PENDING',
      claimKind: 'QUEUED',
    });
  });

  it('counts neutral ownership loss as skipped without a failure notification', async () => {
    const spec: LetterProcessSpec = {
      ...extraSpec,
      runOne: vi.fn(async () => ({
        kind: 'skipped' as const,
        reason: 'claim_lost' as const,
      })),
    };

    const result = await runLetterBatch(spec, ['letter-1'], context);

    expect(result).toEqual({ completed: 0, failed: 0, skipped: 1 });
    expect(recordJobSkippedMock).toHaveBeenCalledWith('letter-1', 'claim_lost');
    expect(recordJobFailedMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('still counts arbitrary errors as failures', async () => {
    const spec: LetterProcessSpec = {
      ...extraSpec,
      runOne: vi.fn(async () => { throw new Error('bad request'); }),
    };

    const result = await runLetterBatch(spec, ['letter-1'], context);

    expect(result).toEqual({ completed: 0, failed: 1, skipped: 0 });
    expect(recordJobFailedMock).toHaveBeenCalledWith('letter-1', 'bad request');
    expect(notifyMock).toHaveBeenCalledOnce();
  });

  it('removes only the still-pending row and clears extra-content fence state', async () => {
    findFirstMock.mockResolvedValue({ id: 'letter-1', extraContentJobStatus: 'PENDING' });

    await removeFromQueue(extraSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'Removed from queue by admin',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
      ],
    });
  });

  it('returns a conflict when a worker claims a row during removal', async () => {
    findFirstMock.mockResolvedValue({ id: 'letter-1', extraContentJobStatus: 'PENDING' });
    updateReturningMock.mockResolvedValue([]);

    await expect(removeFromQueue(extraSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot remove: extra_content is no longer pending',
    });
  });

  it('clears the transcription run fence when removing a pending job', async () => {
    findFirstMock.mockResolvedValue({ id: 'letter-1', transcriptionStatus: 'PENDING' });

    await removeFromQueue(transcriptionSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Removed from queue by admin',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      updatedAt: expect.any(Date),
    });
  });

  it('advances and compares the metadata revision when removing a pending job', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      metadataStatus: 'PENDING',
      metadataRevision: 4,
    });

    await removeFromQueue(metadataSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataStatus: 'FAILED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.metadataRevision', value: 4 },
      ]),
    }));
  });

  it('clears only rows that remain pending and reports the actual count', async () => {
    findManyMock.mockResolvedValue([{ id: 'letter-1' }, { id: 'letter-2' }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-2' }]);

    const result = await clearQueue(extraSpec, []);

    expect(result).toEqual({ cleared: 1 });
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'FAILED',
      extraContentJobError: 'Cleared from queue by admin',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        {
          kind: 'inArray',
          field: 'letters.id',
          values: ['letter-1', 'letter-2'],
        },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
      ],
    });
  });

  it('clears the complete transcription ownership tuple for pending queue rows', async () => {
    findManyMock.mockResolvedValue([{ id: 'letter-1' }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);

    await expect(clearQueue(transcriptionSpec, [])).resolves.toEqual({ cleared: 1 });

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Cleared from queue by admin',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      updatedAt: expect.any(Date),
    });
  });

  it('advances the metadata revision when clearing pending queue rows', async () => {
    findManyMock.mockResolvedValue([{ id: 'letter-1' }]);

    await expect(clearQueue(metadataSpec, [])).resolves.toEqual({ cleared: 1 });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataStatus: 'FAILED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
    }));
  });

  it('retries only the failed version that was observed', async () => {
    const observedAt = new Date('2026-07-17T12:00:00Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      extraContentJobStatus: 'FAILED',
      updatedAt: observedAt,
    });

    await retryJob(extraSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'FAILED' },
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ],
    });
  });

  it('returns a conflict when the failed row changes during retry', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      extraContentJobStatus: 'FAILED',
      updatedAt: new Date('2026-07-17T12:00:00Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob(extraSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot retry: extra_content changed since it was loaded',
    });
  });

  it('clears the transcription run fence when retrying a failed job', async () => {
    const observedAt = new Date('2026-07-17T12:00:00Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'FAILED',
      updatedAt: observedAt,
    });

    await retryJob(transcriptionSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      workflow: 'UPLOADED',
      transcriptionAttemptCount: 0,
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      deadLetter: false,
      updatedAt: expect.any(Date),
    });
  });

  it('advances and compares the metadata revision when retrying a failed job', async () => {
    const observedAt = new Date('2026-07-17T12:00:00Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      metadataStatus: 'FAILED',
      metadataRevision: 6,
      updatedAt: observedAt,
    });

    await retryJob(metadataSpec, 'letter-1');

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: expect.objectContaining({ kind: 'sql' }),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.metadataRevision', value: 6 },
      ]),
    }));
  });

  it('cancels only the observed transcription run and clears its fence', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });

    await cancelActive(transcriptionSpec, 'letter-1');

    expect(cancelTranscriptionAttemptMock).toHaveBeenCalledWith('letter-1', 'run-a');
  });

  it('refuses to cancel an invalid running transcription without an owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: null,
    });

    await expect(cancelActive(transcriptionSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: transcription job has no active run ID',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('delegates extra cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'run-a',
    });

    await cancelActive(extraSpec, 'letter-1');

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith('letter-1', 'run-a');
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('delegates metadata cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      metadataStatus: 'RUNNING',
      metadataRunId: 'run-a',
    });

    await cancelActive(metadataSpec, 'letter-1');

    expect(cancelMetadataAttemptMock).toHaveBeenCalledWith('letter-1', 'run-a');
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('refuses to cancel tokenless legacy metadata as if it were currently owned', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      metadataStatus: 'RUNNING',
      metadataRunId: null,
    });

    await expect(cancelActive(metadataSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: metadata job has no active run ID',
    });
    expect(cancelMetadataAttemptMock).not.toHaveBeenCalled();
  });

  it('refuses to cancel invalid running extra content without an owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: null,
    });

    await expect(cancelActive(extraSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: extra-content job has no active run ID',
    });
    expect(cancelExtraContentAttemptMock).not.toHaveBeenCalled();
  });

  it('returns a conflict when extra completion wins the cancellation race', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'run-a',
    });
    cancelExtraContentAttemptMock.mockResolvedValue(false);

    await expect(cancelActive(extraSpec, 'letter-1')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: extra_content is no longer running',
    });
  });
});
