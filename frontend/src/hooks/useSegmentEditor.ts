import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import polygonClipping from 'polygon-clipping';
import type {
  LineSegment,
  LineSegmentWord,
  SegmentClass,
  SegmentGeometryOperation,
  SegmentGeometryProvenance,
} from '../types/Letter';

export interface EditableSegment extends LineSegment {
  _id: string;
  excluded?: boolean;
  _deleted?: boolean;
  _originalBoundary?: { x: number; y: number }[];
  _originalBbox?: [number, number, number, number];
  /** Only generated/densified human geometry is simplified on persistence. */
  _compressBoundaryOnSave?: boolean;
  /**
   * Boundary before an editor-only rotate preparation. If no real geometry
   * edit follows, persistence restores this value instead of inventing a
   * human change merely because the rotate tool was opened.
   */
  _preparedBoundaryOriginal?: { x: number; y: number }[] | null;
}

interface UndoEntry {
  segments: EditableSegment[];
  selectedId: string | null;
  savedGeneration: number;
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
  const sameStableId = segments.find((segment) => segment._id === target._id);
  if (sameStableId) return sameStableId._id;

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

function makeId(): string {
  return `seg-${globalThis.crypto.randomUUID()}`;
}

function uniqueSegmentIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function normalizeGeometryProvenance(
  segment: LineSegment,
  stableId: string,
): SegmentGeometryProvenance {
  const provenance = segment.geometryProvenance;
  if (!provenance) {
    return {
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    };
  }

  return {
    source: provenance.source,
    operation: provenance.operation,
    parentSegmentIds: uniqueSegmentIds([
      ...provenance.parentSegmentIds,
      ...(provenance.source === 'human-adjusted'
        && provenance.parentSegmentIds.length === 0
        ? [stableId]
        : []),
    ]),
  };
}

function humanCreatedGeometryProvenance(
  operation: Extract<
    SegmentGeometryOperation,
    'create-box' | 'create-polygon' | 'create-freehand' | 'duplicate'
  >,
  parentSegmentIds: string[] = [],
): SegmentGeometryProvenance {
  return {
    source: 'human-created',
    operation,
    parentSegmentIds: uniqueSegmentIds(parentSegmentIds),
  };
}

function stampGeometryChange(
  segment: EditableSegment,
  operation: Exclude<
    SegmentGeometryOperation,
    'detected' | 'create-box' | 'create-polygon' | 'create-freehand' | 'duplicate'
  >,
): EditableSegment {
  const current = normalizeGeometryProvenance(segment, segment.id ?? segment._id);
  return {
    ...segment,
    _preparedBoundaryOriginal: undefined,
    geometryProvenance: {
      source: 'human-adjusted',
      operation,
      parentSegmentIds: uniqueSegmentIds([
        ...current.parentSegmentIds,
        segment.id ?? segment._id,
      ]),
    },
  };
}

function toEditable(segments: LineSegment[]): EditableSegment[] {
  return segments.map((seg) => {
    const stableId = seg.id ?? makeId();
    return {
      ...seg,
      id: stableId,
      _id: stableId,
      geometryProvenance: normalizeGeometryProvenance(seg, stableId),
      baseline: seg.baseline?.map(([x, y]) => [x, y]),
      boundary: seg.boundary?.map((point) => ({ ...point })),
      ...(seg.excluded !== undefined ? { excluded: seg.excluded } : {}),
      _deleted: false,
      _originalBoundary: seg.boundary ? seg.boundary.map((p) => ({ ...p })) : undefined,
      _originalBbox: [...seg.bbox] as [number, number, number, number],
    };
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (
      nestedValue === null
      || typeof nestedValue !== 'object'
      || Array.isArray(nestedValue)
    ) {
      return nestedValue;
    }

    return Object.keys(nestedValue)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = (nestedValue as Record<string, unknown>)[key];
        return sorted;
      }, {});
  });
}

export function lineSegmentsSignature(segments: LineSegment[]): string {
  return stableStringify(segments);
}

function persistedSignature(segments: EditableSegment[]): string {
  return lineSegmentsSignature(toLineSegments(segments));
}

