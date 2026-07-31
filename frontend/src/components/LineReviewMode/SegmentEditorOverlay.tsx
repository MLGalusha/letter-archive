import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditableSegment } from '../../hooks/useSegmentEditor';
import VertexHandles from './VertexHandles';
import RotateHandle from './RotateHandle';
import SegmentHandle from './SegmentHandle';
import { clientPointToSvg } from './svgCoordinates';

interface SegmentEditorOverlayProps {
  segments: EditableSegment[];
  selectedSegmentId: string | null;
  scaleFactor: number;
  imageWidth: number;
  imageHeight: number;
  onSelect: (id: string | null) => void;
  onResize?: (id: string, newBbox: [number, number, number, number]) => void;
  onDelete: (id: string) => void;
  onToggleExcluded: (id: string) => void;
  onAddSegment: (bbox: [number, number, number, number]) => void;
  onAddPolygonSegment?: (boundary: { x: number; y: number }[]) => void;
  onAddFreehandSegment?: (points: { x: number; y: number }[]) => void;
  /** Extend the selected segment by unioning a drawn shape into it. Returns true if applied. */
  onExtendSelected?: (segId: string, shape: { x: number; y: number }[]) => boolean;
  /** Subtract a drawn shape from the selected segment. Returns true if applied. */
  onSubtractFromSelected?: (segId: string, shape: { x: number; y: number }[]) => boolean;
  /** Active draw tool: select (default), box, polygon, or draw (freehand). */
  drawTool?: 'select' | 'box' | 'polygon' | 'draw';
  /** Called once when a resize/vertex drag starts — used to snapshot undo state. */
  onResizeStart?: () => void;
  /** When true, show vertex handles instead of bbox resize handles on selected segment. */
  reshapeMode?: boolean;
  /** When true, drawn shapes subtract from the selected segment instead of extending. */
  subtractMode?: boolean;
  /** When true, show rotation handles on selected segment. */
  rotateMode?: boolean;
  /** Set entire boundary at once (smooth deformation / rotation). */
  onSetBoundary?: (segId: string, newBoundary: { x: number; y: number }[]) => void;
  /** Apply a rigid whole-geometry transform (rotation plus any bounds correction). */
  onTransformBoundary?: (segId: string, newBoundary: { x: number; y: number }[]) => void;
  /** Right-click on segment — (clientX, clientY, segId). */
  onSegmentContextMenu?: (x: number, y: number, segId: string) => void;
  /** When true, selected segment can be grabbed and moved. */
  movable?: boolean;
  /** Move segment by delta from original positions. */
  onMoveSegment?: (
    segId: string,
    origBbox: [number, number, number, number],
    origBoundary: { x: number; y: number }[] | undefined,
    dx: number,
    dy: number,
  ) => void;
  /** Blocks every geometry interaction while this revision is read-only. */
  readOnly?: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampBoundaryPoints(
  boundary: { x: number; y: number }[],
  maxX: number,
  maxY: number,
): { x: number; y: number }[] {
  return boundary.map((point) => ({
    x: clamp(point.x, 0, maxX),
    y: clamp(point.y, 0, maxY),
  }));
}

function fitBoundaryWithinImage(
  boundary: { x: number; y: number }[],
  maxX: number,
  maxY: number,
): { x: number; y: number }[] {
  if (boundary.length === 0) return boundary;
  const xValues = boundary.map((point) => point.x);
  const yValues = boundary.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxBoundaryX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxBoundaryY = Math.max(...yValues);

  // A segment larger than the image cannot be corrected by translation alone.
  if ((maxBoundaryX - minX) > maxX || (maxBoundaryY - minY) > maxY) {
    return clampBoundaryPoints(boundary, maxX, maxY);
  }

  const dx = minX < 0 ? -minX : maxBoundaryX > maxX ? maxX - maxBoundaryX : 0;
  const dy = minY < 0 ? -minY : maxBoundaryY > maxY ? maxY - maxBoundaryY : 0;
  return boundary.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function clampBboxWithinImage(
  bbox: [number, number, number, number],
  maxX: number,
  maxY: number,
): [number, number, number, number] {
  let xMin = clamp(bbox[0], 0, maxX);
  let yMin = clamp(bbox[1], 0, maxY);
  let xMax = clamp(bbox[2], 0, maxX);
  let yMax = clamp(bbox[3], 0, maxY);
  if (xMax < xMin) [xMin, xMax] = [xMax, xMin];
  if (yMax < yMin) [yMin, yMax] = [yMax, yMin];
  if (xMax === xMin && maxX > 0) {
    if (xMax < maxX) xMax = Math.min(maxX, xMin + 1);
    else xMin = Math.max(0, xMax - 1);
  }
  if (yMax === yMin && maxY > 0) {
    if (yMax < maxY) yMax = Math.min(maxY, yMin + 1);
    else yMin = Math.max(0, yMax - 1);
  }
  return [xMin, yMin, xMax, yMax];
}

export default function SegmentEditorOverlay({
  segments,
  selectedSegmentId,
  scaleFactor,
  imageWidth,
  imageHeight,
  onSelect,
  onResize,
  onDelete,
  onToggleExcluded,
  onAddSegment,
  onAddPolygonSegment,
  onAddFreehandSegment,
  onExtendSelected,
  onSubtractFromSelected,
  drawTool = 'select',
  onResizeStart,
  reshapeMode = false,
  subtractMode = false,
  rotateMode = false,
  onSetBoundary,
  onTransformBoundary,
  onSegmentContextMenu,
  movable = false,
  onMoveSegment,
  readOnly = false,
}: SegmentEditorOverlayProps) {
  // Draw-new-segment state (box mode)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  // Polygon draw state (click-to-place vertices)
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [polyPreview, setPolyPreview] = useState<{ x: number; y: number } | null>(null);
  // Freehand draw state
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([]);
  const freehandDrawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const sourceWidth = imageWidth / scaleFactor;
  const sourceHeight = imageHeight / scaleFactor;

  // Snap guides shown during move
  const [snapGuides, setSnapGuides] = useState<{ axis: 'h' | 'v'; pos: number }[]>([]);

  // Track Alt key state for subtract mode
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /** Route a finalized draw shape to extend/subtract (if selected) or new-segment creation. */
  const finalizeShape = useCallback(
    (
      shape: { x: number; y: number }[],
      kind: 'box' | 'polygon' | 'freehand',
      useAlt: boolean,
      fallback: () => void,
    ) => {
      if (readOnly) return;
      if (selectedSegmentId && (onExtendSelected || onSubtractFromSelected)) {
        const subtract = subtractMode || useAlt;
        if (subtract) {
          if (onSubtractFromSelected?.(selectedSegmentId, shape)) return;
        } else {
          if (onExtendSelected?.(selectedSegmentId, shape)) return;
        }
      }
      // No selection or no overlap: create new segment via kind-appropriate path
      void kind;
      fallback();
    },
    [
      selectedSegmentId,
      onExtendSelected,
      onSubtractFromSelected,
      subtractMode,
      readOnly,
    ],
  );

  // Pre-compute edges of all segments for snapping
  const segmentEdges = useMemo(() => {
    const edges: { segId: string; left: number; right: number; top: number; bottom: number }[] = [];
    for (const seg of segments) {
      if (seg._deleted) continue;
      edges.push({
        segId: seg._id,
        left: seg.bbox[0],
        top: seg.bbox[1],
        right: seg.bbox[2],
        bottom: seg.bbox[3],
      });
    }
    return edges;
  }, [segments]);

  const getSvgPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    return clientPointToSvg(svg, e.clientX, e.clientY);
  }, []);

