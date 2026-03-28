import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
// ReactMouseEvent used by HighlightCard page navigation
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import SearchBar, { type SearchFilters } from '../components/SearchBar/SearchBar';
import ArchiveList from '../components/ArchiveList/ArchiveList';
import Footer from '../components/Footer/Footer';
import BackToTop from '../components/BackToTop';
import { getCollectionByCode, getCollectionProfile, type CollectionWithLetters, type CollectionProfile } from '../api/collections';
import { getImageUrl } from '../api/client';
import { searchArchiveShelf, type ArchiveSearchResponse } from '../api/letters';
import type { ArchiveShelfItem } from '../types/Letter';
import { EMPTY_DOCK, useHeaderDock } from '../contexts/HeaderDockContext';
import { getPrimaryImage, getPrimaryMediaType, getMediaLabel } from '../utils/letterPreview';
import {
  computeCollectionStats,
  pickLetterHighlights,
  buildCorrespondents,
  buildExtraContentGallery,
  type GalleryItem,
} from './collection-detail-utils';
import HeaderScrubber from '../components/HeaderScrubber/HeaderScrubber';
import useCollectionScrubber from '../components/CollectionHeaderDock/useCollectionScrubber';
import { buildCollectionSeo } from '../utils/seo';
import { saveSearchState, loadSearchState } from '../utils/searchPersistence';
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

/* ---- Highlight Card with page navigation ---- */

function HighlightCard({
  letter,
  label,
  onNavigate,
}: {
  letter: import('../types/Letter').Letter;
  label: string;
  onNavigate: (letterId: string, imageId?: string) => void;
}) {
  const images = letter.images || [];
  const [pageIndex, setPageIndex] = useState(0);
  const currentImage = images[pageIndex];
  const hasMultiplePages = images.length > 1;

  const mediaType = getPrimaryMediaType(letter);
  const mediaLabel = getMediaLabel(mediaType);
  const sender = letter.metadata.sender?.trim();
  const recipient = letter.metadata.recipient?.trim();
  const peopleLine = sender && recipient
    ? `${sender} \u2192 ${recipient}`
    : sender || recipient || '';
  const date = letter.metadata.date || letter.metadata.dateRaw || '';
  const hook = mediaType === 'photo'
    ? (letter.photoDescription || letter.metadata.hook || '')
    : (letter.metadata.hook || letter.photoDescription || '');
  const chipLabel = label.toLowerCase() === mediaLabel.toLowerCase()
    ? label
    : `${label} \u00B7 ${mediaLabel}`;

  const handlePrevPage = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setPageIndex((i) => (i === 0 ? images.length - 1 : i - 1));
  };

  const handleNextPage = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setPageIndex((i) => (i === images.length - 1 ? 0 : i + 1));
  };

  return (
    <button
      type="button"
      className={`cd-highlight-card cd-highlight-card--${mediaType}`}
      onClick={() => onNavigate(letter.id, currentImage?.id)}
    >
      {currentImage?.imageUrl ? (
        <img
          className="cd-highlight-img"
          src={getImageUrl(currentImage.imageUrl, { width: 720 })}
          alt={hook || label}
          loading="lazy"
        />
      ) : (
        <div className="cd-highlight-placeholder" />
      )}
      <div className="cd-highlight-overlay" />
      <span className="cd-highlight-label">{chipLabel}</span>
      <div className="cd-highlight-content">
        {peopleLine && (
          <span className="cd-highlight-meta">{peopleLine}</span>
        )}
        {date && (
          <span className="cd-highlight-date">{date}</span>
        )}
        {hook && (
          <p className="cd-highlight-hook">{hook}</p>
        )}
      </div>
      {hasMultiplePages && (
        <>
          <span className="cd-highlight-page-counter">
            {pageIndex + 1}/{images.length}
          </span>
          <div
            className="cd-highlight-zone cd-highlight-zone--prev"
            onClick={handlePrevPage}
            aria-label="Previous page"
          />
          <div
            className="cd-highlight-zone cd-highlight-zone--next"
            onClick={handleNextPage}
            aria-label="Next page"
          />
        </>
      )}
    </button>
  );
}

/* ---- Gallery Card — cycles through all photos + covers ---- */