function withoutEditorFields(segment: EditableSegment): LineSegment {
  const persisted: LineSegment = { ...segment };
  if (segment._preparedBoundaryOriginal !== undefined) {
    if (segment._preparedBoundaryOriginal === null) {
      Reflect.deleteProperty(persisted, 'boundary');
    } else {
      persisted.boundary = segment._preparedBoundaryOriginal.map((point) => ({
        ...point,
      }));
    }
  }
  Reflect.deleteProperty(persisted, '_id');
  Reflect.deleteProperty(persisted, '_deleted');
  Reflect.deleteProperty(persisted, '_originalBoundary');
  Reflect.deleteProperty(persisted, '_originalBbox');
  Reflect.deleteProperty(persisted, '_compressBoundaryOnSave');
  Reflect.deleteProperty(persisted, '_preparedBoundaryOriginal');
  return persisted;
}

function geometryShapeSignature(segment: EditableSegment): string {
  const persisted = withoutEditorFields(segment);
  return stableStringify({
    ...(persisted.geometryType
      ? { geometryType: persisted.geometryType }
      : {}),
    ...(persisted.baseline ? { baseline: persisted.baseline } : {}),
    bbox: persisted.bbox,
    ...(persisted.boundary ? { boundary: persisted.boundary } : {}),
    ...(persisted.words
      ? { wordBoxes: persisted.words.map((word) => word.bbox) }
      : {}),
  });
}

/**
 * Undo entries can survive an autosave, but provenance must describe the
 * transition from the latest persisted revision rather than the older local
 * snapshot. Reconcile restored shapes against that saved baseline so an undo
 * remains both usable and acceptable to the server's provenance validator.
 */
function reconcileRestoredProvenance(
  segments: EditableSegment[],
  savedSegments: EditableSegment[],
): EditableSegment[] {
  const savedById = new Map(
    savedSegments
      .filter((segment) => !segment._deleted)
      .map((segment) => [segment.id ?? segment._id, segment]),
  );

  return segments.map((segment) => {
    if (segment._deleted) return segment;
    const stableId = segment.id ?? segment._id;
    const saved = savedById.get(stableId);
    if (!saved) {
      return {
        ...segment,
        _preparedBoundaryOriginal: undefined,
        geometryProvenance: humanCreatedGeometryProvenance(
          segment.boundary && segment.boundary.length >= 3
            ? 'create-polygon'
            : 'create-box',
        ),
      };
    }
    if (geometryShapeSignature(segment) === geometryShapeSignature(saved)) {
      return {
        ...segment,
        geometryProvenance: normalizeGeometryProvenance(saved, stableId),
      };
    }
    return stampGeometryChange(segment, 'reshape');
  });
}

