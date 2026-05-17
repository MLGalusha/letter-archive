import { Button } from "../../../components/common";

interface ProcessingConfirmDialogProps {
  title: string;
  selectedCount: number;
  existingCount: number;
  existingSingularText: string;
  existingPluralText: string;
  emptyActionText: string;
  confirmText: string;
  skipActionText: string;
  overwriteActionText: string;
  onCancel: () => void;
  onConfirm: () => void;
  onSkipExisting: () => void;
  onOverwriteAll: () => void;
}

export default function ProcessingConfirmDialog({
  title,
  selectedCount,
  existingCount,
  existingSingularText,
  existingPluralText,
  emptyActionText,
  confirmText,
  skipActionText,
  overwriteActionText,
  onCancel,
  onConfirm,
  onSkipExisting,
  onOverwriteAll,
}: ProcessingConfirmDialogProps) {
  const hasSelected = selectedCount > 0;
  const hasExisting = existingCount > 0 && hasSelected;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog-message">
          {hasExisting ? (
            <p>
              {existingCount} of {selectedCount} selected letter{selectedCount === 1 ? "" : "s"} already
              {existingCount === 1 ? ` has ${existingSingularText}` : ` have ${existingPluralText}`}.
              Would you like to overwrite existing {existingPluralText} or skip them?
            </p>
          ) : (
            <p>
              {emptyActionText} {hasSelected ? `${selectedCount} selected` : "all"} letter{selectedCount === 1 ? "" : "s"}?
            </p>
          )}
        </div>
        <div className="confirm-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          {hasExisting ? (
            <>
              <Button variant="secondary" onClick={onSkipExisting}>
                {skipActionText} ({selectedCount - existingCount})
              </Button>
              <Button variant="primary" onClick={onOverwriteAll}>
                {overwriteActionText} ({selectedCount})
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onConfirm}>
              {confirmText}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
