import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import BackToTop from "../components/BackToTop";
import { getContentPage, getFeaturedLetter, getImageUrl, listBlogPosts, type BlogPost, type FeaturedLetter } from "../api/client";
import { ProgressiveImage } from "../components/common";
import { getLetterById } from "../api/letters";
import type { LetterImage } from "../types/Letter";
import { buildHomeSeo } from "../utils/seo";
import { EMPTY_DOCK, useHeaderDock } from "../contexts/HeaderDockContext";
import useArchiveSearch from "../hooks/useArchiveSearch";
import useStickyDock from "../hooks/useStickyDock";
import "./HomePage.css";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatDateParts(yearText: string, monthText: string, dayText: string): string | null {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatFeaturedLetterDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Handle dateRaw format with X placeholders (e.g. 1947XXXX, 19470810, 1947XX14)
  const rawMatch = trimmed.match(/^(\d{4})([\dX]{2})([\dX]{2})$/);
  if (rawMatch) {
    const [, yearStr, monthStr, dayStr] = rawMatch;
    const monthKnown = !monthStr.includes('X');
    const dayKnown = !dayStr.includes('X');
    if (monthKnown && dayKnown) {
      return formatDateParts(yearStr, monthStr, dayStr) || yearStr;
    }
    if (monthKnown) {
      const month = parseInt(monthStr, 10);
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${yearStr}` : yearStr;
    }
    return yearStr;
  }

  // Already-formatted text (contains letters other than X)
  if (/[A-Za-z]/.test(trimmed)) return trimmed;

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return formatDateParts(compactMatch[1], compactMatch[2], compactMatch[3]) || trimmed;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return formatDateParts(isoMatch[1], isoMatch[2], isoMatch[3]) || trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return formatDateParts(slashMatch[3], slashMatch[1], slashMatch[2]) || trimmed;
  }

  return trimmed;
}

function getCorrespondentLine(letter: { sender?: string | null; recipient?: string | null }): string | null {
  const sender = letter.sender?.trim();
  const recipient = letter.recipient?.trim();
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  return sender || recipient || null;
}

const HOME_SEARCH_SCROLL_GAP = 20;

/* ── Hero feature card ────────────────────────────────── */

function HeroLetterCard({
  heroLetter,
  heroImages,
  ariaLabel,
  onNavigate,
}: {
  heroLetter: FeaturedLetter;
  heroImages: LetterImage[];
  ariaLabel: string;
  onNavigate: (letterId: string, params: URLSearchParams) => void;
}) {
  const [heroPageIndex, setHeroPageIndex] = useState(0);
  const currentImage = heroImages[heroPageIndex] || null;
  const hasMultiplePages = heroImages.length > 1;
  const heroPeopleLine = getCorrespondentLine(heroLetter);
  const heroDate = formatFeaturedLetterDate(heroLetter.letterDate || heroLetter.dateRaw);
  const navigateToLetter = () => {
    const params = new URLSearchParams();
    params.set("from", "highlight");
    if (currentImage) params.set("image", currentImage.id);
    onNavigate(heroLetter.id, params);
  };
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigateToLetter();
    }
  };
  const handlePrevPage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHeroPageIndex((i) => (i === 0 ? heroImages.length - 1 : i - 1));
  };
  const handleNextPage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setHeroPageIndex((i) => (i === heroImages.length - 1 ? 0 : i + 1));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`letter-card home-hero-feature-card letter-card--${heroLetter.imageType || 'letter'}`}
      aria-label={ariaLabel}
      onClick={navigateToLetter}
      onKeyDown={handleCardKeyDown}
    >
      {heroImages.length > 0 ? (
        heroImages.map((img, idx) => (
          <ProgressiveImage
            key={img.id}
            className="letter-card-image"
            src={getImageUrl(img.imageUrl, { width: 640 })}
            thumbSrc={getImageUrl(img.imageUrl, { width: 32 })}
            midSrc={getImageUrl(img.imageUrl, { width: 480 })}
            alt=""
            loading={idx === 0 ? "eager" : "lazy"}
            fetchPriority={idx === 0 ? "high" : undefined}
            decoding="async"
            style={{ opacity: idx === heroPageIndex ? 1 : 0 }}
            idleUpgrade
            context="hero"
          />
        ))
      ) : heroLetter.imageUrl ? (
        <ProgressiveImage
          className="letter-card-image"
          src={heroLetter.imageUrl.startsWith('/') ? getImageUrl(heroLetter.imageUrl, { width: 640 }) : heroLetter.imageUrl}
          thumbSrc={heroLetter.imageUrl.startsWith('/') ? getImageUrl(heroLetter.imageUrl, { width: 32 }) : heroLetter.imageUrl}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          context="hero"
        />
      ) : (
        <div className="letter-card-fallback" aria-hidden="true">
          <span>{heroDate || "Featured letter"}</span>
        </div>
      )}
      <div className="letter-card-overlay" />
      <div className="home-hero-feature-label">
        <span className="home-hero-feature-title">Featured Letter</span>
        <span className="home-hero-feature-collection">Collection {heroLetter.collectionCode || "009"}</span>
      </div>
      {hasMultiplePages && (
        <span className="home-hero-page-counter">
          {heroPageIndex + 1}/{heroImages.length}
        </span>
      )}
      <div className="letter-card-content">
        {heroPeopleLine && <div className="letter-card-meta">{heroPeopleLine}</div>}
        {heroDate && <div className="letter-card-date">{heroDate}</div>}
        {heroLetter.hook && <p className="letter-hook">{heroLetter.hook}</p>}
      </div>
      {hasMultiplePages && (
        <>
          <button
            type="button"
            className="home-hero-zone home-hero-zone--prev"
            onClick={handlePrevPage}
            aria-label="Previous page"
          />
          <button
            type="button"
            className="home-hero-zone home-hero-zone--next"
            onClick={handleNextPage}
            aria-label="Next page"
          />
        </>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────── */

export default function HomePage() {
  const homeSeo = buildHomeSeo();
  const navigate = useNavigate();
  const { setDock } = useHeaderDock();

  // ── Hero content (editable from admin) ──
  const [heroCopy, setHeroCopy] = useState({
    kicker: 'Real Letters, Real Lives',
    heading: 'Follow real lives through letters, telegrams, photographs, and the paper trail they left behind.',
    subtitle: 'Search names, places, dates, and remembered phrases across the archive, or open a collection to stay inside one family, one romance, or one moment at a time.',
  });

  // ── Hero state ──
  const [heroLetter, setHeroLetter] = useState<FeaturedLetter | null>(null);
  const [heroImages, setHeroImages] = useState<LetterImage[]>([]);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [latestBlogPost, setLatestBlogPost] = useState<BlogPost | null>(null);

  // ── Archive search (extracted hook) ──
  const archive = useArchiveSearch({ storageKey: "home", defaultSort: "createdAt" });

  // ── Sticky dock (extracted hook) ──
  const archiveSearchRef = useRef<HTMLElement | null>(null);
  const searchPanelRef = useRef<HTMLDivElement | null>(null);
  const searchDockTriggerRef = useRef<HTMLDivElement | null>(null);
  const dock = useStickyDock({
    triggerRef: searchDockTriggerRef,
    sectionRef: archiveSearchRef,
  });

  // ── Fetch hero data + latest blog post ──
  useEffect(() => {
    let cancelled = false;

    // Start featured letter fetch, and eagerly chain getLetterById as soon as it resolves
    // (don't wait for blogPosts/contentPage before fetching images)
    const featuredPromise = getFeaturedLetter().catch(() => null);
    const imagesPromise = featuredPromise.then((featured) => {
      if (!featured || cancelled) return null;
      return getLetterById(featured.id).catch(() => null);
    });

    Promise.all([
      listBlogPosts({ limit: 1 }).catch(() => ({ posts: [], total: 0 })),
      featuredPromise,
      getContentPage('home').catch(() => null),
      imagesPromise,
    ]).then(([blogData, featured, homePage, letterDetails]) => {
      if (cancelled) return;
      if (blogData.posts.length > 0) setLatestBlogPost(blogData.posts[0]);
      if (homePage) {
        const json = homePage.contentJson as { hero?: { kicker?: string; heading?: string; subtitle?: string } };
        if (json?.hero) {
          setHeroCopy((prev) => ({
            kicker: json.hero!.kicker || prev.kicker,
            heading: json.hero!.heading || prev.heading,
            subtitle: json.hero!.subtitle || prev.subtitle,
          }));
        }
      }
      setHeroLetter(featured);
      setHeroLoaded(true);
      if (featured) {
        setHeroImages(letterDetails?.images || []);
      }
    });

    return () => { cancelled = true; };
  }, []);

  // ── Header dock content ──
  useEffect(() => {
    if (!dock.stickyDockActive) {
      setDock(EMPTY_DOCK);
      return;
    }
    setDock({
      content: (
        <SearchBar
          query={archive.searchQuery}
          filters={archive.filters}
          facets={archive.archiveResults.facets}
          total={archive.archiveResults.total}
          loading={archive.archiveLoading}
          embedded
          variant="compact"
          refineOpen={dock.compactRefineOpen}
          sortOpen={dock.compactSortOpen}
          onRefineOpenChange={(open) => {
            dock.setCompactRefineOpen(open);
            if (open) dock.setPageRefineOpen(false);
          }}
          onSortOpenChange={(open) => {
            dock.setCompactSortOpen(open === false ? undefined : open);
            if (open) dock.setPageSortOpen(false);
          }}
          onQueryChange={archive.setSearchQuery}
          onFiltersChange={archive.setFilters}
        />
      ),
      active: true,
      visible: true,
    });
  }, [
    archive.archiveLoading,
    archive.archiveResults.facets,
    archive.archiveResults.total,
    archive.filters,
    archive.searchQuery,
    archive.setFilters,
    archive.setSearchQuery,
    dock.compactRefineOpen,
    dock.compactSortOpen,
    dock.setCompactRefineOpen,
    dock.setCompactSortOpen,
    dock.setPageRefineOpen,
    dock.setPageSortOpen,
    dock.stickyDockActive,
    setDock,
  ]);

  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

  const handleLetterClick = useCallback((letterId: string) => {
    navigate(`/letter/${letterId}`);
  }, [navigate]);

  const handleHeroNavigate = useCallback((letterId: string, params: URLSearchParams) => {
    navigate(`/letter/${letterId}?${params.toString()}`);
  }, [navigate]);

  const handleScrollToArchiveSearch = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();

    const target = searchPanelRef.current ?? archiveSearchRef.current;
    if (!target) return;

    const header = document.querySelector('.header') as HTMLElement | null;
    const headerHeight = header?.offsetHeight ?? 0;
    const targetTop = window.scrollY + target.getBoundingClientRect().top - headerHeight - HOME_SEARCH_SCROLL_GAP;
    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, []);

  const heroPeopleLine = heroLetter ? getCorrespondentLine(heroLetter) : null;
  const heroDate = formatFeaturedLetterDate(heroLetter?.letterDate || heroLetter?.dateRaw);
  const heroAriaLabel = heroLetter
    ? [
        "Featured letter",
        heroPeopleLine,
        heroDate,
        heroLetter.hook,
      ].filter((value): value is string => Boolean(value)).join(", ")
    : "Featured letter";

  return (
    <div className="body-layout home-page">
      <SEO
        title={homeSeo.title}
        description={homeSeo.description}
        canonicalUrl={homeSeo.canonicalPath}
        jsonLd={homeSeo.jsonLd}
      />
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker">{heroCopy.kicker}</p>
          <h1 className="home-headline">{heroCopy.heading}</h1>
          <p className="home-subtitle">{heroCopy.subtitle}</p>
          <div className="home-hero-actions">
            <a
              href="#archive-search"
              className="btn-card home-primary-action"
              onClick={handleScrollToArchiveSearch}
            >
              Search the Archive
            </a>
            <Link to="/collections" className="btn-card home-secondary-action">
              Browse Collections
            </Link>
            <Link to="/blog" className="home-text-link">
              Read the Journal &rarr;
            </Link>
          </div>
        </div>
        {heroLetter ? (
          <HeroLetterCard
            heroLetter={heroLetter}
            heroImages={heroImages}
            ariaLabel={heroAriaLabel}
            onNavigate={handleHeroNavigate}
          />
        ) : !heroLoaded ? (
          <div className="home-hero-feature-card home-hero-feature-card--placeholder">
            <span className="home-hero-feature-placeholder-label">Featured Letter</span>
            <p>Loading a featured letter from collection 009...</p>
          </div>
        ) : null}
      </section>

      {latestBlogPost && (
        <section className="home-editorial-rail">
          <section className="home-latest-update">
            <div className="section-eyebrow">Latest From the Journal</div>
            <Link to={`/blog/${latestBlogPost.slug}`} className="latest-update-card">
              <div className="latest-update-content">
                <h3 className="latest-update-title">{latestBlogPost.title}</h3>
                {latestBlogPost.excerpt && (
                  <p className="latest-update-excerpt">{latestBlogPost.excerpt}</p>
                )}
                <div className="latest-update-footer">
                  <span className="latest-update-date">
                    {formatDate(latestBlogPost.publishedAt || latestBlogPost.createdAt)}
                  </span>
                  <span className="latest-update-cta">Read more &rarr;</span>
                </div>
              </div>
            </Link>
          </section>
        </section>
      )}

      <section id="archive-search" className="home-archive-surface" ref={archiveSearchRef}>
        <div className="home-search-panel" ref={searchPanelRef}>
        <SearchBar
          query={archive.searchQuery}
          filters={archive.filters}
          facets={archive.archiveResults.facets}
          total={archive.archiveResults.total}
          loading={archive.archiveLoading}
          embedded
          variant="full"
          refineOpen={dock.pageRefineOpen}
          sortOpen={dock.pageSortOpen}
          dockTriggerRef={searchDockTriggerRef}
          onRefineOpenChange={(open) => {
            dock.setPageRefineOpen(open);
            if (open) dock.setCompactRefineOpen(false);
          }}
          onSortOpenChange={(open) => {
            dock.setPageSortOpen(open === false ? undefined : open);
            if (open) dock.setCompactSortOpen(false);
          }}
          onQueryChange={archive.setSearchQuery}
          onFiltersChange={archive.setFilters}
        />
        </div>

        <div className="home-surface-divider" aria-hidden="true" />

        <section className="home-archive-stage">
          <ArchiveList
            onLetterClick={handleLetterClick}
            letters={archive.archiveResults.letters}
            total={archive.archiveResults.total}
            loading={archive.archiveLoading}
            loadingMore={archive.archiveLoadingMore}
            error={archive.archiveError}
            loadMoreError={archive.archiveLoadMoreError}
            hasMore={archive.archiveResults.letters.length < archive.archiveResults.total}
            onLoadMore={archive.handleArchiveLoadMore}
            sortCueField={archive.sortCueField}
          />
        </section>
      </section>

      <Footer />
      <BackToTop />
    </div>
  );
}
