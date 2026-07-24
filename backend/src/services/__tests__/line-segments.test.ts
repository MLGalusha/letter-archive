import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findPageOwnerMock,
  findPagesMock,
  selectForUpdateMock,
  transactionMock,
  updateReturningMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  findPageOwnerMock: vi.fn(),
  findPagesMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  updateReturningMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings,
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: updateWhereMock,
    })),
  }));
  updateWhereMock.mockReturnValue({ returning: updateReturningMock });
  const executor = {
    query: {
      letterPages: {
        findFirst: findPageOwnerMock,
        findMany: findPagesMock,
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: selectForUpdateMock })),
      })),
    })),
    update,
  };
  transactionMock.mockImplementation(
    async (callback: (tx: typeof executor) => Promise<unknown>) => callback(executor),
  );

  return {
    db: {
      ...executor,
      transaction: transactionMock,
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
    },
    letterPages: {
      id: 'letterPages.id',
      letterId: 'letterPages.letterId',
      checksumSha256: 'letterPages.checksumSha256',
    },
  };
});

import {
  savePageLineSegments,
  updateLetterSegmentTrust,
  updatePageSegmentTrust,
} from '../line-segments.js';

describe('line segment source fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'page-1' }]);
    findPageOwnerMock.mockResolvedValue({ letterId: 'letter-1' });
    selectForUpdateMock.mockResolvedValue([{
      id: 'letter-1',
      primarySourceRevision: 4,
    }]);
    findPagesMock.mockResolvedValue([
      { id: 'page-1', checksumSha256: 'a'.repeat(64) },
      { id: 'page-2', checksumSha256: 'b'.repeat(64) },
    ]);
  });

  it('reports whether an exact source-bound segment write won', async () => {
    await expect(savePageLineSegments(
      'page-1',
      [],
      { primarySourceRevision: 4, sourceChecksum: 'a'.repeat(64) },
    )).resolves.toBe(true);

    updateReturningMock.mockResolvedValueOnce([]);
    await expect(updatePageSegmentTrust(
      'page-1',
      'trusted',
      { primarySourceRevision: 3, sourceChecksum: 'a'.repeat(64) },
    )).resolves.toBe(false);

    expect(updateWhereMock).toHaveBeenCalledTimes(2);
  });

  it('updates letter-wide trust only when revision and complete page set still match', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'page-1' }, { id: 'page-2' }]);

    await expect(updateLetterSegmentTrust(
      'letter-1',
      'trusted',
      4,
      [
        { pageId: 'page-1', sourceChecksum: 'a'.repeat(64) },
        { pageId: 'page-2', sourceChecksum: 'b'.repeat(64) },
      ],
    )).resolves.toBe(true);
  });

  it('rolls back a stale letter-wide trust request before writing any page', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      id: 'letter-1',
      primarySourceRevision: 5,
    }]);

    await expect(updateLetterSegmentTrust(
      'letter-1',
      'trusted',
      4,
      [
        { pageId: 'page-1', sourceChecksum: 'a'.repeat(64) },
        { pageId: 'page-2', sourceChecksum: 'b'.repeat(64) },
      ],
    )).resolves.toBe(false);

    expect(updateWhereMock).not.toHaveBeenCalled();
  });
});
