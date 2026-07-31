import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../schemas/page-geometry.js';
import {
  pageGeometryProposalArtifactChecksum,
  type PageGeometryProposalV1,
} from '../../schemas/page-geometry-proposal.js';
import {
  pageLayoutV2Schema,
  type PageLayoutRotationProfile,
  type PageLayoutV2,
} from '../../schemas/page-layout-v2.js';
import {
  buildPageGeometryProposal,
  createPageGeometryProposalRepository,
  type PageGeometryProposalIdentity,
} from '../page-geometry-proposals.js';

const sha = (character: string): string => character.repeat(64);
const pageId = '71000000-0000-4000-8000-000000000001';
const letterId = '71000000-0000-4000-8000-000000000002';
const createdAt = new Date('2026-07-31T12:00:00.000Z');

const baseLineSegments = normalizeLineSegments([{
  id: 'base-line-1',
  line: 1,
  geometryType: 'baseline',
  providerId: 'base-provider-1',
  providerOrdinal: 0,
  providerTextDirection: 'horizontal-lr',
  baseline: [[100, 300], [900, 300]],
  bbox: [100, 250, 900, 330],
  boundary: [
    { x: 100, y: 250 },
    { x: 900, y: 250 },
    { x: 900, y: 330 },
    { x: 100, y: 330 },
  ],
  geometryProvenance: {
    source: 'machine',
    operation: 'detected',
    parentSegmentIds: [],
  },
  ocrText: 'body text',
  segmentClass: 'body',
}]);

const expectedIdentity: PageGeometryProposalIdentity = {
  primarySourceRevision: 3,
  sourceChecksumSha256: sha('a'),
  baseGeometryRevision: 5,
  baseGeometryChecksumSha256:
    pageGeometryChecksum(baseLineSegments),
  baseLineSegmentsChecksumSha256:
    pageLineSegmentsChecksum(baseLineSegments),
};

function rotationProfile(
  appendedRotatedLineCount = 1,
): PageLayoutRotationProfile {
  return {
    name: 'sideways-recovery-v1',
    evidenceContract: 'native-and-source-projected-v2',
    rotationsDegrees: [0, 90, 270],
    passOutcomes: [
      { rotationDegrees: 0, status: 'succeeded' },
      { rotationDegrees: 90, status: 'succeeded' },
      { rotationDegrees: 270, status: 'succeeded' },
    ],
    mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
    coordinateTransform: 'pil-pixel-centers-to-source-v1',
    selectionParameters: {
      verticalAxisToleranceDegrees: 15,
      strongBaselineLongEdgeRatio: 0.025,
      zoneJoinPaddingLongEdgeRatio: 0.06,
      zoneMemberPaddingLongEdgeRatio: 0.02,
      minimumStrongProposalClustersPerZone: 2,
      minimumProposalClustersPerZone: 3,
      baselineInterferencePaddingLongEdgeRatio: 0,
      baselineInterferenceHorizontalAxisToleranceDegrees: 20,
      maximumHorizontalBaselineCentroidRatioPerZone: 0.1,
      minimumHorizontalBaselineCentroidAllowancePerZone: 2,
    },
    selectionSummary: {
      rawInputLineCount: 40,
      inputLineCount: 38,
      clusterCount: 25,
      includedClusterCount: appendedRotatedLineCount,
      rejectedClusterCount: 24,
      appendedRotatedLineCount,
    },
  };
}

