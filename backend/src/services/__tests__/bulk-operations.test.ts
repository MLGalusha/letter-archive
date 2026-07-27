import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  dbTransactionMock,
  txDeleteMock,
  deleteWhereMock,
  requestBackgroundWorkerRunMock,
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
  dbTransactionMock: vi.fn(),
  txDeleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  requestBackgroundWorkerRunMock: vi.fn(),
  propagateNameMock: vi.fn(),
  propagatePlaceholderReplacementMock: vi.fn(),
  commitDirectIdentityFieldMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  isPlaceholderValueMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  exists: vi.fn((query: unknown) => ({ kind: 'exists', query })),
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
  txDeleteMock.mockImplementation(() => ({ where: deleteWhereMock }));
  const transactionExecutor = {
    query: { letters: { findFirst: findFirstMock } },
    update: dbUpdateMock,
    delete: txDeleteMock,
  };
  dbTransactionMock.mockImplementation(async (
    callback: (tx: typeof transactionExecutor) => unknown,
  ) => callback(transactionExecutor));
  return {
    db: {
      query: { letters: { findMany: findManyMock, findFirst: findFirstMock } },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => ({
            kind: 'subquery',
            condition,
          })),
        })),
      })),
      update: dbUpdateMock,
      transaction: dbTransactionMock,
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      type: 'letters.type',
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
      metadataRunRevision: 'letters.metadataRunRevision',
      metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
      metadataLeaseRunId: 'letters.metadataLeaseRunId',
      metadataClaimKind: 'letters.metadataClaimKind',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      entityExtractionLeaseExpiresAt: 'letters.entityExtractionLeaseExpiresAt',
      entityExtractionLeaseRunId: 'letters.entityExtractionLeaseRunId',
      entityExtractionClaimKind: 'letters.entityExtractionClaimKind',
      extraContentTranscript: 'letters.extraContentTranscript',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      extraContentJobRunId: 'letters.extraContentJobRunId',
      deadLetter: 'letters.deadLetter',
      transcriptStatus: 'letters.transcriptStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
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
    letterPages: {
      letterId: 'letterPages.letterId',
    },
    letterPersons: { letterId: 'letterPersons.letterId' },
    letterPlaces: { letterId: 'letterPlaces.letterId' },
    personRelationships: {
      discoveredInLetterId: 'personRelationships.discoveredInLetterId',
    },
  };
});

vi.mock('../processing-queue.js', () => ({
  requestBackgroundWorkerRun: requestBackgroundWorkerRunMock,
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
    source: {
      sender: string | null;
      recipient: string | null;
      primarySourceRevision: number;
      metadataRevision: number;
      updatedAt: Date;
    },
    field: 'sender' | 'recipient',
  ) => ({
    value: source[field],
    primarySourceRevision: source.primarySourceRevision,
    metadataRevision: source.metadataRevision,
    updatedAt: source.updatedAt,
  }),
}));

vi.mock('../../utils/placeholders.js', () => ({
  isPlaceholderValue: isPlaceholderValueMock,
}));

