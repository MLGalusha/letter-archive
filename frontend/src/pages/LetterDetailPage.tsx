import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import SEO from "../components/SEO";
import Breadcrumb from "../components/Breadcrumb/Breadcrumb";
import LetterViewer from "../components/LetterViewer/LetterViewer";
import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { Letter, LetterImage } from "../types/Letter";
import { getImageUrl } from "../api/client";
import { buildLetterSeo } from "../utils/seo";
import {
  shouldShowPublicTranscript,
  shouldShowPhotoDescriptionWorkflow,
} from "../utils/letterContent";
import {
  EMOTIONAL_TONE_OPTIONS,
  METADATA_RELATIONSHIP_OPTIONS,
} from "../constants/enums";
import "./LetterDetailPage.css";

const FILMSTRIP_DOT_LIMIT = 30;

/* ── helpers ─────────────────────────────────────────────── */

function correspondentLine(m: Letter["metadata"]): string {
  if (m.sender && m.recipient) return `Written by ${m.sender} to ${m.recipient}`;
  if (m.sender) return `Written by ${m.sender}`;
  if (m.recipient) return `Written to ${m.recipient}`;
  return "";
}

function toneLabel(v: string) {
  return EMOTIONAL_TONE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function relLabel(v: string) {
  return METADATA_RELATIONSHIP_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/**
 * Smart reflow: only join lines that were broken by the typewriter margin.
 * Preserves all formatting — indentation, right-aligned text, short standalone
 * lines (dates, greetings, closings), blank paragraph breaks, and intentional
 * multi-space gaps within lines.
 *
 * A line is treated as a "continuation" (and joined to the previous) only when:
 *   1. It has NO leading whitespace
 *   2. The previous original line was long enough to suggest a margin break (≥ 55 chars)
 *   3. The previous line was not blank
 */
function reflowTranscript(text: string): string {
  const lines = text.split("\n");
  const MARGIN_THRESHOLD = 55;
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
        // Where the right edge of the text falls in the monospace original
        const rightEdgeChar = leadingSpaces + contentLen;
        const rightPaddingPct = Math.max(
          ((referenceWidth - rightEdgeChar) / referenceWidth) * 100,
          0,
        );
        elements.push(
          <div
            key={i}
            className="transcript-line transcript-line-positioned"
            style={{ paddingRight: `${rightPaddingPct}%` }}
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

/* ── smart sticky nav hook ───────────────────────────────── */

function useScrollDirection() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // Show when scrolling up or near top
        if (y < 80 || y < lastY.current - 4) {
          setVisible(true);
        } else if (y > lastY.current + 4) {
          setVisible(false);
        }
        lastY.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return visible;
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

  // Smart sticky nav
  const navVisible = useScrollDirection();

  useEffect(() => { setScanPage(0); }, [letterId]);

  useEffect(() => {
    if (!letterId) { setLoading(false); return; }
    async function fetchLetter() {
      setLoading(true);
      setError(null);
      try {
        const [data, adj] = await Promise.all([
          getLetterById(letterId!),
          getAdjacentLetters(letterId!).catch(() => null),
        ]);
        setLetter(data);
        setAdjacent(adj);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Letter not found");
        console.error("Failed to fetch letter:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLetter();
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

  const transcriptSectionRef = useRef<HTMLElement>(null);

  // Reference width for proportional spacing: max line length in the original text
  const referenceWidth = useMemo(() => {
    if (!letter?.transcript?.fullText && !letter?.transcript?.pages?.length) return 78;
    const rawText = letter.transcript.fullText
      || letter.transcript.pages.map((p) => p.text).join("\n");
    return computeReferenceWidth(rawText);
  }, [letter]);

  const seo = useMemo(() => (letter ? buildLetterSeo(letter) : null), [letter]);

  const breadcrumbItems = useMemo(() => {
    if (!letter) return [];
    const items = [{ label: "Home", href: "/" }];
    if (letter.collectionCode) {
      items.push({
        label: adjacent?.collectionTitle || `Collection ${letter.collectionCode}`,
        href: `/collections/${letter.collectionCode}`,
      });
    }
    items.push({ label: letter.metadata.date || "Letter" });
    return items;
  }, [letter, adjacent?.collectionTitle]);

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
  const showTone = m.emotionalTone && m.emotionalTone !== "neutral";
  const showRel = m.senderRecipientRelationship && m.senderRecipientRelationship !== "unknown";
  const hasBadges = showTone || showRel || (m.primaryTopics && m.primaryTopics.length > 0);

  const letterImages = letter.images.filter((img) => img.type === "letter");
  const allImages = letter.images;
  const currentScanImage = letterImages[scanPage] || letterImages[0];
  const hasTranscript = shouldShowPublicTranscript(letter);
  const uniquePersons = dedupePersons(letter.linkedPersons);
  const hasEntities = uniquePersons.length > 0 || (letter.linkedPlaces && letter.linkedPlaces.length > 0);

  return (
    <>
      {/* ── Smart Sticky Nav ──────────────────────────────── */}
      {adjacent && adjacent.total > 1 && (
        <div className={`sticky-letter-nav${navVisible ? "" : " hidden"}`}>
          <button
            type="button"
            className="sticky-nav-arrow"
            onClick={() => adjacent.prev && navigate(`/letter/${adjacent.prev.id}`)}
            aria-label={adjacent.prevWraps ? "Last in collection" : "Previous letter"}
          >
            &#8592;
          </button>
          <span className="sticky-nav-label">
            {adjacent.position != null
              ? `${adjacent.position} / ${adjacent.total}`
              : `${adjacent.total} letters`}
          </span>
          <button
            type="button"
            className="sticky-nav-arrow"
            onClick={() => adjacent.next && navigate(`/letter/${adjacent.next.id}`)}
            aria-label={adjacent.nextWraps ? "First in collection" : "Next letter"}
          >
            &#8594;
          </button>
        </div>
      )}

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
          <Breadcrumb items={breadcrumbItems} />

          {m.hook && (
            <blockquote className="letter-headline-hook">
              <p>&ldquo;{m.hook}&rdquo;</p>
            </blockquote>
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

          {hasBadges && (
            <div className="letter-badges">
              {showTone && (
                <span className="badge badge-tone">{toneLabel(m.emotionalTone!)}</span>
              )}
              {showRel && (
                <span className="badge badge-rel">{relLabel(m.senderRecipientRelationship!)}</span>
              )}
              {m.primaryTopics?.map((t) => (
                <span key={t} className="badge badge-topic">{t.replace("/", " / ")}</span>
              ))}
            </div>
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
        {letterImages.length > 0 && (
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

            {letterImages.length > 1 && (
              <div className="scan-page-nav">
                <button
                  type="button"
                  className="scan-nav-arrow"
                  disabled={scanPage === 0}
                  onClick={() => setScanPage((p) => p - 1)}
                  aria-label="Previous page"
                >&#8592;</button>
                <span className="scan-page-label">
                  Page {scanPage + 1} of {letterImages.length}
                </span>
                <button
                  type="button"
                  className="scan-nav-arrow"
                  disabled={scanPage === letterImages.length - 1}
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
                  const pageImage = letterImages.find((img) => img.pageNumber === page.pageNumber);
                  const side = idx % 2 === 0 ? "left" : "right";
                  const isOriginal = transcriptMode === "original";

                  return (
                    <div key={page.pageNumber} className="transcript-page" data-page={page.pageNumber}>
                      {/* Floating side thumbnail — alternates left/right */}
                      {pageImage && letter.transcript.pages.length > 1 && (
                        <button
                          type="button"
                          className={`page-thumb page-thumb-${side}`}
                          onClick={() => openViewer(letterImages.indexOf(pageImage))}
                          aria-label={`View page ${page.pageNumber}`}
                        >
                          <img
                            src={getImageUrl(pageImage.imageUrl, { width: 300 })}
                            alt={`Page ${page.pageNumber}`}
                            className="page-thumb-img"
                            loading="lazy"
                          />
                          <span className="page-thumb-label">Page {page.pageNumber}</span>
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

        {letter.extraContentTranscript && (
          <section className="letter-supporting-section">
            <div className="supporting-label">Additional Materials</div>
            <p className="supporting-text">{letter.extraContentTranscript}</p>
          </section>
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

        {/* ── 7. Collection Nav ────────────────────────────── */}
        {adjacent && adjacent.total > 1 && (
          <nav className="letter-nav-section">
            <div className="collection-filmstrip">
              <div className="filmstrip-label">
                {adjacent.position != null
                  ? `Letter ${adjacent.position} of ${adjacent.total}`
                  : `${adjacent.total} letters in this collection`}
              </div>
              <div className="filmstrip-track">
                <button
                  type="button"
                  className="filmstrip-arrow"
                  onClick={() => adjacent.prev && navigate(`/letter/${adjacent.prev.id}`)}
                  aria-label={adjacent.prevWraps ? "Jump to last letter" : "Previous letter"}
                >&#8592;</button>
                {adjacent.total <= FILMSTRIP_DOT_LIMIT ? (
                  <div className="filmstrip-dots">
                    {Array.from({ length: adjacent.total }, (_, i) => (
                      <span key={i} className={`filmstrip-dot${i + 1 === adjacent.position ? " active" : ""}`} />
                    ))}
                  </div>
                ) : (
                  <div className="filmstrip-progress">
                    <div className="filmstrip-progress-fill" style={{ width: `${((adjacent.position ?? 1) / adjacent.total) * 100}%` }} />
                  </div>
                )}
                <button
                  type="button"
                  className="filmstrip-arrow"
                  onClick={() => adjacent.next && navigate(`/letter/${adjacent.next.id}`)}
                  aria-label={adjacent.nextWraps ? "Jump to first letter" : "Next letter"}
                >&#8594;</button>
              </div>
            </div>

            {(adjacent.prev || adjacent.next) && (
              <div className="adjacent-teasers">
                {adjacent.prev && (
                  <Link to={`/letter/${adjacent.prev.id}`} className={`teaser-card${adjacent.prevWraps ? " teaser-wraps" : ""}`}>
                    <span className="teaser-direction">
                      {adjacent.prevWraps ? "\u2190 Last in Collection" : "\u2190 Previous Letter"}
                    </span>
                    {adjacent.prev.date && <span className="teaser-date">{adjacent.prev.date}</span>}
                    {(adjacent.prev.sender || adjacent.prev.recipient) && (
                      <span className="teaser-people">
                        {[adjacent.prev.sender, adjacent.prev.recipient].filter(Boolean).join(" \u2192 ")}
                      </span>
                    )}
                    {adjacent.prev.hook && <p className="teaser-hook">{adjacent.prev.hook}</p>}
                  </Link>
                )}
                {adjacent.next && (
                  <Link to={`/letter/${adjacent.next.id}`} className={`teaser-card${adjacent.nextWraps ? " teaser-wraps" : ""}`}>
                    <span className="teaser-direction">
                      {adjacent.nextWraps ? "First in Collection \u2192" : "Next Letter \u2192"}
                    </span>
                    {adjacent.next.date && <span className="teaser-date">{adjacent.next.date}</span>}
                    {(adjacent.next.sender || adjacent.next.recipient) && (
                      <span className="teaser-people">
                        {[adjacent.next.sender, adjacent.next.recipient].filter(Boolean).join(" \u2192 ")}
                      </span>
                    )}
                    {adjacent.next.hook && <p className="teaser-hook">{adjacent.next.hook}</p>}
                  </Link>
                )}
              </div>
            )}
          </nav>
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
