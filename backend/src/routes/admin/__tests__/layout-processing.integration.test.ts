import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';
import {
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../../schemas/page-geometry.js';

const {
  selectMock,
  fromMock,
  innerJoinMock,
  whereMock,
  orderByMock,
  limitMock,
  isNotNullMock,
  isNullMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  innerJoinMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
  isNotNullMock: vi.fn((field: unknown) => ({
    operator: 'isNotNull',
    field,
  })),
  isNullMock: vi.fn((field: unknown) => ({
    operator: 'isNull',
    field,
  })),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ operator: 'and', clauses })),
  asc: vi.fn((field: unknown) => ({ direction: 'asc', field })),
  eq: vi.fn((field: unknown, value: unknown) => ({
    operator: 'eq',
    field,
    value,
  })),
  isNotNull: isNotNullMock,
  isNull: isNullMock,
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
      geometryRevision: 'letterPages.geometryRevision',
      geometryChecksumSha256: 'letterPages.geometryChecksumSha256',
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

const humanCreatedSegments = normalizeLineSegments([{
  id: 'human:hi',
  line: 1,
  geometryType: 'bbox',
  bbox: [12, 18, 48, 37],
  ocrText: '',
  geometryProvenance: {
    source: 'human-created',
    operation: 'create-box',
    parentSegmentIds: [],
  },
}]);

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
    expect(isNullMock).toHaveBeenCalledWith('letterPages.pageLayout');
    expect(isNotNullMock).toHaveBeenCalledWith(
      'letterPages.checksumSha256',
    );
    expect(isNotNullMock).not.toHaveBeenCalledWith(
      'letterPages.lineSegments',
    );
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