  // Move-drag state
  const moveDragRef = useRef<{
    segId: string;
    startX: number;
    startY: number;
    origBbox: [number, number, number, number];
    origBoundary: { x: number; y: number }[] | undefined;
    moved: boolean;
  } | null>(null);
  const cancelActiveInteraction = useCallback(() => {
    moveDragRef.current = null;
    freehandDrawing.current = false;
    setDrawStart(null);
    setDrawEnd(null);
    setPolyPoints([]);
    setPolyPreview(null);
    setFreehandPoints([]);
    setSnapGuides([]);
  }, []);

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      // In select mode, clicking on a segment is handled by segment click handlers — skip draw logic
      // In draw modes, clicks pass through to drawing even on segments
      if (drawTool === 'select' && (e.target as Element).closest('.segment-editor-seg, .segment-handles, .vertex-handles')) return;

      const pt = getSvgPoint(e);

      if (drawTool === 'select') {
        onSelect(null);
        return;
      }

      if (drawTool === 'polygon') {
        // Polygon: click to add vertex, close if near first point
        const imgPt = {
          x: clamp(pt.x / scaleFactor, 0, sourceWidth),
          y: clamp(pt.y / scaleFactor, 0, sourceHeight),
        };
        if (polyPoints.length >= 3) {
          const first = polyPoints[0];
          const dist = Math.hypot(pt.x - first.x * scaleFactor, pt.y - first.y * scaleFactor);
          if (dist < 12) {
            // Close polygon — route through extend/subtract if selected
            const shape = polyPoints.map((p) => ({ ...p }));
            finalizeShape(shape, 'polygon', e.altKey, () => onAddPolygonSegment?.(shape));
            setPolyPoints([]);
            setPolyPreview(null);
            return;
          }
        }
        setPolyPoints((prev) => [...prev, imgPt]);
        return;
      }

