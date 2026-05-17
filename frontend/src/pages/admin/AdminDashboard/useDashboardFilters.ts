import { useCallback, useEffect, useRef, useState } from 'react';
import type { StartProcessingOptions } from '../../../api/admin';
import type { ContentStatus } from '../../../types/Letter';
import { loadPersistedState } from './utils';
import type { ContentFilterView, DateMode, VisibilityFilter } from './types';

export function useDashboardFilters() {
  const persistedState = useRef(loadPersistedState());

  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [dateMode, setDateMode] = useState<DateMode>(
    persistedState.current.dateMode ?? 'specific',
  );
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const [contentFilterView, setContentFilterView] = useState<ContentFilterView>('transcript');
  const [collectionInput, setCollectionInput] = useState(
    persistedState.current.collectionFilter === 'all'
      ? ''
      : persistedState.current.collectionFilter ?? '',
  );
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>(
    persistedState.current.visibilityFilter ?? 'ALL',
  );
  const [transcriptStatusFilters, setTranscriptStatusFilters] = useState<ContentStatus[]>(
    (persistedState.current.transcriptStatusFilters as ContentStatus[]) ?? [],
  );
  const [metadataStatusFilters, setMetadataStatusFilters] = useState<ContentStatus[]>(
    (persistedState.current.metadataStatusFilters as ContentStatus[]) ?? [],
  );
  const [collectionFilter, setCollectionFilter] = useState<string>(
    persistedState.current.collectionFilter ?? 'all',
  );
  const [yearFilter, setYearFilter] = useState<number | null>(
    persistedState.current.year ?? null,
  );
  const [monthFilter, setMonthFilter] = useState<number | null>(
    persistedState.current.month ?? null,
  );
  const [dayFilter, setDayFilter] = useState<number | null>(
    persistedState.current.day ?? null,
  );
  const [dateFromFilter, setDateFromFilter] = useState<string | null>(
    persistedState.current.dateFrom ?? null,
  );
  const [dateToFilter, setDateToFilter] = useState<string | null>(
    persistedState.current.dateTo ?? null,
  );
  const [searchInput, setSearchInput] = useState(persistedState.current.searchQuery ?? '');
  const [searchQuery, setSearchQuery] = useState(persistedState.current.searchQuery ?? '');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchInput]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(target)) {
        setShowDateDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCollectionInputChange = useCallback((value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setCollectionInput(cleaned);

    if (cleaned === '' || Number(cleaned) === 0) {
      setCollectionFilter('all');
    } else {
      setCollectionFilter(cleaned);
    }
  }, []);

  const toggleVisibilityFilter = useCallback((value: 'PUBLISHED' | 'HIDDEN') => {
    setVisibilityFilter((current) => (current === value ? 'ALL' : value));
  }, []);

  const toggleTranscriptFilter = useCallback((value: ContentStatus) => {
    setTranscriptStatusFilters((previous) =>
      previous.includes(value)
        ? previous.filter((status) => status !== value)
        : [...previous, value],
    );
  }, []);

  const toggleMetadataFilter = useCallback((value: ContentStatus) => {
    setMetadataStatusFilters((previous) =>
      previous.includes(value)
        ? previous.filter((status) => status !== value)
        : [...previous, value],
    );
  }, []);

  const clearDateFilters = useCallback(() => {
    setYearFilter(null);
    setMonthFilter(null);
    setDayFilter(null);
    setDateFromFilter(null);
    setDateToFilter(null);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setVisibilityFilter('ALL');
    setTranscriptStatusFilters([]);
    setMetadataStatusFilters([]);
    setCollectionFilter('all');
    setCollectionInput('');
    setSearchInput('');
    setSearchQuery('');
    clearDateFilters();
    setDateMode('specific');
  }, [clearDateFilters]);

  const hasDateFilter = yearFilter !== null
    || monthFilter !== null
    || dayFilter !== null
    || dateFromFilter !== null
    || dateToFilter !== null;

  return {
    showDateDropdown,
    setShowDateDropdown,
    dateMode,
    setDateMode,
    dateDropdownRef,
    contentFilterView,
    setContentFilterView,
    collectionInput,
    setCollectionInput,
    handleCollectionInputChange,
    visibilityFilter,
    setVisibilityFilter,
    toggleVisibilityFilter,
    transcriptStatusFilters,
    setTranscriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    setMetadataStatusFilters,
    toggleMetadataFilter,
    collectionFilter,
    setCollectionFilter,
    yearFilter,
    setYearFilter,
    monthFilter,
    setMonthFilter,
    dayFilter,
    setDayFilter,
    dateFromFilter,
    setDateFromFilter,
    dateToFilter,
    setDateToFilter,
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    hasDateFilter,
    clearDateFilters,
    handleClearAllFilters,
    initialSortColumns: persistedState.current.sortColumns ?? [],
  };
}

export type DashboardFilterControls = ReturnType<typeof useDashboardFilters>;

export interface DashboardFilterQueryFields {
  collectionFilter: string;
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
}

export function getDashboardFilterQueryFields(
  filters: DashboardFilterControls,
): DashboardFilterQueryFields {
  return {
    collectionFilter: filters.collectionFilter,
    visibilityFilter: filters.visibilityFilter,
    searchQuery: filters.searchQuery,
    yearFilter: filters.yearFilter,
    monthFilter: filters.monthFilter,
    dayFilter: filters.dayFilter,
    dateFromFilter: filters.dateFromFilter,
    dateToFilter: filters.dateToFilter,
    transcriptStatusFilters: filters.transcriptStatusFilters,
    metadataStatusFilters: filters.metadataStatusFilters,
  };
}

export function getDashboardProcessingFilters(
  filters: DashboardFilterControls,
): StartProcessingOptions {
  return {
    collectionCode: filters.collectionFilter !== 'all' ? filters.collectionFilter : undefined,
    visibility: filters.visibilityFilter !== 'ALL' ? filters.visibilityFilter : undefined,
    search: filters.searchQuery || undefined,
    year: filters.yearFilter ?? undefined,
    month: filters.monthFilter ?? undefined,
    day: filters.dayFilter ?? undefined,
    dateFrom: filters.dateFromFilter ?? undefined,
    dateTo: filters.dateToFilter ?? undefined,
  };
}
