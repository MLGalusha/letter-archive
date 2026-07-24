import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentStatus, WorkflowState } from '../../../types/Letter';
import { loadPersistedState } from './utils';
import type { ContentFilterView, ContentShapeFilter, DateMode, FlaggedFilter, MissingFilter, VisibilityFilter } from './types';

function parseCollectionFilter(value: string | null | undefined): string[] {
  if (!value || value === 'all') return [];

  return Array.from(new Set(
    value
      .split(',')
      .map((code) => code.replace(/\D/g, '').slice(0, 3))
      .filter((code) => code !== '' && Number(code) !== 0),
  ));
}

export function useDashboardFilters() {
  const [persistedState] = useState(loadPersistedState);

  const [dateMode, setDateMode] = useState<DateMode>(
    persistedState.dateMode ?? 'specific',
  );
  const [contentFilterView, setContentFilterView] = useState<ContentFilterView>('transcript');
  const [collectionInput, setCollectionInput] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>(
    persistedState.visibilityFilter ?? 'ALL',
  );
  const [transcriptStatusFilters, setTranscriptStatusFilters] = useState<ContentStatus[]>(
    (persistedState.transcriptStatusFilters as ContentStatus[]) ?? [],
  );
  const [metadataStatusFilters, setMetadataStatusFilters] = useState<ContentStatus[]>(
    (persistedState.metadataStatusFilters as ContentStatus[]) ?? [],
  );
  const [extraContentStatusFilters, setExtraContentStatusFilters] = useState<ContentStatus[]>(
    (persistedState.extraContentStatusFilters as ContentStatus[]) ?? [],
  );
  const [workflowFilters, setWorkflowFilters] = useState<WorkflowState[]>(
    (persistedState.workflowFilters as WorkflowState[]) ?? [],
  );
  const [flaggedFilter, setFlaggedFilter] = useState<FlaggedFilter>(
    persistedState.flaggedFilter ?? 'ALL',
  );
  const [missingFilters, setMissingFilters] = useState<MissingFilter[]>(
    persistedState.missingFilters ?? [],
  );
  const [contentShapeFilters, setContentShapeFilters] = useState<ContentShapeFilter[]>(
    persistedState.contentShapeFilters ?? [],
  );
  const [collectionFilters, setCollectionFilters] = useState<string[]>(
    parseCollectionFilter(persistedState.collectionFilter),
  );
  const [yearFilter, setYearFilter] = useState<number | null>(
    persistedState.year ?? null,
  );
  const [monthFilter, setMonthFilter] = useState<number | null>(
    persistedState.month ?? null,
  );
  const [dayFilter, setDayFilter] = useState<number | null>(
    persistedState.day ?? null,
  );
  const [dateFromFilter, setDateFromFilter] = useState<string | null>(
    persistedState.dateFrom ?? null,
  );
  const [dateToFilter, setDateToFilter] = useState<string | null>(
    persistedState.dateTo ?? null,
  );
  const [searchInput, setSearchInput] = useState(persistedState.searchQuery ?? '');
  const [searchQuery, setSearchQuery] = useState(persistedState.searchQuery ?? '');
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

  const collectionFilter = useMemo(
    () => collectionFilters.length > 0 ? collectionFilters.join(',') : 'all',
    [collectionFilters],
  );

  const handleCollectionInputChange = useCallback((value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setCollectionInput(cleaned);
  }, []);

  const addCollectionFilter = useCallback(() => {
    const cleaned = collectionInput.replace(/\D/g, '').slice(0, 3);
    if (cleaned === '' || Number(cleaned) === 0) return;

    setCollectionFilters((previous) => (
      previous.includes(cleaned) ? previous : [...previous, cleaned]
    ));
    setCollectionInput('');
  }, [collectionInput]);

  const removeCollectionFilter = useCallback((code: string) => {
    setCollectionFilters((previous) => previous.filter((collectionCode) => collectionCode !== code));
  }, []);

  const setCollectionFilter = useCallback((value: string) => {
    setCollectionFilters(parseCollectionFilter(value));
    setCollectionInput('');
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

  const toggleExtraContentFilter = useCallback((value: ContentStatus) => {
    setExtraContentStatusFilters((previous) =>
      previous.includes(value)
        ? previous.filter((status) => status !== value)
        : [...previous, value],
    );
  }, []);

  const toggleWorkflowFilter = useCallback((value: WorkflowState) => {
    setWorkflowFilters((previous) =>
      previous.includes(value)
        ? previous.filter((workflow) => workflow !== value)
        : [...previous, value],
    );
  }, []);

  const toggleFlaggedFilter = useCallback((value: Exclude<FlaggedFilter, 'ALL'>) => {
    setFlaggedFilter((current) => (current === value ? 'ALL' : value));
  }, []);

  const toggleMissingFilter = useCallback((value: MissingFilter) => {
    setMissingFilters((previous) =>
      previous.includes(value)
        ? previous.filter((filter) => filter !== value)
        : [...previous, value],
    );
  }, []);

  const toggleContentShapeFilter = useCallback((value: ContentShapeFilter) => {
    setContentShapeFilters((previous) =>
      previous.includes(value)
        ? previous.filter((filter) => filter !== value)
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
    setFlaggedFilter('ALL');
    setTranscriptStatusFilters([]);
    setMetadataStatusFilters([]);
    setExtraContentStatusFilters([]);
    setWorkflowFilters([]);
    setMissingFilters([]);
    setContentShapeFilters([]);
    setCollectionFilters([]);
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
    dateMode,
    setDateMode,
    contentFilterView,
    setContentFilterView,
    collectionInput,
    setCollectionInput,
    handleCollectionInputChange,
    collectionFilters,
    addCollectionFilter,
    removeCollectionFilter,
    visibilityFilter,
    setVisibilityFilter,
    toggleVisibilityFilter,
    transcriptStatusFilters,
    setTranscriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    setMetadataStatusFilters,
    toggleMetadataFilter,
    extraContentStatusFilters,
    setExtraContentStatusFilters,
    toggleExtraContentFilter,
    workflowFilters,
    setWorkflowFilters,
    toggleWorkflowFilter,
    flaggedFilter,
    setFlaggedFilter,
    toggleFlaggedFilter,
    missingFilters,
    setMissingFilters,
    toggleMissingFilter,
    contentShapeFilters,
    setContentShapeFilters,
    toggleContentShapeFilter,
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
    initialSortColumns: persistedState.sortColumns ?? [],
  };
}

export type DashboardFilterControls = ReturnType<typeof useDashboardFilters>;
