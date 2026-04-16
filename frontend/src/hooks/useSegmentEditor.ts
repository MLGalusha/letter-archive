import { useState, useCallback, useRef, useMemo } from 'react';
import polygonClipping from 'polygon-clipping';
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

interface ResetFromSourceOptions {
  preserveSelection?: boolean;
}

function cloneSegment<T>(segment: T): T {
  return structuredClone(segment);
}

function cloneSegments(segments: EditableSegment[]): EditableSegment[] {
  return segments.map((segment) => cloneSegment(segment));
}

function bboxDistance(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
}

function findClosestSegmentId(
  target: EditableSegment | undefined,
  segments: EditableSegment[],
): string | null {
  if (!target || segments.length === 0) return null;
  let bestMatch: EditableSegment | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const distance = bboxDistance(target.bbox, segment.bbox);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = segment;
    }
  }
  return bestMatch?._id ?? null;
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
  const normalized = segments
    .filter((s) => !s._deleted)
    .map(({ _id, _deleted, _originalBoundary, _originalBbox, ...rest }) =>
      normalizeSegmentForSave(rest),
    );

  return sortSegmentsForReadingOrder(normalized).map((segment, index) => ({
    ...segment,
    line: index + 1,
  }));
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

/** Recompute bbox from a set of boundary points. */
function bboxFromBoundary(boundary: { x: number; y: number }[]): [number, number, number, number] {
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Subdivide a polygon boundary so points are spaced at most `maxSpacing` px apart.
 * Adds invisible intermediate points along each edge for smooth reshape deformation.
 * The shape is preserved exactly — all new points lie on the original edges.
 */
function subdivideBoundary(
  boundary: { x: number; y: number }[],
  maxSpacing: number,
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  const n = boundary.length;
  for (let i = 0; i < n; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % n];
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
    const numSegments = Math.max(1, Math.ceil(edgeLen / maxSpacing));
    for (let j = 0; j < numSegments; j++) {
      const t = j / numSegments;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}

type ClipRing = [number, number][];

function toClipRing(boundary: { x: number; y: number }[]): ClipRing {
  const ring: ClipRing = boundary.map((p) => [p.x, p.y]);
  // polygon-clipping expects closed rings
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return ring;
}

function fromClipRing(ring: ClipRing): { x: number; y: number }[] {
  const pts = ring.map(([x, y]) => ({ x, y }));
  // Strip closing duplicate
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.x === last.x && first.y === last.y) pts.pop();
  }
  return pts;
}

