import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import SEO from "../components/SEO";
import SearchBar, { type SearchFilters } from "../components/SearchBar/SearchBar";
import ArchiveList from "../components/ArchiveList/ArchiveList";
import Footer from "../components/Footer/Footer";
import { getImageUrl, listBlogPosts, type BlogPost } from "../api/client";
import {
  getArchiveShelfItems,
  searchArchiveShelf,
  type ArchiveSearchResponse,
} from "../api/letters";
import type { ArchiveShelfItem } from "../types/Letter";
import { buildHomeSeo } from "../utils/seo";
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

export default function HomePage() {
  const homeSeo = buildHomeSeo();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") || "");
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    format: (searchParams.get("format") as SearchFilters["format"]) || null,
    person: searchParams.get("person") || null,
    place: searchParams.get("place") || null,
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
  }));
  const [heroLetter, setHeroLetter] = useState<ArchiveShelfItem | null>(null);
  const [latestBlogPost, setLatestBlogPost] = useState<BlogPost | null>(null);
  const [archiveResults, setArchiveResults] = useState<ArchiveSearchResponse>({
    letters: [],
    page: 1,
    limit: 24,
    total: 0,
    facets: {
      formats: [],
      correspondents: [],
      places: [],
      years: [],
    },
  });
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState<string | null>(null);

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
      setHeroLetter(pickHeroLetter(heroData?.letters || []));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchQuery.trim()) nextParams.set("q", searchQuery.trim());
    if (filters.format) nextParams.set("format", filters.format);
    if (filters.person) nextParams.set("person", filters.person);
    if (filters.place) nextParams.set("place", filters.place);
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

  const requestParams = useMemo(
    () => ({
      limit: 24,
      search: searchQuery.trim() || undefined,
      format: filters.format || undefined,
      person: filters.person || undefined,
      place: filters.place || undefined,
      year: filters.year || undefined,
      yearFrom: filters.dateRange?.start,
      yearTo: filters.dateRange?.end,
      verified: filters.verified,
      sort: filters.sort || undefined,
      sortOrder: filters.sortOrder || undefined,
    }),
    [filters, searchQuery],
  );

  useEffect(() => {
    let cancelled = false;
    const delay = searchQuery.trim() || filters.person?.trim() || filters.place?.trim() ? 180 : 0;
    const timer = window.setTimeout(() => {
      setArchiveLoading(true);
      setArchiveError(null);
      searchArchiveShelf(requestParams)
        .then((response) => {
          if (cancelled) return;
          setArchiveResults(response);
        })
        .catch((error) => {
          if (cancelled) return;
          setArchiveError(error instanceof Error ? error.message : "Failed to load archive results");
        })
        .finally(() => {
          if (cancelled) return;
          setArchiveLoading(false);
        });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [requestParams, searchQuery]);

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

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
          <p className="home-kicker">Two Ways Into the Archive</p>
          <h1 className="home-headline">
            Search for a specific letter, or enter through a collection.
          </h1>
          <p className="home-subtitle">
            Use archive search when you know a name, place, date, or remembered phrase.
            Use collections when you want to stay inside one family thread, one moment,
            or one body of material.
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
          <Link
            to={`/letter/${heroLetter.id}`}
            className={`letter-card home-hero-feature-card letter-card--${heroLetter.imageType}`}
            aria-label={heroAriaLabel}
          >
            {heroLetter.imageUrl ? (
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
            <div className="home-hero-feature-label">Featured Letter · Collection 009</div>
            {heroLetter.primaryChip && <div className="letter-card-page-count">{heroLetter.primaryChip}</div>}
            <div className="letter-card-content">
              {heroPeopleLine && <div className="letter-card-meta">{heroPeopleLine}</div>}
              {heroDate && <div className="letter-card-date">{heroDate}</div>}
              {heroLetter.hook && <p className="letter-hook">{heroLetter.hook}</p>}
            </div>
          </Link>
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
            <div className="section-eyebrow">Latest From the Blog</div>
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

      <section id="archive-search" className="home-archive-surface">
        <div className="home-search-panel">
          <SearchBar
            query={searchQuery}
            filters={filters}
            facets={archiveResults.facets}
            total={archiveResults.total}
            loading={archiveLoading}
            embedded
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
            error={archiveError}
          />
        </section>
      </section>

      <Footer />
    </div>
  );
}
