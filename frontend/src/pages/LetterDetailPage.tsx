import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import SEO from "../components/SEO";

import LetterViewer from "../components/LetterViewer/LetterViewer";
import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { LetterImage, LetterImageType, PublicLetter } from "../types/Letter";
import { getImageUrl } from "../api/client";
import { ProgressiveImage } from "../components/common";
import { imagePreloadService } from "../services/imagePreloadService";
import { buildLetterSeo } from "../utils/seo";
import {
  shouldShowPublicTranscript,
  shouldShowPhotoDescriptionWorkflow,
} from "../utils/letterContent";
import { reflowTranscript, renderTranscriptLines, computeReferenceWidth } from "../utils/transcriptRendering";
import HeaderDock from "../components/Header/HeaderDock";
import HeaderScrubber from "../components/HeaderScrubber/HeaderScrubber";
import useLetterScrubber from "../components/LetterHeaderDock/useLetterScrubber";
import useCarouselDrag from "../hooks/useCarouselDrag";
import useThumbParallax from "../hooks/useThumbParallax";
import useIsTouchDevice from "../hooks/useIsTouchDevice";
import useSwipeNavigation from "../hooks/useSwipeNavigation";
import BackToTop from "../components/BackToTop";
import { appScrollTo, getAppScrollElement, getAppScrollY } from "../utils/appScroll";
import "./LetterDetailPage.css";

/* ── helpers ─────────────────────────────────────────────── */

function correspondentLine(m: PublicLetter["metadata"]): string {
  if (m.sender && m.recipient) return `Written by ${m.sender} to ${m.recipient}`;
  if (m.sender) return `Written by ${m.sender}`;
  if (m.recipient) return `Written to ${m.recipient}`;
  return "";
}



const EXTRA_CONTENT_TYPES: LetterImageType[] = [
  "telegram", "ephemera", "cover", "card", "article", "diary", "voice",
];

function getExtraContentLabel(images: LetterImage[]): string {
  const types = [
    ...new Set(
      images
        .filter((img) => EXTRA_CONTENT_TYPES.includes(img.type))
        .map((img) => img.type),
    ),
  ];
  if (types.length === 0) return "Additional Content";
  return types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" & ");
}

/** Wrap ordinal suffixes (1st, 2nd, 3rd, 4th) and decade "s" (1800s) in small spans */
function formatDateText(text: string): React.ReactNode {
  // Split on ordinals (1st, 22nd, 3rd, 14th) and decade/century s (1800s, 1880S)
  const parts = text.split(/(\d+(?:st|nd|rd|th)|(\d{3,4})[sS])/gi);
  if (parts.length === 1) return text;
  const result: React.ReactNode[] = [];
  let i = 0;
  // Walk the original string, matching patterns and building nodes
  const regex = /(\d+)(st|nd|rd|th)|(\d{3,4})([sS])/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) result.push(text.slice(lastIdx, m.index));
    if (m[1]) {
      // Ordinal: "1st", "4th"
      result.push(<Fragment key={i}>{m[1]}<span className="ordinal-suffix">{m[2]}</span></Fragment>);
    } else {
      // Decade: "1800S" → "1800s"
      result.push(<Fragment key={i}>{m[3]}<span className="ordinal-suffix">s</span></Fragment>);
    }
    lastIdx = m.index + m[0].length;
    i++;
  }
  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return result;
}

