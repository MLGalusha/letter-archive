import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
import { useHeaderDock, EMPTY_DOCK } from "../contexts/HeaderDockContext";
import LetterHeaderDock from "../components/LetterHeaderDock/LetterHeaderDock";
import "./LetterDetailPage.css";

/* ── helpers ─────────────────────────────────────────────── */

function correspondentLine(m: Letter["metadata"]): string {
  if (m.sender && m.recipient) return `Written by ${m.sender} to ${m.recipient}`;
  if (m.sender) return `Written by ${m.sender}`;
  if (m.recipient) return `Written to ${m.recipient}`;
  return "";
}


/**
 * Smart reflow: only join lines that were broken by the typewriter margin.
 * Preserves all formatting — indentation, right-aligned text, short standalone
 * lines (dates, greetings, closings), blank paragraph breaks, and intentional
 * multi-space gaps within lines.
 *
 * A line is treated as a "continuation" (and joined to the previous) only when:
 *   1. It has NO leading whitespace
 *   2. The previous original line was long enough to suggest a margin break
 *   3. The previous line was not blank
 *
 * The margin threshold adapts to each text's actual line lengths — narrower
 * typewriter margins (e.g. ~50 chars) are detected and handled correctly.
 */
function reflowTranscript(text: string): string {
  const lines = text.split("\n");

  // Derive margin width from the text: the max trimmed-content length
  // of lines that look like body text (> 20 chars, not just dates/headers)
  const bodyLengths = lines
    .map((l) => l.trim().length)
    .filter((len) => len > 20);
  const maxBodyLen = bodyLengths.length > 0 ? Math.max(...bodyLengths) : 78;
  // Threshold = 70% of the detected margin width (min 30 to avoid over-joining)
  const MARGIN_THRESHOLD = Math.max(30, Math.round(maxBodyLen * 0.7));

  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line → preserve as paragraph break
    if (line.trim() === "") {
      result.push("");
      continue;
    }

    const leadingWS = line.match(/^(\s*)/)?.[1].length ?? 0;
    const prev = i > 0 ? lines[i - 1] : "";
    // Use trimmed content length — right-aligned text like
    // "                        Sept 23rd" is short content, not a margin break
    const prevContentLen = prev.trim().length;

    const isContinuation =
      leadingWS === 0 &&
      prevContentLen >= MARGIN_THRESHOLD &&
      prevContentLen > 0 &&
      result.length > 0;

    if (isContinuation) {
      result[result.length - 1] += " " + line.trimEnd();
    } else {
      result.push(line.trimEnd());
    }
  }

  return result.join("\n");
}

/**
 * Determine the "virtual page width" in characters — the max line length
 * in the original monospace text. Used to convert space-based positioning
 * (from the monospace admin editor) into percentage-based CSS indentation
 * that works with any font.
 */
function computeReferenceWidth(text: string): number {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 78; // fallback to standard typewriter width
  return Math.max(...lines.map((l) => l.length));
}

/**
 * Render transcript text with proportional CSS-based positioning.
 *
 * Short positioned lines (dates, closings, signatures) preserve their
 * RIGHT-EDGE position from the monospace original using text-align: right
 * with proportional right padding. This matches the visual position in the
 * admin editor regardless of font.
 *
 * Paragraph text preserves its left-edge indent using text-indent.
 */
