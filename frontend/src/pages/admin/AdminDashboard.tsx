import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminLetters, deleteLetter } from "../../api/letters";
import {
  getProcessingStatus,
  startTranscription,
  startMetadataExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  bulkResetTranscriptions,
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
  VisibilityBadge,
  DropdownItem,
  DropdownDivider,
} from "../../components/common";
import { analyzeCollection, type CollectionAnalysisResult } from "../../api/collections";
import AdminLayout from "../../components/AdminLayout";

// Visibility filter type (inline instead of from FilterSidebar)
type VisibilityFilter = 'ALL' | 'PUBLISHED' | 'HIDDEN';

// Date filter mode
type DateMode = 'specific' | 'range';

// Year/month/day options for date dropdowns
const YEAR_OPTIONS = Array.from({ length: 151 }, (_, i) => 1800 + i);
const MONTH_OPTIONS = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
];
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);
import "./AdminDashboard.css";

// Server-side sort fields (must match backend Zod schema)
type ServerSortField = 'createdAt' | 'letterDate' | 'sender' | 'recipient' | 'workflow' | 'visibility' | 'collection';
// Client-side computed sort fields (sorted locally after fetch)
type ClientSortField = 'letters' | 'extras';
// Extended sort field to include client-side computed columns
type ExtendedSortField = ServerSortField | ClientSortField;
type SortDirection = 'asc' | 'desc';

// Helper to check if a field is server-sortable
const isServerSortField = (field: ExtendedSortField): field is ServerSortField => {
  return ['createdAt', 'letterDate', 'sender', 'recipient', 'workflow', 'visibility', 'collection'].includes(field);
};

interface SortColumn {
  field: ExtendedSortField;
  direction: SortDirection;
}

// Column definitions for visibility toggle
type ColumnId = 'sender' | 'recipient' | 'date' | 'collection' | 'letters' | 'extras' | 'transcript' | 'metadata' | 'visibility' | 'created' | 'sync';

interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'sender', label: 'Sender', defaultVisible: true },
  { id: 'recipient', label: 'Recipient', defaultVisible: true },
  { id: 'date', label: 'Date', defaultVisible: true },
  { id: 'collection', label: 'Collection', defaultVisible: true },
  { id: 'letters', label: 'Letters', defaultVisible: true },
  { id: 'extras', label: 'Extras', defaultVisible: true },
  { id: 'transcript', label: 'Transcript', defaultVisible: true },
  { id: 'metadata', label: 'Metadata', defaultVisible: true },
  { id: 'sync', label: 'Sync', defaultVisible: true },
  { id: 'visibility', label: 'Visibility', defaultVisible: true },
  { id: 'created', label: 'Created', defaultVisible: true },
];

/**
 * Checks if a letter's derived fields (summary/hook) may be out of sync with identities.
 * Returns true if sender/recipient are set but don't appear in the summary or hook.
 */
function checkNeedsSync(letter: Letter): boolean {
  const { sender, recipient, description, hook } = letter.metadata;

  // No sender/recipient set - nothing to check
  if (!sender && !recipient) return false;

  // No summary/hook to check against
  if (!description && !hook) return false;

  const combinedText = ((description || '') + ' ' + (hook || '')).toLowerCase();

  // Check if identities appear in derived fields
  const senderMissing = sender && !combinedText.includes(sender.toLowerCase());
  const recipientMissing = recipient && !combinedText.includes(recipient.toLowerCase());

  // If either identity is missing from derived fields, may need sync
  return Boolean(senderMissing || recipientMissing);
}

const DEFAULT_VISIBLE_COLUMNS = new Set<ColumnId>(
  ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.id)
);

const COLUMN_STORAGE_KEY = 'adminDashboardColumns';

// Status icon component for two-track workflow
function StatusIcon({ status, type }: { status: ContentStatus; type: 'T' | 'M' }) {
  const titleMap = { T: 'Transcript', M: 'Metadata' };
  const title = titleMap[type];
  switch (status) {
    case 'EMPTY':
      return <span className="status-icon status-empty" title={`${title}: Empty`}>—</span>;
    case 'AI_DRAFT':
      return <span className="status-icon status-draft" title={`${title}: Draft`}>Draft</span>;
    case 'EDITED':
      return <span className="status-icon status-edited" title={`${title}: Edited`}>Edited</span>;
    case 'VERIFIED':
      return <span className="status-icon status-verified" title={`${title}: Verified`}>✓</span>;
    default:
      return <span className="status-icon">—</span>;
  }
}

// Combine transcript + extra content status into a single status.
// Only considers sections that actually exist (have corresponding images).
function getCombinedTranscriptStatus(
  transcriptStatus: ContentStatus,
  extraContentStatus: ContentStatus,
  hasLetterPages: boolean,
  hasExtras: boolean,
): ContentStatus {
  // Only include statuses for sections that exist
  const statuses: ContentStatus[] = [];
  if (hasLetterPages) statuses.push(transcriptStatus);
  if (hasExtras) statuses.push(extraContentStatus);

  // No relevant sections
  if (statuses.length === 0) return 'EMPTY';

  // Single section — use its status directly
  if (statuses.length === 1) return statuses[0];

  // Both sections exist: both must be VERIFIED
  if (statuses.every(s => s === 'VERIFIED')) return 'VERIFIED';
  // Either EDITED (or one verified, one edited) counts as edited
  if (statuses.some(s => s === 'EDITED' || s === 'VERIFIED') && statuses.every(s => s !== 'EMPTY')) return 'EDITED';
  // Either AI_DRAFT
  if (statuses.some(s => s === 'AI_DRAFT')) return 'AI_DRAFT';
  return 'EMPTY';
}

