import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditableSegment } from '../../hooks/useSegmentEditor';
import SegmentHandle from './SegmentHandle';

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
  /** When true, segments are in mapping mode — special segments highlighted, body dimmed. */
  mappingMode?: boolean;
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
  mappingMode = false,
}: SegmentEditorOverlayProps) {
  // Draw-new-segment state
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only start drawing if clicking on empty SVG area (not a segment)
      if ((e.target as Element).closest('.segment-editor-seg, .segment-handles')) return;
      const pt = getSvgPoint(e);
      setDrawStart(pt);
      setDrawEnd(pt);
      onSelect(null); // deselect any segment
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [getSvgPoint, onSelect],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawStart) return;
      setDrawEnd(getSvgPoint(e));
    },
    [drawStart, getSvgPoint],
  );

  const handleSvgPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      if (!drawStart || !drawEnd) {
        setDrawStart(null);
        setDrawEnd(null);
        return;
      }

      const x1 = Math.min(drawStart.x, drawEnd.x) / scaleFactor;
      const y1 = Math.min(drawStart.y, drawEnd.y) / scaleFactor;
      const x2 = Math.max(drawStart.x, drawEnd.x) / scaleFactor;
      const y2 = Math.max(drawStart.y, drawEnd.y) / scaleFactor;

      // Minimum drag size to create a segment (15px display)
      if ((x2 - x1) * scaleFactor > 15 && (y2 - y1) * scaleFactor > 15) {
        onAddSegment([x1, y1, x2, y2]);
      }

      setDrawStart(null);
      setDrawEnd(null);
    },
    [drawStart, drawEnd, scaleFactor, onAddSegment],
  );

  const handleSegmentClick = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      onSelect(id);
    },
    [onSelect],
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
      if (!selectedSegmentId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(selectedSegmentId);
      }
    },
    [selectedSegmentId, onDelete],
  );

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

        return (
          <g key={seg._id} className="segment-editor-seg">
            {/* Segment boundary — polygon or bbox rect */}
            {seg.boundary && seg.boundary.length > 2 ? (
              <polygon
                points={seg.boundary
                  .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                  .join(' ')}
                className={`segment-editor-poly${isSelected ? ' selected' : ''}${isExcluded ? ' excluded' : ''}${classModifier}${mappingClasses}`}
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : undefined }}
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
                style={{ pointerEvents: 'all', cursor: isMappable ? 'pointer' : undefined }}
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

            {/* Resize handles on selected segment */}
            {isSelected && (
              <SegmentHandle
                bbox={seg.bbox}
                scaleFactor={scaleFactor}
                onResize={(newBbox) => onResize(seg._id, newBbox)}
              />
            )}
          </g>
        );
      })}

      {/* Rubber-band draw rectangle */}
      {rubberBand && rubberBand.width > 2 && rubberBand.height > 2 && (
        <rect
          x={rubberBand.x}
          y={rubberBand.y}
          width={rubberBand.width}
          height={rubberBand.height}
          className="segment-editor-rubber-band"
        />
      )}
    </svg>
  );
}
