import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdminCollections,
  generateCollectionProfile,
  resetCollectionProfile,
  type AdminCollectionInfo,
} from '../../api/collections';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import Icon from '../../components/common/Icon';
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

const COLLECTION_COLUMN_STORAGE_KEY = 'collection-visible-columns';

function loadVisibleColumns(): Set<CollectionColumnId> {
  try {
    const stored = localStorage.getItem(COLLECTION_COLUMN_STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* use defaults */ }
  return new Set(COLLECTION_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
}

function saveVisibleColumns(cols: Set<CollectionColumnId>) {
  localStorage.setItem(COLLECTION_COLUMN_STORAGE_KEY, JSON.stringify([...cols]));
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
  const [visibleColumns, setVisibleColumns] = useState<Set<CollectionColumnId>>(loadVisibleColumns);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const lastClickedIndex = useRef<number | null>(null);
  const columnMenuRef = useRef<HTMLTableCellElement | null>(null);

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

  // Close column menu on outside click
  useEffect(() => {
    if (!showColumnMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (columnMenuRef.current?.contains(e.target as Node)) return;
      setShowColumnMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showColumnMenu]);

  const handleToggleColumn = (colId: CollectionColumnId) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) {
        next.delete(colId);
      } else {
        next.add(colId);
      }
      saveVisibleColumns(next);
      return next;
    });
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
                <th className="checkbox-header" ref={columnMenuRef}>
                  <button
                    className={`column-toggle-btn ${showColumnMenu ? 'active' : ''}`}
                    onClick={() => setShowColumnMenu((v) => !v)}
                    title="Toggle columns"
                  >
                    <Icon name="columns" size={14} />
                  </button>
                  {showColumnMenu && (
                    <div className="column-toggle-dropdown column-toggle-left">
                      {COLLECTION_COLUMNS.map((col) => (
                        <label key={col.id} className="column-toggle-item">
                          <input
                            type="checkbox"
                            checked={visibleColumns.has(col.id)}
                            onChange={() => handleToggleColumn(col.id)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  )}
                </th>
                {COLLECTION_COLUMNS.filter((col) => visibleColumns.has(col.id)).map((col) => (
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
                  {COLLECTION_COLUMNS.filter((col) => visibleColumns.has(col.id)).map((col) => {
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
