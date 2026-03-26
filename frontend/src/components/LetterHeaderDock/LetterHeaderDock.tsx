import { useState, useCallback, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import useCollectionLetters from "./useCollectionLetters";
import LetterPickerPopover from "./LetterPickerPopover";
import "./LetterHeaderDock.css";

/** Max dots visible at once — odd so current dot can be centered */
const WINDOW_SIZE = 17;

interface LetterHeaderDockProps {
  adjacent: AdjacentLettersResponse;
  letterId: string;
}

export default function LetterHeaderDock({ adjacent, letterId }: LetterHeaderDockProps) {
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const letters = useCollectionLetters(adjacent.collectionCode);
  const barRef = useRef<HTMLDivElement>(null);

  const pos = adjacent.position ?? 1;
  const total = adjacent.total;

  // Find current letter in the fetched array to anchor navigation.
  // The shelf API may sort slightly differently than the adjacent API,
  // so we anchor on the known letter and compute offsets.
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

  const handleBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!barRef.current || !letters) return;
      const rect = barRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetPos = Math.round(pct * (total - 1)) + 1;
      goToPosition(targetPos);
    },
    [letters, total, goToPosition],
  );

  // Compute the visible window of dot positions (1-based)
  const { startPos, endPos } = useMemo(() => {
    if (total <= WINDOW_SIZE) return { startPos: 1, endPos: total };
    const half = Math.floor(WINDOW_SIZE / 2);
    let s = pos - half;
    let e = pos + half;
    if (s < 1) { s = 1; e = WINDOW_SIZE; }
    if (e > total) { e = total; s = total - WINDOW_SIZE + 1; }
    return { startPos: s, endPos: e };
  }, [pos, total]);

  const showLeftFade = startPos > 1;
  const showRightFade = endPos < total;

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

        <div className="dock-strip-track">
          {showLeftFade && <span className="dock-track-fade dock-track-fade-left" />}

          <div className="dock-strip-dots">
            {Array.from({ length: endPos - startPos + 1 }, (_, i) => {
              const dotPos = startPos + i;
              const isActive = dotPos === pos;
              return (
                <button
                  key={dotPos}
                  type="button"
                  className={`dock-strip-dot${isActive ? " active" : ""}`}
                  onClick={() => !isActive && goToPosition(dotPos)}
                  aria-label={`Letter ${dotPos}`}
                  title={`Letter ${dotPos}`}
                />
              );
            })}
          </div>

          {showRightFade && <span className="dock-track-fade dock-track-fade-right" />}
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
