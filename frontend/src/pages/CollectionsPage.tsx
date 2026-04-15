import { useMemo, useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { getCachedCollections, listCollections, type CollectionInfo } from '../api/collections';
import Footer from '../components/Footer/Footer';
import BackToTop from '../components/BackToTop';
import { saveCollectionsSort, loadCollectionsSort } from '../utils/searchPersistence';
import useIsMobile from '../hooks/useIsMobile';
import './CollectionsPage.css';

function formatDateRange(range: { min: string; max: string } | null | undefined): string | null {
  if (!range) return null;
  const fmt = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 8);
    if (digits.length < 6) return null;
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6)) - 1;
    if (month < 0 || month > 11 || year < 1700) return null;
    const hasDay = digits.length >= 8 && Number(digits.slice(6, 8)) > 0;
    const d = new Date(year, month, hasDay ? Number(digits.slice(6, 8)) : 1);
    return { year, month, label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) };
  };
  const start = fmt(range.min);
  const end = fmt(range.max);
  if (!start) return null;
  if (!end || (start.year === end.year && start.month === end.month)) return start.label;
  return `${start.label} \u2014 ${end.label}`;
}

type SortField = 'number' | 'letters' | 'date' | 'title';
type SortOrder = 'asc' | 'desc';

const SORT_OPTIONS: { field: SortField; label: string; defaultOrder: SortOrder }[] = [
  { field: 'number', label: 'Collection', defaultOrder: 'asc' },
  { field: 'letters', label: 'Letter count', defaultOrder: 'desc' },
  { field: 'date', label: 'Date', defaultOrder: 'desc' },
  { field: 'title', label: 'Title', defaultOrder: 'asc' },
];

function dateVal(range: CollectionInfo['dateRange'], which: 'min' | 'max', fallback = ''): string {
  return range?.[which]?.replace(/[^0-9]/g, '') || fallback;
}

function hasPublishedLetters(collection: CollectionInfo): boolean {
  return (collection.letterCount || 0) > 0;
}

const COLLECTION_SKELETON_COUNT = 6;

