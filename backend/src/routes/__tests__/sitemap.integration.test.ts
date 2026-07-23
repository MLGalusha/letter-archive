import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectMock,
  eqMock,
  andMock,
  orMock,
  isNotNullMock,
  lteMock,
  sqlMock,
  whereConditions,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  orMock: vi.fn(),
  isNotNullMock: vi.fn(),
  lteMock: vi.fn(),
  sqlMock: vi.fn(),
  whereConditions: [] as unknown[],
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  or: orMock,
  isNotNull: isNotNullMock,
  lte: lteMock,
  sql: sqlMock,
}));

vi.mock('../../config/env.js', () => ({
  env: { SITE_URL: 'https://letters.test/' },
}));

vi.mock('../../db/index.js', () => ({
  db: { select: selectMock },
}));

vi.mock('../../db/schema.js', () => ({
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    visibility: 'letters.visibility',
    type: 'letters.type',
    updatedAt: 'letters.updatedAt',
    metadataPublished: 'letters.metadataPublished',
    entityExtractionRevision: 'letters.entityExtractionRevision',
    entityExtractionJson: 'letters.entityExtractionJson',
  },
  collections: {
    id: 'collections.id',
    collectionCode: 'collections.collectionCode',
    title: 'collections.title',
    createdAt: 'collections.createdAt',
  },
  updatePosts: {
    slug: 'updatePosts.slug',
    status: 'updatePosts.status',
    publishedAt: 'updatePosts.publishedAt',
    updatedAt: 'updatePosts.updatedAt',
  },
  canonicalPersons: { id: 'canonicalPersons.id' },
  canonicalPlaces: { id: 'canonicalPlaces.id' },
  letterPersons: {
    letterId: 'letterPersons.letterId',
    personId: 'letterPersons.personId',
    confirmedAt: 'letterPersons.confirmedAt',
    entityExtractionRevision: 'letterPersons.entityExtractionRevision',
  },
  letterPlaces: {
    letterId: 'letterPlaces.letterId',
    placeId: 'letterPlaces.placeId',
    confirmedAt: 'letterPlaces.confirmedAt',
    entityExtractionRevision: 'letterPlaces.entityExtractionRevision',
  },
}));

import sitemapRouter from '../sitemap.js';

function queryBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  builder.from.mockReturnValue(builder);
  builder.innerJoin.mockReturnValue(builder);
  builder.where.mockImplementation((condition: unknown) => {
    whereConditions.push(condition);
    return builder;
  });
  builder.groupBy.mockReturnValue(builder);
  return builder;
}

describe('public sitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whereConditions.length = 0;
    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    orMock.mockImplementation((...conditions) => ({ op: 'or', conditions }));
    isNotNullMock.mockImplementation((value) => ({ op: 'isNotNull', value }));
    lteMock.mockImplementation((left, right) => ({ op: 'lte', left, right }));
    sqlMock.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: Array.from(strings).join(''),
      values,
      as(alias: string) {
        return { text: Array.from(strings).join(''), values, alias };
      },
    }));
  });

  it('builds letter and collection URLs only from public catalogue roots', async () => {
    const queryResults = [
      [
        {
          id: 'photo-alias',
          collectionId: 'collection-009',
          dateRaw: '19470810',
          typeSequence: 1,
          type: 'P',
          updatedAt: null,
          collectionCode: '009',
        },
        {
          id: 'letter-primary',
          collectionId: 'collection-009',
          dateRaw: '19470810',
          typeSequence: 1,
          type: 'L',
          updatedAt: null,
          collectionCode: '009',
        },
      ],
      [{ collectionCode: '009', title: 'Nine', createdAt: null, latestUpdate: null }],
      [],
      [],
      [],
    ];
    selectMock.mockImplementation(() => queryBuilder(queryResults.shift() ?? []));

    const layer = (sitemapRouter as unknown as {
      stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: unknown, res: unknown) => Promise<void> }> } }>;
    }).stack.find((candidate) => candidate.route?.path === '/sitemap.xml');
    const headers: Record<string, string> = {};
    let body = '';
    const response = {
      set(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return response;
      },
      status() {
        return response;
      },
      send(value: string) {
        body = value;
        return response;
      },
    };

    await layer?.route?.stack[0]?.handle({}, response);

    const letterAndCollectionPredicates = JSON.stringify(whereConditions.slice(0, 2));
    expect(letterAndCollectionPredicates).toContain('letter_type[]');
    for (const catalogueType of ['L', 'P', 'V', 'A', 'D']) {
      expect(letterAndCollectionPredicates).toContain(`"${catalogueType}"`);
    }
    expect(body).toContain('https://letters.test/letter/letter-primary');
    expect(body).not.toContain('https://letters.test/letter/photo-alias');
    expect(body).toContain('https://letters.test/collections/009');
    expect(headers['cache-control']).toBe('no-store');
    expect(eqMock).toHaveBeenCalledWith(
      'letterPersons.entityExtractionRevision',
      'letters.entityExtractionRevision',
    );
    expect(eqMock).toHaveBeenCalledWith(
      'letterPlaces.entityExtractionRevision',
      'letters.entityExtractionRevision',
    );
  });
});
