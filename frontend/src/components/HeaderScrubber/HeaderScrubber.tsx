import { useState, useCallback, useEffect, useRef } from "react";
import "../LetterHeaderDock/LetterHeaderDock.css";

const THUMB_INSET = 12;
const WINDOW_SIZE = 30;
const EDGE_SCROLL_MS = 120;

function computeWindowStart(position: number, total: number): number {
  if (total <= WINDOW_SIZE) return 1;
  const half = Math.floor(WINDOW_SIZE / 2);
  const start = position - half;
  return Math.max(1, Math.min(start, total - WINDOW_SIZE + 1));
}

function clampWS(start: number, total: number): number {
  return Math.max(1, Math.min(start, Math.max(1, total - WINDOW_SIZE + 1)));
}

export interface HeaderScrubberProps {
  position: number;     // 1-indexed current position
  total: number;        // total items
  onNavigate: (pos: number) => void; // navigate to 1-indexed position
  onPrev: () => void;
  onNext: () => void;
  wrap?: boolean;       // true = prev/next always enabled (wrap around)
  ariaLabel?: string;   // e.g. "Letter 3 of 27" or "Collection 9 of 12"
}

export default function HeaderScrubber({
  position: pos,
  total,
  onNavigate,
  onPrev,
  onNext,
  wrap = false,
  ariaLabel,
}: HeaderScrubberProps) {
  const needsWindow = total > WINDOW_SIZE;

  const [windowStart, setWindowStart] = useState(() => computeWindowStart(pos, total));

  useEffect(() => {
    setWindowStart(computeWindowStart(pos, total));
  }, [pos, total]);

  const windowEnd = Math.min(windowStart + WINDOW_SIZE - 1, total);
  const windowSize = windowEnd - windowStart + 1;

  const navigateToPos = useCallback(
    (targetPos: number) => {
      if (targetPos === pos) return;
      if (targetPos >= 1 && targetPos <= total) {
        onNavigate(targetPos);
      }
    },
    [pos, total, onNavigate],
  );

  // ── DOM refs for direct manipulation during drag ────────────────
  const trackElRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const posCounterRef = useRef<HTMLSpanElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const ticksRef = useRef<HTMLDivElement>(null);

  // ── Mutable drag state (no React re-renders) ───────────────────
  const drag = useRef({
    active: false,
    didMove: false,
    pos: 0,
    ws: 0,
    edgeDir: 0 as -1 | 0 | 1,
    edgeRafId: 0,
    edgeLastTick: 0,
  });

  // ── Visual update — direct DOM, zero re-renders ─────────────────
  const paintVisuals = useCallback((displayPos: number, ws: number) => {
    const we = Math.min(ws + WINDOW_SIZE - 1, total);
    const wSize = we - ws + 1;
    const pct = wSize > 1
      ? Math.max(0, Math.min(100, ((displayPos - ws) / (wSize - 1)) * 100))
      : 50;

    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
    if (fillRef.current) fillRef.current.style.width = `calc(${pct}% + ${THUMB_INSET}px)`;
    if (posCounterRef.current) {
      posCounterRef.current.firstElementChild!.textContent = `${displayPos}`;
    }

    if (minimapRef.current && needsWindow) {
      const mLeft = ((ws - 1) / (total - 1)) * 100;
      const mWidth = (Math.min(WINDOW_SIZE, total) / total) * 100;
      minimapRef.current.style.left = `${mLeft}%`;
      minimapRef.current.style.width = `${mWidth}%`;
    }

    if (ticksRef.current) {
      const ticks = ticksRef.current.children;
      for (let i = 0; i < ticks.length; i++) {
        const el = ticks[i] as HTMLElement;
        const tickPos = Number(el.dataset.pos);
        const offset = tickPos - ws;
        if (wSize > 1) el.style.left = `${(offset / (wSize - 1)) * 100}%`;
        el.classList.toggle("current", tickPos === displayPos);
      }
    }
  }, [total, needsWindow]);

  // ── Edge scroll via rAF ───────────────────────────────────────
  const edgeScrollLoop = useCallback((now: number) => {
    const d = drag.current;
    if (!d.active || d.edgeDir === 0) return;

    if (now - d.edgeLastTick >= EDGE_SCROLL_MS) {
      d.edgeLastTick = now;
      const nextWS = clampWS(d.ws + d.edgeDir, total);
      if (nextWS !== d.ws) {
        d.ws = nextWS;
        d.pos = Math.max(1, Math.min(total, d.pos + d.edgeDir));
        paintVisuals(d.pos, d.ws);
      } else {
        d.edgeDir = 0;
        return;
      }
    }

    d.edgeRafId = requestAnimationFrame(edgeScrollLoop);
  }, [total, paintVisuals]);

  const startEdgeScroll = useCallback((dir: -1 | 1) => {
    const d = drag.current;
    if (d.edgeDir === dir) return;
    if (d.edgeRafId) cancelAnimationFrame(d.edgeRafId);
    d.edgeDir = dir;
    d.edgeLastTick = performance.now();
    d.edgeRafId = requestAnimationFrame(edgeScrollLoop);
  }, [edgeScrollLoop]);

  const stopEdgeScroll = useCallback(() => {
    const d = drag.current;
    if (d.edgeRafId) { cancelAnimationFrame(d.edgeRafId); d.edgeRafId = 0; }
    d.edgeDir = 0;
  }, []);

  // ── posFromClientX ──────────────────────────────────────────────
  const posFromClientX = useCallback(
    (clientX: number, ws: number) => {
      if (!innerRef.current) return pos;
      const rect = innerRef.current.getBoundingClientRect();
      const we = Math.min(ws + WINDOW_SIZE - 1, total);
      const wSize = we - ws + 1;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ws + Math.round(pct * (wSize - 1));
    },
    [total, pos],
  );

  // ── Pointer handlers ────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      trackElRef.current?.setPointerCapture(e.pointerId);

      const d = drag.current;
      d.active = true;
      d.didMove = false;
      d.ws = windowStart;
      d.pos = posFromClientX(e.clientX, windowStart);
      d.edgeDir = 0;

      trackElRef.current?.classList.add("is-dragging");
      posCounterRef.current?.classList.add("is-previewing");

      paintVisuals(d.pos, d.ws);
    },
    [windowStart, posFromClientX, paintVisuals],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d.active) return;
      d.didMove = true;

      if (d.edgeDir !== 0) {
        const p = posFromClientX(e.clientX, d.ws);
        const we = Math.min(d.ws + WINDOW_SIZE - 1, total);
        const stillAtRight = d.edgeDir === 1 && p >= we;
        const stillAtLeft = d.edgeDir === -1 && p <= d.ws;
        if (!stillAtRight && !stillAtLeft) {
          stopEdgeScroll();
          d.pos = p;
          paintVisuals(d.pos, d.ws);
        }
        return;
      }

      const p = posFromClientX(e.clientX, d.ws);
      d.pos = p;
      paintVisuals(d.pos, d.ws);

      if (needsWindow) {
        const we = Math.min(d.ws + WINDOW_SIZE - 1, total);
        if (p >= we && we < total) startEdgeScroll(1);
        else if (p <= d.ws && d.ws > 1) startEdgeScroll(-1);
      }
    },
    [posFromClientX, total, needsWindow, paintVisuals, startEdgeScroll, stopEdgeScroll],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d.active) return;
      d.active = false;
      trackElRef.current?.releasePointerCapture(e.pointerId);
      stopEdgeScroll();

      trackElRef.current?.classList.remove("is-dragging");
      posCounterRef.current?.classList.remove("is-previewing");

      const finalPos = d.pos;
      setWindowStart(d.ws);
      navigateToPos(finalPos);
    },
    [navigateToPos, stopEdgeScroll],
  );

  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    stopEdgeScroll();
    trackElRef.current?.classList.remove("is-dragging");
    posCounterRef.current?.classList.remove("is-previewing");
    const ws = computeWindowStart(pos, total);
    setWindowStart(ws);
    paintVisuals(pos, ws);
  }, [pos, total, stopEdgeScroll, paintVisuals]);

  const handlePointerCancel = useCallback(() => cancelDrag(), [cancelDrag]);
  const handleDockPointerLeave = useCallback(() => {
    // Don't cancel during an active drag — pointer capture on the track
    // guarantees we'll receive pointerup regardless of finger position.
    // Without this guard, mobile users lose the drag when their finger
    // drifts slightly outside the dock element.
    if (drag.current.active) return;
    cancelDrag();
  }, [cancelDrag]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (drag.current.didMove) return;
      const targetPos = posFromClientX(e.clientX, windowStart);
      navigateToPos(targetPos);
    },
    [posFromClientX, windowStart, navigateToPos],
  );

  // Native touchstart with { passive: false } — iOS Safari ignores
  // preventDefault() from React synthetic pointer events, so the browser
  // still initiates its own scroll gesture. This native listener is the
  // only reliable way to block that on real iOS devices.
  useEffect(() => {
    const el = trackElRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => { e.preventDefault(); };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => el.removeEventListener('touchstart', onTouchStart);
  }, []);

  useEffect(() => () => {
    if (drag.current.edgeRafId) cancelAnimationFrame(drag.current.edgeRafId);
  }, []);

  // ── Render ──────────────────────────────────────────────────────
  const displayPos = pos;
  const progressPct = windowSize > 1
    ? Math.max(0, Math.min(100, ((displayPos - windowStart) / (windowSize - 1)) * 100))
    : 50;

  const minimapLeft = needsWindow ? ((windowStart - 1) / (total - 1)) * 100 : 0;
  const minimapWidth = needsWindow ? (Math.min(WINDOW_SIZE, total) / total) * 100 : 100;

  const hasPrev = wrap || pos > 1;
  const hasNext = wrap || pos < total;

  return (
    <div className="letter-header-dock" onPointerLeave={handleDockPointerLeave}>
      <div className="dock-strip">
        <button
          type="button"
          className="dock-strip-arrow"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5.5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="dock-strip-track-wrap">
          <span ref={posCounterRef} className="dock-strip-pos">
            <span>{displayPos}</span><span className="dock-strip-pos-sep">/</span>{total}
          </span>

          <div
            ref={trackElRef}
            className="dock-strip-track"
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            role="slider"
            aria-valuenow={pos}
            aria-valuemin={1}
            aria-valuemax={total}
            aria-label={ariaLabel || `${pos} of ${total}`}
            tabIndex={0}
          >
            <div className="dock-track-rail" />
            <div
              className="dock-track-inner"
              ref={innerRef}
              style={{ margin: `0 ${THUMB_INSET}px` }}
            >
              <div ref={fillRef} className="dock-track-fill" style={{ width: `calc(${progressPct}% + ${THUMB_INSET}px)` }} />
              <div ref={thumbRef} className="dock-track-thumb" style={{ left: `${progressPct}%` }} />
              <div className="dock-track-ticks" ref={ticksRef}>
                {(() => {
                  const BUFFER = needsWindow ? WINDOW_SIZE : 0;
                  const tickStart = Math.max(1, windowStart - BUFFER);
                  const tickEnd = Math.min(total, windowEnd + BUFFER);
                  const ticks: React.ReactElement[] = [];
                  for (let tickPos = tickStart; tickPos <= tickEnd; tickPos++) {
                    const offset = tickPos - windowStart;
                    const left = windowSize > 1 ? (offset / (windowSize - 1)) * 100 : 50;
                    ticks.push(
                      <span
                        key={tickPos}
                        data-pos={tickPos}
                        className={`dock-track-tick${tickPos === displayPos ? " current" : ""}`}
                        style={{ left: `${left}%` }}
                      />
                    );
                  }
                  return ticks;
                })()}
              </div>
            </div>

            {needsWindow && (
              <div className="dock-track-minimap">
                <div
                  ref={minimapRef}
                  className="dock-track-minimap-window"
                  style={{ left: `${minimapLeft}%`, width: `${minimapWidth}%` }}
                />
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="dock-strip-arrow"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3L10.5 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
