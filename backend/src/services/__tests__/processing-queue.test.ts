import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyLettersMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  notifyMock,
  recoverExpiredTranscriptionsMock,
  recoverExpiredMetadataJobsMock,
  recoverExpiredExtraContentJobsMock,
  cancelExtraContentAttemptMock,
  cancelTranscriptionAttemptMock,
  cancelMetadataAttemptMock,
  cancelLegacyEntityExtractionMock,
  failEntityExtractionMock,
  shouldUseCloudRunWorkerJobMock,
  triggerWorkerJobMock,
  getWorkerStateMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyLettersMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  notifyMock: vi.fn(),
  recoverExpiredTranscriptionsMock: vi.fn(),
  recoverExpiredMetadataJobsMock: vi.fn(),
  recoverExpiredExtraContentJobsMock: vi.fn(),
  cancelExtraContentAttemptMock: vi.fn(),
  cancelTranscriptionAttemptMock: vi.fn(),
  cancelMetadataAttemptMock: vi.fn(),
  cancelLegacyEntityExtractionMock: vi.fn(),
  failEntityExtractionMock: vi.fn(),
  shouldUseCloudRunWorkerJobMock: vi.fn(),
  triggerWorkerJobMock: vi.fn(),
  getWorkerStateMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
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
      typeSequence: 'letters.typeSequence',
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
      extraContentJobError: 'letters.extraContentJobError',
      extraContentJobRunId: 'letters.extraContentJobRunId',
      extraContentJobLeaseExpiresAt: 'letters.extraContentJobLeaseExpiresAt',
      extraContentJobLeaseRunId: 'letters.extraContentJobLeaseRunId',
      extraContentJobClaimKind: 'letters.extraContentJobClaimKind',
      extraContentJobDirty: 'letters.extraContentJobDirty',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
      transcriptionText: 'letters.transcriptionText',
      deadLetter: 'letters.deadLetter',
    },
    letterPages: {
      letterId: 'letterPages.letterId',
    },
  };
});

vi.mock('../notifications.js', () => ({
  notify: notifyMock,
}));

vi.mock('../letter/transcription-job.js', () => ({
  recoverExpiredTranscriptions: recoverExpiredTranscriptionsMock,
  cancelTranscriptionAttempt: cancelTranscriptionAttemptMock,
}));

vi.mock('../letter/extra-content-job.js', () => ({
  cancelExtraContentAttempt: cancelExtraContentAttemptMock,
  recoverExpiredExtraContentJobs: recoverExpiredExtraContentJobsMock,
}));

