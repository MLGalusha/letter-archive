import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import "../ArchiveList/ArchiveList.css";
import type { ArchiveSearchHighlightRange, LetterCardData } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { ProgressiveImage } from "../common";
import { getMediaLabel } from "../../utils/letterPreview";

interface LetterCardProps {
  card: LetterCardData;
  onClick: (id: string) => void;
  sortCue?: {
    label: string;
    value: string;
  } | null;
}

const SEARCH_PREVIEW_AUTO_HIDE_MS = 1600;
const SEARCH_PREVIEW_COOLDOWN_MS = 8 * 60 * 1000;
const SEARCH_PREVIEW_COOLDOWN_KEY = "letter-card-search-preview-cooldowns";

type SearchPreviewCooldowns = Record<string, number>;

let cooldownCache: SearchPreviewCooldowns | null = null;

function writeSearchPreviewCooldowns(cooldowns: SearchPreviewCooldowns) {
  cooldownCache = cooldowns;
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SEARCH_PREVIEW_COOLDOWN_KEY, JSON.stringify(cooldowns));
  } catch {
    // Ignore storage failures; the preview can still work without persistence.
  }
}

function readSearchPreviewCooldowns(): SearchPreviewCooldowns {
  if (cooldownCache !== null) return cooldownCache;

  if (typeof window === "undefined") return {};

  try {
    const rawValue = window.localStorage.getItem(SEARCH_PREVIEW_COOLDOWN_KEY);
    if (!rawValue) {
      cooldownCache = {};
      return {};
    }

    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      cooldownCache = {};
      return {};
    }

    const now = Date.now();
    const activeCooldowns = Object.fromEntries(
      Object.entries(parsedValue).filter((entry): entry is [string, number] => {
        const [, expiresAt] = entry;
        return typeof expiresAt === "number" && expiresAt > now;
      }),
    );

    if (Object.keys(activeCooldowns).length !== Object.keys(parsedValue).length) {
      writeSearchPreviewCooldowns(activeCooldowns);
    } else {
      cooldownCache = activeCooldowns;
    }

    return activeCooldowns;
  } catch {
    cooldownCache = {};
    return {};
  }
}

function isSearchPreviewCoolingDown(cardId: string): boolean {
  const expiresAt = readSearchPreviewCooldowns()[cardId];
  if (!expiresAt) return false;
  return Date.now() < expiresAt;
}

function rememberSearchPreviewCooldown(cardId: string) {
  if (typeof window === "undefined") return;

  const cooldowns = { ...readSearchPreviewCooldowns() };
  cooldowns[cardId] = Date.now() + SEARCH_PREVIEW_COOLDOWN_MS;
  writeSearchPreviewCooldowns(cooldowns);
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
  sortCue = null,
}: LetterCardProps) {
  const searchPreview = card.searchPreview;
  const hasSearchPreview = Boolean(searchPreview?.excerpt);
  const [previewVisible, setPreviewVisible] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const hoverActiveRef = useRef(false);
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

  const clearPreviewTimer = () => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const showPreviewForABeat = (options?: { persistOnComplete?: boolean }) => {
    if (!hasSearchPreview) return;

    clearPreviewTimer();
    setPreviewVisible(true);
    previewTimerRef.current = window.setTimeout(() => {
      if (options?.persistOnComplete && hoverActiveRef.current) {
        rememberSearchPreviewCooldown(card.id);
      }
      setPreviewVisible(false);
      previewTimerRef.current = null;
    }, SEARCH_PREVIEW_AUTO_HIDE_MS);
  };

  useEffect(() => () => clearPreviewTimer(), []);

  const handleCardMouseEnter = () => {
    hoverActiveRef.current = true;
    if (isSearchPreviewCoolingDown(card.id)) return;
    showPreviewForABeat({ persistOnComplete: true });
  };

  const handleCardMouseLeave = () => {
    hoverActiveRef.current = false;
    clearPreviewTimer();
    setPreviewVisible(false);
  };

  const handleSearchPreviewToggleEnter = () => {
    if (!hasSearchPreview) return;
    clearPreviewTimer();
    setPreviewVisible(true);
  };

  const handleSearchPreviewToggleLeave = () => {
    clearPreviewTimer();
    setPreviewVisible(false);
  };

  const handleSearchPreviewToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (previewVisible) {
      handleSearchPreviewToggleLeave();
      return;
    }
    showPreviewForABeat();
  };

  return (
    <div
      className={`letter-card-shell${hasSearchPreview ? " letter-card-shell--has-search-match" : ""}`}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
    >
      <button
        type="button"
        className={`letter-card letter-card--${card.imageType}${hasSearchPreview ? " letter-card--has-search-match" : ""}${previewVisible ? " letter-card--search-preview-visible" : ""}`}
        onClick={() => onClick(card.id)}
        aria-label={ariaLabel || `${mediaLabel}: ${card.title || "Unknown item"}`}
      >
        {hasImage ? (
          <ProgressiveImage
            className="letter-card-image"
            src={getImageUrl(card.imageUrl!, { width: 480 })}
            thumbSrc={getImageUrl(card.imageUrl!, { width: 32 })}
            alt=""
            loading="lazy"
            decoding="async"
            context="archive-card"
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
        {hasSearchPreview && searchPreview && (
          <div className="letter-card-search-match" aria-hidden="true">
            <div className="letter-card-search-match-count">
              {searchPreview.matchCount} {searchPreview.matchCount === 1 ? "match" : "matches"}
            </div>
            <div className="letter-card-search-match-excerpt">
              {renderHighlightedExcerpt(searchPreview.excerpt, searchPreview.highlightRanges)}
            </div>
          </div>
        )}
        <div className="letter-card-content">
          {peopleLine && <div className="letter-card-meta">{peopleLine}</div>}
          {date && <div className="letter-card-date">{date}</div>}
          {hook && <p className="letter-hook">{hook}</p>}
        </div>
      </button>
      {hasSearchPreview && (
        <button
          type="button"
          className={`letter-card-search-toggle${previewVisible ? " is-active" : ""}`}
          aria-label="Show search match preview"
          onClick={handleSearchPreviewToggleClick}
          onMouseEnter={handleSearchPreviewToggleEnter}
          onMouseLeave={handleSearchPreviewToggleLeave}
          onFocus={handleSearchPreviewToggleEnter}
          onBlur={handleSearchPreviewToggleLeave}
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
