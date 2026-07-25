import { useId } from 'react';
import { Icon } from '../../../components/common';
import { useAccessibleDialog } from '../../../components/common/useAccessibleDialog';

interface TranscriptionRegenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLetter: () => void | Promise<unknown>;
  onExtras?: () => void | Promise<unknown>;
  onBoth?: () => void | Promise<unknown>;
}

export default function TranscriptionRegenerationDialog({
  isOpen,
  onClose,
  onLetter,
  onExtras,
  onBoth,
}: TranscriptionRegenerationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const {
    dialogRef,
    deferFocusRestore,
    restoreFocusAfterUpdate,
  } = useAccessibleDialog({ isOpen, onClose });

  if (!isOpen) return null;

  const chooseAndRestore = async (
    choose: () => void | Promise<unknown>,
  ) => {
    deferFocusRestore();
    try {
      await choose();
    } finally {
      restoreFocusAfterUpdate();
    }
  };

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog regenerate-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>
          Regenerate Transcription
        </h3>
        <p id={descriptionId}>
          Choose what to regenerate. This will overwrite the existing
          content.
        </p>
        <div className="regenerate-options">
          <button
            type="button"
            className="btn-option"
            onClick={() => void chooseAndRestore(onLetter)}
          >
            <Icon name="file" size={16} />
            <span>Letter Transcript</span>
          </button>
          {onExtras ? (
            <button
              type="button"
              className="btn-option"
              onClick={() => void chooseAndRestore(onExtras)}
            >
              <Icon name="plus" size={16} />
              <span>Extra Content</span>
            </button>
          ) : null}
          {onBoth ? (
            <button
              type="button"
              className="btn-option"
              onClick={() => void chooseAndRestore(onBoth)}
            >
              <Icon name="process" size={16} />
              <span>Both</span>
            </button>
          ) : null}
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
