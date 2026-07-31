import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  insertOnConflictDoNothingMock,
  insertValuesMock,
  selectMock,
  selectRows,
  transactionMock,
  updateReturningRows,
  updateSetMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  insertOnConflictDoNothingMock: vi.fn(),
  insertValuesMock: vi.fn(),
  selectMock: vi.fn(),
  selectRows: [] as unknown[][],
  transactionMock: vi.fn(),
  updateReturningRows: [] as unknown[][],
  updateSetMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
}));

vi.mock('../../db/index.js', () => {
  function selectable(rows: unknown[]) {
    const promise = Promise.resolve(rows);
    return {
      for: vi.fn(async () => rows),
      then: promise.then.bind(promise),
    };
  }
  selectMock.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => selectable(selectRows.shift() ?? [])),
    })),
  }));
  const executor = {
    query: {
      letterPages: {
        findFirst: findFirstMock,
      },
    },
    select: selectMock,
    insert: vi.fn(() => ({
      values: (value: unknown) => {
        insertValuesMock(value);
        return {
          onConflictDoNothing: insertOnConflictDoNothingMock,
        };
      },
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: unknown) => {
        updateSetMock(patch);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => updateReturningRows.shift() ?? []),
          })),
        };
      }),
    })),
  };
  transactionMock.mockImplementation(
    async (callback: (tx: typeof executor) => Promise<unknown>) => callback(executor),
  );

  const fields = new Proxy({}, {
    get: (_target, key) => `letterPages.${String(key)}`,
  });
  return {
    db: {
      ...executor,
      transaction: transactionMock,
    },
    letters: new Proxy({}, {
      get: (_target, key) => `letters.${String(key)}`,
    }),
    letterPages: fields,
    pageGeometryRevisions: 'pageGeometryRevisions',
    pageGeometryReviewEvents: 'pageGeometryReviewEvents',
  };
});

import {
  getPageGeometryEnvelope,
  savePageLineSegments,
  updatePageSegmentTrust,
} from '../line-segments.js';
import {
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../schemas/page-geometry.js';

const sourceChecksum = 'a'.repeat(64);
const layoutChecksum = 'b'.repeat(64);
const baseSegment = {
  id: 'line-1',
  line: 1,
  geometryType: 'baseline' as const,
  baseline: [[1, 2], [3, 4]] as [number, number][],
  bbox: [1, 2, 3, 4] as [number, number, number, number],
  ocrText: 'rough',
};

function storedPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    letterId: 'letter-1',
    checksumSha256: sourceChecksum,
    pageLayoutChecksumSha256: layoutChecksum,
    lineSegments: [baseSegment],
    geometryRevision: 2,
    geometryChecksumSha256: pageGeometryChecksum([baseSegment]),
    segmentTrustState: 'trusted',
    approvedGeometryRevision: 2,
    approvedGeometryChecksumSha256: pageGeometryChecksum([baseSegment]),
    geometryApprovedBy: 'reviewer-1',
    geometryApprovedAt: new Date('2026-07-30T01:00:00.000Z'),
    ...overrides,
  };
}

function queueLockedPage(page = storedPage()) {
  selectRows.push(
    [{ letterId: 'letter-1' }],
    [{ id: 'letter-1', primarySourceRevision: 4 }],
    [page],
  );
}

