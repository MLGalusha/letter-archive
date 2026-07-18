import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  getProcessingStatusMock,
  processLettersAsyncMock,
  resetProcessingStateMock,
  shouldUseCloudRunWorkerJobMock,
  propagateNameMock,
  propagatePlaceholderReplacementMock,
  commitDirectIdentityFieldMock,
  syncLetterParticipantsFromMetadataMock,
  isPlaceholderValueMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  getProcessingStatusMock: vi.fn(),
  processLettersAsyncMock: vi.fn(),
  resetProcessingStateMock: vi.fn(),
  shouldUseCloudRunWorkerJobMock: vi.fn(),
  propagateNameMock: vi.fn(),
  propagatePlaceholderReplacementMock: vi.fn(),
  commitDirectIdentityFieldMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  isPlaceholderValueMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
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
      query: { letters: { findMany: findManyMock, findFirst: findFirstMock } },
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
      transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
      transcriptionLeaseRunId: 'letters.transcriptionLeaseRunId',
      transcriptionClaimKind: 'letters.transcriptionClaimKind',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      deadLetter: 'letters.deadLetter',
      transcriptStatus: 'letters.transcriptStatus',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      metadataRunId: 'letters.metadataRunId',
      metadataRevision: 'letters.metadataRevision',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      metadataVerifiedAt: 'letters.metadataVerifiedAt',
      metadataVerifiedBy: 'letters.metadataVerifiedBy',
      metadataPublished: 'letters.metadataPublished',
      entityExtractionError: 'letters.entityExtractionError',
      updatedAt: 'letters.updatedAt',
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
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

vi.mock('../name-propagation.js', () => ({
  propagateName: propagateNameMock,
  propagatePlaceholderReplacement: propagatePlaceholderReplacementMock,
  commitDirectIdentityField: commitDirectIdentityFieldMock,
  isIdentityRevisionConflict: (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const status = 'status' in error ? error.status : undefined;
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    return status === 409 || statusCode === 409;
  },
  observeIdentityField: (
    source: { sender: string | null; recipient: string | null; metadataRevision: number; updatedAt: Date },
    field: 'sender' | 'recipient',
  ) => ({
    value: source[field],
    metadataRevision: source.metadataRevision,
    updatedAt: source.updatedAt,
  }),
}));

vi.mock('../../utils/placeholders.js', () => ({
  isPlaceholderValue: isPlaceholderValueMock,
}));

vi.mock('../letter/shared.js', () => ({
  isTranscribableType: vi.fn(() => true),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { bulkExtractMetadata, bulkTranscribe, bulkUpdateFields } from '../letter/bulk-operations.js';

const uploadedLetter = {
  id: 'letter-1',
  type: 'L',
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
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
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
            { kind: 'isNull', field: 'letters.transcriptionLeaseExpiresAt' },
            { kind: 'isNull', field: 'letters.transcriptionLeaseRunId' },
            { kind: 'isNull', field: 'letters.transcriptionClaimKind' },
            { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
            { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
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
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
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
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      workflow: 'UPLOADED',
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: expect.any(Date),
    });
  });
});

describe('bulk metadata downstream exclusion', () => {
  const metadataLetter = {
    ...uploadedLetter,
    workflow: 'TRANSCRIBED',
    transcriptionStatus: 'SUCCESS',
    transcriptConfirmedAt: new Date('2026-01-01T00:00:00Z'),
    metadataStatus: 'SUCCESS',
    metadataRevision: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([metadataLetter]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    getProcessingStatusMock.mockReturnValue({ isRunning: true });
    shouldUseCloudRunWorkerJobMock.mockReturnValue(false);
  });

  it('reports an explicit skip while retranscription is already running', async () => {
    findManyMock.mockResolvedValue([{
      ...metadataLetter,
      transcriptionStatus: 'RUNNING',
    }]);

    await expect(bulkExtractMetadata(['letter-1'])).resolves.toEqual({
      queued: 0,
      skipped: 1,
      skipReasons: [{ letterId: 'letter-1', reason: 'Transcription already running' }],
      processing: false,
      unconfirmedCount: 0,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('queues metadata through a transcription-idle compare-and-set', async () => {
    await expect(bulkExtractMetadata(['letter-1'])).resolves.toMatchObject({
      queued: 1,
      skipped: 0,
      processing: false,
    });

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'or',
      clauses: [{
        kind: 'and',
        clauses: [
          { kind: 'eq', field: 'letters.id', value: 'letter-1' },
          { kind: 'eq', field: 'letters.metadataRevision', value: 0 },
          { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
          { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        ],
      }],
    });
  });

  it('does not report metadata queued when transcription wins after the read', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkExtractMetadata(['letter-1'])).resolves.toEqual({
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        reason: 'Letter processing state changed before metadata could be queued',
      }],
      processing: false,
      unconfirmedCount: 0,
    });
    expect(processLettersAsyncMock).not.toHaveBeenCalled();
    expect(resetProcessingStateMock).not.toHaveBeenCalled();
  });
});

