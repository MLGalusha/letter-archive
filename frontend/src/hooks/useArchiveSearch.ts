import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { searchArchiveShelf, type ArchiveSearchResponse } from '../api/letters';
import { saveSearchState, loadSearchState } from '../utils/searchPersistence';
import {
  decodeArchiveSearchParams,
  encodeArchiveSearchParams,
  mergeArchiveItems,
  getResolvedArchiveSort,
  hasArchiveSearchParams,
  normalizeArchiveSearchState,
  type ArchiveSearchCodecOptions,
  type ArchiveSearchState,
  type ArchiveDefaultSort,
  type SearchFilters,
} from '../utils/archiveSearch';

const ARCHIVE_PAGE_SIZE = 24;

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

export interface UseArchiveSearchConfig {
  /** localStorage key for persisting search state */
  storageKey: string;
  /** Page-specific default sort when the user hasn't explicitly picked one. */
  defaultSort?: ArchiveDefaultSort;
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

function resolveInitialState(
  searchParams: URLSearchParams,
  storageKey: string,
  codecOptions: ArchiveSearchCodecOptions,
): ArchiveSearchState {
  if (hasArchiveSearchParams(searchParams)) {
    return decodeArchiveSearchParams(searchParams, codecOptions);
  }

  return normalizeArchiveSearchState(loadSearchState(storageKey), codecOptions);
}

export default function useArchiveSearch(config: UseArchiveSearchConfig): UseArchiveSearchReturn {
  const {
    storageKey,
    defaultSort = 'relevance',
    defaultSortOrder = 'desc',
    fixedFilters,
  } = config;
  const fixedFiltersKey = JSON.stringify(fixedFilters ?? {});
  const codecOptions = useMemo<ArchiveSearchCodecOptions>(
    () => ({ defaultSort, defaultSortOrder, fixedFilters }),
    // Configuration is compared by value so inline fixed-filter objects do not
    // rehydrate search state on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultSort, defaultSortOrder, fixedFiltersKey],
  );
  const scopeKey = `${storageKey}\0${defaultSort}\0${defaultSortOrder}\0${fixedFiltersKey}`;

  const [searchParams, setSearchParams] = useSearchParams();
  const locationSearch = searchParams.toString();
  const [archiveState, setArchiveState] = useState<ArchiveSearchState>(
    () => resolveInitialState(searchParams, storageKey, codecOptions),
  );
  const archiveStateRef = useRef(archiveState);
  const previousLocationSearchRef = useRef(locationSearch);
  const previousScopeKeyRef = useRef(scopeKey);
  const selfWrittenSearchRef = useRef<string | null>(null);
  const locationChanged = previousLocationSearchRef.current !== locationSearch;
  const scopeChanged = previousScopeKeyRef.current !== scopeKey;

  const commitLocalState = useCallback((candidate: ArchiveSearchState) => {
    const next = normalizeArchiveSearchState(candidate, codecOptions);

    // A canonical clean URL cannot distinguish an explicit local clear from a
    // first visit that should hydrate persistence. Commit that one boundary
    // immediately so an unmount before the normal 300 ms debounce cannot
    // resurrect the previous private search.
    const nextParams = encodeArchiveSearchParams(next, codecOptions);
    if (!hasArchiveSearchParams(nextParams)) {
      saveSearchState(storageKey, '', next.filters);
    }

    archiveStateRef.current = next;
    setArchiveState(next);
  }, [codecOptions, storageKey]);

  // An external URL transition is authoritative, including a POP to an empty
  // URL. A clean URL may hydrate persistence only when the archive scope itself
  // changes. Local replaceState writes are acknowledged without rehydrating.
  useEffect(() => {
    if (!locationChanged && !scopeChanged) return;

    previousLocationSearchRef.current = locationSearch;
    previousScopeKeyRef.current = scopeKey;

    const acknowledgedLocalWrite = locationChanged
      && !scopeChanged
      && selfWrittenSearchRef.current === locationSearch;
    selfWrittenSearchRef.current = null;
    if (acknowledgedLocalWrite) return;

    const targetHasArchiveParams = hasArchiveSearchParams(searchParams);
    const next = scopeChanged && !targetHasArchiveParams
      ? normalizeArchiveSearchState(loadSearchState(storageKey), codecOptions)
      : decodeArchiveSearchParams(searchParams, codecOptions);

    if (locationChanged && !scopeChanged && !targetHasArchiveParams) {
      saveSearchState(storageKey, '', next.filters);
    }

    archiveStateRef.current = next;
    setArchiveState(next);
  }, [
    codecOptions,
    locationChanged,
    locationSearch,
    scopeChanged,
    scopeKey,
    searchParams,
    storageKey,
  ]);

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

  const setSearchQuery = useCallback((query: string) => {
    commitLocalState({
      ...archiveStateRef.current,
      query,
    });
  }, [commitLocalState]);

  const setFilters = useCallback((filters: SearchFilters) => {
    commitLocalState({
      query: archiveStateRef.current.query,
      filters,
    });
  }, [commitLocalState]);

  const { query: searchQuery, filters } = archiveState;

  // Local state is reflected in the current history entry immediately. This
  // finishes before the debounced request and avoids a POP racing a pending URL
  // write. The codec preserves every URL key the archive does not own.
  useEffect(() => {
    if (locationChanged || scopeChanged) return;

    const nextParams = encodeArchiveSearchParams(archiveState, {
      ...codecOptions,
      currentParams: searchParams,
    });
    const nextSearch = nextParams.toString();
    if (nextSearch === locationSearch) return;

    selfWrittenSearchRef.current = nextSearch;
    setSearchParams(nextParams, { replace: true });
  }, [
    archiveState,
    codecOptions,
    locationChanged,
    locationSearch,
    scopeChanged,
    searchParams,
    setSearchParams,
  ]);

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
      // Send the *resolved* sort so the backend matches the UI's active
      // sort cue. Without this, an unset filters.sort makes the UI show the
      // page default (e.g. letterDate on CollectionDetailPage) while the
      // request falls through to the backend's own default, producing a
      // stale/misleading sort indicator.
      sort: filters.sort || defaultSort,
      sortOrder: filters.sortOrder || defaultSortOrder,
    }),
    [filters, searchQuery, defaultSort, defaultSortOrder],
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
      if (requestVersion === requestVersionRef.current) {
        setArchiveLoadingMore(false);
      }
    }
  }, [archiveLoading, archiveLoadingMore, archiveResults, requestParams]);

  // ── Derived sort values ──
  const resolvedSort = getResolvedArchiveSort(filters, defaultSort);
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
