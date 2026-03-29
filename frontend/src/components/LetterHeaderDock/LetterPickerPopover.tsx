import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ArchiveShelfItem } from "../../types/Letter";
import "./LetterPickerPopover.css";

interface LetterPickerPopoverProps {
  letters: ArchiveShelfItem[] | null;
  currentLetterId: string;
  currentPosition: number | null;
  total: number;
  onClose: () => void;
}

export default function LetterPickerPopover({
  letters,
  currentLetterId,
  currentPosition: _currentPosition,
  total,
  onClose,
}: LetterPickerPopoverProps) {
  const navigate = useNavigate();
  const activeRef = useRef<HTMLButtonElement>(null);
  const loading = !letters;

  /* Auto-scroll to the active letter */
  useEffect(() => {
    if (letters && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "center" });
    }
  }, [letters]);

  /* Close on Escape or click outside */
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleKeyDown, handleClickOutside]);

  return (
    <div className="letter-picker-popover" ref={popoverRef}>
      <div className="letter-picker-header">
        <span className="letter-picker-title">
          {total} letter{total !== 1 ? "s" : ""} in collection
        </span>
      </div>

      <div className="letter-picker-list">
        {loading && (
          <div className="letter-picker-loading">Loading...</div>
        )}
        {!loading && letters && letters.map((item, i) => {
          const isActive = item.id === currentLetterId;
          const people = [item.sender, item.recipient].filter(Boolean).join(" \u2192 ");
          return (
            <button
              key={item.id}
              type="button"
              ref={isActive ? activeRef : undefined}
              className={`letter-picker-item${isActive ? " is-active" : ""}`}
              onClick={() => {
                navigate(`/letter/${item.id}`);
                onClose();
              }}
            >
              <span className="letter-picker-item-num">{i + 1}</span>
              <span className="letter-picker-item-info">
                {item.date && <span className="letter-picker-item-date">{item.date}</span>}
                {people && <span className="letter-picker-item-people">{people}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