function renderTranscriptLines(
  text: string,
  referenceWidth: number,
): JSX.Element[] {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  const MIN_SPACES = 3;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") {
      elements.push(<div key={i} className="transcript-blank" />);
      continue;
    }

    const leadingSpaces = line.match(/^( *)/)?.[1].length ?? 0;

    if (leadingSpaces >= MIN_SPACES && referenceWidth > 0) {
      const content = line.trimStart();
      const contentLen = content.length;

      // Short positioned line (date, closing, signature):
      // content fills < 60% of the reference width → preserve RIGHT edge
      const isShortPositioned = contentLen < referenceWidth * 0.6;

      if (isShortPositioned) {
        // Preserve left-edge indent to match original spacing position
        const indentPct = Math.min(
          (leadingSpaces / referenceWidth) * 100,
          90,
        );
        elements.push(
          <div
            key={i}
            className="transcript-line transcript-line-positioned"
            style={{ paddingLeft: `${indentPct}%` }}
          >
            {content}
          </div>,
        );
      } else {
        // Paragraph text: preserve left-edge indent
        const indentPct = Math.min(
          (leadingSpaces / referenceWidth) * 100,
          90,
        );
        elements.push(
          <div
            key={i}
            className="transcript-line"
            style={{ textIndent: `${indentPct}%` }}
          >
            {content}
          </div>,
        );
      }
    } else {
      elements.push(
        <div key={i} className="transcript-line">
          {line}
        </div>,
      );
    }
  }

  return elements;
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

/* ── parallax helpers ─────────────────────────────────────── */

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
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

