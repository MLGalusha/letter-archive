import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import "../ArchiveList/ArchiveList.css";
import type { ArchiveSearchHighlightRange, LetterCardData } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { ProgressiveImage } from "../common";
import { getMediaLabel } from "../../utils/letterPreview";
import { imagePreloadService } from "../../services/imagePreloadService";
import useIsTouchDevice from "../../hooks/useIsTouchDevice";
import { getAppScrollRootForIO } from "../../utils/appScroll";

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
const TOUCH_HOLD_CLICK_SUPPRESS_MS = 180;
const TOUCH_PREVIEW_RELEASE_HIDE_MS = 400;

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
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchPreview = card.searchPreview;
  const hasSearchPreview = Boolean(searchPreview?.excerpt && searchPreview.matchCount > 0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [prioritizeImageLoad, setPrioritizeImageLoad] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const touchReleaseTimerRef = useRef<number | null>(null);
  const hoverActiveRef = useRef(false);
  const isTouchDevice = useIsTouchDevice();
  const touchPreviewStartedAtRef = useRef<number | null>(null);
  const swallowNextClickRef = useRef(false);
  const touchPreviewActiveRef = useRef(false);
  const touchPreviewRetouchRef = useRef(false);
  const mediaLabel = getMediaLabel(card.imageType);
  const primaryChip = card.primaryChip;
  const date = card.date || card.dateRaw;
  const hook = card.hook?.trim();
  const hookHighlightRanges = searchPreview?.hookHighlightRanges ?? [];
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

  useEffect(() => {
    const node = shellRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setPrioritizeImageLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setPrioritizeImageLoad(true);
        observer.disconnect();
      },
      { root: getAppScrollRootForIO(), rootMargin: "1200px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [card.id]);

  const clearPreviewTimer = () => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const clearTouchReleaseTimer = () => {
    if (touchReleaseTimerRef.current !== null) {
      window.clearTimeout(touchReleaseTimerRef.current);
      touchReleaseTimerRef.current = null;
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

  useEffect(() => () => {
    clearPreviewTimer();
    clearTouchReleaseTimer();
  }, []);

  const handleCardMouseEnter = () => {
    hoverActiveRef.current = true;
    // Preload this letter's first image at carousel width so it's ready on click
    if (card.imageUrl) {
      const url = getImageUrl(card.imageUrl, { width: 800 });
      if (!imagePreloadService.isPreloaded(url)) {
        const img = new Image();
        img.src = url;
      }
    }
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

  const handleCardTouchStart = (_event: TouchEvent<HTMLAnchorElement>) => {
    if (!hasSearchPreview) return;
    if (!isTouchDevice) return;
    touchPreviewRetouchRef.current = previewVisible;
    touchPreviewStartedAtRef.current = Date.now();
    swallowNextClickRef.current = false;
    touchPreviewActiveRef.current = true;
    clearTouchReleaseTimer();
    clearPreviewTimer();
    setPreviewVisible(true);
  };

  const handleCardTouchMove = (event: TouchEvent<HTMLAnchorElement>) => {
    if (!isTouchDevice || !touchPreviewActiveRef.current) return;

    const touch = event.touches[0];
    const shell = shellRef.current;
    if (!touch || !shell || typeof document.elementFromPoint !== "function") return;

    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const insideCard = Boolean(target && shell.contains(target));

    clearTouchReleaseTimer();
    clearPreviewTimer();
    setPreviewVisible(insideCard);

    if (!insideCard) {
      touchPreviewActiveRef.current = false;
    }
  };

  const handleCardTouchEnd = (_event: TouchEvent<HTMLAnchorElement>) => {
    if (!isTouchDevice) return;
    const startedAt = touchPreviewStartedAtRef.current;
    if (
      touchPreviewRetouchRef.current
      || (startedAt !== null && Date.now() - startedAt >= TOUCH_HOLD_CLICK_SUPPRESS_MS)
    ) {
      swallowNextClickRef.current = true;
    }
    touchPreviewStartedAtRef.current = null;
    touchPreviewActiveRef.current = false;
    touchPreviewRetouchRef.current = false;
    clearPreviewTimer();
    clearTouchReleaseTimer();
    touchReleaseTimerRef.current = window.setTimeout(() => {
      setPreviewVisible(false);
      touchReleaseTimerRef.current = null;
    }, TOUCH_PREVIEW_RELEASE_HIDE_MS);
  };

  const visibleSearchPreview = previewVisible && hasSearchPreview && searchPreview;

  return (
    <div
      ref={shellRef}
      className={`letter-card-shell${hasSearchPreview ? " letter-card-shell--has-search-match" : ""}`}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
    >
      <a
        href={`/letter/${card.id}`}
        className={`letter-card letter-card--${card.imageType}${hasSearchPreview ? " letter-card--has-search-match" : ""}${previewVisible ? " letter-card--search-preview-visible" : ""}`}
        onTouchStart={handleCardTouchStart}
        onTouchMove={handleCardTouchMove}
        onTouchEnd={handleCardTouchEnd}
        onTouchCancel={handleCardTouchEnd}
        onClick={(event) => {
          if (swallowNextClickRef.current) {
            swallowNextClickRef.current = false;
            event.preventDefault();
            return;
          }
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onClick(card.id);
        }}
        aria-label={ariaLabel || `${mediaLabel}: ${card.title || "Unknown item"}`}
      >
        {hasImage ? (
          <ProgressiveImage
            className="letter-card-image"
            src={getImageUrl(card.imageUrl!, { width: 480 })}
            thumbSrc={getImageUrl(card.imageUrl!, { width: 32 })}
            midSrc={getImageUrl(card.imageUrl!, { width: 240 })}
            alt=""
            loading={prioritizeImageLoad ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={prioritizeImageLoad ? "high" : "low"}
            context="archive-card"
            idleUpgrade
            deferFullUntilVisible={!prioritizeImageLoad}
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
        {visibleSearchPreview && (
          <div className="letter-card-search-match" aria-hidden="true">
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
        <div className="letter-card-content">
          {peopleLine && <div className="letter-card-meta">{peopleLine}</div>}
          {date && <div className="letter-card-date">{date}</div>}
          {hook && (
            <p className="letter-hook">
              {renderHighlightedExcerpt(hook, hookHighlightRanges)}
            </p>
          )}
        </div>
      </a>
      {hasSearchPreview && !isTouchDevice && (
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
