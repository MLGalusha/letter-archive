import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditableSegment } from '../../hooks/useSegmentEditor';
import SegmentHandle from './SegmentHandle';
import VertexHandles from './VertexHandles';
import RotateHandle from './RotateHandle';

interface SegmentEditorOverlayProps {
  segments: EditableSegment[];
  selectedSegmentId: string | null;
  scaleFactor: number;
  imageWidth: number;
  imageHeight: number;
  onSelect: (id: string | null) => void;
  onResize: (id: string, newBbox: [number, number, number, number]) => void;
  onDelete: (id: string) => void;
  onToggleExcluded: (id: string) => void;
  onAddSegment: (bbox: [number, number, number, number]) => void;
  onAddPolygonSegment?: (boundary: { x: number; y: number }[]) => void;
  onAddLineSegment?: (p1: { x: number; y: number }, p2: { x: number; y: number }, width: number) => void;
  /** Active draw tool: box (default), polygon, or line. */
  drawTool?: 'box' | 'polygon' | 'line';
  /** Called once when a resize/vertex drag starts — used to snapshot undo state. */
  onResizeStart?: () => void;
  /** When true, show vertex handles instead of bbox resize handles on selected segment. */
  reshapeMode?: boolean;
  /** When true, show rotation handles on selected segment. */
  rotateMode?: boolean;
  /** Set entire boundary at once (smooth deformation / rotation). */
  onSetBoundary?: (segId: string, newBoundary: { x: number; y: number }[]) => void;
  /** When true, segments are in mapping mode — special segments highlighted, body dimmed. */
  mappingMode?: boolean;
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
  onResize,
  onDelete,
  onToggleExcluded,
  onAddSegment,
  onAddPolygonSegment,
  onAddLineSegment,
  drawTool = 'box',
  onResizeStart,
  reshapeMode = false,
  rotateMode = false,
  onSetBoundary,
  mappingMode = false,
  movable = false,
  onMoveSegment,
}: SegmentEditorOverlayProps) {
  // Draw-new-segment state (box mode)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  // Polygon draw state (click-to-place vertices)
  const [polyPoints, setPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [polyPreview, setPolyPreview] = useState<{ x: number; y: number } | null>(null);
  // Line draw state
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);
  const [lineEnd, setLineEnd] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
      // Only start drawing if clicking on empty SVG area (not a segment)
      if ((e.target as Element).closest('.segment-editor-seg, .segment-handles, .vertex-handles')) return;

      const pt = getSvgPoint(e);

      if (drawTool === 'polygon') {
        // Polygon: click to add vertex, close if near first point
        const imgPt = { x: pt.x / scaleFactor, y: pt.y / scaleFactor };
        if (polyPoints.length >= 3) {
          const first = polyPoints[0];
          const dist = Math.hypot(pt.x - first.x * scaleFactor, pt.y - first.y * scaleFactor);
          if (dist < 12) {
            // Close polygon
            onAddPolygonSegment?.(polyPoints.map((p) => ({ ...p })));
            setPolyPoints([]);
            setPolyPreview(null);
            return;
          }
        }
        setPolyPoints((prev) => [...prev, imgPt]);
        onSelect(null);
        return;
      }

      if (drawTool === 'line') {
        if (!lineStart) {
          setLineStart(pt);
          setLineEnd(pt);
          onSelect(null);
          (e.target as Element).setPointerCapture(e.pointerId);
        }
        return;
      }

      // Box mode (default)
      setDrawStart(pt);
      setDrawEnd(pt);
      onSelect(null);
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [getSvgPoint, onSelect, drawTool, polyPoints, scaleFactor, onAddPolygonSegment, lineStart],
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
        onMoveSegment?.(
          moveDragRef.current.segId,
          moveDragRef.current.origBbox,
          moveDragRef.current.origBoundary,
          dx,
          dy,
        );
        return;
      }

      const pt = getSvgPoint(e);

      // Polygon preview
      if (drawTool === 'polygon' && polyPoints.length > 0) {
        setPolyPreview({ x: pt.x / scaleFactor, y: pt.y / scaleFactor });
        return;
      }

      // Line preview
      if (drawTool === 'line' && lineStart) {
        setLineEnd(pt);
        return;
      }

      if (!drawStart) return;
      setDrawEnd(pt);
    },
    [drawStart, getSvgPoint, scaleFactor, onMoveSegment, drawTool, polyPoints.length, lineStart],
  );

  const handleSvgPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (moveDragRef.current) {
        moveDragRef.current = null;
        return;
      }

      // Line mode: finish on pointer up
      if (drawTool === 'line' && lineStart && lineEnd) {
        const p1 = { x: lineStart.x / scaleFactor, y: lineStart.y / scaleFactor };
        const p2 = { x: lineEnd.x / scaleFactor, y: lineEnd.y / scaleFactor };
        const dist = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y);
        if (dist > 10) {
          onAddLineSegment?.(p1, p2, 20);
        }
        setLineStart(null);
        setLineEnd(null);
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
        onAddSegment([x1, y1, x2, y2]);
      }

      setDrawStart(null);
      setDrawEnd(null);
    },
    [drawStart, drawEnd, scaleFactor, onAddSegment, drawTool, lineStart, lineEnd, onAddLineSegment],
  );

  const handleSegmentClick = useCallback(
    (e: React.PointerEvent, id: string) => {
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
    [onSelect, movable, selectedSegmentId, segments, getSvgPoint, scaleFactor, onResizeStart],
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
        if (lineStart) { setLineStart(null); setLineEnd(null); }
        return;
      }
      if (!selectedSegmentId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(selectedSegmentId);
      }
    },
    [selectedSegmentId, onDelete, polyPoints.length, lineStart],
  );

  // Clear draw state when tool changes
  useEffect(() => {
    setPolyPoints([]);
    setPolyPreview(null);
    setLineStart(null);
    setLineEnd(null);
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
        cursor: 'crosshair',
      }}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={(e) => {
        // Double-click closes polygon if enough points
        if (drawTool === 'polygon' && polyPoints.length >= 3) {
          e.stopPropagation();
          onAddPolygonSegment?.(polyPoints.map((p) => ({ ...p })));
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
        const showVertexHandles = isSelected && reshapeMode && hasBoundary;
        const showRotateHandles = isSelected && rotateMode && hasBoundary;

        return (
          <g key={seg._id} className="segment-editor-seg">
            {/* Segment boundary — polygon or bbox rect */}
            {seg.boundary && seg.boundary.length > 2 ? (
              <polygon
                points={seg.boundary
                  .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                  .join(' ')}
                className={`segment-editor-poly${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${mappingClasses}`}
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : (movable && isSelected) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
              />
            ) : (
              <rect
                x={sx1}
                y={sy1}
                width={sx2 - sx1}
                height={sy2 - sy1}
                className={`segment-editor-rect${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${mappingClasses}`}
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : (movable && isSelected) ? 'move' : undefined }}
                onPointerDown={(e) => handleSegmentClick(e, seg._id)}
                onDoubleClick={(e) => handleDoubleClick(e, seg._id)}
              />
            )}

            {/* Delete button on selected segment */}
            {isSelected && (
              <g
                className="segment-editor-delete"
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={(e) => { e.stopPropagation(); onDelete(seg._id); }}
              >
                <circle cx={sx2 + 10} cy={sy1 - 10} r={10} fill="rgba(220,38,38,0.9)" />
                <path
                  d={`M${sx2 + 6},${sy1 - 14} L${sx2 + 14},${sy1 - 6} M${sx2 + 14},${sy1 - 14} L${sx2 + 6},${sy1 - 6}`}
                  stroke="white"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            )}

            {/* Resize handles (default), vertex handles (reshape), or rotation handles */}
            {isSelected && !showVertexHandles && !showRotateHandles && (
              <SegmentHandle
                bbox={seg.bbox}
                scaleFactor={scaleFactor}
                onResize={(newBbox) => onResize(seg._id, newBbox)}
                onResizeStart={onResizeStart}
              />
            )}
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
          className="segment-editor-rubber-band"
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

      {/* Line draw preview */}
      {drawTool === 'line' && lineStart && lineEnd && (() => {
        const dist = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y);
        if (dist < 3) return null;
        // Show the line and thin rectangle preview
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const len = Math.hypot(dx, dy);
        const w = 20 * scaleFactor; // preview width in display px
        const px = (-dy / len) * (w / 2);
        const py = (dx / len) * (w / 2);
        const rectPts = [
          `${lineStart.x + px},${lineStart.y + py}`,
          `${lineEnd.x + px},${lineEnd.y + py}`,
          `${lineEnd.x - px},${lineEnd.y - py}`,
          `${lineStart.x - px},${lineStart.y - py}`,
        ].join(' ');
        return (
          <g className="draw-line-preview">
            <polygon points={rectPts} className="draw-line-rect" />
            <line
              x1={lineStart.x} y1={lineStart.y}
              x2={lineEnd.x} y2={lineEnd.y}
              className="draw-line-center"
            />
            <circle cx={lineStart.x} cy={lineStart.y} r={4} className="draw-line-endpoint" />
            <circle cx={lineEnd.x} cy={lineEnd.y} r={4} className="draw-line-endpoint" />
          </g>
        );
      })()}
    </svg>
  );
}
