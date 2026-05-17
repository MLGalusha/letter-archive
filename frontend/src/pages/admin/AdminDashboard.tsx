import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getAdminLetters, getFilteredLetterIds } from "../../api/letters";
import { toggleLetterFlag } from "../../api/admin/letters";
import {
  bulkUpdateFields,
} from "../../api/admin";
import { useToast } from "../../contexts/ToastContext";
import type { ContentStatus, Letter } from "../../types/Letter";
import AdminLayout from "../../components/AdminLayout";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import DashboardToolbar from "./AdminDashboard/DashboardToolbar";
import BulkEditToolbar from "./AdminDashboard/BulkEditToolbar";
import DashboardDialogs from "./AdminDashboard/DashboardDialogs";
import {
  ALL_COLUMNS,
  MONTH_OPTIONS,
} from "./AdminDashboard/constants";
import type {
  DashboardViewState,
  DashboardView,
  ServerSortField,
} from "./AdminDashboard/types";
import {
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  savePersistedState,
  StatusIcon,
} from "./AdminDashboard/utils";
import { useDashboardBulkActions } from "./AdminDashboard/useDashboardBulkActions";
import { useDashboardColumns } from "./AdminDashboard/useDashboardColumns";
import { useDashboardFilters } from "./AdminDashboard/useDashboardFilters";
import { useDashboardProcessingActions } from "./AdminDashboard/useDashboardProcessingActions";
import { useDashboardProcessingControls } from "./AdminDashboard/useDashboardProcessingControls";
import { useDashboardRowSelection } from "./AdminDashboard/useDashboardRowSelection";
import { useDashboardSelection } from "./AdminDashboard/useDashboardSelection";
import { DEFAULT_DASHBOARD_SORT, useDashboardSort } from "./AdminDashboard/useDashboardSort";
import { useSavedDashboardViews } from "./AdminDashboard/useSavedDashboardViews";
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>(
    () => (localStorage.getItem('dashboard-view') as DashboardView) || 'letters',
  );
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Server response data (pagination and stats)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [stats, setStats] = useState({
    total: 0, uploaded: 0, transcribed: 0, metadataReady: 0, reviewed: 0, published: 0, hidden: 0, flagged: 0,
    // Two-track content status stats
    transcriptEmpty: 0, transcriptAiDraft: 0, transcriptEdited: 0, transcriptVerified: 0,
    metadataEmpty: 0, metadataAiDraft: 0, metadataEdited: 0, metadataVerified: 0,
  });

  const {
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
    initialSortColumns,
  } = useDashboardFilters();
  const { sortColumns, setSortColumns, handleSort, getSortInfo } = useDashboardSort(initialSortColumns);
  const {
    visibleColumns,
    setVisibleColumns,
    showColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    toggleColumnMenu,
  } = useDashboardColumns();

  useEffect(() => {
    savePersistedState({
      visibilityFilter,
      collectionFilter,
      searchQuery,
      sortColumns,
      dateMode,
      year: yearFilter,
      month: monthFilter,
      day: dayFilter,
      dateFrom: dateFromFilter,
      dateTo: dateToFilter,
      transcriptStatusFilters,
      metadataStatusFilters,
    });
  }, [visibilityFilter, collectionFilter, searchQuery, sortColumns, dateMode, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

  // Copy-paste edit mode state
  const [copyModeActive, setCopyModeActive] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [sourceCell, setSourceCell] = useState<{ letterId: string; column: 'sender' | 'recipient' } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, { sender?: string; recipient?: string }>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  const fetchLetters = useCallback(async (showLoading = false, page = pagination.page) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      // Find the last server-sortable column (most recently added; skip client-side computed columns)
      const serverSort = [...sortColumns].reverse().find(col => isServerSortField(col.field));

      // Visibility: convert filter type to API param (ALL means no filter)
      const visibilityParam = visibilityFilter !== 'ALL' ? visibilityFilter : undefined;

      // Server-side filtering and pagination
      const response = await getAdminLetters({
        page,
        limit: 50,
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityParam,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : DEFAULT_DASHBOARD_SORT.field as ServerSortField,
        sortOrder: serverSort ? serverSort.direction : DEFAULT_DASHBOARD_SORT.direction,
        // Date filters
        year: yearFilter ?? undefined,
        month: monthFilter ?? undefined,
        day: dayFilter ?? undefined,
        dateFrom: dateFromFilter ?? undefined,
        dateTo: dateToFilter ?? undefined,
        // Content status filters (join arrays to comma-separated strings)
        transcriptStatus: transcriptStatusFilters.length > 0 ? transcriptStatusFilters.join(',') : undefined,
        metadataStatus: metadataStatusFilters.length > 0 ? metadataStatusFilters.join(',') : undefined,
      });
      setLetters(response.letters);
      setPagination(response.pagination);
      setStats({
        total: response.stats.total ?? 0,
        uploaded: response.stats.uploaded ?? 0,
        transcribed: response.stats.transcribed ?? 0,
        metadataReady: response.stats.metadataReady ?? 0,
        reviewed: response.stats.reviewed ?? 0,
        published: response.stats.published ?? 0,
        hidden: response.stats.hidden ?? 0,
        flagged: response.stats.flagged ?? 0,
        // Two-track content status stats (nested in API response)
        transcriptEmpty: response.stats.transcript?.empty ?? 0,
        transcriptAiDraft: response.stats.transcript?.aiDraft ?? 0,
        transcriptEdited: response.stats.transcript?.edited ?? 0,
        transcriptVerified: response.stats.transcript?.verified ?? 0,
        metadataEmpty: response.stats.metadata?.empty ?? 0,
        metadataAiDraft: response.stats.metadata?.aiDraft ?? 0,
        metadataEdited: response.stats.metadata?.edited ?? 0,
        metadataVerified: response.stats.metadata?.verified ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [collectionFilter, visibilityFilter, searchQuery, sortColumns, pagination.page, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

  // Auth check — runs once on mount
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Fetch when filters change (reset to page 1) — also handles initial load
  // Prune selections to only include items that still match the new filters
  useEffect(() => {
    if (!isAuthenticated()) return; // Don't fetch if not authenticated
    fetchLetters(true, 1);

    // If there are selections, prune to only IDs that match the new filter set
    if (selectedIds.size > 0) {
      const visibilityParam = visibilityFilter !== 'ALL' ? visibilityFilter : undefined;
      const serverSort = [...sortColumns].reverse().find(col => isServerSortField(col.field));
      getFilteredLetterIds({
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityParam,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : DEFAULT_DASHBOARD_SORT.field as ServerSortField,
        sortOrder: serverSort ? serverSort.direction : DEFAULT_DASHBOARD_SORT.direction,
        year: yearFilter ?? undefined,
        month: monthFilter ?? undefined,
        day: dayFilter ?? undefined,
        dateFrom: dateFromFilter ?? undefined,
        dateTo: dateToFilter ?? undefined,
        transcriptStatus: transcriptStatusFilters.length > 0 ? transcriptStatusFilters.join(',') : undefined,
        metadataStatus: metadataStatusFilters.length > 0 ? metadataStatusFilters.join(',') : undefined,
      }).then(validIds => {
        const validSet = new Set(validIds);
        setSelectedIds(prev => {
          const pruned = new Set([...prev].filter(id => validSet.has(id)));
          if (pruned.size === prev.size) return prev; // no change
          if (pruned.size === 0) setEditToolbarOpen(false);
          return pruned;
        });
        setAllFilteredSelected(false);
      }).catch(() => {
        // If the ID fetch fails, clear selections as a safe fallback
        clearSelection();
        setEditToolbarOpen(false);
      });
    }
  }, [collectionFilter, visibilityFilter, searchQuery, sortColumns, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

  // Apply client-side sorting for computed columns
  const filteredLetters = useMemo(() => {
    const clientSortColumns = sortColumns.filter(col => !isServerSortField(col.field));

    if (clientSortColumns.length === 0) {
      return letters;
    }

    return [...letters].sort((a, b) => {
      for (const { field, direction } of clientSortColumns) {
        let comparison = 0;

        switch (field) {
          case 'letters':
            const aLetters = a.lettersCount ?? a.images.filter(img => img.type === 'letter').length;
            const bLetters = b.lettersCount ?? b.images.filter(img => img.type === 'letter').length;
            comparison = aLetters - bLetters;
            break;
          case 'extras':
            const aExtras = a.extrasCount ?? a.images.filter(img => img.type !== 'letter').length;
            const bExtras = b.extrasCount ?? b.images.filter(img => img.type !== 'letter').length;
            comparison = aExtras - bExtras;
            break;
          case 'photos':
            const aPhotos = a.photosCount ?? a.images.filter(img => img.type === 'photo').length;
            const bPhotos = b.photosCount ?? b.images.filter(img => img.type === 'photo').length;
            comparison = aPhotos - bPhotos;
            break;
        }

        if (comparison !== 0) {
          return direction === 'asc' ? comparison : -comparison;
        }
      }
      return 0;
    });
  }, [letters, sortColumns]);

  const {
    selectedIds,
    setSelectedIds,
    allFilteredSelected,
    setAllFilteredSelected,
    toggleSelection,
    clearSelection,
    allPageSelected,
    somePageSelected: _somePageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  } = useDashboardSelection(filteredLetters);

  const {
    hasDragMoved,
    handleCheckboxChange,
    handleRowMouseDown,
    handleRowMouseEnter,
  } = useDashboardRowSelection({
    rows: filteredLetters,
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
    toggleSelection,
  });

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (hasDragMoved) return;
    // If in copy mode, don't navigate
    if (copyModeActive) return;
    // If in edit mode (rows selected or pending changes), toggle selection instead of navigating
    if (selectedIds.size > 0 || pendingChanges.size > 0) {
      handleCheckboxChange(letterId, index, e);
      return;
    }
    navigate(`/admin/letters/${letterId}`);
  };

  // Toolbar visibility is manually controlled — opens on first selection, closes only via X button
  const [editToolbarOpen, setEditToolbarOpen] = useState(false);
  const editMode = editToolbarOpen || copyModeActive || pendingChanges.size > 0;

  const singleSelectedLetter = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const [selectedId] = Array.from(selectedIds);
    return letters.find((letter) => letter.id === selectedId) ?? null;
  }, [letters, selectedIds]);

  // Publish menu counts for selected letters
  const publishCounts = useMemo(() => {
    const selected = filteredLetters.filter(l => selectedIds.has(l.id));
    return {
      lettersPublished: selected.filter(l => l.visibility === 'PUBLISHED').length,
      lettersHidden: selected.filter(l => l.visibility === 'HIDDEN').length,
      transcriptsPublished: selected.filter(l => l.transcriptPublished).length,
      transcriptsUnpublished: selected.filter(l => !l.transcriptPublished).length,
      metadataPublished: selected.filter(l => l.metadataPublished).length,
      metadataUnpublished: selected.filter(l => !l.metadataPublished).length,
    };
  }, [filteredLetters, selectedIds]);

  // Auto-open toolbar when items are selected
  useEffect(() => {
    if (selectedIds.size > 0 && !editToolbarOpen) {
      setEditToolbarOpen(true);
    }
  }, [selectedIds.size, editToolbarOpen]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  const handleToggleFlag = async (letterId: string, flagged: boolean) => {
    // Optimistic update
    setLetters(prev => prev.map(l => l.id === letterId ? { ...l, flagged, flaggedAt: flagged ? new Date().toISOString() : undefined, flaggedBy: flagged ? 'admin' : undefined } : l));
    try {
      await toggleLetterFlag(letterId, flagged);
    } catch (err) {
      // Revert optimistic update
      setLetters(prev => prev.map(l => l.id === letterId ? { ...l, flagged: !flagged, flaggedAt: !flagged ? new Date().toISOString() : undefined, flaggedBy: !flagged ? 'admin' : undefined } : l));
      showToast(
        getErrorMessage(err, `Failed to ${flagged ? 'flag' : 'unflag'} letter`),
        'error',
      );
    }
  };

  // Save pending changes + clear selection (toolbar "Done" button when in copy mode)
  const handleDone = async () => {
    if (pendingChanges.size > 0) {
      await handleSaveChanges();
    } else {
      exitEditMode();
    }
  };

  const handleSelectAllFiltered = async () => {
    try {
      const visibilityParam = visibilityFilter !== 'ALL' ? visibilityFilter : undefined;
      const serverSort = sortColumns.find(col => isServerSortField(col.field));
      const allIds = await getFilteredLetterIds({
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityParam,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : DEFAULT_DASHBOARD_SORT.field as ServerSortField,
        sortOrder: serverSort ? serverSort.direction : DEFAULT_DASHBOARD_SORT.direction,
        year: yearFilter ?? undefined,
        month: monthFilter ?? undefined,
        day: dayFilter ?? undefined,
        dateFrom: dateFromFilter ?? undefined,
        dateTo: dateToFilter ?? undefined,
        transcriptStatus: transcriptStatusFilters.length > 0 ? transcriptStatusFilters.join(',') : undefined,
        metadataStatus: metadataStatusFilters.length > 0 ? metadataStatusFilters.join(',') : undefined,
      });
      selectAllFiltered(allIds);
    } catch (err) {
      console.error('Failed to select all filtered:', err);
      showToast(getErrorMessage(err, 'Failed to select all filtered letters'), 'error');
    }
  };

  // Copy-paste mode handlers
  const toggleCopyMode = () => {
    if (copyModeActive) {
      setCopyModeActive(false);
      setCopiedValue(null);
      setSourceCell(null);
    } else {
      setCopyModeActive(true);
      setCopiedValue(null);
      setSourceCell(null);
    }
  };

  const handleCellClick = (letterId: string, column: 'sender' | 'recipient', value: string | null, e: React.MouseEvent) => {
    if (!editMode || !copyModeActive) return;

    e.stopPropagation();

    const existingChange = pendingChanges.get(letterId);
    const hasPendingChangeForColumn = existingChange && existingChange[column] !== undefined;

    if (sourceCell === null) {
      setSourceCell({ letterId, column });
      setCopiedValue(value || '');
    } else if (sourceCell.letterId === letterId && sourceCell.column === column) {
      setSourceCell(null);
      setCopiedValue(null);
    } else if (hasPendingChangeForColumn) {
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId);
        if (existing) {
          const { [column]: removed, ...rest } = existing;
          if (Object.keys(rest).length === 0) {
            next.delete(letterId);
          } else {
            next.set(letterId, rest as { sender?: string; recipient?: string });
          }
        }
        return next;
      });
    } else {
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(letterId) || {};
        next.set(letterId, { ...existing, [column]: copiedValue || '' });
        return next;
      });
    }
  };

  const handleSaveChanges = async () => {
    if (pendingChanges.size === 0) return;

    setIsSaving(true);
    try {
      const updates = Array.from(pendingChanges.entries()).map(([letterId, changes]) => ({
        letterId,
        ...changes,
      }));

      await bulkUpdateFields(updates);

      showToast(`Updated ${pendingChanges.size} letter${pendingChanges.size === 1 ? '' : 's'}`, 'success');

      exitEditMode();

      await fetchLetters();
    } catch (err) {
      console.error('Failed to save changes:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const exitEditMode = () => {
    clearSelection();
    setEditToolbarOpen(false);
    setPendingChanges(new Map());
    setCopyModeActive(false);
    setCopiedValue(null);
    setSourceCell(null);
  };

  const {
    showDeleteModal,
    deleting,
    showResetModal,
    showClearMetadataModal,
    bulkActionLoading,
    setShowResetModal,
    setShowClearMetadataModal,
    handleDeleteClick,
    handleConfirmDelete,
    handleCancelDelete,
    handleClearTranscriptionsClick,
    handleConfirmClearTranscriptions,
    handleClearMetadataClick,
    handleConfirmClearMetadata,
    handleBulkPublish,
    handleBulkHide,
    handleBulkContentVisibility,
  } = useDashboardBulkActions({
    selectedIds,
    exitEditMode,
    fetchLetters,
  });

  const {
    processingStatus,
    pausePending,
    abortPending,
    handlePauseProcessing,
    handleResumeProcessing,
    handleAbortProcessing,
  } = useDashboardProcessingControls({ fetchLetters });

  const {
    showUnconfirmedDialog,
    setShowUnconfirmedDialog,
    unconfirmedCount,
    showTranscribeConfirm,
    setShowTranscribeConfirm,
    transcribeExistingCount,
    showMetadataConfirm,
    setShowMetadataConfirm,
    metadataExistingCount,
    showSingleMetadataModal,
    setShowSingleMetadataModal,
    singleMetadataSender,
    setSingleMetadataSender,
    singleMetadataRecipient,
    setSingleMetadataRecipient,
    singleMetadataSubmitting,
    singleMetadataMode,
    handleStartTranscription,
    handleStartMetadataExtraction,
    handleConfirmUnverified,
    handleOpenTranscription,
    handleOpenMetadataExtraction,
    handleSingleMetadataExtraction,
  } = useDashboardProcessingActions({
    selectedIds,
    letters,
    singleSelectedLetter,
    collectionFilter,
    visibilityFilter,
    searchQuery,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    exitEditMode,
    fetchLetters,
  });

  const displayToDateRaw = (display: string): string | null => {
    if (!display) return null;
    const parts = display.split('/');
    if (parts.length !== 3) return null;
    const [month, day, year] = parts;
    if (year.length !== 4 || !/^\d+$/.test(year)) return null;
    const m = Number(month);
    const d = Number(day);
    if (isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
  };

  const dateRawToDisplay = (dateRaw: string | null): string => {
    if (!dateRaw || dateRaw.length < 8) return '';
    const year = dateRaw.slice(0, 4);
    const month = dateRaw.slice(4, 6);
    const day = dateRaw.slice(6, 8);
    return `${month}/${day}/${year}`;
  };

  const getDateButtonText = () => {
    if (dateMode === 'specific') {
      const parts = [];
      if (yearFilter) parts.push(yearFilter);
      if (monthFilter) parts.push(MONTH_OPTIONS[monthFilter - 1]?.label);
      if (dayFilter) parts.push(dayFilter);
      return parts.length > 0 ? parts.join(' ') : 'Date';
    } else {
      if (dateFromFilter || dateToFilter) {
        const from = dateFromFilter ? dateRawToDisplay(dateFromFilter) : '...';
        const to = dateToFilter ? dateRawToDisplay(dateToFilter) : '...';
        return `${from} - ${to}`;
      }
      return 'Date';
    }
  };

  const handleDashboardViewChange = (view: DashboardView) => {
    setDashboardView(view);
    localStorage.setItem("dashboard-view", view);
  };

  const getCurrentDashboardViewState = useCallback((): DashboardViewState => ({
    visibilityFilter,
    collectionFilter,
    searchQuery,
    sortColumns,
    dateMode,
    year: yearFilter,
    month: monthFilter,
    day: dayFilter,
    dateFrom: dateFromFilter,
    dateTo: dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    visibleColumns: Array.from(visibleColumns),
  }), [
    visibilityFilter,
    collectionFilter,
    searchQuery,
    sortColumns,
    dateMode,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    visibleColumns,
  ]);

  const applyDashboardViewState = useCallback((state: DashboardViewState) => {
    setVisibilityFilter(state.visibilityFilter);
    setCollectionFilter(state.collectionFilter);
    setCollectionInput(state.collectionFilter === "all" ? "" : state.collectionFilter);
    setSearchInput(state.searchQuery);
    setSearchQuery(state.searchQuery);
    setSortColumns(state.sortColumns);
    setDateMode(state.dateMode);
    setYearFilter(state.year);
    setMonthFilter(state.month);
    setDayFilter(state.day);
    setDateFromFilter(state.dateFrom);
    setDateToFilter(state.dateTo);
    setTranscriptStatusFilters(state.transcriptStatusFilters as ContentStatus[]);
    setMetadataStatusFilters(state.metadataStatusFilters as ContentStatus[]);
    setVisibleColumns(new Set(state.visibleColumns));
  }, [
    setVisibilityFilter,
    setCollectionFilter,
    setCollectionInput,
    setSearchInput,
    setSearchQuery,
    setSortColumns,
    setDateMode,
    setYearFilter,
    setMonthFilter,
    setDayFilter,
    setDateFromFilter,
    setDateToFilter,
    setTranscriptStatusFilters,
    setMetadataStatusFilters,
    setVisibleColumns,
  ]);

  const {
    savedViews,
    saveView: handleSaveDashboardView,
    applyView: handleApplyDashboardView,
    deleteView: handleDeleteDashboardView,
  } = useSavedDashboardViews({
    getCurrentState: getCurrentDashboardViewState,
    applyState: applyDashboardViewState,
    onSaved: (name) => showToast(`Saved view "${name}"`, "success"),
    onApplied: (name) => showToast(`Loaded view "${name}"`, "info"),
  });

  if (loading && isInitialLoad) {
    return (
      <AdminLayout fullHeight>
        <div className="admin-dashboard">
          <div className="admin-content loading-content">
            <p>Loading letters...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout fullHeight>
        <div className="admin-dashboard">
          <div className="admin-content error-content">
            <p className="error-message">{error}</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout fullHeight>
    <div className="admin-dashboard">
      <section className="dashboard-toolbar" aria-label="Dashboard controls">
        <DashboardToolbar
          dashboardView={dashboardView}
          onDashboardViewChange={handleDashboardViewChange}
          mobileFiltersOpen={mobileFiltersOpen}
          onMobileFiltersOpenChange={setMobileFiltersOpen}
          paginationTotal={pagination.total}
          stats={stats}
          sortColumns={sortColumns}
          setSortColumns={setSortColumns}
          savedViews={savedViews}
          onSaveView={handleSaveDashboardView}
          onApplyView={handleApplyDashboardView}
          onDeleteView={handleDeleteDashboardView}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          collectionInput={collectionInput}
          collectionFilter={collectionFilter}
          handleCollectionInputChange={handleCollectionInputChange}
          visibilityFilter={visibilityFilter}
          toggleVisibilityFilter={toggleVisibilityFilter}
          contentFilterView={contentFilterView}
          setContentFilterView={setContentFilterView}
          transcriptStatusFilters={transcriptStatusFilters}
          toggleTranscriptFilter={toggleTranscriptFilter}
          metadataStatusFilters={metadataStatusFilters}
          toggleMetadataFilter={toggleMetadataFilter}
          showDateDropdown={showDateDropdown}
          setShowDateDropdown={setShowDateDropdown}
          dateDropdownRef={dateDropdownRef}
          dateMode={dateMode}
          setDateMode={setDateMode}
          hasDateFilter={hasDateFilter}
          yearFilter={yearFilter}
          setYearFilter={setYearFilter}
          monthFilter={monthFilter}
          setMonthFilter={setMonthFilter}
          dayFilter={dayFilter}
          setDayFilter={setDayFilter}
          dateFromFilter={dateFromFilter}
          setDateFromFilter={setDateFromFilter}
          dateToFilter={dateToFilter}
          setDateToFilter={setDateToFilter}
          clearDateFilters={clearDateFilters}
          handleClearAllFilters={handleClearAllFilters}
          getDateButtonText={getDateButtonText}
          dateRawToDisplay={dateRawToDisplay}
          displayToDateRaw={displayToDateRaw}
          processingStatus={processingStatus}
          selectedCount={selectedIds.size}
        />
      </section>
      {dashboardView === 'collections' && <CollectionsDashboard />}
      {dashboardView === 'letters' && <>
      <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
        <RecentActivityTable
          filteredLetters={filteredLetters}
          visibleColumns={visibleColumns}
          getSortInfo={getSortInfo}
          onSort={handleSort}
          onRowClick={handleRowClick}
          onRowMouseDown={handleRowMouseDown}
          onRowMouseEnter={handleRowMouseEnter}
          onCheckboxChange={handleCheckboxChange}
          selectedIds={selectedIds}
          editMode={editMode}
          copyModeActive={copyModeActive}
          sourceCell={sourceCell}
          pendingChanges={pendingChanges}
          onCellClick={handleCellClick}
          formatDate={formatDate}
          formatDateRaw={formatDateRaw}
          getCombinedTranscriptStatus={getCombinedTranscriptStatus}
          renderStatusIcon={(status, type) => <StatusIcon status={status} type={type} />}
          pagination={pagination}
          loading={loading}
          onPageChange={(page) => fetchLetters(true, page)}
          letterCountText={`${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`}
          allColumns={ALL_COLUMNS}
          showColumnMenu={showColumnMenu}
          onToggleColumnMenu={toggleColumnMenu}
          onToggleColumn={toggleColumnVisibility}
          columnMenuRef={columnMenuRef}
          onToggleFlag={handleToggleFlag}
        />
      </div>

      <DashboardDialogs
        selectedCount={selectedIds.size}
        deleting={deleting}
        bulkActionLoading={bulkActionLoading}
        showDeleteModal={showDeleteModal}
        showResetModal={showResetModal}
        showClearMetadataModal={showClearMetadataModal}
        showUnconfirmedDialog={showUnconfirmedDialog}
        unconfirmedCount={unconfirmedCount}
        showTranscribeConfirm={showTranscribeConfirm}
        transcribeExistingCount={transcribeExistingCount}
        showMetadataConfirm={showMetadataConfirm}
        metadataExistingCount={metadataExistingCount}
        showSingleMetadataModal={showSingleMetadataModal}
        singleMetadataSender={singleMetadataSender}
        singleMetadataRecipient={singleMetadataRecipient}
        singleMetadataSubmitting={singleMetadataSubmitting}
        singleMetadataMode={singleMetadataMode}
        singleMetadataLetterTitle={singleSelectedLetter?.title}
        onConfirmDelete={handleConfirmDelete}
        onCancelDelete={handleCancelDelete}
        onConfirmClearTranscriptions={handleConfirmClearTranscriptions}
        onCancelClearTranscriptions={() => setShowResetModal(false)}
        onConfirmClearMetadata={handleConfirmClearMetadata}
        onCancelClearMetadata={() => setShowClearMetadataModal(false)}
        onConfirmUnverified={handleConfirmUnverified}
        onCancelUnverified={() => setShowUnconfirmedDialog(false)}
        onCancelTranscribe={() => setShowTranscribeConfirm(false)}
        onStartTranscription={(skipExisting) => {
          setShowTranscribeConfirm(false);
          void handleStartTranscription(skipExisting);
        }}
        onCancelMetadata={() => setShowMetadataConfirm(false)}
        onStartMetadataExtraction={(skipConfirmation, skipExisting) => {
          setShowMetadataConfirm(false);
          void handleStartMetadataExtraction(skipConfirmation, skipExisting);
        }}
        onCloseSingleMetadata={() => setShowSingleMetadataModal(false)}
        onConfirmSingleMetadata={() => void handleSingleMetadataExtraction()}
        onSingleMetadataSenderChange={setSingleMetadataSender}
        onSingleMetadataRecipientChange={setSingleMetadataRecipient}
      />


      {editMode && (
        <BulkEditToolbar
          selectedCount={selectedIds.size}
          pageCount={filteredLetters.length}
          totalCount={pagination.total}
          allPageSelected={allPageSelected}
          allFilteredSelected={allFilteredSelected}
          copyModeActive={copyModeActive}
          copiedValue={copiedValue}
          sourceCell={sourceCell}
          pendingChangesCount={pendingChanges.size}
          isSaving={isSaving}
          bulkActionLoading={bulkActionLoading}
          processingStatus={processingStatus}
          pausePending={pausePending}
          abortPending={abortPending}
          publishCounts={publishCounts}
          onSelectPage={handleSelectAllPage}
          onSelectAllFiltered={handleSelectAllFiltered}
          onClearSelection={clearSelection}
          onToggleCopyMode={toggleCopyMode}
          onOpenTranscription={handleOpenTranscription}
          onOpenMetadataExtraction={handleOpenMetadataExtraction}
          onPauseProcessing={handlePauseProcessing}
          onResumeProcessing={handleResumeProcessing}
          onAbortProcessing={handleAbortProcessing}
          onBulkHide={handleBulkHide}
          onBulkPublish={handleBulkPublish}
          onBulkContentVisibility={handleBulkContentVisibility}
          onClearTranscriptions={handleClearTranscriptionsClick}
          onClearMetadata={handleClearMetadataClick}
          onDelete={handleDeleteClick}
          onDone={handleDone}
          onExit={exitEditMode}
        />
      )}
      </>}
    </div>
    </AdminLayout>
  );
}
