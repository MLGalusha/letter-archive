import { useCallback, type ReactNode, type MouseEvent } from 'react';
import './Modal.css';

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Modal content */
  children: ReactNode;
  /** Footer actions (buttons) */
  actions?: ReactNode;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg';
  /** Whether clicking outside closes the modal */
  closeOnOverlayClick?: boolean;
  /** Show close button in header */
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  actions,
  size = 'md',
  closeOnOverlayClick = true,
  showCloseButton = true,
}: ModalProps) {
  const handleOverlayClick = useCallback((e: MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={`modal-content modal-${size}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 className="modal-title">{title}</h2>
            {subtitle && <span className="modal-subtitle">{subtitle}</span>}
          </div>
          {showCloseButton && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export default Modal;
