import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, getPersonsMock, getRelationshipsMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  getPersonsMock: vi.fn(),
  getRelationshipsMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  and: vi.fn((...conditions) => conditions),
  asc: vi.fn((value) => value),
  isNotNull: vi.fn((value) => value),
  sql: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  db: { query: { letters: { findMany: findManyMock } } },
  letters: {
    collectionId: 'letters.collectionId',
    visibility: 'letters.visibility',
    letterDate: 'letters.letterDate',
    dateRaw: 'letters.dateRaw',
  },
  letterPersons: {},
  canonicalPersons: {},
}));

vi.mock('../entities/collection-queries.js', () => ({
  getPersonsForCollection: getPersonsMock,
  getRelationshipsForCollection: getRelationshipsMock,
}));

import { getCollectionAggregations } from '../collection-profile.js';

describe('getCollectionAggregations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonsMock.mockResolvedValue([]);
    getRelationshipsMock.mockResolvedValue([]);
  });

  it('does not let orphan supplementary rows affect the public profile', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'root',
        collectionId: '009',
        dateRaw: '19470810',
        letterDate: '1947-08-10',
        typeSequence: '01',
        type: 'L',
        sender: null,
        recipient: null,
        hook: null,
        emotionalTone: null,
        primaryTopics: null,
        metadataPublished: false,
      },
      {
        id: 'attached-cover',
        collectionId: '009',
        dateRaw: '19470810',
        letterDate: null,
        typeSequence: '01',
        type: 'C',
        sender: null,
        recipient: null,
        hook: null,
        emotionalTone: null,
        primaryTopics: null,
        metadataPublished: false,
      },
      {
        id: 'standalone-photo',
        collectionId: '009',
        dateRaw: '19000101',
        letterDate: '1900-01-01',
        typeSequence: '01',
        type: 'P',
        sender: null,
        recipient: null,
        hook: null,
        emotionalTone: null,
        primaryTopics: null,
        metadataPublished: false,
      },
      {
        id: 'orphan-cover',
        collectionId: '009',
        dateRaw: '18000101',
        letterDate: '1800-01-01',
        typeSequence: '01',
        type: 'C',
        sender: null,
        recipient: null,
        hook: null,
        emotionalTone: null,
        primaryTopics: null,
        metadataPublished: false,
      },
    ]);

    const result = await getCollectionAggregations('009');

    expect(result.letterCount).toBe(3);
    expect(result.dateRange).toEqual({ start: '1900-01-01', end: '19470810' });
    expect(result.formatBreakdown.map(({ type, count }) => ({ type, count }))).toEqual([
      { type: 'L', count: 1 },
      { type: 'C', count: 1 },
      { type: 'P', count: 1 },
    ]);
  });
});
