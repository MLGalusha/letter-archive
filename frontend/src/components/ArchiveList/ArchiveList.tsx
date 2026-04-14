import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import "./ArchiveList.css";
import LetterCard from "../LetterCard/LetterCard";
import type { ArchiveShelfItem } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { imagePreloadService } from "../../services/imagePreloadService";

interface ArchiveListProps {
  letters: ArchiveShelfItem[];
  total: number;
  loading: boolean;
  loadingMore?: boolean;
  error?: string | null;
  loadMoreError?: string | null;
  hasMore?: boolean;
  onLoadMore?: () => void;
  sortCueField?: "createdAt" | "collection" | null;
  onLetterClick: (letterId: string) => void;
}

function formatArchiveSortCueDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  sortCueField = null,
  onLetterClick,
}: ArchiveListProps) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadMoreHandlerRef = useRef(onLoadMore);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const collapseSpacerRef = useRef<HTMLDivElement | null>(null);
  const previousHeightRef = useRef<number | null>(null);
  const collapseAnimationFrameRef = useRef<number | null>(null);
  const isSparseResultSet = !loading && !loadingMore && !error && total <= 8;

  // When the result set is small (e.g. filtered down), preload all carousel images
  // since the user is likely to click through several of them
  const PRELOAD_THRESHOLD = 20;
  useEffect(() => {
    if (loading || letters.length === 0 || total > PRELOAD_THRESHOLD) return;
    for (const letter of letters) {
      if (letter.imageUrl) {
        const url = getImageUrl(letter.imageUrl, { width: 800 });
        if (!imagePreloadService.isPreloaded(url)) {
          const img = new Image();
          img.src = url;
        }
      }
    }
  }, [letters, loading, total]);

  const sortCueMap = useMemo(() => {
    if (!sortCueField) return null;
    const map = new Map<string, { label: string; value: string }>();
    for (const letter of letters) {
      if (sortCueField === "collection" && letter.collectionCode) {
        map.set(letter.id, { label: "Collection", value: letter.collectionCode });
      } else if (sortCueField === "createdAt") {
        const publishedLabel = formatArchiveSortCueDate(letter.createdAt);
        if (publishedLabel) {
          map.set(letter.id, { label: "Published", value: publishedLabel });
        }
      }
    }
    return map;
  }, [letters, sortCueField]);

  useEffect(() => {
    loadMoreHandlerRef.current = onLoadMore;
  }, [onLoadMore]);

  useLayoutEffect(() => {
    const node = contentRef.current;
    const spacerNode = collapseSpacerRef.current;
    if (!node || !spacerNode) return;

    const nextHeight = node.scrollHeight;
    const previousHeight = previousHeightRef.current ?? nextHeight;
    previousHeightRef.current = nextHeight;

    const resetCollapseSpacer = () => {
      spacerNode.style.height = "0px";
      spacerNode.style.opacity = "";
      spacerNode.style.transition = "";
    };

    if (loadingMore || nextHeight >= previousHeight || Math.abs(nextHeight - previousHeight) < 2) {
      resetCollapseSpacer();
      return;
    }

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReducedMotion) {
      resetCollapseSpacer();
      return;
    }

    if (collapseAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(collapseAnimationFrameRef.current);
    }

    spacerNode.style.height = `${previousHeight - nextHeight}px`;
    spacerNode.style.opacity = "1";
    spacerNode.style.transition = "none";
    spacerNode.getBoundingClientRect();

    collapseAnimationFrameRef.current = window.requestAnimationFrame(() => {
      spacerNode.style.transition =
        "height 720ms cubic-bezier(0.4, 0, 0.2, 1), opacity 280ms ease 180ms";
      spacerNode.style.height = "0px";
      spacerNode.style.opacity = "0";
    });

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "height") return;
      resetCollapseSpacer();
    };

    spacerNode.addEventListener("transitionend", handleTransitionEnd);

    return () => {
      if (collapseAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(collapseAnimationFrameRef.current);
        collapseAnimationFrameRef.current = null;
      }
      spacerNode.removeEventListener("transitionend", handleTransitionEnd);
      resetCollapseSpacer();
    };
  }, [error, hasMore, letters.length, loading, loadingMore, loadMoreError, total]);

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

  if (error) {
    return (
      <div className="archive-section">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  return (
    <div className="archive-section">
      <div
        ref={contentRef}
        className={`archive-section-content${loading ? " archive-section-content--loading" : ""}${isSparseResultSet ? " archive-section-content--sparse" : ""}`}
      >
        {total > 0 ? (
          <>
            <div className="letter-grid">
              {letters.map((letter) => (
                <LetterCard
                  key={letter.id}
                  card={letter}
                  sortCue={sortCueMap?.get(letter.id) ?? null}
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
        ) : loading ? (
          <div className="archive-initial-loading" aria-live="polite">
            <p className="loading-message">Searching archive...</p>
          </div>
        ) : (
          <div className="no-results">
            <p>No archive items match this search yet.</p>
            <p className="no-results-hint">
              Try another name, place, phrase, or clear a filter.
            </p>
          </div>
        )}
      </div>
      <div ref={collapseSpacerRef} className="archive-collapse-spacer" aria-hidden="true" />
    </div>
  );
}
