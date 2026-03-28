import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getAdminLetters, getFilteredLetterIds, deleteLetter } from "../../api/letters";
import { toggleLetterFlag, publishLetter, hideLetter } from "../../api/admin/letters";
import {
  getProcessingStatus,
  startTranscription,
  startMetadataExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  bulkClearTranscriptions,
  bulkClearMetadata,
  bulkTranscribe,
  bulkExtractMetadata,
  bulkUpdateFields,
  type ProcessingStatus,
} from "../../api/admin";
import { useToast } from "../../contexts/ToastContext";
import type { Letter } from "../../types/Letter";
import {
  Button,
  ConfirmDialog,
} from "../../components/common";
import AdminLayout from "../../components/AdminLayout";
import Icon from "../../components/common/Icon";
import { getRecentEdits, formatTimeAgo, type RecentEdit } from "../../utils/recentEdits";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import {
  ALL_COLUMNS,
  DAY_OPTIONS,
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "./AdminDashboard/constants";
import type {
  ServerSortField,
} from "./AdminDashboard/types";
import {
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  savePersistedState,
  StatusIcon,
} from "./AdminDashboard/utils";
import { useDashboardColumns } from "./AdminDashboard/useDashboardColumns";
import { useDashboardFilters } from "./AdminDashboard/useDashboardFilters";
import { useDashboardSelection } from "./AdminDashboard/useDashboardSelection";
import { useDashboardSort } from "./AdminDashboard/useDashboardSort";
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

type DashboardView = 'letters' | 'collections';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [dashboardView, setDashboardView] = useState<DashboardView>('letters');
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
    handleCollectionInputChange,
    visibilityFilter,
    toggleVisibilityFilter,
    transcriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    toggleMetadataFilter,
    collectionFilter,
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
    hasDateFilter,
    clearDateFilters,
    handleClearAllFilters,
    initialSortColumns,
  } = useDashboardFilters();
  const { sortColumns, handleSort, getSortInfo } = useDashboardSort(initialSortColumns);
  const {
    visibleColumns,
    showColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    toggleColumnMenu,
  } = useDashboardColumns();

  // Recent edits state (moved from AdminLayout)
  const [recentEdits, setRecentEdits] = useState<RecentEdit[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  // Load recent edits
  useEffect(() => {
    setRecentEdits(getRecentEdits());
  }, []);

  // Close recent dropdown on click outside
  useEffect(() => {
    if (!showRecent) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRecent]);

  const handleRecentClick = (id: string) => {
    setShowRecent(false);
    navigate(`/admin/letters/${id}`);
  };

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

  // Selection-driven toolbar (no manual edit mode toggle)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showClearMetadataModal, setShowClearMetadataModal] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [hasDragMoved, setHasDragMoved] = useState(false);

  // Copy-paste edit mode state
  const [copyModeActive, setCopyModeActive] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [sourceCell, setSourceCell] = useState<{ letterId: string; column: 'sender' | 'recipient' } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, { sender?: string; recipient?: string }>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  // Processing state
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [wasRunning, setWasRunning] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<number | null>(null);
  const [showUnconfirmedDialog, setShowUnconfirmedDialog] = useState(false);
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);
  const [pendingMetadataIds, setPendingMetadataIds] = useState<string[]>([]);
  const [showTranscribeConfirm, setShowTranscribeConfirm] = useState(false);
  const [showMetadataConfirm, setShowMetadataConfirm] = useState(false);
  // Overwrite/skip state for transcribe and metadata
  const [transcribeExistingCount, setTranscribeExistingCount] = useState(0);
  const [metadataExistingCount, setMetadataExistingCount] = useState(0);

  const fetchLetters = useCallback(async (showLoading = false, page = pagination.page) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      // Find the first server-sortable column (skip client-side computed columns)
      const serverSort = sortColumns.find(col => isServerSortField(col.field));

      // Visibility: convert filter type to API param (ALL means no filter)
      const visibilityParam = visibilityFilter !== 'ALL' ? visibilityFilter : undefined;

      // Server-side filtering and pagination
      const response = await getAdminLetters({
        page,
        limit: 50,
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityParam,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : 'createdAt',
        sortOrder: serverSort ? serverSort.direction : 'desc',
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
      const serverSort = sortColumns.find(col => isServerSortField(col.field));
      getFilteredLetterIds({
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityParam,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : 'createdAt',
        sortOrder: serverSort ? serverSort.direction : 'desc',
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

  // Checkbox-driven selection with shift-click range support
  const handleCheckboxChange = (letterId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const newSelected = new Set(selectedIds);
      for (let i = start; i <= end; i++) {
        newSelected.add(filteredLetters[i].id);
      }
      setSelectedIds(newSelected);
      setAllFilteredSelected(false);
    } else {
      toggleSelection(letterId);
    }
    setLastClickedIndex(index);
  };

  // Drag selection handlers — always active for multi-select
  const handleRowMouseDown = (index: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const tagName = (e.target as HTMLElement).tagName;
    if (tagName === "INPUT" || tagName === "BUTTON") return;

    const letterId = filteredLetters[index].id;
    const mode = selectedIds.has(letterId) ? "deselect" : "select";

    setIsDragging(true);
    setDragStartIndex(index);
    setDragMode(mode);
    setDraggedIds(new Set([letterId]));
    setHasDragMoved(false);
    e.preventDefault();
  };

  const handleRowMouseEnter = (index: number) => {
    if (!isDragging || dragStartIndex === null || dragMode === null) return;

    if (!hasDragMoved) {
      setHasDragMoved(true);
    }

    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);

    const rangeIds = new Set<string>();
    for (let i = start; i <= end; i++) {
      rangeIds.add(filteredLetters[i].id);
    }

    const newSelected = new Set(selectedIds);

    draggedIds.forEach((id) => {
      if (!rangeIds.has(id)) {
        if (dragMode === "select") {
          newSelected.delete(id);
        } else {
          newSelected.add(id);
        }
      }
    });

    rangeIds.forEach((id) => {
      if (dragMode === "select") {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
    });

    setDraggedIds(rangeIds);
    setSelectedIds(newSelected);
    setAllFilteredSelected(false);
  };

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDragStartIndex(null);
      setDragMode(null);
      setDraggedIds(new Set());
    }
  }, [isDragging]);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

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
    somePageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  } = useDashboardSelection(filteredLetters);

  // Toolbar visibility is manually controlled — opens on first selection, closes only via X button
  const [editToolbarOpen, setEditToolbarOpen] = useState(false);
  const editMode = editToolbarOpen || copyModeActive || pendingChanges.size > 0;

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
        sort: serverSort ? (serverSort.field as ServerSortField) : 'createdAt',
        sortOrder: serverSort ? serverSort.direction : 'desc',
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

  const handleDeleteClick = () => {
    if (selectedIds.size > 0) {
      setShowDeleteModal(true);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteLetter(id)));
      exitEditMode();
      setShowDeleteModal(false);

      showToast(`Deleted ${count} letter${count === 1 ? '' : 's'}`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to delete letters:", err);
      showToast(err instanceof Error ? err.message : "Failed to delete letters", 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
  };

  // Bulk action handlers
  const handleClearTranscriptionsClick = () => {
    if (selectedIds.size > 0) {
      setShowResetModal(true);
    }
  };

  const handleConfirmClearTranscriptions = async () => {
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkClearTranscriptions(Array.from(selectedIds));
      exitEditMode();
      setShowResetModal(false);
      showToast(`Cleared transcriptions for ${count} letter${count === 1 ? '' : 's'}`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to clear transcriptions:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear transcriptions", 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleClearMetadataClick = () => {
    if (selectedIds.size > 0) {
      setShowClearMetadataModal(true);
    }
  };

  const handleConfirmClearMetadata = async () => {
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkClearMetadata(Array.from(selectedIds));
      exitEditMode();
      setShowClearMetadataModal(false);
      showToast(`Cleared metadata for ${count} letter${count === 1 ? '' : 's'}`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to clear metadata:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear metadata", 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkPublish = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map(id => publishLetter(id)));
      showToast(`Published ${count} letter${count === 1 ? '' : 's'}`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to publish:", err);
      showToast(err instanceof Error ? err.message : "Failed to publish letters", 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkHide = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map(id => hideLetter(id)));
      showToast(`Hid ${count} letter${count === 1 ? '' : 's'}`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to hide:", err);
      showToast(err instanceof Error ? err.message : "Failed to hide letters", 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Build filter options for processing endpoints
  const buildProcessingFilters = () => ({
    collectionCode: collectionFilter !== "all" ? collectionFilter : undefined,
    visibility: visibilityFilter !== 'ALL' ? visibilityFilter : undefined,
    search: searchQuery || undefined,
    year: yearFilter ?? undefined,
    month: monthFilter ?? undefined,
    day: dayFilter ?? undefined,
    dateFrom: dateFromFilter ?? undefined,
    dateTo: dateToFilter ?? undefined,
  });

  const summarizeSkipReasons = (reasons: Array<{ reason: string }>) => {
    const counts = new Map<string, number>();
    for (const { reason } of reasons) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => count > 1 ? `${count} ${reason}` : reason)
      .join(', ');
  };

  const handleStartTranscription = async (skipExisting = false) => {
    try {
      if (selectedIds.size > 0) {
        let ids = Array.from(selectedIds);
        if (skipExisting) {
          ids = letters.filter(l => ids.includes(l.id) && l.transcriptStatus === 'EMPTY').map(l => l.id);
          if (ids.length === 0) {
            showToast('No letters without transcripts to process', 'info');
            return;
          }
        }
        const result = await bulkTranscribe(ids);
        if (result.queued === 0 && result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          showToast(`No letters processed: ${summary}`, 'error');
        } else if (result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          const verb = result.processing ? 'Processing' : 'Queued';
          showToast(`${verb} ${result.queued} for transcription. Skipped: ${summary}`, 'info');
        } else {
          const verb = result.processing ? 'Processing' : 'Queued';
          showToast(`${verb} ${result.queued} letters for transcription`, 'success');
        }
        exitEditMode();
        await fetchLetters();
      } else {
        const result = await startTranscription(buildProcessingFilters());
        showToast(`Started transcription for ${result.total} letters`, 'success');
      }
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", 'error');
    }
  };

  const handleStartMetadataExtraction = async (skipConfirmation = false, skipExisting = false) => {
    try {
      if (selectedIds.size > 0) {
        let ids = skipConfirmation ? pendingMetadataIds : Array.from(selectedIds);
        if (skipExisting) {
          ids = letters.filter(l => ids.includes(l.id) && l.metadataContentStatus === 'EMPTY').map(l => l.id);
          if (ids.length === 0) {
            showToast('No letters without metadata to process', 'info');
            return;
          }
        }
        const result = await bulkExtractMetadata(ids, skipConfirmation);

        if (result.unconfirmedCount && result.unconfirmedCount > 0 && !skipConfirmation && result.queued === 0) {
          setUnconfirmedCount(result.unconfirmedCount);
          setPendingMetadataIds(ids);
          setShowUnconfirmedDialog(true);
          return;
        }

        if (result.queued === 0 && result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          showToast(`No letters processed: ${summary}`, 'error');
        } else if (result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          const verb = result.processing ? 'Processing' : 'Queued';
          showToast(`${verb} ${result.queued} for metadata extraction. Skipped: ${summary}`, 'info');
        } else {
          const verb = result.processing ? 'Processing' : 'Queued';
          showToast(`${verb} ${result.queued} letters for metadata extraction`, 'success');
        }
        exitEditMode();
        await fetchLetters();
      } else {
        const result = await startMetadataExtraction(buildProcessingFilters());
        showToast(`Started metadata extraction for ${result.total} letters`, 'success');
      }
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", 'error');
    }
  };

  const handleConfirmUnverified = async () => {
    setShowUnconfirmedDialog(false);
    await handleStartMetadataExtraction(true);
  };


  const handlePauseProcessing = async () => {
    try {
      await pauseProcessing();
      showToast('Processing paused', 'info');
    } catch (err) {
      console.error("Failed to pause processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to pause processing", 'error');
    }
  };

  const handleResumeProcessing = async () => {
    try {
      await resumeProcessing();
      showToast('Processing resumed', 'info');
    } catch (err) {
      console.error("Failed to resume processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to resume processing", 'error');
    }
  };

  const handleAbortProcessing = async () => {
    try {
      await abortProcessing();
      showToast('Processing aborted', 'info');
    } catch (err) {
      console.error("Failed to abort processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to abort processing", 'error');
    }
  };

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

  // Count active filters for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (collectionFilter !== 'all') count++;
    if (visibilityFilter !== 'ALL') count++;
    if (searchQuery) count++;
    if (transcriptStatusFilters.length > 0) count += transcriptStatusFilters.length;
    if (metadataStatusFilters.length > 0) count += metadataStatusFilters.length;
    if (yearFilter !== null) count++;
    if (monthFilter !== null) count++;
    if (dayFilter !== null) count++;
    if (dateFromFilter !== null) count++;
    if (dateToFilter !== null) count++;
    return count;
  }, [collectionFilter, visibilityFilter, searchQuery, transcriptStatusFilters, metadataStatusFilters, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter]);

  // Poll for processing status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getProcessingStatus();
        setProcessingStatus(status);

        if (status.lastCompletedAt && status.lastCompletedAt !== lastCompletedAt) {
          setLastCompletedAt(status.lastCompletedAt);
          fetchLetters();
        }

        if (!status.isRunning && wasRunning) {
          fetchLetters();
        }
        setWasRunning(status.isRunning);
      } catch (err) {
        // Silently ignore polling failures
        console.debug("Processing status poll failed:", err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, [wasRunning, lastCompletedAt, fetchLetters]);

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

  // Header action buttons for AdminLayout - now includes all filters
  const headerActions = (
    <div className="header-filters-row">
      {/* Dashboard view toggle */}
      <div className="dashboard-view-toggle">
        <button
          className={`view-toggle-btn ${dashboardView === 'letters' ? 'active' : ''}`}
          onClick={() => setDashboardView('letters')}
        >
          Letters
        </button>
        <button
          className={`view-toggle-btn ${dashboardView === 'collections' ? 'active' : ''}`}
          onClick={() => setDashboardView('collections')}
        >
          Collections
        </button>
      </div>
      {dashboardView === 'letters' && <div className="header-filters-left">
        {/* Visibility group: pills stacked vertically */}
        <div className="filter-group-stacked">
          <div className="filter-buttons filter-buttons-vertical">
            <button
              className={`filter-pill filter-published ${visibilityFilter === "PUBLISHED" ? "active" : ""}`}
              onClick={() => toggleVisibilityFilter("PUBLISHED")}
              title="Published letters"
            >
              {stats.published} Public
            </button>
            <button
              className={`filter-pill filter-hidden ${visibilityFilter === "HIDDEN" ? "active" : ""}`}
              onClick={() => toggleVisibilityFilter("HIDDEN")}
              title="Hidden letters"
            >
              {stats.hidden} Hidden
            </button>
          </div>
        </div>

        {/* Content filter group: toggle + status pills */}
        <div className="filter-group-stacked">
          <div className="content-filter-toggle">
            <button
              className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
              onClick={() => setContentFilterView("transcript")}
            >
              Transcript
              {contentFilterView !== "transcript" &&
                transcriptStatusFilters.length > 0 && (
                  <span className="toggle-badge">
                    {transcriptStatusFilters.length}
                  </span>
                )}
            </button>
            <button
              className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
              onClick={() => setContentFilterView("metadata")}
            >
              Metadata
              {contentFilterView !== "metadata" &&
                metadataStatusFilters.length > 0 && (
                  <span className="toggle-badge">
                    {metadataStatusFilters.length}
                  </span>
                )}
            </button>
          </div>
          <div className="filter-buttons">
            {contentFilterView === "transcript" ? (
              <>
                <button
                  className={`filter-pill filter-content-none ${transcriptStatusFilters.includes("EMPTY") ? "active" : ""}`}
                  onClick={() => toggleTranscriptFilter("EMPTY")}
                  title="No transcript data"
                >
                  {stats.transcriptEmpty} None
                </button>
                <button
                  className={`filter-pill filter-content-draft ${transcriptStatusFilters.includes("AI_DRAFT") ? "active" : ""}`}
                  onClick={() => toggleTranscriptFilter("AI_DRAFT")}
                  title="AI Draft transcripts"
                >
                  {stats.transcriptAiDraft} Draft
                </button>
                <button
                  className={`filter-pill filter-content-edited ${transcriptStatusFilters.includes("EDITED") ? "active" : ""}`}
                  onClick={() => toggleTranscriptFilter("EDITED")}
                  title="Edited transcripts"
                >
                  {stats.transcriptEdited} Edited
                </button>
                <button
                  className={`filter-pill filter-content-verified ${transcriptStatusFilters.includes("VERIFIED") ? "active" : ""}`}
                  onClick={() => toggleTranscriptFilter("VERIFIED")}
                  title="Verified transcripts"
                >
                  {stats.transcriptVerified} Done
                </button>
              </>
            ) : (
              <>
                <button
                  className={`filter-pill filter-content-none ${metadataStatusFilters.includes("EMPTY") ? "active" : ""}`}
                  onClick={() => toggleMetadataFilter("EMPTY")}
                  title="No metadata"
                >
                  {stats.metadataEmpty} None
                </button>
                <button
                  className={`filter-pill filter-content-draft ${metadataStatusFilters.includes("AI_DRAFT") ? "active" : ""}`}
                  onClick={() => toggleMetadataFilter("AI_DRAFT")}
                  title="AI Draft metadata"
                >
                  {stats.metadataAiDraft} Draft
                </button>
                <button
                  className={`filter-pill filter-content-edited ${metadataStatusFilters.includes("EDITED") ? "active" : ""}`}
                  onClick={() => toggleMetadataFilter("EDITED")}
                  title="Edited metadata"
                >
                  {stats.metadataEdited} Edited
                </button>
                <button
                  className={`filter-pill filter-content-verified ${metadataStatusFilters.includes("VERIFIED") ? "active" : ""}`}
                  onClick={() => toggleMetadataFilter("VERIFIED")}
                  title="Verified metadata"
                >
                  {stats.metadataVerified} Done
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filter controls: search on top, date+collection+clear on bottom */}
        <div className="filter-group-stacked">
          <div className="filter-group-row">
            <div className="filter-group search-group">
              <input
                type="text"
                placeholder="Search..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
          <div className="filter-group-row">
            <div className="dropdown-container" ref={dateDropdownRef}>
              <button
                className={`dropdown-trigger ${hasDateFilter ? "active" : ""}`}
                onClick={() => setShowDateDropdown(!showDateDropdown)}
              >
                {getDateButtonText()} ▾
              </button>
              {showDateDropdown && (
                <div className="date-dropdown-panel">
                  <div className="date-mode-toggle">
                    <button
                      className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
                      onClick={() => {
                        setDateMode("specific");
                        // Clear range values so they don't silently persist
                        setDateFromFilter(null);
                        setDateToFilter(null);
                      }}
                    >
                      Specific
                    </button>
                    <button
                      className={`mode-btn ${dateMode === "range" ? "active" : ""}`}
                      onClick={() => {
                        setDateMode("range");
                        // Clear specific values so they don't silently persist
                        setYearFilter(null);
                        setMonthFilter(null);
                        setDayFilter(null);
                      }}
                    >
                      Range
                    </button>
                  </div>

                  {dateMode === "specific" ? (
                    <div className="date-dropdowns">
                      <select
                        value={yearFilter ?? ""}
                        onChange={(e) =>
                          setYearFilter(e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">Year</option>
                        {YEAR_OPTIONS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <select
                        value={monthFilter ?? ""}
                        onChange={(e) =>
                          setMonthFilter(e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">Month</option>
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <select
                        value={dayFilter ?? ""}
                        onChange={(e) =>
                          setDayFilter(e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">Day</option>
                        {DAY_OPTIONS.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="date-range-inputs">
                      <div className="date-range-field">
                        <label>From</label>
                        <input
                          type="text"
                          placeholder="mm/dd/yyyy"
                          value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""}
                          onChange={(e) => setDateFromFilter(displayToDateRaw(e.target.value))}
                          maxLength={10}
                        />
                      </div>
                      <div className="date-range-field">
                        <label>To</label>
                        <input
                          type="text"
                          placeholder="mm/dd/yyyy"
                          value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""}
                          onChange={(e) => setDateToFilter(displayToDateRaw(e.target.value))}
                          maxLength={10}
                        />
                      </div>
                    </div>
                  )}

                  {hasDateFilter && (
                    <button className="date-clear-btn" onClick={clearDateFilters}>
                      Clear Date
                    </button>
                  )}
                </div>
              )}
            </div>
            <input
              type="text"
              className="collection-input"
              placeholder="000"
              title="Filter by collection number"
              value={collectionInput}
              onChange={(e) => handleCollectionInputChange(e.target.value)}
              maxLength={3}
            />
            {activeFilterCount > 0 && (
              <button className="clear-all-btn" onClick={handleClearAllFilters}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Processing status pill (when running and not in edit mode) */}
        {processingStatus?.isRunning && selectedIds.size === 0 && (
          <span className="stat-pill stat-processing">
            {processingStatus.currentJob?.type === "transcription" ? "T" : "M"}:{" "}
            {processingStatus.completed}/{processingStatus.total}
          </span>
        )}
      </div>}

      {/* Actions: Recent edits */}
      <div className="header-actions-right">
        <div className="filter-group-stacked">
          <div className="recent-edits-dropdown" ref={recentDropdownRef}>
            <button
              className="recent-edits-btn"
              onClick={() => setShowRecent(!showRecent)}
            >
              <Icon name="refresh" size={12} />
              Recent
              <Icon name="chevron-down" size={10} />
            </button>
            {showRecent && (
              <div className="history-dropdown">
                <div className="history-header">Edit History</div>
                <div className="history-items">
                  {recentEdits.length === 0 ? (
                    <div className="history-empty">No recent edits</div>
                  ) : (
                    recentEdits.map((edit) => (
                      <div
                        key={edit.id}
                        className="history-item"
                        onClick={() => handleRecentClick(edit.id)}
                      >
                        <span className="history-info">{edit.displayName}</span>
                        <span className="history-time">{formatTimeAgo(edit.editedAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <AdminLayout headerActions={headerActions} fullHeight>
    <div className="admin-dashboard">
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

      {/* Delete confirmation modal */}
      <ConfirmDialog
        isOpen={showDeleteModal}
        title="Delete Letters"
        message={`Are you sure you want to delete ${selectedIds.size} letter${selectedIds.size === 1 ? "" : "s"}?`}
        confirmText={deleting ? "Deleting..." : "Delete"}
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* Clear transcriptions confirmation modal */}
      <ConfirmDialog
        isOpen={showResetModal}
        title="Clear Transcriptions"
        message={`This will clear all transcriptions (including extra content), metadata, and entity links for ${selectedIds.size} letter${selectedIds.size === 1 ? "" : "s"}, returning them to UPLOADED state. You will need to re-transcribe them.`}
        confirmText={bulkActionLoading ? "Clearing..." : "Clear Transcriptions"}
        loading={bulkActionLoading}
        onConfirm={handleConfirmClearTranscriptions}
        onCancel={() => setShowResetModal(false)}
      />

      {/* Clear metadata confirmation modal */}
      <ConfirmDialog
        isOpen={showClearMetadataModal}
        title="Clear Metadata"
        message={`This will clear all metadata, entity links, and extracted entities for ${selectedIds.size} letter${selectedIds.size === 1 ? "" : "s"}. The transcriptions will be kept intact.`}
        confirmText={bulkActionLoading ? "Clearing..." : "Clear Metadata"}
        loading={bulkActionLoading}
        onConfirm={handleConfirmClearMetadata}
        onCancel={() => setShowClearMetadataModal(false)}
      />

      <ConfirmDialog
        isOpen={showUnconfirmedDialog}
        title="Unverified Transcripts"
        message={`${unconfirmedCount} of the selected letter${unconfirmedCount === 1 ? ' has an' : 's have'} unverified transcript${unconfirmedCount === 1 ? '' : 's'}. Metadata extraction may be less accurate without verified transcripts. Do you want to proceed anyway?`}
        confirmText="Extract Anyway"
        onConfirm={handleConfirmUnverified}
        onCancel={() => setShowUnconfirmedDialog(false)}
      />

      {/* Transcribe confirmation — with overwrite/skip when existing transcripts found */}
      {showTranscribeConfirm && (
        <div className="modal-overlay" onClick={() => setShowTranscribeConfirm(false)}>
          <div className="modal-content modal-sm confirm-dialog" onClick={e => e.stopPropagation()}>
            <h2 className="confirm-dialog-title">Transcribe Letters</h2>
            <div className="confirm-dialog-message">
              {transcribeExistingCount > 0 && selectedIds.size > 0 ? (
                <p>
                  {transcribeExistingCount} of {selectedIds.size} selected letter{selectedIds.size === 1 ? '' : 's'} already
                  {transcribeExistingCount === 1 ? ' has a' : ' have'} transcript{transcribeExistingCount === 1 ? '' : 's'}.
                  Would you like to overwrite existing transcripts or skip them?
                </p>
              ) : (
                <p>Transcribe {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all'} letter{selectedIds.size === 1 ? '' : 's'}?</p>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <Button variant="secondary" onClick={() => setShowTranscribeConfirm(false)}>Cancel</Button>
              {transcribeExistingCount > 0 && selectedIds.size > 0 ? (
                <>
                  <Button variant="secondary" onClick={() => { setShowTranscribeConfirm(false); handleStartTranscription(true); }}>
                    Skip Existing ({selectedIds.size - transcribeExistingCount})
                  </Button>
                  <Button variant="primary" onClick={() => { setShowTranscribeConfirm(false); handleStartTranscription(false); }}>
                    Overwrite All ({selectedIds.size})
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => { setShowTranscribeConfirm(false); handleStartTranscription(); }}>
                  Transcribe
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extract Metadata confirmation — with overwrite/skip when existing metadata found */}
      {showMetadataConfirm && (
        <div className="modal-overlay" onClick={() => setShowMetadataConfirm(false)}>
          <div className="modal-content modal-sm confirm-dialog" onClick={e => e.stopPropagation()}>
            <h2 className="confirm-dialog-title">Extract Metadata</h2>
            <div className="confirm-dialog-message">
              {metadataExistingCount > 0 && selectedIds.size > 0 ? (
                <p>
                  {metadataExistingCount} of {selectedIds.size} selected letter{selectedIds.size === 1 ? '' : 's'} already
                  {metadataExistingCount === 1 ? ' has' : ' have'} metadata.
                  Would you like to overwrite existing metadata or skip them?
                </p>
              ) : (
                <p>Extract metadata for {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all'} letter{selectedIds.size === 1 ? '' : 's'}?</p>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <Button variant="secondary" onClick={() => setShowMetadataConfirm(false)}>Cancel</Button>
              {metadataExistingCount > 0 && selectedIds.size > 0 ? (
                <>
                  <Button variant="secondary" onClick={() => { setShowMetadataConfirm(false); handleStartMetadataExtraction(false, true); }}>
                    Skip Existing ({selectedIds.size - metadataExistingCount})
                  </Button>
                  <Button variant="primary" onClick={() => { setShowMetadataConfirm(false); handleStartMetadataExtraction(); }}>
                    Overwrite All ({selectedIds.size})
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => { setShowMetadataConfirm(false); handleStartMetadataExtraction(); }}>
                  Extract
                </Button>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Floating edit toolbar with process actions */}
      {editMode && (
        <div className="edit-toolbar visible">
          <div className="edit-toolbar-content">
            {/* Left section: select all, selection count, copy mode, hints, pending changes */}
            <div className="edit-toolbar-left">
              <span className="toolbar-selection-count">
                {selectedIds.size} selected
              </span>
              <div className="toolbar-select-actions">
                {!allPageSelected ? (
                  <button className="toolbar-select-btn" onClick={handleSelectAllPage}>
                    Page ({filteredLetters.length})
                  </button>
                ) : (
                  <button className="toolbar-select-btn active" onClick={handleSelectAllPage}>
                    Page ✓
                  </button>
                )}
                {pagination.total > filteredLetters.length && (
                  !allFilteredSelected ? (
                    <button className="toolbar-select-btn" onClick={handleSelectAllFiltered}>
                      All {pagination.total}
                    </button>
                  ) : (
                    <button className="toolbar-select-btn active" onClick={() => { clearSelection(); }}>
                      All {pagination.total} ✓
                    </button>
                  )
                )}
              </div>
              <div className="toolbar-divider" />
              <button
                className={`toolbar-copy-btn ${copyModeActive ? 'active' : ''}`}
                onClick={toggleCopyMode}
                disabled={isSaving}
              >
                {copyModeActive ? '✓ Copy Mode' : 'Copy Mode'}
              </button>
              {copyModeActive && !sourceCell && (
                <span className="toolbar-hint">Click a cell to copy</span>
              )}
              {copyModeActive && sourceCell && (
                <span className="toolbar-hint">
                  Copying: <strong>"{copiedValue || '(empty)'}"</strong>
                </span>
              )}
              {pendingChanges.size > 0 && (
                <span className="toolbar-changes">{pendingChanges.size} change{pendingChanges.size === 1 ? '' : 's'}</span>
              )}
            </div>

            {/* Center section: process actions or processing progress */}
            <div className="edit-toolbar-center">
              {processingStatus?.isRunning ? (
                <div className="toolbar-processing-controls">
                  <div className="toolbar-progress">
                    <span className="toolbar-progress-text">
                      {processingStatus.currentJob?.type === "transcription" ? "Transcribing" : "Extracting"}:{" "}
                      {processingStatus.completed}/{processingStatus.total}
                      {processingStatus.failed > 0 && (
                        <span className="failed-count"> ({processingStatus.failed} failed)</span>
                      )}
                    </span>
                    <div className="toolbar-progress-bar">
                      <div
                        className="toolbar-progress-fill"
                        style={{
                          width: `${processingStatus.total > 0 ? (processingStatus.completed / processingStatus.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  {processingStatus.isPaused ? (
                    <button onClick={handleResumeProcessing} className="toolbar-process-btn toolbar-process-resume">
                      Resume
                    </button>
                  ) : (
                    <button onClick={handlePauseProcessing} className="toolbar-process-btn toolbar-process-pause">
                      Pause
                    </button>
                  )}
                  <button onClick={handleAbortProcessing} className="toolbar-process-btn toolbar-process-abort">
                    Abort
                  </button>
                </div>
              ) : (
                <div className="toolbar-process-actions">
                  <button
                    className="toolbar-process-btn"
                    onClick={() => {
                      if (selectedIds.size > 0) {
                        const existing = letters.filter(l => selectedIds.has(l.id) && l.transcriptStatus !== 'EMPTY').length;
                        setTranscribeExistingCount(existing);
                      } else {
                        setTranscribeExistingCount(0);
                      }
                      setShowTranscribeConfirm(true);
                    }}
                  >
                    Transcribe{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                  <button
                    className="toolbar-process-btn"
                    onClick={() => {
                      if (selectedIds.size > 0) {
                        const existing = letters.filter(l => selectedIds.has(l.id) && l.metadataContentStatus !== 'EMPTY').length;
                        setMetadataExistingCount(existing);
                      } else {
                        setMetadataExistingCount(0);
                      }
                      setShowMetadataConfirm(true);
                    }}
                  >
                    Extract Metadata{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                </div>
              )}
            </div>

            {/* Right section: visibility + destructive actions */}
            <div className="edit-toolbar-right">
              <div className="toolbar-visibility-actions">
                <button
                  className="toolbar-process-btn"
                  onClick={handleBulkPublish}
                  disabled={selectedIds.size === 0 || bulkActionLoading}
                >
                  Publish
                </button>
                <button
                  className="toolbar-process-btn"
                  onClick={handleBulkHide}
                  disabled={selectedIds.size === 0 || bulkActionLoading}
                >
                  Hide
                </button>
              </div>
              <div className="toolbar-divider" />
              <div className="toolbar-destructive-actions">
                <button
                  className="toolbar-btn-destructive"
                  onClick={handleClearTranscriptionsClick}
                  disabled={selectedIds.size === 0 || bulkActionLoading}
                >
                  Clear Transcripts
                </button>
                <button
                  className="toolbar-btn-destructive"
                  onClick={handleClearMetadataClick}
                  disabled={selectedIds.size === 0 || bulkActionLoading}
                >
                  Clear Metadata
                </button>
                <button
                  className="toolbar-btn-danger"
                  onClick={handleDeleteClick}
                  disabled={selectedIds.size === 0}
                >
                  Delete
                </button>
              </div>
              <div className="toolbar-divider" />
              {pendingChanges.size > 0 ? (
                <button className="toolbar-done-btn" onClick={handleDone} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save & Close'}
                </button>
              ) : (
                <button className="toolbar-close-btn" onClick={exitEditMode} title="Clear selection">
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
    </AdminLayout>
  );
}
