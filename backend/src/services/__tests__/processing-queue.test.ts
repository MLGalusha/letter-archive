import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyLettersMock,
  findManyCollectionsMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  processLetterMock,
  processMetadataMock,
  runEntityExtractionOnlyMock,
  notifyMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyLettersMock: vi.fn(),
  findManyCollectionsMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  processLetterMock: vi.fn(),
  processMetadataMock: vi.fn(),
  runEntityExtractionOnlyMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
  ilike: vi.fn((field: unknown, value: unknown) => ({ kind: 'ilike', field, value })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));

  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
          findMany: findManyLettersMock,
        },
        collections: {
          findMany: findManyCollectionsMock,
        },
      },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      type: 'letters.type',
      workflow: 'letters.workflow',
      collectionId: 'letters.collectionId',
      visibility: 'letters.visibility',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      summary: 'letters.summary',
      hook: 'letters.hook',
      dateRaw: 'letters.dateRaw',
      createdAt: 'letters.createdAt',
      updatedAt: 'letters.updatedAt',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionRunId: 'letters.transcriptionRunId',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    },
    collections: {
      collectionCode: 'collections.collectionCode',
    },
  };
});

vi.mock('../../pipeline/processor.js', () => ({
  processLetter: processLetterMock,
  processMetadata: processMetadataMock,
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runEntityExtractionOnly: runEntityExtractionOnlyMock,
}));

