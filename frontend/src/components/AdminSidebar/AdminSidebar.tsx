import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import './AdminSidebar.css';

interface NavItem {
  label: string;
  path: string;
  icon: 'edit' | 'plus' | 'process' | 'person' | 'place' | 'relationships' | 'eye' | 'logout';
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', path: '/admin', icon: 'edit' },
      { label: 'Upload', path: '/admin/upload', icon: 'plus' },
      { label: 'Processing', path: '/admin/processing', icon: 'process' },
    ],
  },
  {
    title: 'ENTITIES',
    items: [
      { label: 'People', path: '/admin/entities/people', icon: 'person' },
      { label: 'Places', path: '/admin/entities/places', icon: 'place' },
      { label: 'Relationships', path: '/admin/entities/relationships', icon: 'relationships' },
      { label: 'Review Queue', path: '/admin/entities/review', icon: 'eye' },
    ],
  },
];

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function AdminSidebar({ collapsed = false, onToggle }: AdminSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(path);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('adminAuth');
    navigate('/admin-login');
  };

  return (
    <aside className={`admin-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <Link to="/admin" className="sidebar-brand">
          <span className="brand-text">Letter Archive</span>
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
        <button className="nav-item logout-btn" onClick={handleLogout}>
          <Icon name="logout" size={18} />
          <span className="nav-label">Logout</span>
        </button>
      </div>
    </aside>
  );
}
