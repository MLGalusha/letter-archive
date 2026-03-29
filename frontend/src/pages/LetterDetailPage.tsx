import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import SEO from "../components/SEO";

import LetterViewer from "../components/LetterViewer/LetterViewer";
import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { Letter, LetterImage, LetterImageType } from "../types/Letter";
import { getImageUrl } from "../api/client";
import { buildLetterSeo } from "../utils/seo";
import {
  shouldShowPublicTranscript,
  shouldShowPhotoDescriptionWorkflow,
} from "../utils/letterContent";
import { reflowTranscript, renderTranscriptLines, computeReferenceWidth } from "../utils/transcriptRendering";
import { useHeaderDock, EMPTY_DOCK } from "../contexts/HeaderDockContext";
import HeaderScrubber from "../components/HeaderScrubber/HeaderScrubber";
import useLetterScrubber from "../components/LetterHeaderDock/useLetterScrubber";
import useCarouselDrag from "../hooks/useCarouselDrag";
import useThumbParallax from "../hooks/useThumbParallax";
import BackToTop from "../components/BackToTop";
import "./LetterDetailPage.css";

/* ── helpers ─────────────────────────────────────────────── */

function correspondentLine(m: Letter["metadata"]): string {
  if (m.sender && m.recipient) return `Written by ${m.sender} to ${m.recipient}`;
  if (m.sender) return `Written by ${m.sender}`;
  if (m.recipient) return `Written to ${m.recipient}`;
  return "";
}


