import { useEffect, useRef } from 'react';
import { Icon } from '../../../components/common';
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

const TITLE_ID = 'analysis-regeneration-title';
const DESCRIPTION_ID = 'analysis-regeneration-description';
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const restoreFocus = (element: HTMLElement | null) => {
  if (element?.isConnected && !element.matches(':disabled')) {
    element.focus();
  }
};

export default function AnalysisRegenerationDialog({
  isOpen,
  sender,
  recipient,
  onSenderChange,
  onRecipientChange,
  onChoose,
  onClose,
}: AnalysisRegenerationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    openerRef.current = opener;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(
      dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    (focusable()[0] ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocus(opener);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const chooseAndRestore = async (
    choice: AnalysisRegenerationChoice,
  ) => {
    const opener = openerRef.current;
    const result = await onChoose(choice);
    if (!result.shouldRestoreFocus) return;

    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      const documentOwnsFocus = (
        !activeElement
        || activeElement === document.body
        || activeElement === document.documentElement
      );
      const anotherModalOwnsFocus = document.querySelector(
        '[aria-modal="true"]',
      );
      if (documentOwnsFocus && !anotherModalOwnsFocus) {
        restoreFocus(opener);
      }
    });
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
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={TITLE_ID}>Regenerate Analysis</h3>
        <p id={DESCRIPTION_ID}>
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
