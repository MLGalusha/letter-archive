import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  selectMock,
  eqMock,
  andMock,
  inArrayMock,
  ascMock,
  sqlMock,
  buildRelationshipAdjacencyMock,
  findShortestRelationshipPathMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  inArrayMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
  buildRelationshipAdjacencyMock: vi.fn(),
  findShortestRelationshipPathMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  inArray: inArrayMock,
  asc: ascMock,
  sql: sqlMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
  personRelationships: {
    id: 'personRelationships.id',
    personAId: 'personRelationships.personAId',
    personBId: 'personRelationships.personBId',
    relationshipType: 'personRelationships.relationshipType',
    confidence: 'personRelationships.confidence',
  },
  canonicalPersons: {
    id: 'canonicalPersons.id',
    canonicalName: 'canonicalPersons.canonicalName',
  },
  letterPersons: {
    personId: 'letterPersons.personId',
    letterId: 'letterPersons.letterId',
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    visibility: 'letters.visibility',
  },
}));

vi.mock('../relationships-graph.js', () => ({
  buildRelationshipAdjacency: buildRelationshipAdjacencyMock,
  findShortestRelationshipPath: findShortestRelationshipPathMock,
}));

import relationshipsRouter from '../relationships.js';

function buildSelectChain({
  fromResult,
  whereResult,
  groupByResult,
  orderByResult,
  limitResult,
}: {
  fromResult?: unknown;
  whereResult?: unknown;
  groupByResult?: unknown;
  orderByResult?: unknown;
  limitResult?: unknown;
}) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};

  chain.from = vi.fn(() => (fromResult !== undefined ? Promise.resolve(fromResult) : chain));
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => (whereResult !== undefined ? Promise.resolve(whereResult) : chain));
  chain.groupBy = vi.fn(() =>
    groupByResult !== undefined ? Promise.resolve(groupByResult) : chain,
  );
  chain.orderBy = vi.fn(() =>
    orderByResult !== undefined ? Promise.resolve(orderByResult) : chain,
  );
  chain.limit = vi.fn(() => (limitResult !== undefined ? Promise.resolve(limitResult) : chain));

  return chain;
}

describe('public relationships route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    inArrayMock.mockImplementation((left, right) => ({ op: 'inArray', left, right }));
    ascMock.mockImplementation((value) => ({ direction: 'asc', value }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));
  });

  it('returns a graph payload with public letter counts', async () => {
    selectMock
      .mockReturnValueOnce(
        buildSelectChain({
          orderByResult: [
            {
              id: 'rel-1',
              personAId: '11111111-1111-4111-8111-111111111111',
              personBId: '22222222-2222-4222-8222-222222222222',
              relationshipType: 'friend',
              confidence: 0.9,
              personAName: 'Alice Smith',
              personBName: 'Bob Baker',
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        buildSelectChain({
          groupByResult: [
            {
              personId: '11111111-1111-4111-8111-111111111111',
              count: 3,
            },
            {
              personId: '22222222-2222-4222-8222-222222222222',
              count: 1,
            },
          ],
        }),
      );

    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships',
      path: '/relationships',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      nodes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Alice Smith',
          letterCount: 3,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Bob Baker',
          letterCount: 1,
        },
      ],
      edges: [
        {
          id: 'rel-1',
          source: '11111111-1111-4111-8111-111111111111',
          target: '22222222-2222-4222-8222-222222222222',
          relationshipType: 'friend',
          confidence: 0.9,
        },
      ],
    });
  });

  it('injects request ids into invalid collection graph requests', async () => {
    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships/collection/not-a-uuid',
      path: '/relationships/collection/not-a-uuid',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid collection id',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('returns an empty graph when a collection has no linked people', async () => {
    selectMock.mockReturnValueOnce(
      buildSelectChain({
        groupByResult: [],
      }),
    );

    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships/collection/11111111-1111-4111-8111-111111111111',
      path: '/relationships/collection/11111111-1111-4111-8111-111111111111',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ nodes: [], edges: [] });
  });

  it('returns a collection-scoped graph when linked people exist', async () => {
    selectMock
      .mockReturnValueOnce(
        buildSelectChain({
          groupByResult: [
            {
              personId: '11111111-1111-4111-8111-111111111111',
              personName: 'Alice Smith',
              letterCount: 2,
            },
            {
              personId: '22222222-2222-4222-8222-222222222222',
              personName: 'Bob Baker',
              letterCount: 1,
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        buildSelectChain({
          whereResult: [
            {
              id: 'rel-1',
              personAId: '11111111-1111-4111-8111-111111111111',
              personBId: '22222222-2222-4222-8222-222222222222',
              relationshipType: 'friend',
              confidence: 0.95,
            },
          ],
        }),
      );

    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships/collection/11111111-1111-4111-8111-111111111111',
      path: '/relationships/collection/11111111-1111-4111-8111-111111111111',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      nodes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Alice Smith',
          letterCount: 2,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Bob Baker',
          letterCount: 1,
        },
      ],
      edges: [
        {
          id: 'rel-1',
          source: '11111111-1111-4111-8111-111111111111',
          target: '22222222-2222-4222-8222-222222222222',
          relationshipType: 'friend',
          confidence: 0.95,
        },
      ],
    });
  });

  it('returns a single-node path when both ids are the same person', async () => {
    selectMock.mockReturnValueOnce(
      buildSelectChain({
        limitResult: [{ name: 'Alice Smith' }],
      }),
    );

    const personId = '11111111-1111-4111-8111-111111111111';
    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: `/relationships/path/${personId}/${personId}`,
      path: `/relationships/path/${personId}/${personId}`,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      path: [{ id: personId, name: 'Alice Smith' }],
      edges: [],
    });
  });

  it('returns the resolved shortest path with person names', async () => {
    selectMock
      .mockReturnValueOnce(
        buildSelectChain({
          fromResult: [
            {
              id: 'rel-1',
              personAId: '11111111-1111-4111-8111-111111111111',
              personBId: '22222222-2222-4222-8222-222222222222',
              relationshipType: 'friend',
            },
          ],
        }),
      )
      .mockReturnValueOnce(
        buildSelectChain({
          whereResult: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Alice Smith',
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Bob Baker',
            },
          ],
        }),
      );
    buildRelationshipAdjacencyMock.mockReturnValueOnce(new Map());
    findShortestRelationshipPathMock.mockReturnValueOnce({
      personIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      edges: [{ id: 'rel-1', type: 'friend' }],
    });

    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships/path/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
      path: '/relationships/path/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      path: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Alice Smith' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Bob Baker' },
      ],
      edges: [{ id: 'rel-1', type: 'friend' }],
    });
  });

  it('returns a no-connection message when no path exists', async () => {
    selectMock.mockReturnValueOnce(
      buildSelectChain({
        fromResult: [],
      }),
    );
    buildRelationshipAdjacencyMock.mockReturnValueOnce(new Map());
    findShortestRelationshipPathMock.mockReturnValueOnce(null);

    const response = await invokeRouter(relationshipsRouter, {
      method: 'GET',
      url: '/relationships/path/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
      path: '/relationships/path/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      path: [],
      edges: [],
      message: 'No connection found between these people',
    });
  });
});
