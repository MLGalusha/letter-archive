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

  // Scan carousel
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselDraggedRef = useRef(false);

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

  // Scroll-driven scaling + mouse-drag scrolling
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const MIN_SCALE = 0.82;
    let rafId: number | null = null;

    let currentClosest = -1;

    // Cache DOM queries — these don't change during the effect lifecycle
    const slides = Array.from(carousel.querySelectorAll<HTMLElement>(".scan-slide"));
    const dots = Array.from(carousel.parentElement?.querySelectorAll<HTMLElement>(".scan-dot") ?? []);

    const updateScales = () => {
      rafId = null;
      if (slides.length <= 1) return;

      const carouselRect = carousel.getBoundingClientRect();
      const center = carouselRect.left + carouselRect.width / 2;
      const maxDist = carouselRect.width * 0.5;

      // Pass 1: batch all DOM reads
      const data: { scale: number; opacity: number; dist: number }[] = [];
      for (let i = 0; i < slides.length; i++) {
        const slideRect = slides[i].getBoundingClientRect();
        const dist = Math.abs(slideRect.left + slideRect.width / 2 - center);
        const t = Math.min(dist / maxDist, 1);
        data.push({
          scale: 1 - t * (1 - MIN_SCALE),
          opacity: 1 - t * 0.3,
          dist,
        });
      }

      // Pass 2: batch all DOM writes
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < slides.length; i++) {
        slides[i].style.transform = `scale(${data[i].scale})`;
        slides[i].style.opacity = `${data[i].opacity}`;
        if (data[i].dist < closestDist) {
          closestDist = data[i].dist;
          closestIdx = i;
        }
      }

      if (closestIdx !== currentClosest) {
        currentClosest = closestIdx;
        for (let i = 0; i < dots.length; i++) {
          dots[i].classList.toggle("active", i === closestIdx);
        }
      }
    };

    // ── Mouse drag-to-scroll with momentum glide ──
    let isDragging = false;
    let startX = 0;
    let scrollStart = 0;
    let dragDirection = 0; // +1 = dragged right (scrolled left), -1 = dragged left (scrolled right)
    let glideRaf: number | null = null;
    let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;
    let isGliding = false;

    // Smoothed velocity: keep a buffer of recent samples and average them
    const velocitySamples: { dx: number; dt: number }[] = [];
    const MAX_SAMPLES = 5;

    const getSmoothedVelocity = (): number => {
      if (velocitySamples.length === 0) return 0;
      // Weight recent samples more heavily
      let totalDx = 0;
      let totalDt = 0;
      for (const s of velocitySamples) {
        totalDx += s.dx;
        totalDt += s.dt;
      }
      if (totalDt === 0) return 0;
      return (totalDx / totalDt) * 16; // normalize to ~60fps
    };

    const stopGlide = () => {
      if (glideRaf != null) {
        cancelAnimationFrame(glideRaf);
        glideRaf = null;
      }
      isGliding = false;
    };

    // Gentle ease-out: slow deceleration at the end
    const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

    // Get scroll offset that would centre a slide
    const getSlideCenterScroll = (slide: HTMLElement): number => {
      const slideLeft = slide.offsetLeft;
      const slideWidth = slide.offsetWidth;
      const viewWidth = carousel.offsetWidth;
      return slideLeft - (viewWidth - slideWidth) / 2;
    };

    // Single smooth animation from current position to target slide
    const glideTo = (targetScroll: number, durationMs: number) => {
      stopGlide();
      const from = carousel.scrollLeft;
      const delta = targetScroll - from;
      if (Math.abs(delta) < 1) return;

      isGliding = true;
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / durationMs, 1);
        carousel.scrollLeft = from + delta * easeOutQuart(t);

        if (t < 1) {
          glideRaf = requestAnimationFrame(tick);
        } else {
          glideRaf = null;
          isGliding = false;
        }
      };

      glideRaf = requestAnimationFrame(tick);
    };

    // Find nearest slide, using direction as tiebreaker
    const findNearestSlide = (projectedScroll: number, tiebreakDir: number): HTMLElement | null => {
      if (slides.length === 0) return null;

      const slideData: { el: HTMLElement; center: number; dist: number }[] = [];
      for (const slide of slides) {
        const center = getSlideCenterScroll(slide);
        slideData.push({ el: slide, center, dist: Math.abs(projectedScroll - center) });
      }
      slideData.sort((a, b) => a.dist - b.dist);

      // If top two are very close (near-tie), use direction to break it
      if (slideData.length >= 2 && slideData[0].dist > 0) {
        const ratio = slideData[1].dist / slideData[0].dist;
        if (ratio < 1.15) {
          if (tiebreakDir !== 0) {
            const prefer = tiebreakDir > 0
              ? slideData.find((s) => s.center <= projectedScroll) || slideData[0]
              : slideData.find((s) => s.center >= projectedScroll) || slideData[0];
            return prefer.el;
          }
        }
      }

      return slideData[0]?.el ?? null;
    };

    // Settle to nearest slide — called after any scroll stops
    const settleToNearest = (dir: number) => {
      const target = findNearestSlide(carousel.scrollLeft, dir);
      if (target) {
        const targetScroll = getSlideCenterScroll(target);
        const dist = Math.abs(carousel.scrollLeft - targetScroll);
        if (dist > 1) {
          const duration = Math.min(800, Math.max(350, dist * 0.8));
          glideTo(targetScroll, duration);
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault(); // suppress native image/text drag
      stopGlide();
      if (scrollEndTimer) { clearTimeout(scrollEndTimer); scrollEndTimer = null; }
      isDragging = true;
      carouselDraggedRef.current = false;
      startX = e.clientX;
      dragDirection = 0;
      velocitySamples.length = 0;
      scrollStart = carousel.scrollLeft;
      carousel.style.cursor = "grabbing";
    };

    let lastMoveX = 0;
    let lastMoveTime = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      e.preventDefault(); // suppress native drag during scroll
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) carouselDraggedRef.current = true;
      carousel.scrollLeft = scrollStart - dx;

      // Track velocity samples for smoothing
      const now = Date.now();
      if (lastMoveTime > 0) {
        const dt = now - lastMoveTime;
        const moveDx = e.clientX - lastMoveX;
        if (dt > 0) {
          velocitySamples.push({ dx: moveDx, dt });
          if (velocitySamples.length > MAX_SAMPLES) velocitySamples.shift();
          if (Math.abs(moveDx) > 1) {
            dragDirection = moveDx > 0 ? 1 : -1;
          }
        }
      }
      lastMoveX = e.clientX;
      lastMoveTime = now;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      carousel.style.cursor = "";

      // Use smoothed velocity for momentum projection
      const velocity = getSmoothedVelocity();
      const FRICTION = 0.94;
      const projectedDelta = -velocity * FRICTION / (1 - FRICTION);
      const projectedScroll = carousel.scrollLeft + projectedDelta;

      const target = findNearestSlide(projectedScroll, dragDirection);
      if (target) {
        const targetScroll = getSlideCenterScroll(target);
        const dist = Math.abs(carousel.scrollLeft - targetScroll);
        // Longer, gentler glide — scales with distance
        const duration = Math.min(900, Math.max(350, dist * 0.9));
        glideTo(targetScroll, duration);
      }
    };

    // Scroll-end detector: catches trackpad/touch scrolls and always settles
    const onScroll = () => {
      if (rafId == null) rafId = requestAnimationFrame(updateScales);

      // Don't interfere with active drag or our own glide animation
      if (isDragging || isGliding) return;

      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(() => {
        scrollEndTimer = null;
        if (!isDragging && !isGliding) {
          settleToNearest(0);
        }
      }, 150);
    };

    carousel.addEventListener("scroll", onScroll, { passive: true });
    carousel.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    requestAnimationFrame(updateScales);

    return () => {
      carousel.removeEventListener("scroll", onScroll);
      carousel.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      stopGlide();
      if (scrollEndTimer) clearTimeout(scrollEndTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  });

  const scrollToSlide = useCallback((index: number) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slide = carousel.children[index] as HTMLElement | undefined;
    if (!slide) return;

    const targetScroll = slide.offsetLeft - (carousel.clientWidth - slide.clientWidth) / 2;
    const start = carousel.scrollLeft;
    const distance = targetScroll - start;
    if (Math.abs(distance) < 2) return;

    const duration = Math.min(900, Math.max(500, Math.abs(distance) * 0.6));
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic — soft deceleration
      const ease = 1 - Math.pow(1 - t, 3);
      carousel!.scrollLeft = start + distance * ease;
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, []);

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

  // Scroll-driven parallax + zigzag for side thumbnails (desktop only)
  useEffect(() => {
    if (!letter || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 769px)");
    if (!mq.matches) return;

    let rafId: number | null = null;
    let lastScrollY = -1;

    // ── Layout cache: document-relative positions (no per-frame layout reads) ──
    interface ThumbLayout {
      thumb: HTMLElement;
      sectionDocTop: number;   // section.top relative to document
      sectionHeight: number;
      thumbH: number;
      curX: number;
      curY: number;
    }
    let layout: ThumbLayout[] = [];
    let headerHeight = 0;
    let viewportH = window.innerHeight;

    // Compute document-relative position of an element (no getBoundingClientRect needed later)
    const getDocTop = (el: HTMLElement): number => {
      let top = 0;
      let cur: HTMLElement | null = el;
      while (cur) {
        top += cur.offsetTop;
        cur = cur.offsetParent as HTMLElement | null;
      }
      return top;
    };

    const cacheLayout = () => {
      const headerEl = document.querySelector<HTMLElement>(".header");
      headerHeight = headerEl?.offsetHeight ?? 0;
      viewportH = window.innerHeight;

      const thumbEls = document.querySelectorAll<HTMLElement>(".page-thumb");
      layout = [];
      thumbEls.forEach((thumb) => {
        const section = thumb.parentElement;
        if (!section) return;
        const prev = layout.find((l) => l.thumb === thumb);
        layout.push({
          thumb,
          sectionDocTop: getDocTop(section),
          sectionHeight: section.offsetHeight,
          thumbH: thumb.offsetHeight,
          curX: prev?.curX ?? 0,
          curY: prev?.curY ?? 0,
        });
      });
      lastScrollY = -1; // force recalc on next tick
    };

    cacheLayout();

    // Recache on resize or content changes
    const onResize = () => { cacheLayout(); start(); };
    window.addEventListener("resize", onResize, { passive: true });

    const observer = new MutationObserver(() => {
      // Debounce layout recalc to avoid thrashing during DOM updates
      setTimeout(cacheLayout, 50);
    });
    const transcriptEl = document.querySelector(".letter-transcript-section");
    if (transcriptEl) observer.observe(transcriptEl, { childList: true, subtree: true });

    const SMOOTH_SPEED = 4;
    const TWO_PI = Math.PI * 2;

    const tick = () => {
      const scrollY = window.scrollY;

      // Skip if scroll hasn't changed and positions have converged
      if (scrollY === lastScrollY && rafId === null) return;
      lastScrollY = scrollY;

      const stickyTop = headerHeight + 16;
      const viewCenter = viewportH / 2;
      // Approximate lerp factor for ~60fps: 1 - e^(-4 * 1/60) ≈ 0.0645
      // Use fixed factor — avoids Date.now()/performance.now() overhead
      const factor = 0.065;

      let needsMore = false;

      for (let i = 0; i < layout.length; i++) {
        const l = layout[i];
        // Section top relative to viewport = docTop - scrollY
        const sectionViewTop = l.sectionDocTop - scrollY;
        const naturalTop = 8;
        const maxTravel = l.sectionHeight - l.thumbH - naturalTop - 16;

        let targetX = 0;
        let targetY = 0;
        if (maxTravel > 0) {
          const idealY = viewCenter - l.thumbH / 2 - sectionViewTop - naturalTop;
          const minFromHeader = stickyTop - sectionViewTop - naturalTop;
          targetY = maxTravel < idealY ? maxTravel : idealY;
          if (targetY < minFromHeader) targetY = minFromHeader > 0 ? minFromHeader : 0;
          if (targetY < 0) targetY = 0;
          if (targetY > maxTravel) targetY = maxTravel;

          const progress = targetY / maxTravel;
          const amp = l.sectionHeight * 0.012;
          targetX = Math.sin(progress * TWO_PI) * (amp < 8 ? 8 : amp > 18 ? 18 : amp);
        }

        const nx = l.curX + (targetX - l.curX) * factor;
        const ny = l.curY + (targetY - l.curY) * factor;
        l.curX = nx;
        l.curY = ny;

        // Only write DOM if position changed meaningfully (> 0.5px)
        if (Math.abs(nx) > 0.5 || Math.abs(ny) > 0.5) {
          l.thumb.style.transform = `translate3d(${nx | 0}px,${ny | 0}px,0)`;
        } else if (l.thumb.style.transform) {
          l.thumb.style.transform = "";
        }

        const dx = targetX - nx;
        const dy = targetY - ny;
        if (dx * dx + dy * dy > 0.25) {
          needsMore = true;
        }
      }

      if (needsMore) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };

    function start() { if (rafId == null) rafId = requestAnimationFrame(tick); }
    window.addEventListener("scroll", start, { passive: true });
    start();

    const onMq = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        for (const l of layout) l.thumb.style.transform = "";
      }
    };
    mq.addEventListener("change", onMq);

    return () => {
      window.removeEventListener("scroll", start);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMq);
      observer.disconnect();
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
                              onClick={() => openViewer(allImages.indexOf(pageImage))}
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
                            onClick={() => openViewer(allImages.indexOf(pageImage))}
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
                      onClick={() => openViewer(allImages.indexOf(itemImage))}
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
                    onClick={() => openViewer(allImages.indexOf(extraImages[0]))}
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
