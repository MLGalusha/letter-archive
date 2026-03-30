import { useId } from "react";
import Icon from "../common/Icon";
import Modal from "../common/Modal";
import "./IdentityExtractionModal.css";

type IdentityExtractionMode = "extract" | "regenerate";

interface IdentityExtractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sender: string;
  recipient: string;
  onSenderChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  submitting?: boolean;
  mode?: IdentityExtractionMode;
  letterTitle?: string;
}

export default function IdentityExtractionModal({
  isOpen,
  onClose,
  onConfirm,
  sender,
  recipient,
  onSenderChange,
  onRecipientChange,
  submitting = false,
  mode = "extract",
  letterTitle,
}: IdentityExtractionModalProps) {
  const senderInputId = useId();
  const recipientInputId = useId();
  const isRegenerate = mode === "regenerate";
  const title = isRegenerate ? "Refresh Metadata" : "Generate Metadata";
  const subtitle = isRegenerate
    ? "Sender and recipient corrections are applied before summaries, relationships, and references are rebuilt."
    : "Sender and recipient hints improve how names, summaries, and quoted references are generated.";
  const confirmLabel = submitting
    ? isRegenerate
      ? "Refreshing..."
      : "Generating..."
    : isRegenerate
      ? "Refresh Metadata"
      : "Generate Metadata";

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title={title}
      subtitle={subtitle}
      size="md"
      closeOnOverlayClick={!submitting}
      showCloseButton={!submitting}
      actions={
        <div className="identity-extraction-actions">
          <button
            className="btn-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn-confirm"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Icon name="process" size={14} className="spinning" />
                <span>{confirmLabel}</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      }
    >
      <div className="identity-extraction-modal">
        <div className="identity-extraction-intro">
          <div className="identity-extraction-chip">
            <Icon name="person" size={14} />
            <span>{isRegenerate ? "Overwrite-ready" : "Optional but useful"}</span>
          </div>
          <p className="identity-extraction-heading">
            {letterTitle ? `"${letterTitle}"` : "This letter"} will treat these
            names as trusted guidance.
          </p>
          <p className="identity-extraction-copy">
            Leave either field blank if the transcript is unclear. Adding even
            one name usually makes the resulting metadata cleaner.
          </p>
        </div>

        <div className="identity-extraction-grid">
          <label className="identity-extraction-card" htmlFor={senderInputId}>
            <span className="identity-extraction-label">Sender</span>
            <span className="identity-extraction-note">
              The person writing the letter.
            </span>
            <input
              id={senderInputId}
              aria-label="Sender"
              type="text"
              value={sender}
              onChange={(event) => onSenderChange(event.target.value)}
              placeholder="Leave blank if unknown"
              className="identity-extraction-input"
            />
          </label>

          <label
            className="identity-extraction-card"
            htmlFor={recipientInputId}
          >
            <span className="identity-extraction-label">Recipient</span>
            <span className="identity-extraction-note">
              The person receiving the letter.
            </span>
            <input
              id={recipientInputId}
              aria-label="Recipient"
              type="text"
              value={recipient}
              onChange={(event) => onRecipientChange(event.target.value)}
              placeholder="Leave blank if unknown"
              className="identity-extraction-input"
            />
          </label>
        </div>

        <div className="identity-extraction-footnote">
          <Icon name="relationships" size={14} />
          <span>
            Better names improve hooks, relationship tags, notes, and quoted
            references downstream.
          </span>
        </div>
      </div>
    </Modal>
  );
}
