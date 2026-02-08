import { useRef, useEffect, type ReactNode } from 'react';
import './Dropdown.css';

/* ============================================================================
   Dropdown Container
   ============================================================================ */

export interface DropdownProps {
  /** The trigger element (usually a button) */
  trigger: ReactNode;
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Callback when dropdown should close */
  onClose: () => void;
  /** Dropdown content */
  children: ReactNode;
  /** Alignment relative to trigger */
  align?: 'left' | 'right' | 'center';
  /** Additional class name */
  className?: string;
}

export function Dropdown({
  trigger,
  isOpen,
  onClose,
  children,
  align = 'left',
  className = '',
}: DropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <div className={`dropdown-container ${className}`} ref={containerRef}>
      {trigger}
      {isOpen && (
        <div className={`dropdown-menu dropdown-align-${align}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   Dropdown Header
   ============================================================================ */

export interface DropdownHeaderProps {
  children: ReactNode;
}

export function DropdownHeader({ children }: DropdownHeaderProps) {
  return <div className="dropdown-header">{children}</div>;
}

/* ============================================================================
   Dropdown Item
   ============================================================================ */

export interface DropdownItemProps {
  /** Item title */
  title: string;
  /** Optional description */
  description?: string;
  /** Click handler */
  onClick: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Visual variant */
  variant?: 'default' | 'danger' | 'active';
}

export function DropdownItem({
  title,
  description,
  onClick,
  disabled = false,
  variant = 'default',
}: DropdownItemProps) {
  return (
    <button
      className={`dropdown-item dropdown-item-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="dropdown-item-title">{title}</span>
      {description && <span className="dropdown-item-desc">{description}</span>}
    </button>
  );
}

/* ============================================================================
   Dropdown Divider
   ============================================================================ */

export function DropdownDivider() {
  return <div className="dropdown-divider" />;
}

export default Dropdown;
