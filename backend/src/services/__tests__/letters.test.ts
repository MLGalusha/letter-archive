import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
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
  isNotNull: vi.fn((field: unknown) => ({ kind: 'isNotNull', field })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbInsertMock.mockImplementation(() => ({
    values: insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
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
      insert: dbInsertMock,
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
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
      extraContentJobStatus: 'letters.extraContentJobStatus',
      extraContentJobError: 'letters.extraContentJobError',
      extraContentJobRunId: 'letters.extraContentJobRunId',
      extraContentJobDirty: 'letters.extraContentJobDirty',
      extraContentJobLeaseExpiresAt: 'letters.extraContentJobLeaseExpiresAt',
      extraContentJobClaimKind: 'letters.extraContentJobClaimKind',
    },
  };
});

import {
  findOrCreateLetter,
  claimJob,
  invalidateExtraContentJobForSourceChange,
  resolveRepresentativeLetterId,
  resetLetterForProcessing,
  updateMetadataV2,
  updateMetadataStatus,
} from '../letters.js';

describe('letters service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      {
        id: 'letter-new',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        type: 'L',
        typeSequence: 1,
      },
    ]);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([]);
  });

  it('returns an existing letter instead of creating a duplicate', async () => {
    const existing = {
      id: 'letter-existing',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
    };
    findFirstMock.mockResolvedValue(existing);

    const result = await findOrCreateLetter({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'L',
      typeSequence: 1,
      letterDate: '1947-08-10',
      dateConfidence: 'exact',
    });

    expect(result).toBe(existing);
    expect(dbInsertMock).not.toHaveBeenCalled();
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

  it('invalidates only the matching L-type extra-content job identity', async () => {
    await invalidateExtraContentJobForSourceChange({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 2,
    });

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.collectionId', value: 'collection-1' },
        { kind: 'eq', field: 'letters.dateRaw', value: '19470810' },
        { kind: 'eq', field: 'letters.type', value: 'L' },
        { kind: 'eq', field: 'letters.typeSequence', value: 2 },
      ],
    });

    const updates = updateSetMock.mock.calls[0]?.[0];
    expect(updates).toMatchObject({
      extraContentJobStatus: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus', 'letters.extraContentJobStatus'],
      },
      extraContentJobError: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus', 'letters.extraContentJobError'],
      },
      extraContentJobRunId: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus', 'letters.extraContentJobRunId'],
      },
      extraContentJobLeaseExpiresAt: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus', 'letters.extraContentJobLeaseExpiresAt'],
      },
      extraContentJobClaimKind: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus', 'letters.extraContentJobClaimKind'],
      },
      extraContentJobDirty: {
        kind: 'sql',
        values: ['letters.extraContentJobStatus'],
      },
      updatedAt: expect.any(Date),
    });

    const statusSql = updates.extraContentJobStatus.strings.join('?').replace(/\s+/g, ' ');
    const errorSql = updates.extraContentJobError.strings.join('?').replace(/\s+/g, ' ');
    const runIdSql = updates.extraContentJobRunId.strings.join('?').replace(/\s+/g, ' ');
    const leaseSql = updates.extraContentJobLeaseExpiresAt.strings.join('?').replace(/\s+/g, ' ');
    const claimKindSql = updates.extraContentJobClaimKind.strings.join('?').replace(/\s+/g, ' ');
    const dirtySql = updates.extraContentJobDirty.strings.join('?').replace(/\s+/g, ' ');
    expect(statusSql).toContain("WHEN ? = 'RUNNING' THEN ? ELSE 'PENDING'::job_status");
    expect(errorSql).toContain("WHEN ? = 'RUNNING' THEN ? ELSE NULL");
    expect(runIdSql).toContain("WHEN ? = 'RUNNING' THEN ? ELSE NULL");
    expect(leaseSql).toContain("WHEN ? = 'RUNNING' THEN ? ELSE NULL");
    expect(claimKindSql).toContain("WHEN ? = 'RUNNING' THEN ? ELSE NULL");
    expect(dirtySql).toContain("WHEN ? = 'RUNNING' THEN true ELSE false");
  });

  it('marks successful metadata results as AI drafts', async () => {
    await updateMetadataStatus(
      'letter-2',
      'SUCCESS',
      {
        sender: 'Alice',
        recipient: 'Bob',
        hook: 'Quick hello',
        tags: ['family'],
      },
      null,
    );

    expect(updateSetMock).toHaveBeenCalledWith({
      metadataStatus: 'SUCCESS',
      updatedAt: expect.any(Date),
      sender: 'Alice',
      recipient: 'Bob',
      hook: 'Quick hello',
      tags: ['family'],
      metadataError: null,
      metadataContentStatus: 'AI_DRAFT',
    });
  });

  it('claims downstream work only while transcription is not running', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-claim' }]);

    await expect(claimJob('letter-claim', 'metadataStatus')).resolves.toBe(true);

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-claim' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      ],
    });
  });

  it('reports a lost downstream claim without starting work', async () => {
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(claimJob('letter-claim', 'entityExtractionStatus')).resolves.toBe(false);

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-claim' },
        { kind: 'eq', field: 'letters.entityExtractionStatus', value: 'PENDING' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      ],
    });
  });

  it('publishes metadata success and its workflow transition together', async () => {
    await updateMetadataV2('letter-claim', 'SUCCESS', undefined, null);

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataStatus: 'SUCCESS',
      metadataContentStatus: 'AI_DRAFT',
      workflow: 'METADATA_DRAFTED',
      metadataError: null,
      updatedAt: expect.any(Date),
    }));
  });

  it('resets entity extraction state when re-enqueuing a letter for processing', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-3' }]);

    await expect(resetLetterForProcessing('letter-3')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'UPLOADED',
        transcriptionStatus: 'PENDING',
        transcriptionRunId: null,
        transcriptionLeaseExpiresAt: null,
        transcriptionClaimKind: null,
        metadataStatus: 'PENDING',
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        entityExtractionJson: null,
        transcriptStatus: 'EMPTY',
        metadataContentStatus: 'EMPTY',
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-3' },
        { kind: 'ne', field: 'letters.transcriptionStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.metadataStatus', value: 'RUNNING' },
        { kind: 'ne', field: 'letters.entityExtractionStatus', value: 'RUNNING' },
      ],
    });
  });
});
