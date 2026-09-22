import { useSiteSettings } from '../hooks/useSiteSettings';
import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import SEO from "../components/SEO";
import { ScanReader, type ScanReaderHandle } from "../components/LetterViewer/ScanReader";

import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { LetterImage, LetterImageType, PublicLetter } from "../types/Letter";
import { buildLetterSeo } from "../utils/seo";
import {
  hasPrimaryTranscriptContent,
  shouldShowPhotoDescriptionWorkflow,
} from "../utils/letterContent";
import ReaderTranscript from "../components/LetterViewer/ReaderTranscript";
import HeaderDock from "../components/Header/HeaderDock";
import HeaderScrubber from "../components/HeaderScrubber/HeaderScrubber";
import useLetterScrubber from "../components/LetterHeaderDock/useLetterScrubber";
import BackToTop from "../components/BackToTop";
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
  const settings = useSiteSettings();
  const siteName = settings?.site_title?.trim() || undefined;
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
  const [loadError, setLoadError] = useState<{ ownerLetterId: string; message: string } | null>(null);
  const error = loadError && loadError.ownerLetterId === letterId ? loadError.message : null;
  const letter = loadedLetter?.value ?? null;
  const displayedLetterIsCurrent = (
    !!letterId
    && loadedLetter?.ownerLetterId === letterId
  );
  const pending = !displayedLetterIsCurrent && !error;
  const adjacent = (
    displayedLetterIsCurrent
    && loadedAdjacent?.ownerLetterId === letterId
  )
    ? loadedAdjacent.value
    : null;

  // Keep the last committed navigation presentation while its replacement loads.
  // It is never an active source of destinations while retained.
  const [settledNavigation, setSettledNavigation] = useState<{
    ownerLetterId: string; value: AdjacentLettersResponse | null;
  } | null>(null);
  const navigationResolved = !error && displayedLetterIsCurrent && loadedAdjacent?.ownerLetterId === letterId;
  if (navigationResolved && settledNavigation !== loadedAdjacent) setSettledNavigation(loadedAdjacent);
  if (error && settledNavigation) setSettledNavigation(null);
  const canRetainNavigation = !error && settledNavigation?.value && (
    loadedLetter?.ownerLetterId === settledNavigation.ownerLetterId
    || letter?.collectionCode === settledNavigation.value.collectionCode
  );
  const navigationPresentation = navigationResolved ? loadedAdjacent : canRetainNavigation ? settledNavigation : null;
  const navigationPending = !!navigationPresentation && !navigationResolved;

  const readerRef = useRef<ScanReaderHandle>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [routeOwner, setRouteOwner] = useState(letterId);
  if (routeOwner !== letterId) {
    setRouteOwner(letterId);
    setLoadError(null);
    setViewerOpen(false);
  }
  const targetImageId = searchParams.get("image");

  useEffect(() => {
    if (!letterId) return;
    const controller = new AbortController();
    const requestedLetterId = letterId;
    // Navigation metadata is optional and must not hold up the letter itself.
    void getLetterById(requestedLetterId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setLoadedLetter({ ownerLetterId: requestedLetterId, value: data });
      }
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setLoadError({
        ownerLetterId: requestedLetterId,
        message: err instanceof Error ? err.message : "Letter not found",
      });
      console.error("Failed to fetch letter:", err);
    });

    void getAdjacentLetters(requestedLetterId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setLoadedAdjacent({ ownerLetterId: requestedLetterId, value: data });
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setLoadedAdjacent({ ownerLetterId: requestedLetterId, value: null });
      }
    });

    return () => controller.abort();
  }, [letterId]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerOpen || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (!displayedLetterIsCurrent || !adjacent || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" && adjacent.prev) navigate(`/letter/${adjacent.prev.id}`);
      if (e.key === "ArrowRight" && adjacent.next) navigate(`/letter/${adjacent.next.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adjacent, displayedLetterIsCurrent, navigate, viewerOpen]);

  // Build scrubber props from adjacent data (hook must be at top level)
  // Companion URLs resolve to a representative catalogue ID. Use that identity
  // only for the matching presentation; a new detail may precede its adjacency.
  const navigationLetterId = loadedLetter?.ownerLetterId === navigationPresentation?.ownerLetterId
    ? letter?.id : navigationPresentation?.ownerLetterId;
  const scrubberProps = useLetterScrubber(navigationPresentation?.value ?? null, navigationLetterId);

  const collectionCode = displayedLetterIsCurrent ? letter?.collectionCode ?? adjacent?.collectionCode
    : navigationPresentation?.value?.collectionCode;
  const collectionsLink = useMemo(
    () => collectionCode ? { label: "Collection", to: `/collections/${collectionCode}` } : undefined,
    [collectionCode],
  );

  const seo = useMemo(() => (letter ? buildLetterSeo(letter, siteName) : null), [letter, siteName]);


  // Memoize all derived values — must be before conditional returns (Rules of Hooks)
  const derived = useMemo(() => {
    if (!letter) return null;
    const m = letter.metadata;
    const extraContentItems = letter.extraContentItems ?? [];
    return {
      m,
      byline: correspondentLine(m),
      carouselImages: letter.images,
      allImages: letter.images,
      hasTranscript: (hasPrimaryTranscriptContent(letter) || !letter.images.length)
        && !!(letter.readingText?.trim() || letter.transcript.fullText.trim() || letter.transcript.pages.some(page => page.text.trim())),
      extraContentItems,
      hasExtraContent: extraContentItems.length > 0 || !!letter.extraContentTranscript,
      isPhotoRecord: shouldShowPhotoDescriptionWorkflow(letter),
      heroHook: m.hook,
    };
  }, [letter]);

  if (pending && !letter) {
    return <div className="letter-article" aria-busy="true"><p className="letter-loading" role="status">Loading letter...</p></div>;
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
    m, byline, carouselImages, allImages,
    hasTranscript, extraContentItems, hasExtraContent,
    isPhotoRecord, heroHook,
  } = derived;

  return (
    <>
      <HeaderDock transparent collectionsLink={collectionsLink}>
        {scrubberProps && <HeaderScrubber {...scrubberProps} disabled={navigationPending} />}
      </HeaderDock>
      {pending && <div className="sr-only" role="status">Loading letter...</div>}
      <article className="letter-article" aria-busy={pending} inert={pending}>
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

        <div className={`letter-reader${carouselImages.length ? "" : " letter-reader--text-only"}`}>
        <ScanReader key={letter.id} ref={readerRef} images={carouselImages} letterId={letter.id}
          targetImageId={targetImageId} onViewerChange={setViewerOpen} />

        <header className="letter-hero-section">
          <h1>{formatDateText(m.date || (m.sender ? `Letter from ${m.sender}` : m.recipient ? `Letter to ${m.recipient}` : isPhotoRecord ? "Photograph" : "Letter"))}</h1>
          {byline && <p className="letter-byline">{byline}</p>}
          {m.location && <p className="letter-dateline">{m.location}</p>}
          {(heroHook || m.description) && <details className="letter-summary-section">
            <summary>About This Letter</summary>
            {heroHook && <p className="letter-headline-hook">{heroHook}</p>}
            {m.description && <p className="letter-summary-text">{m.description}</p>}
          </details>}
        </header>
        <div className="letter-reading-column">
          {hasTranscript ? <ReaderTranscript key={letter.id} letter={letter} />
            : !isPhotoRecord && <p className="reader-empty">A transcript is not available for this letter.</p>}
          {!carouselImages.length && <p className="reader-empty">Original scans are not available.</p>}
          {isPhotoRecord && letter.photoDescription && <section className="letter-supporting-section">
            <h2 className="supporting-label">Photo Description</h2>
            <p className="supporting-text">{letter.photoDescription}</p>
          </section>}
          {hasExtraContent && (extraContentItems.length ? extraContentItems : [{
            label: getExtraContentLabel(allImages), transcript: letter.extraContentTranscript!,
            imageIds: allImages.filter(img => EXTRA_CONTENT_TYPES.includes(img.type)).map(img => img.id),
          }]).map((item, idx) => <section className="letter-supporting-section" key={`${letter.id}-extra-${idx}`}>
            <div className="supporting-header-row">
              <h2 className="supporting-label">{item.label}</h2>
              <span className="transcript-status">{letter.extraContentStatus === "VERIFIED" ? "Verified" : "Unverified"}</span>
            </div>
            <p className="supporting-text">{item.transcript}</p>
            <div className="reader-source-links">
              {allImages.map((img, imageIndex) => item.imageIds.includes(img.id) && <button
                key={img.id} type="button" className="reader-source-link"
                onClick={e => readerRef.current?.open(imageIndex, e.currentTarget)}>
                View on scan {imageIndex + 1} ↗
              </button>)}
            </div>
          </section>)}
        </div>
        </div>

      </article>

      <BackToTop />
    </>
  );
}
