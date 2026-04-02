import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../common/Icon';
import type { IconName } from '../common/Icon';
import { getUnreadCount } from '../../api/admin/notifications';
import './AdminSidebar.css';

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

export default function AdminSidebar({ collapsed = false, onToggle }: AdminSidebarProps) {
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadCount(data.count);
    } catch {
      // silently ignore — sidebar should not break on notification errors
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
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
        <Link
          to="/admin/notifications"
          className={`nav-item nav-item-bell ${isActive('/admin/notifications') ? 'active' : ''}`}
        >
          <span className="bell-icon-wrap">
            <Icon name="bell" size={18} />
            {unreadCount > 0 && (
              <span className="bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </span>
          <span className="nav-label">Notifications</span>
        </Link>
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