vi.mock('../letter/shared.js', () => ({
  TRANSCRIBABLE_TYPES: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
  isTranscribableType: vi.fn(() => true),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkExtractMetadata,
  bulkTranscribe,
  bulkUpdateFields,
} from '../letter/bulk-operations.js';

const uploadedLetter = {
  id: 'letter-1',
  primarySourceRevision: 7,
  type: 'L',
  workflow: 'UPLOADED',
  transcriptionStatus: 'PENDING',
  transcriptionText: null,
  transcriptConfirmedAt: null,
  transcriptionError: null,
  transcriptionAttemptCount: 0,
  transcriptionRunId: null,
  transcriptionLeaseExpiresAt: null,
  transcriptionLeaseRunId: null,
  transcriptionClaimKind: null,
  metadataStatus: 'PENDING',
  metadataRunId: null,
  metadataRunRevision: null,
  metadataLeaseExpiresAt: null,
  metadataLeaseRunId: null,
  metadataClaimKind: null,
  metadataContentStatus: 'EMPTY',
  metadataVerifiedAt: null,
  metadataVerifiedBy: null,
  entityExtractionStatus: 'PENDING',
  entityExtractionRunId: null,
  entityExtractionRunRevision: null,
  entityExtractionLeaseExpiresAt: null,
  entityExtractionLeaseRunId: null,
  entityExtractionClaimKind: null,
  extraContentTranscript: null,
  extraContentJobStatus: 'PENDING',
  extraContentJobRunId: null,
  deadLetter: false,
  transcriptStatus: 'EMPTY',
  pages: [{ id: 'page-1' }],
};
const uploadedSource = {
  letterId: uploadedLetter.id,
  primarySourceRevision: uploadedLetter.primarySourceRevision,
};

describe('bulk transcription ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([uploadedLetter]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    requestBackgroundWorkerRunMock.mockResolvedValue(undefined);
  });

  it('queues only rows that are still idle and clears any stale run fence', async () => {
    await expect(bulkTranscribe([uploadedSource])).resolves.toMatchObject({
      requested: 1,
      queued: 1,
      skipped: 0,
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
            {
              kind: 'and',
              clauses: [
                { kind: 'eq', field: 'letters.id', value: 'letter-1' },
                { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
              ],
            },
            {
              kind: 'inArray',
              field: 'letters.type',
              values: ['L', 'T', 'C', 'E', 'N', 'A', 'D'],
            },
            { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
            { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
            expect.objectContaining({ kind: 'exists' }),
            { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
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
    expect(requestBackgroundWorkerRunMock).toHaveBeenCalledWith('bulk:transcription');
  });

  it('does not revoke a transcription claimed after the eligibility read', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkTranscribe([uploadedSource])).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Transcription eligibility changed before it could be queued',
      }],
    });

    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it.each([
    ['metadata', { metadataStatus: 'RUNNING' }, 'Metadata extraction already running'],
    ['entity', { entityExtractionStatus: 'RUNNING' }, 'Entity extraction already running'],
  ])('does not queue overwrite transcription while %s work is active', async (
    _stage,
    override,
    reason,
  ) => {
    findManyMock.mockResolvedValue([{ ...uploadedLetter, ...override }]);

    await expect(bulkTranscribe([uploadedSource], true)).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{ letterId: 'letter-1', code: 'INELIGIBLE', reason }],
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it('makes an explicitly requeued dead-lettered transcription claimable again', async () => {
    findManyMock.mockResolvedValue([{
      ...uploadedLetter,
      transcriptionStatus: 'FAILED',
      transcriptionError: 'Maximum attempts reached',
      transcriptionAttemptCount: 3,
      deadLetter: true,
    }]);

    await expect(bulkTranscribe([uploadedSource])).resolves.toMatchObject({
      requested: 1,
      queued: 1,
      skipped: 0,
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

    const result = await bulkTranscribe([uploadedSource]);

    expect(result).toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Transcription eligibility changed before it could be queued',
      }],
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
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it('atomically resets overwrite state in the guarded queue transition', async () => {
    findManyMock.mockResolvedValue([{ ...uploadedLetter, workflow: 'PUBLISHED' }]);

    await bulkTranscribe([uploadedSource], true);

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
    transcriptionText: 'Dear Bob',
    transcriptConfirmedAt: new Date('2026-01-01T00:00:00Z'),
    metadataStatus: 'SUCCESS',
    metadataRevision: 0,
    extraContentJobStatus: 'SUCCESS',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([metadataLetter]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    requestBackgroundWorkerRunMock.mockResolvedValue(undefined);
  });

  it('reports an explicit skip while retranscription is already running', async () => {
    findManyMock.mockResolvedValue([{
      ...metadataLetter,
      transcriptionStatus: 'RUNNING',
    }]);

    await expect(bulkExtractMetadata([uploadedSource])).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'INELIGIBLE',
        reason: 'Transcription already running',
      }],
      unconfirmedCount: 0,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      { transcriptionText: '   ' },
      'No transcript text available',
    ],
    [
      { entityExtractionStatus: 'RUNNING' },
      'Entity extraction already running',
    ],
    [
      { extraContentJobStatus: 'RUNNING' },
      'Extra-content transcription already running',
    ],
  ])('does not queue metadata across an ineligible source or active downstream stage', async (
    override,
    reason,
  ) => {
    findManyMock.mockResolvedValue([{
      ...metadataLetter,
      ...override,
    }]);

    await expect(bulkExtractMetadata([uploadedSource])).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{ letterId: 'letter-1', code: 'INELIGIBLE', reason }],
      unconfirmedCount: 0,
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it('queues metadata through a transcription-idle compare-and-set', async () => {
    await expect(bulkExtractMetadata([uploadedSource])).resolves.toMatchObject({
      requested: 1,
      queued: 1,
      skipped: 0,
    });

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'or',
      clauses: [{
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'and',
            clauses: [
              { kind: 'eq', field: 'letters.id', value: 'letter-1' },
              { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
            ],
          },
          { kind: 'eq', field: 'letters.type', value: 'L' },
          { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
          { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
          { kind: 'eq', field: 'letters.transcriptionText', value: 'Dear Bob' },
          {
            kind: 'eq',
            field: 'letters.transcriptConfirmedAt',
            value: metadataLetter.transcriptConfirmedAt,
          },
          { kind: 'eq', field: 'letters.metadataRevision', value: 0 },
          { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
          { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
          { kind: 'eq', field: 'letters.deadLetter', value: false },
        ]),
      }],
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataStatus: 'PENDING',
      metadataAttemptCount: 0,
      deadLetter: false,
    }));
    expect(requestBackgroundWorkerRunMock).toHaveBeenCalledWith('bulk:metadata');
  });

  it('does not report metadata queued when transcription wins after the read', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkExtractMetadata([uploadedSource])).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Metadata eligibility changed before it could be queued',
      }],
      unconfirmedCount: 0,
    });
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it('keeps unconfirmed transcripts out of the metadata queue', async () => {
    findManyMock.mockResolvedValue([{
      ...metadataLetter,
      transcriptConfirmedAt: null,
    }]);

    await expect(bulkExtractMetadata([uploadedSource])).resolves.toEqual({
      requested: 1,
      queued: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'INELIGIBLE',
        reason: 'Transcript not yet confirmed',
      }],
      unconfirmedCount: 1,
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });
});

