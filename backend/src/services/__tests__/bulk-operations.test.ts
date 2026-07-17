import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  getProcessingStatusMock,
  processLettersAsyncMock,
  resetProcessingStateMock,
  shouldUseCloudRunWorkerJobMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  getProcessingStatusMock: vi.fn(),
  processLettersAsyncMock: vi.fn(),
  resetProcessingStateMock: vi.fn(),
  shouldUseCloudRunWorkerJobMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  return {
    db: {
      query: { letters: { findMany: findManyMock } },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      transcriptionStatus: 'letters.transcriptionStatus',
      workflow: 'letters.workflow',
      transcriptionText: 'letters.transcriptionText',
      transcriptionError: 'letters.transcriptionError',
      transcriptionAttemptCount: 'letters.transcriptionAttemptCount',
      transcriptionRunId: 'letters.transcriptionRunId',
      deadLetter: 'letters.deadLetter',
      transcriptStatus: 'letters.transcriptStatus',
    },
    letterPersons: {},
    letterPlaces: {},
    personRelationships: {},
  };
});

vi.mock('../processing-queue.js', () => ({
  getProcessingStatus: getProcessingStatusMock,
  processLettersAsync: processLettersAsyncMock,
  requestBackgroundWorkerRun: vi.fn(),
  resetProcessingState: resetProcessingStateMock,
}));

vi.mock('../cloud-run-job.js', () => ({
  shouldUseCloudRunWorkerJob: shouldUseCloudRunWorkerJobMock,
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: vi.fn(),
}));

vi.mock('../name-propagation.js', () => ({
  propagateName: vi.fn(),
  propagatePlaceholderReplacement: vi.fn(),
}));

vi.mock('../../utils/placeholders.js', () => ({
  isPlaceholderValue: vi.fn(),
}));

vi.mock('../letter/shared.js', () => ({
  isTranscribableType: vi.fn(() => true),
  log: { info: vi.fn() },
}));

import { bulkTranscribe } from '../letter/bulk-operations.js';

const uploadedLetter = {
  id: 'letter-1',
  type: 'L',
  workflow: 'UPLOADED',
  transcriptionStatus: 'PENDING',
  transcriptionText: null,
  transcriptionError: null,
  transcriptionAttemptCount: 0,
  transcriptionRunId: null,
  deadLetter: false,
  transcriptStatus: 'EMPTY',
  pages: [{ id: 'page-1' }],
};

describe('bulk transcription ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([uploadedLetter]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    getProcessingStatusMock.mockReturnValue({ isRunning: true });
    shouldUseCloudRunWorkerJobMock.mockReturnValue(false);
  });

  it('queues only rows that are still idle and clears any stale run fence', async () => {
    await expect(bulkTranscribe(['letter-1'])).resolves.toMatchObject({
      queued: 1,
      skipped: 0,
      processing: false,
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'or',
      clauses: [
        {
          kind: 'and',
          clauses: [
            { kind: 'eq', field: 'letters.id', value: 'letter-1' },
            { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
            { kind: 'eq', field: 'letters.workflow', value: 'UPLOADED' },
            { kind: 'isNull', field: 'letters.transcriptionText' },
            { kind: 'isNull', field: 'letters.transcriptionError' },
            { kind: 'eq', field: 'letters.transcriptionAttemptCount', value: 0 },
            { kind: 'isNull', field: 'letters.transcriptionRunId' },
            { kind: 'eq', field: 'letters.deadLetter', value: false },
            { kind: 'eq', field: 'letters.transcriptStatus', value: 'EMPTY' },
          ],
        },
      ],
    });
  });

  it('does not revoke a transcription claimed after the eligibility read', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkTranscribe(['letter-1'])).resolves.toEqual({
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        reason: 'Transcription changed before it could be queued',
      }],
      processing: false,
    });

    expect(processLettersAsyncMock).not.toHaveBeenCalled();
    expect(resetProcessingStateMock).not.toHaveBeenCalled();
  });

  it('makes an explicitly requeued dead-lettered transcription claimable again', async () => {
    findManyMock.mockResolvedValue([{
      ...uploadedLetter,
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Maximum attempts reached',
      transcriptionAttemptCount: 3,
      deadLetter: true,
    }]);

    await expect(bulkTranscribe(['letter-1'])).resolves.toMatchObject({
      queued: 1,
      skipped: 0,
      processing: false,
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'or',
      clauses: [expect.objectContaining({
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'eq', field: 'letters.transcriptionStatus', value: 'FAILED' },
          { kind: 'eq', field: 'letters.transcriptionAttemptCount', value: 3 },
          { kind: 'eq', field: 'letters.deadLetter', value: true },
        ]),
      })],
    }));
  });

  it('does not overwrite a newer non-running human transcript revision', async () => {
    updateReturningMock.mockResolvedValue([]);

    const result = await bulkTranscribe(['letter-1']);

    expect(result).toEqual({
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        reason: 'Transcription changed before it could be queued',
      }],
      processing: false,
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'or',
      clauses: [expect.objectContaining({
        kind: 'and',
        clauses: expect.arrayContaining([
          { kind: 'eq', field: 'letters.transcriptionStatus', value: 'PENDING' },
          { kind: 'eq', field: 'letters.workflow', value: 'UPLOADED' },
          { kind: 'isNull', field: 'letters.transcriptionText' },
          { kind: 'eq', field: 'letters.transcriptStatus', value: 'EMPTY' },
        ]),
      })],
    }));
    expect(processLettersAsyncMock).not.toHaveBeenCalled();
  });

  it('atomically resets overwrite state in the guarded queue transition', async () => {
    findManyMock.mockResolvedValue([{ ...uploadedLetter, workflow: 'PUBLISHED' }]);

    await bulkTranscribe(['letter-1'], true);

    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionError: null,
      workflow: 'UPLOADED',
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: expect.any(Date),
    });
  });
});
