import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import { getNotes, type AggregatedNote, type NotesListResponse } from '../../api/admin/notes';
import './NotesPage.css';

const PAGE_SIZE = 50;

type NoteTypeTab = 'all' | 'ai' | 'personal';
type StatusFilter = 'all' | 'open' | 'resolved' | 'dismissed';

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
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getSummaryText(activeTab: NoteTypeTab, counts: NotesListResponse['counts']): string {
  if (activeTab === 'personal') {
    return counts.personal > 0
      ? `${counts.personal} personal note${counts.personal === 1 ? '' : 's'}`
      : 'No personal notes';
  }

  if (activeTab === 'ai') {
    const summaryParts = [`${counts.ai} AI note${counts.ai === 1 ? '' : 's'}`];
    if (counts.open > 0) summaryParts.push(`${counts.open} open`);
    if (counts.resolved > 0) summaryParts.push(`${counts.resolved} resolved`);
    if (counts.dismissed > 0) summaryParts.push(`${counts.dismissed} dismissed`);
    return summaryParts.join(' \u00B7 ');
  }

  const summaryParts: string[] = [];
  if (counts.ai > 0) summaryParts.push(`${counts.ai} AI`);
  if (counts.personal > 0) summaryParts.push(`${counts.personal} personal`);
  if (counts.open > 0) summaryParts.push(`${counts.open} open`);
  if (counts.resolved > 0) summaryParts.push(`${counts.resolved} resolved`);
  if (counts.dismissed > 0) summaryParts.push(`${counts.dismissed} dismissed`);
  return summaryParts.join(' \u00B7 ') || 'No notes';
}

export default function NotesPage() {
  const [notes, setNotes] = useState<AggregatedNote[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<NotesListResponse['counts']>({
    open: 0,
    resolved: 0,
    dismissed: 0,
    ai: 0,
    personal: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NoteTypeTab>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [priority, setPriority] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  const showAiFilters = activeTab === 'ai';

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (showAiFilters) return;
    setStatus('all');
    setPriority('');
    setCategory('');
  }, [showAiFilters]);

  const buildParams = useCallback(() => {
    const params: Parameters<typeof getNotes>[0] = {
      limit: PAGE_SIZE,
      offset: 0,
    };

    if (activeTab !== 'all') params.type = activeTab;
    if (showAiFilters && status !== 'all') params.status = status;
    if (showAiFilters && priority) params.priority = priority;
    if (showAiFilters && category) params.category = category;
    if (debouncedSearch) params.search = debouncedSearch;

    return params;
  }, [activeTab, showAiFilters, status, priority, category, debouncedSearch]);

  const fetchNotes = useCallback(async (offset = 0, append = false) => {
    try {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const params = buildParams();
      params.offset = offset;

      const data = await getNotes(params);

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

  const tabs: { key: NoteTypeTab; label: string; count: number }[] = useMemo(() => [
    { key: 'all', label: 'All', count: counts.ai + counts.personal },
    { key: 'ai', label: 'AI Notes', count: counts.ai },
    { key: 'personal', label: 'Personal Notes', count: counts.personal },
  ], [counts]);

  const summaryText = useMemo(() => getSummaryText(activeTab, counts), [activeTab, counts]);
  const hasFilters = Boolean(debouncedSearch || (showAiFilters && (status !== 'all' || priority || category)));

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
        <div className="notes-page-header">
          <div className="notes-page-header-top">
            <div className="notes-page-title-row">
              <h1 className="notes-page-title">Notes</h1>
            </div>
            <span className="notes-page-summary">{summaryText}</span>
          </div>

          <div className="notes-tabs">
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`notes-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="notes-tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          <div className="notes-filters-row">
            {showAiFilters && (
              <>
                <select
                  className="notes-filter-select"
                  value={status}
                  onChange={e => setStatus(e.target.value as StatusFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>

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
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatCategory(option)}
                    </option>
                  ))}
                </select>
              </>
            )}

            <input
              type="text"
              className="notes-search-input"
              placeholder={activeTab === 'personal' ? 'Search personal notes...' : 'Search notes...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="notes-error">{error}</div>
        )}

        {notes.length === 0 ? (
          <div className="notes-empty">
            <div className="notes-empty-icon">
              <Icon name="file" size={40} />
            </div>
            <p className="notes-empty-title">No notes found</p>
            <p className="notes-empty-desc">
              {hasFilters
                ? 'Try adjusting your filters.'
                : activeTab === 'personal'
                  ? 'Personal notes appear here after you save them on a letter.'
                  : activeTab === 'ai'
                    ? 'AI notes appear here after metadata extraction runs on letters.'
                    : 'AI and personal notes appear here after metadata extraction or manual note entry.'}
            </p>
          </div>
        ) : (
          <>
            <div className="notes-list">
              {notes.map(note => (
                <NoteRow key={`${note.type}-${note.letterId}-${note.id}`} note={note} />
              ))}
            </div>

            {notes.length < total && (
              <div className="notes-load-more">
                <button
                  type="button"
                  className="notes-load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
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

function NoteRow({ note }: { note: AggregatedNote }) {
  const isPersonal = note.type === 'personal';
  const rowClass = isPersonal ? 'personal' : (note.status ?? 'open');
  const letterContext: string[] = [];

  if (note.letterDate) letterContext.push(formatLetterDate(note.letterDate));
  letterContext.push(`Collection ${note.collectionCode}`);
  if (note.sender || note.recipient) {
    const from = note.sender || '?';
    const to = note.recipient || '?';
    letterContext.push(`${from} \u2192 ${to}`);
  }

  return (
    <div className={`notes-row ${rowClass}`}>
      <div className="notes-row-badges">
        <span className={`notes-badge note-type-${note.type}`}>
          {isPersonal ? 'Personal' : 'AI Note'}
        </span>
        {!isPersonal && note.priority && (
          <span className={`notes-badge priority-${note.priority}`}>
            {note.priority}
          </span>
        )}
        {!isPersonal && note.category && (
          <span className={`notes-badge cat-${note.category}`}>
            {formatCategory(note.category)}
          </span>
        )}
      </div>

      <div className="notes-row-content">
        <p className="notes-row-text">{note.content}</p>

        <Link
          to={`/admin/letters/${note.letterId}${isPersonal ? '#personal-notes-section' : '#ai-notes-section'}`}
          className="notes-row-letter"
          onClick={e => e.stopPropagation()}
        >
          {letterContext.map((part, index) => (
            <span key={`${note.letterId}-${index}`}>
              {index > 0 && <span className="notes-row-letter-sep"> &middot; </span>}
              {part}
            </span>
          ))}
        </Link>

        {!isPersonal && note.status === 'open' && note.resolves_when && (
          <span className="notes-row-resolves">
            Auto-resolves when: {note.resolves_when}
          </span>
        )}

        {!isPersonal && note.status === 'resolved' && (
          <div className="notes-row-resolved-info">
            <Icon name="check" size={12} />
            <span>Resolved{note.resolved_at ? ` ${formatRelativeTime(note.resolved_at)}` : ''}</span>
          </div>
        )}
      </div>

      <div className="notes-row-status">
        <span
          className={`notes-status-dot ${isPersonal ? 'personal' : note.status ?? 'open'}`}
          title={isPersonal ? 'personal note' : note.status ?? 'open'}
        />
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