function layout(withCandidate = true): PageLayoutV2 {
  const profile = rotationProfile(withCandidate ? 1 : 0);
  const candidate = {
    id: 'rotation:90:line-1',
    providerId: 'provider:rotation:line-1',
    providerOrdinal: 7,
    kind: 'baseline' as const,
    text: 'side note should not enter a geometry proposal',
    direction: 'top-to-bottom' as const,
    providerTextDirection: 'vertical-lr' as const,
    rotationEvidence: {
      evidenceContract: 'native-and-source-projected-v2' as const,
      mergePolicy:
        'baseline-plus-nonoverlapping-vertical-zones' as const,
      clusterIndex: 4,
      supportCount: 2,
      sourceRotationsDegrees: [90, 270] as [90, 270],
      sourcePassStatuses: ['succeeded', 'succeeded'] as [
        'succeeded',
        'succeeded',
      ],
      representativeRotationDegrees: 90 as const,
      representativeProviderOrdinal: 7,
      memberProviderIds: ['provider:90:7', 'provider:270:12'],
      readingOrderSource: 'unresolved-rotated-proposal' as const,
    },
    baseline: [
      { x: 1050, y: 220 },
      { x: 1050, y: 720 },
    ],
    boundary: [
      { x: 1020, y: 200 },
      { x: 1080, y: 200 },
      { x: 1080, y: 740 },
      { x: 1020, y: 740 },
    ],
    boundingBox: {
      xMin: 1020,
      yMin: 200,
      xMax: 1080,
      yMax: 740,
    },
    words: [{
      id: 'rotated-word-1',
      text: 'side',
      boundingBox: {
        xMin: 1025,
        yMin: 210,
        xMax: 1075,
        yMax: 350,
      },
    }],
  };

  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: 'layout-rotation-proposal',
    runId: 'rotation-run-1',
    pageId,
    image: {
      width: 1200,
      height: 1600,
      checksumSha256: sha('f'),
      rasterChecksumSha256: sha('0'),
      rasterChecksumAlgorithm: 'sha256-rgb8-v1',
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
      source: {
        width: 1200,
        height: 1600,
        checksumSha256: expectedIdentity.sourceChecksumSha256,
        mode: 'RGB',
        exifOrientation: 1,
      },
      normalization: {
        operation: 'identity',
        applied: false,
        exifReadError: false,
      },
    },
    provenance: {
      producer: {
        name: 'letter-archive-rotation-recovery',
        version: '1.0.0',
        api: 'kraken-task-api',
        providerRunId: 'rotation-run-1',
      },
      model: {
        name: 'blla.mlmodel',
        version: '7.0.3',
        checksumSha256: sha('d'),
        kind: 'segmentation',
      },
      config: {
        name: 'kraken-segmentation-task',
        version: '1',
        checksumSha256: sha('e'),
        parameters: {
          rotationProfile: profile,
        },
      },
    },
    lineRepresentation: 'baselines',
    textDirection: 'horizontal-lr',
    scriptDetection: false,
    language: ['eng'],
    lines: [{
      id: 'base-provider-line',
      providerId: 'provider:base:0',
      providerOrdinal: 0,
      kind: 'baseline',
      text: 'ordinary body line',
      direction: 'left-to-right',
      providerTextDirection: 'horizontal-lr',
      baseline: [
        { x: 100, y: 300 },
        { x: 900, y: 300 },
      ],
      boundary: [
        { x: 100, y: 250 },
        { x: 900, y: 250 },
        { x: 900, y: 330 },
        { x: 100, y: 330 },
      ],
      boundingBox: {
        xMin: 100,
        yMin: 250,
        xMax: 900,
        yMax: 330,
      },
    }, ...(withCandidate ? [candidate] : [])],
    regions: [],
    readingOrder: {
      primary: {
        id: 'order-primary',
        direction: 'mixed',
        source: 'provider',
        lineIds: [
          'base-provider-line',
          ...(withCandidate ? ['rotation:90:line-1'] : []),
        ],
      },
      alternatives: [],
    },
  });
}

function layoutForRun(runId: string): PageLayoutV2 {
  const value = structuredClone(layout());
  value.runId = runId;
  value.provenance.producer.providerRunId = runId;
  return pageLayoutV2Schema.parse(value);
}

type StoredRow = {
  id: string;
  pageId: string;
  artifactChecksumSha256: string;
  schemaVersion: number;
  kind: string;
  primarySourceRevision: number;
  sourceChecksumSha256: string;
  baseGeometryRevision: number;
  baseGeometryChecksumSha256: string;
  baseLineSegmentsChecksumSha256: string;
  runId: string;
  artifact: PageGeometryProposalV1;
  createdBy: string;
  createdAt: Date;
};

