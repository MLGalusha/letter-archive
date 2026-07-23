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
  recoverExpiredTranscriptionsMock,
  recoverExpiredMetadataJobsMock,
  recoverExpiredExtraContentJobsMock,
  cancelTranscriptionAttemptMock,
  cancelMetadataAttemptMock,
  cancelLegacyEntityExtractionMock,
  failEntityExtractionMock,
  shouldUseCloudRunWorkerJobMock,
  triggerWorkerJobMock,
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
  recoverExpiredTranscriptionsMock: vi.fn(),
  recoverExpiredMetadataJobsMock: vi.fn(),
  recoverExpiredExtraContentJobsMock: vi.fn(),
  cancelTranscriptionAttemptMock: vi.fn(),
  cancelMetadataAttemptMock: vi.fn(),
  cancelLegacyEntityExtractionMock: vi.fn(),
  failEntityExtractionMock: vi.fn(),
  shouldUseCloudRunWorkerJobMock: vi.fn(),
  triggerWorkerJobMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
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
      transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
      transcriptionLeaseRunId: 'letters.transcriptionLeaseRunId',
      transcriptionClaimKind: 'letters.transcriptionClaimKind',
      metadataStatus: 'letters.metadataStatus',
      metadataRevision: 'letters.metadataRevision',
      metadataRunId: 'letters.metadataRunId',
      metadataRunRevision: 'letters.metadataRunRevision',
      metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
      metadataLeaseRunId: 'letters.metadataLeaseRunId',
      metadataClaimKind: 'letters.metadataClaimKind',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      extraContentJobStatus: 'letters.extraContentJobStatus',
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

vi.mock('../letter/transcription-job.js', () => ({
  recoverExpiredTranscriptions: recoverExpiredTranscriptionsMock,
  cancelTranscriptionAttempt: cancelTranscriptionAttemptMock,
}));

vi.mock('../letter/extra-content-job.js', () => ({
  recoverExpiredExtraContentJobs: recoverExpiredExtraContentJobsMock,
}));

vi.mock('../letter/metadata-job.js', () => ({
  cancelMetadataAttempt: cancelMetadataAttemptMock,
  recoverExpiredMetadataJobs: recoverExpiredMetadataJobsMock,
}));

vi.mock('../letters.js', () => ({
  cancelLegacyEntityExtraction: cancelLegacyEntityExtractionMock,
  failEntityExtraction: failEntityExtractionMock,
}));