describe('page geometry revisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateReturningRows.length = 0;
    insertOnConflictDoNothingMock.mockResolvedValue(undefined);
  });

  it('returns a complete envelope and normalizes legacy provenance', async () => {
    findFirstMock.mockResolvedValue(storedPage());

    const envelope = await getPageGeometryEnvelope('page-1');

    expect(envelope).toMatchObject({
      geometryRevision: 2,
      lineSegmentsChecksumSha256: pageLineSegmentsChecksum([baseSegment]),
      reviewState: {
        trustState: 'trusted',
        approvedGeometryRevision: 2,
        approvedBy: 'reviewer-1',
      },
      lineSegments: [{
        id: 'line-1',
        geometryProvenance: {
          source: 'machine',
          operation: 'detected',
          parentSegmentIds: [],
        },
      }],
    });
  });

  it('creates an immutable revision and atomically demotes approval after a shape edit', async () => {
    const page = storedPage();
    queueLockedPage(page);
    const edited = [{
      ...baseSegment,
      bbox: [2, 2, 4, 4] as [number, number, number, number],
      geometryProvenance: {
        source: 'human-adjusted' as const,
        operation: 'resize' as const,
        parentSegmentIds: ['line-1'],
      },
    }];
    updateReturningRows.push([storedPage({
      lineSegments: edited,
      geometryRevision: 3,
      geometryChecksumSha256: pageGeometryChecksum(edited),
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      geometryApprovedBy: null,
      geometryApprovedAt: null,
    })]);

    const result = await savePageLineSegments(
      'page-1',
      edited,
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result).toMatchObject({
      kind: 'saved',
      envelope: {
        geometryRevision: 3,
        reviewState: { trustState: 'unverified' },
      },
    });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page-1',
      revision: 3,
      createdBy: 'reviewer-2',
      basePageLayoutChecksumSha256: layoutChecksum,
      changeSummary: {
        created: [],
        deleted: [],
        reordered: [],
        updated: [{
          segmentId: 'line-1',
          provenance: edited[0].geometryProvenance,
        }],
      },
    }));
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      geometryRevision: 3,
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
    }));
  });

  it('does not manufacture a geometry revision for mapping-only review metadata', async () => {
    const page = storedPage();
    queueLockedPage(page);
    const mapped = [{ ...baseSegment, isMapped: true, mappedText: 'Hello' }];
    updateReturningRows.push([storedPage({ lineSegments: mapped })]);

    const result = await savePageLineSegments(
      'page-1',
      mapped,
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result.kind).toBe('saved');
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.not.objectContaining({
      segmentTrustState: 'unverified',
    }));
  });

  it('rejects a same-source stale editor before inserting history', async () => {
    queueLockedPage(storedPage({ geometryRevision: 3 }));

    const result = await savePageLineSegments(
      'page-1',
      [baseSegment],
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result).toEqual({ kind: 'geometry-conflict' });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('rejects a stale full projection even when geometry revision is unchanged', async () => {
    const mapped = [{ ...baseSegment, isMapped: true, mappedText: 'Newer' }];
    queueLockedPage(storedPage({ lineSegments: mapped }));

    const result = await savePageLineSegments(
      'page-1',
      [{ ...baseSegment, segmentClass: 'addition' }],
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result).toEqual({ kind: 'projection-conflict' });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('snapshots revision zero before the first geometry-changing overwrite', async () => {
    const page = storedPage({
      geometryRevision: 0,
      geometryChecksumSha256: null,
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      geometryApprovedBy: null,
      geometryApprovedAt: null,
    });
    queueLockedPage(page);
    const edited = [{
      ...baseSegment,
      bbox: [2, 2, 4, 4] as [number, number, number, number],
      geometryProvenance: {
        source: 'human-adjusted' as const,
        operation: 'resize' as const,
        parentSegmentIds: ['line-1'],
      },
    }];
    updateReturningRows.push([storedPage({
      lineSegments: edited,
      geometryRevision: 1,
      geometryChecksumSha256: pageGeometryChecksum(edited),
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      geometryApprovedBy: null,
      geometryApprovedAt: null,
    })]);

    const result = await savePageLineSegments(
      'page-1',
      edited,
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 0,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result).toMatchObject({
      kind: 'saved',
      envelope: { geometryRevision: 1 },
    });
    expect(insertValuesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pageId: 'page-1',
        revision: 0,
        geometryChecksumSha256: pageGeometryChecksum([baseSegment]),
        geometrySnapshot: expect.arrayContaining([
          expect.objectContaining({ id: 'line-1', bbox: [1, 2, 3, 4] }),
        ]),
        changeSummary: {
          created: [],
          updated: [],
          deleted: [],
          reordered: [],
        },
        createdBy: 'system:legacy-baseline',
      }),
    );
    expect(insertOnConflictDoNothingMock).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pageId: 'page-1',
        revision: 1,
        createdBy: 'reviewer-2',
      }),
    );
  });

  it('binds approval to the exact revision and checksum with server actor provenance', async () => {
    const page = storedPage({
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      geometryApprovedBy: null,
      geometryApprovedAt: null,
    });
    queueLockedPage(page);
    updateReturningRows.push([storedPage()]);

    const result = await updatePageSegmentTrust(
      'page-1',
      'trusted',
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: pageGeometryChecksum([baseSegment]),
      },
      'reviewer-1',
    );

    expect(result).toMatchObject({
      kind: 'saved',
      envelope: { reviewState: { trustState: 'trusted' } },
    });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page-1',
      geometryRevision: 2,
      decision: 'trusted',
      reviewedBy: 'reviewer-1',
    }));
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      approvedGeometryRevision: 2,
      approvedGeometryChecksumSha256: pageGeometryChecksum([baseSegment]),
      geometryApprovedBy: 'reviewer-1',
    }));
  });

  it('rejects approval after either the revision or checksum changes', async () => {
    queueLockedPage(storedPage({ geometryRevision: 3 }));

    const result = await updatePageSegmentTrust(
      'page-1',
      'trusted',
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: pageGeometryChecksum([baseSegment]),
      },
      'reviewer-1',
    );

    expect(result).toEqual({ kind: 'geometry-conflict' });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('rejects forged provenance before creating a revision', async () => {
    queueLockedPage();
    const result = await savePageLineSegments(
      'page-1',
      [{
        ...baseSegment,
        bbox: [2, 2, 4, 4],
      }],
      {
        primarySourceRevision: 4,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256:
          pageLineSegmentsChecksum([baseSegment]),
      },
      'reviewer-2',
    );

    expect(result).toMatchObject({
      kind: 'invalid-transition',
      issues: [expect.stringContaining('must be human-adjusted')],
    });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
