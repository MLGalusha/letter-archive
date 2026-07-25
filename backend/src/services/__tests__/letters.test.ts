import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ kind: 'ne', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  gt: vi.fn((field: unknown, value: unknown) => ({ kind: 'gt', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
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
          findMany: findManyMock,
        },
      },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      type: 'letters.type',
      typeSequence: 'letters.typeSequence',
      visibility: 'letters.visibility',
      transcriptionAttemptCount: 'letters.transcriptionAttemptCount',
      metadataAttemptCount: 'letters.metadataAttemptCount',
      transcriptionStatus: 'letters.transcriptionStatus',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionRevision: 'letters.entityExtractionRevision',
      entityExtractionRunId: 'letters.entityExtractionRunId',
      entityExtractionRunRevision: 'letters.entityExtractionRunRevision',
      entityExtractionError: 'letters.entityExtractionError',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      extraContentJobError: 'letters.extraContentJobError',
      extraContentJobRunId: 'letters.extraContentJobRunId',
      extraContentJobDirty: 'letters.extraContentJobDirty',
      extraContentJobLeaseExpiresAt: 'letters.extraContentJobLeaseExpiresAt',
      extraContentJobClaimKind: 'letters.extraContentJobClaimKind',
    },
    letterPages: {
      letterId: 'letterPages.letterId',
    },
  };
});

import {
  findLetterByIdentity,
  resolveRepresentativeLetterId,
  resetLetterForProcessing,
} from '../letters.js';

describe('letters service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([]);
  });

  it('finds a letter by its exact immutable identity', async () => {
    const existing = {
      id: 'letter-existing',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
    };
    findFirstMock.mockResolvedValue(existing);

    const result = await findLetterByIdentity({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
    });

    expect(result).toBe(existing);
  });

  it('returns undefined without creating a missing identity', async () => {
    await expect(findLetterByIdentity({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
    })).resolves.toBeUndefined();
  });

  it('resolves a companion row to the primary L-type representative', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'telegram-row',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    });
    findManyMock.mockResolvedValueOnce([
      { id: 'telegram-row', type: 'T' },
      { id: 'letter-row', type: 'L' },
      { id: 'cover-row', type: 'C' },
    ]);

    const result = await resolveRepresentativeLetterId('telegram-row');

    expect(result).toBe('letter-row');
  });

  it('can restrict representative resolution to published rows', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'cover-row',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    });
    findManyMock.mockResolvedValueOnce([
      { id: 'cover-row', type: 'C' },
      { id: 'published-letter-row', type: 'L' },
    ]);

    const result = await resolveRepresentativeLetterId('cover-row', { publishedOnly: true });

    expect(result).toBe('published-letter-row');
  });

  it('does not let a supplementary-only group establish a published representative', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'cover-row',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    });
    // The mock deliberately returns rows that the SQL predicate would reject,
    // exercising the in-process boundary as a second line of defense.
    findManyMock.mockResolvedValueOnce([
      { id: 'cover-row', type: 'C' },
      { id: 'telegram-row', type: 'T' },
    ]);

    const result = await resolveRepresentativeLetterId('cover-row', { publishedOnly: true });

    expect(result).toBeNull();
  });

  it('rejects a representative target from outside the requested collection', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'foreign-letter',
      collectionId: 'collection-2',
      dateRaw: '19470810',
      typeSequence: 1,
    });

    const result = await resolveRepresentativeLetterId('foreign-letter', {
      publishedOnly: true,
      collectionId: 'collection-1',
    });

    expect(result).toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('resets entity extraction state when re-enqueuing a letter for processing', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-3' }]);

    await expect(resetLetterForProcessing('letter-3', 4)).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'UPLOADED',
        transcriptionStatus: 'PENDING',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionLeaseRunId: null,
        transcriptionClaimKind: null,
        metadataStatus: 'PENDING',
        metadataRunId: null,
        entityExtractionStatus: 'PENDING',
        entityExtractionRunId: null,
        entityExtractionRunRevision: null,
        entityExtractionLeaseExpiresAt: null,
        entityExtractionLeaseRunId: null,
        entityExtractionClaimKind: null,
        entityExtractionError: null,
        entityExtractionJson: null,
        transcriptStatus: 'EMPTY',
        metadataContentStatus: 'EMPTY',
        transcriptConfirmedAt: null,
        transcriptConfirmedBy: null,
        transcriptPublished: false,
        metadataPublished: false,
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-3' },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 4 },
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
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
      ],
    });
  });
});
