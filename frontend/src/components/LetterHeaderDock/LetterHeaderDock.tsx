import { useState, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import useCollectionLetters from "./useCollectionLetters";
import LetterPickerPopover from "./LetterPickerPopover";
import "./LetterHeaderDock.css";

interface LetterHeaderDockProps {
  adjacent: AdjacentLettersResponse;
  letterId: string;
}

export default function LetterHeaderDock({ adjacent, letterId }: LetterHeaderDockProps) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const letters = useCollectionLetters(adjacent.collectionCode);
  const trackRef = useRef<HTMLDivElement>(null);

  const pos = adjacent.position ?? 1;
  const total = adjacent.total;

  const currentIdx = useMemo(
    () => (letters ? letters.findIndex((l) => l.id === letterId) : -1),
    [letters, letterId],
  );

  const goToPosition = useCallback(
    (targetPos: number) => {
      if (!letters || currentIdx === -1) return;
      const targetIdx = currentIdx + (targetPos - pos);
      if (targetIdx >= 0 && targetIdx < letters.length) {
        navigate(`/letter/${letters[targetIdx].id}`);
      }
    },
    [letters, currentIdx, pos, navigate],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || !letters) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetPos = Math.round(pct * (total - 1)) + 1;
      if (targetPos !== pos) goToPosition(targetPos);
    },
    [letters, total, pos, goToPosition],
  );

  // Progress percentage for the track fill
  const progressPct = total > 1 ? ((pos - 1) / (total - 1)) * 100 : 50;

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
          &#8592;
        </button>

        <div
          className="dock-strip-track"
          ref={trackRef}
          onClick={handleTrackClick}
          role="slider"
          aria-valuenow={pos}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Letter ${pos} of ${total}`}
          tabIndex={0}
        >
          <div className="dock-track-fill" style={{ width: `${progressPct}%` }} />
          <div className="dock-track-thumb" style={{ left: `${progressPct}%` }} />
          {/* Subtle tick marks for small collections */}
          {total <= 30 && (
            <div className="dock-track-ticks">
              {Array.from({ length: total }, (_, i) => (
                <span
                  key={i}
                  className={`dock-track-tick${i + 1 === pos ? " current" : ""}`}
                  style={{ left: total > 1 ? `${(i / (total - 1)) * 100}%` : "50%" }}
                />
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="dock-strip-pos"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Open letter picker"
        >
          {pos}<span className="dock-strip-pos-sep">/</span>{total}
        </button>

        <button
          type="button"
          className="dock-strip-arrow"
          onClick={() => adjacent.next && navigate(`/letter/${adjacent.next.id}`)}
          disabled={!adjacent.next}
          aria-label={adjacent.nextWraps ? "First in collection" : "Next letter"}
        >
          &#8594;
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