function GalleryCard({
  items,
  onNavigate,
}: {
  items: GalleryItem[];
  onNavigate: (letterId: string, imageId?: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const item = items[index];

  const peopleLine = item.sender && item.recipient
    ? `${item.sender} \u2192 ${item.recipient}`
    : item.sender || item.recipient || '';

  const handlePrev = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setIndex((i) => (i === 0 ? items.length - 1 : i - 1));
  };

  const handleNext = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setIndex((i) => (i === items.length - 1 ? 0 : i + 1));
  };

  return (
    <button
      type="button"
      className={`cd-highlight-card cd-highlight-card--${item.mediaType}`}
      onClick={() => onNavigate(item.letterId, item.imageId)}
    >
      <img
        className="cd-highlight-img"
        src={getImageUrl(item.imageUrl, { width: 720 })}
        alt={item.hook || item.mediaLabel}
        loading="lazy"
      />
      <div className="cd-highlight-overlay" />
      <span className="cd-highlight-label">{item.mediaLabel}</span>
      <div className="cd-highlight-content">
        {peopleLine && (
          <span className="cd-highlight-meta">{peopleLine}</span>
        )}
        {item.date && (
          <span className="cd-highlight-date">{item.date}</span>
        )}
        {item.hook && (
          <p className="cd-highlight-hook">{item.hook}</p>
        )}
      </div>
      {items.length > 1 && (
        <>
          <span className="cd-highlight-page-counter">
            {index + 1}/{items.length}
          </span>
          <div
            className="cd-highlight-zone cd-highlight-zone--prev"
            onClick={handlePrev}
            aria-label="Previous"
          />
          <div
            className="cd-highlight-zone cd-highlight-zone--next"
            onClick={handleNext}
            aria-label="Next"
          />
        </>
      )}
    </button>
  );
}

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();
  const { setDock } = useHeaderDock();
  const collectionScrubberProps = useCollectionScrubber(collectionCode);
  const [searchParams, setSearchParams] = useSearchParams();

  /* ---- Collection data ---- */
  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [profile, setProfile] = useState<CollectionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- Archive search state (mirrors HomePage) ---- */
  const collectionStorageKey = `collection:${collectionCode}`;
  const [searchQuery, setSearchQuery] = useState(() => {
    const urlQ = searchParams.get('q');
    if (urlQ) return urlQ;
    const saved = loadSearchState(collectionStorageKey);
    return saved?.query || '';
  });
  const [filters, setFilters] = useState<SearchFilters>(() => {
    const hasUrlFilters = searchParams.get('q') || searchParams.get('sender')
      || searchParams.get('recipient') || searchParams.get('format')
      || searchParams.get('sort') || searchParams.get('verified')
      || searchParams.get('hasTranscript');
    if (!hasUrlFilters) {
      const saved = loadSearchState(collectionStorageKey);
      if (saved?.filters) return { ...saved.filters, collection: collectionCode || null };
    }
    return {
      collection: collectionCode || null,
      format: (() => {
        const vals = searchParams.getAll('format') as NonNullable<SearchFilters['format']>;
        return vals.length > 0 ? vals : null;
      })(),
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
      sortOrder: (searchParams.get('sortOrder') as SearchFilters['sortOrder']) || 'asc',
    };
  });

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
  const [pageSortOpen, setPageSortOpen] = useState<boolean | undefined>(undefined);
  const [compactSortOpen, setCompactSortOpen] = useState<boolean | undefined>(undefined);

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

  const gallery = useMemo(
    () => buildExtraContentGallery(collectionLetters),
    [collectionLetters],
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

    // Persist to localStorage for cross-navigation restoration
    saveSearchState(collectionStorageKey, searchQuery, filters);

    if (nextParams.toString() === searchParams.toString()) return;

    startTransition(() => {
      setSearchParams(nextParams, { replace: true });
    });
  }, [filters, searchParams, searchQuery, setSearchParams, collectionStorageKey]);

  /* ---- Build request params ---- */
  const requestParams = useMemo(
    () => ({
      limit: ARCHIVE_PAGE_SIZE,
      search: searchQuery.trim() || undefined,
      format: filters.format?.length ? filters.format : undefined,
      collection: collectionCode || undefined,
      sender: filters.sender || undefined,
      recipient: filters.recipient || undefined,
      place: filters.place || undefined,
      topic: filters.topic || undefined,
      tone: filters.tone || undefined,
      relationship: filters.relationship || undefined,
      year: filters.year || undefined,
      yearFrom: filters.dateRange?.start,
      yearTo: filters.dateRange?.end,
      hasTranscript: filters.hasTranscript,
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
  const collectionsLinkOverride = useMemo(() => ({
    label: 'Collections',
    to: '/collections',
  }), []);

  useEffect(() => {
    if (stickyDockActive) {
      // Show compact search when scrolled past search bar
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
            sortOpen={compactSortOpen}
            onRefineOpenChange={(open) => {
              setCompactRefineOpen(open);
              if (open) {
                setPageRefineOpen(false);
                setPageRefinePinned(undefined);
              }
            }}
            onSortOpenChange={(open) => {
              setCompactSortOpen(open === false ? undefined : open);
              if (open) setPageSortOpen(false);
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
        collectionsLink: collectionsLinkOverride,
      });
    } else if (collectionScrubberProps) {
      // Show collection scrubber when above the search bar
      setDock({
        content: <HeaderScrubber {...collectionScrubberProps} />,
        active: true,
        visible: true,
        showTitle: true,
        collectionsLink: collectionsLinkOverride,
      });
    } else if (!loading) {
      // Only clear dock after loading is done (preserves previous dock during transitions)
      setDock(EMPTY_DOCK);
    }
  }, [
    archiveLoading,
    archiveResults.facets,
    archiveResults.total,
    collection,
    collectionCode,
    collectionScrubberProps,
    collectionsLinkOverride,
    compactRefineOpen,
    compactSortOpen,
    filters,
    loading,
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

  const handleLetterClick = useCallback((letterId: string, imageId?: string) => {
    const params = new URLSearchParams();
    if (imageId) params.set('image', imageId);
    const qs = params.toString();
    navigate(`/letter/${letterId}${qs ? `?${qs}` : ''}`);
  }, [navigate]);

  const handleHighlightClick = useCallback((letterId: string, imageId?: string) => {
    const params = new URLSearchParams();
    params.set('from', 'highlight');
    if (imageId) params.set('image', imageId);
    navigate(`/letter/${letterId}?${params.toString()}`);
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

  const hasExploreContent = correspondents.length > 0 || highlights.length > 0 || gallery.length > 0;

  /* ---- Loading / error states ---- */
  if (loading) {
    return (
      <div className="body-layout">
        <div className="collection-detail-public">
          <p className="loading-message">Loading collection...</p>
        </div>
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
      <div className="collection-detail-public">

        {/* ---- 1. Header + Inline Stats ---- */}
        <header className="cd-header">
          <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
          {collection.description && (
            <p className="cd-description">{collection.description}</p>
          )}
          <div className="cd-stats-line">
            {stats.dateSpan && (
              <span className="cd-stat-date">{stats.dateSpan.label}</span>
            )}
            <span className="cd-stat-format">{stats.formatBreakdown}</span>
          </div>
        </header>

        {/* ---- 2. Narrative (optional, standalone) ---- */}
        {profile?.narrative && (
          <section className="cd-narrative">
            <div className="cd-narrative-label">About This Collection</div>
            <p>{profile.narrative}</p>
          </section>
        )}

        {/* ---- 3. People + Highlights (side by side) ---- */}
        {hasExploreContent && (
          <section className="cd-explore">
            {/* People (text-only cards) */}
            {correspondents.length > 0 && (
              <div className="cd-people-col">
                <h3 className="cd-people-title">People</h3>
                {correspondents.map((person) => (
                  <button
                    type="button"
                    key={person.name}
                    className="cd-person-card"
                    onClick={() => {
                      /* Person page navigation — will use canonical person ID in Phase 2 */
                      navigate(`/collections/${collectionCode}?sender=${encodeURIComponent(person.name)}`);
                    }}
                  >
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
                    {person.hook && (
                      <p className="cd-person-hook">{person.hook}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Highlights (image cards with overlay) */}
            {(highlights.length > 0 || gallery.length > 0) && (
              <div className="cd-highlights-col">
                {highlights.map(({ letter, label }) => (
                  <HighlightCard
                    key={letter.id}
                    letter={letter}
                    label={label}
                    onNavigate={handleHighlightClick}
                  />
                ))}
                {gallery.length > 0 && (
                  <GalleryCard
                    items={gallery}
                    onNavigate={handleHighlightClick}
                  />
                )}
              </div>
            )}
          </section>
        )}

        {/* ---- 4. Search + Archive List (unchanged) ---- */}
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
                if (open) setCompactSortOpen(false);
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
      <BackToTop />
    </div>
  );
}
