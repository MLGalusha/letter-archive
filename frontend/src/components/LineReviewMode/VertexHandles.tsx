import { useCallback, useRef } from 'react';

interface VertexHandlesProps {
  boundary: { x: number; y: number }[];
  scaleFactor: number;
  /** Called per mouse move with the entire smoothly-deformed boundary. */
  onSetBoundary: (newBoundary: { x: number; y: number }[]) => void;
  /** Called once when a drag begins (snapshot undo state). */
  onDragStart: () => void;
}

/**
 * Reshape handle: a thick grabbable polygon border.
 *
 * Dragging anywhere on the border finds the nearest vertex and moves it,
 * with a smooth cosine falloff applied to neighboring vertices based on
 * perimeter distance. The result is an organic, smooth deformation.
 */
export default function VertexHandles({
  boundary,
  scaleFactor,
  onSetBoundary,
  onDragStart,
}: VertexHandlesProps) {
  const dragRef = useRef<{
    vertexIndex: number;
    startBoundary: { x: number; y: number }[];
    perimeterDistances: number[];
    radius: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const svg = (e.target as Element).closest('svg');
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) / scaleFactor;
      const py = (e.clientY - rect.top) / scaleFactor;

      // Find nearest vertex to click point
      let nearestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < boundary.length; i++) {
        const d = Math.hypot(boundary[i].x - px, boundary[i].y - py);
        if (d < minDist) {
          minDist = d;
          nearestIdx = i;
        }
      }

      const startBoundary = boundary.map((p) => ({ ...p }));
      const n = boundary.length;

      // Compute shortest perimeter distance from grabbed vertex to each other vertex
      const distances = new Array<number>(n).fill(0);
      let cumFwd = 0;
      for (let step = 1; step < n; step++) {
        const i = (nearestIdx + step) % n;
        const prev = (nearestIdx + step - 1) % n;
        cumFwd += Math.hypot(
          boundary[i].x - boundary[prev].x,
          boundary[i].y - boundary[prev].y,
        );
        distances[i] = cumFwd;
      }
      let cumBwd = 0;
      for (let step = 1; step < n; step++) {
        const i = (nearestIdx - step + n) % n;
        const next = (nearestIdx - step + 1 + n) % n;
        cumBwd += Math.hypot(
          boundary[i].x - boundary[next].x,
          boundary[i].y - boundary[next].y,
        );
        if (cumBwd < distances[i]) {
          distances[i] = cumBwd;
        }
      }

      // Radius: 20% of total perimeter
      let perimeter = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        perimeter += Math.hypot(boundary[j].x - boundary[i].x, boundary[j].y - boundary[i].y);
      }
      const radius = perimeter * 0.2;

      dragRef.current = { vertexIndex: nearestIdx, startBoundary, perimeterDistances: distances, radius };
      onDragStart();
    },
    [boundary, scaleFactor, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      e.stopPropagation();

      const svg = (e.target as Element).closest('svg');
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const x = (e.clientX - svgRect.left) / scaleFactor;
      const y = (e.clientY - svgRect.top) / scaleFactor;

      const { vertexIndex, startBoundary, perimeterDistances, radius } = dragRef.current;
      const orig = startBoundary[vertexIndex];
      const dx = x - orig.x;
      const dy = y - orig.y;

      const newBoundary = startBoundary.map((p, i) => {
        const dist = perimeterDistances[i];
        if (dist === 0) return { x, y }; // grabbed vertex — exact position
        if (dist >= radius) return { ...p }; // outside falloff — unchanged
        // Cosine falloff: 1 at center, 0 at radius
        const t = dist / radius;
        const factor = 0.5 * (1 + Math.cos(Math.PI * t));
        return { x: p.x + dx * factor, y: p.y + dy * factor };
      });

      onSetBoundary(newBoundary);
    },
    [scaleFactor, onSetBoundary],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  }, []);

  const pointsStr = boundary
    .map((p) => `${p.x * scaleFactor},${p.y * scaleFactor}`)
    .join(' ');

  return (
    <g className="vertex-handles">
      {/* Invisible thick stroke for easy grabbing */}
      <polygon
        points={pointsStr}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: 'grab', pointerEvents: 'stroke' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* Visible border highlight */}
      <polygon
        points={pointsStr}
        className="vertex-border-highlight"
      />
    </g>
  );
}