/** Strip client-only fields and return clean LineSegments for persistence. */
export function toLineSegments(segments: EditableSegment[]): LineSegment[] {
  return segments
    .filter((s) => !s._deleted)
    .map((segment, index) => {
      const persisted = withoutEditorFields(segment);
      return normalizeSegmentForSave(
        {
          ...persisted,
          id: persisted.id ?? segment._id,
          // Array position is the review order. Never derive a new order from
          // horizontal/vertical geometry because that destroys provider order
          // on columns, curved writing, and vertical text.
          line: index + 1,
        },
        segment._preparedBoundaryOriginal === undefined
          && segment._compressBoundaryOnSave === true,
      );
    });
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

function normalizeSegmentForSave(
  segment: LineSegment,
  compressGeneratedBoundary: boolean,
): LineSegment {
  const boundary = (
    compressGeneratedBoundary
    && segment.boundary
    && segment.boundary.length >= 3
  )
    ? compressBoundaryForSave(segment.boundary)
    : undefined;
  const normalized = boundary
    ? {
      ...segment,
      boundary,
      bbox: bboxFromBoundary(boundary),
    }
    : segment;

  // BBox-native records intentionally have no baseline. `undefined` is
  // omitted from the JSON request body and protects against a stale client
  // accidentally persisting a synthetic compatibility baseline.
  if (normalized.geometryType === 'bbox') {
    return { ...normalized, baseline: undefined };
  }

  return normalized;
}

function transformBaseline(
  baseline: number[][] | undefined,
  source: [number, number, number, number],
  target: [number, number, number, number],
): number[][] | undefined {
  if (!baseline) return undefined;
  const sourceWidth = source[2] - source[0];
  const sourceHeight = source[3] - source[1];
  const targetWidth = target[2] - target[0];
  const targetHeight = target[3] - target[1];

  return baseline.map(([x, y]) => {
    const transformedX = sourceWidth === 0
      ? target[0] + (targetWidth / 2)
      : target[0] + (((x - source[0]) / sourceWidth) * targetWidth);
    const transformedY = sourceHeight === 0
      ? target[1] + (targetHeight / 2)
      : target[1] + (((y - source[1]) / sourceHeight) * targetHeight);
    return [transformedX, transformedY];
  });
}

function transformPointBetweenBboxes(
  point: { x: number; y: number },
  source: [number, number, number, number],
  target: [number, number, number, number],
): { x: number; y: number } {
  const sourceWidth = source[2] - source[0];
  const sourceHeight = source[3] - source[1];
  const targetWidth = target[2] - target[0];
  const targetHeight = target[3] - target[1];

  return {
    x: sourceWidth === 0
      ? target[0] + (targetWidth / 2)
      : target[0] + (((point.x - source[0]) / sourceWidth) * targetWidth),
    y: sourceHeight === 0
      ? target[1] + (targetHeight / 2)
      : target[1] + (((point.y - source[1]) / sourceHeight) * targetHeight),
  };
}

function transformWordBoxes(
  words: LineSegmentWord[] | undefined,
  transformPoint: (point: { x: number; y: number }) => { x: number; y: number },
): LineSegmentWord[] | undefined {
  return words?.map((word) => {
    const [xMin, yMin, xMax, yMax] = word.bbox;
    const corners = [
      transformPoint({ x: xMin, y: yMin }),
      transformPoint({ x: xMax, y: yMin }),
      transformPoint({ x: xMax, y: yMax }),
      transformPoint({ x: xMin, y: yMax }),
    ];
    return {
      ...word,
      bbox: bboxFromBoundary(corners),
    };
  });
}

/**
 * Builds the similarity transform represented by corresponding polygon
 * vertices. Rotation uses this so the baseline and word boxes follow the
 * boundary instead of being stranded in their old orientation.
 */
function boundaryTransform(
  source: { x: number; y: number }[],
  target: { x: number; y: number }[],
): ((point: { x: number; y: number }) => { x: number; y: number }) | null {
  if (source.length < 2 || source.length !== target.length) return null;

  let firstIndex = 0;
  let secondIndex = 1;
  let longestSquared = 0;
  for (let i = 0; i < source.length; i++) {
    for (let j = i + 1; j < source.length; j++) {
      const dx = source[j].x - source[i].x;
      const dy = source[j].y - source[i].y;
      const lengthSquared = (dx * dx) + (dy * dy);
      if (lengthSquared > longestSquared) {
        longestSquared = lengthSquared;
        firstIndex = i;
        secondIndex = j;
      }
    }
  }
  if (longestSquared === 0) return null;

  const sourceA = source[firstIndex];
  const sourceB = source[secondIndex];
  const targetA = target[firstIndex];
  const targetB = target[secondIndex];
  const sourceDx = sourceB.x - sourceA.x;
  const sourceDy = sourceB.y - sourceA.y;
  const targetDx = targetB.x - targetA.x;
  const targetDy = targetB.y - targetA.y;
  const targetLength = Math.hypot(targetDx, targetDy);
  const sourceLength = Math.sqrt(longestSquared);
  if (targetLength === 0 || sourceLength === 0) return null;

  const scale = targetLength / sourceLength;
  const cosine = ((sourceDx * targetDx) + (sourceDy * targetDy))
    / (sourceLength * targetLength);
  const sine = ((sourceDx * targetDy) - (sourceDy * targetDx))
    / (sourceLength * targetLength);

  return (point) => {
    const relativeX = point.x - sourceA.x;
    const relativeY = point.y - sourceA.y;
    return {
      x: targetA.x + scale * ((relativeX * cosine) - (relativeY * sine)),
      y: targetA.y + scale * ((relativeX * sine) + (relativeY * cosine)),
    };
  };
}

function translateBaseline(
  baseline: number[][] | undefined,
  dx: number,
  dy: number,
): number[][] | undefined {
  return baseline?.map(([x, y]) => [x + dx, y + dy]);
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
  /** Create a bbox-native segment from a freehand boundary trail. */
  addFreehandSegment: (points: { x: number; y: number }[]) => void;
  /** Duplicate a segment, offset slightly. */
  duplicateSegment: (id: string) => void;
  toggleExcluded: (id: string) => void;
  classifySegment: (id: string, segmentClass: SegmentClass) => void;
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
  /** Mark state as saved without clearing in-session undo history. */
  markSaved: (savedSegments?: LineSegment[]) => void;
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
  /** Apply a whole-boundary transform to the boundary, baseline, and word boxes. */
  transformBoundary: (segId: string, newBoundary: { x: number; y: number }[]) => void;
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

interface SegmentEditorImageBounds {
  width: number;
  height: number;
}

function boundedDuplicateOffset(
  minimum: number,
  maximum: number,
  imageMaximum: number | undefined,
): number {
  if (!imageMaximum || imageMaximum <= 0) return 15;
  const minimumDelta = -minimum;
  const maximumDelta = imageMaximum - maximum;
  if (minimumDelta > maximumDelta) return 0;
  if (maximumDelta >= 15) return 15;
  if (minimumDelta <= -15) return -15;
  if (maximumDelta > 0) return maximumDelta;
  if (minimumDelta < 0) return minimumDelta;
  return 0;
}

export function useSegmentEditor(
  sourceSegments: LineSegment[],
  imageBounds?: SegmentEditorImageBounds,
): UseSegmentEditorReturn {
  const [segmentEditMode, setSegmentEditMode] = useState(false);
  const [editedSegments, setEditedSegments] = useState<EditableSegment[]>(() =>
    toEditable(sourceSegments),
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const editedSegmentsRef = useRef(editedSegments);
  useEffect(() => {
    editedSegmentsRef.current = editedSegments;
  }, [editedSegments]);
  const savedSignatureRef = useRef(persistedSignature(editedSegments));
  const savedSegmentsRef = useRef(cloneSegments(editedSegments));
  const savedGenerationRef = useRef(0);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const bumpHistoryVersion = useCallback(() => {
    setHistoryAvailability({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const pushUndo = useCallback((segments: EditableSegment[], selectedId: string | null) => {
    undoStackRef.current.push({
      segments: cloneSegments(segments),
      selectedId,
      savedGeneration: savedGenerationRef.current,
    });
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
          const newBaseline = transformBaseline(seg.baseline, seg.bbox, newBbox);
          const newWords = transformWordBoxes(
            seg.words,
            (point) => transformPointBetweenBboxes(point, seg.bbox, newBbox),
          );

          // Derive boundary from originals — polygon shape is preserved,
          // extensions get rectangular tabs, shrink-then-extend restores the original.
          const newBoundary =
            seg._originalBoundary && seg._originalBoundary.length > 2 && seg._originalBbox
              ? buildExtendedBoundary(seg._originalBoundary, seg._originalBbox, newBbox)
              : seg.boundary;

          return stampGeometryChange(
            {
              ...seg,
              bbox: newBbox,
              boundary: newBoundary,
              baseline: newBaseline,
              words: newWords,
            },
            'resize',
          );
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
        return prev.map((seg) => (
          seg._id === id
            ? stampGeometryChange({ ...seg, _deleted: true }, 'delete')
            : seg
        ));
      });
      setSelectedSegmentId(null);
      setIsDirty(true);
    },
    [pushUndo, selectedSegmentId],
  );

  const addSegment = useCallback(
    (bbox: [number, number, number, number]) => {
      const id = makeId();
      const newSeg: EditableSegment = {
        id,
        _id: id,
        line: -1, // user-created, no original line number
        geometryType: 'bbox',
        bbox,
        bboxSource: 'human-drawn-bbox',
        geometryProvenance: humanCreatedGeometryProvenance('create-box'),
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
      const id = makeId();
      const newSeg: EditableSegment = {
        id,
        _id: id,
        line: -1,
        geometryType: 'bbox',
        bbox,
        bboxSource: 'human-drawn-polygon',
        geometryProvenance: humanCreatedGeometryProvenance('create-polygon'),
        boundary: smoothed,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
        _originalBoundary: smoothed.map((p) => ({ ...p })),
        _originalBbox: [...bbox] as [number, number, number, number],
        _compressBoundaryOnSave: true,
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
      const id = makeId();
      const newSeg: EditableSegment = {
        id,
        _id: id,
        line: -1,
        geometryType: 'bbox',
        bbox,
        bboxSource: 'human-drawn-freehand-boundary',
        geometryProvenance: humanCreatedGeometryProvenance('create-freehand'),
        boundary: smoothed,
        ocrText: '',
        words: [],
        excluded: false,
        _deleted: false,
        _originalBoundary: smoothed.map((p) => ({ ...p })),
        _originalBbox: [...bbox] as [number, number, number, number],
        _compressBoundaryOnSave: true,
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
        const geometryPoints = [
          ...(seg.boundary ?? []),
          ...(seg.baseline ?? []).map(([x, y]) => ({ x, y })),
        ];
        const minimumX = Math.min(seg.bbox[0], ...geometryPoints.map((point) => point.x));
        const maximumX = Math.max(seg.bbox[2], ...geometryPoints.map((point) => point.x));
        const minimumY = Math.min(seg.bbox[1], ...geometryPoints.map((point) => point.y));
        const maximumY = Math.max(seg.bbox[3], ...geometryPoints.map((point) => point.y));
        const dx = boundedDuplicateOffset(
          minimumX,
          maximumX,
          imageBounds?.width,
        );
        const dy = boundedDuplicateOffset(
          minimumY,
          maximumY,
          imageBounds?.height,
        );
        const newBbox: [number, number, number, number] = [
          seg.bbox[0] + dx,
          seg.bbox[1] + dy,
          seg.bbox[2] + dx,
          seg.bbox[3] + dy,
        ];
        const newBoundary = seg.boundary
          ? seg.boundary.map((p) => ({ x: p.x + dx, y: p.y + dy }))
          : undefined;
        const newId = makeId();
        const newSeg: EditableSegment = {
          ...seg,
          id: newId,
          _id: newId,
          line: -1,
          bbox: newBbox,
          boundary: newBoundary,
          baseline: translateBaseline(seg.baseline, dx, dy),
          ocrText: '',
          words: [],
          excluded: false,
          segmentClass: 'body',
          isMapped: false,
          mappedText: undefined,
          providerId: undefined,
          providerOrdinal: undefined,
          providerTextDirection: undefined,
          regionIds: [],
          group: undefined,
          bboxSource: 'human-duplicate',
          geometryProvenance: humanCreatedGeometryProvenance(
            'duplicate',
            [
              ...(seg.geometryProvenance?.parentSegmentIds ?? []),
              seg.id ?? seg._id,
            ],
          ),
          _originalBbox: [...newBbox] as [number, number, number, number],
          _originalBoundary: newBoundary ? newBoundary.map((p) => ({ ...p })) : undefined,
        };
        setSelectedSegmentId(newSeg._id);
        return [...prev, newSeg];
      });
      setIsDirty(true);
    },
    [imageBounds?.height, imageBounds?.width, pushUndo, selectedSegmentId],
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

  const moveVertex = useCallback(
    (segId: string, vertexIndex: number, pos: { x: number; y: number }) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== segId || !seg.boundary) return seg;
          const newBoundary = seg.boundary.map((p, i) =>
            i === vertexIndex ? { x: pos.x, y: pos.y } : { ...p },
          );
          const newBbox = bboxFromBoundary(newBoundary);
          return stampGeometryChange(
            {
              ...seg,
              boundary: newBoundary,
              bbox: newBbox,
              words: undefined,
              _originalBoundary: newBoundary.map((p) => ({ ...p })),
              _originalBbox: [...newBbox] as [number, number, number, number],
            },
            'move-vertex',
          );
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
          return stampGeometryChange(
            {
              ...seg,
              boundary: newBoundary,
              bbox: newBbox,
              words: undefined,
              _originalBoundary: newBoundary.map((p) => ({ ...p })),
              _originalBbox: [...newBbox] as [number, number, number, number],
            },
            'add-vertex',
          );
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
          return stampGeometryChange(
            {
              ...seg,
              boundary: newBoundary,
              bbox: newBbox,
              words: undefined,
              _originalBoundary: newBoundary.map((p) => ({ ...p })),
              _originalBbox: [...newBbox] as [number, number, number, number],
            },
            'delete-vertex',
          );
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
        if (seg._preparedBoundaryOriginal !== undefined) return prev;
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
            _compressBoundaryOnSave: true,
            _preparedBoundaryOriginal: s.boundary
              ? s.boundary.map((point) => ({ ...point }))
              : null,
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
          return stampGeometryChange(
            {
              ...seg,
              boundary: newBoundary,
              bbox: newBbox,
              // Reshaping is not a rigid transform, so provider word positions
              // would be misleading after this edit.
              words: undefined,
              _originalBoundary: newBoundary.map((p) => ({ ...p })),
              _originalBbox: [...newBbox] as [number, number, number, number],
            },
            'reshape',
          );
        }),
      );
      setIsDirty(true);
    },
    [],
  );

  const transformBoundary = useCallback(
    (segId: string, newBoundary: { x: number; y: number }[]) => {
      setEditedSegments((prev) =>
        prev.map((seg) => {
          if (seg._id !== segId || !seg.boundary) return seg;
          const transformPoint = boundaryTransform(seg.boundary, newBoundary);
          if (!transformPoint) return seg;
          const newBbox = bboxFromBoundary(newBoundary);
          return stampGeometryChange(
            {
              ...seg,
              boundary: newBoundary,
              bbox: newBbox,
              baseline: seg.baseline?.map(([x, y]) => {
                const next = transformPoint({ x, y });
                return [next.x, next.y];
              }),
              words: transformWordBoxes(seg.words, transformPoint),
              _originalBoundary: newBoundary.map((point) => ({ ...point })),
              _originalBbox: [...newBbox] as [number, number, number, number],
            },
            'rotate',
          );
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
        didExtend = true;
        return prev.map((s) =>
          s._id === segId
            ? stampGeometryChange(
                {
                  ...s,
                  boundary: smoothed,
                  bbox: newBbox,
                  _originalBoundary: smoothed.map((p) => ({ ...p })),
                  _originalBbox: [...newBbox] as [number, number, number, number],
                  _compressBoundaryOnSave: true,
                  words: undefined,
                },
                'extend',
              )
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
          return prev.map((s) => (
            s._id === segId
              ? stampGeometryChange({ ...s, _deleted: true }, 'subtract')
              : s
          ));
        }
        const smoothed = subdivideBoundary(result, 10);
        const newBbox = bboxFromBoundary(smoothed);
        didChange = true;
        return prev.map((s) =>
          s._id === segId
            ? stampGeometryChange(
                {
                  ...s,
                  boundary: smoothed,
                  bbox: newBbox,
                  _originalBoundary: smoothed.map((p) => ({ ...p })),
                  _originalBbox: [...newBbox] as [number, number, number, number],
                  _compressBoundaryOnSave: true,
                  words: undefined,
                },
                'subtract',
              )
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
          const newBoundary = origBoundary
            ? origBoundary.map((p) => ({ x: p.x + dx, y: p.y + dy }))
            : seg.boundary;
          const baselineDx = newBbox[0] - seg.bbox[0];
          const baselineDy = newBbox[1] - seg.bbox[1];
          return stampGeometryChange(
            {
              ...seg,
              bbox: newBbox,
              boundary: newBoundary,
              baseline: translateBaseline(seg.baseline, baselineDx, baselineDy),
              words: transformWordBoxes(
                seg.words,
                (point) => ({ x: point.x + baselineDx, y: point.y + baselineDy }),
              ),
              _originalBbox: [...newBbox] as [number, number, number, number],
              _originalBoundary: newBoundary ? newBoundary.map((p) => ({ ...p })) : undefined,
            },
            'move',
          );
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
    const restoredSegments = entry.savedGeneration === savedGenerationRef.current
      ? cloneSegments(entry.segments)
      : reconcileRestoredProvenance(
        cloneSegments(entry.segments),
        savedSegmentsRef.current,
      );
    // Push current state onto redo stack before restoring
    redoStackRef.current.push({
      segments: cloneSegments(editedSegments),
      selectedId: selectedSegmentId,
      savedGeneration: savedGenerationRef.current,
    });
    setEditedSegments(restoredSegments);
    setSelectedSegmentId(
      entry.selectedId
      && restoredSegments.some((segment) => (
        segment._id === entry.selectedId && !segment._deleted
      ))
        ? entry.selectedId
        : null,
    );
    setIsDirty(
      persistedSignature(restoredSegments) !== savedSignatureRef.current,
    );
    bumpHistoryVersion();
  }, [editedSegments, selectedSegmentId, bumpHistoryVersion]);

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    const restoredSegments = entry.savedGeneration === savedGenerationRef.current
      ? cloneSegments(entry.segments)
      : reconcileRestoredProvenance(
        cloneSegments(entry.segments),
        savedSegmentsRef.current,
      );
    // Push current state onto undo stack before restoring
    undoStackRef.current.push({
      segments: cloneSegments(editedSegments),
      selectedId: selectedSegmentId,
      savedGeneration: savedGenerationRef.current,
    });
    setEditedSegments(restoredSegments);
    setSelectedSegmentId(
      entry.selectedId
      && restoredSegments.some((segment) => (
        segment._id === entry.selectedId && !segment._deleted
      ))
        ? entry.selectedId
        : null,
    );
    setIsDirty(
      persistedSignature(restoredSegments) !== savedSignatureRef.current,
    );
    bumpHistoryVersion();
  }, [editedSegments, selectedSegmentId, bumpHistoryVersion]);

  const { canUndo, canRedo } = historyAvailability;

  const resetFromSource = useCallback((segments: LineSegment[], options?: ResetFromSourceOptions) => {
    const nextSegments = toEditable(segments);
    setEditedSegments(nextSegments);
    savedSignatureRef.current = persistedSignature(nextSegments);
    savedSegmentsRef.current = cloneSegments(nextSegments);
    savedGenerationRef.current += 1;
    if (options?.preserveSelection && selectedSegmentId) {
      const previousSelected = editedSegments.find((segment) => segment._id === selectedSegmentId);
      setSelectedSegmentId(findClosestSegmentId(previousSelected, nextSegments));
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

  const markSaved = useCallback((savedSegments?: LineSegment[]) => {
    const persisted = savedSegments ?? toLineSegments(editedSegmentsRef.current);
    savedSignatureRef.current = lineSegmentsSignature(persisted);
    savedSegmentsRef.current = toEditable(persisted);
    savedGenerationRef.current += 1;
    setIsDirty(
      persistedSignature(editedSegmentsRef.current)
      !== savedSignatureRef.current,
    );
  }, []);

  const clearSessionHistory = useCallback(() => {
    savedSignatureRef.current = persistedSignature(editedSegmentsRef.current);
    savedSegmentsRef.current = cloneSegments(editedSegmentsRef.current);
    savedGenerationRef.current += 1;
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
    isDirty,
    snapshotForUndo,
    undo,
    redo,
    canUndo,
    canRedo,
    resetFromSource,
    getSegmentsForSave,
    markSaved,
    clearSessionHistory,
    moveVertex,
    addVertex,
    deleteVertex,
    ensureBoundary,
    setBoundary,
    transformBoundary,
    moveSegment,
    extendSelectedWithShape,
    subtractShapeFromSelected,
  };
}
