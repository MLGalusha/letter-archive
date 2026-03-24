import { useEffect, useMemo, useRef, useState } from "react";
import "./ArchiveList.css";
import LetterCard from "../LetterCard/LetterCard";
import type { ArchiveShelfItem } from "../../types/Letter";

interface ArchiveListProps {
  letters: ArchiveShelfItem[];
  total: number;
  loading: boolean;
  error?: string | null;
  onLetterClick: (letterId: string) => void;
}

export default function ArchiveList({
  letters,
  total,
  loading,
  error = null,
  onLetterClick,
}: ArchiveListProps) {
  const [visibleCount, setVisibleCount] = useState(24);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(24);
  }, [letters]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || visibleCount >= letters.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(current + 24, letters.length));
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [letters.length, visibleCount]);

  const visibleLetters = useMemo(
    () => letters.slice(0, visibleCount),
    [letters, visibleCount],
  );

  if (loading && letters.length === 0) {
    return (
      <div className="archive-section">
        <p className="loading-message">Searching archive...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="archive-section">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  return (
    <div className="archive-section">
      {total > 0 ? (
        <>
          <p className="results-count">
            {total} {total === 1 ? "archive item" : "archive items"}
            {loading ? " · updating..." : ""}
          </p>
          <div className="letter-grid">
            {visibleLetters.map((letter) => (
              <LetterCard
                key={letter.id}
                card={letter}
                onClick={onLetterClick}
              />
            ))}
          </div>
          {visibleCount < letters.length && (
            <div className="archive-load-more-sentinel" ref={loadMoreRef} aria-hidden="true" />
          )}
        </>
      ) : (
        <div className="no-results">
          <p>No archive items match this search yet.</p>
          <p className="no-results-hint">
            Try another name, place, phrase, or clear a filter.
          </p>
        </div>
      )}
    </div>
  );
}
