import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./TimelineScrubber.css";

const WINDOW_SIZE = 20;
const LABEL_INTERVAL = 4;

export interface TimelineDot {
  id: string;
  dateLabel: string;
  hook: string;
  peopleLine: string | null;
  description: string | null;
}

interface TimelineScrubberProps {
  dots: TimelineDot[];
  activeIndex: number;
  firstSpecificIndex: number;
  lastSpecificIndex: number;
  onSelect: (index: number) => void;
  onNavigate: (id: string) => void;
}

function computeWindowStart(idx: number, total: number): number {
  if (total <= WINDOW_SIZE) return 0;
  const half = Math.floor(WINDOW_SIZE / 2);
  return Math.max(0, Math.min(idx - half, total - WINDOW_SIZE));
}

export default function TimelineScrubber({
  dots,
  activeIndex,
  firstSpecificIndex,
  lastSpecificIndex,
  onSelect,
  onNavigate,
}: TimelineScrubberProps) {
  const total = dots.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, lastIdx: -1 });

  const [windowStart, setWindowStart] = useState(() =>
    computeWindowStart(activeIndex, total),
  );

  // Recenter window on active change (skipped during drag via class check)
  useEffect(() => {
    if (trackRef.current?.classList.contains("is-dragging")) return;
    setWindowStart(computeWindowStart(activeIndex, total));
  }, [activeIndex, total]);

  const windowEnd = Math.min(windowStart + WINDOW_SIZE, total);
  const windowSize = windowEnd - windowStart;

  const showLabel = useCallback(
    (globalIdx: number) => {
      if (globalIdx === activeIndex) return true;
      if (globalIdx === windowStart || globalIdx === windowEnd - 1) return true;
      const posInWindow = globalIdx - windowStart;
      return posInWindow > 0 && posInWindow % LABEL_INTERVAL === 0;
    },
    [activeIndex, windowStart, windowEnd],
  );

  const needsMinimap = total > WINDOW_SIZE;
  const minimapLeft = needsMinimap ? (windowStart / (total - 1)) * 100 : 0;
  const minimapWidth = needsMinimap
    ? (Math.min(WINDOW_SIZE, total) / total) * 100
    : 100;

  // Dot positions as percentages within the track
  const dotPositions = useMemo(() => {
    if (windowSize <= 1) return dots.map(() => 50);
    return dots.map((_, i) => ((i - windowStart) / (windowSize - 1)) * 100);
  }, [dots, windowStart, windowSize]);

  // ── Pointer → index mapping ──────────────────────────
  const indexFromClientX = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return activeIndex;
      const rect = trackRef.current.getBoundingClientRect();
      // Account for 10px padding on each side
      const innerLeft = rect.left + 10;
      const innerWidth = rect.width - 20;
      const pct = Math.max(0, Math.min(1, (clientX - innerLeft) / innerWidth));
      const idx = windowStart + Math.round(pct * (windowSize - 1));
      return Math.max(0, Math.min(total - 1, idx));
    },
    [activeIndex, windowStart, windowSize, total],
  );

  // ── Drag handlers ────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      trackRef.current?.setPointerCapture(e.pointerId);
      trackRef.current?.classList.add("is-dragging");
      const d = dragRef.current;
      d.active = true;
      const idx = indexFromClientX(e.clientX);
      d.lastIdx = idx;
      onSelect(idx);
    },
    [indexFromClientX, onSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      const idx = indexFromClientX(e.clientX);
      if (idx !== d.lastIdx) {
        d.lastIdx = idx;
        onSelect(idx);
        // Edge scroll
        if (total > WINDOW_SIZE) {
          if (idx >= windowStart + windowSize - 1 && windowStart + windowSize < total) {
            setWindowStart((prev) => Math.min(prev + 1, total - WINDOW_SIZE));
          } else if (idx <= windowStart && windowStart > 0) {
            setWindowStart((prev) => Math.max(prev - 1, 0));
          }
        }
      }
    },
    [indexFromClientX, onSelect, windowStart, windowSize, total],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      trackRef.current?.releasePointerCapture(e.pointerId);
      trackRef.current?.classList.remove("is-dragging");
      // Let the window recenter smoothly
      setWindowStart(computeWindowStart(d.lastIdx, total));
    },
    [total],
  );

  const handlePointerCancel = useCallback(() => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    trackRef.current?.classList.remove("is-dragging");
    setWindowStart(computeWindowStart(activeIndex, total));
  }, [activeIndex, total]);

  const handleFirst = useCallback(() => onSelect(firstSpecificIndex), [firstSpecificIndex, onSelect]);
  const handleLast = useCallback(() => onSelect(lastSpecificIndex), [lastSpecificIndex, onSelect]);

  const activeDot = dots[activeIndex] ?? null;

  return (
    <div className="tl">
      {/* Track row: arrows + draggable track */}
      <div className="tl-nav">
        <button
          type="button"
          className="tl-skip"
          onClick={handleFirst}
          disabled={activeIndex === firstSpecificIndex}
          aria-label="Jump to first letter"
        >
          &laquo;
        </button>

        <div
          ref={trackRef}
          className="tl-track"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <div className="tl-line" />
          {dots.map((dot, i) => {
            const isActive = i === activeIndex;
            const pct = dotPositions[i];
            const visible = pct >= -5 && pct <= 105;
            return (
              <div
                key={dot.id}
                className={`tl-dot${isActive ? " active" : ""}${!visible ? " offscreen" : ""}`}
                style={{ left: `${pct}%` }}
              >
                {showLabel(i) && (
                  <span className={`tl-dot-label${isActive ? " tl-dot-label--active" : ""}`}>
                    {dot.dateLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="tl-skip"
          onClick={handleLast}
          disabled={activeIndex === lastSpecificIndex}
          aria-label="Jump to last letter"
        >
          &raquo;
        </button>
      </div>

      {/* Minimap */}
      {needsMinimap && (
        <div className="tl-minimap">
          <div
            className="tl-minimap-window"
            style={{ left: `${minimapLeft}%`, width: `${minimapWidth}%` }}
          />
        </div>
      )}

      {/* Selected entry content */}
      {activeDot && (
        <button
          type="button"
          className="tl-content"
          onClick={() => onNavigate(activeDot.id)}
        >
          <h3 className="tl-content-hook">
            {activeDot.hook || activeDot.dateLabel}
          </h3>
          <div className="tl-content-meta">
            <span className="tl-content-date">{activeDot.dateLabel}</span>
            {activeDot.peopleLine && (
              <>
                <span className="tl-content-sep">&middot;</span>
                <span className="tl-content-people">{activeDot.peopleLine}</span>
              </>
            )}
          </div>
          {activeDot.description && (
            <p className="tl-content-desc">{activeDot.description}</p>
          )}
          <span className="tl-content-cta">Read letter &rarr;</span>
        </button>
      )}
    </div>
  );
}
