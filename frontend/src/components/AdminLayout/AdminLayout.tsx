import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../AdminSidebar';
import Icon from '../common/Icon';
import { getRecentEdits, formatTimeAgo, type RecentEdit } from '../../utils/recentEdits';
import './AdminLayout.css';

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
  headerActions?: React.ReactNode;
  fullHeight?: boolean;
}

export default function AdminLayout({ children, title, headerActions, fullHeight }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [recentEdits, setRecentEdits] = useState<RecentEdit[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  // Check authentication
  useEffect(() => {
    const isAuth = sessionStorage.getItem('adminAuth');
    if (!isAuth) {
      navigate('/admin-login');
    }
  }, [navigate]);

  // Load recent edits
  useEffect(() => {
    setRecentEdits(getRecentEdits());
  }, []);

  // Close recent dropdown on click outside
  useEffect(() => {
    if (!showRecent) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRecent]);

  const handleRecentClick = (id: string) => {
    setShowRecent(false);
    navigate(`/admin/letters/${id}`);
  };

  return (
    <div className={`admin-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <AdminSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      <div className="admin-main">
        <header className="admin-header">
          <div className="header-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <Icon name="edit" size={20} />
            </button>
            {title && <h1 className="header-title">{title}</h1>}
          </div>

          {headerActions && <div className="header-center">{headerActions}</div>}

          <div className="header-right">
            <div className="recent-edits-dropdown" ref={recentDropdownRef}>
              <button
                className="recent-edits-btn"
                onClick={() => setShowRecent(!showRecent)}
              >
                <Icon name="refresh" size={16} />
                Recent
                <Icon name="chevron-down" size={14} />
              </button>
              {showRecent && (
                <div className="history-dropdown">
                  <div className="history-header">Edit History</div>
                  <div className="history-items">
                    {recentEdits.length === 0 ? (
                      <div className="history-empty">No recent edits</div>
                    ) : (
                      recentEdits.map((edit) => (
                        <div
                          key={edit.id}
                          className="history-item"
                          onClick={() => handleRecentClick(edit.id)}
                        >
                          <span className="history-info">{edit.displayName}</span>
                          <span className="history-time">{formatTimeAgo(edit.editedAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className={`admin-content${fullHeight ? ' full-height' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