vi.mock('../worker-state.js', () => ({
  getWorkerState: getWorkerStateMock,
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
  cancelActiveJob,
  clearQueue,
  ensureBackgroundWorkerForQueuedProcessing,
  getQueueStatus,
  hasQueuedProcessingWork,
  removeFromQueue,
  recoverExpiredProcessingJobs,
  retryJob,
  queueJobTypeSchema,
  wakeBackgroundWorkerForQueuedProcessing,
} from '../processing-queue.js';

describe('processing queue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyLettersMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'letter-3' }]);
    recoverExpiredTranscriptionsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredMetadataJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredExtraContentJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    cancelExtraContentAttemptMock.mockResolvedValue(true);
    cancelTranscriptionAttemptMock.mockResolvedValue(true);
    cancelMetadataAttemptMock.mockResolvedValue(true);
    cancelLegacyEntityExtractionMock.mockResolvedValue(true);
    failEntityExtractionMock.mockResolvedValue(true);
    shouldUseCloudRunWorkerJobMock.mockReturnValue(false);
    triggerWorkerJobMock.mockResolvedValue(true);
    getWorkerStateMock.mockResolvedValue({
      lastTickAt: null,
      isPolling: false,
      lastError: null,
      currentBatchSize: null,
      updatedAt: null,
    });
  });

  it('accepts extra content as a durable queue job type', () => {
    expect(queueJobTypeSchema.parse('extra_content')).toBe('extra_content');
  });

  it('projects extra-content queue state and persisted worker observation without invented timestamps', async () => {
    const collection = { collectionCode: '009' };
    const activeAt = new Date('2026-07-23T12:00:00.000Z');
    const queuedAt = new Date('2026-07-23T12:01:00.000Z');
    const completedAt = new Date('2026-07-23T12:02:00.000Z');
    const worker = {
      lastTickAt: '2026-07-23T12:03:00.000Z',
      isPolling: true,
      lastError: null,
      currentBatchSize: 1,
      updatedAt: '2026-07-23T12:03:00.000Z',
    };
    getWorkerStateMock.mockResolvedValue(worker);
    findManyLettersMock
      .mockResolvedValueOnce([{
        id: 'extra-active',
        dateRaw: '19470810',
        collection,
        sender: 'Alice',
        recipient: 'Bob',
        updatedAt: activeAt,
        extraContentJobStatus: 'RUNNING',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'extra-queued',
        dateRaw: '19470811',
        collection,
        sender: 'Carol',
        recipient: 'David',
        createdAt: queuedAt,
      }])
      .mockResolvedValueOnce([{
        id: 'extra-recent',
        dateRaw: '19470812',
        collection,
        updatedAt: completedAt,
        extraContentJobStatus: 'FAILED',
        extraContentJobError: 'extra AI failed',
      }]);

    const status = await getQueueStatus();

    expect(status.active).toEqual([{
      letterId: 'extra-active',
      letterTitle: '19470810',
      collectionCode: '009',
      sender: 'Alice',
      recipient: 'Bob',
      type: 'extra_content',
      startedAt: activeAt.toISOString(),
    }]);
    expect(status.queued.extraContent).toEqual([{
      letterId: 'extra-queued',
      letterTitle: '19470811',
      collectionCode: '009',
      sender: 'Carol',
      recipient: 'David',
      queuedAt: null,
    }]);
    expect(status.recent).toEqual([]);
    expect(status.counts).toMatchObject({
      activeCount: 1,
      queuedExtraContent: 1,
      recentFailedCount: 0,
    });
    expect(status.worker).toEqual(worker);
    expect(findManyLettersMock.mock.calls[4]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'eq', field: 'letters.type', value: 'L' },
          { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
        ]),
      },
    });
  });

  it('hides retranscribing letters from durable downstream queue snapshots', async () => {
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

  it('marks removed transcription jobs so they no longer stay queued', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });

    const result = await removeFromQueue('letter-1', 'transcription');

    expect(result).toEqual({ message: 'Removed from queue' });
    expect(dbUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'letters.id',
    }));
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

  it('removes only the exact observed queued extra-content job', async () => {
    const observedAt = new Date('2026-07-23T12:00:00.000Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-extra',
      extraContentJobStatus: 'PENDING',
      updatedAt: observedAt,
    });

    await expect(removeFromQueue('letter-extra', 'extra_content')).resolves.toEqual({
      message: 'Removed from queue',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'FAILED',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      extraContentJobError: 'Removed from queue by admin',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-extra' },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ]),
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
      clauses: expect.arrayContaining([
        {
          kind: 'inArray',
          field: 'letters.id',
          values: ['letter-1', 'letter-2'],
        },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
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
      clauses: expect.arrayContaining([
        { kind: 'inArray', field: 'letters.id', values: ['letter-1', 'letter-2'] },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'isNotNull', field: 'letters.transcriptConfirmedAt' },
        { kind: 'isNotNull', field: 'letters.transcriptionText' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
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
      clauses: expect.arrayContaining([
        { kind: 'inArray', field: 'letters.id', values: ['letter-1', 'letter-2'] },
        { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
    });
  });

  it('clears only rows that remain in the durable extra-content queue', async () => {
    findManyLettersMock.mockResolvedValue([{ id: 'extra-1' }, { id: 'extra-2' }]);
    updateReturningMock.mockResolvedValue([{ id: 'extra-2' }]);

    await expect(clearQueue('extra_content')).resolves.toEqual({
      message: 'Cleared 1 items from extra_content queue',
      cleared: 1,
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'FAILED',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      extraContentJobError: 'Cleared from queue by admin',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        {
          kind: 'inArray',
          field: 'letters.id',
          values: ['extra-1', 'extra-2'],
        },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
      ]),
    });
  });

  it('retries a transcription only while it remains failed', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: observedAt,
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
        {
          kind: 'inArray',
          field: 'letters.type',
          values: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
        },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
        expect.objectContaining({
          kind: 'sql',
          strings: expect.arrayContaining([
            expect.stringContaining('EXISTS'),
          ]),
          values: [
            { letterId: 'letterPages.letterId' },
            'letterPages.letterId',
            'letters.id',
          ],
        }),
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ],
    });
  });

  it.each([
    ['a non-transcribable type', { type: 'P' }],
    ['running metadata', { metadataStatus: 'RUNNING' }],
    ['running entity extraction', { entityExtractionStatus: 'RUNNING' }],
  ])('rejects a transcription retry with %s', async (_label, overrides) => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      ...overrides,
    });

    await expect(retryJob('letter-1', 'transcription')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: transcription prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects retry when another owner moves the failed transcription first', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob('letter-1', 'transcription')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot retry: transcription prerequisites changed since it was loaded',
    });
  });

  it('retries failed metadata jobs by clearing the error', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-2',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'FAILED',
      metadataRevision: 3,
      entityExtractionStatus: 'PENDING',
      extraContentJobStatus: 'PENDING',
      transcriptConfirmedAt: new Date('2026-07-17T11:00:00.000Z'),
      transcriptionText: 'Confirmed transcript',
      updatedAt: observedAt,
    });

    const result = await retryJob('letter-2', 'metadata');

    expect(result).toEqual({ message: 'Retrying metadata for letter letter-2' });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataStatus: 'PENDING',
        metadataRunId: null,
        metadataRunRevision: null,
        metadataLeaseExpiresAt: null,
        metadataLeaseRunId: null,
        metadataClaimKind: null,
        metadataError: null,
        metadataAttemptCount: 0,
        deadLetter: false,
        workflow: 'TRANSCRIBED',
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-2' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'FAILED' },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.extraContentJobStatus', value: 'RUNNING' },
        { kind: 'isNotNull', field: 'letters.transcriptConfirmedAt' },
        { kind: 'isNotNull', field: 'letters.transcriptionText' },
        {
          kind: 'sql',
          strings: ['', " ~ '[^[:space:]]'"],
          values: ['letters.transcriptionText'],
        },
        { kind: 'eq', field: 'letters.metadataRevision', value: 3 },
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ],
    });
  });

  it.each([
    ['an unconfirmed transcript', { transcriptConfirmedAt: null }],
    ['a blank transcript', { transcriptionText: '   ' }],
    ['a running transcription', { transcriptionStatus: 'RUNNING' }],
    ['running entity extraction', { entityExtractionStatus: 'RUNNING' }],
    ['running extra-content work', { extraContentJobStatus: 'RUNNING' }],
  ])('rejects a metadata retry with %s', async (_label, overrides) => {
    findFirstMock.mockResolvedValue({
      id: 'letter-2',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'FAILED',
      metadataRevision: 3,
      entityExtractionStatus: 'PENDING',
      extraContentJobStatus: 'PENDING',
      transcriptConfirmedAt: new Date('2026-07-17T11:00:00.000Z'),
      transcriptionText: 'Confirmed transcript',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      ...overrides,
    });

    await expect(retryJob('letter-2', 'metadata')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: metadata prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('makes an explicitly retried entity job claimable again', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-entity',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'FAILED',
      deadLetter: true,
      updatedAt: new Date('2026-07-17T12:00:00Z'),
    });

    await expect(
      retryJob('letter-entity', 'entity_extraction'),
    ).resolves.toEqual({
      message: 'Retrying entity_extraction for letter letter-entity',
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      entityExtractionStatus: 'PENDING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionError: null,
      deadLetter: false,
    }));
  });

  it('does not clear dead-letter state for an ineligible entity retry', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-entity',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'FAILED',
      entityExtractionStatus: 'FAILED',
      deadLetter: true,
      updatedAt: new Date('2026-07-17T12:00:00Z'),
    });

    await expect(
      retryJob('letter-entity', 'entity_extraction'),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: entity extraction prerequisites are not satisfied',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('retries failed extra-content work with a fresh durable ownership tuple', async () => {
    const observedAt = new Date('2026-07-23T12:00:00.000Z');
    findFirstMock.mockResolvedValue({
      id: 'letter-extra',
      type: 'L',
      extraContentJobStatus: 'FAILED',
      updatedAt: observedAt,
    });

    await expect(retryJob('letter-extra', 'extra_content')).resolves.toEqual({
      message: 'Retrying extra_content for letter letter-extra',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentJobStatus: 'PENDING',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      extraContentJobError: null,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-extra' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'FAILED' },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        expect.objectContaining({
          kind: 'sql',
          strings: expect.arrayContaining([
            expect.stringContaining("rel.type IN ('T', 'C', 'E')"),
          ]),
        }),
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ],
    });
  });

  it('rejects an extra-content retry whose durable prerequisites lose the CAS', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-extra',
      type: 'L',
      extraContentJobStatus: 'FAILED',
      updatedAt: new Date('2026-07-23T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob('letter-extra', 'extra_content')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot retry: extra content changed since it was loaded',
    });
  });

  it('rejects an extra-content retry for a non-letter record', async () => {
    findFirstMock.mockResolvedValue({
      id: 'cover-extra',
      type: 'C',
      extraContentJobStatus: 'FAILED',
      updatedAt: new Date('2026-07-23T12:00:00.000Z'),
    });

    await expect(retryJob('cover-extra', 'extra_content')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: extra content prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('delegates transcription cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    const result = await cancelActiveJob('letter-3', 'transcription');

    expect(result).toEqual({ message: 'Job cancelled' });
    expect(cancelTranscriptionAttemptMock).toHaveBeenCalledWith('letter-3', 'run-a');
  });

  it('delegates metadata cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      metadataStatus: 'RUNNING',
      metadataRunId: 'metadata-run-a',
    });
    await expect(cancelActiveJob('letter-4', 'metadata')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelMetadataAttemptMock).toHaveBeenCalledWith(
      'letter-4',
      'metadata-run-a',
    );
  });

  it('delegates extra-content cancellation to the canonical exact-run lifecycle owner', async () => {
    findFirstMock
      .mockResolvedValueOnce({
        id: 'letter-extra',
        extraContentJobStatus: 'RUNNING',
        extraContentJobRunId: 'extra-run-a',
      })
      .mockResolvedValueOnce(null);

    await expect(cancelActiveJob('letter-extra', 'extra_content')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
    );
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('requests a worker when extra-content cancellation leaves durable queued work', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock
      .mockResolvedValueOnce({
        id: 'letter-extra',
        extraContentJobStatus: 'RUNNING',
        extraContentJobRunId: 'extra-run-a',
      })
      .mockResolvedValueOnce({ id: 'letter-extra' });

    await expect(cancelActiveJob('letter-extra', 'extra_content')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
    );
    expect(findFirstMock.mock.calls[1]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'eq', field: 'letters.type', value: 'L' },
          { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
        ]),
      },
      columns: { id: true },
    });
    expect(triggerWorkerJobMock).toHaveBeenCalledWith('cancel:extra_content');
  });

  it('keeps a committed extra-content cancellation successful when the wake check fails', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock
      .mockResolvedValueOnce({
        id: 'letter-extra',
        extraContentJobStatus: 'RUNNING',
        extraContentJobRunId: 'extra-run-a',
      })
      .mockRejectedValueOnce(new Error('queue observation failed'));

    await expect(cancelActiveJob('letter-extra', 'extra_content')).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
    );
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('rejects extra-content cancellation after the observed run loses ownership', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-extra',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'extra-run-a',
    });
    cancelExtraContentAttemptMock.mockResolvedValue(false);

    await expect(cancelActiveJob('letter-extra', 'extra_content')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot cancel: extra content attempt changed since it was loaded',
    });
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

  it('awaits a worker wake whenever any durable queued stage exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValue({ id: 'queued-letter' });

    await expect(
      ensureBackgroundWorkerForQueuedProcessing('lease-recovery'),
    ).resolves.toBe(true);

    expect(triggerWorkerJobMock).toHaveBeenCalledWith('lease-recovery');
  });

  it('awaits a worker wake when durable queued metadata exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'queued-metadata' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      ensureBackgroundWorkerForQueuedProcessing('metadata-lease-recovery'),
    ).resolves.toBe(true);

    expect(triggerWorkerJobMock).toHaveBeenCalledWith('metadata-lease-recovery');
  });

  it('reports that a manual wake cannot run without worker configuration', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(false);

    await expect(wakeBackgroundWorkerForQueuedProcessing()).resolves.toEqual({
      requested: false,
      reason: 'worker_not_configured',
    });

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('reports an empty durable queue without requesting a manual wake', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);

    await expect(wakeBackgroundWorkerForQueuedProcessing()).resolves.toEqual({
      requested: false,
      reason: 'queue_empty',
    });

    expect(findFirstMock).toHaveBeenCalledTimes(4);
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('requests one global worker drain when durable work exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValueOnce({ id: 'queued-letter' });

    await expect(wakeBackgroundWorkerForQueuedProcessing()).resolves.toEqual({
      requested: true,
    });

    expect(triggerWorkerJobMock).toHaveBeenCalledWith('admin-processing-wake');
  });

  it('propagates a failed manual worker request', async () => {
    const failure = new Error('Cloud Run unavailable');
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValueOnce({ id: 'queued-letter' });
    triggerWorkerJobMock.mockRejectedValue(failure);

    await expect(wakeBackgroundWorkerForQueuedProcessing()).rejects.toBe(failure);
  });

  it('treats entity-only pending rows as durable queued processing work', async () => {
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'queued-entity' })
      .mockResolvedValueOnce(null);

    await expect(hasQueuedProcessingWork()).resolves.toBe(true);

    expect(findFirstMock).toHaveBeenCalledTimes(4);
    expect(findFirstMock.mock.calls[2]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
          { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
        ]),
      },
      columns: { id: true },
    });
  });

  it('treats extra-content-only pending rows as durable queued processing work', async () => {
    findFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'queued-extra-content' });

    await expect(hasQueuedProcessingWork()).resolves.toBe(true);

    expect(findFirstMock).toHaveBeenCalledTimes(4);
    expect(findFirstMock.mock.calls[3]?.[0]).toMatchObject({
      where: {
        kind: 'and',
        clauses: [
          { kind: 'eq', field: 'letters.type', value: 'L' },
          expect.objectContaining({
            kind: 'sql',
            strings: expect.arrayContaining([
              expect.stringContaining("rel.type IN ('T', 'C', 'E')"),
            ]),
          }),
          { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
        ],
      },
      columns: { id: true },
    });
  });

  it('propagates a failed worker wake so periodic recovery can retry it', async () => {
    const failure = new Error('Cloud Run unavailable');
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    findFirstMock.mockResolvedValue({ id: 'queued-letter' });
    triggerWorkerJobMock.mockRejectedValue(failure);

    await expect(
      ensureBackgroundWorkerForQueuedProcessing('lease-recovery'),
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

});
