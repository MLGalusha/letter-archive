import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminLetters, deleteLetter } from "../../api/letters";
import { getAdminCollections, type AdminCollectionInfo } from "../../api/collections";
import {
  getProcessingStatus,
  startTranscription,
  startMetadataExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  bulkResetTranscriptions,
  bulkClearMetadata,
  type ProcessingStatus,
} from "../../api/admin";
import { useToast } from "../../contexts/ToastContext";
import type { Letter, WorkflowState, VisibilityState, ContentStatus } from "../../types/Letter";
import {
  Button,
  ConfirmDialog,
  VisibilityBadge,
  DropdownHeader,
  DropdownItem,
} from "../../components/common";
import { getRecentEdits, formatTimeAgo, type RecentEdit } from "../../utils/recentEdits";
import "./AdminDashboard.css";

// Server-side sort fields (must match backend Zod schema)
type ServerSortField = 'createdAt' | 'letterDate' | 'sender' | 'recipient' | 'workflow' | 'visibility' | 'collection';
// Client-side computed sort fields (sorted locally after fetch)
type ClientSortField = 'year' | 'month' | 'day' | 'letters' | 'extras';
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
type ColumnId = 'sender' | 'recipient' | 'year' | 'month' | 'day' | 'collection' | 'letters' | 'extras' | 'transcript' | 'metadata' | 'visibility' | 'created';

interface ColumnDef {
  id: ColumnId;
  label: string;
  defaultVisible: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: 'sender', label: 'Sender', defaultVisible: true },
  { id: 'recipient', label: 'Recipient', defaultVisible: true },
  { id: 'year', label: 'Year', defaultVisible: true },
  { id: 'month', label: 'Month', defaultVisible: true },
  { id: 'day', label: 'Day', defaultVisible: true },
  { id: 'collection', label: 'Collection', defaultVisible: true },
  { id: 'letters', label: 'Letters', defaultVisible: true },
  { id: 'extras', label: 'Extras', defaultVisible: true },
  { id: 'transcript', label: 'Transcript', defaultVisible: true },
  { id: 'metadata', label: 'Metadata', defaultVisible: true },
  { id: 'visibility', label: 'Visibility', defaultVisible: true },
  { id: 'created', label: 'Created', defaultVisible: true },
];

const DEFAULT_VISIBLE_COLUMNS = new Set<ColumnId>(
  ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.id)
);

const COLUMN_STORAGE_KEY = 'adminDashboardColumns';

