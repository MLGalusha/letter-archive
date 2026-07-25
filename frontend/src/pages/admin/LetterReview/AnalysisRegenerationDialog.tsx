import { useId } from 'react';
import { Icon } from '../../../components/common';
import { useAccessibleDialog } from '../../../components/common/useAccessibleDialog';
import type {
  AnalysisRegenerationChoice,
  AnalysisRegenerationChoiceResult,
} from './useAnalysisRegenerationWorkspace';
import './AnalysisRegenerationDialog.css';

interface AnalysisRegenerationDialogProps {
  isOpen: boolean;
  sender: string;
  recipient: string;
  onSenderChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  onChoose: (
    choice: AnalysisRegenerationChoice,
  ) => Promise<AnalysisRegenerationChoiceResult>;
  onClose: () => void;
}

export default function AnalysisRegenerationDialog({
  isOpen,
  sender,
  recipient,
  onSenderChange,
  onRecipientChange,
  onChoose,
  onClose,
}: AnalysisRegenerationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const {
    dialogRef,
    restoreFocusAfterUpdate,
    deferFocusRestore,
  } = useAccessibleDialog({ isOpen, onClose });

  if (!isOpen) return null;

  const chooseAndRestore = async (
    choice: AnalysisRegenerationChoice,
  ) => {
    deferFocusRestore();
    const result = await onChoose(choice);
    if (!result.shouldRestoreFocus) return;

    restoreFocusAfterUpdate();
  };

  return (
    <div
      className="confirm-dialog-overlay analysis-regeneration-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog regenerate-popup analysis-regeneration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>Regenerate Analysis</h3>
        <p id={descriptionId}>
          Choose what to regenerate. This will overwrite the existing data.
        </p>
        <div className="analysis-regeneration-fields">
          <div className="form-group">
            <label htmlFor="regen-sender">Sender</label>
            <input
              type="text"
              id="regen-sender"
              value={sender}
              onChange={(event) => onSenderChange(event.target.value)}
              placeholder="Leave blank if unknown"
            />
          </div>
          <div className="form-group">
            <label htmlFor="regen-recipient">Recipient</label>
            <input
              type="text"
              id="regen-recipient"
              value={recipient}
              onChange={(event) => onRecipientChange(event.target.value)}
              placeholder="Leave blank if unknown"
            />
          </div>
        </div>
        <div className="regenerate-options">
          <button
            type="button"
            className="btn-option"
            onClick={() => {
              void chooseAndRestore('metadata');
            }}
          >
            <Icon name="edit" size={16} />
            <span>Metadata Only</span>
          </button>
          <button
            type="button"
            className="btn-option"
            onClick={() => {
              void chooseAndRestore('entities');
            }}
          >
            <Icon name="person" size={16} />
            <span>Entities Only</span>
          </button>
          <button
            type="button"
            className="btn-option"
            onClick={() => {
              void chooseAndRestore('both');
            }}
          >
            <Icon name="process" size={16} />
            <span>Both</span>
          </button>
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
