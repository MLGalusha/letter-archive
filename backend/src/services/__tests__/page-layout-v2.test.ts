import { describe, expect, it } from 'vitest';
import {
  pageLayoutV2Schema,
  type PageLayoutProvenance,
} from '../../schemas/page-layout-v2.js';
import { readLegacyLineSegmentsAsPageLayoutV2 } from '../page-layout-v2.js';
import type { LineSegment } from '../line-segments.js';

const checksum = (character: string) => character.repeat(64);

const provenance: PageLayoutProvenance = {
  producer: {
    name: 'layout-worker',
    version: '2.1.0',
  },
  model: {
    name: 'historical-lines',
    version: '7.0.3',
    checksumSha256: checksum('a'),
  },
  config: {
    name: 'archive-default',
    version: '3',
    checksumSha256: checksum('b'),
    parameters: {
      threshold: 0.5,
      nested: { enabled: true },
    },
  },
};

function validLayout() {
  return {
    schemaVersion: 2,
    layoutId: 'layout-001',
    runId: 'run-001',
    pageId: 'page-001',
    image: {
      width: 1_000,
      height: 1_500,
      checksumSha256: checksum('c'),
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
    },
    provenance,
    lineRepresentation: 'mixed',
    textDirection: 'horizontal-lr',
    scriptDetection: false,
    language: ['eng'],
    pageBoundary: [
      { x: 10, y: 10 },
      { x: 990, y: 10 },
      { x: 990, y: 1_490 },
      { x: 10, y: 1_490 },
    ],
    lines: [
      {
        id: 'line-baseline-1',
        providerId: 'provider-uuid-that-may-change',
        kind: 'baseline',
        text: 'First line',
        direction: 'left-to-right',
        providerTextDirection: 'horizontal-lr',
        regionIds: ['region-body'],
        baseline: [{ x: 100, y: 120 }, { x: 800, y: 125 }],
        boundary: [
          { x: 90, y: 90 },
          { x: 810, y: 90 },
          { x: 810, y: 135 },
          { x: 90, y: 135 },
        ],
      },
      {
        id: 'line-bbox-2',
        kind: 'bbox',
        text: 'Side note',
        direction: 'top-to-bottom',
        providerTextDirection: 'vertical-lr',
        regionIds: ['region-body'],
        boundingBox: {
          xMin: 850,
          yMin: 200,
          xMax: 900,
          yMax: 700,
        },
        words: [{
          id: 'word-side',
          text: 'Side',
          boundingBox: {
            xMin: 855,
            yMin: 205,
            xMax: 895,
            yMax: 300,
          },
        }],
      },
    ],
    regions: [{
      id: 'region-body',
      type: 'body',
      boundary: [
        { x: 50, y: 50 },
        { x: 950, y: 50 },
        { x: 950, y: 1_400 },
        { x: 50, y: 1_400 },
      ],
      lineIds: ['line-baseline-1', 'line-bbox-2'],
    }],
    readingOrder: {
      primary: {
        id: 'order-primary',
        direction: 'top-to-bottom',
        lineIds: ['line-baseline-1', 'line-bbox-2'],
      },
      alternatives: [{
        id: 'order-side-first',
        direction: 'mixed',
        lineIds: ['line-bbox-2', 'line-baseline-1'],
      }],
    },
  };
}

describe('PageLayoutV2 schema', () => {
  it('accepts baseline and bbox lines with complete provenance and reading orders', () => {
    const parsed = pageLayoutV2Schema.parse(validLayout());

    expect(parsed.lines.map((line) => line.kind)).toEqual(['baseline', 'bbox']);
    expect(parsed.readingOrder.alternatives).toHaveLength(1);
    expect(parsed.provenance.config.parameters).toEqual({
      threshold: 0.5,
      nested: { enabled: true },
    });
  });

  it('rejects unknown schema versions and unknown fields', () => {
    expect(pageLayoutV2Schema.safeParse({
      ...validLayout(),
      schemaVersion: 3,
    }).success).toBe(false);

    expect(pageLayoutV2Schema.safeParse({
      ...validLayout(),
      accidentalField: true,
    }).success).toBe(false);
  });

  it.each([
    ['one-point baseline', (layout: ReturnType<typeof validLayout>) => {
      layout.lines[0].baseline = [{ x: 10, y: 10 }];
    }],
    ['collinear boundary', (layout: ReturnType<typeof validLayout>) => {
      layout.lines[0].boundary = [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ];
    }],
    ['out-of-image point', (layout: ReturnType<typeof validLayout>) => {
      layout.lines[0].baseline![1] = { x: 1_001, y: 125 };
    }],
    ['inverted box', (layout: ReturnType<typeof validLayout>) => {
      layout.lines[1].boundingBox!.xMax = 800;
    }],
  ])('rejects malformed geometry: %s', (_name, mutate) => {
    const layout = validLayout();
    mutate(layout);
    expect(pageLayoutV2Schema.safeParse(layout).success).toBe(false);
  });

  it('rejects duplicate entity IDs and duplicate or dangling line references', () => {
    const duplicateId = validLayout();
    duplicateId.regions[0].id = 'line-baseline-1';
    expect(pageLayoutV2Schema.safeParse(duplicateId).success).toBe(false);

    const danglingRegion = validLayout();
    danglingRegion.regions[0].lineIds = ['missing-line'];
    expect(pageLayoutV2Schema.safeParse(danglingRegion).success).toBe(false);

    const duplicateOrderReference = validLayout();
    duplicateOrderReference.readingOrder.primary.lineIds = [
      'line-baseline-1',
      'line-baseline-1',
    ];
    expect(
      pageLayoutV2Schema.safeParse(duplicateOrderReference).success,
    ).toBe(false);

    const incompleteAlternative = validLayout();
    incompleteAlternative.readingOrder.alternatives[0].lineIds = [
      'line-baseline-1',
    ];
    expect(pageLayoutV2Schema.safeParse(incompleteAlternative).success).toBe(false);
  });

  it('keeps the baseline-only boundary out of bbox-line variants', () => {
    const layout = validLayout();
    Object.assign(layout.lines[1], {
      boundary: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
    });

    expect(pageLayoutV2Schema.safeParse(layout).success).toBe(false);
  });
});

