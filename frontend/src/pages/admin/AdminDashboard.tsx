import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminLetters, deleteLetter } from "../../api/letters";
import type { Letter, WorkflowState, VisibilityState } from "../../types/Letter";
import "./AdminDashboard.css";

// Extended sort field to include client-side computed columns
type ExtendedSortField = 'sender' | 'recipient' | 'letterDate' | 'collection' | 'letters' | 'extras' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface SortColumn {
  field: ExtendedSortField;
  direction: SortDirection;
}

// localStorage key for persisting filters and sorting
const STORAGE_KEY = 'adminDashboardState';

interface PersistedState {
  visibilityFilter: "all" | VisibilityState;
  workflowFilter: "all" | WorkflowState;
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

const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  UPLOADED: "Uploaded",
  TRANSCRIBING: "Transcribing",
  TRANSCRIBED: "Transcribed",
  METADATA_EXTRACTING: "Extracting",
  METADATA_DRAFTED: "Metadata Ready",
  REVIEWED: "Reviewed",
};

const VISIBILITY_LABELS: Record<VisibilityState, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  HIDDEN: "Hidden",
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load persisted state on mount
  const persistedState = useRef(loadPersistedState());

  // Filters (initialized from localStorage)
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | VisibilityState>(
    persistedState.current.visibilityFilter ?? "all"
  );
  const [workflowFilter, setWorkflowFilter] = useState<"all" | WorkflowState>(
    persistedState.current.workflowFilter ?? "all"
  );
  const [collectionFilter, setCollectionFilter] = useState<string>(
    persistedState.current.collectionFilter ?? "all"
  );
  const [collectionInput, setCollectionInput] = useState<string>(
    persistedState.current.collectionInput ?? ""
  );
  const [searchQuery, setSearchQuery] = useState(
    persistedState.current.searchQuery ?? ""
  );
  const collectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Multi-column sorting - array maintains priority order (first = highest priority)
  const [sortColumns, setSortColumns] = useState<SortColumn[]>(
    persistedState.current.sortColumns ?? []
  );

  // Persist state changes to localStorage
  useEffect(() => {
    savePersistedState({
      visibilityFilter,
      workflowFilter,
      collectionFilter,
      collectionInput,
      searchQuery,
      sortColumns,
    });
  }, [visibilityFilter, workflowFilter, collectionFilter, collectionInput, searchQuery, sortColumns]);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const fetchLetters = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await getAdminLetters({
        limit: 100,
        visibility: visibilityFilter === "all" ? undefined : visibilityFilter,
        workflow: workflowFilter === "all" ? undefined : workflowFilter,
        collection: collectionFilter === "all" ? undefined : collectionFilter,
      });
      setLetters(response.letters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [visibilityFilter, workflowFilter, collectionFilter]);

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

  // Helper to get sortable value for a letter by field
  const getSortValue = (letter: Letter, field: ExtendedSortField): string | number => {
    switch (field) {
      case 'sender':
        return (letter.metadata.sender || '').toLowerCase();
      case 'recipient':
        return (letter.metadata.recipient || '').toLowerCase();
      case 'letterDate':
        return letter.metadata.dateRaw || letter.metadata.date || '';
      case 'collection':
        return (letter.collectionCode || '').toLowerCase();
      case 'letters':
        return letter.images.filter((img) => img.type === 'letter').length;
      case 'extras':
        return letter.images.filter((img) => img.type !== 'letter').length;
      case 'createdAt':
        return letter.createdAt;
      default:
        return '';
    }
  };

  // Apply multi-column sorting
  const sortedLetters = useMemo(() => {
    if (sortColumns.length === 0) return letters;

    return [...letters].sort((a, b) => {
      for (const { field, direction } of sortColumns) {
        const aVal = getSortValue(a, field);
        const bVal = getSortValue(b, field);

        let comparison = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }

        if (comparison !== 0) {
          return direction === 'asc' ? comparison : -comparison;
        }
      }
      return 0;
    });
  }, [letters, sortColumns]);

  // Client-side search filtering (applied after sorting)
  const filteredLetters = sortedLetters.filter((letter) => {
    if (searchQuery === "") return true;
    const query = searchQuery.toLowerCase();
    return (
      letter.metadata.sender?.toLowerCase().includes(query) ||
      letter.metadata.recipient?.toLowerCase().includes(query) ||
      letter.title.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getWorkflowBadge = (workflow: WorkflowState) => {
    return (
      <span className={`badge badge-workflow badge-workflow-${workflow.toLowerCase()}`}>
        {WORKFLOW_LABELS[workflow]}
      </span>
    );
  };

  const getVisibilityBadge = (visibility: VisibilityState) => {
    if (visibility === "DRAFT") return null;
    return (
      <span className={`badge badge-visibility badge-${visibility.toLowerCase()}`}>
        {VISIBILITY_LABELS[visibility]}
      </span>
    );
  };

  // Edit mode functions
  const toggleEditMode = () => {
    if (editMode) {
      // Exiting edit mode, clear selections
      setSelectedIds(new Set());
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

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLetters.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLetters.map((l) => l.id)));
    }
  };

  const handleDeleteClick = () => {
    if (selectedIds.size > 0) {
      setShowDeleteModal(true);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteLetter(id)));
      setSelectedIds(new Set());
      setShowDeleteModal(false);
      setEditMode(false);
      await fetchLetters();
    } catch (err) {
      console.error("Failed to delete letters:", err);
      setError(err instanceof Error ? err.message : "Failed to delete letters");
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
  };

  // Stats calculations
  const stats = {
    total: letters.length,
    uploaded: letters.filter((l) => l.workflowState === "UPLOADED").length,
    transcribed: letters.filter((l) => l.workflowState === "TRANSCRIBED" || l.workflowState === "METADATA_DRAFTED").length,
    reviewed: letters.filter((l) => l.workflowState === "REVIEWED").length,
    published: letters.filter((l) => l.visibility === "PUBLISHED").length,
  };

  if (loading && isInitialLoad) {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <h1>Admin Panel</h1>
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
          <h1>Admin Panel</h1>
        </header>
        <div className="admin-content">
          <p className="error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <button onClick={handleLogout} className="logout-button">
          Logout
        </button>
      </header>

      <div className="admin-content">
        <div className="admin-toolbar">
          <div className="toolbar-buttons">
            <button onClick={handleUploadClick} className="upload-button">
              Upload New Letter
            </button>
            <button
              onClick={toggleEditMode}
              className={`edit-mode-button ${editMode ? "active" : ""}`}
            >
              {editMode ? "Done" : "Edit"}
            </button>
            {editMode && (
              <button
                onClick={handleDeleteClick}
                className="delete-button"
                disabled={selectedIds.size === 0}
              >
                Delete ({selectedIds.size})
              </button>
            )}
          </div>

          <div className="filter-search-container">
            <div className="filter-group">
              <label>Collection:</label>
              <input
                type="text"
                value={collectionInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setCollectionInput(val);
                  // Debounce the filter update to prevent focus loss
                  if (collectionDebounceRef.current) {
                    clearTimeout(collectionDebounceRef.current);
                  }
                  collectionDebounceRef.current = setTimeout(() => {
                    // Only filter after 3 characters, or clear filter if empty
                    if (val.length >= 3) {
                      setCollectionFilter(val);
                    } else if (val.length === 0) {
                      setCollectionFilter("all");
                    }
                  }, 300);
                }}
                placeholder="000"
                className="collection-input"
              />
            </div>

            <div className="filter-group">
              <label>Visibility:</label>
              <select
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
              >
                <option value="all">All</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Workflow:</label>
              <select
                value={workflowFilter}
                onChange={(e) => setWorkflowFilter(e.target.value as typeof workflowFilter)}
              >
                <option value="all">All</option>
                <option value="UPLOADED">Uploaded</option>
                <option value="TRANSCRIBED">Transcribed</option>
                <option value="METADATA_DRAFTED">Metadata Ready</option>
                <option value="REVIEWED">Reviewed</option>
              </select>
            </div>

            <div className="search-group">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
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
                <th
                  className={`sortable-header ${getSortInfo("letterDate") ? "sorted" : ""}`}
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
                <th>Status</th>
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
              </tr>
            </thead>
            <tbody>
              {filteredLetters.length === 0 ? (
                <tr>
                  <td colSpan={editMode ? 9 : 8} className="empty-state">
                    No letters found
                  </td>
                </tr>
              ) : (
                filteredLetters.map((letter, index) => {
                  const pageCount = letter.images.filter((img) => img.type === "letter").length;
                  const extrasCount = letter.images.filter((img) => img.type !== "letter").length;
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
                      <td>{letter.metadata.sender || "—"}</td>
                      <td>{letter.metadata.recipient || "—"}</td>
                      <td>{letter.metadata.date || "—"}</td>
                      <td>{letter.collectionCode || "—"}</td>
                      <td className="count-cell">{pageCount || "—"}</td>
                      <td className="count-cell">{extrasCount || "—"}</td>
                      <td>
                        <div className="status-badges">
                          {getWorkflowBadge(letter.workflowState)}
                          {getVisibilityBadge(letter.visibility)}
                        </div>
                      </td>
                      <td>{formatDate(letter.createdAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Uploaded</div>
            <div className="stat-value">{stats.uploaded}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ready for Review</div>
            <div className="stat-value">{stats.transcribed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Reviewed</div>
            <div className="stat-value">{stats.reviewed}</div>
          </div>
          <div className="stat-card stat-card-highlight">
            <div className="stat-label">Published</div>
            <div className="stat-value">{stats.published}</div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={handleCancelDelete}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Letters</h2>
            <p>
              Are you sure you want to delete {selectedIds.size} letter
              {selectedIds.size === 1 ? "" : "s"}?
            </p>
            <div className="modal-buttons">
              <button
                onClick={handleCancelDelete}
                className="modal-cancel-button"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="modal-delete-button"
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
