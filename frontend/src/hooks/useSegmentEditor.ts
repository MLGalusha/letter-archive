import { useState, useCallback, useRef, useMemo } from 'react';
import type { LineSegment, SegmentClass } from '../types/Letter';

export interface EditableSegment extends LineSegment {
  _id: string;
  excluded?: boolean;
  _deleted?: boolean;
  _originalBoundary?: { x: number; y: number }[];
  _originalBbox?: [number, number, number, number];
}

interface UndoEntry {
  segments: EditableSegment[];
  selectedId: string | null;
}

let nextId = 0;
function makeId(): string {
  return `seg-${Date.now()}-${nextId++}`;
}

function toEditable(segments: LineSegment[]): EditableSegment[] {
  return segments.map((seg) => ({
    ...seg,
    _id: makeId(),
    excluded: seg.excluded ?? false,
    _deleted: false,
    _originalBoundary: seg.boundary ? seg.boundary.map((p) => ({ ...p })) : undefined,
    _originalBbox: [...seg.bbox] as [number, number, number, number],
  }));
}

/** Strip client-only fields and return clean LineSegments for persistence. */
export function toLineSegments(segments: EditableSegment[]): LineSegment[] {
  return segments
    .filter((s) => !s._deleted)
    .map(({ _id, _deleted, _originalBoundary, _originalBbox, ...rest }) => rest);
}

/**
 * Extend a polygon boundary on one side by inserting rectangular extension corners.
 * Keeps all non-edge polygon points unchanged — the original shape is preserved,
 * with a rectangular "tab" appended on the extended side.
 */
function extendPolygonSide(
  currentPoints: { x: number; y: number }[],
  side: 'left' | 'right' | 'top' | 'bottom',
  oEdge: number,
  nEdge: number,
  oBbox: [number, number, number, number],
): { x: number; y: number }[] {
  const n = currentPoints.length;
  if (n < 3) return currentPoints;

  const isH = side === 'left' || side === 'right';
  const getCoord = (p: { x: number; y: number }) => (isH ? p.x : p.y);
  const getPerp = (p: { x: number; y: number }) => (isH ? p.y : p.x);

  const dim = isH ? Math.max(oBbox[2] - oBbox[0], 1) : Math.max(oBbox[3] - oBbox[1], 1);
  const thresh = Math.max(dim * 0.2, 5);

  // Find indices of points near this edge
  const edgeIndices = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (Math.abs(getCoord(currentPoints[i]) - oEdge) <= thresh) {
      edgeIndices.add(i);
    }
  }

  if (edgeIndices.size < 1) return currentPoints;

  // Find extreme perpendicular points on this edge (e.g. topmost and bottommost for left/right)
  let aIdx = -1;
  let bIdx = -1;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const i of edgeIndices) {
    const p = getPerp(currentPoints[i]);
    if (p < minP) { minP = p; aIdx = i; }
    if (p > maxP) { maxP = p; bIdx = i; }
  }
  if (aIdx === bIdx || aIdx < 0 || bIdx < 0) return currentPoints;

  // Determine which direction around the polygon traces the edge
  const walkPath = (start: number, end: number, dir: 1 | -1): number[] => {
    const path: number[] = [];
    for (let i = start; ; ) {
      path.push(i);
      if (i === end) break;
      i = (i + dir + n) % n;
      if (path.length > n) break;
    }
    return path;
  };
  const fwdPath = walkPath(aIdx, bIdx, 1);
  const bwdPath = walkPath(aIdx, bIdx, -1);

  const density = (path: number[]) =>
    path.filter((i) => edgeIndices.has(i)).length / Math.max(path.length, 1);

  const nonEdgePath = density(fwdPath) >= density(bwdPath) ? bwdPath : fwdPath;

  // Build new polygon: A → extension corners → B → non-edge path back to A
  const result: { x: number; y: number }[] = [];
  const aPoint = currentPoints[aIdx];
  const bPoint = currentPoints[bIdx];

  result.push(aPoint);
  if (isH) {
    result.push({ x: nEdge, y: aPoint.y });
    result.push({ x: nEdge, y: bPoint.y });
  } else {
    result.push({ x: aPoint.x, y: nEdge });
    result.push({ x: bPoint.x, y: nEdge });
  }
  result.push(bPoint);

  // Non-edge path from B back to A (excluding both endpoints)
  const revNonEdge = [...nonEdgePath].reverse();
  for (let i = 1; i < revNonEdge.length - 1; i++) {
    result.push(currentPoints[revNonEdge[i]]);
  }

  return result;
}