      if (drawTool === 'draw') {
        const imgPt = {
          x: clamp(pt.x / scaleFactor, 0, sourceWidth),
          y: clamp(pt.y / scaleFactor, 0, sourceHeight),
        };
        freehandDrawing.current = true;
        setFreehandPoints([imgPt]);
        (e.target as Element).setPointerCapture(e.pointerId);
        return;
      }

      // Box mode (default)
      setDrawStart(pt);
      setDrawEnd(pt);
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [
      getSvgPoint,
      onSelect,
      drawTool,
      polyPoints,
      scaleFactor,
      sourceWidth,
      sourceHeight,
      onAddPolygonSegment,
      finalizeShape,
      readOnly,
    ],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      // Move drag takes priority
      if (moveDragRef.current) {
        const pt = getSvgPoint(e);
        const dx = pt.x / scaleFactor - moveDragRef.current.startX;
        const dy = pt.y / scaleFactor - moveDragRef.current.startY;
        if (!moveDragRef.current.moved && Math.hypot(dx, dy) < 3) return;
        moveDragRef.current.moved = true;
        // Snap guide detection
        const ob = moveDragRef.current.origBbox;
        const movingEdges = {
          left: ob[0] + dx, top: ob[1] + dy,
          right: ob[2] + dx, bottom: ob[3] + dy,
        };
        const thresh = 5 / scaleFactor;
        const guides: { axis: 'h' | 'v'; pos: number }[] = [];
        let snapDx = dx;
        let snapDy = dy;
        for (const edge of segmentEdges) {
          if (edge.segId === moveDragRef.current.segId) continue;
          // Vertical guides (x alignment)
          for (const mx of [movingEdges.left, movingEdges.right]) {
            for (const ox of [edge.left, edge.right]) {
              if (Math.abs(mx - ox) < thresh) {
                snapDx += ox - mx;
                guides.push({ axis: 'v', pos: ox });
              }
            }
          }
          // Horizontal guides (y alignment)
          for (const my of [movingEdges.top, movingEdges.bottom]) {
            for (const oy of [edge.top, edge.bottom]) {
              if (Math.abs(my - oy) < thresh) {
                snapDy += oy - my;
                guides.push({ axis: 'h', pos: oy });
              }
            }
          }
        }
        const sourceWidth = imageWidth / scaleFactor;
        const sourceHeight = imageHeight / scaleFactor;
        snapDx = clamp(snapDx, -ob[0], sourceWidth - ob[2]);
        snapDy = clamp(snapDy, -ob[1], sourceHeight - ob[3]);
        setSnapGuides(guides);
        onMoveSegment?.(
          moveDragRef.current.segId,
          moveDragRef.current.origBbox,
          moveDragRef.current.origBoundary,
          snapDx,
          snapDy,
        );
        return;
      }

      const pt = getSvgPoint(e);

