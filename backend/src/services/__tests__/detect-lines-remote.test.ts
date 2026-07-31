import { beforeAll, describe, expect, it } from 'vitest';

interface DetectLinesRemoteModule {
  queueEndpointForDetection(options: {
    rotationsDegrees?: readonly [0, 90, 270];
    limit?: number;
    pageId?: string;
  }): string;
  buildDetectionUploadRequest(
    page: Record<string, unknown>,
    nativePageLayout: Record<string, unknown>,
    runId: string,
    options: { rotationsDegrees?: readonly [0, 90, 270] },
  ): {
    method: string;
    endpoint: string;
    body: Record<string, unknown>;
  };
  parseRotationProposalUploadResponse(value: unknown): {
    ok: true;
    status: 'saved' | 'already-exists' | 'no-candidates';
    candidateCount: number;
    proposalId?: string;
    artifactChecksumSha256?: string;
    createdAt?: string;
  };
  parseRotationQueueResponse(value: unknown): {
    pages: Array<{
      pageId: string;
      letterId: string;
      pageNumber: number;
      dateRaw: string;
      primarySourceRevision: number;
      sourceChecksum: string;
      geometryRevision: number;
      geometryChecksumSha256: string;
      lineSegmentsChecksumSha256: string;
    }>;
    total: number;
  };
}

let cli: DetectLinesRemoteModule;

beforeAll(async () => {
  // Keep the CLI implementation in scripts while exercising its exported,
  // side-effect-free request-selection boundary in the normal backend suite.
  const scriptModuleUrl = new URL(
    '../../../scripts/detect-lines-remote.ts',
    import.meta.url,
  ).href;
  cli = (
    await import(/* @vite-ignore */ scriptModuleUrl)
  ) as DetectLinesRemoteModule;
});

const nativePageLayout = {
  schemaVersion: 2,
  marker: 'same native detector envelope',
};

const standardQueuePage = {
  pageId: 'page-1',
  letterId: 'letter-1',
  pageNumber: 1,
  dateRaw: '19450424',
  primarySourceRevision: 3,
  sourceChecksum: 'source-checksum',
};

const rotationQueuePage = {
  ...standardQueuePage,
  geometryRevision: 7,
  geometryChecksumSha256: 'geometry-checksum',
  lineSegmentsChecksumSha256: 'projection-checksum',
};

const proposalId = '33333333-3333-4333-8333-333333333333';
const artifactChecksumSha256 = '9'.repeat(64);
const createdAt = '2026-07-31T14:00:00.000Z';