vi.mock('../cloud-run-job.js', () => ({
  shouldUseCloudRunWorkerJob: shouldUseCloudRunWorkerJobMock,
  triggerWorkerJob: triggerWorkerJobMock,
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
  ensureBackgroundWorkerForQueuedProcessing,
  ensureBackgroundWorkerForQueuedTranscription,
  getQueueStatus,
  getJobProgress,
  getProcessingStatus,
  removeFromQueue,
  resetProcessingState,
  processLettersAsync,
  recoverExpiredProcessingJobs,
  retryJob,
  startEntityExtractionProcessing,
  startMetadataProcessing,
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
    recoverExpiredTranscriptionsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredMetadataJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredExtraContentJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    cancelTranscriptionAttemptMock.mockResolvedValue(true);
    cancelMetadataAttemptMock.mockResolvedValue(true);
    cancelLegacyEntityExtractionMock.mockResolvedValue(true);
    failEntityExtractionMock.mockResolvedValue(true);
    shouldUseCloudRunWorkerJobMock.mockReturnValue(false);
    triggerWorkerJobMock.mockResolvedValue(true);
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

  it('hides retranscribing letters from legacy downstream queue snapshots', async () => {
    await getQueueStatus();

    expect(findManyLettersMock.mock.calls[2]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        ]),
      },
    });
    expect(findManyLettersMock.mock.calls[3]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        ]),
      },
    });
  });

  it('excludes retranscribing letters from legacy metadata batches', async () => {
    await expect(startMetadataProcessing({})).resolves.toEqual({
      message: 'No letters to process',
      total: 0,
    });

    expect(findManyLettersMock).toHaveBeenCalledWith({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        ]),
      },
    });
  });

  it('excludes retranscribing letters from legacy entity batches', async () => {
    await expect(startEntityExtractionProcessing({})).resolves.toEqual({
      message: 'No letters to process',
      total: 0,
    });

    expect(findManyLettersMock).toHaveBeenCalledWith({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        ]),
      },
    });
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
      transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
      transcriptionLeaseRunId: 'letters.transcriptionLeaseRunId',
      transcriptionClaimKind: 'letters.transcriptionClaimKind',
      metadataStatus: 'letters.metadataStatus',
      metadataRevision: 'letters.metadataRevision',
      metadataRunId: 'letters.metadataRunId',
      metadataRunRevision: 'letters.metadataRunRevision',
      metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
      metadataLeaseRunId: 'letters.metadataLeaseRunId',
      metadataClaimKind: 'letters.metadataClaimKind',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
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
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
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

  it('clears only metadata rows that remain queued outside retranscription', async () => {
    findManyLettersMock.mockResolvedValue([{ id: 'letter-1' }, { id: 'letter-2' }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-2' }]);

    await expect(clearQueue('metadata')).resolves.toEqual({
      message: 'Cleared 1 items from metadata queue',
      cleared: 1,
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'inArray', field: 'letters.id', values: ['letter-1', 'letter-2'] },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      ],
    });
  });

  it('clears only entity rows that remain queued outside retranscription', async () => {
    findManyLettersMock.mockResolvedValue([{ id: 'letter-1' }, { id: 'letter-2' }]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);

    await expect(clearQueue('entity_extraction')).resolves.toEqual({
      message: 'Cleared 1 items from entity_extraction queue',
      cleared: 1,
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'inArray', field: 'letters.id', values: ['letter-1', 'letter-2'] },
        { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
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
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
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
      metadataRevision: 3,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    const result = await retryJob('letter-2', 'metadata');

    expect(result).toEqual({ message: 'Retrying metadata for letter letter-2' });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataStatus: 'PENDING',
        metadataRunId: null,
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
    expect(cancelTranscriptionAttemptMock).toHaveBeenCalledWith('letter-3', 'run-a');
    expect(getJobProgress('letter-3', 'transcription')).toBeUndefined();
  });

  it('delegates metadata cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      metadataStatus: 'RUNNING',
      metadataRunId: 'metadata-run-a',
    });
    updateJobProgress('letter-4', 'metadata', 1, 2, 'Extracting metadata');

    await expect(cancelActiveJob('letter-4', 'metadata')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelMetadataAttemptMock).toHaveBeenCalledWith(
      'letter-4',
      'metadata-run-a',
    );
    expect(getJobProgress('letter-4', 'metadata')).toBeUndefined();
  });

  it('cancels only the exact observed entity-extraction run', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-5',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: 'entity-run-a',
      entityExtractionRunRevision: 4,
    });

    await expect(cancelActiveJob('letter-5', 'entity_extraction')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(failEntityExtractionMock).toHaveBeenCalledWith(
      'letter-5',
      { runId: 'entity-run-a', revision: 4 },
      'Cancelled by admin',
    );
  });

  it('cancels an observed tokenless legacy entity run after rollout drain', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-legacy',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
    });

    await expect(cancelActiveJob(
      'letter-legacy',
      'entity_extraction',
    )).resolves.toEqual({ message: 'Job cancelled' });

    expect(cancelLegacyEntityExtractionMock).toHaveBeenCalledWith(
      'letter-legacy',
      'Cancelled by admin',
    );
    expect(failEntityExtractionMock).not.toHaveBeenCalled();
  });

  it('cannot let a cancellation waiting behind commit overwrite SUCCESS', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-5',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: 'entity-run-a',
      entityExtractionRunRevision: 4,
    });
    // False characterizes the interleaving where the materialization
    // transaction held the letter lock first and cleared the token on SUCCESS.
    failEntityExtractionMock.mockResolvedValue(false);

    await expect(
      cancelActiveJob('letter-5', 'entity_extraction'),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: entity extraction attempt changed since it was loaded',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('counts neutral metadata outcomes as skipped instead of completed or failed', async () => {
    resetProcessingState(2);
    processMetadataMock
      .mockResolvedValueOnce({ kind: 'skipped', reason: 'superseded' })
      .mockResolvedValueOnce(undefined);

    await processLettersAsync(['letter-stale', 'letter-owned'], 'metadata');

    expect(getProcessingStatus()).toMatchObject({
      isRunning: false,
      completed: 1,
      failed: 0,
      skipped: 1,
      total: 2,
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'batch_complete',
      message: '1 succeeded, 0 failed, 1 skipped (metadata)',
    }));
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

  it('reports only expired attempts returned by the leased lifecycle owners', async () => {
    recoverExpiredTranscriptionsMock.mockResolvedValue({
      requeued: [{ id: 'letter-orphan', dateRaw: '19470813' }],
      failed: [],
    });

    recoverExpiredExtraContentJobsMock.mockResolvedValue({
      requeued: [],
      failed: [{ id: 'extra-orphan', dateRaw: '19470814' }],
    });

    await expect(recoverExpiredProcessingJobs()).resolves.toEqual({
      transcription: {
        requeued: [{ id: 'letter-orphan', dateRaw: '19470813' }],
        failed: [],
      },
      metadata: { requeued: [], failed: [] },
      extraContent: {
        requeued: [],
        failed: [{ id: 'extra-orphan', dateRaw: '19470814' }],
      },
    });

    expect(findManyLettersMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'job_orphan_recovered',
      metadata: expect.objectContaining({
        count: 2,
        letterIds: ['letter-orphan', 'extra-orphan'],
        transcriptionRequeued: 1,
        transcriptionFailed: 0,
        extraContentRequeued: 0,
        extraContentFailed: 1,
      }),
    }));
  });

  it('does not report live or unknown leases that were not recovered', async () => {
    await expect(recoverExpiredProcessingJobs()).resolves.toEqual({
      transcription: { requeued: [], failed: [] },
      metadata: { requeued: [], failed: [] },
      extraContent: { requeued: [], failed: [] },
    });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('preserves recovered transcription work when extra-content recovery fails', async () => {
    recoverExpiredTranscriptionsMock.mockResolvedValue({
      requeued: [{ id: 'letter-orphan', dateRaw: '19470813' }],
      failed: [],
    });
    recoverExpiredExtraContentJobsMock.mockRejectedValue(new Error('extra recovery failed'));

    await expect(recoverExpiredProcessingJobs()).resolves.toEqual({
      transcription: {
        requeued: [{ id: 'letter-orphan', dateRaw: '19470813' }],
        failed: [],
      },
      metadata: { requeued: [], failed: [] },
      extraContent: { requeued: [], failed: [] },
    });

    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ transcriptionRequeued: 1 }),
    }));
  });

  it('still recovers extra content when transcription recovery fails', async () => {
    recoverExpiredTranscriptionsMock.mockRejectedValue(new Error('main recovery failed'));
    recoverExpiredExtraContentJobsMock.mockResolvedValue({
      requeued: [{ id: 'extra-orphan', dateRaw: '19470814' }],
      failed: [],
    });

    await expect(recoverExpiredProcessingJobs()).resolves.toEqual({
      transcription: { requeued: [], failed: [] },
      metadata: { requeued: [], failed: [] },
      extraContent: {
        requeued: [{ id: 'extra-orphan', dateRaw: '19470814' }],
        failed: [],
      },
    });

    expect(recoverExpiredExtraContentJobsMock).toHaveBeenCalledOnce();
  });

  it('awaits a worker wake whenever durable queued transcription exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValue({ id: 'queued-letter' });

    await expect(
      ensureBackgroundWorkerForQueuedTranscription('lease-recovery'),
    ).resolves.toBe(true);

    expect(triggerWorkerJobMock).toHaveBeenCalledWith('lease-recovery');
  });

  it('awaits a worker wake when durable queued metadata exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'queued-metadata' });

    await expect(
      ensureBackgroundWorkerForQueuedProcessing('metadata-lease-recovery'),
    ).resolves.toBe(true);

    expect(triggerWorkerJobMock).toHaveBeenCalledWith('metadata-lease-recovery');
  });

  it('propagates a failed worker wake so periodic recovery can retry it', async () => {
    const failure = new Error('Cloud Run unavailable');
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValue({ id: 'queued-letter' });
    triggerWorkerJobMock.mockRejectedValue(failure);

    await expect(
      ensureBackgroundWorkerForQueuedTranscription('lease-recovery'),
    ).rejects.toBe(failure);
  });

  it('rejects cancellation when the observed transcription attempt loses ownership', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    cancelTranscriptionAttemptMock.mockResolvedValue(false);

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
