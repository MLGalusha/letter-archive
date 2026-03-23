import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import type { IconName } from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  type AdminNotification,
} from '../../api/admin/notifications';
import './NotificationsPage.css';

const PAGE_SIZE = 20;

const TYPE_ICONS: Record<string, IconName> = {
  upload: 'upload',
  transcription: 'process',
  metadata: 'edit',
  entity: 'person',
  batch: 'folder',
  error: 'close',
  admin: 'lock',
  system: 'settings',
};

function getTypeIcon(type: string): IconName {
  return TYPE_ICONS[type] || 'bell';
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

function getDateGroup(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateDay.getTime() === today.getTime()) return 'Today';
  if (dateDay.getTime() === yesterday.getTime()) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

type FilterTab = 'all' | 'unread' | 'upload' | 'processing' | 'error';

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // Build API params from active tab
  const getFilterParams = useCallback((tab: FilterTab) => {
    switch (tab) {
      case 'unread':
        return { read: false as const };
      case 'upload':
        return { type: 'upload' };
      case 'processing':
        return { type: 'transcription' }; // covers transcription/metadata
      case 'error':
        return { type: 'error' };
      default:
        return {};
    }
  }, []);

  const fetchNotifications = useCallback(async (offset = 0, append = false) => {
    try {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      const filterParams = getFilterParams(activeTab);

      const data = await getNotifications({
        ...filterParams,
        limit: PAGE_SIZE,
        offset,
      });

      if (append) {
        setNotifications(prev => [...prev, ...data.notifications]);
      } else {
        setNotifications(data.notifications);
      }
      setTotal(data.total);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load notifications.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeTab, getFilterParams]);

  useEffect(() => {
    fetchNotifications(0, false);
  }, [fetchNotifications]);

  const handleLoadMore = () => {
    fetchNotifications(notifications.length, true);
  };

  const handleMarkAsRead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const notif = notifications.find(n => n.id === id);
    try {
      await deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      setTotal(prev => prev - 1);
      if (notif && !notif.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  };

  const handleNotificationClick = (notif: AdminNotification) => {
    if (notif.link) {
      if (!notif.read) {
        markAsRead(notif.id).catch(() => {});
        setNotifications(prev =>
          prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
      navigate(notif.link);
    }
  };

  // Group by date
  const groupedNotifications = useMemo(() => {
    const groups: { label: string; items: AdminNotification[] }[] = [];
    let currentLabel = '';

    for (const notif of notifications) {
      const label = getDateGroup(notif.createdAt);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [] });
      }
      groups[groups.length - 1].items.push(notif);
    }

    return groups;
  }, [notifications]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'upload', label: 'Uploads' },
    { key: 'processing', label: 'Processing' },
    { key: 'error', label: 'Errors' },
  ];

  if (loading) {
    return (
      <AdminLayout>
        <div className="notif-loading">Loading notifications...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="notif-page">
        {/* Header */}
        <div className="notif-header">
          <div className="notif-header-top">
            <div className="notif-header-title-row">
              <h1 className="notif-title">Notifications</h1>
              {unreadCount > 0 && (
                <span className="notif-unread-badge">{unreadCount}</span>
              )}
            </div>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
                Mark all read
              </Button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="notif-tabs">
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`notif-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="notif-error">{error}</div>
        )}

        {/* Notification List */}
        {notifications.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon">
              <Icon name="bell" size={40} />
            </div>
            <p className="notif-empty-title">No notifications</p>
            <p className="notif-empty-desc">
              {activeTab === 'unread'
                ? 'You\'re all caught up.'
                : 'Nothing here yet. Activity will show up as letters are processed.'}
            </p>
          </div>
        ) : (
          <>
            <div className="notif-list">
              {groupedNotifications.map(group => (
                <div key={group.label} className="notif-group">
                  <div className="notif-group-label">{group.label}</div>
                  {group.items.map(notif => (
                    <div
                      key={notif.id}
                      className={`notif-row ${notif.read ? 'read' : 'unread'} ${notif.link ? 'clickable' : ''}`}
                      onClick={() => handleNotificationClick(notif)}
                      role={notif.link ? 'button' : undefined}
                      tabIndex={notif.link ? 0 : undefined}
                      onKeyDown={notif.link ? (e) => { if (e.key === 'Enter') handleNotificationClick(notif); } : undefined}
                    >
                      {/* Unread dot */}
                      <div className="notif-row-dot-col">
                        {!notif.read && <span className="notif-dot" />}
                      </div>

                      {/* Type icon */}
                      <div className={`notif-row-icon type-${notif.type}`}>
                        <Icon name={getTypeIcon(notif.type)} size={16} />
                      </div>

                      {/* Content */}
                      <div className="notif-row-content">
                        <span className={`notif-row-title ${notif.read ? '' : 'bold'}`}>
                          {notif.title}
                        </span>
                        {notif.message && (
                          <span className="notif-row-message">{notif.message}</span>
                        )}
                      </div>

                      {/* Time + actions */}
                      <div className="notif-row-end">
                        <span className="notif-row-time">
                          {formatRelativeTime(notif.createdAt)}
                        </span>
                        <div className="notif-row-actions">
                          {!notif.read && (
                            <button
                              className="notif-row-btn"
                              onClick={(e) => handleMarkAsRead(e, notif.id)}
                              title="Mark as read"
                            >
                              <Icon name="check" size={14} />
                            </button>
                          )}
                          <button
                            className="notif-row-btn delete"
                            onClick={(e) => handleDelete(e, notif.id)}
                            title="Delete"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Load More */}
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
    </AdminLayout>
  );
}