describe('detect-lines remote endpoint separation', () => {
  it('keeps the existing queue and native-layout upload unchanged by default', () => {
    expect(cli.queueEndpointForDetection({})).toBe(
      '/admin/layout-processing/queue',
    );

    expect(cli.buildDetectionUploadRequest(
      standardQueuePage,
      nativePageLayout,
      'run-standard',
      {},
    )).toEqual({
      method: 'PATCH',
      endpoint: '/admin/letters/pages/page-1/page-layout/kraken',
      body: {
        nativePageLayout,
        runId: 'run-standard',
        primarySourceRevision: 3,
        sourceChecksum: 'source-checksum',
      },
    });
  });

  it('uses the rotation queue and submits a geometry-fenced proposal', () => {
    const rotationMode = {
      rotationsDegrees: [0, 90, 270] as const,
    };

    expect(cli.queueEndpointForDetection(rotationMode)).toBe(
      '/admin/layout-processing/rotation-queue',
    );

    const request = cli.buildDetectionUploadRequest(
      rotationQueuePage,
      nativePageLayout,
      'run-rotation',
      rotationMode,
    );

    expect(request).toEqual({
      method: 'PATCH',
      endpoint:
        '/admin/letters/pages/page-1/geometry-proposals/rotation',
      body: {
        nativePageLayout,
        runId: 'run-rotation',
        source: {
          primarySourceRevision: 3,
          sourceChecksumSha256: 'source-checksum',
          baseGeometryRevision: 7,
          baseGeometryChecksumSha256: 'geometry-checksum',
          baseLineSegmentsChecksumSha256: 'projection-checksum',
        },
      },
    });
    expect(request.endpoint).not.toContain('/page-layout/kraken');
  });

  it('bounds only the rotation queue request on the server', () => {
    expect(cli.queueEndpointForDetection({
      rotationsDegrees: [0, 90, 270],
      pageId: '22222222-2222-4222-8222-222222222222',
      limit: 5,
    })).toBe(
      '/admin/layout-processing/rotation-queue'
      + '?pageId=22222222-2222-4222-8222-222222222222&limit=5',
    );

    expect(cli.queueEndpointForDetection({
      pageId: '22222222-2222-4222-8222-222222222222',
      limit: 5,
    })).toBe('/admin/layout-processing/queue');
  });

  it.each([
    'geometryRevision',
    'geometryChecksumSha256',
    'lineSegmentsChecksumSha256',
  ] as const)(
    'refuses a rotation proposal without the %s fence',
    (missingField) => {
      const page = { ...rotationQueuePage };
      delete page[missingField];

      expect(() => cli.buildDetectionUploadRequest(
        page,
        nativePageLayout,
        'run-rotation',
        { rotationsDegrees: [0, 90, 270] },
      )).toThrow(
        `Rotation queue page page-1 is missing required ${missingField}`,
      );
    },
  );

  it.each([
    {
      response: {
        ok: true,
        status: 'saved',
        candidateCount: 12,
        proposalId,
        artifactChecksumSha256,
        createdAt,
      },
    },
    {
      response: {
        ok: true,
        status: 'already-exists',
        candidateCount: 12,
        proposalId,
        artifactChecksumSha256,
        createdAt,
      },
    },
    {
      response: {
        ok: true,
        status: 'no-candidates',
        candidateCount: 0,
      },
    },
  ])('accepts a measured $response.status proposal response', ({
    response,
  }) => {
    expect(cli.parseRotationProposalUploadResponse(response)).toEqual(
      response,
    );
  });

  it.each([
    null,
    { ok: true, status: 'saved', candidateCount: 1 },
    {
      ok: true,
      status: 'saved',
      candidateCount: 1,
      proposalId,
      artifactChecksumSha256,
    },
    {
      ok: true,
      status: 'saved',
      candidateCount: 1,
      proposalId,
      artifactChecksumSha256: 'not-a-checksum',
      createdAt,
    },
    {
      ok: true,
      status: 'saved',
      candidateCount: 1,
      proposalId: 'not-a-uuid',
      artifactChecksumSha256,
      createdAt,
    },
    {
      ok: true,
      status: 'saved',
      candidateCount: 1,
      proposalId,
      artifactChecksumSha256,
      createdAt: 'not-an-instant',
    },
    {
      ok: true,
      status: 'no-candidates',
      candidateCount: 1,
    },
    {
      ok: true,
      status: 'unknown',
      candidateCount: 0,
    },
    {
      ok: true,
      status: 'saved',
      candidateCount: -1,
      proposalId,
      artifactChecksumSha256,
      createdAt,
    },
  ])('rejects a misleading proposal response %#', (response) => {
    expect(() => (
      cli.parseRotationProposalUploadResponse(response)
    )).toThrow('invalid response');
  });

  it('accepts the exact rotation queue response contract', () => {
    const response = {
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 7,
        geometryChecksumSha256: 'b'.repeat(64),
        lineSegmentsChecksumSha256: 'c'.repeat(64),
      }],
      total: 1,
    };

    expect(cli.parseRotationQueueResponse(response)).toEqual(response);
  });

  it.each([
    {
      pages: [{
        pageId: 'not-a-uuid',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 7,
        geometryChecksumSha256: 'b'.repeat(64),
        lineSegmentsChecksumSha256: 'c'.repeat(64),
      }],
      total: 1,
    },
    {
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 7,
        geometryChecksumSha256: 'not-a-checksum',
        lineSegmentsChecksumSha256: 'c'.repeat(64),
      }],
      total: 1,
    },
    {
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 7,
        lineSegmentsChecksumSha256: 'c'.repeat(64),
      }],
      total: 1,
    },
    {
      pages: [{
        pageId: '22222222-2222-4222-8222-222222222222',
        letterId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 2,
        dateRaw: '19450424',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        geometryRevision: 7,
        geometryChecksumSha256: 'b'.repeat(64),
        lineSegmentsChecksumSha256: 'c'.repeat(64),
      }],
      total: 0,
    },
    {
      pages: [
        {
          pageId: '22222222-2222-4222-8222-222222222222',
          letterId: '11111111-1111-4111-8111-111111111111',
          pageNumber: 2,
          dateRaw: '19450424',
          primarySourceRevision: 4,
          sourceChecksum: 'a'.repeat(64),
          geometryRevision: 7,
          geometryChecksumSha256: 'b'.repeat(64),
          lineSegmentsChecksumSha256: 'c'.repeat(64),
        },
        {
          pageId: '22222222-2222-4222-8222-222222222222',
          letterId: '11111111-1111-4111-8111-111111111111',
          pageNumber: 2,
          dateRaw: '19450424',
          primarySourceRevision: 4,
          sourceChecksum: 'a'.repeat(64),
          geometryRevision: 7,
          geometryChecksumSha256: 'b'.repeat(64),
          lineSegmentsChecksumSha256: 'c'.repeat(64),
        },
      ],
      total: 2,
    },
  ])('rejects a malformed rotation queue response %#', (response) => {
    expect(() => cli.parseRotationQueueResponse(response)).toThrow(
      'Rotation queue endpoint returned an invalid response',
    );
  });
});