describe('bulk clear entity ownership revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([uploadedLetter]);
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    deleteWhereMock.mockResolvedValue(undefined);
  });

  it.each([
    ['transcription', bulkClearTranscriptions],
    ['metadata', bulkClearMetadata],
  ])('clearing %s revokes the complete entity owner tuple', async (
    _scope,
    clear,
  ) => {
    await expect(clear([uploadedSource])).resolves.toEqual({
      requested: 1,
      applied: 1,
      skipped: 0,
      skipReasons: [],
    });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      entityExtractionStatus: 'FAILED',
      entityExtractionRunId: null,
      entityExtractionRunRevision: null,
      entityExtractionLeaseExpiresAt: null,
      entityExtractionLeaseRunId: null,
      entityExtractionClaimKind: null,
      entityExtractionError: 'Cleared by admin',
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        {
          kind: 'or',
          clauses: [{
            kind: 'and',
            clauses: [
              { kind: 'eq', field: 'letters.id', value: 'letter-1' },
              { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
            ],
          }],
        },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      ]),
    });
    expect(txDeleteMock).toHaveBeenCalledTimes(3);
  });

  it('reports a guarded clear that loses its source-or-idle predicate', async () => {
    updateReturningMock.mockResolvedValue([]);

    await expect(bulkClearTranscriptions([uploadedSource])).resolves.toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        reason: 'Letter source or processing state changed before it could be cleared',
      }],
    });
    expect(txDeleteMock).not.toHaveBeenCalled();
  });
});