export default function CollectionsPage() {
  const isMobile = useIsMobile();
  const savedSort = loadCollectionsSort();
  const [sortField, setSortField] = useState<SortField>(
    (savedSort?.field as SortField) || 'number',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (savedSort?.order as SortOrder) || 'asc',
  );
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortOpen]);

  // Persist sort to localStorage
  useEffect(() => {
    saveCollectionsSort(sortField, sortOrder);
  }, [sortField, sortOrder]);

  const [collectionsData, setCollectionsData] = useState<CollectionInfo[] | null>(() => {
    const cachedCollections = getCachedCollections();
    return cachedCollections ? cachedCollections.filter(hasPublishedLetters) : null;
  });
  const [loading, setLoading] = useState(collectionsData === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (collectionsData !== null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listCollections()
      .then((collections) => {
        if (cancelled) return;
        setCollectionsData(collections.filter(hasPublishedLetters));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'An error occurred');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionsData]);

  const collections: CollectionInfo[] = collectionsData ?? [];
  const showLoadingShell = loading && collections.length === 0 && !error;

  const visibleCollections = useMemo(() => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...collections].sort((a, b) => {
      switch (sortField) {
        case 'number': return dir * a.collectionCode.localeCompare(b.collectionCode);
        case 'letters': return dir * ((a.letterCount || 0) - (b.letterCount || 0));
        case 'date': {
          const which = sortOrder === 'desc' ? 'max' : 'min';
          const fallback = sortOrder === 'desc' ? '0' : '99999999';
          return dir * dateVal(a.dateRange, which, fallback).localeCompare(dateVal(b.dateRange, which, fallback));
        }
        case 'title': return dir * (a.title || a.collectionCode).localeCompare(b.title || b.collectionCode);
      }
    });
  }, [collections, sortField, sortOrder]);

  const totalLetters = useMemo(
    () => collections.reduce((sum, collection) => sum + (collection.letterCount || 0), 0),
    [collections],
  );

  return (
    <div className="body-layout">
      <SEO
        title="Collections"
        description="Browse collections of personal letters and historical correspondence. Each collection holds a bundle of letters -- a family's exchange, a wartime correspondence, a love story told across distance."
        canonicalUrl="/collections"
      />
      <div className="collections-browse-page">
        <div className="collections-hero">
          <p className="collections-kicker">Collection Shelf</p>
          <h1>Collections</h1>
          <p className="collections-hero-sub">
            Each collection holds a bundle of letters — a family's correspondence, a wartime exchange,
            a love story told across distance. Pick one and step inside.
          </p>
          <div className="collections-hero-bottom">
            <div className="collections-summary">
              <span className="summary-stat">
                <strong>{collections.length}</strong> collection{collections.length !== 1 ? 's' : ''}
              </span>
              <span className="summary-divider">/</span>
              <span className="summary-stat">
                <strong>{totalLetters}</strong> letters
              </span>
            </div>
            <div className="collections-sort" ref={sortRef} onKeyDown={(e) => { if (e.key === 'Escape') setSortOpen(false); }}>
              <button
                type="button"
                className="sort-trigger"
                onClick={() => setSortOpen((o) => !o)}
                aria-expanded={sortOpen}
                aria-label="Sort collections"
              >
                <span>{SORT_OPTIONS.find((o) => o.field === sortField)!.label}</span>
                <span className="sort-indicators">
                  <span className="sort-arrow">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span>
                  <svg className={`sort-chevron${sortOpen ? ' sort-chevron--open' : ''}`} width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
                    <path d="M0 0l4 5 4-5z" fill="currentColor" />
                  </svg>
                </span>
              </button>
              <ul
                className={`sort-menu${sortOpen ? '' : ' sort-menu--hidden'}`}
                role="listbox"
              >
                {SORT_OPTIONS.map((opt) => {
                  const isActive = sortField === opt.field;
                  return (
                    <li
                      key={opt.field}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={0}
                      className={`sort-option${isActive ? ' sort-option--active' : ''}`}
                      onClick={() => {
                        if (isActive) {
                          setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortField(opt.field);
                          setSortOrder(opt.defaultOrder);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (isActive) {
                            setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortField(opt.field);
                            setSortOrder(opt.defaultOrder);
                          }
                        }
                      }}
                    >
                      <span>{opt.label}</span>
                      {isActive && <span className="sort-arrow">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        {error && <p className="error-message">{error}</p>}

        {(showLoadingShell || visibleCollections.length > 0) && (
          <div className={`public-collections-grid${showLoadingShell ? ' public-collections-grid--loading' : ''}`}>
            {showLoadingShell
              ? Array.from({ length: COLLECTION_SKELETON_COUNT }, (_, index) => (
                  <div key={index} className="public-collection-card-skeleton" aria-hidden="true">
                    <div className="collection-card-top">
                      <div className="collection-skeleton-title" />
                      <div className="collection-skeleton-count" />
                    </div>
                    <div className="collection-skeleton-people" />
                    <div className="collection-skeleton-meta" />
                    <div className="collection-skeleton-line collection-skeleton-line--long" />
                    <div className="collection-skeleton-line" />
                    <div className="collection-skeleton-cta" />
                  </div>
                ))
              : visibleCollections.map((collection) => {
                  const dateLabel = formatDateRange(collection.dateRange);
                  const teaser = collection.hook || collection.description;
                  const hasPeople = collection.primarySender || collection.primaryRecipient;

                  return (
                    <Link
                      key={collection.id}
                      to={`/collections/${collection.collectionCode}`}
                      className="public-collection-card"
                    >
                      <div className="collection-card-top">
                        <h3>{collection.title || (isMobile ? collection.collectionCode : `Collection ${collection.collectionCode}`)}</h3>
                        <span className="collection-card-count">
                          {isMobile
                            ? collection.letterCount
                            : `${collection.letterCount} letter${collection.letterCount !== 1 ? 's' : ''}`}
                        </span>
                      </div>

                      {hasPeople && (
                        <p className="collection-card-people">
                          {collection.primarySender && collection.primaryRecipient
                            ? <>{collection.primarySender} <span className="people-arrow">&rarr;</span> {collection.primaryRecipient}</>
                            : collection.primarySender || collection.primaryRecipient}
                        </p>
                      )}

                      {dateLabel && (
                        <div className="collection-card-meta">
                          <span>{dateLabel}</span>
                        </div>
                      )}

                      {teaser && (
                        <p className="collection-card-teaser">{teaser}</p>
                      )}

                      <span className="collection-card-cta">Read the letters &rarr;</span>
                    </Link>
                  );
                })}
          </div>
        )}

        {!loading && visibleCollections.length === 0 && !error && (
          <div className="no-results">
            <p>No collections available yet.</p>
          </div>
        )}
      </div>
      <Footer />
      <BackToTop />
    </div>
  );
}
