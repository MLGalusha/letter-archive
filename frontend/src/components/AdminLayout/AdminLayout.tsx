import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../AdminSidebar';
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
    const stored = localStorage.getItem('adminSidebarCollapsed');
    return stored !== null ? stored === 'true' : false;
  });

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('adminSidebarCollapsed', String(next));
  };

  // Check authentication
  useEffect(() => {
    const isAuth = sessionStorage.getItem('adminAuth');
    if (!isAuth) {
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
