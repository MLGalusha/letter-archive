import {
  pageLayoutV2Schema,
  type PageLayoutBoundingBox,
  type PageLayoutLine,
  type PageLayoutPoint,
  type PageLayoutV2,
} from '../schemas/page-layout-v2.js';
import type { LineSegment } from './line-segments.js';
import { pageGeometryChecksum } from '../schemas/page-geometry.js';
import { pageLayoutChecksum } from './page-layout-checksum.js';
import {
  insertSourceBoundPageLayout,
  type PageLayoutProjectionAction,
  type PageSourceExpectation,
} from './page-source-bound-write.js';

function pointExtent(points: PageLayoutPoint[]): PageLayoutBoundingBox {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}

function displayBox(line: PageLayoutLine): {
  box: PageLayoutBoundingBox;
  source: string;
} {
  if (line.kind === 'bbox') {
    return {
      box: line.boundingBox,
      source: 'native-bbox',
    };
  }
  if (line.displayExtent?.boundingBox) {
    return {
      box: line.displayExtent.boundingBox,
      source: line.displayExtent.source,
    };
  }
  if (line.boundingBox) {
    return {
      box: line.boundingBox,
      source: 'stored-bounding-box',
    };
  }
  if (line.boundary) {
    return {
      box: pointExtent(line.boundary),
      source: 'derived-boundary-aabb',
    };
  }
  return {
    box: pointExtent(line.baseline),
    source: 'derived-baseline-aabb',
  };
}

function positiveDisplayBox(
  value: PageLayoutBoundingBox,
  width: number,
  height: number,
): [number, number, number, number] {
  let { xMin, yMin, xMax, yMax } = value;
  if (xMax === xMin) {
    if (xMax < width) xMax += 1;
    else xMin = Math.max(0, xMin - 1);
  }
  if (yMax === yMin) {
    if (yMax < height) yMax += 1;
    else yMin = Math.max(0, yMin - 1);
  }
  return [xMin, yMin, xMax, yMax];
}

/**
 * Produces the mutable admin-review projection from immutable PageLayoutV2.
 *
 * This projection keeps native baselines/bboxes and stable IDs. It may derive
 * a one-pixel display box for baseline-only geometry because the current
 * editor needs a positive-area hit target; that display box is never written
 * back into the canonical detector document.
 */
export function pageLayoutToLineSegments(layout: PageLayoutV2): LineSegment[] {
  const byId = new Map(layout.lines.map((line) => [line.id, line]));
  return layout.readingOrder.primary.lineIds.map((lineId, index) => {
    const line = byId.get(lineId);
    if (!line) {
      throw new Error(`Reading order references missing line ${lineId}`);
    }
    const extent = displayBox(line);
    return {
      id: line.id,
      line: index + 1,
      geometryType: line.kind,
      ...(line.providerId ? { providerId: line.providerId } : {}),
      ...(line.providerOrdinal !== undefined
        ? { providerOrdinal: line.providerOrdinal }
        : {}),
      ...(line.providerTextDirection
        ? { providerTextDirection: line.providerTextDirection }
        : {}),
      ...(line.kind === 'baseline'
        ? {
          baseline: line.baseline.map(({ x, y }) => [x, y]),
          ...(line.boundary
            ? {
              boundary: line.boundary.map(({ x, y }) => ({ x, y })),
            }
            : {}),
        }
        : {}),
      bbox: positiveDisplayBox(
        extent.box,
        layout.image.width,
        layout.image.height,
      ),
      bboxSource: extent.source,
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
      ocrText: line.text ?? '',
      ...(line.words
        ? {
          words: line.words.map((word) => ({
            text: word.text,
            bbox: [
              word.boundingBox.xMin,
              word.boundingBox.yMin,
              word.boundingBox.xMax,
              word.boundingBox.yMax,
            ],
          })),
        }
        : {}),
      regionIds: line.regionIds ?? [],
    };
  });
}

export function parseStoredPageLayoutV2(value: unknown): PageLayoutV2 | null {
  const parsed = pageLayoutV2Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function savePageLayoutV2(
  pageId: string,
  value: unknown,
  expected: PageSourceExpectation,
): Promise<{
  saved: boolean;
  checksumSha256: string;
  lineCount: number;
  projectionAction: PageLayoutProjectionAction | null;
}> {
  const layout = pageLayoutV2Schema.parse(value);
  if (layout.pageId !== pageId) {
    throw new Error('PageLayoutV2 pageId does not match the target page');
  }
  const layoutSourceChecksum = layout.image.source?.checksumSha256
    ?? layout.image.checksumSha256;
  if (expected.sourceChecksum !== layoutSourceChecksum) {
    throw new Error(
      'PageLayoutV2 source checksum does not match the expected page source',
    );
  }
  const checksumSha256 = pageLayoutChecksum(layout);
  const lineSegments = pageLayoutToLineSegments(layout);
  const write = await insertSourceBoundPageLayout(
    pageId,
    {
      pageLayout: layout,
      pageLayoutChecksumSha256: checksumSha256,
      updatedAt: new Date(),
    },
    {
      lineSegments,
      geometryRevision: 0,
      geometryChecksumSha256: pageGeometryChecksum(lineSegments),
      segmentTrustState: 'unverified',
    },
    expected,
  );
  return {
    saved: write.saved,
    checksumSha256,
    lineCount: lineSegments.length,
    projectionAction: write.projectionAction,
  };
}
