import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAuthenticated } from '../../api/auth';
import AdminSidebar from '../AdminSidebar';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Auto-collapse on mobile regardless of stored preference
    if (window.innerWidth <= 768) return true;
    const stored = localStorage.getItem('adminSidebarCollapsed');
    return stored !== null ? stored === 'true' : false;
  });

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    // Only persist preference on non-mobile screens
    if (window.innerWidth > 768) {
      localStorage.setItem('adminSidebarCollapsed', String(next));
    }
  };

  // Auto-collapse sidebar when resizing to mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarCollapsed(true);
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

  return (
    <div className={`admin-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <AdminSidebar
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      {/* Mobile overlay: shown when sidebar is expanded on small screens */}
      <div className="mobile-overlay" onClick={toggleSidebar} />

      <div className="admin-main">
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
