import { describe, expect, it } from 'vitest';
import type { TranscriptAlignmentSegment } from '../../../../api/admin/transcriptAlignment';
import {
  centeredAlignmentScrollTarget,
  containedZoomSurfaceSize,
  unionSegmentBounds,
} from '../zoomNavigation';

function segment(
  id: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): TranscriptAlignmentSegment {
  return {
    id,
    boundary: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    baseline: null,
    orientationDegrees: 0,
    readingOrderIndex: 0,
    recognizedText: '',
    recognitionConfidence: null,
  };
}

describe('alignment zoom navigation', () => {
  it('sizes the zoom surface from the scan aspect ratio rather than the stage shape', () => {
    expect(containedZoomSurfaceSize({
      viewportWidth: 1000,
      viewportHeight: 600,
      imageWidth: 400,
      imageHeight: 800,
      zoom: 2.5,
    })).toEqual({
      width: 750,
      height: 1500,
    });
  });

  it('unites split geometry before choosing the focus point', () => {
    expect(unionSegmentBounds([
      segment('a', 10, 20, 80, 40),
      segment('b', 15, 50, 90, 70),
      segment('other', 0, 0, 100, 100),
    ], ['a', 'b'])).toEqual({
      minX: 10,
      minY: 20,
      maxX: 90,
      maxY: 70,
    });
  });

  it('centers selected geometry and clamps near scan edges', () => {
    expect(centeredAlignmentScrollTarget({
      viewportWidth: 400,
      viewportHeight: 300,
      contentWidth: 1000,
      contentHeight: 1200,
      surfaceLeft: 0,
      surfaceTop: 0,
      surfaceWidth: 1000,
      surfaceHeight: 1200,
      imageWidth: 100,
      imageHeight: 120,
      bounds: { minX: 85, minY: 100, maxX: 95, maxY: 115 },
    })).toEqual({
      left: 600,
      top: 900,
    });
  });

  it('centers the scan itself when a transcript item is unlocated', () => {
    expect(centeredAlignmentScrollTarget({
      viewportWidth: 400,
      viewportHeight: 300,
      contentWidth: 1000,
      contentHeight: 1200,
      surfaceLeft: 0,
      surfaceTop: 0,
      surfaceWidth: 1000,
      surfaceHeight: 1200,
      imageWidth: 100,
      imageHeight: 120,
      bounds: null,
    })).toEqual({
      left: 300,
      top: 450,
    });
  });
});