function createHarness() {
  const rows: StoredRow[] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const lockEvents: string[] = [];
  const proposalLookupParams: unknown[][] = [];
  const owner = {
    exists: true,
    primarySourceRevision: expectedIdentity.primarySourceRevision,
  };
  const pagePointer = { letterId };
  const page = {
    exists: true,
    letterId,
    checksumSha256: expectedIdentity.sourceChecksumSha256,
    geometryRevision: expectedIdentity.baseGeometryRevision,
    geometryChecksumSha256:
      expectedIdentity.baseGeometryChecksumSha256 as string | null,
    lineSegments: structuredClone(baseLineSegments) as unknown,
  };
  const update = vi.fn();
  const proposalFindFirst = vi.fn((options: {
    where: Parameters<PgDialect['sqlToQuery']>[0];
    orderBy?: Array<Parameters<PgDialect['sqlToQuery']>[0]>;
  }) => {
    lockEvents.push('proposal-lookup');
    const params = new PgDialect().sqlToQuery(options.where).params;
    proposalLookupParams.push(params);
    const exactArtifact = rows.find((row) => (
      params.includes(row.artifactChecksumSha256)
    ));
    if (!options.orderBy) return exactArtifact;

    let currentLineSegments;
    try {
      currentLineSegments = normalizeLineSegments(page.lineSegments);
    } catch {
      return undefined;
    }
    const geometryChecksumSha256 =
      pageGeometryChecksum(currentLineSegments);
    const lineSegmentsChecksumSha256 =
      pageLineSegmentsChecksum(currentLineSegments);
    return rows
      .filter((row) => (
        row.pageId === pageId
        && row.primarySourceRevision
          === owner.primarySourceRevision
        && row.sourceChecksumSha256 === page.checksumSha256
        && row.baseGeometryRevision === page.geometryRevision
        && row.baseGeometryChecksumSha256
          === geometryChecksumSha256
        && row.baseLineSegmentsChecksumSha256
          === lineSegmentsChecksumSha256
      ))
      .sort((left, right) => (
        right.createdAt.getTime() - left.createdAt.getTime()
        || right.id.localeCompare(left.id)
      ))[0];
  });
  const tx = {
    query: {
      letterPages: {
        findFirst: vi.fn(() => {
          lockEvents.push('page-pointer');
          return page.exists
            ? { letterId: pagePointer.letterId }
            : undefined;
        }),
      },
      pageGeometryProposals: {
        findFirst: proposalFindFirst,
      },
    },
    select: vi.fn((selection: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => {
            if ('primarySourceRevision' in selection) {
              lockEvents.push('owner-lock');
              return owner.exists
                ? [{
                  id: letterId,
                  primarySourceRevision: owner.primarySourceRevision,
                }]
                : [];
            }
            lockEvents.push('page-lock');
            return page.exists
              ? [{
                letterId: page.letterId,
                checksumSha256: page.checksumSha256,
                geometryRevision: page.geometryRevision,
                geometryChecksumSha256: page.geometryChecksumSha256,
                lineSegments: page.lineSegments,
              }]
              : [];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => {
            insertedValues.push(values);
            const artifactChecksumSha256 =
              values.artifactChecksumSha256 as string;
            if (rows.some((row) => (
              row.artifactChecksumSha256 === artifactChecksumSha256
            ))) return [];
            const row: StoredRow = {
              ...(values as Omit<StoredRow, 'id' | 'createdAt'>),
              id: `proposal-${rows.length + 1}`,
              createdAt: new Date(createdAt.getTime() + rows.length * 1000),
            };
            rows.unshift(row);
            return [row];
          }),
        })),
      })),
    })),
    update,
  };
  const database = {
    transaction: vi.fn(async (
      operation: (executor: typeof tx) => Promise<unknown>,
    ) => operation(tx)),
  };

  return {
    rows,
    insertedValues,
    lockEvents,
    proposalLookupParams,
    owner,
    pagePointer,
    page,
    tx,
    database,
    repository: createPageGeometryProposalRepository(database as never),
  };
}

