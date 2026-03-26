import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import useCollectionLetters from "./useCollectionLetters";
import LetterPickerPopover from "./LetterPickerPopover";
import "./LetterHeaderDock.css";

/** Thumb radius in px — inner track is inset by this on each side */
const THUMB_INSET = 12;

interface LetterHeaderDockProps {
  adjacent: AdjacentLettersResponse;
  letterId: string;
}

export default function LetterHeaderDock({ adjacent, letterId }: LetterHeaderDockProps) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const letters = useCollectionLetters(adjacent.collectionCode);
  const innerRef = useRef<HTMLDivElement>(null);

  // Drag state — only visual during drag, navigates on release
  const [dragPos, setDragPos] = useState<number | null>(null);
  const isDragging = useRef(false);
  const didDrag = useRef(false); // true if pointer moved during press

  const pos = adjacent.position ?? 1;
  const total = adjacent.total;

  const currentIdx = useMemo(
    () => (letters ? letters.findIndex((l) => l.id === letterId) : -1),
    [letters, letterId],
  );

  const navigateToPos = useCallback(
    (targetPos: number) => {
      if (!letters || currentIdx === -1 || targetPos === pos) return;
      const targetIdx = currentIdx + (targetPos - pos);
      if (targetIdx >= 0 && targetIdx < letters.length) {
        navigate(`/letter/${letters[targetIdx].id}`);
      }
    },
    [letters, currentIdx, pos, navigate],
  );

  // Convert clientX → 1-based position via the inner track element
  const posFromClientX = useCallback(
    (clientX: number) => {
      if (!innerRef.current) return pos;
      const rect = innerRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(pct * (total - 1)) + 1;
    },
    [total, pos],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!letters) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      isDragging.current = true;
      didDrag.current = false;
      const p = posFromClientX(e.clientX);
      setDragPos(p);
    },
    [letters, posFromClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      didDrag.current = true;
      setDragPos(posFromClientX(e.clientX));
    },
    [posFromClientX],
  );

  const handlePointerUp = useCallback(
    () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      // Navigate to wherever the thumb is visually — keep dragPos held
      // so the thumb stays put until the new page loads and pos updates
      const finalPos = dragPos ?? pos;
      navigateToPos(finalPos);
      // dragPos is NOT cleared here — cleared below when pos catches up
    },
    [dragPos, pos, navigateToPos],
  );

  const handlePointerCancel = useCallback(() => {
    isDragging.current = false;
    didDrag.current = false;
    setDragPos(null);
  }, []);

  // Click = tap without drag — navigate immediately
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (didDrag.current) return; // was a drag, not a click
      if (!letters) return;
      const targetPos = posFromClientX(e.clientX);
      navigateToPos(targetPos);
    },
    [letters, posFromClientX, navigateToPos],
  );

  // Clear held dragPos once the actual position catches up (page loaded)
  useEffect(() => {
    if (dragPos != null && !isDragging.current) {
      setDragPos(null);
    }
  }, [pos, dragPos]);

  // Visual position — follows drag in real-time, otherwise shows actual position
  const displayPos = dragPos ?? pos;
  const progressPct = total > 1 ? ((displayPos - 1) / (total - 1)) * 100 : 50;
  const hasDrag = dragPos != null;

  return (
    <div className="letter-header-dock">
      <div className="dock-strip">
        <Link
          to={`/collections/${adjacent.collectionCode}`}
          className="dock-strip-collection"
        >
          {adjacent.collectionTitle || `Collection ${adjacent.collectionCode}`}
        </Link>

        <div className="dock-strip-divider" />

        <button
          type="button"
          className="dock-strip-arrow"
          onClick={() => adjacent.prev && navigate(`/letter/${adjacent.prev.id}`)}
          disabled={!adjacent.prev}
          aria-label={adjacent.prevWraps ? "Last in collection" : "Previous letter"}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5.5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          className={`dock-strip-track${hasDrag ? " is-dragging" : ""}`}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          role="slider"
          aria-valuenow={pos}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Letter ${pos} of ${total}`}
          tabIndex={0}
        >
          <div className="dock-track-rail" />
          <div
            className="dock-track-inner"
            ref={innerRef}
            style={{ margin: `0 ${THUMB_INSET}px` }}
          >
            <div className="dock-track-fill" style={{ width: `calc(${progressPct}% + ${THUMB_INSET}px)` }} />
            <div className="dock-track-thumb" style={{ left: `${progressPct}%` }} />
            {total <= 30 && (
              <div className="dock-track-ticks">
                {Array.from({ length: total }, (_, i) => (
                  <span
                    key={i}
                    className={`dock-track-tick${i + 1 === displayPos ? " current" : ""}`}
                    style={{ left: total > 1 ? `${(i / (total - 1)) * 100}%` : "50%" }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`dock-strip-pos${hasDrag ? " is-previewing" : ""}`}
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Open letter picker"
        >
          {displayPos}<span className="dock-strip-pos-sep">/</span>{total}
        </button>

        <button
          type="button"
          className="dock-strip-arrow"
          onClick={() => adjacent.next && navigate(`/letter/${adjacent.next.id}`)}
          disabled={!adjacent.next}
          aria-label={adjacent.nextWraps ? "First in collection" : "Next letter"}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3L10.5 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {pickerOpen && (
        <LetterPickerPopover
          letters={letters}
          currentLetterId={letterId}
          currentPosition={adjacent.position}
          total={adjacent.total}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
