import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdminCollections,
  generateCollectionProfile,
  resetCollectionProfile,
  type AdminCollectionInfo,
} from '../../api/collections';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import ColumnToggleHeader from './AdminDashboard/ColumnToggleHeader';
import { useDashboardSelection } from './AdminDashboard/useDashboardSelection';
import './AdminCollectionsListPage.css';

const STATUS_LABELS: Record<string, string> = {
  EMPTY: 'No Profile',
  AI_DRAFT: 'AI Draft',
  EDITED: 'Edited',
  VERIFIED: 'Verified',
};

type CollectionColumnId =
  | 'code' | 'title' | 'total' | 'published' | 'earliest' | 'latest' | 'profile' | 'cover'
  | 'type_letter' | 'type_photo' | 'type_cover' | 'type_telegram'
  | 'type_card' | 'type_ephemera' | 'type_voice' | 'type_article' | 'type_diary';

const COLLECTION_COLUMNS: Array<{ id: CollectionColumnId; label: string; defaultVisible: boolean }> = [
  { id: 'code', label: 'Code', defaultVisible: true },
  { id: 'title', label: 'Title', defaultVisible: true },
  { id: 'total', label: 'Total', defaultVisible: true },
  { id: 'published', label: 'Published', defaultVisible: true },
  { id: 'type_letter', label: 'Letters', defaultVisible: true },
  { id: 'type_cover', label: 'Covers', defaultVisible: true },
  { id: 'type_telegram', label: 'Telegrams', defaultVisible: true },
  { id: 'type_photo', label: 'Photos', defaultVisible: true },
  { id: 'type_card', label: 'Cards', defaultVisible: false },
  { id: 'type_ephemera', label: 'Ephemera', defaultVisible: false },
  { id: 'type_voice', label: 'Voice', defaultVisible: false },
  { id: 'type_article', label: 'Articles', defaultVisible: false },
  { id: 'type_diary', label: 'Diary', defaultVisible: false },
  { id: 'earliest', label: 'Earliest', defaultVisible: true },
  { id: 'latest', label: 'Latest', defaultVisible: true },
  { id: 'profile', label: 'Profile', defaultVisible: true },
  { id: 'cover', label: 'Thumbnail', defaultVisible: true },
];

interface SavedCollectionColumnsState {
  visible: CollectionColumnId[];
  order?: CollectionColumnId[];
}

const COLLECTION_COLUMN_STORAGE_KEY = 'collection-visible-columns';
const DEFAULT_COLLECTION_VISIBLE_COLUMNS = new Set<CollectionColumnId>(
  COLLECTION_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id),
);
const DEFAULT_COLLECTION_COLUMN_ORDER = COLLECTION_COLUMNS.map((c) => c.id);

function normalizeCollectionColumnOrder(savedOrder?: CollectionColumnId[]): CollectionColumnId[] {
  const allColumnIds = new Set(DEFAULT_COLLECTION_COLUMN_ORDER);
  const normalized = (savedOrder ?? []).filter((id): id is CollectionColumnId => allColumnIds.has(id));
  const missing = DEFAULT_COLLECTION_COLUMN_ORDER.filter((id) => !normalized.includes(id));
  return [...normalized, ...missing];
}

function loadColumnState(): { visibleColumns: Set<CollectionColumnId>; columnOrder: CollectionColumnId[] } {
  try {
    const stored = localStorage.getItem(COLLECTION_COLUMN_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CollectionColumnId[] | SavedCollectionColumnsState;
      if (Array.isArray(parsed)) {
        return {
          visibleColumns: new Set(parsed),
          columnOrder: DEFAULT_COLLECTION_COLUMN_ORDER,
        };
      }

      return {
        visibleColumns: new Set(parsed.visible),
        columnOrder: normalizeCollectionColumnOrder(parsed.order),
      };
    }
  } catch { /* use defaults */ }
  return {
    visibleColumns: DEFAULT_COLLECTION_VISIBLE_COLUMNS,
    columnOrder: DEFAULT_COLLECTION_COLUMN_ORDER,
  };
}

function saveColumnState(visibleColumns: Set<CollectionColumnId>, columnOrder: CollectionColumnId[]) {
  localStorage.setItem(COLLECTION_COLUMN_STORAGE_KEY, JSON.stringify({
    visible: [...visibleColumns],
    order: columnOrder,
  }));
}

