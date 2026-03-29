import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar, { type SearchFilters } from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import BackToTop from "../components/BackToTop";
import { getImageUrl, listBlogPosts, type BlogPost } from "../api/client";
import {
  getArchiveShelfItems,
  getLetterById,
  searchArchiveShelf,
  type ArchiveSearchResponse,
} from "../api/letters";
import type { ArchiveShelfItem, LetterImage } from "../types/Letter";
import { buildHomeSeo } from "../utils/seo";
import { saveSearchState, loadSearchState } from "../utils/searchPersistence";
import { EMPTY_DOCK, useHeaderDock } from "../contexts/HeaderDockContext";
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

const ARCHIVE_PAGE_SIZE = 24;

function getInitialFormats(searchParams: URLSearchParams): SearchFilters["format"] {
  const repeatedFormats = searchParams.getAll("format") as NonNullable<SearchFilters["format"]>;
  if (repeatedFormats.length > 0) return repeatedFormats;

  const legacyFormat = searchParams.get("format") as NonNullable<SearchFilters["format"]>[number] | null;
  return legacyFormat ? [legacyFormat] : null;
}

function getResolvedArchiveSort(query: string, filters: SearchFilters) {
  const hasQuery = Boolean(query.trim());
  return filters.sort || (hasQuery ? "relevance" : "createdAt");
}

function mergeArchiveItems(
  current: ArchiveShelfItem[],
  incoming: ArchiveShelfItem[],
): ArchiveShelfItem[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];

  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }

  return next;
}

