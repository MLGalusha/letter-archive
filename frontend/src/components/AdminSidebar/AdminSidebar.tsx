import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import {
  getUnreadCount,
  getRecentNotifications,
  type AdminNotification,
  type NotificationSeverity,
} from '../../api/admin/notifications';
import { useNotificationStream } from '../../hooks/useNotificationStream';
import './AdminSidebar.css';

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', path: '/admin', icon: 'table' },
      { label: 'Content', path: '/admin/content', icon: 'newspaper' },
      { label: 'Processing', path: '/admin/processing', icon: 'process' },
      { label: 'Notes', path: '/admin/notes', icon: 'sticky-note' },
      { label: 'Usage', path: '/admin/usage', icon: 'chart' },
      { label: 'Upload', path: '/admin/upload', icon: 'plus' },
    ],
  },
];

const POLL_INTERVAL = 30_000;

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function AdminSidebar({ collapsed = false, onToggle }: AdminSidebarProps) {
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [maxSeverity, setMaxSeverity] = useState<NotificationSeverity | null>(null);
  const [recent, setRecent] = useState<AdminNotification[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverHoverRef = useRef<number | null>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadCount(data.count);
      setMaxSeverity(data.maxSeverity);
    } catch {
      // silently ignore — sidebar should not break on notification errors
    }
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const data = await getRecentNotifications();
      setRecent(data.notifications);
    } catch {
      // non-fatal
    }
  }, []);

  const [streamFallback, setStreamFallback] = useState(false);

  useEffect(() => {
    fetchUnread();
    // Polling runs as a safety net even when SSE is connected (cheap + fast),
    // but backs off to the full interval. If SSE falls back, we keep polling.
    const interval = setInterval(fetchUnread, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchUnread, streamFallback]);

  useNotificationStream({
    onNotification: (notif) => {
      if (!notif.read) {
        setUnreadCount((c) => c + 1);
        setMaxSeverity((prev) => {
          if (!prev) return notif.severity;
          return SEVERITY_RANK[notif.severity] > SEVERITY_RANK[prev] ? notif.severity : prev;
        });
      }
      // If the popover is open, refresh the recent list so the new item shows up.
      if (popoverOpen) {
        void fetchRecent();
      }
    },
    onFallback: () => setStreamFallback(true),
  });

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  const handleBellMouseEnter = () => {
    if (popoverHoverRef.current) {
      window.clearTimeout(popoverHoverRef.current);
      popoverHoverRef.current = null;
    }
    if (!popoverOpen) {
      fetchRecent();
    }
    setPopoverOpen(true);
  };

  const handleBellMouseLeave = () => {
    popoverHoverRef.current = window.setTimeout(() => {
      setPopoverOpen(false);
    }, 150);
  };

  return (
    <aside className={`admin-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <Link to="/admin" className="sidebar-brand">
          <span className="brand-text">Voices That Remain</span>
          <span className="brand-sub">Admin</span>
        </Link>
        {onToggle && (
          <button className="sidebar-toggle" onClick={onToggle} aria-label="Toggle sidebar">
            <Icon name={collapsed ? 'arrow-right' : 'arrow-left'} size={16} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section, sectionIndex) => (
          <div key={sectionIndex} className="nav-section">
            {section.title && <div className="nav-section-title">{section.title}</div>}
            {section.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
              >
                <Icon name={item.icon} size={18} />
                <span className="nav-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div
          className="bell-wrapper"
          onMouseEnter={handleBellMouseEnter}
          onMouseLeave={handleBellMouseLeave}
        >
          <Link
            to="/admin/notifications"
            className={`nav-item nav-item-bell ${isActive('/admin/notifications') ? 'active' : ''}`}
          >
            <span className="bell-icon-wrap">
              <Icon name="bell" size={18} />
              {unreadCount > 0 && (
                <span className={`bell-badge sev-${maxSeverity ?? 'info'}`}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
            <span className="nav-label">Notifications</span>
          </Link>

          {popoverOpen && unreadCount > 0 && (
            <div className="bell-popover" role="dialog" aria-label="Recent notifications">
              <div className="bell-popover-header">
                <span>Recent unread</span>
                <span className="bell-popover-count">{unreadCount}</span>
              </div>
              {recent.length === 0 ? (
                <div className="bell-popover-empty">Loading…</div>
              ) : (
                <ul className="bell-popover-list">
                  {recent.map((n) => (
                    <li key={n.id} className={`bell-popover-item sev-${n.severity}`}>
                      <Link
                        to={n.link ?? '/admin/notifications'}
                        className="bell-popover-link"
                        onClick={() => setPopoverOpen(false)}
                      >
                        <span className="bell-popover-stripe" aria-hidden />
                        <div className="bell-popover-body">
                          <div className="bell-popover-title">{n.title}</div>
                          {(n.sourceLabel || n.sourceType) && (
                            <div className="bell-popover-source">
                              {n.sourceLabel
                                ? n.sourceLabel
                                : `${n.sourceType}${n.sourceId ? `: ${n.sourceId.slice(0, 8)}` : ''}`}
                            </div>
                          )}
                        </div>
                        <div className="bell-popover-time">
                          {formatRelativeTime(n.lastOccurredAt || n.createdAt)}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/admin/notifications"
                className="bell-popover-footer"
                onClick={() => setPopoverOpen(false)}
              >
                View all notifications
              </Link>
            </div>
          )}
        </div>

        <Link
          to="/admin/settings"
          className={`nav-item ${isActive('/admin/settings') ? 'active' : ''}`}
        >
          <Icon name="settings" size={18} />
          <span className="nav-label">Settings</span>
        </Link>
      </div>
    </aside>
  );
}