describe('legacy LineSegment read adapter', () => {
  const segments: LineSegment[] = [
    {
      line: 7,
      baseline: [[10, 20], [90, 22]],
      bbox: [8, 10, 92, 30],
      ocrText: 'Legacy line',
      boundary: [
        { x: 8, y: 10 },
        { x: 92, y: 10 },
        { x: 92, y: 30 },
        { x: 8, y: 30 },
      ],
      words: [
        { text: 'Legacy', bbox: [8, 10, 45, 30] },
        { text: 'line', bbox: [50, 10, 92, 30] },
      ],
    },
    {
      line: -1,
      baseline: [[12, 50], [88, 50]],
      bbox: [10, 40, 90, 60],
      ocrText: '',
    },
  ];

  const context = {
    pageId: 'legacy-page',
    image: {
      width: 100,
      height: 100,
      checksumSha256: checksum('d'),
    },
    provenance,
    direction: 'left-to-right' as const,
  };

  it('retains every legacy field and derives deterministic stable IDs', () => {
    const first = readLegacyLineSegmentsAsPageLayoutV2(segments, context);
    const second = readLegacyLineSegmentsAsPageLayoutV2(segments, context);

    expect(second).toEqual(first);
    expect(first.layoutId).toMatch(/^legacy-layout-/);
    expect(first.runId).toMatch(/^legacy-run-/);
    expect(first.lines[0]).toMatchObject({
      kind: 'baseline',
      sourceLineNumber: 7,
      text: 'Legacy line',
      direction: 'left-to-right',
      baseline: [{ x: 10, y: 20 }, { x: 90, y: 22 }],
      boundingBox: { xMin: 8, yMin: 10, xMax: 92, yMax: 30 },
      boundary: [
        { x: 8, y: 10 },
        { x: 92, y: 10 },
        { x: 92, y: 30 },
        { x: 8, y: 30 },
      ],
      words: [
        {
          text: 'Legacy',
          boundingBox: { xMin: 8, yMin: 10, xMax: 45, yMax: 30 },
        },
        {
          text: 'line',
          boundingBox: { xMin: 50, yMin: 10, xMax: 92, yMax: 30 },
        },
      ],
    });
    expect(first.lines[1]).not.toHaveProperty('boundary');
    expect(first.lines[1]).not.toHaveProperty('words');
    expect(first.readingOrder.primary.lineIds).toEqual(
      first.lines.map((line) => line.id),
    );
  });

  it('keeps archive line IDs stable when legacy array order changes', () => {
    const forward = readLegacyLineSegmentsAsPageLayoutV2(segments, context);
    const reverse = readLegacyLineSegmentsAsPageLayoutV2(
      [...segments].reverse(),
      context,
    );
    const forwardIds = new Map(
      forward.lines.map((line) => [line.sourceLineNumber, line.id]),
    );
    const reverseIds = new Map(
      reverse.lines.map((line) => [line.sourceLineNumber, line.id]),
    );

    expect(reverseIds).toEqual(forwardIds);
    expect(reverse.readingOrder.primary.lineIds).toEqual(
      reverse.lines.map((line) => line.id),
    );
  });

  it('does not use editable OCR text or provider UUIDs as archive line IDs', () => {
    const original = readLegacyLineSegmentsAsPageLayoutV2(segments, context);
    const edited = structuredClone(segments);
    edited[0].ocrText = 'Human-corrected text';

    const adaptedEdit = readLegacyLineSegmentsAsPageLayoutV2(edited, context);
    expect(adaptedEdit.lines[0].id).toBe(original.lines[0].id);
    expect(adaptedEdit.lines[0].id).not.toContain('provider');
  });

  it('rejects malformed legacy points instead of truncating them', () => {
    const malformed = structuredClone(segments) as unknown as Array<{
      baseline: unknown[];
    }>;
    malformed[0]!.baseline[0] = [10, 20, 30];

    expect(() => readLegacyLineSegmentsAsPageLayoutV2(
      malformed as unknown as LineSegment[],
      context,
    )).toThrow();
  });
});