/* ── component ───────────────────────────────────────────── */

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loadedLetter, setLoadedLetter] = useState<{
    ownerLetterId: string;
    value: PublicLetter;
  } | null>(null);
  const [loadedAdjacent, setLoadedAdjacent] = useState<{
    ownerLetterId: string;
    value: AdjacentLettersResponse | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const letter = loadedLetter?.value ?? null;
  const displayedLetterIsCurrent = (
    !!letterId
    && loadedLetter?.ownerLetterId === letterId
  );
  const adjacent = (
    displayedLetterIsCurrent
    && loadedAdjacent?.ownerLetterId === letterId
  )
    ? loadedAdjacent.value
    : null;

  // Image viewer modal
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStartPage, setViewerStartPage] = useState(0);

  // Scan carousel (extracted hook)
  const { carouselRef, carouselDraggedRef, scrollToSlide } = useCarouselDrag();

  // Transcript view mode: "reading" (reflowed) or "original" (1:1 line match)
  const [transcriptMode, setTranscriptMode] = useState<"reading" | "original">("reading");

  const initialImageIdRef = useRef(searchParams.get("image"));
  const fromHighlightRef = useRef(searchParams.get("from") === "highlight");

  // Strip highlight params from URL so refresh doesn't re-trigger auto-scroll
  useEffect(() => {
    const hasFrom = searchParams.has("from");
    const hasImage = searchParams.has("image");
    if (hasFrom || hasImage) {
      const clean = new URLSearchParams(searchParams);
      clean.delete("from");
      clean.delete("image");
      const qs = clean.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (carouselRef.current) carouselRef.current.scrollLeft = 0;
    // Scroll to top on letter change (unless coming from a highlight)
    if (!fromHighlightRef.current) appScrollTo(0);
  }, [carouselRef, letterId]);

  // Auto-scroll to a specific image when navigated with ?image= param
  useEffect(() => {
    const targetImageId = initialImageIdRef.current;
    if (!targetImageId || !letter) return;
    const idx = letter.images.findIndex((img) => img.id === targetImageId);
    if (idx > 0) {
      // Delay to let carousel render and settle
      const timer = setTimeout(() => scrollToSlide(idx), 150);
      return () => clearTimeout(timer);
    }
  }, [letter, scrollToSlide]);

  // When navigating from a highlight card, scroll to the summary belt area
  useEffect(() => {
    if (!fromHighlightRef.current || !letter) return;
    fromHighlightRef.current = false;

    const timer = setTimeout(() => {
      // Target the summary section, fall back to the scan figure
      const target = (
        document.querySelector(".letter-summary-section") ||
        document.querySelector(".letter-scan-figure")
      ) as HTMLElement | null;
      if (!target) return;

      const idealTarget = target.offsetTop;

      // Cap: bottom of carousel should never scroll above bottom of viewport
      const carousel = document.querySelector(".letter-scan-figure") as HTMLElement | null;
      const maxScroll = carousel
        ? carousel.offsetTop + carousel.offsetHeight - window.innerHeight
        : Infinity;
      const scrollTarget = Math.min(idealTarget, Math.max(0, maxScroll));

      appScrollTo(0);

      requestAnimationFrame(() => {
        const distance = scrollTarget;
        if (distance < 2) return;

        const duration = Math.min(1000, Math.max(600, distance * 0.5));
        const startTime = performance.now();

        function animate(now: number) {
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / duration);
          const ease = 1 - Math.pow(1 - t, 3);
          appScrollTo(distance * ease);
          if (t < 1) requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [letter]);

  useEffect(() => {
    if (!letterId) return;
    const controller = new AbortController();
    const isFirstLoad = !loadedLetter;
    const requestedLetterId = letterId;
    async function fetchLetter() {
      // Only show loading state on first load — keep previous letter visible during navigation
      if (isFirstLoad) setLoading(true);
      setError(null);
      try {
        const [data, adj] = await Promise.all([
          getLetterById(letterId!, controller.signal),
          getAdjacentLetters(letterId!, controller.signal).catch(() => null),
        ]);
        if (!controller.signal.aborted) {
          setLoadedLetter({
            ownerLetterId: requestedLetterId,
            value: data,
          });
          setLoadedAdjacent({
            ownerLetterId: requestedLetterId,
            value: adj,
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Letter not found");
        console.error("Failed to fetch letter:", err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchLetter();
    return () => controller.abort();
  }, [letterId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell preload service to prioritize images around the current letter
  useEffect(() => {
    if (!letterId) return;
    imagePreloadService.focusLetter(letterId);
    return () => imagePreloadService.cancelPending();
  }, [letterId]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewerOpen) {
        setViewerOpen(false);
        return;
      }
      if (!displayedLetterIsCurrent || !adjacent) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && adjacent.prev) navigate(`/letter/${adjacent.prev.id}`);
      if (e.key === "ArrowRight" && adjacent.next) navigate(`/letter/${adjacent.next.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjacent, displayedLetterIsCurrent, navigate, viewerOpen]);

  // Touch swipe nav between letters (mobile only, disabled when lightbox open)
  const isTouchDevice = useIsTouchDevice();
  const { ref: swipeRef, offset: swipeOffset, isSwiping, isAnimating } = useSwipeNavigation({
    onSwipeLeft: displayedLetterIsCurrent && adjacent?.next
      ? () => navigate(`/letter/${adjacent.next!.id}`)
      : undefined,
    onSwipeRight: displayedLetterIsCurrent && adjacent?.prev
      ? () => navigate(`/letter/${adjacent.prev!.id}`)
      : undefined,
    enabled: (
      displayedLetterIsCurrent
      && isTouchDevice
      && !viewerOpen
      && !!adjacent
    ),
  });

  // Build scrubber props from adjacent data (hook must be at top level)
  const scrubberProps = useLetterScrubber(adjacent, letterId);

  const collectionsLink = useMemo(
    () =>
      adjacent
        ? { label: "Collection", to: `/collections/${adjacent.collectionCode}` }
        : undefined,
    [adjacent],
  );

  const transcriptSectionRef = useRef<HTMLElement>(null);

  // Scroll-driven parallax for side thumbnails (extracted hook)
  useThumbParallax(!!letter);

  // Reference width for proportional spacing: max line length in the original text
  const referenceWidth = useMemo(() => {
    if (!letter?.transcript?.fullText && !letter?.transcript?.pages?.length) return 78;
    const rawText = letter.transcript.fullText
      || letter.transcript.pages.map((p) => p.text).join("\n");
    return computeReferenceWidth(rawText);
  }, [letter]);

  // Large handwriting → short lines → scale up font size
  const isShortLineText = referenceWidth < 40;
  const shortLineClass = isShortLineText ? " transcript-short-lines" : "";

  // Combined reading view: merge all pages into one continuous text flow
  const readingSegments = useMemo(() => {
    if (!letter?.transcript?.pages?.length || letter.transcript.pages.length <= 1) return null;

    // Reflow each page independently so segment boundaries match actual pages
    return letter.transcript.pages.map((page, idx) => ({
      pageIndex: idx,
      pageNumber: page.pageNumber,
      text: reflowTranscript(page.text),
    }));
  }, [letter]);


  const seo = useMemo(() => (letter ? buildLetterSeo(letter) : null), [letter]);


  const openViewer = useCallback((pageIndex: number) => {
    setViewerStartPage(pageIndex);
    setViewerOpen(true);
  }, []);

  // Lock scroll while viewer is open. With container scroll, body is already
  // overflow:hidden — we freeze the #app-scroll container instead by setting
  // overflow:hidden on it and restoring scrollTop on close.
  useEffect(() => {
    if (viewerOpen) {
      const scroller = getAppScrollElement();
      const savedY = getAppScrollY();
      if (scroller) {
        scroller.style.overflow = "hidden";
      } else {
        // Fallback for admin routes / tests without a container.
        document.body.style.overflow = "hidden";
      }
      return () => {
        if (scroller) {
          scroller.style.overflow = "";
          scroller.scrollTop = savedY;
        } else {
          document.body.style.overflow = "";
          window.scrollTo(0, savedY);
        }
      };
    }
  }, [viewerOpen]);

  // Memoize all derived values — must be before conditional returns (Rules of Hooks)
  const derived = useMemo(() => {
    if (!letter) return null;
    const m = letter.metadata;
    const letterTypeImages = letter.images.filter((img) => img.type === "letter");
    const extraContentItems = letter.extraContentItems ?? [];
    // Pre-compute verification CSS class fragments (used repeatedly in JSX)
    const transcriptVerifClass = letter.transcriptStatus === "VERIFIED" ? " verified" : letter.transcriptStatus !== "EMPTY" ? " unverified" : "";
    const transcriptSectionClass = letter.transcriptStatus === "VERIFIED" ? " transcript-verified" : letter.transcriptStatus !== "EMPTY" ? " transcript-unverified" : "";
    const extraVerifClass = letter.extraContentStatus === "VERIFIED" ? " verified" : letter.extraContentStatus !== "EMPTY" ? " unverified" : "";
    const extraSectionClass = letter.extraContentStatus === "VERIFIED" ? " transcript-verified" : letter.extraContentStatus !== "EMPTY" ? " transcript-unverified" : "";

    return {
      m,
      byline: correspondentLine(m),
      dateline: [m.date, m.location].filter(Boolean).join(" \u2014 "),
      letterTypeImages,
      carouselImages: letter.images,
      allImages: letter.images,
      hasTranscript: shouldShowPublicTranscript(letter),
      extraContentItems,
      hasExtraContent: extraContentItems.length > 0 || !!letter.extraContentTranscript,
      isPhotoRecord: shouldShowPhotoDescriptionWorkflow(letter),
      heroHook: m.hook || letter.photoDescription || undefined,
      transcriptVerifClass,
      transcriptSectionClass,
      extraVerifClass,
      extraSectionClass,
    };
  }, [letter]);

  if (loading) {
    return <div className="letter-article"><p className="letter-loading">Loading letter...</p></div>;
  }

  if (error || !letter || !derived) {
    return (
      <div className="letter-article letter-error-state">
        <SEO title="Letter Not Found" robots="noindex, nofollow" />
        <h1>{error || "Letter not found"}</h1>
        <div className="letter-error-actions">
          <button className="detail-action-btn" onClick={() => navigate("/")}>Back to Home</button>
          <button className="detail-action-btn" onClick={() => navigate("/collections")}>Browse Collections</button>
        </div>
      </div>
    );
  }

  const {
    m, byline, dateline, letterTypeImages, carouselImages, allImages,
    hasTranscript, extraContentItems, hasExtraContent,
    isPhotoRecord, heroHook,
    transcriptVerifClass, transcriptSectionClass, extraVerifClass, extraSectionClass,
  } = derived;

  const swipeActive = isSwiping || isAnimating;
  const swipeStyle: React.CSSProperties | undefined = swipeActive
    ? {
        transform: `translateX(${swipeOffset}px)`,
        transition: isSwiping ? 'none' : 'transform 0.28s cubic-bezier(0.25, 0.1, 0.25, 1)',
        willChange: 'transform',
      }
    : undefined;

  return (
    <>
      <HeaderDock transparent collectionsLink={collectionsLink}>
        {scrubberProps && <HeaderScrubber {...scrubberProps} />}
      </HeaderDock>
      <article className="letter-article" ref={swipeRef} style={swipeStyle}>
        {seo && (
          <SEO
            title={seo.title}
            description={seo.description}
            ogImage={seo.ogImage}
            imageAlt={seo.imageAlt}
            ogType={seo.ogType}
            canonicalUrl={seo.canonicalPath}
            modifiedTime={seo.modifiedTime}
            jsonLd={seo.jsonLd}
          />
        )}

        {/* ── 1. Hero ──────────────────────────────────────── */}
        <header className="letter-hero-section">
          <h1 className="sr-only">
            {m.sender && m.recipient
              ? `Letter from ${m.sender} to ${m.recipient}${m.date ? `, ${m.date}` : ""}`
              : m.sender
                ? `Letter from ${m.sender}${m.date ? `, ${m.date}` : ""}`
                : m.recipient
                  ? `Letter to ${m.recipient}${m.date ? `, ${m.date}` : ""}`
                  : dateline || "Letter"}
          </h1>
          {heroHook && (
            <div className="letter-headline-hook">
              <p>{heroHook}</p>
            </div>
          )}

          {byline && <p className="letter-byline">{byline}</p>}

          {dateline && (
            <p className="letter-dateline">{formatDateText(dateline)}</p>
          )}

          {(hasTranscript || carouselImages.length > 0) && (
            <nav className="letter-content-links" aria-label="On this page">
              {hasTranscript && <a href="#letter-transcript">Read transcript</a>}
              {carouselImages.length > 0 && <a href="#letter-scans">View original scans</a>}
            </nav>
          )}
        </header>

        {/* ── 2. Summary ───────────────────────────────────── */}
        {m.description && (
          <section className="letter-summary-section">
            <div className="letter-summary-label">About This Letter</div>
            <p className="letter-summary-text">{m.description}</p>
          </section>
        )}

        {/* ── 3. Scan Image Carousel ──────────────────────── */}
        {carouselImages.length > 0 && (
          <figure id="letter-scans" className="letter-scan-figure" tabIndex={-1}>
            <div className="scan-carousel" ref={carouselRef} data-swipe-ignore>
              {carouselImages.map((img, idx) => {
                const isLetter = img.type === "letter";
                const typeLabel = isLetter
                  ? undefined
                  : img.type.charAt(0).toUpperCase() + img.type.slice(1);
                return (
                  <div
                    key={img.id ?? idx}
                    className="scan-slide"
                    data-index={idx}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!carouselDraggedRef.current) openViewer(idx); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(idx); } }}
                    aria-label={
                      isLetter
                        ? `View page ${img.pageNumber ?? idx + 1} full size`
                        : `View ${typeLabel} full size`
                    }
                  >
                    <ProgressiveImage
                      src={getImageUrl(img.imageUrl)}
                      thumbSrc={getImageUrl(img.imageUrl, { width: 32 })}
                      midSrc={getImageUrl(img.imageUrl, { width: 800 })}
                      alt={
                        isLetter
                          ? `Page ${img.pageNumber ?? idx + 1} of letter`
                          : `${typeLabel}`
                      }
                      className="scan-slide-img"
                      imgClassName="scan-slide-img-inner"
                      objectFit="contain"
                      draggable={false}
                      loading={idx === 0 ? "eager" : "lazy"}
                      decoding="async"
                      context="carousel"
                      aspectRatio={img.width && img.height ? img.width / img.height : undefined}
                      idleUpgrade
                    />
                    {typeLabel && (
                      <span className="scan-slide-type-label">{typeLabel}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {carouselImages.length > 1 && (
              <div className="scan-dots">
                {carouselImages.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`scan-dot${i === 0 ? " active" : ""}`}
                    onClick={() => scrollToSlide(i)}
                    aria-label={`Go to page ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </figure>
        )}

        {/* ── 4. Transcript ────────────────────────────────── */}
        {hasTranscript && (
          <section id="letter-transcript" tabIndex={-1} className={`letter-transcript-section${transcriptSectionClass}${transcriptMode === "original" ? " transcript-original-mode" : ""}`} ref={transcriptSectionRef}>
            <div className="transcript-header-row">
              <div className="transcript-label">Transcript</div>
              {letter.transcriptStatus === "VERIFIED" ? (
                <span className="transcript-status verified">Verified</span>
              ) : letter.transcriptStatus !== "EMPTY" ? (
                <span className="transcript-status unverified">Unverified</span>
              ) : null}
              <button
                type="button"
                className="transcript-mode-toggle"
                onClick={() => setTranscriptMode((m) => m === "reading" ? "original" : "reading")}
                title={transcriptMode === "reading" ? "Show original line breaks" : "Show reading view"}
              >
                {transcriptMode === "reading" ? "Original formatting" : "Reading view"}
              </button>
            </div>

            {transcriptMode === "reading" && letter.readingText ? (
              /* ── Saved reading text — render exactly as admin set it ── */
              <div className="transcript-pages-combined">
                <div className="transcript-page-region">
                  <div className="transcript-page-body">
                    {letterTypeImages.length > 0 && letterTypeImages.map((pageImage, idx) => {
                      const side = idx % 2 === 0 ? "left" : "right";
                      return (
                        <button
                          key={pageImage.id}
                          type="button"
                          className={`page-thumb page-thumb-${side}${transcriptVerifClass}`}
                          onClick={() => openViewer(Math.max(0, allImages.indexOf(pageImage)))}
                          aria-label={`View page ${pageImage.pageNumber ?? idx + 1}`}
                          style={idx > 0 ? { top: `${idx * 14}rem` } : undefined}
                        >
                          <span className="page-thumb-inner">
                            <img
                              src={getImageUrl(pageImage.imageUrl, { width: 300 })}
                              alt={`Page ${pageImage.pageNumber ?? idx + 1}`}
                              className="page-thumb-img"
                              loading="lazy"
                            />
                            <span className="page-thumb-label">Page {pageImage.pageNumber ?? idx + 1}</span>
                          </span>
                        </button>
                      );
                    })}
                    <div className={`transcript-text transcript-reading-saved${shortLineClass}`}>
                      {letter.readingText}
                    </div>
                  </div>
                </div>
              </div>
            ) : letter.transcript.pages.length > 0 ? (
              transcriptMode === "reading" && readingSegments ? (
                /* ── Combined reading view — seamless across pages ── */
                <div className="transcript-pages-combined">
                  {readingSegments.map((segment, idx) => {
                    const pageImage = letterTypeImages.find((img) => img.pageNumber === segment.pageNumber);
                    const side = segment.pageIndex % 2 === 0 ? "left" : "right";
                    return (
                      <div key={segment.pageNumber} className="transcript-page-region">
                        {idx > 0 && <div className="page-boundary-mark" />}
                        <div className="transcript-page-body">
                          {pageImage && (
                            <button
                              type="button"
                              className={`page-thumb page-thumb-${side}${transcriptVerifClass}`}
                              onClick={() => openViewer(Math.max(0, allImages.indexOf(pageImage)))}
                              aria-label={`View page ${segment.pageNumber}`}
                            >
                              <span className="page-thumb-inner">
                                <img
                                  src={getImageUrl(pageImage.imageUrl, { width: 300 })}
                                  alt={`Page ${segment.pageNumber}`}
                                  className="page-thumb-img"
                                  loading="lazy"
                                />
                                <span className="page-thumb-label">Page {segment.pageNumber}</span>
                              </span>
                            </button>
                          )}
                          <div className={`transcript-text${shortLineClass}`}>
                            {renderTranscriptLines(segment.text, referenceWidth)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ── Original view OR single-page reading view ── */
                transcriptMode === "original" ? (
                  /* ── Original split layout: image + transcript side by side ── */
                  <div className="original-split-pages">
                    {letter.transcript.pages.map((page, idx) => {
                      const pageImage = letterTypeImages.find((img) => img.pageNumber === page.pageNumber);
                      return (
                        <div key={page.pageNumber} className="original-split-row" data-page={page.pageNumber}>
                          {pageImage && (
                            <button
                              type="button"
                              className="original-split-image"
                              onClick={() => openViewer(Math.max(0, allImages.indexOf(pageImage)))}
                              aria-label={`View page ${page.pageNumber} full size`}
                            >
                              <ProgressiveImage
                                src={getImageUrl(pageImage.imageUrl)}
                                thumbSrc={getImageUrl(pageImage.imageUrl, { width: 32 })}
                                midSrc={getImageUrl(pageImage.imageUrl, { width: 600 })}
                                alt={`Page ${page.pageNumber}`}
                                className="original-split-img-wrap"
                                imgClassName="original-split-img"
                                objectFit="contain"
                                loading={idx === 0 ? "eager" : "lazy"}
                                decoding="async"
                                context="carousel"
                                aspectRatio={pageImage.width && pageImage.height ? pageImage.width / pageImage.height : undefined}
                              />
                              {letter.transcript.pages.length > 1 && (
                                <span className="original-split-page-label">Page {page.pageNumber}</span>
                              )}
                            </button>
                          )}
                          <div className="original-split-text">
                            {letter.transcript.pages.length > 1 && !pageImage && (
                              <div className="page-marker">Page {page.pageNumber}</div>
                            )}
                            <pre className={`transcript-text transcript-original${shortLineClass}`}>{page.text}</pre>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <div className="transcript-pages">
                  {letter.transcript.pages.map((page, idx) => {
                    const pageImage = letterTypeImages.find((img) => img.pageNumber === page.pageNumber);
                    const side = idx % 2 === 0 ? "left" : "right";
                    return (
                      <div key={page.pageNumber} className="transcript-page" data-page={page.pageNumber}>
                        {pageImage && (
                          <button
                            type="button"
                            className={`page-thumb page-thumb-${side}${transcriptVerifClass}`}
                            onClick={() => openViewer(Math.max(0, allImages.indexOf(pageImage)))}
                            aria-label={`View page ${page.pageNumber}`}
                          >
                            <span className="page-thumb-inner">
                              <img
                                src={getImageUrl(pageImage.imageUrl, { width: 300 })}
                                alt={`Page ${page.pageNumber}`}
                                className="page-thumb-img"
                                loading="lazy"
                              />
                              <span className="page-thumb-label">Page {page.pageNumber}</span>
                            </span>
                          </button>
                        )}
                        {letter.transcript.pages.length > 1 && (
                          <div className="page-marker">Page {page.pageNumber}</div>
                        )}
                        <div className={`transcript-text${shortLineClass}`}>
                          {renderTranscriptLines(reflowTranscript(page.text), referenceWidth)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : transcriptMode === "original" ? (
              <pre className={`transcript-text transcript-original${shortLineClass}`}>
                {letter.transcript.fullText}
              </pre>
            ) : (
              <div className={`transcript-text${shortLineClass}`}>
                {renderTranscriptLines(reflowTranscript(letter.transcript.fullText), referenceWidth)}
              </div>
            )}
          </section>
        )}

        {/* ── 5. Photo Description / Extra Content ─────────── */}
        {isPhotoRecord && letter.photoDescription && m.hook && (
          <section className="letter-supporting-section">
            <div className="supporting-label">Photo Description</div>
            <p className="supporting-text">{letter.photoDescription}</p>
          </section>
        )}

        {hasExtraContent && extraContentItems.length > 0 ? (
          extraContentItems.map((item, idx) => {
            const itemImage = item.imageIds.length > 0
              ? allImages.find((img) => item.imageIds.includes(img.id))
              : null;
            // Continue alternating sides from where the transcript left off
            const thumbIdx = letter.transcript.pages.length + idx;
            const side = thumbIdx % 2 === 0 ? "left" : "right";
            return (
              <Fragment key={`extra-${idx}`}>
                {(hasTranscript || idx > 0) && (
                  <div className="content-type-divider">
                    <div className="divider-rule" />
                    <span className="divider-type-label">{item.label}</span>
                    <div className="divider-rule" />
                  </div>
                )}
                <section className={`letter-supporting-section supporting-with-thumb${extraSectionClass}`}>
                  {itemImage && (
                    <button
                      type="button"
                      className={`page-thumb page-thumb-${side}${extraVerifClass}`}
                      onClick={() => openViewer(Math.max(0, allImages.indexOf(itemImage)))}
                      aria-label={`View ${item.label.toLowerCase()}`}
                    >
                      <span className="page-thumb-inner">
                        <img
                          src={getImageUrl(itemImage.imageUrl, { width: 300 })}
                          alt={item.label}
                          className="page-thumb-img"
                          loading="lazy"
                        />
                      </span>
                    </button>
                  )}
                  <div className="supporting-header-row">
                    <div className="supporting-label">{item.label}</div>
                    {idx === 0 && letter.extraContentStatus === "VERIFIED" && (
                      <span className="transcript-status verified">Verified</span>
                    )}
                    {idx === 0 && letter.extraContentStatus !== "VERIFIED" && letter.extraContentStatus !== "EMPTY" && (
                      <span className="transcript-status unverified">Unverified</span>
                    )}
                  </div>
                  <p className="supporting-text">{item.transcript}</p>
                </section>
              </Fragment>
            );
          })
        ) : hasExtraContent && letter.extraContentTranscript ? (() => {
          const extraImages = allImages.filter((img) => EXTRA_CONTENT_TYPES.includes(img.type));
          const fallbackLabel = getExtraContentLabel(letter.images);
          const fallbackSide = letter.transcript.pages.length % 2 === 0 ? "left" : "right";
          return (
            <>
              {hasTranscript && (
                <div className="content-type-divider">
                  <div className="divider-rule" />
                  <span className="divider-type-label">{fallbackLabel}</span>
                  <div className="divider-rule" />
                </div>
              )}
              <section className={`letter-supporting-section supporting-with-thumb${extraSectionClass}`}>
                {extraImages[0] && (
                  <button
                    type="button"
                    className={`page-thumb page-thumb-${fallbackSide}${extraVerifClass}`}
                    onClick={() => openViewer(Math.max(0, allImages.indexOf(extraImages[0])))}
                    aria-label={`View ${fallbackLabel.toLowerCase()}`}
                  >
                    <span className="page-thumb-inner">
                      <img
                        src={getImageUrl(extraImages[0].imageUrl, { width: 300 })}
                        alt={fallbackLabel}
                        className="page-thumb-img"
                        loading="lazy"
                      />
                    </span>
                  </button>
                )}
                <div className="supporting-header-row">
                  <div className="supporting-label">{fallbackLabel}</div>
                  {letter.extraContentStatus === "VERIFIED" ? (
                    <span className="transcript-status verified">Verified</span>
                  ) : letter.extraContentStatus !== "EMPTY" ? (
                    <span className="transcript-status unverified">Unverified</span>
                  ) : null}
                </div>
                <p className="supporting-text">{letter.extraContentTranscript}</p>
              </section>
            </>
          );
        })() : null}

        {/* ── 6. Collection Footer Nav ───────────────────────── */}
        {adjacent && adjacent.total > 1 && (
          <nav className="letter-nav-section">
            {adjacent.position != null && (
              <div className="nav-position-label">
                Letter {adjacent.position} of {adjacent.total}
              </div>
            )}

            {(adjacent.prev || adjacent.next) && (
              <div className="adjacent-teasers">
                {adjacent.prev ? (
                  <Link to={`/letter/${adjacent.prev.id}`} className={`teaser-card${adjacent.prevWraps ? " teaser-wraps" : ""}`}>
                    <span className="teaser-direction">
                      {adjacent.prevWraps ? "\u2190 Last in Collection" : "\u2190 Previous"}
                    </span>
                    <div className="teaser-body">
                      {adjacent.prev.date && <span className="teaser-date">{adjacent.prev.date}</span>}
                      {(adjacent.prev.sender || adjacent.prev.recipient) && (
                        <span className="teaser-people">
                          {[adjacent.prev.sender, adjacent.prev.recipient].filter(Boolean).join(" \u2192 ")}
                        </span>
                      )}
                      {adjacent.prev.hook ? (
                        <p className="teaser-hook">{adjacent.prev.hook}</p>
                      ) : adjacent.prev.contentLabels && (
                        <span className="teaser-content-labels">
                          {adjacent.prev.contentLabels.join(" \u00B7 ")}
                        </span>
                      )}
                    </div>
                  </Link>
                ) : <div className="teaser-placeholder" />}
                {adjacent.next ? (
                  <Link to={`/letter/${adjacent.next.id}`} className={`teaser-card teaser-next${adjacent.nextWraps ? " teaser-wraps" : ""}`}>
                    <span className="teaser-direction">
                      {adjacent.nextWraps ? "First in Collection \u2192" : "Next \u2192"}
                    </span>
                    <div className="teaser-body">
                      {adjacent.next.date && <span className="teaser-date">{adjacent.next.date}</span>}
                      {(adjacent.next.sender || adjacent.next.recipient) && (
                        <span className="teaser-people">
                          {[adjacent.next.sender, adjacent.next.recipient].filter(Boolean).join(" \u2192 ")}
                        </span>
                      )}
                      {adjacent.next.hook ? (
                        <p className="teaser-hook">{adjacent.next.hook}</p>
                      ) : adjacent.next.contentLabels && (
                        <span className="teaser-content-labels">
                          {adjacent.next.contentLabels.join(" \u00B7 ")}
                        </span>
                      )}
                    </div>
                  </Link>
                ) : <div className="teaser-placeholder" />}
              </div>
            )}
          </nav>
        )}

      </article>

      {/* ── Image Viewer Modal ─────────────────────────────── */}
      {viewerOpen && createPortal(
        // Portaled to document.body so the backdrop escapes #app-scroll's
        // stacking context and reliably covers the fixed header (#40).
        <div
          className="viewer-backdrop"
          onMouseDown={(e) => {
            // Only close if mousedown started directly on the backdrop (not on viewer content)
            if (e.target === e.currentTarget) {
              (e.currentTarget as HTMLElement).dataset.backdropMousedown = "1";
            }
          }}
          onMouseUp={(e) => {
            const el = e.currentTarget as HTMLElement;
            if (el.dataset.backdropMousedown === "1" && e.target === e.currentTarget) {
              setViewerOpen(false);
            }
            delete el.dataset.backdropMousedown;
          }}
        >
          <div className="viewer-modal">
            <button
              type="button"
              className="viewer-close"
              onClick={() => setViewerOpen(false)}
              aria-label="Close viewer"
            >
              &times;
            </button>
            <LetterViewer
              key={viewerStartPage}
              images={allImages}
              letterId={letter.id}
              showOnlyLetterPages={false}
              variant="lightbox"
              initialIndex={viewerStartPage}
            />
          </div>
        </div>,
        document.body,
      )}
      <BackToTop />
    </>
  );
}