describe('bulk source revision admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([{
      ...uploadedLetter,
      primarySourceRevision: uploadedLetter.primarySourceRevision + 1,
    }]);
  });

  it.each([
    ['transcription', () => bulkTranscribe([uploadedSource])],
    ['metadata extraction', () => bulkExtractMetadata([uploadedSource])],
    ['transcription clearing', () => bulkClearTranscriptions([uploadedSource])],
    ['metadata clearing', () => bulkClearMetadata([uploadedSource])],
  ])('rejects stale source ownership before %s', async (_scope, mutate) => {
    await expect(mutate()).resolves.toMatchObject({
      requested: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      }],
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });
});

describe('bulk identity update ownership', () => {
  const observedAt = new Date('2026-07-17T12:00:00.000Z');
  const identityLetter = {
    id: 'letter-1',
    primarySourceRevision: 7,
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
      primarySourceRevision: 7,
      sender: identityLetter.sender,
      recipient: identityLetter.recipient,
    }])).resolves.toEqual({
      requested: 1,
      applied: 1,
      skipped: 0,
      updated: 0,
      skipReasons: [],
    });

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
      primarySourceRevision: 7,
      sender: 'Jimmy',
      recipient: 'Mary',
    }])).resolves.toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      updated: 0,
      skipReasons: [{
        letterId: identityLetter.id,
        code: 'WRITE_CONFLICT',
      }],
    });

    expect(propagateNameMock).toHaveBeenNthCalledWith(
      2,
      {
        letterId: identityLetter.id,
        field: 'recipient',
        oldName: 'Molly',
        newName: 'Mary',
        observed: {
          value: 'Molly',
          primarySourceRevision: 7,
          metadataRevision: 5,
          updatedAt: senderCommittedAt,
        },
      },
      expect.any(Object),
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledTimes(1);
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: identityLetter.id,
      sender: 'Jimmy',
      database: expect.any(Object),
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
      primarySourceRevision: 7,
      sender: 'Jimmy',
      recipient: 'Mary',
    }])).resolves.toEqual({
      requested: 1,
      applied: 1,
      skipped: 0,
      updated: 1,
      skipReasons: [],
    });

    expect(commitDirectIdentityFieldMock).toHaveBeenCalledWith(
      {
        letter: senderCommitted,
        field: 'recipient',
        value: 'Mary',
      },
      expect.any(Object),
    );
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(1, {
      letterId: identityLetter.id,
      sender: 'Jimmy',
      database: expect.any(Object),
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(2, {
      letterId: identityLetter.id,
      recipient: 'Mary',
      database: expect.any(Object),
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
      primarySourceRevision: 7,
      sender: 'Jimmy',
    }])).resolves.toEqual({
      requested: 1,
      applied: 0,
      skipped: 1,
      updated: 0,
      skipReasons: [{
        letterId: identityLetter.id,
        code: 'WRITE_CONFLICT',
      }],
    });

    expect(commitDirectIdentityFieldMock).toHaveBeenCalledWith(
      {
        letter: identityLetter,
        field: 'sender',
        value: 'Jimmy',
      },
      expect.any(Object),
    );
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('continues after a stale source and reports the mixed result truthfully', async () => {
    const currentLetter = { ...identityLetter, id: 'letter-current' };
    const staleLetter = {
      ...identityLetter,
      id: 'letter-stale',
      primarySourceRevision: 8,
    };
    const committed = {
      ...currentLetter,
      sender: 'Jimmy',
      metadataRevision: 5,
    };
    findFirstMock
      .mockResolvedValueOnce(currentLetter)
      .mockResolvedValueOnce(staleLetter)
      .mockResolvedValueOnce(staleLetter);
    propagateNameMock.mockResolvedValueOnce({
      letter: committed,
      fieldsUpdated: ['sender'],
    });

    await expect(bulkUpdateFields([
      {
        letterId: currentLetter.id,
        primarySourceRevision: 7,
        sender: 'Jimmy',
      },
      {
        letterId: staleLetter.id,
        primarySourceRevision: 7,
        sender: 'James',
      },
    ])).resolves.toEqual({
      requested: 2,
      applied: 1,
      skipped: 1,
      updated: 1,
      skipReasons: [{
        letterId: staleLetter.id,
        code: 'SOURCE_CHANGED',
      }],
    });

    expect(propagateNameMock).toHaveBeenCalledOnce();
  });
});
