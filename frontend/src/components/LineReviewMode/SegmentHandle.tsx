import { useCallback, useRef } from 'react';
import { clientPointToSource } from './svgCoordinates';

interface SegmentHandleProps {
  /** Bounding box in display (scaled) coordinates */
  bbox: [number, number, number, number];
  scaleFactor: number;
  onResize: (newBbox: [number, number, number, number]) => void;
  /** Called once when a drag starts — used to snapshot undo state. */
  onResizeStart?: () => void;
}

type HandlePosition = 'n' | 's';

const HANDLE_SIZE = 8;
const HALF = HANDLE_SIZE / 2;

function getHandlePositions(
  x1: number, y1: number, x2: number, y2: number,
): Record<HandlePosition, { cx: number; cy: number; cursor: string }> {
  const mx = (x1 + x2) / 2;
  return {
    n: { cx: mx, cy: y1, cursor: 'ns-resize' },
    s: { cx: mx, cy: y2, cursor: 'ns-resize' },
  };
}

export default function SegmentHandle({ bbox, scaleFactor, onResize, onResizeStart }: SegmentHandleProps) {
  const dragRef = useRef<{
    handle: HandlePosition;
    startY: number;
    origBbox: [number, number, number, number];
  } | null>(null);

  const [x1, y1, x2, y2] = [
    bbox[0] * scaleFactor,
    bbox[1] * scaleFactor,
    bbox[2] * scaleFactor,
    bbox[3] * scaleFactor,
  ];

  const handles = getHandlePositions(x1, y1, x2, y2);

  const handlePointerDown = useCallback(
    (pos: HandlePosition, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
      if (!svg) return;
      const start = clientPointToSource(
        svg,
        e.clientX,
        e.clientY,
        scaleFactor,
      );
      dragRef.current = {
        handle: pos,
        startY: start.y,
        origBbox: [...bbox],
      };
      onResizeStart?.();
    },
    [bbox, onResizeStart, scaleFactor],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      e.stopPropagation();
      const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
      if (!svg) return;
      const { handle, startY, origBbox } = dragRef.current;
      const current = clientPointToSource(
        svg,
        e.clientX,
        e.clientY,
        scaleFactor,
      );
      const dy = current.y - startY;

      const newBbox: [number, number, number, number] = [...origBbox];

      // Adjust edges based on handle position
      if (handle.includes('n')) newBbox[1] = origBbox[1] + dy;
      if (handle.includes('s')) newBbox[3] = origBbox[3] + dy;
      // For single-axis handles
      if (handle === 'n') { newBbox[0] = origBbox[0]; newBbox[2] = origBbox[2]; }
      if (handle === 's') { newBbox[0] = origBbox[0]; newBbox[2] = origBbox[2]; }

      // Allow flipping: if edges cross, swap them so the bbox stays valid
      if (newBbox[2] < newBbox[0]) {
        [newBbox[0], newBbox[2]] = [newBbox[2], newBbox[0]];
      }
      if (newBbox[3] < newBbox[1]) {
        [newBbox[1], newBbox[3]] = [newBbox[3], newBbox[1]];
      }
      // Minimum size after flip (5px in natural coords)
      if (newBbox[2] - newBbox[0] < 5) newBbox[2] = newBbox[0] + 5;
      if (newBbox[3] - newBbox[1] < 5) newBbox[3] = newBbox[1] + 5;

      onResize(newBbox);
    },
    [scaleFactor, onResize],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  }, []);

  return (
    <g className="segment-handles">
      {(Object.entries(handles) as [HandlePosition, { cx: number; cy: number; cursor: string }][]).map(
        ([pos, { cx, cy, cursor }]) => (
          <rect
            key={pos}
            x={cx - HALF}
            y={cy - HALF}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            rx={1}
            fill="white"
            stroke="#1976d2"
            strokeWidth={1.5}
            style={{ cursor, pointerEvents: 'all' }}
            onPointerDown={(e) => handlePointerDown(pos, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ),
      )}
    </g>
  );
}