function formatDateRaw(dateRaw: string | null): string {
  if (!dateRaw || dateRaw.length < 8) return '—';
  return `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
}

/**
 * Collections table panel — embedded in the admin dashboard.
 * Reuses the same .letters-table classes for consistent UI.
 */
export default function CollectionsDashboard() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [initialColumnState] = useState(loadColumnState);
  const [visibleColumns, setVisibleColumns] = useState<Set<CollectionColumnId>>(initialColumnState.visibleColumns);
  const [columnOrder, setColumnOrder] = useState<CollectionColumnId[]>(initialColumnState.columnOrder);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const lastClickedIndex = useRef<number | null>(null);
  const columnMenuRef = useRef<HTMLTableCellElement | null>(null);
  const columnById = useMemo(() => new Map(COLLECTION_COLUMNS.map((column) => [column.id, column])), []);
  const orderedColumns = useMemo(
    () => columnOrder.map((id) => columnById.get(id)).filter((column): column is typeof COLLECTION_COLUMNS[number] => Boolean(column)),
    [columnById, columnOrder],
  );
  const visibleOrderedColumns = useMemo(
    () => orderedColumns.filter((column) => visibleColumns.has(column.id)),
    [orderedColumns, visibleColumns],
  );

  const {
    selectedIds,
    setSelectedIds,
    allFilteredSelected,
    setAllFilteredSelected,
    toggleSelection,
    clearSelection,
    handleSelectAllPage,
  } = useDashboardSelection(collections);

  const editMode = selectedIds.size > 0;

  const fetchCollections = useCallback(async () => {
    try {
      const data = await getAdminCollections();
      setCollections(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load collections'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  useEffect(() => {
    saveColumnState(visibleColumns, columnOrder);
  }, [columnOrder, visibleColumns]);

  const handleToggleColumn = (colId: CollectionColumnId) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
      }
      return next;
    });
  };

  const handleMoveColumn = (columnId: CollectionColumnId, direction: -1 | 1) => {
    setColumnOrder((previous) => {
      const currentIndex = previous.indexOf(columnId);
      if (currentIndex < 0) return previous;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) return previous;
      const next = [...previous];
      const [column] = next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, column);
      return next;
    });
  };

  const handleReorderColumn = (columnId: CollectionColumnId, targetIndex: number) => {
    setColumnOrder((previous) => {
      const currentIndex = previous.indexOf(columnId);
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= previous.length) return previous;
      const next = [...previous];
      const [column] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, column);
      return next;
    });
  };

  const handleResetColumnOrder = () => {
    setColumnOrder(DEFAULT_COLLECTION_COLUMN_ORDER);
    setVisibleColumns(DEFAULT_COLLECTION_VISIBLE_COLUMNS);
  };

  const handleCheckboxChange = (id: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex.current !== null) {
      const start = Math.min(lastClickedIndex.current, index);
      const end = Math.max(lastClickedIndex.current, index);
      const newSelected = new Set(selectedIds);
      for (let i = start; i <= end; i++) {
        newSelected.add(collections[i].id);
      }
      setSelectedIds(newSelected);
      setAllFilteredSelected(false);
    } else {
      toggleSelection(id);
    }
    lastClickedIndex.current = index;
  };

  const handleRowClick = (id: string, index: number, e: React.MouseEvent) => {
    if (editMode) {
      handleCheckboxChange(id, index, e);
      return;
    }
    const collection = collections.find((c) => c.id === id);
    if (collection) navigate(`/admin/collections/${collection.collectionCode}`);
  };

  const selectedCodes = collections
    .filter((c) => selectedIds.has(c.id))
    .map((c) => c.collectionCode);

  const handleGenerateProfiles = async () => {
    if (selectedCodes.length === 0) return;
    setProcessing(true);
    let successCount = 0;
    let failCount = 0;
    for (const code of selectedCodes) {
      try {
        await generateCollectionProfile(code, true);
        successCount++;
      } catch {
        failCount++;
      }
    }
    setProcessing(false);
    const msg = failCount > 0
      ? `Generated ${successCount} profile(s), ${failCount} failed`
      : `Generated ${successCount} profile(s)`;
    showToast(msg, failCount > 0 ? 'error' : 'success');
    clearSelection();
    fetchCollections();
  };

  const handleResetProfiles = async () => {
    setShowResetConfirm(false);
    if (selectedCodes.length === 0) return;
    setProcessing(true);
    let successCount = 0;
    let failCount = 0;
    for (const code of selectedCodes) {
      try {
        await resetCollectionProfile(code);
        successCount++;
      } catch {
        failCount++;
      }
    }
    setProcessing(false);
    const msg = failCount > 0
      ? `Reset ${successCount} profile(s), ${failCount} failed`
      : `Reset ${successCount} profile(s)`;
    showToast(msg, failCount > 0 ? 'error' : 'success');
    clearSelection();
    fetchCollections();
  };

  const handleCloseToolbar = () => {
    clearSelection();
  };

  const selectionCount = allFilteredSelected ? collections.length : selectedIds.size;

  return (
    <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
      <div className={`letters-table-container ${!loading && collections.length === 0 ? 'empty' : ''}`}>
        {loading && <p style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading collections...</p>}
        {error && <p style={{ padding: '2rem', color: 'var(--danger, #e74c3c)' }}>{error}</p>}

        {!loading && !error && collections.length === 0 && (
          <p>No collections found.</p>
        )}

        {!loading && !error && collections.length > 0 && (
          <table className="letters-table">
            <thead>
              <tr>
                <ColumnToggleHeader
                  orderedColumns={orderedColumns}
                  visibleColumns={visibleColumns}
                  showColumnMenu={showColumnMenu}
                  onToggleColumnMenu={() => setShowColumnMenu((open) => !open)}
                  onCloseColumnMenu={() => setShowColumnMenu(false)}
                  onToggleColumn={handleToggleColumn}
                  onMoveColumn={handleMoveColumn}
                  onReorderColumn={handleReorderColumn}
                  onResetColumnOrder={handleResetColumnOrder}
                  columnMenuRef={columnMenuRef}
                />
                {visibleOrderedColumns.map((col) => (
                  <th key={col.id}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collections.map((c, index) => (
                <tr
                  key={c.id}
                  className={`letter-row${selectedIds.has(c.id) ? ' selected' : ''}${editMode ? ' edit-mode' : ''}`}
                  onClick={(e) => handleRowClick(c.id, index, e)}
                >
                  <td
                    className="checkbox-cell"
                    onClick={(e) => { e.stopPropagation(); handleCheckboxChange(c.id, index, e); }}
                  >
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={selectedIds.has(c.id)}
                      readOnly
                      tabIndex={-1}
                    />
                  </td>
                  {visibleOrderedColumns.map((col) => {
                    switch (col.id) {
                      case 'code': return <td key={col.id} className="collection-code-cell">{c.collectionCode}</td>;
                      case 'title': return <td key={col.id} className="collection-title-cell">{c.title || '—'}</td>;
                      case 'total': return <td key={col.id} className="count-cell">{c.letterCount ?? 0}</td>;
                      case 'published': return <td key={col.id} className="count-cell">{c.publishedCount}</td>;
                      case 'earliest': return <td key={col.id} className="date-cell">{formatDateRaw(c.minDate)}</td>;
                      case 'latest': return <td key={col.id} className="date-cell">{formatDateRaw(c.maxDate)}</td>;
                      case 'profile': return (
                        <td key={col.id} className="status-cell">
                          <span className={`collection-profile-badge profile-${(c.profileStatus || 'EMPTY').toLowerCase().replace('_', '-')}`}>
                            {STATUS_LABELS[c.profileStatus || 'EMPTY']}
                          </span>
                        </td>
                      );
                      case 'cover': return (
                        <td key={col.id} className="status-cell">
                          <span className={`collection-cover-badge ${c.highlightImageId ? 'cover-custom' : 'cover-default'}`}>
                            {c.highlightImageId ? 'Custom' : 'Default'}
                          </span>
                        </td>
                      );
                      default: {
                        // Type count columns (type_letter, type_photo, etc.)
                        const typeKey = col.id.replace('type_', '') as keyof typeof c.typeCounts;
                        const count = c.typeCounts?.[typeKey] ?? 0;
                        return <td key={col.id} className="count-cell">{count || '—'}</td>;
                      }
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div className="collections-dialog-overlay">
          <div className="collections-dialog">
            <h3>Reset {selectionCount} {selectionCount === 1 ? 'Profile' : 'Profiles'}?</h3>
            <p>This will clear all generated profile content (hook, summary, correspondents, featured letter) for the selected {selectionCount === 1 ? 'collection' : 'collections'}.</p>
            <div className="collections-dialog-actions">
              <button type="button" className="collections-dialog-btn" onClick={() => setShowResetConfirm(false)}>Cancel</button>
              <button type="button" className="collections-dialog-btn collections-dialog-btn--danger" onClick={handleResetProfiles}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit toolbar */}
      <div className={`edit-toolbar ${editMode ? 'visible' : ''}`}>
        <div className="edit-toolbar-content">
          <div className="edit-toolbar-left">
            <span className="toolbar-selection-count">
              {selectionCount} {selectionCount === 1 ? 'collection' : 'collections'}
            </span>
            <button
              type="button"
              className="toolbar-select-btn"
              onClick={handleSelectAllPage}
            >
              {collections.every((c) => selectedIds.has(c.id)) ? 'Deselect All' : `All (${collections.length})`}
            </button>
          </div>

          <div className="edit-toolbar-center">
            <button
              type="button"
              className="toolbar-process-btn"
              disabled={processing}
              onClick={handleGenerateProfiles}
            >
              {processing ? 'Processing...' : 'Generate Profiles'}
            </button>
          </div>

          <div className="edit-toolbar-right">
            <button
              type="button"
              className="toolbar-btn-destructive"
              disabled={processing}
              onClick={() => setShowResetConfirm(true)}
            >
              Reset Profiles
            </button>
            <div className="toolbar-divider" />
            <button
              type="button"
              className="toolbar-close-btn"
              onClick={handleCloseToolbar}
              title="Close toolbar"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