describe('page geometry proposal builder', () => {
  it('keeps only unresolved rotated geometry and binds exact run evidence', () => {
    const value = layout();
    const result = buildPageGeometryProposal(value, expectedIdentity);

    expect(result.kind).toBe('proposal');
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.artifact).toMatchObject({
      pageId,
      source: {
        ...expectedIdentity,
        image: value.image,
      },
      provenance: value.provenance,
      rotationProfile:
        value.provenance.config.parameters!.rotationProfile,
      run: { id: value.runId },
      candidates: [{
        id: 'rotation:90:line-1',
        line: -1,
        geometryType: 'baseline',
        providerTextDirection: 'vertical-lr',
        geometryProvenance: {
          source: 'machine',
          operation: 'detected',
          parentSegmentIds: [],
        },
        ocrText: '',
        rotationEvidence: {
          readingOrderSource: 'unresolved-rotated-proposal',
        },
      }],
    });
    expect(result.artifact.candidates).toHaveLength(1);
    expect(result.artifact.candidates[0]).not.toHaveProperty(
      'providerOrdinal',
    );
    expect(result.artifact.candidates[0]).not.toHaveProperty('words');
    expect(result.artifact.candidates[0]).not.toHaveProperty('regionIds');
    expect(result.artifact.candidates.some(
      (candidate) => candidate.id === 'base-provider-line',
    )).toBe(false);
    expect(result.artifactChecksumSha256).toBe(
      pageGeometryProposalArtifactChecksum(result.artifact),
    );
  });

  it('rejects missing or invalid rotation profile evidence', () => {
    const value = structuredClone(layout()) as PageLayoutV2;
    delete value.provenance.config.parameters!.rotationProfile;

    expect(() => (
      buildPageGeometryProposal(value, expectedIdentity)
    )).toThrow();
  });

  it('reports source conflict when layout raster identity is stale', () => {
    expect(buildPageGeometryProposal(layout(), {
      ...expectedIdentity,
      sourceChecksumSha256: sha('9'),
    })).toEqual({ kind: 'source-conflict' });
  });
});

describe('page geometry proposal repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates current fences but does not insert when there are no candidates', async () => {
    const harness = createHarness();

    await expect(harness.repository.save({
      layout: layout(false),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'no-candidates' });
    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });

  it('rejects a no-candidate result when the geometry changed during detection', async () => {
    const harness = createHarness();
    harness.page.geometryRevision += 1;

    await expect(harness.repository.save({
      layout: layout(false),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'geometry-conflict' });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });

  it('saves against recomputed current checksums without mutating the page', async () => {
    const harness = createHarness();
    const result = await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });

    expect(result).toMatchObject({
      kind: 'saved',
      value: {
        artifact: {
          source: expectedIdentity,
        },
        createdBy: 'admin-1',
      },
    });
    expect(harness.insertedValues).toHaveLength(1);
    expect(harness.insertedValues[0]).toMatchObject({
      pageId,
      primarySourceRevision: expectedIdentity.primarySourceRevision,
      baseGeometryRevision: expectedIdentity.baseGeometryRevision,
      baseGeometryChecksumSha256:
        expectedIdentity.baseGeometryChecksumSha256,
      baseLineSegmentsChecksumSha256:
        expectedIdentity.baseLineSegmentsChecksumSha256,
      createdBy: 'admin-1',
    });
    expect(harness.tx.update).not.toHaveBeenCalled();
    expect(harness.page.lineSegments).toEqual(baseLineSegments);
  });

  it('is content-addressed and returns the first append without updating it', async () => {
    const harness = createHarness();
    const first = await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    const second = await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-2',
    });

    expect(first.kind).toBe('saved');
    expect(second).toMatchObject({
      kind: 'already-exists',
      value: {
        createdBy: 'admin-1',
      },
    });
    expect(harness.rows).toHaveLength(1);
    expect(harness.tx.update).not.toHaveBeenCalled();
  });

  it('returns an exact committed retry after later page edits', async () => {
    const harness = createHarness();
    const first = await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    harness.page.geometryRevision += 1;
    harness.page.geometryChecksumSha256 = sha('9');

    const retry = await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-2',
    });

    expect(first.kind).toBe('saved');
    expect(retry).toMatchObject({
      kind: 'already-exists',
      value: {
        createdBy: 'admin-1',
      },
    });
    expect(harness.rows).toHaveLength(1);
    expect(harness.tx.update).not.toHaveBeenCalled();
  });

  it('accepts a recomputed revision-zero geometry checksum', async () => {
    const harness = createHarness();
    harness.page.geometryRevision = 0;
    harness.page.geometryChecksumSha256 = null;

    await expect(harness.repository.save({
      layout: layout(),
      expected: {
        ...expectedIdentity,
        baseGeometryRevision: 0,
      },
      actorId: 'admin-1',
    })).resolves.toMatchObject({ kind: 'saved' });
  });

  it('reports not-found when the page or owner cannot be locked', async () => {
    const missingPage = createHarness();
    missingPage.page.exists = false;
    await expect(missingPage.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'not-found' });

    const missingOwner = createHarness();
    missingOwner.owner.exists = false;
    await expect(missingOwner.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'not-found' });
  });

  it('rejects a page reparented after owner resolution', async () => {
    const harness = createHarness();
    harness.page.letterId = '71000000-0000-4000-8000-000000000099';

    await expect(harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'source-conflict' });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'owner source revision changed',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.owner.primarySourceRevision += 1;
      },
    },
    {
      name: 'page source checksum changed',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.page.checksumSha256 = sha('9');
      },
    },
  ])('reports source-conflict when $name', async ({ mutate }) => {
    const harness = createHarness();
    mutate(harness);

    await expect(harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'source-conflict' });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'the geometry revision changed',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.page.geometryRevision += 1;
      },
      expected: expectedIdentity,
    },
    {
      name: 'the expected geometry checksum is stale',
      mutate: () => {},
      expected: {
        ...expectedIdentity,
        baseGeometryChecksumSha256: sha('9'),
      },
    },
    {
      name: 'the stored geometry checksum is corrupted',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.page.geometryChecksumSha256 = sha('9');
      },
      expected: expectedIdentity,
    },
    {
      name: 'a nonzero revision lost its stored geometry checksum',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.page.geometryChecksumSha256 = null;
      },
      expected: expectedIdentity,
    },
    {
      name: 'the stored segment geometry is invalid',
      mutate: (harness: ReturnType<typeof createHarness>) => {
        harness.page.lineSegments = [{ line: 1, ocrText: '' }];
      },
      expected: expectedIdentity,
    },
  ])('reports geometry-conflict when $name', async ({
    mutate,
    expected,
  }) => {
    const harness = createHarness();
    mutate(harness);

    await expect(harness.repository.save({
      layout: layout(),
      expected,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'geometry-conflict' });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });

  it('reports projection-conflict for metadata drift with identical shapes', async () => {
    const harness = createHarness();
    const changedProjection = structuredClone(baseLineSegments);
    changedProjection[0].segmentClass = 'ignore';
    harness.page.lineSegments = changedProjection;
    harness.page.geometryChecksumSha256 =
      pageGeometryChecksum(changedProjection);

    await expect(harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    })).resolves.toEqual({ kind: 'projection-conflict' });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });
});

