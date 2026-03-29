import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import BackToTop from "../components/BackToTop";
import { getImageUrl, listBlogPosts, type BlogPost } from "../api/client";
import { getArchiveShelfItems, getLetterById } from "../api/letters";
import type { ArchiveShelfItem, LetterImage } from "../types/Letter";
import { buildHomeSeo } from "../utils/seo";
import { EMPTY_DOCK, useHeaderDock } from "../contexts/HeaderDockContext";
import useArchiveSearch from "../hooks/useArchiveSearch";
import useStickyDock from "../hooks/useStickyDock";
import "./HomePage.css";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function getCorrespondentLine(letter: Pick<ArchiveShelfItem, "sender" | "recipient">): string | null {
  const sender = letter.sender?.trim();
  const recipient = letter.recipient?.trim();
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  return sender || recipient || null;
}

function pickHeroLetter(items: ArchiveShelfItem[]): ArchiveShelfItem | null {
  const visualLetters = items.filter((item) => item.imageType === "letter" && item.imageUrl);
  const fallbackLetters = items.filter((item) => item.imageType === "letter");
  const pool = visualLetters.length > 0
    ? visualLetters
    : fallbackLetters.length > 0
      ? fallbackLetters
      : items;

  if (pool.length === 0) return null;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] || null;
}

/* ── Hero feature card ────────────────────────────────── */

function HeroLetterCard({
  heroLetter,
  heroImages,
  heroPageIndex,
  setHeroPageIndex,
  ariaLabel,
  onNavigate,
}: {
  heroLetter: ArchiveShelfItem;
  heroImages: LetterImage[];
  heroPageIndex: number;
  setHeroPageIndex: React.Dispatch<React.SetStateAction<number>>;
  ariaLabel: string;
  onNavigate: (letterId: string, params: URLSearchParams) => void;
}) {
  const currentImage = heroImages[heroPageIndex] || null;
  const hasMultiplePages = heroImages.length > 1;
  const heroPeopleLine = getCorrespondentLine(heroLetter);
  const heroDate = heroLetter.date || heroLetter.dateRaw || null;

  return (
    <button
      type="button"
      className={`letter-card home-hero-feature-card letter-card--${heroLetter.imageType}`}
      aria-label={ariaLabel}
      onClick={() => {
        const params = new URLSearchParams();
        params.set("from", "highlight");
        if (currentImage) params.set("image", currentImage.id);
        onNavigate(heroLetter.id, params);
      }}
    >
      {heroImages.length > 0 ? (
        heroImages.map((img, idx) => (
          <img
            key={img.id}
            className="letter-card-image"
            src={getImageUrl(img.imageUrl, { width: 1200 })}
            alt=""
            loading={idx === 0 ? "eager" : "lazy"}
            fetchPriority={idx === 0 ? "high" : undefined}
            decoding="async"
            style={{ opacity: idx === heroPageIndex ? 1 : 0 }}
          />
        ))
      ) : heroLetter.imageUrl ? (
        <img
          className="letter-card-image"
          src={getImageUrl(heroLetter.imageUrl, { width: 1200 })}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
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
          <div
            className="home-hero-zone home-hero-zone--prev"
            onClick={(e) => { e.stopPropagation(); setHeroPageIndex((i) => (i === 0 ? heroImages.length - 1 : i - 1)); }}
            aria-label="Previous page"
          />
          <div
            className="home-hero-zone home-hero-zone--next"
            onClick={(e) => { e.stopPropagation(); setHeroPageIndex((i) => (i === heroImages.length - 1 ? 0 : i + 1)); }}
            aria-label="Next page"
          />
        </>
      )}
    </button>
  );
}

/* ── Main component ───────────────────────────────────── */

export default function HomePage() {
  const homeSeo = buildHomeSeo();
  const navigate = useNavigate();
  const { setDock } = useHeaderDock();

  // ── Hero state ──
  const [heroLetter, setHeroLetter] = useState<ArchiveShelfItem | null>(null);
  const [heroImages, setHeroImages] = useState<LetterImage[]>([]);
  const [heroPageIndex, setHeroPageIndex] = useState(0);
  const [latestBlogPost, setLatestBlogPost] = useState<BlogPost | null>(null);

  // ── Archive search (extracted hook) ──
  const archive = useArchiveSearch({ storageKey: "home", defaultSort: "createdAt" });

  // ── Sticky dock (extracted hook) ──
  const archiveSearchRef = useRef<HTMLElement | null>(null);
  const searchDockTriggerRef = useRef<HTMLDivElement | null>(null);
  const dock = useStickyDock({
    triggerRef: searchDockTriggerRef,
    sectionRef: archiveSearchRef,
  });

  // ── Fetch hero data + latest blog post ──
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      listBlogPosts({ limit: 1 }).catch(() => ({ posts: [], total: 0 })),
      getArchiveShelfItems({
        collection: "009",
        limit: 100,
        sort: "createdAt",
        sortOrder: "desc",
      }).catch(() => null),
    ]).then(([blogData, heroData]) => {
      if (cancelled) return;
      if (blogData.posts.length > 0) setLatestBlogPost(blogData.posts[0]);
      const picked = pickHeroLetter(heroData?.letters || []);
      setHeroLetter(picked);
      if (picked) {
        getLetterById(picked.id).then((full) => {
          if (cancelled) return;
          setHeroImages(full.images || []);
        }).catch(() => {});
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

  const heroPeopleLine = heroLetter ? getCorrespondentLine(heroLetter) : null;
  const heroDate = heroLetter?.date || heroLetter?.dateRaw || null;
  const heroAriaLabel = heroLetter
    ? [
        "Featured letter",
        heroPeopleLine,
        heroDate,
        heroLetter.primaryChip,
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
          <p className="home-kicker">Real Letters, Real Lives</p>
          <h1 className="home-headline">
            Follow real lives through letters, telegrams, photographs, and the paper trail they left behind.
          </h1>
          <p className="home-subtitle">
            Search names, places, dates, and remembered phrases across the archive,
            or open a collection to stay inside one family, one romance, or one moment
            at a time.
          </p>
          <div className="home-hero-actions">
            <a href="#archive-search" className="btn-card home-primary-action">
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
            heroPageIndex={heroPageIndex}
            setHeroPageIndex={setHeroPageIndex}
            ariaLabel={heroAriaLabel}
            onNavigate={handleHeroNavigate}
          />
        ) : (
          <div className="home-hero-feature-card home-hero-feature-card--placeholder">
            <span className="home-hero-feature-placeholder-label">Featured Letter</span>
            <p>Loading a featured letter from collection 009...</p>
          </div>
        )}
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
        <div className="home-search-panel">
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
