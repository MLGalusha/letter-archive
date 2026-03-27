import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import SearchBar, { type SearchFilters } from '../components/SearchBar/SearchBar';
import ArchiveList from '../components/ArchiveList/ArchiveList';
import Breadcrumb from '../components/Breadcrumb';
import Footer from '../components/Footer/Footer';
import { NarrativeSection } from '../components/CollectionProfile';
import { getCollectionByCode, getCollectionProfile, type CollectionWithLetters, type CollectionProfile } from '../api/collections';
import { getImageUrl } from '../api/client';
import { searchArchiveShelf, type ArchiveSearchResponse } from '../api/letters';
import type { ArchiveShelfItem } from '../types/Letter';
import { EMPTY_DOCK, useHeaderDock } from '../contexts/HeaderDockContext';
import { getPrimaryImage } from '../utils/letterPreview';
import {
  computeCollectionStats,
  pickLetterHighlights,
  buildCorrespondents,
} from './collection-detail-utils';
import { buildCollectionSeo } from '../utils/seo';
import './CollectionDetailPage.css';

const ARCHIVE_PAGE_SIZE = 24;

function getResolvedArchiveSort(query: string, filters: SearchFilters) {
  const hasQuery = Boolean(query.trim());
  return filters.sort || (hasQuery ? 'relevance' : 'letterDate');
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

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();
  const { setDock } = useHeaderDock();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ---- Collection data (stats, highlights, timeline) ---- */
  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [profile, setProfile] = useState<CollectionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- Archive search state (mirrors HomePage) ---- */
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    collection: collectionCode || null,
    format: (() => {
      const vals = searchParams.getAll('format') as NonNullable<SearchFilters['format']>;
      return vals.length > 0 ? vals : null;
    })(),
    person: searchParams.get('person') || null,
    personRole: (searchParams.get('personRole') as SearchFilters['personRole']) || null,
    sender: searchParams.get('sender') || null,
    recipient: searchParams.get('recipient') || null,
    place: searchParams.get('place') || null,
    topic: searchParams.get('topic') || null,
    tone: searchParams.get('tone') || null,
    relationship: searchParams.get('relationship') || null,
    year: searchParams.get('year') ? Number(searchParams.get('year')) : null,
    dateRange: searchParams.get('yearFrom') || searchParams.get('yearTo')
      ? {
          start: searchParams.get('yearFrom') ? Number(searchParams.get('yearFrom')) : undefined,
          end: searchParams.get('yearTo') ? Number(searchParams.get('yearTo')) : undefined,
        }
      : undefined,
    verified: searchParams.get('verified') === null
      ? null
      : searchParams.get('verified') === 'true',
    sort: (searchParams.get('sort') as SearchFilters['sort']) || undefined,
    sortOrder: (searchParams.get('sortOrder') as SearchFilters['sortOrder']) || undefined,
  }));

  const [archiveResults, setArchiveResults] = useState<ArchiveSearchResponse>({
    letters: [],
    page: 1,
    limit: ARCHIVE_PAGE_SIZE,
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

  /* ---- Dock / sticky search ---- */
  const archiveSearchRef = useRef<HTMLElement | null>(null);
  const searchDockTriggerRef = useRef<HTMLDivElement | null>(null);
  const [stickyDockActive, setStickyDockActive] = useState(false);
  const [pageRefineOpen, setPageRefineOpen] = useState(false);
  const [compactRefineOpen, setCompactRefineOpen] = useState(false);
  const compactRefinePinnedRef = useRef(false);
  const [pageRefinePinned, setPageRefinePinned] = useState<boolean | undefined>(undefined);

  /* ---- Computed from collection data ---- */
  const collectionLetters = collection?.letters ?? [];

  const stats = useMemo(
    () => computeCollectionStats(collectionLetters),
    [collectionLetters],
  );

  const highlights = useMemo(
    () => pickLetterHighlights(collectionLetters, profile?.startHere?.letterId),
    [collectionLetters, profile?.startHere?.letterId],
  );

  const correspondents = useMemo(
    () => buildCorrespondents(collectionLetters, profile?.keyPeople),
    [collectionLetters, profile?.keyPeople],
  );

  /* ---- Fetch collection + profile ---- */
  useEffect(() => {
    if (!collectionCode) return;

    async function fetchCollection() {
      try {
        const [data, profileData] = await Promise.all([
          getCollectionByCode(collectionCode!),
          getCollectionProfile(collectionCode!).catch(() => null),
        ]);
        setCollection(data);
        setProfile(profileData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Collection not found');
      } finally {
        setLoading(false);
      }
    }

    fetchCollection();
  }, [collectionCode]);

  /* ---- Sync filters → URL params (excluding collection) ---- */
  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchQuery.trim()) nextParams.set('q', searchQuery.trim());
    if (filters.format?.length) {
      filters.format.forEach((f) => nextParams.append('format', f));
    }
    // collection is NOT synced — it's implicit from the route
    if (filters.person) nextParams.set('person', filters.person);
    if (filters.person && filters.personRole && filters.personRole !== 'any') {
      nextParams.set('personRole', filters.personRole);
    }
    if (filters.sender) nextParams.set('sender', filters.sender);
    if (filters.recipient) nextParams.set('recipient', filters.recipient);
    if (filters.place) nextParams.set('place', filters.place);
    if (filters.topic) nextParams.set('topic', filters.topic);
    if (filters.tone) nextParams.set('tone', filters.tone);
    if (filters.relationship) nextParams.set('relationship', filters.relationship);
    if (filters.year) nextParams.set('year', String(filters.year));
    if (filters.dateRange?.start) nextParams.set('yearFrom', String(filters.dateRange.start));
    if (filters.dateRange?.end) nextParams.set('yearTo', String(filters.dateRange.end));
    if (filters.verified !== undefined && filters.verified !== null) {
      nextParams.set('verified', filters.verified ? 'true' : 'false');
    }
    if (filters.sort && filters.sort !== 'relevance') nextParams.set('sort', filters.sort);
    if (filters.sortOrder && filters.sortOrder !== 'desc') {
      nextParams.set('sortOrder', filters.sortOrder);
    }

    if (nextParams.toString() === searchParams.toString()) return;

    startTransition(() => {
      setSearchParams(nextParams, { replace: true });
    });
  }, [filters, searchParams, searchQuery, setSearchParams]);

  /* ---- Build request params ---- */
  const requestParams = useMemo(
    () => ({
      limit: ARCHIVE_PAGE_SIZE,
      search: searchQuery.trim() || undefined,
      format: filters.format?.length ? filters.format : undefined,
      collection: collectionCode || undefined,
      person: filters.person || undefined,
      personRole: filters.person && filters.personRole && filters.personRole !== 'any'
        ? filters.personRole
        : undefined,
      sender: filters.sender || undefined,
      recipient: filters.recipient || undefined,
      place: filters.place || undefined,
      topic: filters.topic || undefined,
      tone: filters.tone || undefined,
      relationship: filters.relationship || undefined,
      year: filters.year || undefined,
      yearFrom: filters.dateRange?.start,
      yearTo: filters.dateRange?.end,
      verified: filters.verified,
      sort: filters.sort || undefined,
      sortOrder: filters.sortOrder || undefined,
    }),
    [collectionCode, filters, searchQuery],
  );

  /* ---- Execute search ---- */
  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;
    const delay = searchQuery.trim()
      || filters.person?.trim()
      || filters.sender?.trim()
      || filters.recipient?.trim()
      || filters.place?.trim()
      || filters.topic?.trim()
      ? 180
      : 0;

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
        .catch((err) => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveError(err instanceof Error ? err.message : 'Failed to load archive results');
        })
        .finally(() => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveLoading(false);
        });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [requestParams, searchQuery]);

  /* ---- IntersectionObserver for sticky header search ---- */
  useEffect(() => {
    const trigger = searchDockTriggerRef.current || archiveSearchRef.current;
    if (!trigger) return;

    const header = document.querySelector('.header') as HTMLElement | null;
    const headerHeight = header?.offsetHeight || 80;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStickyDockActive(false);
        } else {
          setStickyDockActive(entry.boundingClientRect.bottom <= headerHeight);
        }
      },
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [loading]);

  /* ---- Header dock content ---- */
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
          hideCollectionFilter
          compactPlaceholder={`Search Collection ${collection?.collectionCode || collectionCode}...`}
          refineOpen={compactRefineOpen}
          onRefineOpenChange={(open) => {
            setCompactRefineOpen(open);
            if (open) {
              setPageRefineOpen(false);
              setPageRefinePinned(undefined);
            }
          }}
          onPinnedChange={(pinned) => {
            compactRefinePinnedRef.current = pinned;
          }}
          onQueryChange={setSearchQuery}
          onFiltersChange={handleFiltersChange}
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
    filters,
    searchQuery,
    setDock,
    stickyDockActive,
  ]);

  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

  useEffect(() => {
    if (!stickyDockActive) {
      if (compactRefinePinnedRef.current) {
        setPageRefineOpen(true);
        setPageRefinePinned(true);
      }
      compactRefinePinnedRef.current = false;
      setCompactRefineOpen(false);
    }
  }, [stickyDockActive]);

  /* ---- Handlers ---- */
  const handleFiltersChange = useCallback((newFilters: SearchFilters) => {
    setFilters({ ...newFilters, collection: collectionCode || null });
  }, [collectionCode]);

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
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      setArchiveLoadMoreError(
        err instanceof Error ? err.message : 'Failed to load more archive results',
      );
    } finally {
      if (requestVersion !== requestVersionRef.current) return;
      setArchiveLoadingMore(false);
    }
  };

  const handleLetterClick = useCallback((letterId: string) => {
    navigate(`/letter/${letterId}`);
  }, [navigate]);

  const handleBack = () => {
    navigate('/collections');
  };

  /* ---- Derived ---- */
  const resolvedArchiveSort = getResolvedArchiveSort(searchQuery, filters);
  const archiveSortCueField = resolvedArchiveSort === 'createdAt' ? 'createdAt' as const : null;

  const topCorrespondents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const letter of collectionLetters) {
      const sender = letter.metadata.sender?.trim();
      const recipient = letter.metadata.recipient?.trim();
      if (sender) counts.set(sender, (counts.get(sender) || 0) + 1);
      if (recipient) counts.set(recipient, (counts.get(recipient) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [collectionLetters]);

  const dateRange = useMemo(() => {
    const values = collectionLetters
      .map((letter) => letter.metadata.date || letter.metadata.dateRaw)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (values.length === 0) return null;
    const sorted = [...values].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  }, [collectionLetters]);

  /* ---- Loading / error states ---- */
  if (loading) {
    return (
      <div className="body-layout">
        <div className="collection-detail-public">
          <p className="loading-message">Loading collection...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!collection || error) {
    return (
      <div className="body-layout">
        <div className="collection-detail-public">
          <button onClick={handleBack} className="back-link">
            &larr; All Collections
          </button>
          <h1>Collection Not Found</h1>
          <p className="error-text">
            {error || 'This collection does not exist or has no published letters.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const seo = buildCollectionSeo(collection, dateRange, topCorrespondents);

  return (
    <div className="body-layout">
      <SEO
        title={seo.title}
        description={seo.description}
        canonicalUrl={seo.canonicalPath}
        ogType={seo.ogType}
        jsonLd={seo.jsonLd}
      />
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Collections', href: '/collections' },
          { label: collection.title || collection.collectionCode },
        ]}
      />
      <div className="collection-detail-public">

        {/* ---- 1. Header + Stats ---- */}
        <div className="cd-header">
          <div className="cd-header-top">
            <span className="cd-code-badge">{collection.collectionCode}</span>
            <span className="cd-letter-count">
              {collectionLetters.length} item{collectionLetters.length !== 1 ? 's' : ''}
            </span>
          </div>
          <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
          {collection.description && (
            <p className="cd-description">{collection.description}</p>
          )}
          <div className="cd-stats-row">
            {stats.dateSpan && (
              <span className="cd-stat-chip">{stats.dateSpan.label}</span>
            )}
            {stats.writingFrequency && (
              <span className="cd-stat-chip">{stats.writingFrequency}</span>
            )}
            <span className="cd-stat-chip">{stats.formatBreakdown}</span>
            {stats.largestGap && (
              <span className="cd-stat-chip">{stats.largestGap.label}</span>
            )}
          </div>
        </div>

        {/* ---- 2. Narrative (optional, AI-generated) ---- */}
        {profile?.narrative && (
          <NarrativeSection
            narrative={profile.narrative}
            status={profile.profileStatus}
          />
        )}

        {/* ---- 3. Letter Highlights ---- */}
        {highlights.length > 0 && (
          <section className="cd-highlights">
            <h2>Highlights</h2>
            <div className="cd-highlights-grid">
              {highlights.map(({ letter, label }, idx) => {
                const img = getPrimaryImage(letter);
                const imgWidths = [800, 640, 480, 480];
                const imgWidth = imgWidths[idx] ?? 480;
                return (
                  <button
                    type="button"
                    key={letter.id}
                    className={`cd-highlight-item cd-highlight-item--${idx + 1}`}
                    onClick={() => handleLetterClick(letter.id)}
                  >
                    <span className="cd-highlight-label">{label}</span>
                    {img?.imageUrl ? (
                      <img
                        className="cd-highlight-img"
                        src={getImageUrl(img.imageUrl, { width: imgWidth })}
                        alt={letter.metadata.hook || label}
                        loading="lazy"
                      />
                    ) : (
                      <div className="cd-highlight-fallback">
                        <span>{letter.metadata.date || letter.metadata.dateRaw || label}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- 4. People ---- */}
        {correspondents.length > 0 && (
          <section className="cd-people">
            <h2>People</h2>
            <div className="cd-people-grid">
              {correspondents.map((person) => (
                <div key={person.name} className="cd-person-card">
                  <h3 className="cd-person-name">{person.name}</h3>
                  <div className="cd-person-role">
                    {person.sentCount > 0 && (
                      <span>Sent {person.sentCount}</span>
                    )}
                    {person.sentCount > 0 && person.receivedCount > 0 && (
                      <span className="cd-person-divider">&middot;</span>
                    )}
                    {person.receivedCount > 0 && (
                      <span>Received {person.receivedCount}</span>
                    )}
                  </div>
                  {person.biography && (
                    <p className="cd-person-bio">{person.biography}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- 5. Search + Archive List ---- */}
        <section id="collection-archive" className="cd-archive-surface" ref={archiveSearchRef}>
          <div className="cd-search-panel">
            <SearchBar
              query={searchQuery}
              filters={filters}
              facets={archiveResults.facets}
              total={archiveResults.total}
              loading={archiveLoading}
              embedded
              variant="full"
              hideCollectionFilter
              searchKicker={`Collection ${collection.collectionCode}`}
              searchTitle="Search This Collection"
              refineOpen={pageRefineOpen}
              refinePinned={pageRefinePinned}
              dockTriggerRef={searchDockTriggerRef}
              onRefineOpenChange={(open) => {
                setPageRefineOpen(open);
                if (open) {
                  setCompactRefineOpen(false);
                }
              }}
              onPinnedChange={() => {
                setPageRefinePinned(undefined);
              }}
              onQueryChange={setSearchQuery}
              onFiltersChange={handleFiltersChange}
            />
          </div>

          <section className="cd-archive-stage">
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

      </div>
      <Footer />
    </div>
  );
}
