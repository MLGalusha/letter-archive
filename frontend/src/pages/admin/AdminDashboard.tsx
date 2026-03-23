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
import type { Letter, ContentStatus } from "../../types/Letter";
import {
  Button,
  ConfirmDialog,
} from "../../components/common";
import { analyzeCollection, type CollectionAnalysisResult } from "../../api/collections";
import { startEntityResolution } from "../../api/admin/processing";
import AdminLayout from "../../components/AdminLayout";
import Icon from "../../components/common/Icon";
import { getRecentEdits, formatTimeAgo, type RecentEdit } from "../../utils/recentEdits";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import {
  ALL_COLUMNS,
  COLUMN_STORAGE_KEY,
  DAY_OPTIONS,
  DEFAULT_VISIBLE_COLUMNS,
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "./AdminDashboard/constants";
import type {
  ColumnId,
  ContentFilterView,
  DateMode,
  ExtendedSortField,
  ServerSortField,
  SortColumn,
  VisibilityFilter,
} from "./AdminDashboard/types";
import {
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  loadPersistedState,
  savePersistedState,
  StatusIcon,
} from "./AdminDashboard/utils";
import "./AdminDashboard.css";


export default function AdminDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
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

  // Load persisted state on mount
  const persistedState = useRef(loadPersistedState());

  // Date dropdown state
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [dateMode, setDateMode] = useState<DateMode>(
    persistedState.current.dateMode ?? 'specific'
  );
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Content status toggle (Transcript vs Metadata view)
  const [contentFilterView, setContentFilterView] = useState<ContentFilterView>('transcript');

  // Collection input for number-based filtering
  const [collectionInput, setCollectionInput] = useState(
    persistedState.current.collectionFilter === 'all' ? '' : persistedState.current.collectionFilter ?? ''
  );

  // Filters (initialized from localStorage)
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>(
    persistedState.current.visibilityFilter ?? 'ALL'
  );
  // Content status filters (persisted to localStorage)
  const [transcriptStatusFilters, setTranscriptStatusFilters] = useState<ContentStatus[]>(
    (persistedState.current.transcriptStatusFilters as ContentStatus[]) ?? []
  );
  const [metadataStatusFilters, setMetadataStatusFilters] = useState<ContentStatus[]>(
    (persistedState.current.metadataStatusFilters as ContentStatus[]) ?? []
  );
  const [collectionFilter, setCollectionFilter] = useState<string>(
    persistedState.current.collectionFilter ?? "all"
  );
  // Date filters
  const [yearFilter, setYearFilter] = useState<number | null>(
    persistedState.current.year ?? null
  );
  const [monthFilter, setMonthFilter] = useState<number | null>(
    persistedState.current.month ?? null
  );
  const [dayFilter, setDayFilter] = useState<number | null>(
    persistedState.current.day ?? null
  );
  const [dateFromFilter, setDateFromFilter] = useState<string | null>(
    persistedState.current.dateFrom ?? null
  );
  const [dateToFilter, setDateToFilter] = useState<string | null>(
    persistedState.current.dateTo ?? null
  );

  // Debounced search - separate input state from query state
  const [searchInput, setSearchInput] = useState(persistedState.current.searchQuery ?? "");
  const [searchQuery, setSearchQuery] = useState(persistedState.current.searchQuery ?? "");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
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

  // Multi-column sorting - array maintains priority order (first = highest priority)
  const [sortColumns, setSortColumns] = useState<SortColumn[]>(
    persistedState.current.sortColumns ?? []
  );

  // Column visibility state (persisted separately)
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Support both legacy (ColumnId[]) and new ({ visible, known }) formats
        let visible: ColumnId[];
        let known: ColumnId[];
        if (Array.isArray(parsed)) {
          // Legacy format: just the visible list, no known tracking
          visible = parsed;
          known = parsed;
        } else {
          visible = parsed.visible ?? [];
          known = parsed.known ?? [];
        }
        const savedSet = new Set(visible);
        const knownSet = new Set(known);
        // Auto-show new defaultVisible columns the user has never seen
        for (const col of ALL_COLUMNS) {
          if (col.defaultVisible && !knownSet.has(col.id)) {
            savedSet.add(col.id);
          }
        }
        return savedSet;
      }
    } catch (e) {
      console.warn('Failed to load column visibility:', e);
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

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

  // Save column visibility changes (with known columns to distinguish "removed" from "new")
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify({
        visible: Array.from(visibleColumns),
        known: ALL_COLUMNS.map(c => c.id),
      }));
    } catch (e) {
      console.warn('Failed to save column visibility:', e);
    }
  }, [visibleColumns]);

  // Close column menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    if (showColumnMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColumnMenu]);

  const toggleColumnVisibility = (columnId: ColumnId) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  // Persist state changes to localStorage
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

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
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
  const [showAnalyzeConfirm, setShowAnalyzeConfirm] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);

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
  useEffect(() => {
    if (!isAuthenticated()) return; // Don't fetch if not authenticated
    fetchLetters(true, 1);
  }, [collectionFilter, visibilityFilter, searchQuery, sortColumns, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (editMode) {
      if (hasDragMoved) return;

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
        setLastClickedIndex(index);
      }
    } else {
      navigate(`/admin/letters/${letterId}`);
    }
  };

  // Drag selection handlers
  const handleRowMouseDown = (index: number, e: React.MouseEvent) => {
    if (!editMode) return;
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
    if (editMode) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => document.removeEventListener("mouseup", handleMouseUp);
    }
  }, [editMode, handleMouseUp]);

  // Multi-column sort handler
  const handleSort = (field: ExtendedSortField) => {
    setSortColumns((prev) => {
      const existingIndex = prev.findIndex((col) => col.field === field);

      if (existingIndex === -1) {
        return [...prev, { field, direction: 'asc' }];
      }

      const existing = prev[existingIndex];
      if (existing.direction === 'asc') {
        const newColumns = [...prev];
        newColumns[existingIndex] = { field, direction: 'desc' };
        return newColumns;
      }

      return prev.filter((col) => col.field !== field);
    });
  };

  const getSortInfo = (field: ExtendedSortField) => {
    const index = sortColumns.findIndex((col) => col.field === field);
    if (index === -1) return null;
    return {
      direction: sortColumns[index].direction,
      priority: index + 1,
      total: sortColumns.length,
    };
  };

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
        }

        if (comparison !== 0) {
          return direction === 'asc' ? comparison : -comparison;
        }
      }
      return 0;
    });
  }, [letters, sortColumns]);

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

  // Edit mode functions
  const toggleEditMode = async () => {
    if (editMode) {
      if (pendingChanges.size > 0) {
        await handleSaveChanges();
      } else {
        exitEditMode();
      }
    } else {
      setShowDateDropdown(false);
      setEditMode(true);
    }
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    setAllFilteredSelected(false);
  };

  // Select all on current page
  const allPageSelected = filteredLetters.length > 0 && filteredLetters.every(l => selectedIds.has(l.id));
  const somePageSelected = filteredLetters.some(l => selectedIds.has(l.id));

  const handleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds(new Set());
      setAllFilteredSelected(false);
    } else {
      // Add this page's items to existing selections
      const newSelected = new Set(selectedIds);
      for (const l of filteredLetters) {
        newSelected.add(l.id);
      }
      setSelectedIds(newSelected);
      setAllFilteredSelected(false);
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
      setSelectedIds(new Set(allIds));
      setAllFilteredSelected(true);
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

      setEditMode(false);
      setSelectedIds(new Set());
      setAllFilteredSelected(false);
      setPendingChanges(new Map());
      setCopyModeActive(false);
      setCopiedValue(null);
      setSourceCell(null);

      await fetchLetters();
    } catch (err) {
      console.error('Failed to save changes:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const exitEditMode = () => {
    setEditMode(false);
    setSelectedIds(new Set());
    setAllFilteredSelected(false);
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
      setSelectedIds(new Set());
      setShowDeleteModal(false);
      setEditMode(false);
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
      setSelectedIds(new Set());
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
      setSelectedIds(new Set());
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

  const handleStartTranscription = async () => {
    try {
      if (selectedIds.size > 0) {
        const result = await bulkTranscribe(Array.from(selectedIds));
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
        setSelectedIds(new Set());
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

  const handleStartMetadataExtraction = async (skipConfirmation = false) => {
    try {
      if (selectedIds.size > 0) {
        const ids = skipConfirmation ? pendingMetadataIds : Array.from(selectedIds);
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
        setSelectedIds(new Set());
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

  const handleAnalyzeCollection = async () => {
    if (collectionFilter === 'all') {
      showToast('Select a collection filter to analyze', 'error');
      return;
    }
    const normalizedCollectionCode = collectionFilter.padStart(3, '0');
    try {
      showToast(`Analyzing collection ${normalizedCollectionCode}...`, 'info');
      const result: CollectionAnalysisResult = await analyzeCollection(normalizedCollectionCode);
      const { stats } = result;
      showToast(
        `Analysis complete: ${stats.peopleFound} people, ${stats.placesFound} places, ` +
        `${stats.relationshipsFound} relationships. Created ${stats.entitiesCreated}, ` +
        `linked ${stats.entitiesLinked}, ${stats.itemsQueuedForReview} queued for review.`,
        'success'
      );
    } catch (err) {
      console.error("Failed to analyze collection:", err);
      showToast(err instanceof Error ? err.message : "Failed to analyze collection", 'error');
    }
  };

  const handleResolveEntities = async () => {
    if (collectionFilter === 'all') {
      showToast('Select a collection filter to resolve entities', 'error');
      return;
    }
    const normalizedCollectionCode = collectionFilter.padStart(3, '0');
    try {
      const result = await startEntityResolution(normalizedCollectionCode);
      showToast(result.message, 'info');
    } catch (err) {
      console.error("Failed to start entity resolution:", err);
      showToast(err instanceof Error ? err.message : "Failed to start entity resolution", 'error');
    }
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

  // Toggle functions for inline filter pills
  const toggleVisibilityFilter = (value: 'PUBLISHED' | 'HIDDEN') => {
    setVisibilityFilter(current => current === value ? 'ALL' : value);
  };

  const toggleTranscriptFilter = (value: ContentStatus) => {
    setTranscriptStatusFilters(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const toggleMetadataFilter = (value: ContentStatus) => {
    setMetadataStatusFilters(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const handleCollectionInputChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setCollectionInput(cleaned);
    if (cleaned === '' || Number(cleaned) === 0) {
      setCollectionFilter('all');
    } else {
      setCollectionFilter(cleaned);
    }
  };

  // Clear all filters
  const handleClearAllFilters = () => {
    setVisibilityFilter('ALL');
    setTranscriptStatusFilters([]);
    setMetadataStatusFilters([]);
    setCollectionFilter('all');
    setCollectionInput('');
    setSearchInput('');
    setSearchQuery('');
    setYearFilter(null);
    setMonthFilter(null);
    setDayFilter(null);
    setDateFromFilter(null);
    setDateToFilter(null);
    setDateMode('specific');
  };

  // Date filter helpers
  const hasDateFilter = yearFilter !== null || monthFilter !== null || dayFilter !== null ||
                        dateFromFilter !== null || dateToFilter !== null;

  const clearDateFilters = () => {
    setYearFilter(null);
    setMonthFilter(null);
    setDayFilter(null);
    setDateFromFilter(null);
    setDateToFilter(null);
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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (dateDropdownRef.current && !dateDropdownRef.current.contains(target)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      <div className="header-filters-left">
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
        {processingStatus?.isRunning && !editMode && (
          <span className="stat-pill stat-processing">
            {processingStatus.currentJob?.type === "transcription" ? "T" : "M"}:{" "}
            {processingStatus.completed}/{processingStatus.total}
          </span>
        )}
      </div>

      {/* Actions: Edit on top, Recent on bottom */}
      <div className="header-actions-right">
        <div className="filter-group-stacked">
          <Button
            icon={editMode ? "check" : "edit"}
            size="sm"
            active={editMode}
            onClick={toggleEditMode}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : editMode ? "Done" : "Edit"}
          </Button>
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
      <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
        <RecentActivityTable
          filteredLetters={filteredLetters}
          visibleColumns={visibleColumns}
          getSortInfo={getSortInfo}
          onSort={handleSort}
          onRowClick={handleRowClick}
          onRowMouseDown={handleRowMouseDown}
          onRowMouseEnter={handleRowMouseEnter}
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
          onToggleColumnMenu={() => setShowColumnMenu(!showColumnMenu)}
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

      {/* Transcribe confirmation */}
      <ConfirmDialog
        isOpen={showTranscribeConfirm}
        title="Transcribe Letters"
        message={`Transcribe ${selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all'} letter${selectedIds.size === 1 ? '' : 's'}?`}
        confirmText="Transcribe"
        onConfirm={() => {
          setShowTranscribeConfirm(false);
          handleStartTranscription();
        }}
        onCancel={() => setShowTranscribeConfirm(false)}
      />

      {/* Extract Metadata confirmation */}
      <ConfirmDialog
        isOpen={showMetadataConfirm}
        title="Extract Metadata"
        message={`Extract metadata for ${selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all'} letter${selectedIds.size === 1 ? '' : 's'}?`}
        confirmText="Extract"
        onConfirm={() => {
          setShowMetadataConfirm(false);
          handleStartMetadataExtraction();
        }}
        onCancel={() => setShowMetadataConfirm(false)}
      />

      {/* Analyze Collection confirmation */}
      <ConfirmDialog
        isOpen={showAnalyzeConfirm}
        title="Analyze Collection"
        message={`Analyze all letters in the "${collectionFilter === 'all' ? collectionFilter : collectionFilter.padStart(3, '0')}" collection? This will process sender/recipient relationships.`}
        confirmText="Analyze"
        onConfirm={() => {
          setShowAnalyzeConfirm(false);
          handleAnalyzeCollection();
        }}
        onCancel={() => setShowAnalyzeConfirm(false)}
      />

      {/* Resolve Entities confirmation */}
      <ConfirmDialog
        isOpen={showResolveConfirm}
        title="Resolve Entities"
        message={`Run AI entity resolution on collection "${collectionFilter === 'all' ? collectionFilter : collectionFilter.padStart(3, '0')}"? This will merge duplicates, resolve generics, fill missing sender/recipients, and generate biographies.`}
        confirmText="Resolve"
        onConfirm={() => {
          setShowResolveConfirm(false);
          handleResolveEntities();
        }}
        onCancel={() => setShowResolveConfirm(false)}
      />

      {/* Floating edit toolbar with process actions */}
      {editMode && (
        <div className="edit-toolbar visible">
          <div className="edit-toolbar-content">
            {/* Left section: select all, selection count, copy mode, hints, pending changes */}
            <div className="edit-toolbar-left">
              <input
                type="checkbox"
                className="toolbar-select-all"
                checked={allPageSelected}
                ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                onChange={handleSelectAllPage}
                title={allPageSelected ? "Deselect all" : "Select all on page"}
              />
              <span className="toolbar-selection-count">
                {selectedIds.size} selected
              </span>
              {allPageSelected && pagination.total > filteredLetters.length && !allFilteredSelected && (
                <button className="toolbar-select-all-filtered" onClick={handleSelectAllFiltered}>
                  Select all {pagination.total}
                </button>
              )}
              {allFilteredSelected && (
                <span className="toolbar-all-selected-label">All {pagination.total} selected</span>
              )}
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
                    onClick={() => setShowTranscribeConfirm(true)}
                  >
                    Transcribe{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                  <button
                    className="toolbar-process-btn"
                    onClick={() => setShowMetadataConfirm(true)}
                  >
                    Extract Metadata{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                  <button
                    className="toolbar-process-btn"
                    onClick={() => setShowAnalyzeConfirm(true)}
                    disabled={collectionFilter === 'all'}
                  >
                    Analyze Collection
                  </button>
                  <button
                    className="toolbar-process-btn"
                    onClick={() => setShowResolveConfirm(true)}
                    disabled={collectionFilter === 'all'}
                  >
                    Resolve Entities
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
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
