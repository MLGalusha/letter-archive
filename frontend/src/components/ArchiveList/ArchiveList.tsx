import { useEffect, useRef } from "react";
import "./ArchiveList.css";
import LetterCard from "../LetterCard/LetterCard";
import type { ArchiveShelfItem } from "../../types/Letter";

interface ArchiveListProps {
  letters: ArchiveShelfItem[];
  total: number;
  loading: boolean;
  loadingMore?: boolean;
  error?: string | null;
  loadMoreError?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onLetterClick: (letterId: string) => void;
}

export default function ArchiveList({
  letters,
  total,
  loading,
  loadingMore = false,
  error = null,
  loadMoreError = null,
  hasMore = false,
  onLoadMore,
  onLetterClick,
}: ArchiveListProps) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreHandlerRef = useRef(onLoadMore);

  useEffect(() => {
    loadMoreHandlerRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || loading || loadingMore || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreHandlerRef.current?.();
      },
      { rootMargin: "1200px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, letters.length, loading, loadingMore]);

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
            {letters.length < total
              ? `Showing ${letters.length} of ${total} archive items`
              : `${total} ${total === 1 ? "archive item" : "archive items"}`}
            {loading ? " · updating..." : loadingMore ? " · loading more..." : ""}
          </p>
          <div className="letter-grid">
            {letters.map((letter) => (
              <LetterCard
                key={letter.id}
                card={letter}
                onClick={onLetterClick}
              />
            ))}
          </div>
          {hasMore ? (
            <div className="archive-load-more" ref={loadMoreRef}>
              <p className={`archive-progress-message${loadMoreError ? " archive-progress-message--error" : ""}`}>
                {loadingMore
                  ? "Loading more archive items..."
                  : loadMoreError
                    ? `${loadMoreError} Scroll again or load the next set manually.`
                  : `Scroll to continue through the archive. ${total - letters.length} more ${
                      total - letters.length === 1 ? "item" : "items"
                    } still below.`}
              </p>
              {onLoadMore && (
                <button
                  type="button"
                  className="archive-load-more-button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : `Load next ${Math.min(24, total - letters.length)}`}
                </button>
              )}
            </div>
          ) : total > 0 ? (
            <p className="archive-complete-message">
              All {total} {total === 1 ? "archive item is" : "archive items are"} loaded.
            </p>
          ) : null}
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