export default function HomePage() {
  const homeSeo = buildHomeSeo();
  const navigate = useNavigate();
  const { setDock } = useHeaderDock();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => {
    const urlQ = searchParams.get("q");
    if (urlQ) return urlQ;
    const saved = loadSearchState("home");
    return saved?.query || "";
  });
  const [filters, setFilters] = useState<SearchFilters>(() => {
    // If URL has any filter params, use those; otherwise restore from localStorage
    const hasUrlFilters = searchParams.get("q") || searchParams.get("collection")
      || searchParams.get("sender") || searchParams.get("recipient")
      || searchParams.get("format") || searchParams.get("sort")
      || searchParams.get("verified") || searchParams.get("hasTranscript");
    if (!hasUrlFilters) {
      const saved = loadSearchState("home");
      if (saved?.filters) return saved.filters;
    }
    return {
      format: getInitialFormats(searchParams),
      collection: searchParams.get("collection") || null,
      sender: searchParams.get("sender") || null,
      recipient: searchParams.get("recipient") || null,
      place: searchParams.get("place") || null,
      topic: searchParams.get("topic") ? searchParams.get("topic")!.split(",") : null,
      tone: searchParams.get("tone") ? searchParams.get("tone")!.split(",") : null,
      relationship: searchParams.get("relationship") ? searchParams.get("relationship")!.split(",") : null,
      year: searchParams.get("year") ? Number(searchParams.get("year")) : null,
      dateRange: searchParams.get("yearFrom") || searchParams.get("yearTo")
        ? {
            start: searchParams.get("yearFrom") ? Number(searchParams.get("yearFrom")) : undefined,
            end: searchParams.get("yearTo") ? Number(searchParams.get("yearTo")) : undefined,
          }
        : undefined,
      verified: searchParams.get("verified") === null
        ? null
        : searchParams.get("verified") === "true",
      sort: (searchParams.get("sort") as SearchFilters["sort"]) || undefined,
      sortOrder: (searchParams.get("sortOrder") as SearchFilters["sortOrder"]) || undefined,
    };
  });
  const [heroLetter, setHeroLetter] = useState<ArchiveShelfItem | null>(null);
  const [heroImages, setHeroImages] = useState<LetterImage[]>([]);
  const [heroPageIndex, setHeroPageIndex] = useState(0);
  const [latestBlogPost, setLatestBlogPost] = useState<BlogPost | null>(null);
  const [archiveResults, setArchiveResults] = useState<ArchiveSearchResponse>({
    letters: [],
    page: 1,
    limit: 24,
    total: 0,
    facets: {
      formats: [],
      collections: [],
      correspondents: [],
      places: [],
      years: [],
      topics: [],
      tones: [],
      relationships: [],
    },
  });
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveLoadingMore, setArchiveLoadingMore] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveLoadMoreError, setArchiveLoadMoreError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const archiveSearchRef = useRef<HTMLElement | null>(null);
  const searchDockTriggerRef = useRef<HTMLDivElement | null>(null);
  const [stickyDockActive, setStickyDockActive] = useState(false);
  const [pageRefineOpen, setPageRefineOpen] = useState(false);
  const [compactRefineOpen, setCompactRefineOpen] = useState(false);
  const [pageSortOpen, setPageSortOpen] = useState<boolean | undefined>(undefined);
  const [compactSortOpen, setCompactSortOpen] = useState<boolean | undefined>(undefined);
  const headerDropdownOpenRef = useRef(false);

  headerDropdownOpenRef.current = compactRefineOpen || compactSortOpen === true;

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

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchQuery.trim()) nextParams.set("q", searchQuery.trim());
    if (filters.format?.length) {
      filters.format.forEach((format) => nextParams.append("format", format));
    }
    if (filters.collection) nextParams.set("collection", filters.collection);
    if (filters.sender) nextParams.set("sender", filters.sender);
    if (filters.recipient) nextParams.set("recipient", filters.recipient);
    if (filters.place) nextParams.set("place", filters.place);
    if (filters.topic?.length) nextParams.set("topic", filters.topic.join(","));
    if (filters.tone?.length) nextParams.set("tone", filters.tone.join(","));
    if (filters.relationship?.length) nextParams.set("relationship", filters.relationship.join(","));
    if (filters.year) nextParams.set("year", String(filters.year));
    if (filters.dateRange?.start) nextParams.set("yearFrom", String(filters.dateRange.start));
    if (filters.dateRange?.end) nextParams.set("yearTo", String(filters.dateRange.end));
    if (filters.verified !== undefined && filters.verified !== null) {
      nextParams.set("verified", filters.verified ? "true" : "false");
    }
    if (filters.sort && filters.sort !== "relevance") nextParams.set("sort", filters.sort);
    if (filters.sortOrder && filters.sortOrder !== "desc") {
      nextParams.set("sortOrder", filters.sortOrder);
    }

    if (nextParams.toString() === searchParams.toString()) {
      return;
    }

    startTransition(() => {
      setSearchParams(nextParams, { replace: true });
    });
  }, [filters, searchParams, searchQuery, setSearchParams]);

  // Debounce localStorage persistence so it doesn't run on every keystroke
  useEffect(() => {
    const timer = window.setTimeout(() => saveSearchState("home", searchQuery, filters), 300);
    return () => window.clearTimeout(timer);
  }, [filters, searchQuery]);

  const requestParams = useMemo(
    () => ({
      limit: ARCHIVE_PAGE_SIZE,
      search: searchQuery.trim() || undefined,
      format: filters.format?.length ? filters.format : undefined,
      collection: filters.collection || undefined,
      sender: filters.sender || undefined,
      recipient: filters.recipient || undefined,
      place: filters.place || undefined,
      topic: filters.topic?.length ? filters.topic : undefined,
      tone: filters.tone?.length ? filters.tone : undefined,
      relationship: filters.relationship?.length ? filters.relationship : undefined,
      year: filters.year || undefined,
      yearFrom: filters.dateRange?.start,
      yearTo: filters.dateRange?.end,
      hasTranscript: filters.hasTranscript,
      verified: filters.verified,
      sort: filters.sort || undefined,
      sortOrder: filters.sortOrder || undefined,
    }),
    [filters, searchQuery],
  );

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;
    const timer = window.setTimeout(() => {
      setArchiveLoading(true);
      setArchiveLoadingMore(false);
      setArchiveError(null);
      setArchiveLoadMoreError(null);
      searchArchiveShelf({ ...requestParams, page: 1 })
        .then((response) => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveResults(response);
          setArchiveLoadMoreError(null);
        })
        .catch((error) => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveError(error instanceof Error ? error.message : "Failed to load archive results");
        })
        .finally(() => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [requestParams]);

  useEffect(() => {
    const trigger = searchDockTriggerRef.current || archiveSearchRef.current;
    if (!trigger) return;

    const header = document.querySelector(".header") as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    // IntersectionObserver with negative top margin equal to header height.
    // When not intersecting we check whether the trigger scrolled *above* the
    // header (activate) vs still being *below* the viewport (don't activate).
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Don't deactivate dock while a header dropdown is open —
          // content height changes can briefly expose the trigger
          if (!headerDropdownOpenRef.current) {
            setStickyDockActive(false);
          }
        } else {
          // bottom <= headerHeight means the trigger has scrolled under the header
          setStickyDockActive(entry.boundingClientRect.bottom <= headerHeight);
        }
      },
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(trigger);

    return () => observer.disconnect();
  }, []);

  // When header dropdown closes, re-evaluate whether dock should still be active
  useEffect(() => {
    const isHeaderDropdown = compactRefineOpen || compactSortOpen === true;
    if (isHeaderDropdown || !stickyDockActive) return;

    const trigger = searchDockTriggerRef.current || archiveSearchRef.current;
    if (!trigger) return;
    const header = document.querySelector(".header") as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    if (trigger.getBoundingClientRect().bottom > headerHeight) {
      setStickyDockActive(false);
    }
  }, [compactRefineOpen, compactSortOpen, stickyDockActive]);

  useEffect(() => {
    if (!stickyDockActive) {
      setDock(EMPTY_DOCK);
      return;
    }
    setDock({
      content: (
        <SearchBar
          query={searchQuery}
          filters={filters}
          facets={archiveResults.facets}
          total={archiveResults.total}
          loading={archiveLoading}
          embedded
          variant="compact"
          refineOpen={compactRefineOpen}
          sortOpen={compactSortOpen}
          onRefineOpenChange={(open) => {
            setCompactRefineOpen(open);
            if (open) {
              setPageRefineOpen(false);
            }
          }}
          onSortOpenChange={(open) => {
            setCompactSortOpen(open === false ? undefined : open);
            if (open) {
              setPageSortOpen(false);
            }
          }}
          onQueryChange={setSearchQuery}
          onFiltersChange={setFilters}
        />
      ),
      active: true,
      visible: true,
    });
  }, [
    archiveLoading,
    archiveResults.facets,
    archiveResults.total,
    compactRefineOpen,
    compactSortOpen,
    filters,
    searchQuery,
    setDock,
    stickyDockActive,
  ]);

  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

  useEffect(() => {
    if (!stickyDockActive) {
      if (compactRefineOpen) {
        setPageRefineOpen(true);
      }
      if (compactSortOpen === true) {
        setPageSortOpen(true);
      }
      setCompactRefineOpen(false);
      setCompactSortOpen(undefined);
    }
  }, [stickyDockActive]);

  const handleArchiveLoadMore = async () => {
    if (archiveLoading || archiveLoadingMore) return;
    if (archiveResults.letters.length >= archiveResults.total) return;

    const requestVersion = requestVersionRef.current;
    const nextPage = archiveResults.page + 1;

    setArchiveLoadingMore(true);
    setArchiveLoadMoreError(null);

    try {
      const response = await searchArchiveShelf({ ...requestParams, page: nextPage });
      if (requestVersion !== requestVersionRef.current) return;

      setArchiveResults((current) => ({
        ...response,
        letters: mergeArchiveItems(current.letters, response.letters),
      }));
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setArchiveLoadMoreError(
        error instanceof Error ? error.message : "Failed to load more archive results",
      );
    } finally {
      if (requestVersion !== requestVersionRef.current) return;
      setArchiveLoadingMore(false);
    }
  };

  const handleLetterClick = useCallback((letterId: string) => {
    navigate(`/letter/${letterId}`);
  }, [navigate]);

  const resolvedArchiveSort = getResolvedArchiveSort(searchQuery, filters);
  const archiveSortCueField = resolvedArchiveSort === "createdAt" || resolvedArchiveSort === "collection"
    ? resolvedArchiveSort
    : null;

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
        {heroLetter ? (() => {
          const currentImage = heroImages[heroPageIndex] || null;
          const heroSrc = currentImage?.imageUrl
            ? getImageUrl(currentImage.imageUrl, { width: 1200 })
            : heroLetter.imageUrl
              ? getImageUrl(heroLetter.imageUrl, { width: 1200 })
              : null;
          const hasMultiplePages = heroImages.length > 1;
          return (<button
            type="button"
            className={`letter-card home-hero-feature-card letter-card--${heroLetter.imageType}`}
            aria-label={heroAriaLabel}
            onClick={() => {
              const params = new URLSearchParams();
              params.set('from', 'highlight');
              if (currentImage) params.set('image', currentImage.id);
              navigate(`/letter/${heroLetter.id}?${params.toString()}`);
            }}
          >
            {heroSrc ? (
              <img
                className="letter-card-image"
                src={heroSrc}
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
              <span className="home-hero-feature-collection">Collection {heroLetter.collectionCode || '009'}</span>
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
          </button>);
        })() : (
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
          query={searchQuery}
          filters={filters}
          facets={archiveResults.facets}
          total={archiveResults.total}
          loading={archiveLoading}
          embedded
          variant="full"
          refineOpen={pageRefineOpen}
          sortOpen={pageSortOpen}
          dockTriggerRef={searchDockTriggerRef}
          onRefineOpenChange={(open) => {
            setPageRefineOpen(open);
            if (open) {
              setCompactRefineOpen(false);
            }
          }}
          onSortOpenChange={(open) => {
            setPageSortOpen(open === false ? undefined : open);
            if (open) {
              setCompactSortOpen(false);
            }
          }}
          onQueryChange={setSearchQuery}
          onFiltersChange={setFilters}
        />
        </div>

        <div className="home-surface-divider" aria-hidden="true" />

        <section className="home-archive-stage">
          <ArchiveList
            onLetterClick={handleLetterClick}
            letters={archiveResults.letters}
            total={archiveResults.total}
            loading={archiveLoading}
            loadingMore={archiveLoadingMore}
            error={archiveError}
            loadMoreError={archiveLoadMoreError}
            hasMore={archiveResults.letters.length < archiveResults.total}
            onLoadMore={handleArchiveLoadMore}
            sortCueField={archiveSortCueField}
          />
        </section>
      </section>

      <Footer />
      <BackToTop />
    </div>
  );
}