// Status icon component for two-track workflow
function StatusIcon({ status, type }: { status: ContentStatus; type: 'T' | 'M' }) {
  const title = type === 'T' ? 'Transcript' : 'Metadata';
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

// Parse dateRaw into year/month/day components
function parseDateRaw(dateRaw: string | undefined): { year: string; month: string; day: string } {
  if (!dateRaw || dateRaw.length !== 8) {
    return { year: '—', month: '—', day: '—' };
  }

  const yearStr = dateRaw.slice(0, 4);
  const monthStr = dateRaw.slice(4, 6);
  const dayStr = dateRaw.slice(6, 8);

  // Year: show if any digits known, replace X with ?
  const year = yearStr.includes('X')
    ? (yearStr === 'XXXX' ? '—' : yearStr.replace(/X/g, '?'))
    : yearStr;

  // Month: convert to short name if fully known
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthStr.includes('X')
    ? '—'
    : monthNames[parseInt(monthStr, 10) - 1] || '—';

  // Day: show number if fully known
  const day = dayStr.includes('X')
    ? '—'
    : String(parseInt(dayStr, 10)); // Remove leading zero

  return { year, month, day };
}

// localStorage key for persisting filters and sorting
const STORAGE_KEY = 'adminDashboardState';

interface PersistedState {
  visibilityFilters: VisibilityState[];
  workflowFilters: WorkflowState[];
  collectionFilter: string;
  collectionInput: string;
  searchQuery: string;
  sortColumns: SortColumn[];
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

  // Filters (initialized from localStorage) - multi-select using Sets
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityState | null>(
    persistedState.current.visibilityFilters?.[0] ?? null
  );
  const [workflowFilters, setWorkflowFilters] = useState<Set<WorkflowState>>(
    new Set(persistedState.current.workflowFilters ?? [])
  );
  const [collectionFilter, setCollectionFilter] = useState<string>(
    persistedState.current.collectionFilter ?? "all"
  );
  const [collectionInput, setCollectionInput] = useState<string>(
    persistedState.current.collectionInput ?? ""
  );

  // Debounced search - separate input state from query state
  const [searchInput, setSearchInput] = useState(persistedState.current.searchQuery ?? "");
  const [searchQuery, setSearchQuery] = useState(persistedState.current.searchQuery ?? "");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Collection suggestions state
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [showCollectionSuggestions, setShowCollectionSuggestions] = useState(false);
  const [collectionSortColumn, setCollectionSortColumn] = useState<'code' | 'total' | 'published' | 'uploaded' | 'ready'>('total');
  const [collectionSortAsc, setCollectionSortAsc] = useState(false); // false = descending (most first)
  const collectionInputRef = useRef<HTMLInputElement>(null);
  const collectionSuggestionsRef = useRef<HTMLDivElement>(null);

  // Recent edits state
  const [recentEdits, setRecentEdits] = useState<RecentEdit[]>([]);
  const [showRecentDropdown, setShowRecentDropdown] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    savePersistedState({
      visibilityFilters: visibilityFilter ? [visibilityFilter] : [],
      workflowFilters: Array.from(workflowFilters),
      collectionFilter,
      collectionInput,
      searchQuery,
      sortColumns,
    });
  }, [visibilityFilter, workflowFilters, collectionFilter, collectionInput, searchQuery, sortColumns]);

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

  // Process dropdown state
  const [showProcessMenu, setShowProcessMenu] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [wasRunning, setWasRunning] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<number | null>(null);
  const processButtonRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLDivElement>(null);

  const fetchLetters = useCallback(async (showLoading = false, page = pagination.page) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      // Find the first server-sortable column (skip client-side computed columns)
      const serverSort = sortColumns.find(col => isServerSortField(col.field));

      // Server-side filtering and pagination
      const response = await getAdminLetters({
        page,
        limit: 50,
        collection: collectionFilter === "all" ? undefined : collectionFilter,
        visibility: visibilityFilter ?? undefined,
        workflow: workflowFilters.size > 0 ? Array.from(workflowFilters) : undefined,
        search: searchQuery || undefined,
        sort: serverSort ? (serverSort.field as ServerSortField) : 'createdAt',
        sortOrder: serverSort ? serverSort.direction : 'desc',
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
        transcriptEmpty: response.stats.transcriptEmpty ?? 0,
        transcriptAiDraft: response.stats.transcriptAiDraft ?? 0,
        transcriptEdited: response.stats.transcriptEdited ?? 0,
        transcriptVerified: response.stats.transcriptVerified ?? 0,
        metadataEmpty: response.stats.metadataEmpty ?? 0,
        metadataAiDraft: response.stats.metadataAiDraft ?? 0,
        metadataEdited: response.stats.metadataEdited ?? 0,
        metadataVerified: response.stats.metadataVerified ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [collectionFilter, visibilityFilter, workflowFilters, searchQuery, sortColumns, pagination.page]);

  // Re-fetch when filters change (reset to page 1)
  useEffect(() => {
    fetchLetters(true, 1);
  }, [collectionFilter, visibilityFilter, workflowFilters, searchQuery, sortColumns]);

  // Fetch collections for suggestions
  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const data = await getAdminCollections();
        setCollections(data);
      } catch (err) {
        console.error("Failed to fetch collections:", err);
      }
    };
    fetchCollections();
  }, []);

  // Load recent edits on mount and when window gains focus
  useEffect(() => {
    const loadRecent = () => setRecentEdits(getRecentEdits());
    loadRecent();
    window.addEventListener('focus', loadRecent);
    return () => window.removeEventListener('focus', loadRecent);
  }, []);

  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
      return;
    }
    fetchLetters(isInitialLoad);
  }, [navigate, fetchLetters, isInitialLoad]);

  const handleLogout = () => {
    sessionStorage.removeItem("adminAuth");
    navigate("/admin-login");
  };

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (editMode) {
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
    // Don't start drag if clicking on checkbox
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    const letterId = filteredLetters[index].id;
    // Determine if we're selecting or deselecting based on the first item
    const mode = selectedIds.has(letterId) ? "deselect" : "select";

    setIsDragging(true);
    setDragStartIndex(index);
    setDragMode(mode);
    setDraggedIds(new Set([letterId]));

    // Apply immediately to the first item
    const newSelected = new Set(selectedIds);
    if (mode === "select") {
      newSelected.add(letterId);
    } else {
      newSelected.delete(letterId);
    }
    setSelectedIds(newSelected);

    // Prevent text selection during drag
    e.preventDefault();
  };

  const handleRowMouseEnter = (index: number) => {
    if (!isDragging || dragStartIndex === null || dragMode === null) return;

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

  // Apply client-side sorting for computed columns (year, month, day, letters, extras)
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
          case 'year':
            // Sort by raw year string (handles "18??" etc)
            comparison = (a.metadata.dateRaw?.slice(0, 4) || '').localeCompare(b.metadata.dateRaw?.slice(0, 4) || '');
            break;
          case 'month':
            // Sort by month number (01-12), treating XX as 00
            const aMonth = a.metadata.dateRaw?.slice(4, 6) || '00';
            const bMonth = b.metadata.dateRaw?.slice(4, 6) || '00';
            comparison = aMonth.replace(/X/g, '0').localeCompare(bMonth.replace(/X/g, '0'));
            break;
          case 'day':
            // Sort by day number (01-31), treating XX as 00
            const aDay = a.metadata.dateRaw?.slice(6, 8) || '00';
            const bDay = b.metadata.dateRaw?.slice(6, 8) || '00';
            comparison = aDay.replace(/X/g, '0').localeCompare(bDay.replace(/X/g, '0'));
            break;
          case 'letters':
            const aLetters = a.images.filter(img => img.type === 'letter').length;
            const bLetters = b.images.filter(img => img.type === 'letter').length;
            comparison = aLetters - bLetters;
            break;
          case 'extras':
            const aExtras = a.images.filter(img => img.type !== 'letter').length;
            const bExtras = b.images.filter(img => img.type !== 'letter').length;
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

  // Collection suggestions - sorted by selected column
  const sortedCollections = useMemo(() => {
    return [...collections].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (collectionSortColumn) {
        case 'code':
          aVal = a.collectionCode;
          bVal = b.collectionCode;
          break;
        case 'total':
          aVal = a.publishedCount + a.hiddenCount;
          bVal = b.publishedCount + b.hiddenCount;
          break;
        case 'published':
          aVal = a.publishedCount;
          bVal = b.publishedCount;
          break;
        case 'uploaded':
          aVal = a.uploadedCount;
          bVal = b.uploadedCount;
          break;
        case 'ready':
          aVal = a.metadataReadyCount;
          bVal = b.metadataReadyCount;
          break;
        default:
          aVal = a.publishedCount + a.hiddenCount;
          bVal = b.publishedCount + b.hiddenCount;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return collectionSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return collectionSortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
  }, [collections, collectionSortColumn, collectionSortAsc]);

  // Toggle collection sort column
  const handleCollectionSort = (column: typeof collectionSortColumn) => {
    if (collectionSortColumn === column) {
      setCollectionSortAsc(!collectionSortAsc);
    } else {
      setCollectionSortColumn(column);
      setCollectionSortAsc(false); // Reset to descending when changing column
    }
  };

  // Get selected collection info for display
  const selectedCollection = useMemo(() => {
    if (collectionFilter === "all") return null;
    return collections.find((c) => c.collectionCode === collectionFilter) || null;
  }, [collections, collectionFilter]);

  const handleSelectCollection = (code: string) => {
    setCollectionInput(code);
    setCollectionFilter(code);
    setShowCollectionSuggestions(false);
  };

  const handleClearCollection = () => {
    setCollectionInput("");
    setCollectionFilter("all");
    setShowCollectionSuggestions(false);
  };

  // Edit mode functions
  const toggleEditMode = () => {
    if (editMode) {
      // Exiting edit mode, clear selections
      setSelectedIds(new Set());
    } else {
      // Entering edit mode, close other dropdowns
      setShowProcessMenu(false);
      setShowCollectionSuggestions(false);
      setShowRecentDropdown(false);
    }
    setEditMode(!editMode);
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
  const allFilteredSelected = filteredLetters.length > 0 &&
    filteredLetters.every((l) => selectedIds.has(l.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all filtered
      const allFilteredIds = new Set(filteredLetters.map((l) => l.id));
      setSelectedIds(allFilteredIds);
    }
  };

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
      setShowCollectionSuggestions(false);
      setShowRecentDropdown(false);
    }
    setShowProcessMenu(newState);
  };

  const handleStartTranscription = async () => {
    try {
      setShowProcessMenu(false);
      // Pass collection filter if one is active
      const result = await startTranscription({
        collectionCode: collectionFilter !== "all" ? collectionFilter : undefined,
      });
      showToast(`Started transcription for ${result.total} letters`, 'info');
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", 'error');
    }
  };

  const handleStartMetadataExtraction = async () => {
    try {
      setShowProcessMenu(false);
      // Pass collection filter if one is active
      const result = await startMetadataExtraction({
        collectionCode: collectionFilter !== "all" ? collectionFilter : undefined,
      });
      showToast(`Started metadata extraction for ${result.total} letters`, 'info');
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", 'error');
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

      // Close collection suggestions if clicking outside
      if (collectionSuggestionsRef.current && !collectionSuggestionsRef.current.contains(target) &&
          collectionInputRef.current && !collectionInputRef.current.contains(target)) {
        setShowCollectionSuggestions(false);
      }

      // Close recent dropdown if clicking outside
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(target)) {
        setShowRecentDropdown(false);
      }

      // Exit edit mode if clicking outside the edit button container and the table
      // (but not when clicking on table rows for selection)
      if (editMode && editButtonRef.current && !editButtonRef.current.contains(target)) {
        const tableContainer = document.querySelector('.letters-table-container');
        if (!tableContainer?.contains(target)) {
          setEditMode(false);
          setSelectedIds(new Set());
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [editMode]);

  // Stats now come from server response (see setStats in fetchLetters)

  // Toggle filter functions
  // Visibility is mutually exclusive (radio behavior) - click to select, click again to clear
  const toggleVisibilityFilter = (state: VisibilityState) => {
    setVisibilityFilter(prev => prev === state ? null : state);
  };

  const toggleWorkflowFilter = (state: WorkflowState) => {
    setWorkflowFilters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(state)) {
        newSet.delete(state);
      } else {
        newSet.add(state);
      }
      return newSet;
    });
  };

  if (loading && isInitialLoad) {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <div className="header-row header-row-primary">
            <h1>Admin Panel</h1>
          </div>
        </header>
        <div className="admin-content">
          <p>Loading letters...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <div className="header-row header-row-primary">
            <h1>Admin Panel</h1>
          </div>
        </header>
        <div className="admin-content">
          <p className="error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      {/* Combined Header + Toolbar */}
      <header className="admin-header">
        <div className="header-row header-row-primary">
          <h1>Admin Panel</h1>
          <div className="toolbar-buttons">
            {/* Upload button */}
            <Button icon="upload" onClick={handleUploadClick}>Upload</Button>

            {/* Edit button with dropdown */}
            <div className="edit-button-container" ref={editButtonRef}>
              <Button
                icon={editMode ? "check" : "edit"}
                active={editMode}
                onClick={toggleEditMode}
              >
                {editMode ? "Done" : "Edit"}
              </Button>

              {editMode && (
                <div className="dropdown-menu">
                  <DropdownHeader>{selectedIds.size} selected</DropdownHeader>
                  <DropdownItem
                    title={allFilteredSelected ? "Deselect All" : "Select All"}
                    description={allFilteredSelected
                      ? "Clear current selection"
                      : `Select all ${filteredLetters.length} filtered letters`}
                    onClick={handleToggleSelectAll}
                    variant={allFilteredSelected ? "active" : "default"}
                  />
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
                      description="Process UPLOADED letters"
                      onClick={handleStartTranscription}
                    />
                    <DropdownItem
                      title="Extract Metadata"
                      description="Process TRANSCRIBED letters"
                      onClick={handleStartMetadataExtraction}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <Button icon="logout" onClick={handleLogout}>Logout</Button>
        </div>

        {/* Filters row with stats */}
        <div className="header-row header-row-filters">
          <div className="filter-search-container">
            <div className="filter-group collection-filter-group">
              <label>Collection:</label>
              <input
                ref={collectionInputRef}
                type="text"
                value={collectionInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setCollectionInput(val);
                  if (collectionDebounceRef.current) {
                    clearTimeout(collectionDebounceRef.current);
                  }
                  collectionDebounceRef.current = setTimeout(() => {
                    if (val.length >= 3) {
                      setCollectionFilter(val);
                    } else if (val.length === 0) {
                      setCollectionFilter("all");
                    }
                  }, 300);
                }}
                onFocus={() => {
                  setShowProcessMenu(false);
                  setShowRecentDropdown(false);
                  setShowCollectionSuggestions(true);
                }}
                placeholder="000"
                className="collection-input"
              />
              {showCollectionSuggestions && collections.length > 0 && (
                <div className="collection-suggestions" ref={collectionSuggestionsRef}>
                  {/* Selected collection display (if filtering) */}
                  {collectionFilter !== "all" && selectedCollection && (
                    <div className="collection-selected">
                      <span className="selected-label">Selected:</span>
                      <span className="selected-code">{selectedCollection.collectionCode}</span>
                      <button className="clear-btn" onClick={handleClearCollection}>
                        Clear
                      </button>
                    </div>
                  )}

                  {/* Table with column headers */}
                  <table className="collection-table">
                    <thead>
                      <tr>
                        <th
                          className={`col-sortable ${collectionSortColumn === 'code' ? 'sorted' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleCollectionSort('code'); }}
                        >
                          Code {collectionSortColumn === 'code' && (collectionSortAsc ? '↑' : '↓')}
                        </th>
                        <th
                          className={`col-sortable col-num ${collectionSortColumn === 'total' ? 'sorted' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleCollectionSort('total'); }}
                          title="Total letters"
                        >
                          Total {collectionSortColumn === 'total' && (collectionSortAsc ? '↑' : '↓')}
                        </th>
                        <th
                          className={`col-sortable col-num col-published ${collectionSortColumn === 'published' ? 'sorted' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleCollectionSort('published'); }}
                          title="Published"
                        >
                          Pub {collectionSortColumn === 'published' && (collectionSortAsc ? '↑' : '↓')}
                        </th>
                        <th
                          className={`col-sortable col-num col-uploaded ${collectionSortColumn === 'uploaded' ? 'sorted' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleCollectionSort('uploaded'); }}
                          title="Needs transcription"
                        >
                          Upl {collectionSortColumn === 'uploaded' && (collectionSortAsc ? '↑' : '↓')}
                        </th>
                        <th
                          className={`col-sortable col-num col-ready ${collectionSortColumn === 'ready' ? 'sorted' : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleCollectionSort('ready'); }}
                          title="Ready for review"
                        >
                          Rdy {collectionSortColumn === 'ready' && (collectionSortAsc ? '↑' : '↓')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCollections.map((c) => {
                        const isSelected = collectionFilter === c.collectionCode;
                        const totalLetters = c.publishedCount + c.hiddenCount;
                        return (
                          <tr
                            key={c.id}
                            className={isSelected ? "selected" : ""}
                            onClick={() => handleSelectCollection(c.collectionCode)}
                          >
                            <td className="col-code">{c.collectionCode}</td>
                            <td className="col-num">{totalLetters}</td>
                            <td className="col-num col-published">{c.publishedCount}</td>
                            <td className="col-num col-uploaded">{c.uploadedCount || '-'}</td>
                            <td className="col-num col-ready">{c.metadataReadyCount || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* History dropdown - between Collection and Search */}
            <div className="filter-group history-filter-group">
              <label>History:</label>
              <div className="history-dropdown-container" ref={recentDropdownRef}>
                <button
                  className="history-button"
                  onClick={() => {
                    const newState = !showRecentDropdown;
                    if (newState) {
                      setShowProcessMenu(false);
                      setShowCollectionSuggestions(false);
                    }
                    setShowRecentDropdown(newState);
                  }}
                >
                  {recentEdits.length > 0 ? `${recentEdits.length} edits` : "None"} {showRecentDropdown ? "▲" : "▼"}
                </button>
                {showRecentDropdown && (
                  <div className="history-dropdown">
                    <div className="history-header">Edit History</div>
                    {recentEdits.length === 0 ? (
                      <div className="history-empty">No recent edits</div>
                    ) : (
                      recentEdits.map((edit) => (
                        <div
                          key={edit.id}
                          className="history-item"
                          onClick={() => {
                            navigate(`/admin/letters/${edit.id}`);
                            setShowRecentDropdown(false);
                          }}
                        >
                          <span className="history-info">
                            {edit.displayName}
                          </span>
                          <span className="history-time">{formatTimeAgo(edit.editedAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="filter-group search-group">
              <label>Search:</label>
              <input
                type="text"
                placeholder="Search..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>

          {/* Filter pills - clickable stat buttons */}
          <div className="filter-pills">
            {/* Total count and pagination info */}
            <span className="filter-total-header">
              {pagination.total > 0 ? (
                <>Showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}</>
              ) : (
                <>No letters</>
              )}
            </span>

            {/* Visibility filters */}
            <div className="filter-section">
              <span className="filter-section-label">Visibility</span>
              <div className="filter-buttons">
                <button
                  className={`filter-pill filter-published ${visibilityFilter === "PUBLISHED" ? "active" : ""}`}
                  onClick={() => toggleVisibilityFilter("PUBLISHED")}
                  title="Published letters - click to filter, click again to show all"
                >
                  {stats.published} Published
                </button>
                <button
                  className={`filter-pill filter-hidden ${visibilityFilter === "HIDDEN" ? "active" : ""}`}
                  onClick={() => toggleVisibilityFilter("HIDDEN")}
                  title="Hidden letters - click to filter, click again to show all"
                >
                  {stats.hidden} Hidden
                </button>
              </div>
            </div>

            <span className="filter-separator">|</span>

            {/* Two-track content status stats */}
            <div className="filter-section">
              <span className="filter-section-label">Transcript</span>
              <div className="filter-stats">
                <span className="stat-item stat-draft" title="Transcript: Draft">
                  {stats.transcriptAiDraft} Draft
                </span>
                <span className="stat-item stat-edited" title="Transcript: Edited">
                  {stats.transcriptEdited} Edited
                </span>
                <span className="stat-item stat-verified" title="Transcript: Verified">
                  {stats.transcriptVerified} Done
                </span>
              </div>
            </div>

            <span className="filter-separator">|</span>

            <div className="filter-section">
              <span className="filter-section-label">Metadata</span>
              <div className="filter-stats">
                <span className="stat-item stat-draft" title="Metadata: Draft">
                  {stats.metadataAiDraft} Draft
                </span>
                <span className="stat-item stat-edited" title="Metadata: Edited">
                  {stats.metadataEdited} Edited
                </span>
                <span className="stat-item stat-verified" title="Metadata: Verified">
                  {stats.metadataVerified} Done
                </span>
              </div>
            </div>

            <span className="filter-separator">|</span>

            {/* Legacy Workflow filters (for backward compat) */}
            <div className="filter-section">
              <span className="filter-section-label">Workflow</span>
              <div className="filter-buttons">
                <button
                  className={`filter-pill filter-uploaded ${workflowFilters.has("UPLOADED") ? "active" : ""}`}
                  onClick={() => toggleWorkflowFilter("UPLOADED")}
                  title="Awaiting transcription"
                >
                  {stats.uploaded}
                </button>
                <button
                  className={`filter-pill filter-transcribed ${workflowFilters.has("TRANSCRIBED") ? "active" : ""}`}
                  onClick={() => toggleWorkflowFilter("TRANSCRIBED")}
                  title="Transcribed"
                >
                  {stats.transcribed}
                </button>
                <button
                  className={`filter-pill filter-metadata-ready ${workflowFilters.has("METADATA_DRAFTED") ? "active" : ""}`}
                  onClick={() => toggleWorkflowFilter("METADATA_DRAFTED")}
                  title="Metadata ready for review"
                >
                  {stats.metadataReady}
                </button>
                <button
                  className={`filter-pill filter-reviewed ${workflowFilters.has("REVIEWED") ? "active" : ""}`}
                  onClick={() => toggleWorkflowFilter("REVIEWED")}
                  title="Reviewed"
                >
                  {stats.reviewed}
                </button>
              </div>
            </div>

            {processingStatus?.isRunning && (
              <span className="stat-pill stat-processing" title="Processing">
                {processingStatus.completed}/{processingStatus.total}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="admin-content">
        {/* Table toolbar with column toggle */}
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <span className="pagination-info">
              Showing {filteredLetters.length} of {pagination.total} letters
            </span>
          </div>
          <div className="table-toolbar-right">
            <div className="column-toggle-container" ref={columnMenuRef}>
              <button
                className="column-toggle-button"
                onClick={() => setShowColumnMenu(!showColumnMenu)}
              >
                Columns ▾
              </button>
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
        </div>
        <div className="letters-table-container">
          <table className="letters-table">
            <thead>
              <tr>
                {editMode && (
                  <th className="checkbox-header"></th>
                )}
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
                {visibleColumns.has('year') && (
                  <th
                    className={`date-header sortable-header ${getSortInfo("year") ? "sorted" : ""}`}
                    onClick={() => handleSort("year")}
                  >
                    <span className="header-content">
                      Year
                      {getSortInfo("year") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("year")?.direction === "asc" ? "↑" : "↓"}</span>
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('month') && (
                  <th
                    className={`date-header sortable-header ${getSortInfo("month") ? "sorted" : ""}`}
                    onClick={() => handleSort("month")}
                  >
                    <span className="header-content">
                      Month
                      {getSortInfo("month") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("month")?.direction === "asc" ? "↑" : "↓"}</span>
                        </span>
                      )}
                    </span>
                  </th>
                )}
                {visibleColumns.has('day') && (
                  <th
                    className={`date-header sortable-header ${getSortInfo("day") ? "sorted" : ""}`}
                    onClick={() => handleSort("day")}
                  >
                    <span className="header-content">
                      Day
                      {getSortInfo("day") && (
                        <span className="sort-indicator">
                          <span className="sort-arrow">{getSortInfo("day")?.direction === "asc" ? "↑" : "↓"}</span>
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
              {filteredLetters.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.size + (editMode ? 1 : 0)} className="empty-state">
                    No letters found
                  </td>
                </tr>
              ) : (
                filteredLetters.map((letter, index) => {
                  const pageCount = letter.images.filter((img) => img.type === "letter").length;
                  const extrasCount = letter.images.filter((img) => img.type !== "letter").length;
                  const { year, month, day } = parseDateRaw(letter.metadata.dateRaw);
                  return (
                    <tr
                      key={letter.id}
                      onClick={(e) => handleRowClick(letter.id, index, e)}
                      onMouseDown={(e) => handleRowMouseDown(index, e)}
                      onMouseEnter={() => handleRowMouseEnter(index)}
                      className={`letter-row ${selectedIds.has(letter.id) ? "selected" : ""} ${editMode ? "edit-mode" : ""}`}
                    >
                      {editMode && (
                        <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(letter.id)}
                            onChange={() => toggleSelection(letter.id)}
                          />
                        </td>
                      )}
                      {visibleColumns.has('sender') && <td>{letter.metadata.sender || "—"}</td>}
                      {visibleColumns.has('recipient') && <td>{letter.metadata.recipient || "—"}</td>}
                      {visibleColumns.has('year') && <td className="date-cell">{year}</td>}
                      {visibleColumns.has('month') && <td className="date-cell">{month}</td>}
                      {visibleColumns.has('day') && <td className="date-cell">{day}</td>}
                      {visibleColumns.has('collection') && <td>{letter.collectionCode || "—"}</td>}
                      {visibleColumns.has('letters') && <td className="count-cell">{pageCount || "—"}</td>}
                      {visibleColumns.has('extras') && <td className="count-cell">{extrasCount || "—"}</td>}
                      {visibleColumns.has('transcript') && (
                        <td className="status-cell">
                          <StatusIcon status={letter.transcriptStatus} type="T" />
                        </td>
                      )}
                      {visibleColumns.has('metadata') && (
                        <td className="status-cell">
                          <StatusIcon status={letter.metadataContentStatus} type="M" />
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
                })
              )}
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
    </div>
  );
}