// Parse dateRaw into formatted MM/DD/YYYY string
function formatDateRaw(dateRaw: string | undefined): string {
  if (!dateRaw || dateRaw.length !== 8) {
    return '—';
  }

  const yearStr = dateRaw.slice(0, 4);
  const monthStr = dateRaw.slice(4, 6);
  const dayStr = dateRaw.slice(6, 8);

  // Keep X for unknown components (no conversion needed, just pass through)
  const year = yearStr;
  const month = monthStr;
  const day = dayStr;

  // Format as MM/DD/YYYY
  return `${month}/${day}/${year}`;
}

// localStorage key for persisting filters and sorting
const STORAGE_KEY = 'adminDashboardState';

interface PersistedState {
  visibilityFilter: VisibilityFilter;
  collectionFilter: string;
  searchQuery: string;
  sortColumns: SortColumn[];
  // Date filters
  dateMode: DateMode;
  year: number | null;
  month: number | null;
  day: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load persisted state:', e);
  }
  return {};
}

function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save persisted state:', e);
  }
}


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
    total: 0, uploaded: 0, transcribed: 0, metadataReady: 0, reviewed: 0, published: 0, hidden: 0,
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
  type ContentFilterView = 'transcript' | 'metadata';
  const [contentFilterView, setContentFilterView] = useState<ContentFilterView>('transcript');

  // Collection input for number-based filtering
  const [collectionInput, setCollectionInput] = useState(
    persistedState.current.collectionFilter === 'all' ? '' : persistedState.current.collectionFilter ?? ''
  );

  // Filters (initialized from localStorage)
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>(
    persistedState.current.visibilityFilter ?? 'ALL'
  );
  // Content status filters - not persisted since they're not yet implemented server-side
  const [transcriptStatusFilters, setTranscriptStatusFilters] = useState<ContentStatus[]>([]);
  const [metadataStatusFilters, setMetadataStatusFilters] = useState<ContentStatus[]>([]);
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
        const parsed = JSON.parse(saved) as ColumnId[];
        return new Set(parsed);
      }
    } catch (e) {
      console.warn('Failed to load column visibility:', e);
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Save column visibility changes
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(Array.from(visibleColumns)));
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
  // Note: transcriptStatusFilters and metadataStatusFilters are not persisted
  // since server-side filtering for them is not yet implemented
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
    });
  }, [visibilityFilter, collectionFilter, searchQuery, sortColumns, dateMode, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter]);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Process dropdown state
  const [showProcessMenu, setShowProcessMenu] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [wasRunning, setWasRunning] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<number | null>(null);
  const processButtonRef = useRef<HTMLDivElement>(null);

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

  // Re-fetch when filters change (reset to page 1)
  useEffect(() => {
    fetchLetters(true, 1);
  }, [collectionFilter, visibilityFilter, searchQuery, sortColumns, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
      return;
    }
    fetchLetters(isInitialLoad);
  }, [navigate, fetchLetters, isInitialLoad]);

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (editMode) {
      // If this was a drag operation (moved to other rows), don't toggle
      // The drag handlers already applied the selection
      if (hasDragMoved) return;

      if (e.shiftKey && lastClickedIndex !== null) {
        // Shift-click: select range from last clicked to current
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const newSelected = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
          newSelected.add(filteredLetters[i].id);
        }
        setSelectedIds(newSelected);
      } else {
        // Simple click: toggle this row's selection
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
    // Only start drag on left mouse button
    if (e.button !== 0) return;
    // Don't start drag if clicking on buttons or inputs
    const tagName = (e.target as HTMLElement).tagName;
    if (tagName === "INPUT" || tagName === "BUTTON") return;

    const letterId = filteredLetters[index].id;
    // Determine if we're selecting or deselecting based on the first item
    const mode = selectedIds.has(letterId) ? "deselect" : "select";

    setIsDragging(true);
    setDragStartIndex(index);
    setDragMode(mode);
    setDraggedIds(new Set([letterId]));
    setHasDragMoved(false); // Not a drag yet, just a mousedown

    // Don't apply selection yet - wait to see if it's a click or drag
    // If user drags to another row, handleRowMouseEnter will apply selection
    // If user just clicks, handleRowClick will apply selection

    // Prevent text selection during drag
    e.preventDefault();
  };

  const handleRowMouseEnter = (index: number) => {
    if (!isDragging || dragStartIndex === null || dragMode === null) return;

    // Mark that this is a real drag (moved to a different row)
    if (!hasDragMoved) {
      setHasDragMoved(true);
    }

    // Calculate range from drag start to current position
    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);

    // Build set of IDs in the drag range
    const rangeIds = new Set<string>();
    for (let i = start; i <= end; i++) {
      rangeIds.add(filteredLetters[i].id);
    }

    // Update selection based on drag mode (toggle behavior)
    const newSelected = new Set(selectedIds);

    // First, undo any previously dragged items that are no longer in range
    draggedIds.forEach((id) => {
      if (!rangeIds.has(id)) {
        // Revert this item to its pre-drag state
        if (dragMode === "select") {
          newSelected.delete(id);
        } else {
          newSelected.add(id);
        }
      }
    });

    // Apply the drag mode to items in the current range
    rangeIds.forEach((id) => {
      if (dragMode === "select") {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
    });

    setDraggedIds(rangeIds);
    setSelectedIds(newSelected);
  };

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDragStartIndex(null);
      setDragMode(null);
      setDraggedIds(new Set());
    }
  }, [isDragging]);

  // Add global mouseup listener for drag selection
  useEffect(() => {
    if (editMode) {
      document.addEventListener("mouseup", handleMouseUp);
      return () => document.removeEventListener("mouseup", handleMouseUp);
    }
  }, [editMode, handleMouseUp]);

  const handleUploadClick = () => {
    navigate("/admin/upload");
  };

  // Multi-column sort handler: click cycles through asc → desc → none
  const handleSort = (field: ExtendedSortField) => {
    setSortColumns((prev) => {
      const existingIndex = prev.findIndex((col) => col.field === field);

      if (existingIndex === -1) {
        // Not currently sorted - add as ascending
        return [...prev, { field, direction: 'asc' }];
      }

      const existing = prev[existingIndex];
      if (existing.direction === 'asc') {
        // Currently ascending - change to descending
        const newColumns = [...prev];
        newColumns[existingIndex] = { field, direction: 'desc' };
        return newColumns;
      }

      // Currently descending - remove from sort
      return prev.filter((col) => col.field !== field);
    });
  };

  // Get sort indicator and priority number for a column
  const getSortInfo = (field: ExtendedSortField) => {
    const index = sortColumns.findIndex((col) => col.field === field);
    if (index === -1) return null;
    return {
      direction: sortColumns[index].direction,
      priority: index + 1,
      total: sortColumns.length,
    };
  };

  // Apply client-side sorting for computed columns (letters, extras)
  const filteredLetters = useMemo(() => {
    // Find client-side sort columns (ones that can't be sorted server-side)
    const clientSortColumns = sortColumns.filter(col => !isServerSortField(col.field));

    if (clientSortColumns.length === 0) {
      return letters; // No client-side sorting needed
    }

    return [...letters].sort((a, b) => {
      for (const { field, direction } of clientSortColumns) {
        let comparison = 0;

        switch (field) {
          case 'letters':
            // Use lettersCount from API (counts L-type pages across the letter group)
            const aLetters = a.lettersCount ?? a.images.filter(img => img.type === 'letter').length;
            const bLetters = b.lettersCount ?? b.images.filter(img => img.type === 'letter').length;
            comparison = aLetters - bLetters;
            break;
          case 'extras':
            // Use extrasCount from API (includes related items like photos, covers)
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
    return new Date(dateString).toLocaleDateString();
  };

  // Edit mode functions
  const toggleEditMode = () => {
    if (editMode) {
      // Exiting edit mode, clear all state
      exitEditMode();
    } else {
      // Entering edit mode, close other dropdowns
      setShowProcessMenu(false);
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
  };

  // Copy-paste mode handlers
  const toggleCopyMode = () => {
    if (copyModeActive) {
      // Deactivate copy mode
      setCopyModeActive(false);
      setCopiedValue(null);
      setSourceCell(null);
    } else {
      // Activate copy mode
      setCopyModeActive(true);
      setCopiedValue(null);
      setSourceCell(null);
    }
  };

  const handleCellClick = (letterId: string, column: 'sender' | 'recipient', value: string | null, e: React.MouseEvent) => {
    if (!editMode || !copyModeActive) return;

    e.stopPropagation(); // Prevent row selection

    // Check if clicking on a cell that already has a pending change
    const existingChange = pendingChanges.get(letterId);
    const hasPendingChangeForColumn = existingChange && existingChange[column] !== undefined;

    if (sourceCell === null) {
      // No source yet - this click sets the source
      setSourceCell({ letterId, column });
      setCopiedValue(value || '');
    } else if (sourceCell.letterId === letterId && sourceCell.column === column) {
      // Clicking the source cell again - deselect it
      setSourceCell(null);
      setCopiedValue(null);
    } else if (hasPendingChangeForColumn) {
      // Clicking a cell that already has a pending change - remove the change
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
      // Paste the copied value to this cell
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
      // Group updates and send to API
      const updates = Array.from(pendingChanges.entries()).map(([letterId, changes]) => ({
        letterId,
        ...changes,
      }));

      await bulkUpdateFields(updates);

      showToast(`Updated ${pendingChanges.size} letter${pendingChanges.size === 1 ? '' : 's'}`, 'success');

      // Exit edit mode after successful save
      setEditMode(false);
      setSelectedIds(new Set());
      setPendingChanges(new Map());
      setCopyModeActive(false);
      setCopiedValue(null);
      setSourceCell(null);

      // Refresh the list
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
  const handleResetTranscriptionsClick = () => {
    if (selectedIds.size > 0) {
      setShowResetModal(true);
    }
  };

  const handleConfirmResetTranscriptions = async () => {
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkResetTranscriptions(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowResetModal(false);
      showToast(`Reset ${count} letter${count === 1 ? '' : 's'} to UPLOADED`, 'success');
      await fetchLetters();
    } catch (err) {
      console.error("Failed to reset transcriptions:", err);
      showToast(err instanceof Error ? err.message : "Failed to reset transcriptions", 'error');
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

  // Process menu handlers
  const handleProcessMenuToggle = () => {
    const newState = !showProcessMenu;
    if (newState) {
      // Close other dropdowns when opening process menu
      setShowDateDropdown(false);
    }
    setShowProcessMenu(newState);
  };

  // Build filter options for processing endpoints (matches current filter state)
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

  const handleStartTranscription = async () => {
    try {
      setShowProcessMenu(false);
      if (selectedIds.size > 0) {
        // Process only selected items using bulk endpoint
        const result = await bulkTranscribe(Array.from(selectedIds));
        showToast(`Queued ${result.queued} letters for transcription${result.skipped > 0 ? ` (${result.skipped} skipped)` : ''}`, 'info');
        setSelectedIds(new Set());
        await fetchLetters();
      } else {
        // Process all letters matching current filters
        const result = await startTranscription(buildProcessingFilters());
        showToast(`Started transcription for ${result.total} letters`, 'info');
      }
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", 'error');
    }
  };

  const handleStartMetadataExtraction = async () => {
    try {
      setShowProcessMenu(false);
      if (selectedIds.size > 0) {
        // Process only selected items using bulk endpoint
        const result = await bulkExtractMetadata(Array.from(selectedIds));
        showToast(`Queued ${result.queued} letters for metadata extraction${result.skipped > 0 ? ` (${result.skipped} skipped)` : ''}`, 'info');
        setSelectedIds(new Set());
        await fetchLetters();
      } else {
        // Process all letters matching current filters
        const result = await startMetadataExtraction(buildProcessingFilters());
        showToast(`Started metadata extraction for ${result.total} letters`, 'info');
      }
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", 'error');
    }
  };

  const handleAnalyzeCollection = async () => {
    if (collectionFilter === 'all') {
      showToast('Select a collection filter to analyze', 'error');
      return;
    }
    try {
      setShowProcessMenu(false);
      showToast(`Analyzing collection ${collectionFilter}...`, 'info');
      const result: CollectionAnalysisResult = await analyzeCollection(collectionFilter);
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

  // Handle collection input change - filter immediately on any input
  // "0" and "00" are treated as no filter (same as empty)
  // Any non-zero value like "9", "09", "009", "090", "900" will filter
  const handleCollectionInputChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 3);
    setCollectionInput(cleaned);
    // Treat empty, "0", and "00" as no filter
    if (cleaned === '' || cleaned === '0' || cleaned === '00') {
      setCollectionFilter('all');
    } else {
      // Use the value as-is for partial matching (e.g., "7" matches "007", "017", etc.)
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

  // Parse MM/DD/YYYY display to YYYYMMDD
  const displayToDateRaw = (display: string): string | null => {
    if (!display) return null;
    const parts = display.split('/');
    if (parts.length !== 3) return null;
    const [month, day, year] = parts;
    if (year.length !== 4) return null;
    return `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
  };

  // Parse YYYYMMDD to MM/DD/YYYY display format
  const dateRawToDisplay = (dateRaw: string | null): string => {
    if (!dateRaw || dateRaw.length < 8) return '';
    const year = dateRaw.slice(0, 4);
    const month = dateRaw.slice(4, 6);
    const day = dateRaw.slice(6, 8);
    return `${month}/${day}/${year}`;
  };

  // Get date filter display text for button
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
    if (transcriptStatusFilters.length > 0) count += transcriptStatusFilters.length;
    if (metadataStatusFilters.length > 0) count += metadataStatusFilters.length;
    // Date filters count
    if (yearFilter !== null) count++;
    if (monthFilter !== null) count++;
    if (dayFilter !== null) count++;
    if (dateFromFilter !== null) count++;
    if (dateToFilter !== null) count++;
    return count;
  }, [collectionFilter, visibilityFilter, transcriptStatusFilters, metadataStatusFilters, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter]);

  // Poll for processing status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getProcessingStatus();
        setProcessingStatus(status);

        // Refresh letter list when a NEW letter completes (live updates)
        if (status.lastCompletedAt && status.lastCompletedAt !== lastCompletedAt) {
          setLastCompletedAt(status.lastCompletedAt);
          fetchLetters();
        }

        // Also refresh when processing finishes entirely
        if (!status.isRunning && wasRunning) {
          fetchLetters();
        }
        setWasRunning(status.isRunning);
      } catch (err) {
        console.error("Failed to fetch processing status:", err);
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

      // Close process menu if clicking outside
      if (processButtonRef.current && !processButtonRef.current.contains(target)) {
        setShowProcessMenu(false);
      }

      // Close date dropdown if clicking outside
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(target)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading && isInitialLoad) {
    return (
      <div className="admin-dashboard">
        <div className="admin-content loading-content">
          <p>Loading letters...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard">
        <div className="admin-content error-content">
          <p className="error-message">{error}</p>
        </div>
      </div>
    );
  }

  // Header action buttons for AdminLayout
  const headerActions = (
    <div className="toolbar-buttons">
      {/* Edit mode toggle */}
      <Button
        icon={editMode ? "close" : "edit"}
        active={editMode}
        onClick={toggleEditMode}
      >
        {editMode ? "Exit Edit" : "Edit"}
      </Button>

      {/* Upload button */}
      <Button icon="upload" onClick={handleUploadClick}>Upload</Button>

      {/* Process button or controls */}
      {processingStatus?.isRunning ? (
        <div className="processing-controls">
          <div className="processing-progress">
            <span className="progress-text">
              {processingStatus.currentJob?.type === "transcription" ? "Transcribing" : "Extracting"}:{" "}
              {processingStatus.completed}/{processingStatus.total}
              {processingStatus.failed > 0 && (
                <span className="failed-count"> ({processingStatus.failed} failed)</span>
              )}
            </span>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${processingStatus.total > 0 ? (processingStatus.completed / processingStatus.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          {processingStatus.isPaused ? (
            <button onClick={handleResumeProcessing} className="resume-button">
              Resume
            </button>
          ) : (
            <button onClick={handlePauseProcessing} className="pause-button">
              Pause
            </button>
          )}
          <button onClick={handleAbortProcessing} className="abort-button">
            Abort
          </button>
        </div>
      ) : (
        <div className="process-button-container" ref={processButtonRef}>
          <Button
            icon="process"
            active={showProcessMenu}
            onClick={handleProcessMenuToggle}
          >
            Process
          </Button>
          {showProcessMenu && (
            <div className="dropdown-menu">
              <DropdownItem
                title="Transcribe"
                description={selectedIds.size > 0 ? `Process ${selectedIds.size} selected` : "Process UPLOADED letters"}
                onClick={handleStartTranscription}
              />
              <DropdownItem
                title="Extract Metadata"
                description={selectedIds.size > 0 ? `Process ${selectedIds.size} selected` : "Process TRANSCRIBED letters"}
                onClick={handleStartMetadataExtraction}
              />
              <DropdownItem
                title="Analyze Collection"
                description={collectionFilter !== 'all' ? `Discover entities in collection ${collectionFilter}` : "Filter by collection first"}
                onClick={handleAnalyzeCollection}
                disabled={collectionFilter === 'all'}
              />
              <DropdownDivider />
              <DropdownItem
                title="Reset Transcriptions"
                description="Clear transcripts, return to UPLOADED"
                onClick={handleResetTranscriptionsClick}
                disabled={selectedIds.size === 0}
              />
              <DropdownItem
                title="Clear Metadata"
                description="Clear metadata, keep transcripts"
                onClick={handleClearMetadataClick}
                disabled={selectedIds.size === 0}
              />
              <DropdownItem
                title="Delete"
                description="Permanently delete selected letters"
                onClick={handleDeleteClick}
                disabled={selectedIds.size === 0}
                variant="danger"
              />
            </div>
          )}
        </div>
      )}

      {/* Columns toggle */}
      <div className="dropdown-container" ref={columnMenuRef}>
        <Button
          icon="columns"
          active={showColumnMenu}
          onClick={() => setShowColumnMenu(!showColumnMenu)}
        >
          Columns
        </Button>
        {showColumnMenu && (
          <div className="column-toggle-dropdown">
            {ALL_COLUMNS.map(col => (
              <label key={col.id} className="column-toggle-item">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col.id)}
                  onChange={() => toggleColumnVisibility(col.id)}
                />
                {col.label}
              </label>
            ))}
          </div>
        )}
      </div>

    </div>
  );

  return (
    <AdminLayout title="Dashboard" headerActions={headerActions} fullHeight>
    <div className="admin-dashboard">
      {/* Filter pills - single row with all filters */}
      <div className="dashboard-filter-bar">
          <div className="filter-pills">
            {/* Visibility filters */}
            <div className="filter-group-inline">
              <span className="filter-section-label">Visibility</span>
              <div className="filter-buttons">
                <button
                  className={`filter-pill filter-published ${visibilityFilter === 'PUBLISHED' ? 'active' : ''}`}
                  onClick={() => toggleVisibilityFilter('PUBLISHED')}
                  title="Published letters"
                >
                  {stats.published} Pub
                </button>
                <button
                  className={`filter-pill filter-hidden ${visibilityFilter === 'HIDDEN' ? 'active' : ''}`}
                  onClick={() => toggleVisibilityFilter('HIDDEN')}
                  title="Hidden letters"
                >
                  {stats.hidden} Hidden
                </button>
              </div>
            </div>

            {/* Transcript/Metadata toggle filter */}
            <div className="filter-group-inline">
              <div className="content-filter-toggle">
                <button
                  className={`content-toggle-btn ${contentFilterView === 'transcript' ? 'active' : ''}`}
                  onClick={() => setContentFilterView('transcript')}
                >
                  Transcript
                  {contentFilterView !== 'transcript' && transcriptStatusFilters.length > 0 && (
                    <span className="toggle-badge">{transcriptStatusFilters.length}</span>
                  )}
                </button>
                <button
                  className={`content-toggle-btn ${contentFilterView === 'metadata' ? 'active' : ''}`}
                  onClick={() => setContentFilterView('metadata')}
                >
                  Metadata
                  {contentFilterView !== 'metadata' && metadataStatusFilters.length > 0 && (
                    <span className="toggle-badge">{metadataStatusFilters.length}</span>
                  )}
                </button>
              </div>
              <div className="filter-buttons">
                {contentFilterView === 'transcript' ? (
                  <>
                    <button
                      className={`filter-pill filter-content-draft ${transcriptStatusFilters.includes('AI_DRAFT') ? 'active' : ''}`}
                      onClick={() => toggleTranscriptFilter('AI_DRAFT')}
                      title="AI Draft transcripts"
                    >
                      {stats.transcriptAiDraft} Draft
                    </button>
                    <button
                      className={`filter-pill filter-content-edited ${transcriptStatusFilters.includes('EDITED') ? 'active' : ''}`}
                      onClick={() => toggleTranscriptFilter('EDITED')}
                      title="Edited transcripts"
                    >
                      {stats.transcriptEdited} Edit
                    </button>
                    <button
                      className={`filter-pill filter-content-verified ${transcriptStatusFilters.includes('VERIFIED') ? 'active' : ''}`}
                      onClick={() => toggleTranscriptFilter('VERIFIED')}
                      title="Verified transcripts"
                    >
                      {stats.transcriptVerified} Done
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`filter-pill filter-content-draft ${metadataStatusFilters.includes('AI_DRAFT') ? 'active' : ''}`}
                      onClick={() => toggleMetadataFilter('AI_DRAFT')}
                      title="AI Draft metadata"
                    >
                      {stats.metadataAiDraft} Draft
                    </button>
                    <button
                      className={`filter-pill filter-content-edited ${metadataStatusFilters.includes('EDITED') ? 'active' : ''}`}
                      onClick={() => toggleMetadataFilter('EDITED')}
                      title="Edited metadata"
                    >
                      {stats.metadataEdited} Edit
                    </button>
                    <button
                      className={`filter-pill filter-content-verified ${metadataStatusFilters.includes('VERIFIED') ? 'active' : ''}`}
                      onClick={() => toggleMetadataFilter('VERIFIED')}
                      title="Verified metadata"
                    >
                      {stats.metadataVerified} Done
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Collection input */}
            <input
              type="text"
              className="collection-input"
              placeholder="000"
              title="Filter by collection number"
              value={collectionInput}
              onChange={(e) => handleCollectionInputChange(e.target.value)}
              maxLength={3}
            />

            {/* Date dropdown */}
            <div className="dropdown-container" ref={dateDropdownRef}>
              <button
                className={`dropdown-trigger ${hasDateFilter ? 'active' : ''}`}
                onClick={() => {
                  setShowDateDropdown(!showDateDropdown);
                  setShowProcessMenu(false);
                }}
              >
                {getDateButtonText()} ▾
              </button>
              {showDateDropdown && (
                <div className="date-dropdown-panel">
                  <div className="date-mode-toggle">
                    <button
                      className={`mode-btn ${dateMode === 'specific' ? 'active' : ''}`}
                      onClick={() => setDateMode('specific')}
                    >
                      Specific
                    </button>
                    <button
                      className={`mode-btn ${dateMode === 'range' ? 'active' : ''}`}
                      onClick={() => setDateMode('range')}
                    >
                      Range
                    </button>
                  </div>
                  {dateMode === 'specific' ? (
                    <div className="date-dropdowns">
                      <select
                        value={yearFilter ?? ''}
                        onChange={(e) => setYearFilter(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Year</option>
                        {YEAR_OPTIONS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <select
                        value={monthFilter ?? ''}
                        onChange={(e) => setMonthFilter(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Month</option>
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <select
                        value={dayFilter ?? ''}
                        onChange={(e) => setDayFilter(e.target.value ? Number(e.target.value) : null)}
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
                          value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ''}
                          onChange={(e) => {
                            const raw = displayToDateRaw(e.target.value);
                            setDateFromFilter(raw);
                          }}
                          maxLength={10}
                        />
                      </div>
                      <div className="date-range-field">
                        <label>To</label>
                        <input
                          type="text"
                          placeholder="mm/dd/yyyy"
                          value={dateToFilter ? dateRawToDisplay(dateToFilter) : ''}
                          onChange={(e) => {
                            const raw = displayToDateRaw(e.target.value);
                            setDateToFilter(raw);
                          }}
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

            {/* Search input */}
            <div className="filter-group search-group">
              <input
                type="text"
                placeholder="Search..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            {/* Clear All button */}
            {activeFilterCount > 0 && (
              <button className="clear-all-btn" onClick={handleClearAllFilters}>
                Clear All
              </button>
            )}

            {/* Processing indicator */}
            {processingStatus?.isRunning && (
              <span className="stat-processing">
                Processing: {processingStatus.completed}/{processingStatus.total}
              </span>
            )}
          </div>

          {/* Letter count - far right of filter row */}
          <span className="letter-count">
            {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
        </div>

      <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
        {/* Single table with sticky header - scrolls together horizontally */}
        <div className={`letters-table-container ${filteredLetters.length === 0 ? 'empty' : ''}`}>
          <table className="letters-table">
            <colgroup>
              {visibleColumns.has('sender') && <col style={{ width: '12%' }} />}
              {visibleColumns.has('recipient') && <col style={{ width: '12%' }} />}
              {visibleColumns.has('date') && <col style={{ width: '100px' }} />}
              {visibleColumns.has('collection') && <col style={{ width: '80px' }} />}
              {visibleColumns.has('letters') && <col style={{ width: '55px' }} />}
              {visibleColumns.has('extras') && <col style={{ width: '50px' }} />}
              {visibleColumns.has('transcript') && <col style={{ width: '70px' }} />}
              {visibleColumns.has('metadata') && <col style={{ width: '70px' }} />}
              {visibleColumns.has('sync') && <col style={{ width: '50px' }} />}
              {visibleColumns.has('visibility') && <col style={{ width: '70px' }} />}
              {visibleColumns.has('created') && <col style={{ width: '80px' }} />}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.has('sender') && (
                  <th
                    className={`sortable-header ${getSortInfo("sender") ? "sorted" : ""}`}
                    onClick={() => handleSort("sender")}
                  >
                    <span className="header-content">
                      Sender
                      {getSortInfo("sender") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("sender")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("sender")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("sender")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('recipient') && (
                  <th
                    className={`sortable-header ${getSortInfo("recipient") ? "sorted" : ""}`}
                    onClick={() => handleSort("recipient")}
                  >
                    <span className="header-content">
                      Recipient
                      {getSortInfo("recipient") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("recipient")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("recipient")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("recipient")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('date') && (
                  <th
                    className={`date-header sortable-header ${getSortInfo("letterDate") ? "sorted" : ""}`}
                    onClick={() => handleSort("letterDate")}
                  >
                    <span className="header-content">
                      Date
                      {getSortInfo("letterDate") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("letterDate")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("letterDate")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("letterDate")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('collection') && (
                  <th
                    className={`sortable-header ${getSortInfo("collection") ? "sorted" : ""}`}
                    onClick={() => handleSort("collection")}
                  >
                    <span className="header-content">
                      Collection
                      {getSortInfo("collection") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("collection")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("collection")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("collection")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('letters') && (
                  <th
                    className={`sortable-header ${getSortInfo("letters") ? "sorted" : ""}`}
                    onClick={() => handleSort("letters")}
                  >
                    <span className="header-content">
                      Letters
                      {getSortInfo("letters") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("letters")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("letters")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("letters")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('extras') && (
                  <th
                    className={`sortable-header ${getSortInfo("extras") ? "sorted" : ""}`}
                    onClick={() => handleSort("extras")}
                  >
                    <span className="header-content">
                      Extras
                      {getSortInfo("extras") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("extras")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("extras")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("extras")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('transcript') && (
                  <th className="status-header">Transcript</th>
                )}
                {visibleColumns.has('metadata') && (
                  <th className="status-header">Metadata</th>
                )}
                {visibleColumns.has('sync') && (
                  <th className="status-header" title="Identity/content sync status">Sync</th>
                )}
                {visibleColumns.has('visibility') && (
                  <th>Visibility</th>
                )}
                {visibleColumns.has('created') && (
                  <th
                    className={`sortable-header ${getSortInfo("createdAt") ? "sorted" : ""}`}
                    onClick={() => handleSort("createdAt")}
                  >
                    <span className="header-content">
                      Created
                      {getSortInfo("createdAt") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("createdAt")?.direction === "asc" ? "↑" : "↓"}</span>
                          {getSortInfo("createdAt")!.total > 1 && (
                            <span className="sort-priority">{getSortInfo("createdAt")?.priority}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredLetters.map((letter, index) => {
                  // Use lettersCount from API (counts L-type pages across the letter group)
                  // Fallback to computing from images for backward compatibility
                  const pageCount = letter.lettersCount ?? letter.images.filter((img) => img.type === "letter").length;
                  // Use extrasCount from API (includes related items like photos, covers)
                  // Fallback to computing from images for backward compatibility
                  const extrasCount = letter.extrasCount ?? letter.images.filter((img) => img.type !== "letter").length;
                  const formattedDate = formatDateRaw(letter.metadata.dateRaw);
                  return (
                    <tr
                      key={letter.id}
                      onClick={(e) => handleRowClick(letter.id, index, e)}
                      onMouseDown={(e) => handleRowMouseDown(index, e)}
                      onMouseEnter={() => handleRowMouseEnter(index)}
                      className={`letter-row ${selectedIds.has(letter.id) ? "selected" : ""} ${editMode ? "edit-mode" : ""}`}
                    >
                      {visibleColumns.has('sender') && (
                        <td
                          className={`
                            ${copyModeActive ? 'copyable-cell' : ''}
                            ${sourceCell?.letterId === letter.id && sourceCell?.column === 'sender' ? 'source-cell' : ''}
                            ${pendingChanges.has(letter.id) && pendingChanges.get(letter.id)?.sender !== undefined ? 'changed-cell' : ''}
                          `}
                          onClick={(e) => copyModeActive ? handleCellClick(letter.id, 'sender', letter.metadata.sender ?? null, e) : undefined}
                        >
                          {pendingChanges.get(letter.id)?.sender !== undefined
                            ? pendingChanges.get(letter.id)?.sender || "—"
                            : letter.metadata.sender || "—"}
                        </td>
                      )}
                      {visibleColumns.has('recipient') && (
                        <td
                          className={`
                            ${copyModeActive ? 'copyable-cell' : ''}
                            ${sourceCell?.letterId === letter.id && sourceCell?.column === 'recipient' ? 'source-cell' : ''}
                            ${pendingChanges.has(letter.id) && pendingChanges.get(letter.id)?.recipient !== undefined ? 'changed-cell' : ''}
                          `}
                          onClick={(e) => copyModeActive ? handleCellClick(letter.id, 'recipient', letter.metadata.recipient ?? null, e) : undefined}
                        >
                          {pendingChanges.get(letter.id)?.recipient !== undefined
                            ? pendingChanges.get(letter.id)?.recipient || "—"
                            : letter.metadata.recipient || "—"}
                        </td>
                      )}
                      {visibleColumns.has('date') && <td className="date-cell">{formattedDate}</td>}
                      {visibleColumns.has('collection') && <td>{letter.collectionCode || "—"}</td>}
                      {visibleColumns.has('letters') && <td className="count-cell">{pageCount || "—"}</td>}
                      {visibleColumns.has('extras') && <td className="count-cell">{extrasCount || "—"}</td>}
                      {visibleColumns.has('transcript') && (
                        <td className="status-cell">
                          <StatusIcon status={getCombinedTranscriptStatus(
                            letter.transcriptStatus,
                            letter.extraContentStatus,
                            letter.images.some(img => img.type === 'letter'),
                            letter.images.some(img => ['telegram', 'cover', 'ephemera'].includes(img.type)),
                          )} type="T" />
                        </td>
                      )}
                      {visibleColumns.has('metadata') && (
                        <td className="status-cell">
                          <StatusIcon status={letter.metadataContentStatus} type="M" />
                        </td>
                      )}
                      {visibleColumns.has('sync') && (
                        <td className="status-cell sync-cell">
                          {checkNeedsSync(letter) ? (
                            <span className="sync-indicator needs-sync" title="Names may not match summary/hook">⚠</span>
                          ) : (
                            <span className="sync-indicator synced" title="Synced">✓</span>
                          )}
                        </td>
                      )}
                      {visibleColumns.has('visibility') && (
                        <td>
                          <VisibilityBadge state={letter.visibility} />
                        </td>
                      )}
                      {visibleColumns.has('created') && <td className="date-cell">{formatDate(letter.createdAt)}</td>}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {pagination.totalPages > 1 && (
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => fetchLetters(true, pagination.page - 1)}
              disabled={pagination.page <= 1 || loading}
            >
              ← Previous
            </button>
            <span className="pagination-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => fetchLetters(true, pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
            >
              Next →
            </button>
          </div>
        )}
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

      {/* Reset transcriptions confirmation modal */}
      <ConfirmDialog
        isOpen={showResetModal}
        title="Reset Transcriptions"
        message={`This will reset ${selectedIds.size} letter${selectedIds.size === 1 ? "" : "s"} to UPLOADED state and clear their transcriptions. You will need to re-transcribe them.`}
        confirmText={bulkActionLoading ? "Resetting..." : "Reset"}
        loading={bulkActionLoading}
        onConfirm={handleConfirmResetTranscriptions}
        onCancel={() => setShowResetModal(false)}
      />

      {/* Clear metadata confirmation modal */}
      <ConfirmDialog
        isOpen={showClearMetadataModal}
        title="Clear Metadata"
        message={`This will clear metadata (sender, recipient, summary, etc.) for ${selectedIds.size} letter${selectedIds.size === 1 ? "" : "s"}. The transcriptions will be kept intact.`}
        confirmText={bulkActionLoading ? "Clearing..." : "Clear Metadata"}
        loading={bulkActionLoading}
        onConfirm={handleConfirmClearMetadata}
        onCancel={() => setShowClearMetadataModal(false)}
      />

      {/* Floating edit toolbar - always visible in edit mode */}
      {editMode && (
        <div className="edit-toolbar visible">
          <div className="edit-toolbar-content">
            {/* Left section: selection count and copy mode toggle */}
            <div className="edit-toolbar-left">
              <span className="toolbar-selection-count">
                {selectedIds.size} selected
              </span>
              <div className="toolbar-divider" />
              <button
                className={`toolbar-copy-btn ${copyModeActive ? 'active' : ''}`}
                onClick={toggleCopyMode}
                disabled={isSaving}
              >
                {copyModeActive ? '✓ Copy Mode' : 'Copy Mode'}
              </button>
            </div>

            {/* Center section: copy hints and change count */}
            <div className="edit-toolbar-center">
              {copyModeActive && !sourceCell && (
                <span className="toolbar-hint">Click a Sender or Recipient cell to copy</span>
              )}
              {copyModeActive && sourceCell && (
                <span className="toolbar-hint">
                  Copying: <strong>"{copiedValue || '(empty)'}"</strong> — click cells to paste, click again to undo
                </span>
              )}
              {pendingChanges.size > 0 && (
                <span className="toolbar-changes">{pendingChanges.size} change{pendingChanges.size === 1 ? '' : 's'}</span>
              )}
            </div>

            {/* Right section: cancel and save buttons */}
            <div className="edit-toolbar-actions">
              <button
                className="toolbar-btn toolbar-btn-cancel"
                onClick={exitEditMode}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                className="toolbar-btn toolbar-btn-save"
                onClick={handleSaveChanges}
                disabled={pendingChanges.size === 0 || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