/* ── component ───────────────────────────────────────────── */

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentLettersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Image viewer modal
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStartPage, setViewerStartPage] = useState(0);

  // Scan carousel
  const [scanPage, setScanPage] = useState(0);

  // Transcript view mode: "reading" (reflowed) or "original" (1:1 line match)
  const [transcriptMode, setTranscriptMode] = useState<"reading" | "original">("reading");

  // Header dock integration
  const { setDock } = useHeaderDock();

  useEffect(() => { setScanPage(0); }, [letterId]);

  useEffect(() => {
    if (!letterId) { setLoading(false); return; }
    const controller = new AbortController();
    async function fetchLetter() {
      setLoading(true);
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
  }, [letterId]);

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

  // Set header dock content when adjacent data loads.
  // Use a ref for letterId so the effect only fires when adjacent changes
  // (not on every rapid navigation before the fetch completes).
  const letterIdRef = useRef(letterId);
  letterIdRef.current = letterId;

  useEffect(() => {
    if (!adjacent || adjacent.total <= 1) return;
    setDock({
      content: <LetterHeaderDock adjacent={adjacent} letterId={letterIdRef.current!} />,
      active: true,
      visible: true,
      scrollReveal: true,
    });
  }, [adjacent, setDock]);

  // Clear dock on unmount
  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

  const transcriptSectionRef = useRef<HTMLElement>(null);

  // Scroll-driven parallax + zigzag for side thumbnails (desktop only)
  useEffect(() => {
    if (!letter || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 769px)");
    if (!mq.matches) return;

    let rafId: number | null = null;

    const tick = () => {
      rafId = null;
      // Measure header so thumbs never sit behind it
      const headerEl = document.querySelector<HTMLElement>(".header");
      const headerBottom = headerEl
        ? headerEl.getBoundingClientRect().bottom
        : 0;
      const STICKY_TOP = headerBottom + 16; // 16px breathing room below header

      const viewportH = window.innerHeight;
      const viewportCenter = viewportH / 2;

      const thumbs = document.querySelectorAll<HTMLElement>(".page-thumb");
      thumbs.forEach((thumb) => {
        const section = thumb.parentElement;
        if (!section) return;

        const sr = section.getBoundingClientRect();
        const thumbH = thumb.offsetHeight;
        const naturalTop = 8; // initial CSS top ~0.5rem
        const maxTravel = sr.height - thumbH - naturalTop - 16;
        if (maxTravel <= 0) { thumb.style.transform = ""; return; }

        // Target: center of viewport, but stay below header, stay in section
        const idealY = viewportCenter - thumbH / 2 - sr.top - naturalTop;
        const minFromHeader = Math.max(0, STICKY_TOP - sr.top - naturalTop);
        const y = Math.min(Math.max(idealY, minFromHeader), maxTravel);

        // Progress through section (0→1) for zigzag
        const progress = maxTravel > 0 ? y / maxTravel : 0;

        // Zigzag S-curve
        const amp = Math.min(18, Math.max(8, sr.height * 0.012));
        const x = Math.sin(progress * Math.PI * 2) * amp;

        thumb.style.transform = `translate(${x}px, ${y}px)`;
      });
    };

    const onScroll = () => { if (rafId == null) rafId = requestAnimationFrame(tick); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const onMq = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        document.querySelectorAll<HTMLElement>(".page-thumb").forEach((t) => { t.style.transform = ""; });
      }
    };
    mq.addEventListener("change", onMq);

    return () => {
      window.removeEventListener("scroll", onScroll);
      mq.removeEventListener("change", onMq);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [letter]);

  // Reference width for proportional spacing: max line length in the original text
  const referenceWidth = useMemo(() => {
    if (!letter?.transcript?.fullText && !letter?.transcript?.pages?.length) return 78;
    const rawText = letter.transcript.fullText
      || letter.transcript.pages.map((p) => p.text).join("\n");
    return computeReferenceWidth(rawText);
  }, [letter]);

  const seo = useMemo(() => (letter ? buildLetterSeo(letter) : null), [letter]);


  const openViewer = useCallback((pageIndex: number) => {
    setViewerStartPage(pageIndex);
    setViewerOpen(true);
  }, []);

  if (loading) {
    return <div className="letter-article"><p className="letter-loading">Loading letter...</p></div>;
  }

  if (error || !letter) {
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

  const m = letter.metadata;
  const byline = correspondentLine(m);
  const dateline = [m.date, m.location].filter(Boolean).join(" \u2014 ");

  const letterTypeImages = letter.images.filter((img) => img.type === "letter");
  // Primary scan images: letter pages if available, otherwise all images (photos, covers, etc.)
  const primaryImages = letterTypeImages.length > 0 ? letterTypeImages : letter.images;
  const extraContentImages = letter.images.filter((img) => EXTRA_CONTENT_TYPES.includes(img.type));
  const extraContentImage = letterTypeImages.length > 0 ? (extraContentImages[0] ?? null) : null;
  const extraContentLabel = getExtraContentLabel(letter.images);
  const allImages = letter.images;
  const currentScanImage = primaryImages[scanPage] || primaryImages[0];
  const hasTranscript = shouldShowPublicTranscript(letter);
  const hasExtraContent = !!letter.extraContentTranscript;
  const uniquePersons = dedupePersons(letter.linkedPersons);
  const hasEntities = uniquePersons.length > 0 || (letter.linkedPlaces && letter.linkedPlaces.length > 0);

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
          {m.hook && (
            <div className="letter-headline-hook">
              <p>{m.hook}</p>
            </div>
          )}

          {byline && <p className="letter-byline">{byline}</p>}

          {dateline && (
            <p className="letter-dateline">
              {dateline}
              {m.dateConfidence && m.dateConfidence !== "exact" && (
                <span className="date-approx"> (approximate)</span>
              )}
            </p>
          )}

        </header>

        {/* ── 2. Summary ───────────────────────────────────── */}
        {m.description && (
          <section className="letter-summary-section">
            <div className="letter-summary-label">About This Letter</div>
            <p className="letter-summary-text">{m.description}</p>
          </section>
        )}

        {/* ── 3. Scan Image ────────────────────────────────── */}
        {primaryImages.length > 0 && (
          <figure className="letter-scan-figure">
            <button
              type="button"
              className="letter-scan-btn"
              onClick={() => openViewer(scanPage)}
              aria-label="View full size"
            >
              <img
                src={getImageUrl(currentScanImage.imageUrl, { width: 1200 })}
                alt={`Page ${(currentScanImage.pageNumber ?? 1)} of letter`}
                className="letter-scan-img"
              />
              <span className="letter-scan-zoom-hint">Click to zoom &amp; pan</span>
            </button>

            {primaryImages.length > 1 && (
              <div className="scan-page-nav">
                <button
                  type="button"
                  className="scan-nav-arrow"
                  disabled={scanPage === 0}
                  onClick={() => setScanPage((p) => p - 1)}
                  aria-label="Previous page"
                >&#8592;</button>
                <span className="scan-page-label">
                  Page {scanPage + 1} of {primaryImages.length}
                </span>
                <button
                  type="button"
                  className="scan-nav-arrow"
                  disabled={scanPage === primaryImages.length - 1}
                  onClick={() => setScanPage((p) => p + 1)}
                  aria-label="Next page"
                >&#8594;</button>
              </div>
            )}
          </figure>
        )}

        {/* ── 4. Transcript ────────────────────────────────── */}
        {hasTranscript && (
          <section className="letter-transcript-section" ref={transcriptSectionRef}>
            <div className="transcript-header-row">
              <div className="transcript-label">Transcript</div>
              {letter.transcript.verified && (
                <span className="verified-pill">Verified</span>
              )}
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
              <div className="transcript-pages">
                {letter.transcript.pages.map((page, idx) => {
                  const pageImage = primaryImages.find((img) => img.pageNumber === page.pageNumber);
                  const side = idx % 2 === 0 ? "left" : "right";
                  const isOriginal = transcriptMode === "original";

                  return (
                    <div key={page.pageNumber} className="transcript-page" data-page={page.pageNumber}>
                      {/* Floating side thumbnail — alternates left/right */}
                      {pageImage && letter.transcript.pages.length > 1 && (
                        <button
                          type="button"
                          className={`page-thumb page-thumb-${side}`}
                          onClick={() => openViewer(primaryImages.indexOf(pageImage))}
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
                        <pre className="transcript-text transcript-original">{page.text}</pre>
                      ) : (
                        <div className="transcript-text">
                          {renderTranscriptLines(reflowTranscript(page.text), referenceWidth)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : transcriptMode === "original" ? (
              <pre className="transcript-text transcript-original">
                {letter.transcript.fullText}
              </pre>
            ) : (
              <div className="transcript-text">
                {renderTranscriptLines(reflowTranscript(letter.transcript.fullText), referenceWidth)}
              </div>
            )}
          </section>
        )}

        {/* ── 5. Photo Description / Extra Content ─────────── */}
        {shouldShowPhotoDescriptionWorkflow(letter) && letter.photoDescription && (
          <section className="letter-supporting-section">
            <div className="supporting-label">Photo Description</div>
            <p className="supporting-text">{letter.photoDescription}</p>
          </section>
        )}

        {hasExtraContent && (
          <>
            {hasTranscript && (
              <div className="content-type-divider">
                <div className="divider-rule" />
                <span className="divider-type-label">{extraContentLabel}</span>
                <div className="divider-rule" />
              </div>
            )}
            <section className="letter-supporting-section supporting-with-thumb">
              {extraContentImage && (
                <button
                  type="button"
                  className="page-thumb page-thumb-left"
                  onClick={() => openViewer(allImages.indexOf(extraContentImage))}
                  aria-label={`View ${extraContentLabel.toLowerCase()}`}
                >
                  <span className="page-thumb-inner">
                    <img
                      src={getImageUrl(extraContentImage.imageUrl, { width: 300 })}
                      alt={extraContentLabel}
                      className="page-thumb-img"
                      loading="lazy"
                    />
                  </span>
                </button>
              )}
              <div className="supporting-label">{extraContentLabel}</div>
              <p className="supporting-text">{letter.extraContentTranscript}</p>
            </section>
          </>
        )}

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

      </article>

      {/* ── Image Viewer Modal ─────────────────────────────── */}
      {viewerOpen && (
        <div className="viewer-backdrop" onClick={() => setViewerOpen(false)}>
          <div className="viewer-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="viewer-close"
              onClick={() => setViewerOpen(false)}
              aria-label="Close viewer"
            >
              &times;
            </button>
            <LetterViewer
              images={allImages}
              letterId={letter.id}
              showOnlyLetterPages={false}
            />
          </div>
        </div>
      )}
    </>
  );
}
