import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  findCollectionsMock,
  findLettersMock,
  findFirstLetterMock,
  executeMock,
  transformLettersWithRelatedToDTOMock,
  transformLetterWithRelatedToDTOMock,
  transformLetterToDTOMock,
  transformLettersToDTOMock,
  logIfSlowMock,
  eqMock,
  andMock,
  orMock,
  inArrayMock,
  ilikeMock,
  ascMock,
  descMock,
  sqlMock,
  sqlJoinMock,
} = vi.hoisted(() => ({
  findCollectionsMock: vi.fn(),
  findLettersMock: vi.fn(),
  findFirstLetterMock: vi.fn(),
  executeMock: vi.fn(),
  transformLettersWithRelatedToDTOMock: vi.fn(),
  transformLetterWithRelatedToDTOMock: vi.fn(),
  transformLetterToDTOMock: vi.fn(),
  transformLettersToDTOMock: vi.fn(),
  logIfSlowMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  orMock: vi.fn(),
  inArrayMock: vi.fn(),
  ilikeMock: vi.fn(),
  ascMock: vi.fn(),
  descMock: vi.fn(),
  sqlMock: vi.fn(),
  sqlJoinMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  or: orMock,
  inArray: inArrayMock,
  ilike: ilikeMock,
  asc: ascMock,
  desc: descMock,
  sql: Object.assign(sqlMock, { join: sqlJoinMock }),
}));

vi.mock('../../dto/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dto/index.js')>();
  return {
    ...actual,
    transformLetterToDTO: transformLetterToDTOMock,
    transformLettersToDTO: transformLettersToDTOMock,
    transformLetterWithRelatedToDTO: transformLetterWithRelatedToDTOMock,
    transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
  };
});

vi.mock('../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger.js')>();
  return {
    ...actual,
    logIfSlow: logIfSlowMock,
    TIMING_THRESHOLDS: {
      ...actual.TIMING_THRESHOLDS,
      DB_QUERY: 250,
    },
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    execute: executeMock,
    query: {
      collections: {
        findMany: findCollectionsMock,
      },
      letters: {
        findMany: findLettersMock,
        findFirst: findFirstLetterMock,
      },
    },
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    sender: 'letters.sender',
    workflow: 'letters.workflow',
    visibility: 'letters.visibility',
    createdAt: 'letters.createdAt',
    type: 'letters.type',
  },
  letterPages: {
    id: 'letter_pages.id',
  },
  collections: {
    collectionCode: 'collections.collectionCode',
    title: 'collections.title',
  },
}));

import lettersRouter from '../letters.js';

