import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionFindFirstMock,
  insertMock,
  insertValuesMock,
  insertOnConflictMock,
  insertReturningMock,
  updateMock,
  resolveRepresentativeLetterIdMock,
  pickFeaturedLetterMock,
} = vi.hoisted(() => ({
  collectionFindFirstMock: vi.fn(),
  insertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertOnConflictMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateMock: vi.fn(),
  resolveRepresentativeLetterIdMock: vi.fn(),
  pickFeaturedLetterMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => {
  insertMock.mockImplementation(() => ({
    values: insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    onConflictDoNothing: insertOnConflictMock,
  }));
  insertOnConflictMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
  return {
    db: {
      query: {
        collections: {
          findFirst: collectionFindFirstMock,
        },
      },
      insert: insertMock,
      update: updateMock,
    },
    collections: {
      id: 'collections.id',
      collectionCode: 'collections.collectionCode',
    },
  };
});

vi.mock('../letters.js', () => ({
  resolveRepresentativeLetterId: resolveRepresentativeLetterIdMock,
}));

vi.mock('../pick-featured-letter.js', () => ({
  pickFeaturedLetter: pickFeaturedLetterMock,
}));

import {
  findOrCreateCollection,
  resolveCollectionStartHere,
} from '../collections.js';

describe('collection featured-letter resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertReturningMock.mockResolvedValue([]);
  });

  it('returns the concurrent collection winner when its insert loses the race', async () => {
    const winner = {
      id: 'collection-winner',
      collectionCode: '009',
      title: 'Collection 009',
    };
    collectionFindFirstMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(winner);

    await expect(findOrCreateCollection('009')).resolves.toBe(winner);

    expect(insertOnConflictMock).toHaveBeenCalledWith({
      target: 'collections.collectionCode',
    });
  });

  it('returns a valid stored curator selection without writing from a read', async () => {
    resolveRepresentativeLetterIdMock.mockResolvedValueOnce('curator-winner');
    const result = await resolveCollectionStartHere('collection-9', {
      letterId: 'curator-winner',
      reason: 'The curator winner reason',
    });

    expect(result).toEqual({
      letterId: 'curator-winner',
      reason: 'The curator winner reason',
    });
    expect(resolveRepresentativeLetterIdMock).toHaveBeenCalledWith(
      'curator-winner',
      {
        publishedOnly: true,
        collectionId: 'collection-9',
      },
    );
    expect(pickFeaturedLetterMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('returns a reasonless auto-pick for an invalid saved unit without persisting it', async () => {
    resolveRepresentativeLetterIdMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('auto-letter');
    pickFeaturedLetterMock.mockResolvedValueOnce({ id: 'auto-letter' });

    const result = await resolveCollectionStartHere('collection-9', {
      letterId: 'stale-letter',
      reason: 'Why the stale letter mattered',
    });

    expect(result).toEqual({
      letterId: 'auto-letter',
      reason: null,
    });
    expect(updateMock).not.toHaveBeenCalled();
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
