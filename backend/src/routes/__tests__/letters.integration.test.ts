import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  cataloguePageMock,
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
  isNotNullMock,
  inArrayMock,
  ilikeMock,
  ascMock,
  descMock,
  sqlMock,
  sqlJoinMock,
  publicProjectionState,
} = vi.hoisted(() => ({
  cataloguePageMock: vi.fn(),
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
  isNotNullMock: vi.fn(),
  inArrayMock: vi.fn(),
  ilikeMock: vi.fn(),
  ascMock: vi.fn(),
  descMock: vi.fn(),
  sqlMock: vi.fn(),
  sqlJoinMock: vi.fn(),
  publicProjectionState: { enabled: false },
}));

vi.mock('../../services/public-catalogue-page.js', () => ({ getPublicCataloguePage: cataloguePageMock }));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  or: orMock,
  isNotNull: isNotNullMock,
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

vi.mock('../../services/public-read-model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/public-read-model.js')>();
  return {
    ...actual,
    toPublicLetter: (
      letter: Parameters<typeof actual.toPublicLetter>[0],
      context: Parameters<typeof actual.toPublicLetter>[1],
    ) => (
      publicProjectionState.enabled
        ? actual.toPublicLetter(letter, context)
        : letter
    ),
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
    metadataPublished: 'letters.metadataPublished',
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

import lettersRouter, {
  buildShelfSearchText,
  getArchiveContiguousSearchPhrases,
} from '../letters.js';

describe('letters route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicProjectionState.enabled = false;
    cataloguePageMock.mockResolvedValue({ total: 1, units: [{ collectionId: 'collection-9', dateRaw: '19470810', typeSequence: 1 }], where: { boundedPage: true } });

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    orMock.mockImplementation((...conditions) => ({ op: 'or', conditions }));
    isNotNullMock.mockImplementation((value) => ({ op: 'isNotNull', value }));
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

  it('groups published letters by date and type sequence', async () => {
    cataloguePageMock.mockResolvedValueOnce({ total: 2, units: [
      { collectionId: 'collection-9', dateRaw: '19470810', typeSequence: 1 },
      { collectionId: 'collection-9', dateRaw: '19470811', typeSequence: 1 },
    ], where: { boundedPage: true } });
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
        {
          id: 'letter-reviewed',
          relatedIds: [],
        },
      ],
      page: 1,
      limit: 20,
      total: 2,
    });
    expect(findCollectionsMock).toHaveBeenCalledTimes(1);
    expect(findLettersMock.mock.calls[0][0].where).toEqual({ boundedPage: true });
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
      {
        letter: {
          id: 'letter-reviewed',
          collectionId: 'collection-9',
          dateRaw: '19470811',
          typeSequence: 1,
          type: 'L',
          workflow: 'REVIEWED',
        },
        relatedItems: [],
      },
    ]);
  });

  it('never selects a supplementary row as the public root when a primary type exists', async () => {
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'cover-companion',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
        type: 'C',
      },
      {
        id: 'photo-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
        type: 'P',
      },
      {
        id: 'standalone-telegram',
        collectionId: 'collection-9',
        dateRaw: '19470811',
        typeSequence: 1,
        type: 'T',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      letters: [{ id: 'photo-primary', relatedIds: ['cover-companion'] }],
      page: 1,
      limit: 20,
      total: 1,
    });
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

  it('rejects attempts to query hidden rows through the public letters route', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: { visibility: 'HIDDEN' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(findLettersMock).not.toHaveBeenCalled();
  });

  it('rejects internal workflow filters and workflow-based sorting on public reads', async () => {
    const workflowFilter = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: { workflow: 'REVIEWED' },
      headers: { accept: 'application/json' },
    });
    const workflowSort = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/summaries',
      path: '/letters/summaries',
      query: { sort: 'workflow' },
      headers: { accept: 'application/json' },
    });

    expect(workflowFilter.statusCode).toBe(400);
    expect(workflowSort.statusCode).toBe(400);
    expect(findLettersMock).not.toHaveBeenCalled();
  });

  it('sorts public sender views through the metadata publication predicate', async () => {
    findLettersMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: { sort: 'sender' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(sqlMock.mock.calls.some(([strings, ...values]) =>
      Array.from(strings as TemplateStringsArray).join('').includes('CASE WHEN')
      && values.includes('letters.metadataPublished')
      && values.includes('letters.sender')
    )).toBe(true);
  });

  it('keeps the total for an empty page and avoids fetching content', async () => {
    cataloguePageMock.mockResolvedValueOnce({ total: 41, units: [], where: { boundedPage: true } });
    const response = await invokeRouter(lettersRouter, { method: 'GET', url: '/letters/summaries', query: { page: '9' } });
    expect(response.body).toEqual({ letters: [], total: 41, page: 9, limit: 20 });
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
        transcriptPublished: true,
        metadataPublished: true,
        sender: 'Jimmie',
        recipient: 'Molly',
        locationWritten: 'New York',
        hook: 'A short note about future plans.',
        summary: 'Summary text',
        transcriptionText: 'Full transcription text',
        extraContentTranscript: 'private draft supplement',
        extraContentStatus: 'AI_DRAFT',
        photoDescription: null,
        photoDescriptionStatus: 'EMPTY',
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
        transcriptPublished: false,
        metadataPublished: false,
        sender: null,
        recipient: null,
        locationWritten: null,
        hook: null,
        summary: null,
        transcriptionText: null,
        extraContentTranscript: null,
        extraContentStatus: 'EMPTY',
        photoDescription: 'Jimmy and Molly on a porch.',
        photoDescriptionStatus: 'AI_DRAFT',
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
          searchText: 'Jimmie Molly New York A short note about future plans. Summary text Full transcription text',
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
      typeSequence: 1,
    }).mockResolvedValueOnce({
      id: 'letter-primary',
      collectionId: 'collection-9',
      type: 'L',
      dateRaw: '19470810',
      typeSequence: 1,
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

  it('filters uncommitted entity links before building a public letter DTO', async () => {
    findFirstLetterMock
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
      })
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        type: 'L',
        dateRaw: '19470810',
        typeSequence: 1,
        entityExtractionRevision: 2,
        entityExtractionJson: { people: [], places: [], relationships: [] },
        persons: [
          { id: 'person-confirmed', confirmedAt: new Date(), entityExtractionRevision: null },
          { id: 'person-committed', confirmedAt: null, entityExtractionRevision: 2 },
          { id: 'person-stale', confirmedAt: null, entityExtractionRevision: 1 },
          { id: 'person-ambiguous', confirmedAt: null, entityExtractionRevision: null },
        ],
        places: [
          { id: 'place-confirmed', confirmedAt: new Date(), entityExtractionRevision: null },
          { id: 'place-committed', confirmedAt: null, entityExtractionRevision: 2 },
          { id: 'place-stale', confirmedAt: null, entityExtractionRevision: 1 },
          { id: 'place-ambiguous', confirmedAt: null, entityExtractionRevision: null },
        ],
      });
    findLettersMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-primary',
      path: '/letters/letter-primary',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const transformedLetter = transformLetterWithRelatedToDTOMock.mock.calls[0]?.[0] as {
      persons: Array<{ id: string }>;
      places: Array<{ id: string }>;
    };
    expect(transformedLetter.persons.map(({ id }) => id)).toEqual([
      'person-confirmed',
      'person-committed',
    ]);
    expect(transformedLetter.places.map(({ id }) => id)).toEqual([
      'place-confirmed',
      'place-committed',
    ]);
  });

  it('composes detail routing with the real positive public projection', async () => {
    publicProjectionState.enabled = true;
    findFirstLetterMock
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
      })
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        type: 'L',
        dateRaw: '19470810',
        typeSequence: 1,
      });
    findLettersMock.mockResolvedValueOnce([]);
    transformLetterWithRelatedToDTOMock.mockReturnValueOnce({
      id: 'letter-primary',
      title: 'Private draft title',
      images: [{
        id: 'page-1',
        type: 'letter',
        imageUrl: '/images/page-1',
        originalFilename: 'private-scan.jpg',
        lineSegments: [{ ocrText: 'private OCR' }],
      }],
      transcript: {
        pages: [{ pageNumber: 1, text: 'private transcript' }],
        fullText: 'private transcript',
        verified: true,
      },
      metadata: {
        dateRaw: '19470810',
        sender: 'Private Sender',
        notes: 'private reviewer note',
        verified: true,
      },
      visibility: 'PUBLISHED',
      transcriptPublished: false,
      metadataPublished: false,
      transcriptStatus: 'VERIFIED',
      metadataContentStatus: 'VERIFIED',
      extraContentStatus: 'EMPTY',
      photoDescriptionStatus: 'EMPTY',
      workflowState: 'REVIEWED',
      status: 'published',
      flagged: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-primary',
      path: '/letters/letter-primary',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      images: unknown[];
      metadata: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      id: 'letter-primary',
      title: 'Letter',
      visibility: 'PUBLISHED',
      transcript: { pages: [], fullText: '', verified: false },
      metadata: { dateRaw: '19470810', verified: false },
    });
    expect(body).not.toHaveProperty('workflowState');
    expect(body).not.toHaveProperty('flagged');
    expect(body.images[0]).not.toHaveProperty('originalFilename');
    expect(body.images[0]).not.toHaveProperty('lineSegments');
    expect(body.metadata).not.toHaveProperty('notes');
  });

  it('resolves a published supplementary detail id to its public catalogue root', async () => {
    findFirstLetterMock
      .mockResolvedValueOnce({
        id: 'letter-cover',
        collectionId: 'collection-9',
        type: 'C',
        dateRaw: '19470810',
        typeSequence: 1,
      })
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        type: 'L',
        dateRaw: '19470810',
        typeSequence: 1,
      });
    findLettersMock.mockResolvedValueOnce([{ id: 'letter-cover', type: 'C' }]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-cover',
      path: '/letters/letter-cover',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'letter-primary',
      relatedIds: ['letter-cover'],
    });
  });

  it('resolves an alternate public root id to the unit representative', async () => {
    findFirstLetterMock
      .mockResolvedValueOnce({
        id: 'photo-alias',
        collectionId: 'collection-9',
        type: 'P',
        dateRaw: '19470810',
        typeSequence: 1,
      })
      .mockResolvedValueOnce({
        id: 'letter-primary',
        collectionId: 'collection-9',
        type: 'L',
        dateRaw: '19470810',
        typeSequence: 1,
      });
    findLettersMock.mockResolvedValueOnce([{ id: 'photo-alias', type: 'P' }]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/photo-alias',
      path: '/letters/photo-alias',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'letter-primary',
      relatedIds: ['photo-alias'],
    });
  });

  it('returns not found for a published supplementary detail without a public catalogue root', async () => {
    findFirstLetterMock
      .mockResolvedValueOnce({
        id: 'standalone-cover',
        collectionId: 'collection-9',
        type: 'C',
        dateRaw: '19470810',
        typeSequence: 1,
      })
      .mockResolvedValueOnce(null);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/standalone-cover',
      path: '/letters/standalone-cover',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Letter not found' });
    expect(findLettersMock).not.toHaveBeenCalled();
  });

  it('keeps draft photo descriptions out of public shelf search text', () => {
    const photo = {
      type: 'P',
      metadataPublished: false,
      transcriptPublished: false,
      extraContentStatus: 'EMPTY',
      photoDescription: 'private generated description',
      photoDescriptionStatus: 'AI_DRAFT',
    };

    expect(buildShelfSearchText(photo as never, [])).toBe('');
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
      typeSequence: 1,
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

  it('returns not found for supplementary-only adjacent navigation units', async () => {
    findFirstLetterMock.mockResolvedValueOnce({
      id: 'standalone-cover',
      collectionId: 'collection-9',
      dateRaw: '19470810',
      typeSequence: 2,
      collection: {
        collectionCode: '009',
        title: 'Collection Nine',
      },
    });
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'other-primary',
        dateRaw: '19470810',
        type: 'L',
        typeSequence: 1,
      },
      {
        id: 'standalone-cover',
        dateRaw: '19470810',
        type: 'C',
        typeSequence: 2,
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/standalone-cover/adjacent',
      path: '/letters/standalone-cover/adjacent',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Letter not found' });
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
        totalCount: 1,
      },
    ])
      .mockResolvedValueOnce([
        { facet: 'formats', value: 'letter', label: null, count: 1 },
        { facet: 'collections', value: '009', label: 'Collection Nine', count: 1 },
        { facet: 'correspondents', value: 'Jimmie', label: null, count: 1 },
        { facet: 'places', value: 'Overland Park, Kans.', label: null, count: 1 },
        { facet: 'years', value: '1947', label: null, count: 1 },
        { facet: 'topics', value: 'family/marriage', label: null, count: 1 },
        { facet: 'tones', value: 'hopeful', label: null, count: 1 },
        { facet: 'relationships', value: 'romantic-partner', label: null, count: 1 },
      ]);

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
            excerpt: 'Molly',
            matchCount: 1,
            matchedFieldLabel: 'Recipient',
            highlightRanges: [
              {
                start: 0,
                end: 5,
              },
            ],
            hookHighlightRanges: [
              {
                start: 19,
                end: 24,
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
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('accepts repeated format filters on archive search', async () => {
    executeMock
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
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache public search payloads across identical requests', async () => {
    executeMock.mockResolvedValue([]);

    const request = {
      method: 'GET' as const,
      url: '/letters/search',
      path: '/letters/search',
      query: { search: 'Molly', limit: '5' },
      headers: { accept: 'application/json' },
    };

    const first = await invokeRouter(lettersRouter, request);
    const second = await invokeRouter(lettersRouter, request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(4);
  });

  it('builds contiguous query phrases from longest to shortest', () => {
    expect(getArchiveContiguousSearchPhrases('hello how are you')).toEqual([
      'hello how are',
      'how are you',
      'hello how',
      'how are',
      'are you',
    ]);
  });

  it('caps contiguous phrases to bound archive ranking SQL size', () => {
    // 30 distinct terms — without a cap this would emit O(n^2) phrases (~405)
    // and blow up the per-row LIKE expression in the archive score builder.
    const terms = Array.from({ length: 30 }, (_, i) => `term${i.toString().padStart(2, '0')}`);
    const phrases = getArchiveContiguousSearchPhrases(terms.join(' '));

    expect(phrases.length).toBeLessThanOrEqual(20);
    // Every emitted phrase should come from the first 8 terms only.
    const allowedTerms = new Set(terms.slice(0, 8));
    for (const phrase of phrases) {
      for (const word of phrase.split(' ')) {
        expect(allowedTerms.has(word)).toBe(true);
      }
    }
    // Longest phrases should win the cap race (length 7 down).
    expect(phrases[0].split(' ').length).toBe(7);
  });

  it('adds exact and contiguous phrase boosts to archive best-match ranking', async () => {
    executeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/search',
      path: '/letters/search',
      query: {
        search: 'hello how are you',
        limit: '5',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(executeMock).toHaveBeenCalledTimes(2);

    const firstQueryPayload = JSON.stringify(executeMock.mock.calls[0]?.[0]);
    expect(firstQueryPayload).toContain('%hello how are you%');
    expect(firstQueryPayload).toContain('%hello how are%');
    expect(firstQueryPayload).toContain('%how are you%');
    expect(firstQueryPayload).toContain('%hello how%');
    expect(firstQueryPayload).toContain('%how are%');
    expect(firstQueryPayload).toContain('%are you%');
    expect(firstQueryPayload).toContain('extra_content_status');
    expect(firstQueryPayload).toContain('photo_description_status');
    expect(firstQueryPayload).toContain('public_root');
    expect(firstQueryPayload).toContain('letter_type[]');
    expect(firstQueryPayload).toContain('"L"');
    expect(firstQueryPayload).toContain('"P"');
    expect(firstQueryPayload).toContain('VERIFIED');
  });

  it('prefers the closest exact preview match even when a lower-priority field also matches', async () => {
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
          hook: 'A short note.',
          metadataVerified: true,
          pageId: 'page-1',
          checksumSha256: 'abcdef123456',
          formats: ['letter'],
          senders: ['Jimmie'],
          recipients: ['Molly'],
          places: ['Overland Park, Kans.'],
          hooks: ['A short note.'],
          summaries: [],
          topics: [],
          tones: [],
          relationships: [],
          photoDescriptions: [],
          extraContentTranscripts: [],
          transcriptionTexts: ['This transcript mentions hello and later how are you in separate places.'],
          totalCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        { facet: 'formats', value: 'letter', label: null, count: 1 },
        { facet: 'collections', value: '009', label: 'Collection Nine', count: 1 },
      ]);

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
    expect((response.body as { letters: Array<{ searchPreview?: { matchedFieldLabel: string; excerpt: string } }> }).letters[0]?.searchPreview)
      .toMatchObject({
        matchedFieldLabel: 'Recipient',
        excerpt: 'Molly',
      });
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
          totalCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        { facet: 'formats', value: 'letter', label: null, count: 1 },
        { facet: 'collections', value: '009', label: 'Collection Nine', count: 1 },
        { facet: 'correspondents', value: 'Jimmie', label: null, count: 1 },
        { facet: 'places', value: 'Overland Park, Kans.', label: null, count: 1 },
        { facet: 'years', value: '1947', label: null, count: 1 },
        { facet: 'topics', value: 'family/marriage', label: null, count: 1 },
        { facet: 'tones', value: 'hopeful', label: null, count: 1 },
        { facet: 'relationships', value: 'romantic-partner', label: null, count: 1 },
      ]);

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
          matchedFieldLabel: string;
          highlightRanges: Array<{ start: number; end: number }>;
          hookHighlightRanges?: Array<{ start: number; end: number }>;
        };
      }>;
    }).letters[0]?.searchPreview;

    expect(searchPreview).toBeDefined();
    expect(searchPreview.excerpt).toBe('Molly');
    expect(searchPreview.matchedFieldLabel).toBe('Recipient');
    expect(searchPreview.hookHighlightRanges).toEqual([{ start: 19, end: 24 }]);
    expect(searchPreview.excerpt.indexOf('Molly')).toBeGreaterThanOrEqual(0);
    expect(
      searchPreview.excerpt.slice(
        searchPreview.highlightRanges[0]!.start,
        searchPreview.highlightRanges[0]!.end,
      ),
    ).toBe('Molly');
  });

});