      // Polygon preview
      if (drawTool === 'polygon' && polyPoints.length > 0) {
        setPolyPreview({
          x: clamp(pt.x / scaleFactor, 0, sourceWidth),
          y: clamp(pt.y / scaleFactor, 0, sourceHeight),
        });
        return;
      }

      // Freehand draw: accumulate points
      if (drawTool === 'draw' && freehandDrawing.current) {
        setFreehandPoints((prev) => [...prev, {
          x: clamp(pt.x / scaleFactor, 0, sourceWidth),
          y: clamp(pt.y / scaleFactor, 0, sourceHeight),
        }]);
        return;
      }

      if (!drawStart) return;
      setDrawEnd(pt);
    },
    [
      drawStart,
      getSvgPoint,
      scaleFactor,
      onMoveSegment,
      drawTool,
      polyPoints.length,
      segmentEdges,
      imageWidth,
      imageHeight,
      sourceWidth,
      sourceHeight,
      readOnly,
    ],
  );

  const handleSvgPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (readOnly) {
        cancelActiveInteraction();
        return;
      }
      if (moveDragRef.current) {
        moveDragRef.current = null;
        setSnapGuides([]);
        return;
      }

      // Freehand mode: finish on pointer up
      if (drawTool === 'draw' && freehandDrawing.current) {
        freehandDrawing.current = false;
        if (freehandPoints.length >= 5) {
          // Use freehand points directly as the shape polygon for extend/subtract
          finalizeShape(freehandPoints, 'freehand', _e.altKey, () =>
            onAddFreehandSegment?.(freehandPoints),
          );
        }
        setFreehandPoints([]);
        return;
      }

      // Polygon mode: handled by pointerDown clicks, not here
      if (drawTool === 'polygon') return;

      // Box mode
      if (!drawStart || !drawEnd) {
        setDrawStart(null);
        setDrawEnd(null);
        return;
      }

      const [x1, y1, x2, y2] = clampBboxWithinImage(
        [
          Math.min(drawStart.x, drawEnd.x) / scaleFactor,
          Math.min(drawStart.y, drawEnd.y) / scaleFactor,
          Math.max(drawStart.x, drawEnd.x) / scaleFactor,
          Math.max(drawStart.y, drawEnd.y) / scaleFactor,
        ],
        sourceWidth,
        sourceHeight,
      );

      if ((x2 - x1) * scaleFactor > 15 && (y2 - y1) * scaleFactor > 15) {
        const shape: { x: number; y: number }[] = [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ];
        finalizeShape(shape, 'box', _e.altKey, () => onAddSegment([x1, y1, x2, y2]));
      }

      setDrawStart(null);
      setDrawEnd(null);
    },
    [
      drawStart,
      drawEnd,
      scaleFactor,
      sourceWidth,
      sourceHeight,
      onAddSegment,
      drawTool,
      freehandPoints,
      onAddFreehandSegment,
      finalizeShape,
      readOnly,
      cancelActiveInteraction,
    ],
  );

  const handleSegmentClick = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (readOnly) return;
      // In draw modes, don't intercept — let clicks pass through to draw handlers
      if (drawTool !== 'select') return;
      e.stopPropagation();
      if (movable && id === selectedSegmentId) {
        // Start move drag on already-selected segment
        const pt = getSvgPoint(e);
        const seg = segments.find((s) => s._id === id);
        if (seg) {
          (e.target as Element).setPointerCapture(e.pointerId);
          moveDragRef.current = {
            segId: id,
            startX: pt.x / scaleFactor,
            startY: pt.y / scaleFactor,
            origBbox: [...seg.bbox] as [number, number, number, number],
            origBoundary: seg.boundary ? seg.boundary.map((p) => ({ ...p })) : undefined,
            moved: false,
          };
          onResizeStart?.(); // snapshot undo
        }
        return;
      }
      onSelect(id);
    },
    [
      onSelect,
      movable,
      selectedSegmentId,
      segments,
      getSvgPoint,
      scaleFactor,
      onResizeStart,
      drawTool,
      readOnly,
    ],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (readOnly) return;
      e.stopPropagation();
      onToggleExcluded(id);
    },
    [onToggleExcluded, readOnly],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (readOnly) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Escape') {
        // Cancel in-progress polygon or line draw
        if (polyPoints.length > 0) { setPolyPoints([]); setPolyPreview(null); }
        if (freehandDrawing.current) { freehandDrawing.current = false; setFreehandPoints([]); }
        return;
      }
      if (!selectedSegmentId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(selectedSegmentId);
      }
    },
    [selectedSegmentId, onDelete, polyPoints.length, readOnly],
  );

  // Attach keyboard listener for delete key
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Rubber-band rectangle
  const rubberBand = drawStart && drawEnd ? {
    x: Math.min(drawStart.x, drawEnd.x),
    y: Math.min(drawStart.y, drawEnd.y),
    width: Math.abs(drawEnd.x - drawStart.x),
    height: Math.abs(drawEnd.y - drawStart.y),
  } : null;
  const selectedSegment = selectedSegmentId
    ? segments.find((segment) => segment._id === selectedSegmentId)
    : undefined;
  const inSelectMode = drawTool === 'select';

  return (
    <svg
      ref={svgRef}
      className="segment-editor-svg"
      width={imageWidth}
      height={imageHeight}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 15,
        cursor: drawTool === 'select' ? 'default'
          : drawTool === 'polygon' ? 'cell'
          : drawTool === 'draw' ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M3 21l1.5-4.5L17.3 3.7a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L7.5 19.5z' fill='none' stroke='%23333' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M14.5 6.5l3 3' stroke='%23333' stroke-width='1.5'/%3E%3C/svg%3E") 2 22, crosshair`
          : 'crosshair',
        pointerEvents: readOnly ? 'none' : undefined,
      }}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={(e) => {
        if (readOnly) return;
        // Double-click closes polygon if enough points
        if (drawTool === 'polygon' && polyPoints.length >= 3) {
          e.stopPropagation();
          const shape = polyPoints.map((p) => ({ ...p }));
          finalizeShape(shape, 'polygon', e.altKey, () => onAddPolygonSegment?.(shape));
          setPolyPoints([]);
          setPolyPreview(null);
        }
      }}
    >
      {segments.map((seg) => {
        const isSelected = seg._id === selectedSegmentId;
        const isExcluded = seg.excluded;
        const segClass = seg.segmentClass;
        const classModifier = segClass && segClass !== 'body' ? ` seg-${segClass}` : '';
        const [sx1, sy1, sx2, sy2] = [
          seg.bbox[0] * scaleFactor,
          seg.bbox[1] * scaleFactor,
          seg.bbox[2] * scaleFactor,
          seg.bbox[3] * scaleFactor,
        ];

        const selectableClass = inSelectMode ? ' selectable' : '';

        return (
          <g key={seg._id} className="segment-editor-seg">
            {/* Segment boundary — polygon or bbox rect */}
            {seg.boundary && seg.boundary.length > 2 ? (
              <polygon
                points={seg.boundary
                  .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                  .join(' ')}
                className={`segment-editor-poly${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${selectableClass}`}
                style={{ pointerEvents: 'all', cursor: (movable && isSelected && inSelectMode) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!readOnly) {
                    onSegmentContextMenu?.(e.clientX, e.clientY, seg._id);
                  }
                }}
              />
            ) : (
              <rect
                x={sx1}
                y={sy1}
                width={sx2 - sx1}
                height={sy2 - sy1}
                className={`segment-editor-rect${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${selectableClass}`}
                style={{ pointerEvents: 'all', cursor: (movable && isSelected && inSelectMode) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!readOnly) {
                    onSegmentContextMenu?.(e.clientX, e.clientY, seg._id);
                  }
                }}
              />
            )}

            {/* Segment class label (non-body only) */}
            {segClass && segClass !== 'body' && (
              <text
                x={sx1 + 3}
                y={sy1 + 11}
                className={`segment-label seg-label-${segClass}`}
                style={{ pointerEvents: 'none' }}
              >
                {segClass}
              </text>
            )}

          </g>
        );
      })}

      {/* Rubber-band draw rectangle (box mode) */}
      {drawTool === 'box' && rubberBand && rubberBand.width > 2 && rubberBand.height > 2 && (
        <rect
          x={rubberBand.x}
          y={rubberBand.y}
          width={rubberBand.width}
          height={rubberBand.height}
          className={`segment-editor-rubber-band${(altHeld || subtractMode) && selectedSegmentId ? ' subtract' : ''}`}
        />
      )}

      {/* Polygon draw preview */}
      {drawTool === 'polygon' && polyPoints.length > 0 && (() => {
        const allPts = polyPreview ? [...polyPoints, polyPreview] : polyPoints;
        const pointsStr = allPts.map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`).join(' ');
        const firstPt = polyPoints[0];
        const nearClose = polyPreview && polyPoints.length >= 3 &&
          Math.hypot(
            (polyPreview.x - firstPt.x) * scaleFactor,
            (polyPreview.y - firstPt.y) * scaleFactor,
          ) < 12;
        return (
          <g className="draw-polygon-preview">
            <polyline
              points={pointsStr}
              className="draw-polygon-line"
            />
            {polyPoints.length >= 3 && polyPreview && (
              <line
                x1={polyPreview.x * scaleFactor}
                y1={polyPreview.y * scaleFactor}
                x2={firstPt.x * scaleFactor}
                y2={firstPt.y * scaleFactor}
                className="draw-polygon-close-line"
              />
            )}
            {/* Vertex dots */}
            {polyPoints.map((p, i) => (
              <circle
                key={i}
                cx={p.x * scaleFactor}
                cy={p.y * scaleFactor}
                r={i === 0 && nearClose ? 7 : 4}
                className={`draw-polygon-vertex${i === 0 ? ' first' : ''}${i === 0 && nearClose ? ' snap' : ''}`}
              />
            ))}
          </g>
        );
      })()}

      {/* Freehand draw preview */}
      {drawTool === 'draw' && freehandPoints.length > 1 && (
        <polyline
          points={freehandPoints.map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`).join(' ')}
          className={`draw-freehand-line${(altHeld || subtractMode) && selectedSegmentId ? ' subtract' : ''}`}
        />
      )}

      {/* Snap alignment guides */}
      {snapGuides.map((g, i) =>
        g.axis === 'v' ? (
          <line
            key={`sg-${i}`}
            x1={g.pos * scaleFactor} y1={0}
            x2={g.pos * scaleFactor} y2={imageHeight}
            className="snap-guide-line"
          />
        ) : (
          <line
            key={`sg-${i}`}
            x1={0} y1={g.pos * scaleFactor}
            x2={imageWidth} y2={g.pos * scaleFactor}
            className="snap-guide-line"
          />
        ),
      )}

      {/* Keep selected-line controls in the final SVG layer so later polygons
          cannot cover the handles and steal pointer events. */}
      {selectedSegment && inSelectMode && !readOnly && (
        <g className="segment-editor-controls">
          {reshapeMode && selectedSegment.boundary && selectedSegment.boundary.length >= 3 && (
            <VertexHandles
              boundary={selectedSegment.boundary}
              scaleFactor={scaleFactor}
              onSetBoundary={(newBoundary) => onSetBoundary?.(
                selectedSegment._id,
                clampBoundaryPoints(newBoundary, sourceWidth, sourceHeight),
              )}
              onDragStart={() => onResizeStart?.()}
            />
          )}
          {rotateMode && selectedSegment.boundary && selectedSegment.boundary.length >= 3 && (
            <RotateHandle
              boundary={selectedSegment.boundary}
              bbox={selectedSegment.bbox}
              scaleFactor={scaleFactor}
              onSetBoundary={(newBoundary) => onTransformBoundary?.(
                selectedSegment._id,
                fitBoundaryWithinImage(newBoundary, sourceWidth, sourceHeight),
              )}
              onDragStart={() => onResizeStart?.()}
            />
          )}
          {movable && !reshapeMode && !rotateMode && onResize && (
            <SegmentHandle
              bbox={selectedSegment.bbox}
              scaleFactor={scaleFactor}
              onResize={(newBbox) => onResize(
                selectedSegment._id,
                clampBboxWithinImage(newBbox, sourceWidth, sourceHeight),
              )}
              onResizeStart={() => onResizeStart?.()}
            />
          )}
        </g>
      )}
    </svg>
  );
}