describe('current page geometry proposal lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the exact current proposal from one owner-then-page transaction', async () => {
    const harness = createHarness();
    await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    vi.clearAllMocks();
    harness.lockEvents.length = 0;

    const result = await harness.repository.getCurrent(pageId);

    expect(result).toMatchObject({
      kind: 'found',
      value: {
        artifact: {
          pageId,
          source: expectedIdentity,
        },
      },
    });
    expect(harness.database.transaction).toHaveBeenCalledOnce();
    expect(harness.tx.update).not.toHaveBeenCalled();
    expect(harness.lockEvents).toEqual([
      'page-pointer',
      'owner-lock',
      'page-lock',
      'proposal-lookup',
    ]);

    const lookup = harness.tx.query.pageGeometryProposals.findFirst;
    expect(lookup).toHaveBeenCalledOnce();
    const options = lookup.mock.calls[0][0] as {
      where: Parameters<PgDialect['sqlToQuery']>[0];
      orderBy: Array<Parameters<PgDialect['sqlToQuery']>[0]>;
    };
    const dialect = new PgDialect();
    const filter = dialect.sqlToQuery(options.where);
    expect(filter.params).toEqual(expect.arrayContaining([
      pageId,
      expectedIdentity.primarySourceRevision,
      expectedIdentity.sourceChecksumSha256,
      expectedIdentity.baseGeometryRevision,
      expectedIdentity.baseGeometryChecksumSha256,
      expectedIdentity.baseLineSegmentsChecksumSha256,
    ]));
    expect(options.orderBy).toHaveLength(2);
    expect(options.orderBy.map((order) => (
      dialect.sqlToQuery(order).sql
    ))).toEqual([
      '"page_geometry_proposals"."created_at" desc',
      '"page_geometry_proposals"."id" desc',
    ]);
  });

  it('excludes a proposal after the editable projection changes', async () => {
    const harness = createHarness();
    await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    const priorProjectionChecksum =
      expectedIdentity.baseLineSegmentsChecksumSha256;
    const changedProjection = structuredClone(baseLineSegments);
    changedProjection[0].segmentClass = 'ignore';
    harness.page.lineSegments = changedProjection;
    harness.page.geometryChecksumSha256 =
      pageGeometryChecksum(changedProjection);
    vi.clearAllMocks();

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toEqual({ kind: 'none' });

    const options = (
      harness.tx.query.pageGeometryProposals.findFirst
        .mock.calls[0][0]
    ) as {
      where: Parameters<PgDialect['sqlToQuery']>[0];
    };
    const filter = new PgDialect().sqlToQuery(options.where);
    const currentProjectionChecksum =
      pageLineSegmentsChecksum(changedProjection);
    expect(filter.params).toContain(currentProjectionChecksum);
    expect(filter.params).not.toContain(priorProjectionChecksum);
  });

  it('returns the newest proposal under the same exact identity', async () => {
    const harness = createHarness();
    const firstBuild = buildPageGeometryProposal(
      layoutForRun('rotation-run-1'),
      expectedIdentity,
    );
    const secondBuild = buildPageGeometryProposal(
      layoutForRun('rotation-run-2'),
      expectedIdentity,
    );
    expect(firstBuild).toMatchObject({ kind: 'proposal' });
    expect(secondBuild).toMatchObject({ kind: 'proposal' });
    if (firstBuild.kind !== 'proposal' || secondBuild.kind !== 'proposal') {
      throw new Error('expected proposals');
    }
    expect(firstBuild.artifactChecksumSha256).not.toBe(
      secondBuild.artifactChecksumSha256,
    );
    await harness.repository.save({
      layout: layoutForRun('rotation-run-1'),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    const secondSave = await harness.repository.save({
      layout: layoutForRun('rotation-run-2'),
      expected: expectedIdentity,
      actorId: 'admin-2',
    });
    expect(harness.proposalLookupParams.at(-1)).toContain(
      secondBuild.artifactChecksumSha256,
    );
    expect(secondSave).toMatchObject({ kind: 'saved' });
    expect(harness.rows).toHaveLength(2);
    expect(harness.rows.map((row) => row.runId)).toEqual([
      'rotation-run-2',
      'rotation-run-1',
    ]);

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toMatchObject({
      kind: 'found',
      value: {
        artifact: {
          run: { id: 'rotation-run-2' },
        },
        createdBy: 'admin-2',
      },
    });
  });

  it('rejects a proposal whose stored artifact checksum is corrupted', async () => {
    const harness = createHarness();
    await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    harness.rows[0].artifact.candidates[0].bbox[0] += 1;

    await expect(
      harness.repository.getCurrent(pageId),
    ).rejects.toThrow(/proposal checksum mismatch/);
  });

  it('rejects a checksummed artifact whose raster identity is corrupted', async () => {
    const harness = createHarness();
    await harness.repository.save({
      layout: layout(),
      expected: expectedIdentity,
      actorId: 'admin-1',
    });
    harness.rows[0].artifact.source.image.source!.checksumSha256 = sha('9');
    harness.rows[0].artifactChecksumSha256 =
      pageGeometryProposalArtifactChecksum(harness.rows[0].artifact);

    await expect(
      harness.repository.getCurrent(pageId),
    ).rejects.toThrow(/proposal identity mismatch/);
  });

  it('fails closed when the current stored geometry checksum is corrupted', async () => {
    const harness = createHarness();
    harness.page.geometryChecksumSha256 = sha('9');

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toEqual({ kind: 'corrupt-current-geometry' });
    expect(
      harness.tx.query.pageGeometryProposals.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('fails closed when the current source checksum is malformed', async () => {
    const harness = createHarness();
    harness.page.checksumSha256 = 'NOT-A-SHA256';

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toEqual({ kind: 'corrupt-current-source' });
    expect(
      harness.tx.query.pageGeometryProposals.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('returns not-found when the page does not exist', async () => {
    const harness = createHarness();
    harness.page.exists = false;

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toEqual({ kind: 'not-found' });
    expect(harness.tx.select).not.toHaveBeenCalled();
    expect(harness.tx.query.pageGeometryProposals.findFirst)
      .not.toHaveBeenCalled();
  });

  it('fails closed if the page is reparented between pointer resolution and lock', async () => {
    const harness = createHarness();
    harness.page.letterId = '71000000-0000-4000-8000-000000000099';
    harness.lockEvents.length = 0;

    await expect(
      harness.repository.getCurrent(pageId),
    ).resolves.toEqual({ kind: 'none' });
    expect(harness.lockEvents).toEqual([
      'page-pointer',
      'owner-lock',
      'page-lock',
    ]);
    expect(harness.tx.query.pageGeometryProposals.findFirst)
      .not.toHaveBeenCalled();
  });
});