describe('letters route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    orMock.mockImplementation((...conditions) => ({ op: 'or', conditions }));
    inArrayMock.mockImplementation((left, right) => ({ op: 'inArray', left, right }));
    ilikeMock.mockImplementation((left, right) => ({ op: 'ilike', left, right }));
    ascMock.mockImplementation((value) => ({ direction: 'asc', value }));
    descMock.mockImplementation((value) => ({ direction: 'desc', value }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));
    sqlJoinMock.mockImplementation((values, separator) => ({ values, separator }));

    transformLettersWithRelatedToDTOMock.mockImplementation((groups) =>
      groups.map(
        ({
          letter,
          relatedItems,
        }: {
          letter: { id: string };
          relatedItems: Array<{ id: string }>;
        }) => ({
          id: letter.id,
          relatedIds: relatedItems.map((item) => item.id),
        }),
      ),
    );
    transformLetterWithRelatedToDTOMock.mockImplementation(
      (
        letter: { id: string },
        relatedItems: Array<{ id: string }>,
      ) => ({
        id: letter.id,
        relatedIds: relatedItems.map((item) => item.id),
      }),
    );
  });

  it('groups letters by date and type sequence, then filters by the primary workflow', async () => {
    findCollectionsMock.mockResolvedValueOnce([
      {
        id: 'collection-9',
        collectionCode: '009',
      },
    ]);
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        createdAt: '2026-03-09T12:00:00.000Z',
        typeSequence: 1,
        type: 'L',
        workflow: 'UPLOADED',
      },
      {
        id: 'letter-cover',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
        type: 'C',
        workflow: 'REVIEWED',
      },
      {
        id: 'letter-reviewed',
        collectionId: 'collection-9',
        dateRaw: '19470811',
        typeSequence: 1,
        type: 'L',
        workflow: 'REVIEWED',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: {
        collection: '9',
        workflow: 'UPLOADED',
        page: '1',
        limit: '20',
        sort: 'createdAt',
        sortOrder: 'desc',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    // L and C on same date merge into one group; L is primary, C is related
    expect(response.body).toEqual({
      letters: [
        {
          id: 'letter-primary',
          relatedIds: ['letter-cover'],
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
    expect(findCollectionsMock).toHaveBeenCalledTimes(1);
    expect(transformLettersWithRelatedToDTOMock).toHaveBeenCalledWith([
      {
        letter: {
          id: 'letter-primary',
          collectionId: 'collection-9',
          dateRaw: '19470810',
          createdAt: '2026-03-09T12:00:00.000Z',
          typeSequence: 1,
          type: 'L',
          workflow: 'UPLOADED',
        },
        relatedItems: [
          {
            id: 'letter-cover',
            collectionId: 'collection-9',
            dateRaw: '19470810',
            typeSequence: 1,
            type: 'C',
            workflow: 'REVIEWED',
          },
        ],
      },
    ]);
  });

  it('returns an empty paginated response when the collection filter matches nothing', async () => {
    findCollectionsMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: {
        collection: '404',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      letters: [],
      page: 1,
      limit: 20,
      total: 0,
    });
    expect(findLettersMock).not.toHaveBeenCalled();
  });

  it('returns lightweight shelf summaries for public archive browsing', async () => {
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        createdAt: '2026-03-09T12:00:00.000Z',
        typeSequence: 1,
        type: 'L',
        workflow: 'REVIEWED',
        visibility: 'PUBLISHED',
        sender: 'Jimmie',
        recipient: 'Molly',
        locationWritten: 'New York',
        hook: 'A short note about future plans.',
        summary: 'Summary text',
        transcriptionText: 'Full transcription text',
        extraContentTranscript: null,
        photoDescription: null,
        metadataContentStatus: 'VERIFIED',
        collection: {
          title: 'Collection Nine',
          collectionCode: '009',
        },
        pages: [
          {
            id: 'page-1',
            pageNumber: 1,
            checksumSha256: 'abcdef123456',
          },
          {
            id: 'page-2',
            pageNumber: 2,
            checksumSha256: 'abcdef123456',
          },
        ],
      },
      {
        id: 'letter-photo',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        createdAt: '2026-03-09T12:00:00.000Z',
        typeSequence: 1,
        type: 'P',
        workflow: 'REVIEWED',
        visibility: 'PUBLISHED',
        sender: null,
        recipient: null,
        locationWritten: null,
        hook: null,
        summary: null,
        transcriptionText: null,
        extraContentTranscript: null,
        photoDescription: 'Jimmy and Molly on a porch.',
        metadataContentStatus: 'EMPTY',
        collection: {
          title: 'Collection Nine',
          collectionCode: '009',
        },
        pages: [
          {
            id: 'photo-page',
            pageNumber: 1,
            checksumSha256: 'fedcba654321',
          },
        ],
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/summaries',
      path: '/letters/summaries',
      query: {
        visibility: 'PUBLISHED',
        page: '1',
        limit: '20',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    // L and P share the same dateRaw + typeSequence, so they merge into one
    // group with L-type preferred as primary (same as adjacent API behavior)
    expect(response.body).toEqual({
      letters: [
        {
          id: 'letter-primary',
          title: 'Letter from Jimmie to Molly',
          imageUrl: '/images/page-1?v=abcdef12',
          imageType: 'letter',
          primaryChip: '2 pages',
          sender: 'Jimmie',
          recipient: 'Molly',
          collectionCode: '009',
          createdAt: '2026-03-09T12:00:00.000Z',
          date: 'August 10th, 1947',
          dateRaw: '19470810',
          hook: 'A short note about future plans.',
          location: 'New York',
          verified: true,
          searchText: 'Jimmie Molly New York A short note about future plans. Summary text Full transcription text Jimmy and Molly on a porch.',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
  });

  it('returns a related-letter payload for a published letter detail request', async () => {
    findFirstLetterMock.mockResolvedValueOnce({
      id: 'letter-primary',
      collectionId: 'collection-9',
      type: 'L',
      dateRaw: '19470810',
    });
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-cover',
        type: 'C',
      },
      {
        id: 'letter-extra',
        type: 'E',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-primary',
      path: '/letters/letter-primary',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'letter-primary',
      relatedIds: ['letter-cover', 'letter-extra'],
    });
  });

  it('injects request ids into missing-letter responses', async () => {
    findFirstLetterMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/missing-letter',
      path: '/letters/missing-letter',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Letter not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('resolves companion types to the same nav position as their L-type sibling', async () => {
    findFirstLetterMock.mockResolvedValueOnce({
      id: 'letter-cover',
      collectionId: 'collection-9',
      dateRaw: '19470810',
      createdAt: '2026-03-09T12:00:00.000Z',
      collection: {
        collectionCode: '009',
        title: 'Collection Nine',
      },
    });
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-1',
        dateRaw: '19470810',
        type: 'L',
        typeSequence: 1,
        createdAt: '2026-03-09T11:00:00.000Z',
        sender: null,
        recipient: null,
        hook: null,
      },
      {
        id: 'letter-cover',
        dateRaw: '19470810',
        type: 'C',
        typeSequence: 1,
        createdAt: '2026-03-09T11:30:00.000Z',
        sender: null,
        recipient: null,
        hook: null,
      },
      {
        id: 'letter-2',
        dateRaw: '19470811',
        type: 'L',
        typeSequence: 1,
        createdAt: '2026-03-09T12:00:00.000Z',
        sender: null,
        recipient: null,
        hook: null,
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-cover/adjacent',
      path: '/letters/letter-cover/adjacent',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    // Cover resolves to same position as L-type on 19470810
    expect(response.body).toMatchObject({
      position: 1,
      total: 2,
      collectionCode: '009',
      collectionTitle: 'Collection Nine',
    });
  });

  it('returns archive search results from the dedicated search route', async () => {
    executeMock
      .mockResolvedValueOnce([
        {
          id: 'letter-primary',
          collectionId: 'collection-9',
          collectionCode: '009',
          collectionTitle: 'Collection Nine',
          dateRaw: '19470810',
          createdAt: '2026-03-09T12:00:00.000Z',
          primaryType: 'L',
          primaryPageCount: 2,
          sender: 'Jimmie',
          recipient: 'Molly',
          location: 'Overland Park, Kans.',
          hook: 'Jimmie pleads with Molly for a reply.',
          metadataVerified: true,
          pageId: 'page-1',
          checksumSha256: 'abcdef123456',
          formats: ['letter'],
        senders: ['Jimmie'],
        recipients: ['Molly'],
        places: ['Overland Park, Kans.'],
        hooks: ['Jimmie pleads with Molly for a reply.'],
        summaries: [],
        topics: ['family/marriage'],
        tones: ['hopeful'],
        relationships: ['romantic-partner'],
        photoDescriptions: [],
        extraContentTranscripts: [],
        transcriptionTexts: ['Dear Molly, please write soon because I still love you dearly.'],
      },
    ])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ value: 'letter', count: 1 }])
      .mockResolvedValueOnce([{ value: '009', label: 'Collection Nine', count: 1 }])
      .mockResolvedValueOnce([{ value: 'Jimmie', count: 1 }])
      .mockResolvedValueOnce([{ value: 'Overland Park, Kans.', count: 1 }])
      .mockResolvedValueOnce([{ value: 1947, count: 1 }])
      .mockResolvedValueOnce([{ value: 'family/marriage', count: 1 }])
      .mockResolvedValueOnce([{ value: 'hopeful', count: 1 }])
      .mockResolvedValueOnce([{ value: 'romantic-partner', count: 1 }]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/search',
      path: '/letters/search',
      query: {
        search: 'Molly',
        limit: '5',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      letters: [
        {
          id: 'letter-primary',
          title: 'Letter from Jimmie to Molly',
          imageUrl: '/images/page-1?v=abcdef12',
          imageType: 'letter',
          primaryChip: '2 pages',
          sender: 'Jimmie',
          recipient: 'Molly',
          collectionCode: '009',
          createdAt: '2026-03-09T12:00:00.000Z',
          date: 'August 10th, 1947',
          dateRaw: '19470810',
          hook: 'Jimmie pleads with Molly for a reply.',
          location: 'Overland Park, Kans.',
          verified: true,
          searchPreview: {
            excerpt: 'Dear Molly, please write soon because I still love you dearly.',
            matchCount: 1,
            highlightRanges: [
              {
                start: 5,
                end: 10,
              },
            ],
          },
        },
      ],
      page: 1,
      limit: 5,
      total: 1,
      facets: {
        formats: [
          {
            value: 'letter',
            label: 'Letters',
            count: 1,
          },
        ],
        collections: [
          {
            value: '009',
            label: 'Collection Nine',
            count: 1,
          },
        ],
        correspondents: [
          {
            value: 'Jimmie',
            count: 1,
          },
        ],
        places: [
          {
            value: 'Overland Park, Kans.',
            count: 1,
          },
        ],
        years: [
          {
            value: 1947,
            count: 1,
          },
        ],
        topics: [
          {
            value: 'family/marriage',
            count: 1,
          },
        ],
        tones: [
          {
            value: 'hopeful',
            count: 1,
          },
        ],
        relationships: [
          {
            value: 'romantic-partner',
            count: 1,
          },
        ],
      },
    });
    expect(executeMock).toHaveBeenCalledTimes(10);
  });

  it('accepts repeated format filters on archive search', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/search',
      path: '/letters/search',
      query: {
        format: ['photo', 'letter'],
        limit: '5',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      letters: [],
      total: 0,
      limit: 5,
    });
    expect(executeMock).toHaveBeenCalledTimes(10);
  });

  it('centers long search previews around the visible match', async () => {
    executeMock
      .mockResolvedValueOnce([
        {
          id: 'letter-primary',
          collectionId: 'collection-9',
          collectionCode: '009',
          collectionTitle: 'Collection Nine',
          dateRaw: '19470810',
          createdAt: '2026-03-09T12:00:00.000Z',
          primaryType: 'L',
          primaryPageCount: 2,
          sender: 'Jimmie',
          recipient: 'Molly',
          location: 'Overland Park, Kans.',
          hook: 'Jimmie pleads with Molly for a reply.',
          metadataVerified: true,
          pageId: 'page-1',
          checksumSha256: 'abcdef123456',
          formats: ['letter'],
          senders: ['Jimmie'],
          recipients: ['Molly'],
          places: ['Overland Park, Kans.'],
          hooks: ['Jimmie pleads with Molly for a reply.'],
          summaries: [],
          topics: ['family/marriage'],
          tones: ['hopeful'],
          relationships: ['romantic-partner'],
          photoDescriptions: [],
          extraContentTranscripts: [],
          transcriptionTexts: [
            'Jimmie spends the first part of the letter talking about delayed trains, long shifts at work, money worries, and the weather before finally asking Molly to write soon.',
          ],
        },
      ])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ value: 'letter', count: 1 }])
      .mockResolvedValueOnce([{ value: '009', label: 'Collection Nine', count: 1 }])
      .mockResolvedValueOnce([{ value: 'Jimmie', count: 1 }])
      .mockResolvedValueOnce([{ value: 'Overland Park, Kans.', count: 1 }])
      .mockResolvedValueOnce([{ value: 1947, count: 1 }])
      .mockResolvedValueOnce([{ value: 'family/marriage', count: 1 }])
      .mockResolvedValueOnce([{ value: 'hopeful', count: 1 }])
      .mockResolvedValueOnce([{ value: 'romantic-partner', count: 1 }]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/search',
      path: '/letters/search',
      query: {
        search: 'Molly',
        limit: '5',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const searchPreview = (response.body as {
      letters: Array<{
        searchPreview: {
          excerpt: string;
          highlightRanges: Array<{ start: number; end: number }>;
        };
      }>;
    }).letters[0]?.searchPreview;

    expect(searchPreview).toBeDefined();
    expect(searchPreview.excerpt.startsWith('…')).toBe(true);
    expect(searchPreview.excerpt.indexOf('Molly')).toBeGreaterThanOrEqual(0);
    expect(searchPreview.excerpt.indexOf('Molly')).toBeLessThanOrEqual(28);
    expect(
      searchPreview.excerpt.slice(
        searchPreview.highlightRanges[0]!.start,
        searchPreview.highlightRanges[0]!.end,
      ),
    ).toBe('Molly');
  });
});
