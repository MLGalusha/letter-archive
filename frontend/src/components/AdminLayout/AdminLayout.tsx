import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated } from '../../api/auth';
import AdminSidebar from '../AdminSidebar';
import Icon from '../common/Icon';
import UploadStatusBanner from '../UploadStatusBanner';
import './AdminLayout.css';

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
  headerActions?: React.ReactNode;
  fullHeight?: boolean;
}

export default function AdminLayout({ children, headerActions, fullHeight }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem('adminSidebarCollapsed');
    return stored !== null ? stored === 'true' : false;
  });

  const toggleSidebar = () => {
    if (isMobile) {
      setMobileNavOpen((open) => {
        const nextOpen = !open;
        if (nextOpen) {
          window.dispatchEvent(new CustomEvent('admin-mobile-nav-open'));
        }
        return nextOpen;
      });
      return;
    }

    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('adminSidebarCollapsed', String(next));
  };

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 768;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/admin-login');
    }
  }, [navigate]);

  const closeMobileNav = () => {
    setMobileNavOpen(false);
  };

  return (
    <div
      className={[
        'admin-layout',
        sidebarCollapsed && !isMobile ? 'sidebar-collapsed' : '',
        isMobile ? 'is-mobile' : '',
        mobileNavOpen ? 'mobile-nav-open' : '',
        headerActions ? 'has-header-actions' : '',
      ].filter(Boolean).join(' ')}
    >
      <AdminSidebar
        collapsed={isMobile ? false : sidebarCollapsed}
        onToggle={toggleSidebar}
        onNavigate={closeMobileNav}
      />

      {/* Mobile overlay: shown when sidebar is expanded on small screens */}
      <div className="mobile-overlay" onClick={closeMobileNav} />

      <div className="admin-main">
        <header className="admin-mobile-topbar">
          <div className="admin-mobile-brand">
            <span className="admin-mobile-title">Voices That Remain</span>
            <span className="admin-mobile-subtitle">Admin</span>
          </div>
          <button
            className="admin-mobile-menu-btn"
            type="button"
            onClick={toggleSidebar}
            aria-label={mobileNavOpen ? 'Close admin menu' : 'Open admin menu'}
            aria-expanded={mobileNavOpen}
          >
            <Icon name={mobileNavOpen ? 'close' : 'menu'} size={20} />
          </button>
        </header>

        <header className="admin-header">
          {headerActions && <div className="header-center">{headerActions}</div>}
        </header>

        <UploadStatusBanner />

        <main
          className={`admin-content${fullHeight ? ' full-height' : ''}`}
          tabIndex={0}
          aria-label="Admin content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