function dedupePersons(persons: Letter["linkedPersons"]) {
  if (!persons?.length) return [];
  const map = new Map<string, (typeof persons)[number]>();
  const pri: Record<string, number> = { sender: 3, recipient: 2, mentioned: 1 };
  for (const p of persons) {
    const ex = map.get(p.personId);
    if (!ex || (pri[p.role] ?? 0) > (pri[ex.role] ?? 0)) map.set(p.personId, p);
  }
  return [...map.values()];
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
  const [letter, setLetter] = useState<Letter | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentLettersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Image viewer modal
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStartPage, setViewerStartPage] = useState(0);

  // Scan carousel (extracted hook)
  const { carouselRef, carouselDraggedRef, scrollToSlide } = useCarouselDrag();

  // Transcript view mode: "reading" (reflowed) or "original" (1:1 line match)
  const [transcriptMode, setTranscriptMode] = useState<"reading" | "original">("reading");

  // Header dock integration
  const { setDock } = useHeaderDock();

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
    if (!fromHighlightRef.current) window.scrollTo(0, 0);
  }, [letterId]);

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

      window.scrollTo(0, 0);

      requestAnimationFrame(() => {
        const distance = scrollTarget;
        if (distance < 2) return;

        const duration = Math.min(1000, Math.max(600, distance * 0.5));
        const startTime = performance.now();

        function animate(now: number) {
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / duration);
          const ease = 1 - Math.pow(1 - t, 3);
          window.scrollTo(0, distance * ease);
          if (t < 1) requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [letter]);

  useEffect(() => {
    if (!letterId) { setLoading(false); return; }
    const controller = new AbortController();
    const isFirstLoad = !letter;
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
          setLetter(data);
          setAdjacent(adj);
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

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!adjacent) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && adjacent.prev) navigate(`/letter/${adjacent.prev.id}`);
      if (e.key === "ArrowRight" && adjacent.next) navigate(`/letter/${adjacent.next.id}`);
      if (e.key === "Escape" && viewerOpen) setViewerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjacent, navigate, viewerOpen]);

  // Build scrubber props from adjacent data (hook must be at top level)
  const scrubberProps = useLetterScrubber(adjacent, letterId);

  useEffect(() => {
    const collectionsLink = adjacent ? {
      label: 'Collection',
      to: `/collections/${adjacent.collectionCode}`,
    } : undefined;

    if (scrubberProps) {
      setDock({
        content: <HeaderScrubber {...scrubberProps} />,
        active: true,
        visible: true,
        scrollReveal: true,
        showTitle: true,
        collectionsLink,
      });
    } else {
      setDock({
        content: null,
        active: false,
        visible: false,
        scrollReveal: true,
        showTitle: true,
        collectionsLink,
      });
    }
  }, [scrubberProps, adjacent, setDock]);

  // Clear dock on unmount
  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

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

  // Lock body scroll while viewer is open
  useEffect(() => {
    if (viewerOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.overflow = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [viewerOpen]);

  // Memoize all derived values — must be before conditional returns (Rules of Hooks)
  const derived = useMemo(() => {
    if (!letter) return null;
    const m = letter.metadata;
    const letterTypeImages = letter.images.filter((img) => img.type === "letter");
    const extraContentItems = letter.extraContentItems ?? [];
    const uniquePersons = dedupePersons(letter.linkedPersons);
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
      uniquePersons,
      hasEntities: uniquePersons.length > 0 || (letter.linkedPlaces && letter.linkedPlaces.length > 0),
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
    hasTranscript, extraContentItems, hasExtraContent, uniquePersons,
    hasEntities, isPhotoRecord, heroHook,
    transcriptVerifClass, transcriptSectionClass, extraVerifClass, extraSectionClass,
  } = derived;

  return (
    <>
      <article className="letter-article">
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
          {heroHook && (
            <div className="letter-headline-hook">
              <p>{heroHook}</p>
            </div>
          )}

          {byline && <p className="letter-byline">{byline}</p>}

          {dateline && (
            <p className="letter-dateline">{formatDateText(dateline)}</p>
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
          <figure className="letter-scan-figure">
            <div className="scan-carousel" ref={carouselRef}>
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
                    <img
                      src={getImageUrl(img.imageUrl, { width: 1200 })}
                      alt={
                        isLetter
                          ? `Page ${img.pageNumber ?? idx + 1} of letter`
                          : `${typeLabel}`
                      }
                      className="scan-slide-img"
                      draggable={false}
                      loading={idx === 0 ? "eager" : "lazy"}
                      decoding="async"
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
          <section className={`letter-transcript-section${transcriptSectionClass}`} ref={transcriptSectionRef}>
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

            {letter.transcript.pages.length > 0 ? (
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
                <div className="transcript-pages">
                  {letter.transcript.pages.map((page, idx) => {
                    const pageImage = letterTypeImages.find((img) => img.pageNumber === page.pageNumber);
                    const side = idx % 2 === 0 ? "left" : "right";
                    const isOriginal = transcriptMode === "original";
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
                        {isOriginal ? (
                          <pre className={`transcript-text transcript-original${shortLineClass}`}>{page.text}</pre>
                        ) : (
                          <div className={`transcript-text${shortLineClass}`}>
                            {renderTranscriptLines(reflowTranscript(page.text), referenceWidth)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
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

        {/* ── 6. People & Places ───────────────────────────── */}
        {hasEntities && (
          <section className="letter-entities-section">
            <div className="entities-label">People &amp; Places</div>
            <div className="entity-chips">
              {uniquePersons.map((p) => (
                <Link key={`${p.personId}-${p.role}`} to={`/people/${p.personId}`} className="entity-chip">
                  <span className="chip-name">{p.canonicalName}</span>
                  <span className={`chip-role role-${p.role}`}>{p.role}</span>
                </Link>
              ))}
              {letter.linkedPlaces?.map((pl) => (
                <Link key={`${pl.placeId}-${pl.role}`} to={`/places/${pl.placeId}`} className="entity-chip">
                  <span className="chip-name">{pl.canonicalName}</span>
                  <span className={`chip-role role-${pl.role}`}>
                    {pl.role === "written_from" ? "from" : pl.role}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── 7. Collection Footer Nav ───────────────────────── */}
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
      {viewerOpen && (
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
        </div>
      )}
      <BackToTop />
    </>
  );
}
