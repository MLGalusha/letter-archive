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
  recoverExpiredEntityExtractionJobsMock,
  recoverExpiredExtraContentJobsMock,
  cancelExtraContentAttemptMock,
  cancelTranscriptionAttemptMock,
  cancelMetadataAttemptMock,
  cancelEntityExtractionAttemptMock,
  cancelLegacyEntityExtractionMock,
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
  recoverExpiredEntityExtractionJobsMock: vi.fn(),
  recoverExpiredExtraContentJobsMock: vi.fn(),
  cancelExtraContentAttemptMock: vi.fn(),
  cancelTranscriptionAttemptMock: vi.fn(),
  cancelMetadataAttemptMock: vi.fn(),
  cancelEntityExtractionAttemptMock: vi.fn(),
  cancelLegacyEntityExtractionMock: vi.fn(),
  shouldUseCloudRunWorkerJobMock: vi.fn(),
  triggerWorkerJobMock: vi.fn(),
  getWorkerStateMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  exists: vi.fn((query: unknown) => ({ kind: 'exists', query })),
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
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => ({
            kind: 'subquery',
            condition,
          })),
        })),
      })),
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
      primarySourceRevision: 'letters.primarySourceRevision',
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
      entityExtractionRevision: 'letters.entityExtractionRevision',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      entityExtractionLeaseExpiresAt: 'letters.entityExtractionLeaseExpiresAt',
      entityExtractionLeaseRunId: 'letters.entityExtractionLeaseRunId',
      entityExtractionClaimKind: 'letters.entityExtractionClaimKind',
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

