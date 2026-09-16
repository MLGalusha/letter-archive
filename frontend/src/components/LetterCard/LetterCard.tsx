import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import "../ArchiveList/ArchiveList.css";
import type { ArchiveSearchHighlightRange, LetterCardData } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { PreviewImage } from "../common/PreviewImage";
import { getMediaLabel } from "../../utils/letterPreview";
import { imagePreloadService } from "../../services/imagePreloadService";

interface LetterCardProps {
  card: LetterCardData;
  onClick: (id: string) => void;
  selection?: boolean;
  sortCue?: {
    label: string;
    value: string;
  } | null;
}

function getCorrespondentLine(card: LetterCardData): string | undefined {
  const sender = card.sender?.trim();
  const recipient = card.recipient?.trim();
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  return sender || recipient || undefined;
}

function renderHighlightedExcerpt(
  excerpt: string,
  highlightRanges: ArchiveSearchHighlightRange[],
) {
  if (highlightRanges.length === 0) {
    return excerpt;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  highlightRanges.forEach((range, index) => {
    const start = Math.max(0, Math.min(range.start, excerpt.length));
    const end = Math.max(start, Math.min(range.end, excerpt.length));

    if (start > cursor) {
      parts.push(<span key={`text-${index}-${cursor}`}>{excerpt.slice(cursor, start)}</span>);
    }

    if (end > start) {
      parts.push(
        <mark key={`mark-${index}-${start}`} className="letter-card-search-match-highlight">
          {excerpt.slice(start, end)}
        </mark>,
      );
    }

    cursor = end;
  });

  if (cursor < excerpt.length) {
    parts.push(<span key={`text-tail-${cursor}`}>{excerpt.slice(cursor)}</span>);
  }

  return parts;
}

function LetterCard({
  card,
  onClick,
  selection = false,
  sortCue = null,
}: LetterCardProps) {
  const searchPreview = card.searchPreview;
  const hasSearchPreview = Boolean(searchPreview?.excerpt && searchPreview.matchCount > 0);
  const previewId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const previewKey = JSON.stringify([card.id, searchPreview]);
  const [previousPreview, setPreviousPreview] = useState(previewKey);
  if (previousPreview !== previewKey) {
    setPreviousPreview(previewKey);
    setPinned(false);
    setHovered(false);
    setDismissed(false);
  }
  const previewVisible = hasSearchPreview && (pinned || hovered) && !dismissed;
  useEffect(() => {
    if (!previewVisible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPinned(false);
      setDismissed(true);
      if (previewRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [previewVisible]);
  const mediaLabel = getMediaLabel(card.imageType);
  const primaryChip = card.primaryChip;
  const date = card.date || card.dateRaw;
  const hook = card.hook?.trim();
  const peopleLine = getCorrespondentLine(card);
  const hasImage = Boolean(card.imageUrl);
  const fallbackLabel = date || mediaLabel;
  const ariaLabel = [
    mediaLabel,
    peopleLine,
    date,
    primaryChip,
    hook,
  ].filter((value): value is string => Boolean(value)).join(", ");

  const handleCardMouseEnter = () => {
    setHovered(true);
    setDismissed(false);
    // Preload this letter's first image at carousel width so it's ready on click.
    if (card.imageUrl) {
      const url = getImageUrl(card.imageUrl, { width: 800 });
      if (!imagePreloadService.isPreloaded(url)) {
        const img = new Image();
        img.src = url;
      }
    }
  };

  const CardControl = selection ? 'button' : 'a';
  const visibleSearchPreview = previewVisible && hasSearchPreview && searchPreview;

  return (
    <div
      className={`letter-card-shell${hasSearchPreview ? " letter-card-shell--has-search-match" : ""}`}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') handleCardMouseEnter(); }}
      onPointerLeave={() => setHovered(false)}
    >
      <CardControl
        type={selection ? "button" : undefined}
        href={selection ? undefined : `/letter/${card.id}`}
        className={`letter-card letter-card--${card.imageType}${hasSearchPreview ? " letter-card--has-search-match" : ""}${previewVisible ? " letter-card--search-preview-visible" : ""}`}
        onClick={(event) => {
          if (!selection && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
          event.preventDefault();
          onClick(card.id);
        }}
        aria-label={ariaLabel || `${mediaLabel}: ${card.title || "Unknown item"}`}
      >
        {hasImage ? (
          <PreviewImage
            className="letter-card-image"
            src={getImageUrl(card.imageUrl!, { width: 480 })}
            alt=""
          />
        ) : (
          <div className="letter-card-fallback" aria-hidden="true">
            <span>{fallbackLabel}</span>
          </div>
        )}
        <div className="letter-card-overlay" />
        {sortCue && (
          <div
            className={`letter-card-sort-cue${hasSearchPreview ? " letter-card-sort-cue--stacked" : ""}`}
            aria-hidden="true"
          >
            <span className="letter-card-sort-cue-label">{sortCue.label}</span>
            <span className="letter-card-sort-cue-value">{sortCue.value}</span>
          </div>
        )}
        {primaryChip && <div className="letter-card-page-count">{primaryChip}</div>}
        <div className="letter-card-content">
          {peopleLine && <div className="letter-card-meta">{peopleLine}</div>}
          {date && <div className="letter-card-date">{date}</div>}
          {hook && (
            <p className="letter-hook">
              {hook}
            </p>
          )}
        </div>
      </CardControl>
        {visibleSearchPreview && (
          <div ref={previewRef} id={previewId} className="letter-card-search-match" role="region" aria-label="Search match preview" tabIndex={0} onFocus={() => setPinned(true)}>
            <div className="letter-card-search-match-count">
              {visibleSearchPreview.matchCount} {visibleSearchPreview.matchCount === 1 ? "match" : "matches"}
            </div>
            <div className="letter-card-search-match-source">
              {visibleSearchPreview.matchedFieldLabel} match
            </div>
            <div className="letter-card-search-match-excerpt">
              {renderHighlightedExcerpt(visibleSearchPreview.excerpt, visibleSearchPreview.highlightRanges)}
            </div>
          </div>
        )}
      {hasSearchPreview && (
        <button
          ref={toggleRef}
          type="button"
          className={`letter-card-search-toggle${previewVisible ? " is-active" : ""}`}
          aria-label="Search match preview"
          aria-expanded={previewVisible}
          aria-controls={previewId}
          aria-describedby={previewVisible ? previewId : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            // First click pins a hover preview; a second click dismisses it.
            setPinned(!pinned);
            setDismissed(pinned);
          }}
        >
          <svg
            className="letter-card-search-toggle-icon"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="8.25" cy="8.25" r="4.75" />
            <path d="M11.8 11.8 16.5 16.5" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default memo(LetterCard, (prev, next) => {
  if (prev.card !== next.card) return false;
  if (prev.onClick !== next.onClick) return false;
  const pCue = prev.sortCue;
  const nCue = next.sortCue;
  if (pCue === nCue) return true;
  if (!pCue || !nCue) return false;
  return pCue.label === nCue.label && pCue.value === nCue.value;
});
