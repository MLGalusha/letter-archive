import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LineSegment } from '../../types/Letter';
import { useSegmentEditor } from '../useSegmentEditor';

function baselineSegment(
  overrides: Partial<LineSegment> & Pick<LineSegment, 'id' | 'bbox' | 'baseline'>,
): LineSegment {
  return {
    line: 1,
    geometryType: 'baseline',
    ocrText: '',
    ...overrides,
  };
}

describe('useSegmentEditor native geometry', () => {
  it('labels untouched detector geometry as machine geometry on load and save', () => {
    const source = baselineSegment({
      id: 'machine-line',
      bbox: [10, 20, 110, 70],
      baseline: [[10, 60], [110, 60]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    expect(result.current.editedSegments[0].geometryProvenance).toEqual({
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    });
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('labels drawn geometry as human-created with collision-safe UUID identities', () => {
    const { result } = renderHook(() => useSegmentEditor([]));

    act(() => {
      result.current.addSegment([10, 20, 110, 70]);
      result.current.addPolygonSegment([
        { x: 120, y: 20 },
        { x: 220, y: 20 },
        { x: 220, y: 70 },
        { x: 120, y: 70 },
      ]);
      result.current.addFreehandSegment([
        { x: 230, y: 20 },
        { x: 330, y: 20 },
        { x: 330, y: 70 },
        { x: 230, y: 70 },
      ]);
    });

    const saved = result.current.getSegmentsForSave();
    expect(saved.map((segment) => segment.geometryProvenance)).toEqual([
      {
        source: 'human-created',
        operation: 'create-box',
        parentSegmentIds: [],
      },
      {
        source: 'human-created',
        operation: 'create-polygon',
        parentSegmentIds: [],
      },
      {
        source: 'human-created',
        operation: 'create-freehand',
        parentSegmentIds: [],
      },
    ]);
    expect(new Set(saved.map((segment) => segment.id)).size).toBe(3);
    saved.forEach((segment) => {
      expect(segment.id).toMatch(
        /^seg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  it('records a later edit to human-created geometry as a human adjustment', () => {
    const { result } = renderHook(() => useSegmentEditor([]));

    act(() => {
      result.current.addSegment([10, 20, 110, 70]);
    });
    const segmentId = result.current.editedSegments[0]._id;

    act(() => {
      result.current.resizeSegment(segmentId, [10, 25, 110, 80]);
    });

    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'resize',
      parentSegmentIds: [segmentId],
    });
  });

  it('labels modified detector geometry as human-adjusted and preserves lineage', () => {
    const source = baselineSegment({
      id: 'detector-line',
      bbox: [10, 20, 110, 70],
      baseline: [[10, 60], [110, 60]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.resizeSegment('detector-line', [10, 25, 110, 80]);
    });

    expect(result.current.editedSegments[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'resize',
      parentSegmentIds: ['detector-line'],
    });

    act(() => {
      result.current.moveSegment(
        'detector-line',
        [10, 25, 110, 80],
        undefined,
        5,
        10,
      );
    });

    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'move',
      parentSegmentIds: ['detector-line'],
    });
  });

  it('creates a duplicate with human provenance and its complete parent lineage', () => {
    const source = baselineSegment({
      id: 'adjusted-line',
      bbox: [10, 20, 110, 70],
      baseline: [[10, 60], [110, 60]],
      geometryProvenance: {
        source: 'human-adjusted',
        operation: 'resize',
        parentSegmentIds: ['original-detector-line'],
      },
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.duplicateSegment('adjusted-line');
    });

    expect(result.current.editedSegments[1].geometryProvenance).toEqual({
      source: 'human-created',
      operation: 'duplicate',
      parentSegmentIds: ['original-detector-line', 'adjusted-line'],
    });
  });

  it('stamps each boundary-changing operation without losing machine lineage', () => {
    const source = baselineSegment({
      id: 'editable-line',
      bbox: [10, 20, 110, 70],
      baseline: [[10, 60], [110, 60]],
      boundary: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 70 },
        { x: 10, y: 70 },
      ],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));
    const expectOperation = (operation: string) => {
      expect(result.current.editedSegments[0].geometryProvenance).toEqual({
        source: 'human-adjusted',
        operation,
        parentSegmentIds: ['editable-line'],
      });
    };

    act(() => {
      result.current.moveVertex('editable-line', 0, { x: 8, y: 18 });
    });
    expectOperation('move-vertex');

    act(() => {
      result.current.addVertex('editable-line', 0, { x: 50, y: 18 });
    });
    expectOperation('add-vertex');

    act(() => {
      result.current.deleteVertex('editable-line', 1);
    });
    expectOperation('delete-vertex');

    act(() => {
      result.current.setBoundary('editable-line', [
        { x: 5, y: 15 },
        { x: 115, y: 15 },
        { x: 115, y: 75 },
        { x: 5, y: 75 },
      ]);
    });
    expectOperation('reshape');

    act(() => {
      result.current.transformBoundary('editable-line', [
        { x: 115, y: 15 },
        { x: 115, y: 75 },
        { x: 5, y: 75 },
        { x: 5, y: 15 },
      ]);
    });
    expectOperation('rotate');

    act(() => {
      result.current.extendSelectedWithShape('editable-line', [
        { x: 105, y: 30 },
        { x: 130, y: 30 },
        { x: 130, y: 60 },
        { x: 105, y: 60 },
      ]);
    });
    expectOperation('extend');

    act(() => {
      result.current.subtractShapeFromSelected('editable-line', [
        { x: 110, y: 35 },
        { x: 125, y: 35 },
        { x: 125, y: 55 },
        { x: 110, y: 55 },
      ]);
    });
    expectOperation('subtract');
  });

  it('restores provenance through undo and redo and retains it in serialization', () => {
    const source = baselineSegment({
      id: 'history-line',
      bbox: [0, 0, 100, 100],
      baseline: [[10, 50], [90, 50]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.snapshotForUndo();
      result.current.resizeSegment('history-line', [10, 10, 110, 110]);
    });
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'resize',
      parentSegmentIds: ['history-line'],
    });

    act(() => {
      result.current.undo();
    });
    expect(result.current.editedSegments[0].geometryProvenance).toEqual({
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    });

    act(() => {
      result.current.redo();
    });
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'resize',
      parentSegmentIds: ['history-line'],
    });
  });

  it('preserves stable IDs, provider order, and curved or vertical baselines on save', () => {
    const source: LineSegment[] = [
      baselineSegment({
        id: 'native-sideways',
        line: 8,
        bbox: [400, 300, 450, 600],
        baseline: [[425, 320], [420, 430], [430, 580]],
        boundary: [
          { x: 400, y: 300 },
          { x: 450, y: 300 },
          { x: 450, y: 600 },
          { x: 400, y: 600 },
        ],
      }),
      baselineSegment({
        id: 'native-top',
        line: 2,
        bbox: [20, 20, 300, 80],
        baseline: [[20, 65], [120, 58], [300, 70]],
      }),
    ];

    const { result } = renderHook(() => useSegmentEditor(source));
    const saved = result.current.getSegmentsForSave();

    expect(saved.map((segment) => segment.id)).toEqual([
      'native-sideways',
      'native-top',
    ]);
    expect(saved.map((segment) => segment.line)).toEqual([1, 2]);
    expect(saved[0].baseline).toEqual(source[0].baseline);
    expect(saved[1].baseline).toEqual(source[1].baseline);
  });

  it('affine-transforms every native baseline point when resizing', () => {
    const source = baselineSegment({
      id: 'curved-line',
      bbox: [0, 0, 100, 100],
      baseline: [[10, 10], [50, 40], [80, 90]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.resizeSegment('curved-line', [20, 30, 220, 230]);
    });

    expect(result.current.editedSegments[0].baseline).toEqual([
      [40, 50],
      [120, 110],
      [180, 210],
    ]);
  });

  it('translates a native baseline without cumulative drift during move updates', () => {
    const source = baselineSegment({
      id: 'moving-line',
      bbox: [10, 20, 110, 120],
      baseline: [[20, 30], [50, 60], [80, 100]],
      boundary: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 120 },
        { x: 10, y: 120 },
      ],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));
    const originalBoundary = source.boundary?.map((point) => ({ ...point }));

    act(() => {
      result.current.moveSegment(
        'moving-line',
        source.bbox,
        originalBoundary,
        10,
        15,
      );
      result.current.moveSegment(
        'moving-line',
        source.bbox,
        originalBoundary,
        20,
        25,
      );
    });

    expect(result.current.editedSegments[0].bbox).toEqual([30, 45, 130, 145]);
    expect(result.current.editedSegments[0].baseline).toEqual([
      [40, 55],
      [70, 85],
      [100, 125],
    ]);
  });

  it('keeps native baselines untouched during boundary-only edits', () => {
    const baseline = [[15, 30], [50, 26], [90, 34]];
    const source = baselineSegment({
      id: 'boundary-line',
      bbox: [10, 10, 100, 50],
      baseline,
      boundary: [
        { x: 10, y: 10 },
        { x: 100, y: 10 },
        { x: 100, y: 50 },
        { x: 10, y: 50 },
      ],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.moveVertex('boundary-line', 0, { x: 2, y: 4 });
    });
    expect(result.current.editedSegments[0].baseline).toEqual(baseline);

    act(() => {
      result.current.setBoundary('boundary-line', [
        { x: 5, y: 5 },
        { x: 120, y: 8 },
        { x: 110, y: 60 },
        { x: 8, y: 55 },
      ]);
    });
    expect(result.current.editedSegments[0].baseline).toEqual(baseline);
    expect(result.current.getSegmentsForSave()[0].baseline).toEqual(baseline);
  });

  it('round-trips untouched native polygons exactly during unrelated edits', () => {
    const boundary = [
      { x: 10.125, y: 20.75 },
      { x: 45.5, y: 17.25 },
      { x: 91.875, y: 31.625 },
      { x: 83.25, y: 60.5 },
      { x: 19.375, y: 57.875 },
    ];
    const source = baselineSegment({
      id: 'exact-native-boundary',
      bbox: [10.125, 17.25, 91.875, 60.5],
      baseline: [[14.5, 42.75], [50.25, 39.125], [87.75, 46.5]],
      boundary,
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.classifySegment('exact-native-boundary', 'addition');
    });

    expect(result.current.getSegmentsForSave()[0].boundary).toEqual(boundary);
  });

  it('does not materialize absent optional flags during an untouched round trip', () => {
    const source = baselineSegment({
      id: 'optional-fields',
      bbox: [10, 10, 100, 50],
      baseline: [[10, 40], [100, 40]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    expect(result.current.getSegmentsForSave()[0]).not.toHaveProperty('excluded');
  });

  it('rotates the boundary, curved baseline, and word boxes as one geometry', () => {
    const source = baselineSegment({
      id: 'rotating-line',
      bbox: [0, 0, 100, 100],
      baseline: [[20, 20], [80, 20]],
      boundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      words: [{ text: 'test', bbox: [20, 10, 40, 30] }],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.transformBoundary('rotating-line', [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 0 },
      ]);
    });

    expect(result.current.editedSegments[0].baseline).toEqual([
      [80, 20],
      [80, 80],
    ]);
    expect(result.current.editedSegments[0].words).toEqual([
      { text: 'test', bbox: [70, 20, 90, 40] },
    ]);
  });

  it('tracks the last saved fingerprint across undo and redo', () => {
    const source = baselineSegment({
      id: 'saved-history',
      bbox: [0, 0, 100, 100],
      baseline: [[10, 50], [90, 50]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.snapshotForUndo();
      result.current.resizeSegment('saved-history', [20, 20, 220, 220]);
    });
    const saved = result.current.getSegmentsForSave();
    act(() => {
      result.current.markSaved(saved);
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.undo();
    });
    expect(result.current.editedSegments[0].bbox).toEqual([0, 0, 100, 100]);
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'reshape',
      parentSegmentIds: ['saved-history'],
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.editedSegments[0].bbox).toEqual([20, 20, 220, 220]);
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'resize',
      parentSegmentIds: ['saved-history'],
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('records restoring a segment deleted in the saved revision as human-created geometry', () => {
    const source = baselineSegment({
      id: 'restored-after-save',
      bbox: [0, 0, 100, 100],
      baseline: [[10, 50], [90, 50]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.deleteSegment('restored-after-save');
    });
    act(() => {
      result.current.markSaved(result.current.getSegmentsForSave());
    });
    expect(result.current.getSegmentsForSave()).toEqual([]);

    act(() => {
      result.current.undo();
    });

    expect(result.current.getSegmentsForSave()).toHaveLength(1);
    expect(result.current.getSegmentsForSave()[0].geometryProvenance).toEqual({
      source: 'human-created',
      operation: 'create-box',
      parentSegmentIds: [],
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('treats a server response with different object key order as the same saved projection', () => {
    const source = baselineSegment({
      id: 'stable-signature',
      bbox: [0, 0, 100, 100],
      baseline: [[10, 50], [90, 50]],
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.resizeSegment('stable-signature', [10, 10, 110, 110]);
    });
    const locallySaved = result.current.getSegmentsForSave();
    const serverSaved = locallySaved.map((segment) => {
      const reversedProvenance = segment.geometryProvenance
        ? Object.fromEntries(
          Object.entries(segment.geometryProvenance).reverse(),
        )
        : undefined;
      return Object.fromEntries([
        ...Object.entries(segment)
          .filter(([key]) => key !== 'geometryProvenance')
          .reverse(),
        ...(reversedProvenance
          ? [['geometryProvenance', reversedProvenance] as const]
          : []),
      ]) as unknown as LineSegment;
    });

    act(() => {
      result.current.markSaved(serverSaved);
    });

    expect(result.current.isDirty).toBe(false);
  });

  it('does not persist rotate-mode preparation as a geometry edit', () => {
    const source = baselineSegment({
      id: 'prepare-only',
      bbox: [10, 20, 110, 60],
      baseline: [[10, 50], [110, 50]],
      geometryProvenance: {
        source: 'machine',
        operation: 'detected',
        parentSegmentIds: [],
      },
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.ensureBoundary('prepare-only');
    });
    expect(result.current.editedSegments[0].boundary?.length).toBeGreaterThan(4);
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.classifySegment('prepare-only', 'ignore');
    });
    const saved = result.current.getSegmentsForSave()[0];
    expect(saved).not.toHaveProperty('boundary');
    expect(saved.segmentClass).toBe('ignore');
    expect(saved.geometryProvenance).toEqual({
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    });
  });

  it('records an actual transform after rotate preparation as human-adjusted', () => {
    const source = baselineSegment({
      id: 'prepared-transform',
      bbox: [10, 20, 110, 60],
      baseline: [[10, 50], [110, 50]],
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.ensureBoundary('prepared-transform');
    });
    const prepared = result.current.editedSegments[0].boundary!;
    act(() => {
      result.current.transformBoundary(
        'prepared-transform',
        prepared.map(({ x, y }) => ({ x: x + 5, y: y + 5 })),
      );
    });

    const saved = result.current.getSegmentsForSave()[0];
    expect(saved.boundary).toBeDefined();
    expect(saved.geometryProvenance).toEqual({
      source: 'human-adjusted',
      operation: 'rotate',
      parentSegmentIds: ['prepared-transform'],
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('does not copy provider, mapping, or OCR metadata onto a human duplicate', () => {
    const source = baselineSegment({
      id: 'provider-line',
      bbox: [10, 10, 100, 50],
      baseline: [[10, 40], [100, 40]],
      providerId: 'kraken-line-1',
      providerOrdinal: 7,
      providerTextDirection: 'vertical-lr',
      regionIds: ['region-1'],
      ocrText: 'provider text',
      words: [{ text: 'provider', bbox: [10, 20, 50, 40] }],
      segmentClass: 'addition',
      isMapped: true,
      mappedText: 'mapped',
    });
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.duplicateSegment('provider-line');
    });

    const duplicate = result.current.editedSegments[1];
    expect(duplicate.providerId).toBeUndefined();
    expect(duplicate.providerOrdinal).toBeUndefined();
    expect(duplicate.providerTextDirection).toBeUndefined();
    expect(duplicate.regionIds).toEqual([]);
    expect(duplicate.ocrText).toBe('');
    expect(duplicate.words).toEqual([]);
    expect(duplicate.segmentClass).toBe('body');
    expect(duplicate.isMapped).toBe(false);
    expect(duplicate.mappedText).toBeUndefined();
  });

  it('keeps duplicate geometry inside the source image', () => {
    const source = baselineSegment({
      id: 'edge-line',
      bbox: [920, 930, 1000, 1000],
      baseline: [[925, 985], [995, 985]],
      boundary: [
        { x: 920, y: 930 },
        { x: 1000, y: 930 },
        { x: 1000, y: 1000 },
        { x: 920, y: 1000 },
      ],
    });
    const { result } = renderHook(() => useSegmentEditor(
      [source],
      { width: 1000, height: 1000 },
    ));

    act(() => {
      result.current.duplicateSegment('edge-line');
    });

    const duplicate = result.current.editedSegments[1];
    expect(duplicate.bbox).toEqual([905, 915, 985, 985]);
    expect(duplicate.boundary?.every(
      ({ x, y }) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000,
    )).toBe(true);
    expect(duplicate.baseline?.every(
      ([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000,
    )).toBe(true);
  });

  it('keeps bbox-native and human-drawn areas honestly bbox-only', () => {
    const source: LineSegment = {
      id: 'bbox-native',
      line: 1,
      geometryType: 'bbox',
      bbox: [10, 20, 80, 100],
      bboxSource: 'native-bbox',
      ocrText: '',
    };
    const { result } = renderHook(() => useSegmentEditor([source]));

    act(() => {
      result.current.resizeSegment('bbox-native', [20, 40, 100, 160]);
      result.current.addSegment([200, 200, 300, 260]);
      result.current.addPolygonSegment([
        { x: 350, y: 200 },
        { x: 430, y: 210 },
        { x: 420, y: 280 },
        { x: 345, y: 270 },
      ]);
    });

    const saved = result.current.getSegmentsForSave();
    expect(saved).toHaveLength(3);
    for (const segment of saved) {
      expect(segment.geometryType).toBe('bbox');
      expect(segment.baseline).toBeUndefined();
      expect(segment.id).toBeTruthy();
    }
  });

  it('uses stable identity to preserve selection across a source refresh', () => {
    const first = baselineSegment({
      id: 'stable-first',
      bbox: [10, 10, 100, 50],
      baseline: [[10, 40], [100, 40]],
    });
    const selected = baselineSegment({
      id: 'stable-selected',
      bbox: [150, 10, 250, 50],
      baseline: [[150, 40], [250, 40]],
    });
    const { result } = renderHook(() => useSegmentEditor([first, selected]));

    act(() => {
      result.current.selectSegment('stable-selected');
    });
    act(() => {
      result.current.resetFromSource([
        { ...first, bbox: [145, 10, 245, 50] },
        { ...selected, bbox: [500, 500, 600, 540] },
      ], { preserveSelection: true });
    });

    expect(result.current.selectedSegmentId).toBe('stable-selected');
  });

  it('upgrades a legacy segment with an editor ID without changing its baseline geometry', () => {
    const legacy: LineSegment = {
      line: -1,
      bbox: [10, 10, 100, 50],
      baseline: [[10, 40], [45, 35], [100, 42]],
      ocrText: 'legacy',
      group: 3,
    };
    const { result } = renderHook(() => useSegmentEditor([legacy]));

    const saved = result.current.getSegmentsForSave();
    expect(saved[0].id).toMatch(/^seg-/);
    expect(saved[0].line).toBe(1);
    expect(saved[0].geometryType).toBeUndefined();
    expect(saved[0].baseline).toEqual(legacy.baseline);
    expect(saved[0].group).toBe(3);
  });
});