/**
 * Derive a new boundary polygon from the original boundary after a bbox resize.
 * - Shrunk sides: clamp original points to the new edge.
 * - Extended sides: insert rectangular extension corners (original polygon shape is preserved).
 * - Shrink-then-extend restores the original because we always derive from the original.
 */
function buildExtendedBoundary(
  original: { x: number; y: number }[],
  oBbox: [number, number, number, number],
  nBbox: [number, number, number, number],
): { x: number; y: number }[] {
  if (original.length < 3) return original;

  const [ox0, oy0, ox2, oy2] = oBbox;
  const [nx0, ny0, nx2, ny2] = nBbox;

  // Clamp for shrunk sides (extended sides leave points unchanged)
  const clamped = original.map((p) => {
    let { x, y } = p;
    if (nx0 > ox0) x = Math.max(nx0, x);
    if (nx2 < ox2) x = Math.min(nx2, x);
    if (ny0 > oy0) y = Math.max(ny0, y);
    if (ny2 < oy2) y = Math.min(ny2, y);
    return { x, y };
  });

  const extRight = nx2 > ox2;
  const extLeft = nx0 < ox0;
  const extBottom = ny2 > oy2;
  const extTop = ny0 < oy0;

  if (!extRight && !extLeft && !extBottom && !extTop) return clamped;

  let result = clamped;
  if (extRight) result = extendPolygonSide(result, 'right', ox2, nx2, oBbox);
  if (extLeft) result = extendPolygonSide(result, 'left', ox0, nx0, oBbox);
  if (extBottom) result = extendPolygonSide(result, 'bottom', oy2, ny2, oBbox);
  if (extTop) result = extendPolygonSide(result, 'top', oy0, ny0, oBbox);

  return result;
}

export interface UseSegmentEditorReturn {
  segmentEditMode: boolean;
  setSegmentEditMode: (v: boolean) => void;
  editedSegments: EditableSegment[];
  selectedSegmentId: string | null;
  selectSegment: (id: string | null) => void;
  resizeSegment: (id: string, newBbox: [number, number, number, number]) => void;
  deleteSegment: (id: string) => void;
  addSegment: (bbox: [number, number, number, number]) => void;
  toggleExcluded: (id: string) => void;
  classifySegment: (id: string, segmentClass: SegmentClass) => void;
  mapSegment: (id: string, text: string) => void;
  unmapSegment: (id: string) => void;
  isDirty: boolean;
  /** Snapshot current state for undo — call once at drag start, not per mouse move. */
  snapshotForUndo: () => void;
  undo: () => void;
  canUndo: boolean;
  /** Resets editor state from fresh source segments (e.g. after save or page switch). */
  resetFromSource: (segments: LineSegment[]) => void;
  /** Returns cleaned segments ready for API persistence. */
  getSegmentsForSave: () => LineSegment[];
  /** Mark state as clean (after a successful save). */
  markClean: () => void;
}

