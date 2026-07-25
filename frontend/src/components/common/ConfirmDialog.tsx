import { useCallback, useId, type ReactNode } from 'react';
import { Button } from './Button';
import { useAccessibleDialog } from './useAccessibleDialog';
import './Modal.css';

export interface ConfirmDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Dialog title */
  title: string;
  /** Dialog message/content */
  message: string | ReactNode;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Visual variant - affects confirm button color */
  variant?: 'default' | 'danger';
  /** Loading state for confirm button */
  loading?: boolean;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Callback when cancelled */
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const requestCancel = useCallback(() => {
    if (!loading) onCancel();
  }, [loading, onCancel]);
  const { dialogRef } = useAccessibleDialog({
    isOpen,
    onClose: requestCancel,
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={requestCancel}>
      <div
        ref={dialogRef}
        className="modal-content modal-sm confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="confirm-dialog-title">{title}</h2>
        <div id={descriptionId} className="confirm-dialog-message">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>
        <div className="confirm-dialog-actions">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
