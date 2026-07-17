import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbUpdateMock,
  getLetterByIdMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => ({
  dbUpdateMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));

  return {
    db: { update: dbUpdateMock },
    letters: {
      id: 'letters.id',
      updatedAt: 'letters.updatedAt',
      extraContentStatus: 'letters.extraContentStatus',
    },
  };
});

vi.mock('../letters.js', () => ({ getLetterById: getLetterByIdMock }));

vi.mock('../letter/readingView.js', () => ({ generateAndSaveReadingView: vi.fn() }));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { unverifyExtraContent, verifyExtraContent } from '../letter/verification.js';

describe('extra-content verification ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'updated-letter' }]);
  });

  it('atomically verifies content and revokes any active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      extraContentStatus: 'EDITED',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: true,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(verifyExtraContent('letter-1', 'reviewer-1')).resolves.toEqual({
      previousStatus: 'EDITED',
    });

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: expect.any(Date),
      extraContentVerifiedBy: 'reviewer-1',
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
    }));
  });

  it('atomically removes verification and revokes any active AI attempt', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-2',
      extraContentStatus: 'VERIFIED',
      extraContentJobStatus: 'RUNNING',
      extraContentJobRunId: 'old-run',
      extraContentJobDirty: false,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    await expect(unverifyExtraContent('letter-2')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'SUCCESS',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      updatedAt: expect.any(Date),
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
    }));
  });

  it('refuses to verify a revision that changed after the reviewer loaded it', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-3',
      extraContentStatus: 'EDITED',
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    updateReturningMock.mockResolvedValue([]);

    await expect(verifyExtraContent('letter-3', 'reviewer-1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('changed before it could be verified'),
    });
  });
});
