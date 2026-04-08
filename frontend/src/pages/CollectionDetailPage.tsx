import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SEO from '../components/SEO';
import SearchBar from '../components/SearchBar/SearchBar';
import ArchiveList from '../components/ArchiveList/ArchiveList';
import Footer from '../components/Footer/Footer';
import BackToTop from '../components/BackToTop';
import { getCollectionByCode, getCollectionProfile, type CollectionWithLetters, type CollectionProfile } from '../api/collections';
import { imagePreloadService } from '../services/imagePreloadService';
import { EMPTY_DOCK, useHeaderDock } from '../contexts/HeaderDockContext';
import { getPrimaryMediaType } from '../utils/letterPreview';
import {
  computeCollectionStats,
  pickLetterHighlights,
  buildCorrespondents,
  buildExtraContentGallery,
} from './collection-detail-utils';
import HeaderScrubber from '../components/HeaderScrubber/HeaderScrubber';
import useCollectionScrubber from '../components/CollectionHeaderDock/useCollectionScrubber';
import { buildCollectionSeo, buildNotFoundSeo } from '../utils/seo';
import useArchiveSearch from '../hooks/useArchiveSearch';
import useStickyDock from '../hooks/useStickyDock';
import ShowcaseCard, { type ShowcaseItem } from '../components/ShowcaseCard';
import InfiniteCarousel from '../components/InfiniteCarousel';
import useIsMobile from '../hooks/useIsMobile';
import useIsTouchDevice from '../hooks/useIsTouchDevice';
import useSwipeNavigation from '../hooks/useSwipeNavigation';
import useAdjacentCollections from '../hooks/useAdjacentCollections';
import './CollectionDetailPage.css';

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();
  const { setDock } = useHeaderDock();
  const collectionScrubberProps = useCollectionScrubber(collectionCode);
  const isMobile = useIsMobile(640);
  const isTouchDevice = useIsTouchDevice();
  const adjacentCollections = useAdjacentCollections(collectionCode);

  const { ref: swipeRef, offset: swipeOffset, isSwiping, isAnimating } = useSwipeNavigation({
    onSwipeLeft: adjacentCollections.next
      ? () => navigate(`/collections/${adjacentCollections.next!.collectionCode}`)
      : undefined,
    onSwipeRight: adjacentCollections.prev
      ? () => navigate(`/collections/${adjacentCollections.prev!.collectionCode}`)
      : undefined,
    enabled: isTouchDevice && !!(adjacentCollections.prev || adjacentCollections.next),
  });

  /* ---- Collection data ---- */
  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [profile, setProfile] = useState<CollectionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- Popup state ---- */
  const [popup, setPopup] = useState<{ title: string; content: ReactNode } | null>(null);

  /* ---- Archive search (extracted hook) ---- */
  const fixedFilters = useMemo(
    () => ({ collection: collectionCode || null }),
    [collectionCode],
  );
  const archive = useArchiveSearch({
    storageKey: `collection:${collectionCode}`,
    defaultSort: 'letterDate',
    defaultSortOrder: 'asc',
    fixedFilters,
  });

  /* ---- Sticky dock (extracted hook) ---- */
  const archiveSearchRef = useRef<HTMLElement | null>(null);
  const searchDockTriggerRef = useRef<HTMLDivElement | null>(null);
  const dock = useStickyDock({
    triggerRef: searchDockTriggerRef,
    sectionRef: archiveSearchRef,
    enabled: !loading,
  });

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
    () => buildCorrespondents(collectionLetters, profile?.keyPeople, profile?.profileCorrespondents),
    [collectionLetters, profile?.keyPeople, profile?.profileCorrespondents],
  );

  const gallery = useMemo(
    () => buildExtraContentGallery(collectionLetters),
    [collectionLetters],
  );

  /* ---- Fetch collection + profile ---- */
  useEffect(() => {
    if (!collectionCode) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setCollection(null);
    setProfile(null);

    async function fetchCollection() {
      try {
        const [data, profileData] = await Promise.all([
          getCollectionByCode(collectionCode!),
          getCollectionProfile(collectionCode!).catch(() => null),
        ]);
        if (cancelled) return;
        setCollection(data);
        setProfile(profileData);
        // Start preloading carousel-width images for all letters in this collection
        if (data?.letters) {
          imagePreloadService.preloadCollection(data.letters);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Collection not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCollection();
    return () => { cancelled = true; };
  }, [collectionCode]);

  /* ---- Header dock content ---- */
  const collectionsLinkOverride = useMemo(() => ({
    label: 'Collections',
    to: '/collections',
  }), []);

  useEffect(() => {
    if (dock.stickyDockActive) {
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
            hideCollectionFilter
            compactPlaceholder={`Search Collection ${collection?.collectionCode || collectionCode}...`}
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
        collectionsLink: collectionsLinkOverride,
      });
    } else if (collectionScrubberProps) {
      setDock({
        content: <HeaderScrubber {...collectionScrubberProps} />,
        active: true,
        visible: true,
        showTitle: true,
        collectionsLink: collectionsLinkOverride,
      });
    } else {
      // Reserve header dock space while scrubber data loads so the content
      // below doesn't jump when the dock appears (active=true expands the
      // brand slot; visible=false keeps it invisible until content is ready).
      setDock({
        content: null,
        active: true,
        visible: false,
        showTitle: true,
        collectionsLink: collectionsLinkOverride,
      });
    }
  }, [
    archive.archiveLoading,
    archive.archiveResults.facets,
    archive.archiveResults.total,
    archive.filters,
    archive.searchQuery,
    archive.setFilters,
    archive.setSearchQuery,
    collection,
    collectionCode,
    collectionScrubberProps,
    collectionsLinkOverride,
    dock.compactRefineOpen,
    dock.compactSortOpen,
    dock.setCompactRefineOpen,
    dock.setCompactSortOpen,
    dock.setPageRefineOpen,
    dock.setPageSortOpen,
    dock.stickyDockActive,
    loading,
    setDock,
  ]);

  useEffect(() => () => setDock(EMPTY_DOCK), [setDock]);

  /* ---- Handlers ---- */
  const handleLetterClick = useCallback((letterId: string, imageId?: string) => {
    const params = new URLSearchParams();
    if (imageId) params.set('image', imageId);
    const qs = params.toString();
    navigate(`/letter/${letterId}${qs ? `?${qs}` : ''}`);
  }, [navigate]);

  const carouselPauseRef = useRef<() => void>(() => {});

  const handleHighlightClick = useCallback((letterId: string, imageId?: string) => {
    const params = new URLSearchParams();
    params.set('from', 'highlight');
    if (imageId) params.set('image', imageId);
    navigate(`/letter/${letterId}?${params.toString()}`);
  }, [navigate]);

  const handleBack = () => {
    navigate('/collections');
  };

  /* ---- Build ShowcaseCard items from highlights ---- */
  const highlightShowcaseItems = useMemo(() => {
    return highlights.map(({ letter }) => {
      const images = letter.images || [];
      const mediaType = getPrimaryMediaType(letter);
      const sender = letter.metadata.sender?.trim();
      const recipient = letter.metadata.recipient?.trim();
      const peopleLine = sender && recipient
        ? `${sender} \u2192 ${recipient}`
        : sender || recipient || '';
      const date = letter.metadata.date || letter.metadata.dateRaw || '';
      const hook = mediaType === 'photo'
        ? (letter.photoDescription || letter.metadata.hook || '')
        : (letter.metadata.hook || letter.photoDescription || '');
      const chipLabel = 'Featured Letter';

      return {
        key: letter.id,
        items: images.length > 0
          ? images.map((img) => ({
              letterId: letter.id,
              imageId: img.id,
              imageUrl: img.imageUrl || '',
              label: chipLabel,
              peopleLine,
              date,
              hook,
              mediaType,
            }))
          : [{
              letterId: letter.id,
              imageUrl: '',
              label: chipLabel,
              peopleLine,
              date,
              hook,
              mediaType,
            }],
      };
    });
  }, [highlights]);

  const galleryShowcaseItems: ShowcaseItem[] = useMemo(() => {
    return gallery.map((gi) => ({
      letterId: gi.letterId,
      imageId: gi.imageId,
      imageUrl: gi.imageUrl,
      label: gi.mediaLabel,
      peopleLine: gi.sender && gi.recipient
        ? `${gi.sender} \u2192 ${gi.recipient}`
        : gi.sender || gi.recipient || '',
      date: gi.date || '',
      hook: gi.hook,
      mediaType: gi.mediaType,
    }));
  }, [gallery]);

  /* ---- Derived for SEO ---- */
  const topCorrespondentNames = useMemo(() => {
    return correspondents.slice(0, 5).map((c) => ({ name: c.name, count: c.totalLetters }));
  }, [correspondents]);

  const dateRange = useMemo(() => {
    const values = collectionLetters
      .map((letter) => letter.metadata.date || letter.metadata.dateRaw)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (values.length === 0) return null;
    const sorted = [...values].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  }, [collectionLetters]);

  const collectionNotes = collection?.description || '';
  const hasExploreContent = correspondents.length > 0 || highlights.length > 0 || gallery.length > 0 || collectionNotes.length > 0;

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
    const notFoundSeo = buildNotFoundSeo();
    return (
      <div className="body-layout">
        <SEO title={notFoundSeo.title} description={notFoundSeo.description} robots={notFoundSeo.robots} />
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

  const seo = buildCollectionSeo(collection, dateRange, topCorrespondentNames);

  const swipeActive = isSwiping || isAnimating;
  const swipeStyle: React.CSSProperties | undefined = swipeActive
    ? {
        transform: `translateX(${swipeOffset}px)`,
        transition: isSwiping ? 'none' : 'transform 0.28s cubic-bezier(0.25, 0.1, 0.25, 1)',
        willChange: 'transform',
      }
    : undefined;

  return (
    <div className="body-layout" ref={swipeRef} style={swipeStyle}>
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
            {(correspondents.length > 0 || collectionNotes) && (
              <div className="cd-people-col">
                {correspondents.length > 0 && (
                  <>
                    <h3 className="cd-people-title">People</h3>
                    {correspondents.map((person) => (
                      <button
                        type="button"
                        key={person.name}
                        className="cd-person-card"
                        onClick={() => {
                          setPopup({
                            title: person.name,
                            content: (
                              <>
                                <div className="cd-popup-role">
                                  {person.sentCount > 0 && <span>Sent {person.sentCount}</span>}
                                  {person.sentCount > 0 && person.receivedCount > 0 && <span className="cd-person-divider">&middot;</span>}
                                  {person.receivedCount > 0 && <span>Received {person.receivedCount}</span>}
                                </div>
                                {person.hook && <p className="cd-popup-hook">{person.hook}</p>}
                                {person.biography && <p className="cd-popup-biography">{person.biography}</p>}
                              </>
                            ),
                          });
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
                      </button>
                    ))}
                  </>
                )}
                {collectionNotes && (
                  <button
                    type="button"
                    className="cd-notes-card"
                    onClick={() => setPopup({ title: 'Notes', content: <p className="cd-popup-notes">{collectionNotes}</p> })}
                  >
                    <h3 className="cd-people-title">Notes</h3>
                    <p className="cd-notes-preview">{collectionNotes}</p>
                  </button>
                )}
              </div>
            )}

            {(highlights.length > 0 || gallery.length > 0) && (
              isMobile ? (
                <InfiniteCarousel classPrefix="cd-highlights" pauseRef={carouselPauseRef} suppressClickAfterDrag>
                  {[
                    ...highlightShowcaseItems.map(({ key, items }) => (
                      <ShowcaseCard key={key} items={items} onNavigate={handleHighlightClick} onInteraction={() => carouselPauseRef.current()} />
                    )),
                    ...(galleryShowcaseItems.length > 0 ? [
                      <ShowcaseCard key="gallery" items={galleryShowcaseItems} onNavigate={handleHighlightClick} onInteraction={() => carouselPauseRef.current()} />
                    ] : []),
                  ]}
                </InfiniteCarousel>
              ) : (
                <div className="cd-highlights-col">
                  {highlightShowcaseItems.map(({ key, items }) => (
                    <ShowcaseCard
                      key={key}
                      items={items}
                      onNavigate={handleHighlightClick}
                    />
                  ))}
                  {galleryShowcaseItems.length > 0 && (
                    <ShowcaseCard
                      items={galleryShowcaseItems}
                      onNavigate={handleHighlightClick}
                    />
                  )}
                </div>
              )
            )}
          </section>
        )}

        {/* ---- 4. Search + Archive List ---- */}
        <section id="collection-archive" className="cd-archive-surface" ref={archiveSearchRef}>
          <div className="cd-search-panel">
            <SearchBar
              query={archive.searchQuery}
              filters={archive.filters}
              facets={archive.archiveResults.facets}
              total={archive.archiveResults.total}
              loading={archive.archiveLoading}
              embedded
              variant="full"
              hideCollectionFilter
              searchKicker={`Collection ${collection.collectionCode}`}
              searchTitle="Search This Collection"
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

          <section className="cd-archive-stage">
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

      </div>
      <Footer />
      <BackToTop />

      {/* ---- Popup overlay ---- */}
      {popup && (
        <div className="cd-popup-overlay" onClick={() => setPopup(null)}>
          <div className="cd-popup" onClick={(e) => e.stopPropagation()}>
            <div className="cd-popup-header">
              <h2 className="cd-popup-title">{popup.title}</h2>
              <button type="button" className="cd-popup-close" onClick={() => setPopup(null)}>&times;</button>
            </div>
            <div className="cd-popup-body">
              {popup.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
