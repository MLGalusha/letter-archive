import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import { getNotes, type AggregatedNote, type NotesListResponse } from '../../api/admin/notes';
import './NotesPage.css';

const PAGE_SIZE = 50;

type StatusTab = 'all' | 'open' | 'resolved' | 'dismissed';

const CATEGORY_OPTIONS = [
  'identity', 'date', 'transcription', 'relationship',
  'context', 'cross-reference', 'location', 'condition',
];

function formatCategory(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatLetterDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown date';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function NotesPage() {
  const [notes, setNotes] = useState<AggregatedNote[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<NotesListResponse['counts']>({ open: 0, resolved: 0, dismissed: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [priority, setPriority] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildParams = useCallback(() => {
    const params: Record<string, string | number | undefined> = {
      limit: PAGE_SIZE,
      offset: 0,
    };
    if (activeTab !== 'all') params.status = activeTab;
    if (priority) params.priority = priority;
    if (category) params.category = category;
    if (debouncedSearch) params.search = debouncedSearch;
    return params;
  }, [activeTab, priority, category, debouncedSearch]);

  const fetchNotes = useCallback(async (offset = 0, append = false) => {
    try {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const params = buildParams();
      params.offset = offset;

      const data = await getNotes(params as Parameters<typeof getNotes>[0]);

      if (append) {
        setNotes(prev => [...prev, ...data.notes]);
      } else {
        setNotes(data.notes);
      }
      setTotal(data.total);
      setCounts(data.counts);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load notes.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchNotes(0, false);
  }, [fetchNotes]);

  const handleLoadMore = () => {
    fetchNotes(notes.length, true);
  };

  const tabs: { key: StatusTab; label: string; count?: number }[] = useMemo(() => [
    { key: 'all', label: 'All', count: counts.open + counts.resolved + counts.dismissed },
    { key: 'open', label: 'Open', count: counts.open },
    { key: 'resolved', label: 'Resolved', count: counts.resolved },
    { key: 'dismissed', label: 'Dismissed', count: counts.dismissed },
  ], [counts]);

  // Summary text
  const summaryParts: string[] = [];
  if (counts.open > 0) summaryParts.push(`${counts.open} open`);
  if (counts.resolved > 0) summaryParts.push(`${counts.resolved} resolved`);
  if (counts.dismissed > 0) summaryParts.push(`${counts.dismissed} dismissed`);
  const summaryText = summaryParts.join(' \u00B7 ') || 'No notes';

  if (loading) {
    return (
      <AdminLayout>
        <div className="notes-loading">Loading notes...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="notes-page">
        {/* Header */}
        <div className="notes-page-header">
          <div className="notes-page-header-top">
            <div className="notes-page-title-row">
              <h1 className="notes-page-title">Notes</h1>
            </div>
            <span className="notes-page-summary">{summaryText}</span>
          </div>

          {/* Status tabs */}
          <div className="notes-tabs">
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`notes-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className="notes-tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div className="notes-filters-row">
            <select
              className="notes-filter-select"
              value={priority}
              onChange={e => setPriority(e.target.value)}
            >
              <option value="">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select
              className="notes-filter-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map(c => (
                <option key={c} value={c}>{formatCategory(c)}</option>
              ))}
            </select>

            <input
              type="text"
              className="notes-search-input"
              placeholder="Search notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="notes-error">{error}</div>
        )}

        {/* Notes List */}
        {notes.length === 0 ? (
          <div className="notes-empty">
            <div className="notes-empty-icon">
              <Icon name="file" size={40} />
            </div>
            <p className="notes-empty-title">No notes found</p>
            <p className="notes-empty-desc">
              {activeTab !== 'all' || priority || category || debouncedSearch
                ? 'Try adjusting your filters.'
                : 'Notes will appear here after metadata extraction runs on letters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="notes-list">
              {notes.map(note => (
                <NoteRow key={`${note.letterId}-${note.id}`} note={note} />
              ))}
            </div>

            {/* Load More */}
            {notes.length < total && (
              <div className="notes-load-more">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={loadingMore}
                  onClick={handleLoadMore}
                >
                  Load more
                </Button>
                <span className="notes-total">
                  {notes.length} of {total}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

/* ── Note Row Component ──────────────────────────────── */

function NoteRow({ note }: { note: AggregatedNote }) {
  const letterContext: string[] = [];
  if (note.letterDate) letterContext.push(formatLetterDate(note.letterDate));
  letterContext.push(`Collection ${note.collectionCode}`);
  if (note.sender || note.recipient) {
    const from = note.sender || '?';
    const to = note.recipient || '?';
    letterContext.push(`${from} \u2192 ${to}`);
  }

  return (
    <div className={`notes-row ${note.status}`}>
      {/* Badges */}
      <div className="notes-row-badges">
        <span className={`notes-badge priority-${note.priority}`}>
          {note.priority}
        </span>
        <span className={`notes-badge cat-${note.category}`}>
          {formatCategory(note.category)}
        </span>
      </div>

      {/* Content */}
      <div className="notes-row-content">
        <p className="notes-row-text">{note.content}</p>

        <Link
          to={`/admin/letters/${note.letterId}`}
          className="notes-row-letter"
          onClick={e => e.stopPropagation()}
        >
          {letterContext.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="notes-row-letter-sep"> &middot; </span>}
              {part}
            </span>
          ))}
        </Link>

        {note.status === 'open' && note.resolves_when && (
          <span className="notes-row-resolves">
            Auto-resolves when: {note.resolves_when}
          </span>
        )}

        {note.status === 'resolved' && (
          <div className="notes-row-resolved-info">
            <Icon name="check" size={12} />
            <span>Resolved{note.resolved_at ? ` ${formatRelativeTime(note.resolved_at)}` : ''}</span>
          </div>
        )}
      </div>

      {/* Status dot */}
      <div className="notes-row-status">
        <span className={`notes-status-dot ${note.status}`} title={note.status} />
      </div>
    </div>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
