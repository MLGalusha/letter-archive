import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyCollectionsMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  processLetterMock,
  processMetadataMock,
  runEntityExtractionOnlyMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyCollectionsMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  processLetterMock: vi.fn(),
  processMetadataMock: vi.fn(),
  runEntityExtractionOnlyMock: vi.fn(),
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
  getJobProgress,
  getProcessingStatus,
  removeFromQueue,
  resetProcessingState,
  retryJob,
  updateJobProgress,
} from '../processing-queue.js';

describe('processing queue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyCollectionsMock.mockResolvedValue([]);
    findFirstMock.mockResolvedValue(null);
    updateWhereMock.mockResolvedValue(undefined);
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
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Removed from queue by admin',
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'eq',
      field: 'letters.id',
      value: 'letter-1',
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
    });
    updateJobProgress('letter-3', 'transcription', 2, 5, 'Extracting OCR');

    const result = await cancelActiveJob('letter-3', 'transcription');

    expect(result).toEqual({ message: 'Job cancelled' });
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Cancelled by admin',
      workflow: 'UPLOADED',
      updatedAt: expect.any(Date),
    });
    expect(getJobProgress('letter-3', 'transcription')).toBeUndefined();
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
