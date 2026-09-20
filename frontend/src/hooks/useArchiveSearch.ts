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
  const searchControllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const resultsKeyRef = useRef<string | null>(null);
  const debounceQueryRef = useRef(false);
  const invalidateRequests = useCallback(() => {
    ++requestVersionRef.current;
    searchControllerRef.current?.abort();
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    setArchiveLoading(true);
    setArchiveLoadingMore(false);
    setArchiveError(null);
    setArchiveLoadMoreError(null);
  }, []);

  const commitLocalState = useCallback((candidate: ArchiveSearchState, debounce = false) => {
    const next = normalizeArchiveSearchState(candidate, codecOptions);
    if (JSON.stringify(next) === JSON.stringify(archiveStateRef.current)) return;
    debounceQueryRef.current = debounce;
    invalidateRequests();

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
  }, [codecOptions, storageKey, invalidateRequests]);

  // An external URL transition is authoritative, including a POP to an empty
  // URL. A clean URL may hydrate persistence only when the archive scope itself
  // changes. Local replaceState writes are acknowledged without rehydrating.
  useEffect(() => {
    const locationChanged = previousLocationSearchRef.current !== locationSearch;
    const scopeChanged = previousScopeKeyRef.current !== scopeKey;
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

    debounceQueryRef.current = false;
    invalidateRequests();
    archiveStateRef.current = next;
    setArchiveState(next);
  }, [
    codecOptions,
    invalidateRequests,
    locationSearch,
    scopeKey,
    searchParams,
    storageKey,
  ]);

  const setSearchQuery = useCallback((query: string) => {
    commitLocalState({
      ...archiveStateRef.current,
      query,
    }, Boolean(query.trim()));
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
    // The hydration effect updates this ref before scheduling its state update,
    // so it fences this render from mirroring stale state back into the URL.
    if (archiveStateRef.current !== archiveState) return;

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
    locationSearch,
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
      exact: filters.exact || undefined,
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

  const invalidYearRange = requestParams.yearFrom !== undefined && requestParams.yearTo !== undefined
    && requestParams.yearFrom > requestParams.yearTo;
  const requestKey = JSON.stringify([scopeKey, requestParams]);

  // Only text entry waits for a pause. Keep the existing 180ms interval: a
  // 100ms-per-keystroke burst makes one request 180ms after its final character.
  useEffect(() => {
    // URL/scope hydration above has already superseded this render's state.
    if (archiveStateRef.current !== archiveState) return;
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;
    const controller = new AbortController();
    searchControllerRef.current = controller;
    moreControllerRef.current?.abort();
    moreControllerRef.current = null;
    setArchiveLoading(!invalidYearRange);
    setArchiveLoadingMore(false);
    setArchiveError(null);
    setArchiveLoadMoreError(null);

    // Invalidate pending work before deriving the invalid-range UI state below.
    // Neither search nor pagination may send these parameters.
    if (invalidYearRange) {
      controller.abort();
      return;
    }

    const execute = () => {
      searchArchiveShelf({ ...requestParams, page: 1 }, controller.signal)
        .then((response) => {
          if (cancelled || controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
          resultsKeyRef.current = requestKey;
          setArchiveResults(response);
          setArchiveLoadMoreError(null);
        })
        .catch((err) => {
          if (cancelled || controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
          setArchiveError(err instanceof Error ? err.message : 'Failed to load archive results');
        })
        .finally(() => {
          if (cancelled || controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
          setArchiveLoading(false);
        });
    };
    const timer = debounceQueryRef.current ? window.setTimeout(execute, 180) : undefined;
    if (timer === undefined) execute();

    return () => {
      cancelled = true;
      controller.abort();
      moreControllerRef.current?.abort();
      moreControllerRef.current = null;
      window.clearTimeout(timer);
    };
  }, [archiveState, requestParams, requestKey, invalidYearRange]);

  // ── Load more handler ──
  const handleArchiveLoadMore = useCallback(async () => {
    if (invalidYearRange || archiveLoading || archiveLoadingMore || moreControllerRef.current) return;
    if (archiveStateRef.current !== archiveState || resultsKeyRef.current !== requestKey) return;
    if (archiveResults.letters.length >= archiveResults.total) return;

    const requestVersion = requestVersionRef.current;
    const nextPage = archiveResults.page + 1;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setArchiveLoadingMore(true);
    setArchiveLoadMoreError(null);

    try {
      const response = await searchArchiveShelf({ ...requestParams, page: nextPage }, controller.signal);
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
      setArchiveResults((current) => ({
        ...response,
        letters: mergeArchiveItems(current.letters, response.letters),
      }));
    } catch (err) {
      if (controller.signal.aborted || requestVersion !== requestVersionRef.current) return;
      setArchiveLoadMoreError(
        err instanceof Error ? err.message : 'Failed to load more archive results',
      );
    } finally {
      if (moreControllerRef.current === controller) moreControllerRef.current = null;
      if (!controller.signal.aborted && requestVersion === requestVersionRef.current) {
        setArchiveLoadingMore(false);
      }
    }
  }, [archiveLoading, archiveLoadingMore, archiveResults, archiveState, requestParams, requestKey, invalidYearRange]);

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
    archiveLoading: invalidYearRange ? false : archiveLoading,
    archiveLoadingMore: invalidYearRange ? false : archiveLoadingMore,
    archiveError: invalidYearRange
      ? 'From year must be before or equal to To year. Correct the range or clear filters.'
      : archiveError,
    archiveLoadMoreError: invalidYearRange ? null : archiveLoadMoreError,
    handleArchiveLoadMore,
    resolvedSort,
    sortCueField,
  };
}