vi.mock('../notifications.js', () => ({
  notify: notifyMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  abortProcessing,
  buildProcessingConditions,
  cancelActiveJob,
  clearQueue,
  getJobProgress,
  getProcessingStatus,
  removeFromQueue,
  resetProcessingState,
  processLettersAsync,
  recoverOrphanedJobs,
  retryJob,
  updateJobProgress,
} from '../processing-queue.js';

describe('processing queue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyCollectionsMock.mockResolvedValue([]);
    findManyLettersMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'letter-3' }]);
    processLetterMock.mockResolvedValue(undefined);
  });

  it('returns collectionNotFound when the collection code does not match any records', async () => {
    const result = await buildProcessingConditions(
      { collectionCode: '999' },
      [{ kind: 'eq', field: 'letters.type', value: 'L' } as never],
    );

    expect(findManyCollectionsMock).toHaveBeenCalledWith({
      where: {
        kind: 'ilike',
        field: 'collections.collectionCode',
        value: '%999',
      },
    });
    expect(result).toEqual({
      conditions: [],
      collectionNotFound: true,
    });
  });

  it('adds the matched collection ids into processing conditions', async () => {
    findManyCollectionsMock.mockResolvedValue([
      { id: 'collection-9a' },
      { id: 'collection-9b' },
    ]);

    const baseCondition = { kind: 'eq', field: 'letters.type', value: 'L' } as never;
    const result = await buildProcessingConditions({ collectionCode: '009' }, [baseCondition]);

    expect(result.collectionNotFound).toBe(false);
    expect(result.conditions).toEqual([
      baseCondition,
      {
        kind: 'inArray',
        field: 'letters.collectionId',
        values: ['collection-9a', 'collection-9b'],
      },
    ]);
  });

  it('marks removed transcription jobs so they no longer stay queued', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });

    const result = await removeFromQueue('letter-1', 'transcription');

    expect(result).toEqual({ message: 'Removed from queue' });
    expect(dbUpdateMock).toHaveBeenCalledWith({
      id: 'letters.id',
      type: 'letters.type',
      workflow: 'letters.workflow',
      collectionId: 'letters.collectionId',
      visibility: 'letters.visibility',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      summary: 'letters.summary',
      hook: 'letters.hook',
      dateRaw: 'letters.dateRaw',
      createdAt: 'letters.createdAt',
      updatedAt: 'letters.updatedAt',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionRunId: 'letters.transcriptionRunId',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionError: 'Removed from queue by admin',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
      ],
    });
  });

  it('rejects removal when a worker claims the queued transcription first', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(removeFromQueue('letter-1', 'transcription')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot remove: transcription is no longer pending',
    });
  });

  it('clears only transcriptions that remain pending and reports the actual count', async () => {
    findManyLettersMock.mockResolvedValue([{ id: 'letter-1' }, { id: 'letter-2' }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-2' }]);

    await expect(clearQueue('transcription')).resolves.toEqual({
      message: 'Cleared 1 items from transcription queue',
      cleared: 1,
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionError: 'Cleared from queue by admin',
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
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
      ],
    });
  });

  it('retries a transcription only while it remains failed', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'FAILED',
    });

    await expect(retryJob('letter-1', 'transcription')).resolves.toEqual({
      message: 'Retrying transcription for letter letter-1',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      workflow: 'UPLOADED',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'FAILED' },
      ],
    });
  });

  it('rejects retry when another owner moves the failed transcription first', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'FAILED',
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob('letter-1', 'transcription')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot retry: transcription is no longer failed',
    });
  });

  it('retries failed metadata jobs by clearing the error', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-2',
      metadataStatus: 'FAILED',
    });

    const result = await retryJob('letter-2', 'metadata');

    expect(result).toEqual({ message: 'Retrying metadata for letter letter-2' });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataStatus: 'PENDING',
        metadataError: null,
        metadataAttemptCount: 0,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('cancels running transcription jobs and clears progress tracking', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    updateJobProgress('letter-3', 'transcription', 2, 5, 'Extracting OCR');

    const result = await cancelActiveJob('letter-3', 'transcription');

    expect(result).toEqual({ message: 'Job cancelled' });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionError: 'Cancelled by admin',
      workflow: 'UPLOADED',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-3' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.transcriptionRunId', value: 'run-a' },
      ],
    });
    expect(getJobProgress('letter-3', 'transcription')).toBeUndefined();
  });

  it('counts neutral transcription outcomes as skipped instead of completed or failed', async () => {
    resetProcessingState(2);
    processLetterMock
      .mockResolvedValueOnce({ kind: 'skipped', reason: 'claim_lost' })
      .mockResolvedValueOnce(undefined);

    await processLettersAsync(['letter-stale', 'letter-owned'], 'transcription');

    expect(getProcessingStatus()).toMatchObject({
      isRunning: false,
      completed: 1,
      failed: 0,
      skipped: 1,
      total: 2,
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'batch_complete',
      message: '1 succeeded, 0 failed, 1 skipped (transcription)',
      metadata: expect.objectContaining({
        succeeded: 1,
        failed: 0,
        skipped: 1,
      }),
    }));
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'transcription_failed',
    }));
  });

  it('recovers only the transcription run ID observed during startup scanning', async () => {
    findManyLettersMock.mockResolvedValue([{
      id: 'letter-orphan',
      dateRaw: '19470813',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      workflow: 'TRANSCRIBING',
    }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-orphan' }]);

    await recoverOrphanedJobs();

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      workflow: 'UPLOADED',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-orphan' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.transcriptionRunId', value: 'run-a' },
      ],
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'job_orphan_recovered',
      metadata: expect.objectContaining({
        count: 1,
        letterIds: ['letter-orphan'],
      }),
    }));
  });

  it('does not report recovery when the observed transcription run loses ownership', async () => {
    findManyLettersMock.mockResolvedValue([{
      id: 'letter-orphan',
      dateRaw: '19470813',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      workflow: 'TRANSCRIBING',
    }]);
    updateReturningMock.mockResolvedValue([]);

    await recoverOrphanedJobs();

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('rejects cancellation when the observed transcription attempt loses ownership', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(cancelActiveJob('letter-3', 'transcription')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: transcription attempt changed since it was loaded',
    });
  });

  it('aborts the batch and lets the current job finish naturally', () => {
    resetProcessingState(3);
    const state = getProcessingStatus();
    state.currentJob = { letterId: 'letter-4', type: 'transcription' };

    const result = abortProcessing();

    expect(result).toEqual({ message: 'Processing aborted — batch will stop after current job finishes' });
    expect(state.shouldAbort).toBe(true);
    // Abort no longer writes to DB — the current job finishes naturally
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