describe('bulk identity update ownership', () => {
  const observedAt = new Date('2026-07-17T12:00:00.000Z');
  const identityLetter = {
    id: 'letter-1',
    sender: 'Jimmie',
    recipient: 'Molly',
    metadataRevision: 4,
    updatedAt: observedAt,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(identityLetter);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    isPlaceholderValueMock.mockReturnValue(false);
    syncLetterParticipantsFromMetadataMock.mockResolvedValue(undefined);
  });

  it('does not mutate lifecycle state or participant links for same-value fields', async () => {
    await expect(bulkUpdateFields([{
      letterId: identityLetter.id,
      sender: identityLetter.sender,
      recipient: identityLetter.recipient,
    }])).resolves.toEqual({ message: 'Fields updated', updated: 0 });

    expect(propagateNameMock).not.toHaveBeenCalled();
    expect(propagatePlaceholderReplacementMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('chains the recipient write from the committed sender revision', async () => {
    const senderCommittedAt = new Date('2026-07-17T12:01:00.000Z');
    const senderCommitted = {
      ...identityLetter,
      sender: 'Jimmy',
      metadataRevision: 5,
      updatedAt: senderCommittedAt,
    };
    propagateNameMock
      .mockResolvedValueOnce({ letter: senderCommitted, fieldsUpdated: ['sender'] })
      .mockRejectedValueOnce(Object.assign(new Error('Recipient changed'), { status: 409 }));

    await expect(bulkUpdateFields([{
      letterId: identityLetter.id,
      sender: 'Jimmy',
      recipient: 'Mary',
    }])).rejects.toMatchObject({ status: 409 });

    expect(propagateNameMock).toHaveBeenNthCalledWith(2, {
      letterId: identityLetter.id,
      field: 'recipient',
      oldName: 'Molly',
      newName: 'Mary',
      observed: {
        value: 'Molly',
        metadataRevision: 5,
        updatedAt: senderCommittedAt,
      },
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledTimes(1);
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: identityLetter.id,
      sender: 'Jimmy',
    });
  });

  it('uses a revision-and-value CAS for a non-conflict fallback and then syncs only that role', async () => {
    const senderCommittedAt = new Date('2026-07-17T12:01:00.000Z');
    const recipientCommittedAt = new Date('2026-07-17T12:02:00.000Z');
    const senderCommitted = {
      ...identityLetter,
      sender: 'Jimmy',
      metadataRevision: 5,
      updatedAt: senderCommittedAt,
    };
    const recipientCommitted = {
      ...senderCommitted,
      recipient: 'Mary',
      metadataRevision: 6,
      updatedAt: recipientCommittedAt,
    };
    propagateNameMock
      .mockResolvedValueOnce({ letter: senderCommitted, fieldsUpdated: ['sender'] })
      .mockRejectedValueOnce(new Error('Unexpected propagation failure'));
    commitDirectIdentityFieldMock.mockResolvedValueOnce(recipientCommitted);

    await expect(bulkUpdateFields([{
      letterId: identityLetter.id,
      sender: 'Jimmy',
      recipient: 'Mary',
    }])).resolves.toEqual({ message: 'Fields updated', updated: 1 });

    expect(commitDirectIdentityFieldMock).toHaveBeenCalledWith({
      letter: senderCommitted,
      field: 'recipient',
      value: 'Mary',
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(1, {
      letterId: identityLetter.id,
      sender: 'Jimmy',
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(2, {
      letterId: identityLetter.id,
      recipient: 'Mary',
    });
  });

  it('returns a conflict and skips participant sync when the guarded fallback loses', async () => {
    propagateNameMock.mockRejectedValueOnce(new Error('Unexpected propagation failure'));
    commitDirectIdentityFieldMock.mockRejectedValueOnce(Object.assign(
      new Error('Metadata changed during identity update'),
      { status: 409 },
    ));

    await expect(bulkUpdateFields([{
      letterId: identityLetter.id,
      sender: 'Jimmy',
    }])).rejects.toMatchObject({ status: 409 });

    expect(commitDirectIdentityFieldMock).toHaveBeenCalledWith({
      letter: identityLetter,
      field: 'sender',
      value: 'Jimmy',
    });
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });
});