describe('rotated region recovery queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockImplementation(() => ({ from: fromMock }));
    fromMock.mockImplementation(() => ({ innerJoin: innerJoinMock }));
    innerJoinMock.mockImplementation(() => ({ where: whereMock }));
    whereMock.mockImplementation(() => ({ orderBy: orderByMock }));
  });

  it('includes pages with existing native layout and human-created geometry', async () => {
    const geometryChecksumSha256 =
      pageGeometryChecksum(humanCreatedSegments);
    const lineSegmentsChecksumSha256 =
      pageLineSegmentsChecksum(humanCreatedSegments);

    orderByMock.mockResolvedValueOnce([{
      pageId: '22222222-2222-4222-8222-222222222222',
      letterId: '11111111-1111-4111-8111-111111111111',
      pageNumber: 3,
      dateRaw: '19450424',
      primarySourceRevision: 11,
      sourceChecksum: 'a'.repeat(64),
      // A native layout already exists in the real row. It deliberately does
      // not participate in either eligibility or the returned identity.
      pageLayout: { schemaVersion: 2 },
      lineSegments: humanCreatedSegments,
      geometryRevision: 4,
      storedGeometryChecksumSha256: geometryChecksumSha256,
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 3,
        dateRaw: '19450424',
        primarySourceRevision: 11,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 4,
        geometryChecksumSha256,
        lineSegmentsChecksumSha256,
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
      lineSegments: 'letterPages.lineSegments',
      geometryRevision: 'letterPages.geometryRevision',
      storedGeometryChecksumSha256:
        'letterPages.geometryChecksumSha256',
    });
    expect(isNotNullMock).toHaveBeenCalledWith(
      'letterPages.checksumSha256',
    );
    expect(isNotNullMock).toHaveBeenCalledWith(
      'letterPages.lineSegments',
    );
    expect(isNullMock).not.toHaveBeenCalled();
  });

  it('filters a bounded rotation request in SQL before geometry hashing', async () => {
    const targetPageId = '22222222-2222-4222-8222-222222222222';
    const geometryChecksumSha256 =
      pageGeometryChecksum(humanCreatedSegments);
    orderByMock.mockReturnValueOnce({ limit: limitMock });
    limitMock.mockResolvedValueOnce([{
      pageId: targetPageId,
      letterId: '11111111-1111-4111-8111-111111111111',
      pageNumber: 3,
      dateRaw: '19450424',
      primarySourceRevision: 11,
      sourceChecksum: 'a'.repeat(64),
      lineSegments: humanCreatedSegments,
      geometryRevision: 4,
      storedGeometryChecksumSha256: geometryChecksumSha256,
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
      query: { pageId: targetPageId, limit: '1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ total: 1 });
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(whereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        {
          operator: 'eq',
          field: 'letterPages.id',
          value: targetPageId,
        },
      ]),
    }));
  });

  it('excludes rows missing either source identity or editable segments', async () => {
    orderByMock.mockResolvedValueOnce([
      {
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 1,
        dateRaw: '19450424',
        primarySourceRevision: 11,
        sourceChecksum: null,
        lineSegments: humanCreatedSegments,
        geometryRevision: 4,
        storedGeometryChecksumSha256:
          pageGeometryChecksum(humanCreatedSegments),
      },
      {
        pageId: '33333333-3333-4333-8333-333333333333',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 11,
        sourceChecksum: 'b'.repeat(64),
        lineSegments: null,
        geometryRevision: 0,
        storedGeometryChecksumSha256: null,
      },
    ]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ pages: [], total: 0 });
  });

  it('returns exact recomputed identities for legacy null-checksum geometry', async () => {
    const legacySegments = [{
      line: 7,
      baseline: [[10, 20], [80, 20]],
      bbox: [10, 15, 80, 25],
      ocrText: 'rough local reading',
    }];
    const normalized = normalizeLineSegments(legacySegments);

    orderByMock.mockResolvedValueOnce([{
      pageId: '44444444-4444-4444-8444-444444444444',
      letterId: '55555555-5555-4555-8555-555555555555',
      pageNumber: 1,
      dateRaw: '18881103',
      primarySourceRevision: 2,
      sourceChecksum: 'c'.repeat(64),
      lineSegments: legacySegments,
      geometryRevision: 0,
      storedGeometryChecksumSha256: null,
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      pages: [{
        pageId: '44444444-4444-4444-8444-444444444444',
        letterId: '55555555-5555-4555-8555-555555555555',
        pageNumber: 1,
        dateRaw: '18881103',
        primarySourceRevision: 2,
        sourceChecksum: 'c'.repeat(64),
        geometryRevision: 0,
        geometryChecksumSha256: pageGeometryChecksum(normalized),
        lineSegmentsChecksumSha256:
          pageLineSegmentsChecksum(normalized),
      }],
      total: 1,
    });
  });

  it('fails before compute when versioned geometry is missing its stored checksum', async () => {
    orderByMock.mockResolvedValueOnce([{
      pageId: '55555555-5555-4555-8555-555555555555',
      letterId: '66666666-6666-4666-8666-666666666666',
      pageNumber: 2,
      dateRaw: '19450424',
      primarySourceRevision: 2,
      sourceChecksum: 'e'.repeat(64),
      lineSegments: humanCreatedSegments,
      geometryRevision: 1,
      storedGeometryChecksumSha256: null,
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining(
        'a versioned geometry revision is missing its stored checksum',
      ),
    });
  });

  it('fails closed when stored geometry identity is corrupt', async () => {
    orderByMock.mockResolvedValueOnce([{
      pageId: '66666666-6666-4666-8666-666666666666',
      letterId: '77777777-7777-4777-8777-777777777777',
      pageNumber: 1,
      dateRaw: '19181119',
      primarySourceRevision: 3,
      sourceChecksum: 'd'.repeat(64),
      lineSegments: humanCreatedSegments,
      geometryRevision: 8,
      storedGeometryChecksumSha256: 'f'.repeat(64),
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining(
        'stored geometry checksum does not match editable line segments',
      ),
    });
  });

  it('fails closed with page context when editable segments are malformed', async () => {
    orderByMock.mockResolvedValueOnce([{
      pageId: '77777777-7777-4777-8777-777777777777',
      letterId: '88888888-8888-4888-8888-888888888888',
      pageNumber: 2,
      dateRaw: '19181119',
      primarySourceRevision: 3,
      sourceChecksum: 'd'.repeat(64),
      lineSegments: [{ line: 1, ocrText: '' }],
      geometryRevision: 0,
      storedGeometryChecksumSha256: null,
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining(
        'invalid editable line segments for page 77777777-7777-4777-8777-777777777777',
      ),
    });
  });

  it('fails closed when a queued source checksum is malformed', async () => {
    orderByMock.mockResolvedValueOnce([{
      pageId: '88888888-8888-4888-8888-888888888888',
      letterId: '99999999-9999-4999-8999-999999999999',
      pageNumber: 1,
      dateRaw: '18780127',
      primarySourceRevision: 3,
      sourceChecksum: 'NOT-A-SHA256',
      lineSegments: humanCreatedSegments,
      geometryRevision: 4,
      storedGeometryChecksumSha256:
        pageGeometryChecksum(humanCreatedSegments),
    }]);

    const response = await invokeRouter(layoutProcessingRouter, {
      method: 'GET',
      url: '/rotation-queue',
      path: '/rotation-queue',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('invalid source checksum'),
    });
  });
});
