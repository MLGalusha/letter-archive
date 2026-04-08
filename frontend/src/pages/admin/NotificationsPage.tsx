import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import type { IconName } from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import {
  getNotifications,
  getNotificationCounts,
  bulkMarkRead,
  bulkResolve,
  bulkArchive,
  bulkDelete,
  resolveNotification,
  archiveNotification,
  deleteNotification,
  markAsRead,
  type AdminNotification,
  type NotificationSeverity,
  type NotificationStatus,
  type NotificationListParams,
  type NotificationGroupBy,
  type NotificationCountsResponse,
} from '../../api/admin/notifications';
import NotificationDetailModal from './NotificationDetailModal';
import { useNotificationStream } from '../../hooks/useNotificationStream';
import './NotificationsPage.css';

const PAGE_SIZE = 50;

// ============================================================================
// Type categories — used by the Type dropdown filter
// ============================================================================

interface TypeCategory {
  key: string;
  label: string;
  types: { value: string; label: string }[];
}

const TYPE_CATEGORIES: TypeCategory[] = [
  {
    key: 'uploads',
    label: 'Uploads',
    types: [
      { value: 'upload_success', label: 'Upload success' },
      { value: 'upload_failed', label: 'Upload failed' },
    ],
  },
  {
    key: 'processing',
    label: 'Processing',
    types: [
      { value: 'transcription_success', label: 'Transcription success' },
      { value: 'transcription_failed', label: 'Transcription failed' },
      { value: 'metadata_success', label: 'Metadata success' },
      { value: 'metadata_failed', label: 'Metadata failed' },
      { value: 'entity_success', label: 'Entity success' },
      { value: 'entity_failed', label: 'Entity failed' },
      { value: 'batch_started', label: 'Batch started' },
      { value: 'batch_complete', label: 'Batch complete' },
      { value: 'job_max_retries', label: 'Job max retries' },
      { value: 'job_orphan_recovered', label: 'Job orphan recovered' },
    ],
  },
  {
    key: 'ai',
    label: 'AI / OpenAI',
    types: [
      { value: 'api_error', label: 'API error' },
      { value: 'api_quota', label: 'API quota / 429' },
      { value: 'collection_profile_started', label: 'Profile started' },
      { value: 'collection_profile_complete', label: 'Profile complete' },
      { value: 'collection_profile_failed', label: 'Profile failed' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    types: [
      { value: 'queue_paused', label: 'Queue paused' },
      { value: 'queue_resumed', label: 'Queue resumed' },
      { value: 'system_worker_started', label: 'Worker started' },
      { value: 'system_worker_error', label: 'Worker error' },
      { value: 'sweeper_stuck_jobs', label: 'Stuck jobs' },
      { value: 'sweeper_high_failure_rate', label: 'High failure rate' },
      { value: 'migrations_pending', label: 'Migrations pending' },
      { value: 'stub_mode_active', label: 'Stub mode active' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    types: [
      { value: 'admin_joined', label: 'Admin joined' },
      { value: 'admin_login_failed', label: 'Login failed' },
      { value: 'ai_notes_high_priority', label: 'High-priority notes' },
    ],
  },
];

const SEVERITIES: NotificationSeverity[] = ['info', 'warn', 'error', 'critical'];
const STATUSES: NotificationStatus[] = ['open', 'acknowledged', 'resolved', 'archived'];

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  critical: 'Critical',
};

const STATUS_LABELS: Record<NotificationStatus, string> = {
  open: 'Open',
  acknowledged: 'Ack',
  resolved: 'Resolved',
  archived: 'Archived',
};

// ============================================================================
// Helpers
// ============================================================================

function getTypeIcon(type: string): IconName {
  if (type.startsWith('upload')) return 'upload';
  if (type.startsWith('transcription')) return 'edit';
  if (type.startsWith('metadata')) return 'file';
  if (type.startsWith('entity')) return 'person';
  if (type.startsWith('batch')) return 'folder';
  if (type.startsWith('job')) return 'process';
  if (type.startsWith('api')) return 'external-link';
  if (type.startsWith('collection_profile')) return 'newspaper';
  if (type.startsWith('queue')) return 'process';
  if (type.startsWith('system') || type.startsWith('sweeper')) return 'settings';
  if (type === 'migrations_pending' || type === 'stub_mode_active') return 'flag';
  if (type === 'admin_joined' || type === 'admin_login_failed') return 'lock';
  if (type === 'ai_notes_high_priority') return 'sticky-note';
  return 'bell';
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
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDateGroupLabel(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateDay.getTime() === today.getTime()) return 'Today';
  if (dateDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function getTypeCategoryLabel(type: string): string {
  for (const cat of TYPE_CATEGORIES) {
    if (cat.types.some((t) => t.value === type)) return cat.label;
  }
  return 'Other';
}

function friendlySource(notif: AdminNotification): string {
  if (!notif.sourceType) return 'No source';
  // Server-side enrichment: prefer the human-readable label (e.g. "014 · 1864-03-15")
  if (notif.sourceLabel) return notif.sourceLabel;
  if (!notif.sourceId) {
    return notif.sourceType.charAt(0).toUpperCase() + notif.sourceType.slice(1);
  }
  // Fallback for non-letter sources (collection / job / admin / system) where
  // the id is usually already a friendly slug. UUIDs get shortened.
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notif.sourceId);
  const short = isUuid ? notif.sourceId.slice(0, 8) : notif.sourceId;
  return `${notif.sourceType}: ${short}`;
}

type DateRange = 'all' | 'today' | '7d' | '30d';

function dateRangeToFrom(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  if (range === '7d') return new Date(now.getTime() - 7 * 86_400_000).toISOString();
  if (range === '30d') return new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return undefined;
}

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: 'All time',
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

// ============================================================================
// Component
// ============================================================================

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [counts, setCounts] = useState<NotificationCountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSeverities, setSelectedSeverities] = useState<NotificationSeverity[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<NotificationStatus[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<NotificationGroupBy>('date');
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  // UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailNotif, setDetailNotif] = useState<AdminNotification | null>(null);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);
  const dateMenuRef = useRef<HTMLDivElement | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Build params from filter state
  // ──────────────────────────────────────────────────────────────────────────
  const buildParams = useCallback(
    (offset: number): NotificationListParams => {
      return {
        severity: selectedSeverities.length > 0 ? selectedSeverities : undefined,
        status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
        type: selectedTypes.length > 0 ? selectedTypes : undefined,
        from: dateRangeToFrom(dateRange),
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      };
    },
    [selectedSeverities, selectedStatuses, selectedTypes, dateRange, search],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Fetching
  // ──────────────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(
    async (offset = 0, append = false) => {
      try {
        if (!append) setLoading(true);
        else setLoadingMore(true);
        setError(null);

        const data = await getNotifications(buildParams(offset));

        if (append) {
          setNotifications((prev) => [...prev, ...data.notifications]);
        } else {
          setNotifications(data.notifications);
          setSelectedIds(new Set());
        }
        setTotal(data.total);
        setUnreadCount(data.unreadCount);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load notifications.'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildParams],
  );

  const fetchCounts = useCallback(async () => {
    try {
      const data = await getNotificationCounts();
      setCounts(data);
    } catch {
      // non-fatal — counts are advisory
    }
  }, []);

  useEffect(() => {
    fetchNotifications(0, false);
  }, [fetchNotifications]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Live updates: prepend new notifications as they stream in, refresh counts.
  // On SSE fallback, do nothing special — the page has no polling, so the user
  // will need to refresh. (AdminSidebar still polls the unread count.)
  useNotificationStream({
    onNotification: (notif) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notif.id)) {
          // Dedupe bump — replace the existing row in place.
          return prev.map((n) => (n.id === notif.id ? notif : n));
        }
        return [notif, ...prev];
      });
      setTotal((t) => t + 1);
      if (!notif.read) setUnreadCount((c) => c + 1);
      void fetchCounts();
    },
  });

  // Close dropdowns on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target as Node)) {
        setTypeMenuOpen(false);
      }
      if (dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) {
        setDateMenuOpen(false);
      }
    }
    if (typeMenuOpen || dateMenuOpen) {
      document.addEventListener('mousedown', onClickOutside);
      return () => document.removeEventListener('mousedown', onClickOutside);
    }
  }, [typeMenuOpen, dateMenuOpen]);

  // ──────────────────────────────────────────────────────────────────────────
  // Filter handlers
  // ──────────────────────────────────────────────────────────────────────────
  const toggleSeverity = (s: NotificationSeverity) => {
    setSelectedSeverities((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };
  const toggleStatus = (s: NotificationStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };
  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };
  const toggleCategory = (key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const resetFilters = () => {
    setSelectedSeverities([]);
    setSelectedStatuses([]);
    setSelectedTypes([]);
    setDateRange('all');
    setSearch('');
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Selection handlers
  // ──────────────────────────────────────────────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleSelected =
    notifications.length > 0 && notifications.every((n) => selectedIds.has(n.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Bulk actions
  // ──────────────────────────────────────────────────────────────────────────
  const runBulk = async (
    action: (ids: string[]) => Promise<{ success: true; count: number }>,
    label: string,
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await action(ids);
      setSelectedIds(new Set());
      await Promise.all([fetchNotifications(0, false), fetchCounts()]);
    } catch (err) {
      setError(getErrorMessage(err, `Failed to ${label}.`));
    }
  };

  const handleBulkRead = () => runBulk(bulkMarkRead, 'mark as read');
  const handleBulkResolve = () => runBulk(bulkResolve, 'resolve');
  const handleBulkArchive = () => runBulk(bulkArchive, 'archive');
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} notification${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`,
      )
    )
      return;
    runBulk(bulkDelete, 'delete');
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Per-row / modal actions
  // ──────────────────────────────────────────────────────────────────────────
  const handleResolve = async (id: string) => {
    try {
      await resolveNotification(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'resolved', read: true } : n)),
      );
      fetchCounts();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to resolve notification.'));
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveNotification(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'archived', read: true } : n)),
      );
      fetchCounts();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to archive notification.'));
    }
  };

  const handleDelete = async (id: string) => {
    const wasUnread = notifications.find((n) => n.id === id)?.read === false;
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
      fetchCounts();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete notification.'));
    }
  };

  // Per-row inline handlers (stop propagation so row click doesn't fire)
  const handleRowResolve = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    handleResolve(id);
  };
  const handleRowArchive = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    handleArchive(id);
  };
  const handleRowDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this notification? This cannot be undone.')) return;
    handleDelete(id);
  };

  const openDetail = async (notif: AdminNotification) => {
    setDetailNotif(notif);
    if (!notif.read) {
      try {
        await markAsRead(notif.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        // non-fatal
      }
    }
  };

  const handleLoadMore = () => {
    fetchNotifications(notifications.length, true);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Grouping (client-side)
  // ──────────────────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, AdminNotification[]>();
    for (const notif of notifications) {
      let key: string;
      if (groupBy === 'date') {
        key = getDateGroupLabel(notif.createdAt);
      } else if (groupBy === 'type') {
        key = getTypeCategoryLabel(notif.type);
      } else if (groupBy === 'source') {
        key = notif.sourceType ? notif.sourceType : 'No source';
      } else {
        // severity
        key = SEVERITY_LABELS[notif.severity];
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(notif);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [notifications, groupBy]);

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────
  const activeFilterCount =
    selectedSeverities.length +
    selectedStatuses.length +
    selectedTypes.length +
    (dateRange === 'all' ? 0 : 1) +
    (search.trim() ? 1 : 0);

  return (
    <AdminLayout>
      <div className="notif-page">
        {/* Header row */}
        <div className="notif-page-header">
          <div className="notif-page-title-row">
            <h1 className="notif-page-title">Notifications</h1>
            {unreadCount > 0 && <span className="notif-unread-pill">{unreadCount} unread</span>}
          </div>
          <div className="notif-page-actions">
            <div className="notif-groupby">
              <label htmlFor="notif-groupby-select">Group:</label>
              <select
                id="notif-groupby-select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as NotificationGroupBy)}
              >
                <option value="date">Date</option>
                <option value="type">Type</option>
                <option value="source">Source</option>
                <option value="severity">Severity</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────── */}
        <div className="notif-filterbar">
          {/* Search row */}
          <div className="notif-search-row">
            <div className="notif-search-wrap">
              <Icon name="eye" size={15} className="notif-search-icon" />
              <input
                id="notif-search-input"
                type="search"
                className="notif-search-input"
                placeholder="Search notifications…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search"
              />
            </div>
          </div>

          {/* Severity pills */}
          <div className="notif-severity-row">
            {SEVERITIES.map((s) => (
              <button
                type="button"
                key={s}
                className={`notif-sevpill sev-${s} ${selectedSeverities.includes(s) ? 'active' : ''}`}
                onClick={() => toggleSeverity(s)}
              >
                <span className="notif-sevpill-dot" aria-hidden />
                <span>{SEVERITY_LABELS[s]}</span>
                {counts && (
                  <span className="notif-sevpill-count">{counts.bySeverity[s] ?? 0}</span>
                )}
              </button>
            ))}
          </div>

          {/* Bottom row: status + date + type + reset */}
          <div className="notif-tools-row">
            <div className="notif-tool-group">
              <span className="notif-tool-label">Status</span>
              <div className="notif-segmented">
                {STATUSES.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={`notif-seg-btn ${selectedStatuses.includes(s) ? 'active' : ''}`}
                    onClick={() => toggleStatus(s)}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="notif-tool-dropdown" ref={dateMenuRef}>
              <button
                type="button"
                className={`notif-tool-btn ${dateRange !== 'all' ? 'active' : ''}`}
                onClick={() => setDateMenuOpen((v) => !v)}
              >
                <span className="notif-tool-btn-label">Date:</span>
                <span>{DATE_RANGE_LABELS[dateRange]}</span>
                <Icon name="chevron-down" size={12} />
              </button>
              {dateMenuOpen && (
                <div className="notif-dropdown-menu">
                  {(['all', 'today', '7d', '30d'] as DateRange[]).map((r) => (
                    <button
                      type="button"
                      key={r}
                      className={`notif-dropdown-item ${dateRange === r ? 'active' : ''}`}
                      onClick={() => {
                        setDateRange(r);
                        setDateMenuOpen(false);
                      }}
                    >
                      {DATE_RANGE_LABELS[r]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="notif-tool-dropdown" ref={typeMenuRef}>
              <button
                type="button"
                className={`notif-tool-btn ${selectedTypes.length > 0 ? 'active' : ''}`}
                onClick={() => setTypeMenuOpen((v) => !v)}
              >
                <span className="notif-tool-btn-label">Type:</span>
                <span>
                  {selectedTypes.length === 0
                    ? 'All types'
                    : `${selectedTypes.length} selected`}
                </span>
                <Icon name="chevron-down" size={12} />
              </button>
              {typeMenuOpen && (
                <div className="notif-dropdown-menu notif-type-menu">
                  {TYPE_CATEGORIES.map((cat) => {
                    const isOpen = openCategories.has(cat.key);
                    const selectedInCat = cat.types.filter((t) =>
                      selectedTypes.includes(t.value),
                    ).length;
                    return (
                      <div key={cat.key} className="notif-type-cat">
                        <button
                          type="button"
                          className="notif-type-cat-header"
                          onClick={() => toggleCategory(cat.key)}
                        >
                          <Icon
                            name={isOpen ? 'chevron-down' : 'chevron-right'}
                            size={11}
                          />
                          <span>{cat.label}</span>
                          {selectedInCat > 0 && (
                            <span className="notif-type-cat-count">{selectedInCat}</span>
                          )}
                        </button>
                        {isOpen && (
                          <div className="notif-type-cat-body">
                            {cat.types.map((t) => (
                              <label key={t.value} className="notif-type-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedTypes.includes(t.value)}
                                  onChange={() => toggleType(t.value)}
                                />
                                <span>{t.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {activeFilterCount > 0 && (
              <button type="button" className="notif-reset-btn" onClick={resetFilters}>
                Reset ({activeFilterCount})
              </button>
            )}
          </div>
        </div>

        {/* ── Main list area ─────────────────────────────────────────── */}
        <div className="notif-main">
          {selectedIds.size > 0 && (
            <div className="notif-bulk-bar">
              <span className="notif-bulk-count">{selectedIds.size} selected</span>
              <div className="notif-bulk-actions">
                <Button variant="ghost" size="sm" onClick={handleBulkRead}>
                  Mark read
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBulkResolve}>
                  Resolve
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBulkArchive}>
                  Archive
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBulkDelete}>
                  Delete
                </Button>
              </div>
              <button
                type="button"
                className="notif-bulk-clear"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          )}

          {error && <div className="notif-error">{error}</div>}

          {loading ? (
            <div className="notif-loading">Loading notifications…</div>
          ) : notifications.length === 0 ? (
            <div className="notif-empty">
              <div className="notif-empty-icon">
                <Icon name="bell" size={40} />
              </div>
              <p className="notif-empty-title">No notifications match these filters</p>
              <p className="notif-empty-desc">
                {activeFilterCount > 0
                  ? 'Try resetting filters or widening the date range.'
                  : 'Nothing here yet. Activity will show up as letters are processed.'}
              </p>
            </div>
          ) : (
            <>
              <div className="notif-list-header">
                <label className="notif-master-check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible"
                  />
                  <span>
                    {notifications.length} of {total}
                  </span>
                </label>
              </div>

              <div className="notif-list">
                {groups.map((group) => (
                  <div key={group.label} className="notif-group">
                    <div className="notif-group-label">{group.label}</div>
                    {group.items.map((notif) => {
                      const isSelected = selectedIds.has(notif.id);
                      return (
                        <div
                          key={notif.id}
                          className={`notif-row sev-${notif.severity} ${notif.read ? 'read' : 'unread'} ${isSelected ? 'selected' : ''}`}
                          onClick={() => openDetail(notif)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') openDetail(notif);
                          }}
                        >
                          <label
                            className="notif-row-check"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelected(notif.id)}
                              aria-label="Select notification"
                            />
                          </label>

                          {/* Colored circular icon badge */}
                          <div className="notif-row-avatar">
                            <Icon name={getTypeIcon(notif.type)} size={16} />
                          </div>

                          <div className="notif-row-content">
                            <div className="notif-row-title-line">
                              <span className={`notif-row-title ${notif.read ? '' : 'bold'}`}>
                                {notif.title}
                              </span>
                              {notif.dedupeCount > 1 && (
                                <span className="notif-dedupe-pill" title="Occurrences">
                                  ×{notif.dedupeCount}
                                </span>
                              )}
                              {notif.status !== 'open' && (
                                <span className={`notif-status-tag status-${notif.status}`}>
                                  {notif.status}
                                </span>
                              )}
                            </div>
                            {notif.message && (
                              <span className="notif-row-message">{notif.message}</span>
                            )}
                            {notif.sourceType && (
                              <span className="notif-row-source">
                                {friendlySource(notif)}
                              </span>
                            )}
                          </div>

                          <div className="notif-row-end">
                            <span className="notif-row-time">
                              {formatRelativeTime(notif.lastOccurredAt || notif.createdAt)}
                            </span>
                            <div className="notif-row-actions">
                              {notif.status !== 'resolved' && notif.status !== 'archived' && (
                                <button
                                  type="button"
                                  className="notif-row-btn"
                                  onClick={(e) => handleRowResolve(e, notif.id)}
                                  title="Resolve"
                                  aria-label="Resolve"
                                >
                                  <Icon name="check" size={14} />
                                </button>
                              )}
                              {notif.status !== 'archived' && (
                                <button
                                  type="button"
                                  className="notif-row-btn"
                                  onClick={(e) => handleRowArchive(e, notif.id)}
                                  title="Archive"
                                  aria-label="Archive"
                                >
                                  <Icon name="folder" size={14} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="notif-row-btn delete"
                                onClick={(e) => handleRowDelete(e, notif.id)}
                                title="Delete"
                                aria-label="Delete"
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {notifications.length < total && (
                <div className="notif-load-more">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={loadingMore}
                    onClick={handleLoadMore}
                  >
                    Load more
                  </Button>
                  <span className="notif-total">
                    {notifications.length} of {total}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <NotificationDetailModal
          notification={detailNotif}
          onClose={() => setDetailNotif(null)}
          onResolve={handleResolve}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      </div>
    </AdminLayout>
  );
}
