import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectMock,
  selectLimitMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  deleteMock,
  deleteWhereMock,
  deleteReturningMock,
  resolveRepresentativeLetterIdMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  selectLimitMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  resolveRepresentativeLetterIdMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
}));

vi.mock('../../db/index.js', () => {
  selectMock.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: selectLimitMock,
      })),
    })),
  }));
  updateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));
  updateWhereMock.mockImplementation(() => ({
    returning: updateReturningMock,
  }));
  deleteMock.mockImplementation(() => ({
    where: deleteWhereMock,
  }));
  deleteWhereMock.mockImplementation(() => ({
    returning: deleteReturningMock,
  }));

  return {
    db: {
      select: selectMock,
      update: updateMock,
      delete: deleteMock,
    },
    siteSettings: {
      key: 'siteSettings.key',
      value: 'siteSettings.value',
    },
  };
});

vi.mock('../letters.js', () => ({
  resolveRepresentativeLetterId: resolveRepresentativeLetterIdMock,
}));

import { resolveFeaturedSetting } from '../featured-setting.js';

describe('featured setting resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([]);
    deleteReturningMock.mockResolvedValue([]);
  });

  it('returns a newer curator winner when normalization loses its compare-and-swap', async () => {
    selectLimitMock
      .mockResolvedValueOnce([{ value: 'old-companion' }])
      .mockResolvedValueOnce([{ value: 'curator-winner' }]);
    resolveRepresentativeLetterIdMock
      .mockResolvedValueOnce('old-root')
      .mockResolvedValueOnce('curator-winner');
    const fetchLetter = vi.fn(async (letterId: string) => ({ id: letterId }));

    const result = await resolveFeaturedSetting('featured_letter_id', fetchLetter);

    expect(result).toEqual({
      letterId: 'curator-winner',
      letter: { id: 'curator-winner' },
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'siteSettings.key', value: 'featured_letter_id' },
        { kind: 'eq', field: 'siteSettings.value', value: 'old-companion' },
      ],
    });
    expect(fetchLetter).toHaveBeenCalledWith('curator-winner');
  });

  it('returns a newer curator winner when stale-value deletion loses its compare-and-swap', async () => {
    selectLimitMock
      .mockResolvedValueOnce([{ value: 'stale-letter' }])
      .mockResolvedValueOnce([{ value: 'curator-winner' }]);
    resolveRepresentativeLetterIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('curator-winner');
    const fetchLetter = vi.fn(async (letterId: string) => ({ id: letterId }));

    const result = await resolveFeaturedSetting('featured_letter_id', fetchLetter);

    expect(result).toEqual({
      letterId: 'curator-winner',
      letter: { id: 'curator-winner' },
    });
    expect(deleteWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'siteSettings.key', value: 'featured_letter_id' },
        { kind: 'eq', field: 'siteSettings.value', value: 'stale-letter' },
      ],
    });
    expect(fetchLetter).toHaveBeenCalledTimes(1);
    expect(fetchLetter).toHaveBeenCalledWith('curator-winner');
  });
});
