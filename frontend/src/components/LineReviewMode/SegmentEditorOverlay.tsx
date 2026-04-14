import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditableSegment } from '../../hooks/useSegmentEditor';
import VertexHandles from './VertexHandles';
import RotateHandle from './RotateHandle';

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
  /** When true, segments are in mapping mode — special segments highlighted, body dimmed. */
  mappingMode?: boolean;
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
}

export default function SegmentEditorOverlay({
  segments,
  selectedSegmentId,
  scaleFactor,
  imageWidth,
  imageHeight,
  onSelect,
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
  mappingMode = false,
  onSegmentContextMenu,
  movable = false,
  onMoveSegment,
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

  // Snap guides shown during move
  const [snapGuides, setSnapGuides] = useState<{ axis: 'h' | 'v'; pos: number }[]>([]);

  // Track Alt key state for subtract mode
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (!e.altKey) setAltHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => setAltHeld(false));
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
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
    [selectedSegmentId, onExtendSelected, onSubtractFromSelected, subtractMode],
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
    const rect = svg.getBoundingClientRect();
    const width = svg.width.baseVal.value || rect.width || 1;
    const height = svg.height.baseVal.value || rect.height || 1;
    return {
      x: ((e.clientX - rect.left) * width) / rect.width,
      y: ((e.clientY - rect.top) * height) / rect.height,
    };
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

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
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
        const imgPt = { x: pt.x / scaleFactor, y: pt.y / scaleFactor };
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
        const imgPt = { x: pt.x / scaleFactor, y: pt.y / scaleFactor };
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
    [getSvgPoint, onSelect, drawTool, polyPoints, scaleFactor, onAddPolygonSegment, finalizeShape],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
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
        setPolyPreview({ x: pt.x / scaleFactor, y: pt.y / scaleFactor });
        return;
      }

      // Freehand draw: accumulate points
      if (drawTool === 'draw' && freehandDrawing.current) {
        setFreehandPoints((prev) => [...prev, { x: pt.x / scaleFactor, y: pt.y / scaleFactor }]);
        return;
      }

      if (!drawStart) return;
      setDrawEnd(pt);
    },
    [drawStart, getSvgPoint, scaleFactor, onMoveSegment, drawTool, polyPoints.length],
  );

  const handleSvgPointerUp = useCallback(
    (_e: React.PointerEvent) => {
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

      const x1 = Math.min(drawStart.x, drawEnd.x) / scaleFactor;
      const y1 = Math.min(drawStart.y, drawEnd.y) / scaleFactor;
      const x2 = Math.max(drawStart.x, drawEnd.x) / scaleFactor;
      const y2 = Math.max(drawStart.y, drawEnd.y) / scaleFactor;

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
    [drawStart, drawEnd, scaleFactor, onAddSegment, drawTool, freehandPoints, onAddFreehandSegment, finalizeShape],
  );

  const handleSegmentClick = useCallback(
    (e: React.PointerEvent, id: string) => {
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
    [onSelect, movable, selectedSegmentId, segments, getSvgPoint, scaleFactor, onResizeStart, drawTool],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onToggleExcluded(id);
    },
    [onToggleExcluded],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
    [selectedSegmentId, onDelete, polyPoints.length],
  );

  // Clear draw state when tool changes
  useEffect(() => {
    setPolyPoints([]);
    setPolyPreview(null);
    freehandDrawing.current = false;
    setFreehandPoints([]);
    setDrawStart(null);
    setDrawEnd(null);
  }, [drawTool]);

  // Attach keyboard listener for delete key
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Rubber-band rectangle
  const rubberBand = drawStart && drawEnd ? {
    x: Math.min(drawStart.x, drawEnd.x),
    y: Math.min(drawStart.y, drawEnd.y),
    width: Math.abs(drawEnd.x - drawStart.x),
    height: Math.abs(drawEnd.y - drawStart.y),
  } : null;

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
      }}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={(e) => {
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
        const isSpecial = segClass === 'continuation' || segClass === 'addition';
        const isMappable = mappingMode && isSpecial && !seg.isMapped;
        const mappingDimmed = mappingMode && !isMappable;
        const mappingClasses = isMappable ? ' seg-mappable' : mappingDimmed ? ' seg-dimmed' : '';
        const [sx1, sy1, sx2, sy2] = [
          seg.bbox[0] * scaleFactor,
          seg.bbox[1] * scaleFactor,
          seg.bbox[2] * scaleFactor,
          seg.bbox[3] * scaleFactor,
        ];

        const hasBoundary = seg.boundary && seg.boundary.length >= 3;
        const inSelectMode = drawTool === 'select';
        const selectableClass = inSelectMode || isMappable ? ' selectable' : '';
        const showVertexHandles = isSelected && reshapeMode && hasBoundary && inSelectMode;
        const showRotateHandles = isSelected && rotateMode && hasBoundary && inSelectMode;

        return (
          <g key={seg._id} className="segment-editor-seg">
            {/* Segment boundary — polygon or bbox rect */}
            {seg.boundary && seg.boundary.length > 2 ? (
              <polygon
                points={seg.boundary
                  .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                  .join(' ')}
                className={`segment-editor-poly${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${mappingClasses}${selectableClass}`}
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : (movable && isSelected && inSelectMode) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSegmentContextMenu?.(e.clientX, e.clientY, seg._id); }}
              />
            ) : (
              <rect
                x={sx1}
                y={sy1}
                width={sx2 - sx1}
                height={sy2 - sy1}
                className={`segment-editor-rect${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${mappingClasses}${selectableClass}`}
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : (movable && isSelected && inSelectMode) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSegmentContextMenu?.(e.clientX, e.clientY, seg._id); }}
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

            {/* Vertex handles (reshape) or rotation handles */}
            {showVertexHandles && (
              <VertexHandles
                boundary={seg.boundary!}
                scaleFactor={scaleFactor}
                onSetBoundary={(newBoundary) => onSetBoundary?.(seg._id, newBoundary)}
                onDragStart={() => onResizeStart?.()}
              />
            )}
            {showRotateHandles && (
              <RotateHandle
                boundary={seg.boundary!}
                bbox={seg.bbox}
                scaleFactor={scaleFactor}
                onSetBoundary={(newBoundary) => onSetBoundary?.(seg._id, newBoundary)}
                onDragStart={() => onResizeStart?.()}
              />
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
    </svg>
  );
}
