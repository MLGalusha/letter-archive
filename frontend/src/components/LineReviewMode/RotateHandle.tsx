import { useCallback, useRef, useState } from 'react';

interface RotateHandleProps {
  boundary: { x: number; y: number }[];
  bbox: [number, number, number, number];
  scaleFactor: number;
  /** Called per mouse move with the fully-rotated boundary. */
  onSetBoundary: (newBoundary: { x: number; y: number }[]) => void;
  /** Called once when a drag begins (snapshot undo state). */
  onDragStart: () => void;
}

/**
 * Rotation handle: grab the border to rotate around a draggable anchor point.
 *
 * - Anchor defaults to segment center, draggable to any position.
 * - Grabbing the border and dragging rotates all boundary points
 *   around the anchor by the angle delta.
 */
export default function RotateHandle({
  boundary,
  bbox,
  scaleFactor,
  onSetBoundary,
  onDragStart,
}: RotateHandleProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number }>(() => ({
    x: (bbox[0] + bbox[2]) / 2,
    y: (bbox[1] + bbox[3]) / 2,
  }));

  const dragRef = useRef<{
    type: 'rotate' | 'anchor';
    startAngle?: number;
    startBoundary?: { x: number; y: number }[];
  } | null>(null);

  const getSvgCoords = useCallback(
    (e: React.PointerEvent): { x: number; y: number } => {
      const svg = (e.target as Element).closest('svg');
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / scaleFactor,
        y: (e.clientY - rect.top) / scaleFactor,
      };
    },
    [scaleFactor],
  );

  const handleRotateDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const { x, y } = getSvgCoords(e);
      dragRef.current = {
        type: 'rotate',
        startAngle: Math.atan2(y - anchor.y, x - anchor.x),
        startBoundary: boundary.map((p) => ({ ...p })),
      };
      onDragStart();
    },
    [boundary, anchor, getSvgCoords, onDragStart],
  );

  const handleAnchorDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { type: 'anchor' };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      e.stopPropagation();
      const { x, y } = getSvgCoords(e);

      if (dragRef.current.type === 'anchor') {
        setAnchor({ x, y });
        return;
      }

      // Rotation
      const { startAngle, startBoundary } = dragRef.current;
      if (startAngle == null || !startBoundary) return;
      const currentAngle = Math.atan2(y - anchor.y, x - anchor.x);
      const delta = currentAngle - startAngle;
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);

      const newBoundary = startBoundary.map((p) => ({
        x: anchor.x + (p.x - anchor.x) * cos - (p.y - anchor.y) * sin,
        y: anchor.y + (p.x - anchor.x) * sin + (p.y - anchor.y) * cos,
      }));

      onSetBoundary(newBoundary);
    },
    [anchor, getSvgCoords, onSetBoundary],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  }, []);

  const pointsStr = boundary
    .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
    .join(' ');

  const ax = anchor.x * scaleFactor;
  const ay = anchor.y * scaleFactor;
  const ARM = 9;

  return (
    <g className="rotate-handles">
      {/* Invisible filled area for rotation grab — entire segment is grabbable */}
      <polygon
        points={pointsStr}
        fill="transparent"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: 'grab', pointerEvents: 'all' }}
        onPointerDown={handleRotateDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* Visible rotation border */}
      <polygon
        points={pointsStr}
        className="rotate-border-highlight"
      />

      {/* Anchor point — crosshair with draggable circle */}
      <g className="rotate-anchor">
        {/* Larger invisible hit area */}
        <circle
          cx={ax}
          cy={ay}
          r={14}
          fill="transparent"
          style={{ cursor: 'move', pointerEvents: 'all' }}
          onPointerDown={handleAnchorDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {/* Crosshair lines */}
        <line x1={ax - ARM} y1={ay} x2={ax + ARM} y2={ay} className="rotate-anchor-cross" />
        <line x1={ax} y1={ay - ARM} x2={ax} y2={ay + ARM} className="rotate-anchor-cross" />
        {/* Center dot */}
        <circle cx={ax} cy={ay} r={4} className="rotate-anchor-dot" />
      </g>
    </g>
  );
}
