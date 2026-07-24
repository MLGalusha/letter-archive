import { Button } from "../../../components/common";

interface ProcessingConfirmDialogProps {
  title: string;
  message: string;
  confirmText: string;
  alternateText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  onAlternate?: () => void;
}

export default function ProcessingConfirmDialog({
  title,
  message,
  confirmText,
  alternateText,
  onCancel,
  onConfirm,
  onAlternate,
}: ProcessingConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog-message">
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          {alternateText && onAlternate && (
            <Button variant="secondary" onClick={onAlternate}>
              {alternateText}
            </Button>
          )}
          <Button variant="primary" onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
