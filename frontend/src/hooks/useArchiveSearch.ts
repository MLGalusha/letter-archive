import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SearchFilters } from '../components/SearchBar/SearchBar';
import { searchArchiveShelf, type ArchiveSearchResponse } from '../api/letters';
import { saveSearchState, loadSearchState } from '../utils/searchPersistence';
import { mergeArchiveItems, getResolvedArchiveSort } from '../utils/archiveSearch';

const ARCHIVE_PAGE_SIZE = 12;

const EMPTY_FACETS: ArchiveSearchResponse['facets'] = {
  formats: [],
  collections: [],
  correspondents: [],
  places: [],
  years: [],
  topics: [],
  tones: [],
  relationships: [],
};

function parseFormatsFromUrl(searchParams: URLSearchParams): SearchFilters['format'] {
  const repeated = searchParams.getAll('format') as NonNullable<SearchFilters['format']>;
  if (repeated.length > 0) return repeated;
  const legacy = searchParams.get('format') as NonNullable<SearchFilters['format']>[number] | null;
  return legacy ? [legacy] : null;
}

function parseFiltersFromUrl(
  searchParams: URLSearchParams,
  defaultSortOrder?: 'asc' | 'desc',
): SearchFilters {
  return {
    format: parseFormatsFromUrl(searchParams),
    collection: searchParams.get('collection') || null,
    sender: searchParams.get('sender') || null,
    recipient: searchParams.get('recipient') || null,
    place: searchParams.get('place') || null,
    topic: searchParams.get('topic') ? searchParams.get('topic')!.split(',') : null,
    tone: searchParams.get('tone') ? searchParams.get('tone')!.split(',') : null,
    relationship: searchParams.get('relationship') ? searchParams.get('relationship')!.split(',') : null,
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
    sortOrder: (searchParams.get('sortOrder') as SearchFilters['sortOrder']) || defaultSortOrder,
  };
}

const FILTER_URL_KEYS = [
  'q', 'collection', 'sender', 'recipient', 'format', 'sort',
  'verified', 'hasTranscript', 'place', 'topic', 'tone',
  'relationship', 'year', 'yearFrom', 'yearTo', 'sortOrder',
] as const;

export interface UseArchiveSearchConfig {
  /** localStorage key for persisting search state */
  storageKey: string;
  /** Default sort when no query is active */
  defaultSort?: 'createdAt' | 'letterDate';
  /** Default sort order for the initial filter state */
  defaultSortOrder?: 'asc' | 'desc';
  /** Filters that are always enforced (e.g. { collection: "009" }). Excluded from URL params. */
  fixedFilters?: Partial<SearchFilters>;
}

export interface UseArchiveSearchReturn {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filters: SearchFilters;
  setFilters: (f: SearchFilters) => void;
  archiveResults: ArchiveSearchResponse;
  archiveLoading: boolean;
  archiveLoadingMore: boolean;
  archiveError: string | null;
  archiveLoadMoreError: string | null;
  handleArchiveLoadMore: () => Promise<void>;
  resolvedSort: string;
  sortCueField: 'createdAt' | 'collection' | null;
}

export default function useArchiveSearch(config: UseArchiveSearchConfig): UseArchiveSearchReturn {
  const { storageKey, defaultSort = 'createdAt', defaultSortOrder, fixedFilters } = config;
  const fixedKeys = useMemo(
    () => new Set(Object.keys(fixedFilters ?? {})),
    // fixedFilters identity is stable per call site — intentionally using JSON serialization
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(fixedFilters)],
  );

  const [searchParams, setSearchParams] = useSearchParams();

  // ── Query state ──
  const [searchQuery, setSearchQuery] = useState(() => {
    const urlQ = searchParams.get('q');
    if (urlQ) return urlQ;
    const saved = loadSearchState(storageKey);
    return saved?.query || '';
  });

  // ── Filter state ──
  const [filters, setFiltersRaw] = useState<SearchFilters>(() => {
    const hasUrlFilters = FILTER_URL_KEYS.some((k) => searchParams.get(k) !== null);
    if (!hasUrlFilters) {
      const saved = loadSearchState(storageKey);
      if (saved?.filters) return { ...saved.filters, ...fixedFilters };
    }
    return { ...parseFiltersFromUrl(searchParams, defaultSortOrder), ...fixedFilters };
  });

  // Wrap setFilters to enforce fixedFilters
  const setFilters = useCallback(
    (f: SearchFilters) => {
      setFiltersRaw(fixedFilters ? { ...f, ...fixedFilters } : f);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(fixedFilters)],
  );

  // ── Archive results state ──
  const [archiveResults, setArchiveResults] = useState<ArchiveSearchResponse>({
    letters: [],
    page: 1,
    limit: ARCHIVE_PAGE_SIZE,
    total: 0,
    facets: EMPTY_FACETS,
  });
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveLoadingMore, setArchiveLoadingMore] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveLoadMoreError, setArchiveLoadMoreError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  // ── Sync filters → URL params ──
  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchQuery.trim()) nextParams.set('q', searchQuery.trim());
    if (filters.format?.length) {
      filters.format.forEach((f) => nextParams.append('format', f));
    }
    // Only write non-fixed filter keys to URL
    if (!fixedKeys.has('collection') && filters.collection) nextParams.set('collection', filters.collection);
    if (filters.sender) nextParams.set('sender', filters.sender);
    if (filters.recipient) nextParams.set('recipient', filters.recipient);
    if (filters.place) nextParams.set('place', filters.place);
    if (filters.topic?.length) nextParams.set('topic', filters.topic.join(','));
    if (filters.tone?.length) nextParams.set('tone', filters.tone.join(','));
    if (filters.relationship?.length) nextParams.set('relationship', filters.relationship.join(','));
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
  }, [filters, fixedKeys, searchParams, searchQuery, setSearchParams]);

  // ── Persist to localStorage (debounced) ──
  useEffect(() => {
    const timer = window.setTimeout(() => saveSearchState(storageKey, searchQuery, filters), 300);
    return () => window.clearTimeout(timer);
  }, [filters, searchQuery, storageKey]);

  // ── Build request params ──
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
      year: filters.year ?? undefined,
      yearFrom: filters.dateRange?.start,
      yearTo: filters.dateRange?.end,
      hasTranscript: filters.hasTranscript,
      verified: filters.verified,
      sort: filters.sort || undefined,
      sortOrder: filters.sortOrder || undefined,
    }),
    [filters, searchQuery],
  );

  // ── Execute search (180ms debounce with request versioning) ──
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
        .catch((err) => {
          if (cancelled || requestVersion !== requestVersionRef.current) return;
          setArchiveError(err instanceof Error ? err.message : 'Failed to load archive results');
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

  // ── Load more handler ──
  const handleArchiveLoadMore = useCallback(async () => {
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
  }, [archiveLoading, archiveLoadingMore, archiveResults, requestParams]);

  // ── Derived sort values ──
  const resolvedSort = getResolvedArchiveSort(searchQuery, filters, defaultSort);
  const sortCueField: 'createdAt' | 'collection' | null =
    resolvedSort === 'createdAt' || resolvedSort === 'collection' ? resolvedSort : null;

  return {
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    archiveResults,
    archiveLoading,
    archiveLoadingMore,
    archiveError,
    archiveLoadMoreError,
    handleArchiveLoadMore,
    resolvedSort,
    sortCueField,
  };
}
