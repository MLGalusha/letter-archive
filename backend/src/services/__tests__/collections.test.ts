import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionFindFirstMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  resolveRepresentativeLetterIdMock,
  pickFeaturedLetterMock,
} = vi.hoisted(() => ({
  collectionFindFirstMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  resolveRepresentativeLetterIdMock: vi.fn(),
  pickFeaturedLetterMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
}));

vi.mock('../../db/index.js', () => {
  updateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));
  updateWhereMock.mockImplementation(() => ({
    returning: updateReturningMock,
  }));

  return {
    db: {
      query: {
        collections: {
          findFirst: collectionFindFirstMock,
        },
      },
      update: updateMock,
    },
    collections: {
      id: 'collections.id',
      collectionCode: 'collections.collectionCode',
      profileStartHereLetterId: 'collections.profileStartHereLetterId',
      profileStartHereReason: 'collections.profileStartHereReason',
    },
  };
});

vi.mock('../letters.js', () => ({
  resolveRepresentativeLetterId: resolveRepresentativeLetterIdMock,
}));

vi.mock('../pick-featured-letter.js', () => ({
  pickFeaturedLetter: pickFeaturedLetterMock,
}));

import { resolveCollectionStartHere } from '../collections.js';

describe('collection featured-letter resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([]);
  });

  it('re-reads and returns the curator winner when auto-pick persistence loses its CAS', async () => {
    pickFeaturedLetterMock.mockResolvedValueOnce({ id: 'auto-letter' });
    resolveRepresentativeLetterIdMock
      .mockResolvedValueOnce('auto-letter')
      .mockResolvedValueOnce('curator-winner');
    collectionFindFirstMock.mockResolvedValueOnce({
      profileStartHereLetterId: 'curator-winner',
      profileStartHereReason: 'The curator winner reason',
    });

    const result = await resolveCollectionStartHere('collection-9', {
      letterId: null,
      reason: 'Reason left behind by an old selection',
    });

    expect(result).toEqual({
      letterId: 'curator-winner',
      reason: 'The curator winner reason',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      profileStartHereLetterId: 'auto-letter',
      profileStartHereReason: null,
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'collections.id', value: 'collection-9' },
        { kind: 'isNull', field: 'collections.profileStartHereLetterId' },
        {
          kind: 'eq',
          field: 'collections.profileStartHereReason',
          value: 'Reason left behind by an old selection',
        },
      ],
    });
    expect(resolveRepresentativeLetterIdMock).toHaveBeenNthCalledWith(
      2,
      'curator-winner',
      {
        publishedOnly: true,
        collectionId: 'collection-9',
      },
    );
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('clears a stale reason when an invalid saved unit is replaced by an auto-pick', async () => {
    resolveRepresentativeLetterIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('auto-letter');
    pickFeaturedLetterMock.mockResolvedValueOnce({ id: 'auto-letter' });
    updateReturningMock.mockResolvedValueOnce([{
      profileStartHereLetterId: 'auto-letter',
      profileStartHereReason: null,
    }]);

    const result = await resolveCollectionStartHere('collection-9', {
      letterId: 'stale-letter',
      reason: 'Why the stale letter mattered',
    });

    expect(result).toEqual({
      letterId: 'auto-letter',
      reason: null,
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      profileStartHereLetterId: 'auto-letter',
      profileStartHereReason: null,
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'collections.id', value: 'collection-9' },
        {
          kind: 'eq',
          field: 'collections.profileStartHereLetterId',
          value: 'stale-letter',
        },
        {
          kind: 'eq',
          field: 'collections.profileStartHereReason',
          value: 'Why the stale letter mattered',
        },
      ],
    });
  });

  it('never falls back to an auto-pick that cannot resolve inside the collection', async () => {
    pickFeaturedLetterMock.mockResolvedValueOnce({ id: 'foreign-letter' });
    resolveRepresentativeLetterIdMock.mockResolvedValueOnce(null);

    const result = await resolveCollectionStartHere('collection-9', {
      letterId: null,
      reason: null,
    });

    expect(result).toEqual({
      letterId: null,
      reason: null,
    });
    expect(resolveRepresentativeLetterIdMock).toHaveBeenCalledWith(
      'foreign-letter',
      {
        publishedOnly: true,
        collectionId: 'collection-9',
      },
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
