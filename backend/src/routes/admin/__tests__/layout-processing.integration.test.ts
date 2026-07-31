import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  selectMock,
  fromMock,
  innerJoinMock,
  whereMock,
  orderByMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  innerJoinMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ operator: 'and', clauses })),
  asc: vi.fn((field: unknown) => ({ direction: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({
    operator: 'eq',
    field,
    value,
  })),
  isNotNull: vi.fn((field: unknown) => ({
    operator: 'isNotNull',
    field,
  })),
  isNull: vi.fn((field: unknown) => ({
    operator: 'isNull',
    field,
  })),
}));

vi.mock('../../../db/index.js', () => {
  selectMock.mockImplementation(() => ({ from: fromMock }));
  fromMock.mockImplementation(() => ({ innerJoin: innerJoinMock }));
  innerJoinMock.mockImplementation(() => ({ where: whereMock }));
  whereMock.mockImplementation(() => ({ orderBy: orderByMock }));
  return {
    db: { select: selectMock },
    letterPages: {
      id: 'letterPages.id',
      letterId: 'letterPages.letterId',
      pageNumber: 'letterPages.pageNumber',
      checksumSha256: 'letterPages.checksumSha256',
      pageLayout: 'letterPages.pageLayout',
      lineSegments: 'letterPages.lineSegments',
    },
    letters: {
      id: 'letters.id',
      dateRaw: 'letters.dateRaw',
      primarySourceRevision: 'letters.primarySourceRevision',
      type: 'letters.type',
      typeSequence: 'letters.typeSequence',
    },
  };
});

import layoutProcessingRouter from '../layout-processing.js';

describe('native layout processing queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockImplementation(() => ({ from: fromMock }));
    fromMock.mockImplementation(() => ({ innerJoin: innerJoinMock }));
    innerJoinMock.mockImplementation(() => ({ where: whereMock }));
    whereMock.mockImplementation(() => ({ orderBy: orderByMock }));
  });

  it('returns only source-fenced native-layout work items', async () => {
    orderByMock.mockResolvedValueOnce([
      {
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '18881103',
        primarySourceRevision: 7,
        sourceChecksum: 'a'.repeat(64),
      },
    ]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/queue',
      path: '/queue',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '18881103',
        primarySourceRevision: 7,
        sourceChecksum: 'a'.repeat(64),
      }],
      total: 1,
    });
    expect(selectMock).toHaveBeenCalledWith({
      pageId: 'letterPages.id',
      letterId: 'letters.id',
      pageNumber: 'letterPages.pageNumber',
      dateRaw: 'letters.dateRaw',
      primarySourceRevision: 'letters.primarySourceRevision',
      sourceChecksum: 'letterPages.checksumSha256',
    });
    expect(orderByMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed if a queue row somehow lacks its mandatory checksum', async () => {
    orderByMock.mockResolvedValueOnce([
      {
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 1,
        dateRaw: '18881103',
        primarySourceRevision: 7,
        sourceChecksum: null,
      },
    ]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/queue',
      path: '/queue',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('without a source checksum'),
    });
  });
});
