import {
  normalizedLayoutSchema,
} from '../layout/schemas.js';
import {
  krakenNativePageLayoutV2Schema,
  type KrakenNativePageLayoutV2,
} from '../../services/kraken-page-layout-adapter.js';
import type { RecognizedSegment } from '../../services/transcript-alignment/aligner.js';

export type AlignmentLayout = {
  preparedImageSha256: string;
  lines: Array<Omit<
    RecognizedSegment,
    'text' | 'recognitionConfidence'
  >>;
};

function orientationFromBaseline(
  baseline: Array<{ x: number; y: number }>,
): number | null {
  const first = baseline[0];
  const last = baseline[baseline.length - 1];
  if (!first || !last) return null;
  const deltaX = last.x - first.x;
  const deltaY = last.y - first.y;
  if (deltaX === 0 && deltaY === 0) return null;
  return Math.atan2(deltaY, deltaX) * (180 / Math.PI);
}

function boundaryFromBox(
  box: [number, number, number, number],
): Array<{ x: number; y: number }> {
  const [left, top, right, bottom] = box;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function flowDirectionSign(
  textDirection:
    KrakenNativePageLayoutV2['segmentation']['textDirection'],
): 1 | -1 {
  // At 90°, the aligner's perpendicular axis points right-to-left. Reverse
  // that projection for vertical-lr so increasing flow position still means
  // the next column in reading order.
  return textDirection === 'vertical-lr' ? -1 : 1;
}

export function parseAlignmentLayout(
  value: unknown,
  expectedPageKey: string,
): AlignmentLayout {
  const legacy = normalizedLayoutSchema.safeParse(value);
  if (legacy.success) {
    if (legacy.data.pageKey !== expectedPageKey) {
      throw new Error(
        `Recognition page ${expectedPageKey} references layout page `
        + legacy.data.pageKey,
      );
    }
    return {
      preparedImageSha256: legacy.data.image.preparedSha256,
      lines: legacy.data.lines.map((line) => ({
        id: line.id,
        regionId: line.regionId,
        orientationDegrees: line.orientationDegrees,
        boundary: line.boundary,
        baseline: line.baseline,
        readingOrderIndex: line.readingOrder?.index ?? null,
      })),
    };
  }

  const native = krakenNativePageLayoutV2Schema.safeParse(value);
  if (!native.success) {
    throw new Error(
      `Layout for ${expectedPageKey} is neither a normalized layout v1 `
      + 'nor a Kraken native PageLayout v2',
    );
  }
  const readingOrder = new Map(
    native.data.segmentation.readingOrder.lineIds.map(
      (lineId, index) => [lineId, index],
    ),
  );
  const pageTextDirection = native.data.segmentation.textDirection;
  const pageOrientation = pageTextDirection.startsWith('vertical') ? 90 : 0;
  return {
    preparedImageSha256: native.data.source.normalized.sha256,
    lines: native.data.segmentation.lines.map((line) => {
      const baseline = line.geometry.type === 'baselines'
        ? line.geometry.baseline
        : null;
      const boundary = line.geometry.type === 'baselines'
        ? line.geometry.boundary
          ?? (
            line.displayExtent.bbox
              ? boundaryFromBox(line.displayExtent.bbox)
              : null
          )
        : boundaryFromBox(line.geometry.bbox);
      const textDirection = line.geometry.type === 'bbox'
        ? line.geometry.textDirection
        : pageTextDirection;
      return {
        id: line.id,
        regionId: line.regionIds[0] ?? null,
        orientationDegrees: baseline
          ? orientationFromBaseline(baseline)
          : textDirection.startsWith('vertical')
            ? 90
            : pageOrientation,
        boundary,
        baseline,
        readingOrderIndex: readingOrder.get(line.id) ?? null,
        flowDirectionSign: flowDirectionSign(textDirection),
      };
    }),
  };
}