function ringArea(ring: { x: number; y: number }[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Pick the largest outer ring from a MultiPolygon result (ignoring holes). */
function largestOuterRing(
  multi: ClipRing[][],
): { x: number; y: number }[] | null {
  let best: { x: number; y: number }[] | null = null;
  let bestArea = 0;
  for (const poly of multi) {
    if (poly.length === 0) continue;
    const outer = fromClipRing(poly[0]);
    const a = ringArea(outer);
    if (a > bestArea) {
      bestArea = a;
      best = outer;
    }
  }
  return best;
}

function unionBoundaries(
  a: { x: number; y: number }[],
  b: { x: number; y: number }[],
): { x: number; y: number }[] | null {
  try {
    const result = polygonClipping.union([toClipRing(a)], [toClipRing(b)]);
    return largestOuterRing(result as ClipRing[][]);
  } catch {
    return null;
  }
}

function differenceBoundaries(
  a: { x: number; y: number }[],
  b: { x: number; y: number }[],
): { x: number; y: number }[] | null {
  try {
    const result = polygonClipping.difference([toClipRing(a)], [toClipRing(b)]);
    if (!result || result.length === 0) return [];
    return largestOuterRing(result as ClipRing[][]);
  } catch {
    return null;
  }
}

function bboxesOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/**
 * Reduces a dense point trail to a simpler polygon using Ramer-Douglas-Peucker.
 */
function simplifyPoints(
  pts: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  // Find the point with the greatest distance from the line start→end
  const start = pts[0];
  const end = pts[pts.length - 1];
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], start, end);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPoints(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function pointLineDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function compressBoundaryForSave(
  boundary: { x: number; y: number }[],
): { x: number; y: number }[] {
  if (boundary.length < 3) return boundary;

  let next = simplifyPoints(boundary, 2);
  if (next.length > 160) {
    next = simplifyPoints(next, 4);
  }
  if (next.length > 100) {
    next = simplifyPoints(next, 6);
  }

  // Keep saved polygons reasonably dense without exploding payload size.
  next = subdivideBoundary(next, 18);

  if (next.length > 180) {
    const stride = Math.ceil(next.length / 180);
    next = next.filter((_, index) => index % stride === 0);
  }

  return next.length >= 3 ? next : boundary;
}

function medianSegmentHeight(segments: LineSegment[]): number {
  if (segments.length === 0) return 0;
  const heights = segments
    .map((segment) => segment.bbox[3] - segment.bbox[1])
    .sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 === 0 ? (heights[mid - 1] + heights[mid]) / 2 : heights[mid];
}

function sortSegmentsForReadingOrder(segments: LineSegment[]): LineSegment[] {
  const medianHeight = Math.max(1, medianSegmentHeight(segments));
  return [...segments].sort((a, b) => {
    const ay = (a.bbox[1] + a.bbox[3]) / 2;
    const by = (b.bbox[1] + b.bbox[3]) / 2;
    if (Math.abs(ay - by) < medianHeight * 0.5) {
      return a.bbox[0] - b.bbox[0];
    }
    return ay - by;
  });
}

function normalizeSegmentForSave(segment: LineSegment): LineSegment {
  if (!segment.boundary || segment.boundary.length < 3) {
    return segment;
  }

  const boundary = compressBoundaryForSave(segment.boundary);
  const bbox = bboxFromBoundary(boundary);
  const midY = (bbox[1] + bbox[3]) / 2;

  return {
    ...segment,
    boundary,
    bbox,
    baseline: [[bbox[0], midY], [bbox[2], midY]],
  };
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
  /** Create a segment from a polygon (point-by-point draw). */
  addPolygonSegment: (boundary: { x: number; y: number }[]) => void;
  /** Create a segment from a two-point line (given some width). */
  addFreehandSegment: (points: { x: number; y: number }[]) => void;
  /** Duplicate a segment, offset slightly. */
  duplicateSegment: (id: string) => void;
  toggleExcluded: (id: string) => void;
  classifySegment: (id: string, segmentClass: SegmentClass) => void;
  mapSegment: (id: string, text: string) => void;
  unmapSegment: (id: string) => void;
  isDirty: boolean;
  /** Snapshot current state for undo — call once at drag start, not per mouse move. */
  snapshotForUndo: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Resets editor state from fresh source segments (e.g. after save or page switch). */
  resetFromSource: (segments: LineSegment[], options?: ResetFromSourceOptions) => void;
  /** Returns cleaned segments ready for API persistence. */
  getSegmentsForSave: () => LineSegment[];
  /** Returns segment classifications extracted from current segments, keyed by segment index. */
  getClassificationsForSave: () => Record<number, { class: string; isMapped: boolean; mappedLineIds?: string[] }> | null;
  /** Mark state as saved without clearing in-session undo history. */
  markSaved: () => void;
  /** Clear edit-session history and dirty state. */
  clearSessionHistory: () => void;
  /** Move a polygon vertex (called per mouse move during drag). */
  moveVertex: (segId: string, vertexIndex: number, pos: { x: number; y: number }) => void;
  /** Insert a new vertex after the given index. */
  addVertex: (segId: string, afterIndex: number, pos: { x: number; y: number }) => void;
  /** Remove a vertex (minimum 3 vertices enforced). */
  deleteVertex: (segId: string, vertexIndex: number) => void;
  /** Convert a rect-only segment to a 4-point polygon boundary for reshaping. */
  ensureBoundary: (segId: string) => void;
  /** Set the entire boundary at once (used by smooth deformation drag). */
  setBoundary: (segId: string, newBoundary: { x: number; y: number }[]) => void;
  /** Extend the selected segment's boundary by unioning a drawn shape into it. */
  extendSelectedWithShape: (segId: string, shape: { x: number; y: number }[]) => boolean;
  /** Subtract a drawn shape from the selected segment's boundary. */
  subtractShapeFromSelected: (segId: string, shape: { x: number; y: number }[]) => boolean;
  /** Move a segment by translating from original positions by (dx, dy). */
  moveSegment: (
    segId: string,
    origBbox: [number, number, number, number],
    origBoundary: { x: number; y: number }[] | undefined,
    dx: number,
    dy: number,
  ) => void;
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
  const [, setHistoryVersion] = useState(0);

  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const bumpHistoryVersion = useCallback(() => {
    setHistoryVersion((v) => v + 1);
  }, []);

  const pushUndo = useCallback((segments: EditableSegment[], selectedId: string | null) => {
    undoStackRef.current.push({ segments: cloneSegments(segments), selectedId });
    // Limit undo history
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    // New action clears redo stack
    redoStackRef.current = [];
    bumpHistoryVersion();
  }, [bumpHistoryVersion]);

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

  const addPolygonSegment = useCallback(
    (boundary: { x: number; y: number }[]) => {
      if (boundary.length < 3) return;
      const smoothed = subdivideBoundary(boundary, 10);
      const bbox = bboxFromBoundary(smoothed);
      const midY = (bbox[1] + bbox[3]) / 2;
      const newSeg: EditableSegment = {
        _id: makeId(),
        line: -1,
        baseline: [[bbox[0], midY], [bbox[2], midY]],
        bbox,
        boundary: smoothed,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
        _originalBoundary: smoothed.map((p) => ({ ...p })),
        _originalBbox: [...bbox] as [number, number, number, number],
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

  const addFreehandSegment = useCallback(
    (points: { x: number; y: number }[]) => {
      if (points.length < 3) return;
      // Simplify: keep every Nth point based on total count, then subdivide for smoothness
      const simplified = simplifyPoints(points, 3);
      if (simplified.length < 3) return;
      const smoothed = subdivideBoundary(simplified, 10);
      const bbox = bboxFromBoundary(smoothed);
      const midY = (bbox[1] + bbox[3]) / 2;
      const newSeg: EditableSegment = {
        _id: makeId(),
        line: -1,
        baseline: [[bbox[0], midY], [bbox[2], midY]],
        bbox,
        boundary: smoothed,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
        _originalBoundary: smoothed.map((p) => ({ ...p })),
        _originalBbox: [...bbox] as [number, number, number, number],
      };
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return [...prev, newSeg];
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const duplicateSegment = useCallback(
    (id: string) => {
      setEditedSegments((prev) => {
        const seg = prev.find((s) => s._id === id);
        if (!seg) return prev;
        pushUndo(prev, selectedSegmentId);
        const offset = 15;
        const newBbox: [number, number, number, number] = [
          seg.bbox[0] + offset,
          seg.bbox[1] + offset,
          seg.bbox[2] + offset,
          seg.bbox[3] + offset,
        ];
        const newBoundary = seg.boundary
          ? seg.boundary.map((p) => ({ x: p.x + offset, y: p.y + offset }))
          : undefined;
        const midY = (newBbox[1] + newBbox[3]) / 2;
        const newSeg: EditableSegment = {
          ...seg,
          _id: makeId(),
          bbox: newBbox,
          boundary: newBoundary,
          baseline: [[newBbox[0], midY], [newBbox[2], midY]],
          _originalBbox: [...newBbox] as [number, number, number, number],
          _originalBoundary: newBoundary ? newBoundary.map((p) => ({ ...p })) : undefined,
        };
        setSelectedSegmentId(newSeg._id);
        return [...prev, newSeg];
      });
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

  const moveVertex = useCallback(
    (segId: string, vertexIndex: number, pos: { x: number; y: number }) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== segId || !seg.boundary) return seg;
          const newBoundary = seg.boundary.map((p, i) =>
            i === vertexIndex ? { x: pos.x, y: pos.y } : { ...p },
          );
          const newBbox = bboxFromBoundary(newBoundary);
          const midY = (newBbox[1] + newBbox[3]) / 2;
          return {
            ...seg,
            boundary: newBoundary,
            bbox: newBbox,
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
            _originalBoundary: newBoundary.map((p) => ({ ...p })),
            _originalBbox: [...newBbox] as [number, number, number, number],
          };
        }),
      );
      setIsDirty(true);
    },
    [],
  );

  const addVertex = useCallback(
    (segId: string, afterIndex: number, pos: { x: number; y: number }) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) => {
          if (seg._id !== segId || !seg.boundary) return seg;
          const newBoundary = [...seg.boundary];
          newBoundary.splice(afterIndex + 1, 0, { x: pos.x, y: pos.y });
          const newBbox = bboxFromBoundary(newBoundary);
          const midY = (newBbox[1] + newBbox[3]) / 2;
          return {
            ...seg,
            boundary: newBoundary,
            bbox: newBbox,
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
            _originalBoundary: newBoundary.map((p) => ({ ...p })),
            _originalBbox: [...newBbox] as [number, number, number, number],
          };
        });
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const deleteVertex = useCallback(
    (segId: string, vertexIndex: number) => {
      setEditedSegments((prev) => {
        pushUndo(prev, selectedSegmentId);
        return prev.map((seg) => {
          if (seg._id !== segId || !seg.boundary || seg.boundary.length <= 3) return seg;
          const newBoundary = seg.boundary.filter((_, i) => i !== vertexIndex);
          const newBbox = bboxFromBoundary(newBoundary);
          const midY = (newBbox[1] + newBbox[3]) / 2;
          return {
            ...seg,
            boundary: newBoundary,
            bbox: newBbox,
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
            _originalBoundary: newBoundary.map((p) => ({ ...p })),
            _originalBbox: [...newBbox] as [number, number, number, number],
          };
        });
      });
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const ensureBoundary = useCallback(
    (segId: string) => {
      setEditedSegments((prev) => {
        const seg = prev.find((s) => s._id === segId);
        if (!seg) return prev;
        pushUndo(prev, selectedSegmentId);
        return prev.map((s) => {
          if (s._id !== segId) return s;
          // Start with existing boundary or create from bbox
          let raw: { x: number; y: number }[];
          if (s.boundary && s.boundary.length >= 3) {
            raw = s.boundary;
          } else {
            const [x0, y0, x2, y2] = s.bbox;
            raw = [
              { x: x0, y: y0 },
              { x: x2, y: y0 },
              { x: x2, y: y2 },
              { x: x0, y: y2 },
            ];
          }
          // Subdivide for dense control points (~10px spacing)
          const newBoundary = subdivideBoundary(raw, 10);
          return {
            ...s,
            boundary: newBoundary,
            _originalBoundary: newBoundary.map((p) => ({ ...p })),
          };
        });
      });
    },
    [pushUndo, selectedSegmentId],
  );

  const setBoundary = useCallback(
    (segId: string, newBoundary: { x: number; y: number }[]) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== segId) return seg;
          const newBbox = bboxFromBoundary(newBoundary);
          const midY = (newBbox[1] + newBbox[3]) / 2;
          return {
            ...seg,
            boundary: newBoundary,
            bbox: newBbox,
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
            _originalBoundary: newBoundary.map((p) => ({ ...p })),
            _originalBbox: [...newBbox] as [number, number, number, number],
          };
        }),
      );
      setIsDirty(true);
    },
    [],
  );

  const extendSelectedWithShape = useCallback(
    (segId: string, shape: { x: number; y: number }[]): boolean => {
      if (shape.length < 3) return false;
      let didExtend = false;
      setEditedSegments((prev) => {
        const seg = prev.find((s) => s._id === segId);
        if (!seg) return prev;
        // Ensure the target has a polygon boundary
        let currentBoundary = seg.boundary;
        if (!currentBoundary || currentBoundary.length < 3) {
          const [x0, y0, x2, y2] = seg.bbox;
          currentBoundary = [
            { x: x0, y: y0 },
            { x: x2, y: y0 },
            { x: x2, y: y2 },
            { x: x0, y: y2 },
          ];
        }
        const shapeBbox = bboxFromBoundary(shape);
        if (!bboxesOverlap(seg.bbox, shapeBbox)) return prev;
        const merged = unionBoundaries(currentBoundary, shape);
        if (!merged || merged.length < 3) return prev;
        pushUndo(prev, selectedSegmentId);
        const smoothed = subdivideBoundary(merged, 10);
        const newBbox = bboxFromBoundary(smoothed);
        const midY = (newBbox[1] + newBbox[3]) / 2;
        didExtend = true;
        return prev.map((s) =>
          s._id === segId
            ? {
                ...s,
                boundary: smoothed,
                bbox: newBbox,
                baseline: [[newBbox[0], midY], [newBbox[2], midY]],
                _originalBoundary: smoothed.map((p) => ({ ...p })),
                _originalBbox: [...newBbox] as [number, number, number, number],
              }
            : s,
        );
      });
      if (didExtend) setIsDirty(true);
      return didExtend;
    },
    [pushUndo, selectedSegmentId],
  );

  const subtractShapeFromSelected = useCallback(
    (segId: string, shape: { x: number; y: number }[]): boolean => {
      if (shape.length < 3) return false;
      let didChange = false;
      let becameEmpty = false;
      setEditedSegments((prev) => {
        const seg = prev.find((s) => s._id === segId);
        if (!seg) return prev;
        let currentBoundary = seg.boundary;
        if (!currentBoundary || currentBoundary.length < 3) {
          const [x0, y0, x2, y2] = seg.bbox;
          currentBoundary = [
            { x: x0, y: y0 },
            { x: x2, y: y0 },
            { x: x2, y: y2 },
            { x: x0, y: y2 },
          ];
        }
        const shapeBbox = bboxFromBoundary(shape);
        if (!bboxesOverlap(seg.bbox, shapeBbox)) return prev;
        const result = differenceBoundaries(currentBoundary, shape);
        if (result === null) return prev;
        pushUndo(prev, selectedSegmentId);
        if (result.length < 3) {
          // Fully erased — mark deleted
          becameEmpty = true;
          didChange = true;
          return prev.map((s) => (s._id === segId ? { ...s, _deleted: true } : s));
        }
        const smoothed = subdivideBoundary(result, 10);
        const newBbox = bboxFromBoundary(smoothed);
        const midY = (newBbox[1] + newBbox[3]) / 2;
        didChange = true;
        return prev.map((s) =>
          s._id === segId
            ? {
                ...s,
                boundary: smoothed,
                bbox: newBbox,
                baseline: [[newBbox[0], midY], [newBbox[2], midY]],
                _originalBoundary: smoothed.map((p) => ({ ...p })),
                _originalBbox: [...newBbox] as [number, number, number, number],
              }
            : s,
        );
      });
      if (becameEmpty) setSelectedSegmentId(null);
      if (didChange) setIsDirty(true);
      return didChange;
    },
    [pushUndo, selectedSegmentId],
  );

  const moveSegment = useCallback(
    (
      segId: string,
      origBbox: [number, number, number, number],
      origBoundary: { x: number; y: number }[] | undefined,
      dx: number,
      dy: number,
    ) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== segId) return seg;
          const newBbox: [number, number, number, number] = [
            origBbox[0] + dx,
            origBbox[1] + dy,
            origBbox[2] + dx,
            origBbox[3] + dy,
          ];
          const midY = (newBbox[1] + newBbox[3]) / 2;
          const newBoundary = origBoundary
            ? origBoundary.map((p) => ({ x: p.x + dx, y: p.y + dy }))
            : seg.boundary;
          return {
            ...seg,
            bbox: newBbox,
            boundary: newBoundary,
            baseline: [[newBbox[0], midY], [newBbox[2], midY]],
            _originalBbox: [...newBbox] as [number, number, number, number],
            _originalBoundary: newBoundary ? newBoundary.map((p) => ({ ...p })) : undefined,
          };
        }),
      );
      setIsDirty(true);
    },
    [],
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
    const currentSelected = editedSegments.find((segment) => segment._id === selectedSegmentId);
    const restoredSegments = cloneSegments(entry.segments);
    // Push current state onto redo stack before restoring
    setEditedSegments((prev) => {
      redoStackRef.current.push({ segments: cloneSegments(prev), selectedId: selectedSegmentId });
      return restoredSegments;
    });
    setSelectedSegmentId(findClosestSegmentId(currentSelected, restoredSegments));
    setIsDirty(undoStackRef.current.length > 0);
    bumpHistoryVersion();
  }, [editedSegments, selectedSegmentId, bumpHistoryVersion]);

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    const currentSelected = editedSegments.find((segment) => segment._id === selectedSegmentId);
    const restoredSegments = cloneSegments(entry.segments);
    // Push current state onto undo stack before restoring
    setEditedSegments((prev) => {
      undoStackRef.current.push({ segments: cloneSegments(prev), selectedId: selectedSegmentId });
      return restoredSegments;
    });
    setSelectedSegmentId(findClosestSegmentId(currentSelected, restoredSegments));
    setIsDirty(true);
    bumpHistoryVersion();
  }, [editedSegments, selectedSegmentId, bumpHistoryVersion]);

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  const resetFromSource = useCallback((segments: LineSegment[], options?: ResetFromSourceOptions) => {
    const nextSegments = toEditable(segments);
    setEditedSegments(nextSegments);
    if (options?.preserveSelection && selectedSegmentId) {
      const previousSelected = editedSegments.find((segment) => segment._id === selectedSegmentId);
      if (previousSelected) {
        let bestMatch: EditableSegment | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const segment of nextSegments) {
          const distance = bboxDistance(previousSelected.bbox, segment.bbox);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = segment;
          }
        }
        setSelectedSegmentId(bestMatch?._id ?? null);
      } else {
        setSelectedSegmentId(null);
      }
    } else {
      setSelectedSegmentId(null);
    }
    setIsDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpHistoryVersion();
  }, [bumpHistoryVersion, editedSegments, selectedSegmentId]);

  const getSegmentsForSave = useCallback(() => {
    return toLineSegments(editedSegments);
  }, [editedSegments]);

  const getClassificationsForSave = useCallback(() => {
    const saved = toLineSegments(editedSegments);
    const hasAny = saved.some(s => s.segmentClass && s.segmentClass !== 'body');
    if (!hasAny) return null;
    const out: Record<number, { class: string; isMapped: boolean; mappedLineIds?: string[] }> = {};
    for (const s of saved) {
      if (s.segmentClass) {
        out[s.line] = {
          class: s.segmentClass,
          isMapped: s.isMapped ?? false,
        };
      }
    }
    return out;
  }, [editedSegments]);

  const markSaved = useCallback(() => {
    setIsDirty(false);
  }, []);

  const clearSessionHistory = useCallback(() => {
    setIsDirty(false);
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpHistoryVersion();
  }, [bumpHistoryVersion]);

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
    addPolygonSegment,
    addFreehandSegment,
    duplicateSegment,
    toggleExcluded,
    classifySegment,
    mapSegment,
    unmapSegment,
    isDirty,
    snapshotForUndo,
    undo,
    redo,
    canUndo,
    canRedo,
    resetFromSource,
    getSegmentsForSave,
    getClassificationsForSave,
    markSaved,
    clearSessionHistory,
    moveVertex,
    addVertex,
    deleteVertex,
    ensureBoundary,
    setBoundary,
    moveSegment,
    extendSelectedWithShape,
    subtractShapeFromSelected,
  };
}