export function useSegmentEditor(
  sourceSegments: LineSegment[],
): UseSegmentEditorReturn {
  const [segmentEditMode, setSegmentEditMode] = useState(false);
  const [editedSegments, setEditedSegments] = useState<EditableSegment[]>(() =>
    toEditable(sourceSegments),
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const undoStackRef = useRef<UndoEntry[]>([]);

  const pushUndo = useCallback((segments: EditableSegment[], selectedId: string | null) => {
    undoStackRef.current.push({ segments: segments.map((s) => ({ ...s })), selectedId });
    // Limit undo history
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
  }, []);

  const selectSegment = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
  }, []);

  const resizeSegment = useCallback(
    (id: string, newBbox: [number, number, number, number]) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== id) return seg;
          const midY = (newBbox[1] + newBbox[3]) / 2;
          const newBaseline: number[][] = [[newBbox[0], midY], [newBbox[2], midY]];

          // Derive boundary from originals — polygon shape is preserved,
          // extensions get rectangular tabs, shrink-then-extend restores the original.
          const newBoundary =
            seg._originalBoundary && seg._originalBoundary.length > 2 && seg._originalBbox
              ? buildExtendedBoundary(seg._originalBoundary, seg._originalBbox, newBbox)
              : seg.boundary;

          return { ...seg, bbox: newBbox, boundary: newBoundary, baseline: newBaseline };
        }),
      );
      setIsDirty(true);
    },
    [],
  );

  const deleteSegment = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) => (seg._id === id ? { ...seg, _deleted: true } : seg));
      });
      setSelectedSegmentId(null);
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const addSegment = useCallback(
    (bbox: [number, number, number, number]) => {
      const midY = (bbox[1] + bbox[3]) / 2;
      const newSeg: EditableSegment = {
        _id: makeId(),
        line: -1, // user-created, no original line number
        baseline: [[bbox[0], midY], [bbox[2], midY]],
        bbox,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
      };
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return [...prev, newSeg];
      });
      setSelectedSegmentId(newSeg._id);
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const toggleExcluded = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) =>
          seg._id === id ? { ...seg, excluded: !seg.excluded } : seg,
        );
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const classifySegment = useCallback(
    (id: string, segmentClass: SegmentClass) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) =>
          seg._id === id ? { ...seg, segmentClass } : seg,
        );
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const mapSegment = useCallback(
    (id: string, text: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) =>
          seg._id === id ? { ...seg, isMapped: true, mappedText: text } : seg,
        );
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const unmapSegment = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) =>
          seg._id === id ? { ...seg, isMapped: false, mappedText: undefined } : seg,
        );
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const snapshotForUndo = useCallback(() => {
    setEditedSegments((prev) => {
      pushUndo(prev, selectedSegmentId);
      return prev;
    });
  }, [pushUndo, selectedSegmentId]);

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setEditedSegments(entry.segments);
    setSelectedSegmentId(entry.selectedId);
    // If undo stack is empty, we're back to clean state
    setIsDirty(undoStackRef.current.length > 0);
  }, []);

  const canUndo = undoStackRef.current.length > 0;

  const resetFromSource = useCallback((segments: LineSegment[]) => {
    setEditedSegments(toEditable(segments));
    setSelectedSegmentId(null);
    setIsDirty(false);
    undoStackRef.current = [];
  }, []);

  const getSegmentsForSave = useCallback(() => {
    return toLineSegments(editedSegments);
  }, [editedSegments]);

  const markClean = useCallback(() => {
    setIsDirty(false);
    undoStackRef.current = [];
  }, []);

  // Visible (non-deleted) segments for rendering
  const visibleSegments = useMemo(
    () => editedSegments.filter((s) => !s._deleted),
    [editedSegments],
  );

  return {
    segmentEditMode,
    setSegmentEditMode,
    editedSegments: visibleSegments,
    selectedSegmentId,
    selectSegment,
    resizeSegment,
    deleteSegment,
    addSegment,
    toggleExcluded,
    classifySegment,
    mapSegment,
    unmapSegment,
    isDirty,
    snapshotForUndo,
    undo,
    canUndo,
    resetFromSource,
    getSegmentsForSave,
    markClean,
  };
}
