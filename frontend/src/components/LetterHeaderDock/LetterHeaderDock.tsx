import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import useCollectionLetters from "./useCollectionLetters";
import LetterPickerPopover from "./LetterPickerPopover";
import "./LetterHeaderDock.css";

const HEADER_DOT_LIMIT = 20;

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

  const goToIndex = useCallback(
    (i: number) => {
      if (!letters || i < 0 || i >= letters.length) return;
      navigate(`/letter/${letters[i].id}`);
    },
    [letters, navigate],
  );

  const handleBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!barRef.current || !letters) return;
      const rect = barRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const idx = Math.round(pct * (letters.length - 1));
      goToIndex(idx);
    },
    [letters, goToIndex],
  );

  return (
    <div className="letter-header-dock">
      <Link
        to={`/collections/${adjacent.collectionCode}`}
        className="letter-dock-collection"
      >
        {adjacent.collectionTitle || `Collection ${adjacent.collectionCode}`}
      </Link>

      <div className="letter-dock-nav">
        <button
          type="button"
          className="letter-dock-arrow"
          onClick={() => adjacent.prev && navigate(`/letter/${adjacent.prev.id}`)}
          disabled={!adjacent.prev}
          aria-label={adjacent.prevWraps ? "Last in collection" : "Previous letter"}
        >
          &#8592;
        </button>

        <div className="letter-dock-filmstrip-wrap">
          {total <= HEADER_DOT_LIMIT ? (
            <div className="dock-filmstrip-dots">
              {Array.from({ length: total }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`dock-filmstrip-dot${i + 1 === pos ? " active" : ""}`}
                  onClick={() => goToIndex(i)}
                  aria-label={`Letter ${i + 1}`}
                />
              ))}
            </div>
          ) : (
            <div
              className="dock-filmstrip-bar"
              ref={barRef}
              role="slider"
              aria-valuenow={pos}
              aria-valuemin={1}
              aria-valuemax={total}
              aria-label="Letter position"
              tabIndex={0}
              onClick={handleBarClick}
            >
              <div
                className="dock-filmstrip-bar-fill"
                style={{ width: `${(pos / total) * 100}%` }}
              />
              <div
                className="dock-filmstrip-bar-thumb"
                style={{ left: `${(pos / total) * 100}%` }}
              />
            </div>
          )}

          <button
            type="button"
            className="dock-filmstrip-label"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="Open letter picker"
          >
            {pos}<span className="dock-filmstrip-label-sep">/</span>{total}
          </button>
        </div>

        <button
          type="button"
          className="letter-dock-arrow"
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
