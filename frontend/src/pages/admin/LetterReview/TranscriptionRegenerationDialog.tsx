import { Icon } from '../../../components/common';

interface TranscriptionRegenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLetter: () => void;
  onExtras?: () => void;
  onBoth?: () => void;
}

export default function TranscriptionRegenerationDialog({
  isOpen,
  onClose,
  onLetter,
  onExtras,
  onBoth,
}: TranscriptionRegenerationDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={onClose}
    >
      <div
        className="confirm-dialog regenerate-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcription-regeneration-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="transcription-regeneration-title">
          Regenerate Transcription
        </h3>
        <p>
          Choose what to regenerate. This will overwrite the existing
          content.
        </p>
        <div className="regenerate-options">
          <button
            type="button"
            className="btn-option"
            onClick={onLetter}
          >
            <Icon name="file" size={16} />
            <span>Letter Transcript</span>
          </button>
          {onExtras ? (
            <button
              type="button"
              className="btn-option"
              onClick={onExtras}
            >
              <Icon name="plus" size={16} />
              <span>Extra Content</span>
            </button>
          ) : null}
          {onBoth ? (
            <button
              type="button"
              className="btn-option"
              onClick={onBoth}
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