vi.mock('../letter/entity-extraction-job.js', () => ({
  cancelEntityExtractionAttempt: cancelEntityExtractionAttemptMock,
  cancelLegacyEntityExtraction: cancelLegacyEntityExtractionMock,
  recoverExpiredEntityExtractionJobs: recoverExpiredEntityExtractionJobsMock,
  clearedEntityExtractionOwnership: vi.fn(() => ({
    entityExtractionRunId: null,
    entityExtractionRunRevision: null,
    entityExtractionLeaseExpiresAt: null,
    entityExtractionLeaseRunId: null,
    entityExtractionClaimKind: null,
  })),
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
import {
  processingJobStateToken,
  type ProcessingJobPhase,
  type ProcessingJobStateSource,
  type QueueJobType,
} from '../processing-queue-snapshot.js';

let currentObservedLetter:
  | (ProcessingJobStateSource & {
    id: string;
    primarySourceRevision: number;
    updatedAt: Date;
  })
  | null = null;

function observedLetter(
  overrides: ProcessingJobStateSource & {
    id: string;
    primarySourceRevision?: number;
    updatedAt?: Date;
    [key: string]: unknown;
  },
) {
  return {
    primarySourceRevision: 4,
    updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    ...overrides,
  };
}

function mockLetter(
  overrides: Parameters<typeof observedLetter>[0],
): void {
  currentObservedLetter = observedLetter(overrides);
  findFirstMock.mockResolvedValue(currentObservedLetter);
}

function currentSnapshot(
  type: QueueJobType,
  phase: ProcessingJobPhase,
) {
  if (!currentObservedLetter) {
    throw new Error('Call mockLetter before requesting a job snapshot');
  }
  return snapshotFor(currentObservedLetter, type, phase);
}

function snapshotFor(
  letter: ProcessingJobStateSource & { primarySourceRevision: number },
  type: QueueJobType,
  phase: ProcessingJobPhase,
) {
  return {
    primarySourceRevision: letter.primarySourceRevision,
    jobStateToken: processingJobStateToken(letter, type, phase),
  };
}

describe('processing queue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyLettersMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'letter-3' }]);
    recoverExpiredTranscriptionsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredMetadataJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    recoverExpiredEntityExtractionJobsMock.mockResolvedValue({
      requeued: [],
      failed: [],
    });
    recoverExpiredExtraContentJobsMock.mockResolvedValue({ requeued: [], failed: [] });
    cancelExtraContentAttemptMock.mockResolvedValue(true);
    cancelTranscriptionAttemptMock.mockResolvedValue(true);
    cancelMetadataAttemptMock.mockResolvedValue(true);
    cancelEntityExtractionAttemptMock.mockResolvedValue(true);
    cancelLegacyEntityExtractionMock.mockResolvedValue(true);
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
        primarySourceRevision: 6,
        updatedAt: activeAt,
        extraContentJobStatus: 'RUNNING',
        extraContentJobRunId: '00000000-0000-4000-8000-000000000001',
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
        primarySourceRevision: 7,
        createdAt: queuedAt,
        updatedAt: queuedAt,
        extraContentJobStatus: 'PENDING',
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
      primarySourceRevision: 6,
      jobStateToken: expect.stringMatching(/^v1\./),
      startedAt: activeAt.toISOString(),
    }]);
    expect(status.queued.extraContent).toEqual([{
      letterId: 'extra-queued',
      letterTitle: '19470811',
      collectionCode: '009',
      sender: 'Carol',
      recipient: 'David',
      primarySourceRevision: 7,
      jobStateToken: expect.stringMatching(/^v1\./),
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

  it('returns source and opaque state tokens for retryable recent rows', async () => {
    const completedAt = new Date('2026-07-24T12:02:00.000Z');
    findManyLettersMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'metadata-failed',
        dateRaw: '19470812',
        collection: { collectionCode: '009' },
        primarySourceRevision: 11,
        updatedAt: completedAt,
        metadataStatus: 'FAILED',
        metadataRevision: 6,
        metadataError: 'metadata unavailable',
        entityExtractionStatus: 'PENDING',
        transcriptionStatus: 'SUCCESS',
      }]);

    const status = await getQueueStatus();

    expect(status.recent).toEqual([{
      letterId: 'metadata-failed',
      letterTitle: '19470812',
      collectionCode: '009',
      type: 'metadata',
      status: 'FAILED',
      primarySourceRevision: 11,
      jobStateToken: expect.stringMatching(/^v1\.[A-Za-z0-9_-]+$/),
      error: 'metadata unavailable',
      completedAt: completedAt.toISOString(),
    }]);
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
    mockLetter({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });

    const result = await removeFromQueue(
      'letter-1',
      'transcription',
      currentSnapshot('transcription', 'queued'),
    );

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
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
      ]),
    });
  });

  it('rejects removal when a worker claims the queued transcription first', async () => {
    mockLetter({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(removeFromQueue(
      'letter-1',
      'transcription',
      currentSnapshot('transcription', 'queued'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
  });

  it('classifies source changes before stale queue tokens', async () => {
    mockLetter({
      id: 'letter-source-changed',
      primarySourceRevision: 5,
      transcriptionStatus: 'PENDING',
    });

    await expect(removeFromQueue(
      'letter-source-changed',
      'transcription',
      {
        primarySourceRevision: 4,
        jobStateToken: 'v1.stale-token',
      },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('reports a narrower conflict when only the displayed job changed', async () => {
    mockLetter({
      id: 'letter-job-changed',
      primarySourceRevision: 4,
      transcriptionStatus: 'PENDING',
    });

    await expect(removeFromQueue(
      'letter-job-changed',
      'transcription',
      {
        primarySourceRevision: 4,
        jobStateToken: 'v1.stale-token',
      },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rechecks the source epoch when the SQL queue CAS loses its race', async () => {
    const observed = observedLetter({
      id: 'letter-raced',
      primarySourceRevision: 4,
      transcriptionStatus: 'PENDING',
    });
    findFirstMock
      .mockResolvedValueOnce(observed)
      .mockResolvedValueOnce({
        ...observed,
        primarySourceRevision: 5,
      });
    updateReturningMock.mockResolvedValue([]);

    await expect(removeFromQueue(
      'letter-raced',
      'transcription',
      snapshotFor(observed, 'transcription', 'queued'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });
  });

  it('removes a queued entity job with the complete ownership tuple cleared', async () => {
    mockLetter({
      id: 'letter-entity',
      entityExtractionStatus: 'PENDING',
    });

    await expect(
      removeFromQueue(
        'letter-entity',
        'entity_extraction',
        currentSnapshot('entity_extraction', 'queued'),
      ),
    ).resolves.toEqual({ message: 'Removed from queue' });

    expect(updateSetMock).toHaveBeenCalledWith({
      entityExtractionStatus: 'FAILED',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: 'Removed from queue by admin',
      updatedAt: expect.any(Date),
    });
  });

  it('removes only the exact observed queued extra-content job', async () => {
    const observedAt = new Date('2026-07-23T12:00:00.000Z');
    mockLetter({
      id: 'letter-extra',
      extraContentJobStatus: 'PENDING',
      updatedAt: observedAt,
    });

    await expect(removeFromQueue(
      'letter-extra',
      'extra_content',
      currentSnapshot('extra_content', 'queued'),
    )).resolves.toEqual({
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
    mockLetter({
      id: 'letter-1',
      transcriptionStatus: 'PENDING',
    });

    await expect(clearQueue('transcription', [{
      letterId: 'letter-1',
      ...currentSnapshot('transcription', 'queued'),
    }])).resolves.toEqual({
      message: 'Cleared 1 of 1 displayed transcription queue items',
      requested: 1,
      cleared: 1,
      skipped: 0,
      skipReasons: [],
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
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
    });
  });

  it('clears only metadata rows that remain queued outside retranscription', async () => {
    mockLetter({
      id: 'letter-1',
      metadataStatus: 'PENDING',
      metadataRevision: 3,
    });

    await expect(clearQueue('metadata', [{
      letterId: 'letter-1',
      ...currentSnapshot('metadata', 'queued'),
    }])).resolves.toEqual({
      message: 'Cleared 1 of 1 displayed metadata queue items',
      requested: 1,
      cleared: 1,
      skipped: 0,
      skipReasons: [],
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'isNotNull', field: 'letters.transcriptConfirmedAt' },
        { kind: 'isNotNull', field: 'letters.transcriptionText' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
    });
  });

  it('clears only entity rows that remain queued outside retranscription', async () => {
    mockLetter({
      id: 'letter-1',
      entityExtractionStatus: 'PENDING',
      entityExtractionRevision: 5,
    });

    await expect(clearQueue('entity_extraction', [{
      letterId: 'letter-1',
      ...currentSnapshot('entity_extraction', 'queued'),
    }])).resolves.toEqual({
      message: 'Cleared 1 of 1 displayed entity_extraction queue items',
      requested: 1,
      cleared: 1,
      skipped: 0,
      skipReasons: [],
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      entityExtractionStatus: 'FAILED',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: 'Cleared from queue by admin',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.deadLetter', value: false },
      ]),
    });
  });

  it('clears only rows that remain in the durable extra-content queue', async () => {
    mockLetter({
      id: 'extra-1',
      extraContentJobStatus: 'PENDING',
    });

    await expect(clearQueue('extra_content', [{
      letterId: 'extra-1',
      ...currentSnapshot('extra_content', 'queued'),
    }])).resolves.toEqual({
      message: 'Cleared 1 of 1 displayed extra_content queue items',
      requested: 1,
      cleared: 1,
      skipped: 0,
      skipReasons: [],
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
        { kind: 'eq', field: 'letters.id', value: 'extra-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
      ]),
    });
  });

  it('returns truthful per-row outcomes for a frozen clear snapshot', async () => {
    const current = observedLetter({
      id: 'current-row',
      primarySourceRevision: 4,
      transcriptionStatus: 'PENDING',
    });
    const staleSnapshot = observedLetter({
      id: 'stale-row',
      primarySourceRevision: 4,
      transcriptionStatus: 'PENDING',
    });
    findFirstMock
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        ...staleSnapshot,
        primarySourceRevision: 5,
      });

    await expect(clearQueue('transcription', [
      {
        letterId: current.id,
        ...snapshotFor(current, 'transcription', 'queued'),
      },
      {
        letterId: staleSnapshot.id,
        ...snapshotFor(staleSnapshot, 'transcription', 'queued'),
      },
    ])).resolves.toEqual({
      message: 'Cleared 1 of 2 displayed transcription queue items',
      requested: 2,
      cleared: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'stale-row',
        code: 'SOURCE_REVISION_CHANGED',
      }],
    });
    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transcription only while it remains failed', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    mockLetter({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: observedAt,
    });

    await expect(retryJob(
      'letter-1',
      'transcription',
      currentSnapshot('transcription', 'recent'),
    )).resolves.toEqual({
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
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'FAILED' },
        {
          kind: 'inArray',
          field: 'letters.type',
          values: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
        },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
        expect.objectContaining({ kind: 'exists' }),
        {
          kind: 'sql',
          strings: ["date_trunc('milliseconds', ", ') = ', '::timestamptz'],
          values: ['letters.updatedAt', observedAt.toISOString()],
        },
      ]),
    });
  });

  it.each([
    ['a non-transcribable type', { type: 'P' }],
    ['running metadata', { metadataStatus: 'RUNNING' }],
    ['running entity extraction', { entityExtractionStatus: 'RUNNING' }],
  ])('rejects a transcription retry with %s', async (_label, overrides) => {
    mockLetter({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      ...overrides,
    });

    await expect(retryJob(
      'letter-1',
      'transcription',
      currentSnapshot('transcription', 'recent'),
    )).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: transcription prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects retry when another owner moves the failed transcription first', async () => {
    mockLetter({
      id: 'letter-1',
      type: 'L',
      transcriptionStatus: 'FAILED',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob(
      'letter-1',
      'transcription',
      currentSnapshot('transcription', 'recent'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
  });

  it('retries failed metadata jobs by clearing the error', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    mockLetter({
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

    const result = await retryJob(
      'letter-2',
      'metadata',
      currentSnapshot('metadata', 'recent'),
    );

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
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-2' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
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
      ]),
    });
  });

  it.each([
    ['an unconfirmed transcript', { transcriptConfirmedAt: null }],
    ['a blank transcript', { transcriptionText: '   ' }],
    ['a running transcription', { transcriptionStatus: 'RUNNING' }],
    ['running entity extraction', { entityExtractionStatus: 'RUNNING' }],
    ['running extra-content work', { extraContentJobStatus: 'RUNNING' }],
  ])('rejects a metadata retry with %s', async (_label, overrides) => {
    mockLetter({
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

    await expect(retryJob(
      'letter-2',
      'metadata',
      currentSnapshot('metadata', 'recent'),
    )).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: metadata prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('makes an explicitly retried entity job claimable again', async () => {
    mockLetter({
      id: 'letter-entity',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'FAILED',
      deadLetter: true,
      updatedAt: new Date('2026-07-17T12:00:00Z'),
    });

    await expect(
      retryJob(
        'letter-entity',
        'entity_extraction',
        currentSnapshot('entity_extraction', 'recent'),
      ),
    ).resolves.toEqual({
      message: 'Retrying entity_extraction for letter letter-entity',
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      entityExtractionStatus: 'PENDING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: null,
      deadLetter: false,
    }));
  });

  it('does not clear dead-letter state for an ineligible entity retry', async () => {
    mockLetter({
      id: 'letter-entity',
      type: 'L',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'FAILED',
      entityExtractionStatus: 'FAILED',
      deadLetter: true,
      updatedAt: new Date('2026-07-17T12:00:00Z'),
    });

    await expect(
      retryJob(
        'letter-entity',
        'entity_extraction',
        currentSnapshot('entity_extraction', 'recent'),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: entity extraction prerequisites are not satisfied',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('retries failed extra-content work with a fresh durable ownership tuple', async () => {
    const observedAt = new Date('2026-07-23T12:00:00.000Z');
    mockLetter({
      id: 'letter-extra',
      type: 'L',
      extraContentJobStatus: 'FAILED',
      updatedAt: observedAt,
    });

    await expect(retryJob(
      'letter-extra',
      'extra_content',
      currentSnapshot('extra_content', 'recent'),
    )).resolves.toEqual({
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
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-extra' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
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
      ]),
    });
  });

  it('rejects an extra-content retry whose durable prerequisites lose the CAS', async () => {
    mockLetter({
      id: 'letter-extra',
      type: 'L',
      extraContentJobStatus: 'FAILED',
      updatedAt: new Date('2026-07-23T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(retryJob(
      'letter-extra',
      'extra_content',
      currentSnapshot('extra_content', 'recent'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
  });

  it('rejects an extra-content retry for a non-letter record', async () => {
    mockLetter({
      id: 'cover-extra',
      type: 'C',
      extraContentJobStatus: 'FAILED',
      updatedAt: new Date('2026-07-23T12:00:00.000Z'),
    });

    await expect(retryJob(
      'cover-extra',
      'extra_content',
      currentSnapshot('extra_content', 'recent'),
    )).rejects.toMatchObject({
      statusCode: 400,
      message: 'Cannot retry: extra content prerequisites are not satisfied',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('delegates transcription cancellation to the canonical exact-run lifecycle owner', async () => {
    mockLetter({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    const result = await cancelActiveJob(
      'letter-3',
      'transcription',
      currentSnapshot('transcription', 'active'),
    );

    expect(result).toEqual({ message: 'Job cancelled' });
    expect(cancelTranscriptionAttemptMock).toHaveBeenCalledWith(
      'letter-3',
      'run-a',
      'Cancelled by admin',
      4,
    );
  });

  it('delegates metadata cancellation to the canonical exact-run lifecycle owner', async () => {
    mockLetter({
      id: 'letter-4',
      metadataStatus: 'RUNNING',
      metadataRunId: 'metadata-run-a',
    });
    await expect(cancelActiveJob(
      'letter-4',
      'metadata',
      currentSnapshot('metadata', 'active'),
    )).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelMetadataAttemptMock).toHaveBeenCalledWith(
      'letter-4',
      'metadata-run-a',
      'Cancelled by admin',
      4,
    );
  });

  it('delegates extra-content cancellation to the canonical exact-run lifecycle owner', async () => {
    const letter = observedLetter({
      id: 'letter-extra',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'extra-run-a',
    });
    findFirstMock
      .mockResolvedValueOnce(letter)
      .mockResolvedValueOnce(null);

    await expect(cancelActiveJob(
      'letter-extra',
      'extra_content',
      snapshotFor(letter, 'extra_content', 'active'),
    )).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
      'Cancelled by admin',
      4,
    );
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('requests a worker when extra-content cancellation leaves durable queued work', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    const letter = observedLetter({
      id: 'letter-extra',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'extra-run-a',
    });
    findFirstMock
      .mockResolvedValueOnce(letter)
      .mockResolvedValueOnce({ id: 'letter-extra' });

    await expect(cancelActiveJob(
      'letter-extra',
      'extra_content',
      snapshotFor(letter, 'extra_content', 'active'),
    )).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
      'Cancelled by admin',
      4,
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
    const letter = observedLetter({
      id: 'letter-extra',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'extra-run-a',
    });
    findFirstMock
      .mockResolvedValueOnce(letter)
      .mockRejectedValueOnce(new Error('queue observation failed'));

    await expect(cancelActiveJob(
      'letter-extra',
      'extra_content',
      snapshotFor(letter, 'extra_content', 'active'),
    )).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelExtraContentAttemptMock).toHaveBeenCalledWith(
      'letter-extra',
      'extra-run-a',
      'Cancelled by admin',
      4,
    );
    expect(triggerWorkerJobMock).not.toHaveBeenCalled();
  });

  it('rejects extra-content cancellation after the observed run loses ownership', async () => {
    mockLetter({
      id: 'letter-extra',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'extra-run-a',
    });
    cancelExtraContentAttemptMock.mockResolvedValue(false);

    await expect(cancelActiveJob(
      'letter-extra',
      'extra_content',
      currentSnapshot('extra_content', 'active'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
  });

  it('cancels only the exact observed entity-extraction run', async () => {
    mockLetter({
      id: 'letter-5',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: 'entity-run-a',
      entityExtractionRunRevision: 4,
    });

    await expect(cancelActiveJob(
      'letter-5',
      'entity_extraction',
      currentSnapshot('entity_extraction', 'active'),
    )).resolves.toEqual({
      message: 'Job cancelled',
    });

    expect(cancelEntityExtractionAttemptMock).toHaveBeenCalledWith(
      'letter-5',
      { runId: 'entity-run-a', revision: 4 },
      'Cancelled by admin',
      4,
    );
  });

  it('cancels an observed tokenless legacy entity run after rollout drain', async () => {
    mockLetter({
      id: 'letter-legacy',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
    });

    await expect(cancelActiveJob(
      'letter-legacy',
      'entity_extraction',
      currentSnapshot('entity_extraction', 'active'),
    )).resolves.toEqual({ message: 'Job cancelled' });

    expect(cancelLegacyEntityExtractionMock).toHaveBeenCalledWith(
      'letter-legacy',
      'Cancelled by admin',
      4,
    );
    expect(cancelEntityExtractionAttemptMock).not.toHaveBeenCalled();
  });

  it('cannot let a cancellation waiting behind commit overwrite SUCCESS', async () => {
    mockLetter({
      id: 'letter-5',
      entityExtractionStatus: 'RUNNING',
      entityExtractionRunId: 'entity-run-a',
      entityExtractionRunRevision: 4,
    });
    // False characterizes the interleaving where the materialization
    // transaction held the letter lock first and cleared the token on SUCCESS.
    cancelEntityExtractionAttemptMock.mockResolvedValue(false);

    await expect(
      cancelActiveJob(
        'letter-5',
        'entity_extraction',
        currentSnapshot('entity_extraction', 'active'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('reports only expired attempts returned by the leased lifecycle owners', async () => {
    recoverExpiredTranscriptionsMock.mockResolvedValue({
      requeued: [{ id: 'letter-orphan', dateRaw: '19470813' }],
      failed: [],
    });

    recoverExpiredEntityExtractionJobsMock.mockResolvedValue({
      requeued: [{ id: 'entity-orphan', dateRaw: '19470815' }],
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
      entityExtraction: {
        requeued: [{ id: 'entity-orphan', dateRaw: '19470815' }],
        failed: [],
      },
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
        count: 3,
        letterIds: ['letter-orphan', 'entity-orphan', 'extra-orphan'],
        transcriptionRequeued: 1,
        transcriptionFailed: 0,
        entityExtractionRequeued: 1,
        entityExtractionFailed: 0,
        extraContentRequeued: 0,
        extraContentFailed: 1,
      }),
    }));
  });

  it('does not report live or unknown leases that were not recovered', async () => {
    await expect(recoverExpiredProcessingJobs()).resolves.toEqual({
      transcription: { requeued: [], failed: [] },
      metadata: { requeued: [], failed: [] },
      entityExtraction: { requeued: [], failed: [] },
      extraContent: { requeued: [], failed: [] },
    });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('binds every worker recovery statement to its execution token', async () => {
    await recoverExpiredProcessingJobs({
      workerExecutionToken: 'execution-a',
    });

    expect(recoverExpiredTranscriptionsMock).toHaveBeenCalledWith('execution-a');
    expect(recoverExpiredMetadataJobsMock).toHaveBeenCalledWith('execution-a');
    expect(recoverExpiredEntityExtractionJobsMock).toHaveBeenCalledWith('execution-a');
    expect(recoverExpiredExtraContentJobsMock).toHaveBeenCalledWith('execution-a');
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
      entityExtraction: { requeued: [], failed: [] },
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
      entityExtraction: { requeued: [], failed: [] },
      extraContent: {
        requeued: [{ id: 'extra-orphan', dateRaw: '19470814' }],
        failed: [],
      },
    });

    expect(recoverExpiredExtraContentJobsMock).toHaveBeenCalledOnce();
  });

  it('awaits a worker wake whenever any durable queued stage exists', async () => {
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    mockLetter({ id: 'queued-letter' });

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
          {
            kind: 'ne',
            field: 'letters.metadataStatus',
            value: 'RUNNING',
          },
          expect.objectContaining({
            kind: 'sql',
            strings: expect.arrayContaining([
              expect.stringContaining("rel.type IN ('T', 'C', 'E')"),
            ]),
          }),
          {
            kind: 'ne',
            field: 'letters.entityExtractionStatus',
            value: 'RUNNING',
          },
          { kind: 'eq', field: 'letters.extraContentJobStatus', value: 'PENDING' },
        ],
      },
      columns: { id: true },
    });
  });

  it('propagates a failed worker wake so periodic recovery can retry it', async () => {
    const failure = new Error('Cloud Run unavailable');
    shouldUseCloudRunWorkerJobMock.mockReturnValue(true);
    mockLetter({ id: 'queued-letter' });
    triggerWorkerJobMock.mockRejectedValue(failure);

    await expect(
      ensureBackgroundWorkerForQueuedProcessing('lease-recovery'),
    ).rejects.toBe(failure);
  });

  it('rejects cancellation when the observed transcription attempt loses ownership', async () => {
    mockLetter({
      id: 'letter-3',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: 'run-a',
    });
    cancelTranscriptionAttemptMock.mockResolvedValue(false);

    await expect(cancelActiveJob(
      'letter-3',
      'transcription',
      currentSnapshot('transcription', 'active'),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCESSING_JOB_CHANGED',
    });
  });

});
