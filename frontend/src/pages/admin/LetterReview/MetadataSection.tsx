import type { RefObject } from "react";
import { Icon, Dropdown, DropdownItem } from "../../../components/common";
import type { Letter, EmotionalTone, RelationshipType } from "../../../types/Letter";
import {
  EMOTIONAL_TONE_OPTIONS,
  METADATA_RELATIONSHIP_OPTIONS,
  PRIMARY_TOPIC_OPTIONS,
} from "../../../constants/enums";

interface MetadataSectionProps {
  letter: Letter;
  letterId: string;

  // Metadata form values
  sender: string;
  recipient: string;
  date: string;
  dateConfidence: "exact" | "inferred" | "unknown";
  location: string;
  hook: string;
  description: string;
  emotionalTone: EmotionalTone | "";
  relationship: RelationshipType | "";
  primaryTopics: string[];
  topicsDropdownOpen: boolean;

  // Original AI-extracted values for change detection
  originalSender: string;
  originalRecipient: string;

  // Setter callbacks
  onSenderChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDateConfidenceChange: (value: "exact" | "inferred" | "unknown") => void;
  onLocationChange: (value: string) => void;
  onHookChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onEmotionalToneChange: (value: EmotionalTone | "") => void;
  onRelationshipChange: (value: RelationshipType | "") => void;
  onPrimaryTopicsChange: (value: string[]) => void;
  onTopicsDropdownOpenChange: (value: boolean) => void;

  // Auto-save
  onTriggerAutoSave: (updates: Record<string, unknown>) => void;

  // Refs
  hookRef: RefObject<HTMLTextAreaElement | null>;
  descriptionRef: RefObject<HTMLTextAreaElement | null>;

  // Regenerate state
  regenerateState: string;

  // Re-extraction state
  reExtractState: "idle" | "extracting" | "done";
  onReExtract: (mode: "full" | "metadata_only" | "entities_only") => void;

  // Verification and generation handlers
  onVerifyMetadata: () => void;
  onConfirmTranscript: () => void;
  onRegenerateMetadata: () => void;
  // Metadata field click/double-click handlers
  onMetadataFieldClick: (e: React.MouseEvent) => void;
  onMetadataFieldDoubleClick: (e: React.MouseEvent) => void;

  // Metadata tooltip
  showMetadataTooltip: boolean;
  metadataTooltipPosition: { x: number; y: number };

  // General state
  saving: boolean;
  showToast: (message: string, type: "success" | "error" | "info") => void;
}

export default function MetadataSection({
  letter,
  letterId: _letterId,
  sender,
  recipient,
  date,
  dateConfidence,
  location,
  hook,
  description,
  emotionalTone,
  relationship,
  primaryTopics,
  topicsDropdownOpen,
  originalSender,
  originalRecipient,
  onSenderChange,
  onRecipientChange,
  onDateChange,
  onDateConfidenceChange,
  onLocationChange,
  onHookChange,
  onDescriptionChange,
  onEmotionalToneChange,
  onRelationshipChange,
  onPrimaryTopicsChange,
  onTopicsDropdownOpenChange,
  onTriggerAutoSave,
  hookRef,
  descriptionRef,
  regenerateState,
  reExtractState,
  onReExtract,
  onVerifyMetadata,
  onConfirmTranscript,
  onRegenerateMetadata,
  onMetadataFieldClick,
  onMetadataFieldDoubleClick,
  showMetadataTooltip,
  metadataTooltipPosition,
  saving,
  showToast: _showToast,
}: MetadataSectionProps) {
  return (
    <div className="metadata-section">
      <div className="metadata-header">
        <h2>Metadata</h2>
        <div className="header-right">
          {/* Generate/Regenerate button - hidden when verified */}
          {letter.metadataContentStatus !== "VERIFIED" &&
            letter.transcript.fullText && (
              <button
                className={`action-btn generate-btn ${regenerateState !== "idle" ? regenerateState : ""}`}
                onClick={
                  letter.metadataContentStatus === "EMPTY"
                    ? onConfirmTranscript
                    : onRegenerateMetadata
                }
                disabled={saving || regenerateState === "regenerating"}
                title={
                  letter.metadataContentStatus === "EMPTY"
                    ? "Generate metadata from transcript"
                    : "Regenerate metadata from transcript"
                }
              >
                {regenerateState === "regenerating" ? (
                  <>
                    <Icon name="process" size={14} className="spinning" />
                    <span>Regenerating...</span>
                  </>
                ) : regenerateState === "done" ? (
                  <>
                    <Icon name="check" size={14} />
                    <span>Queued</span>
                  </>
                ) : (
                  <>
                    <Icon name="process" size={14} />
                    <span>
                      {letter.metadataContentStatus === "EMPTY"
                        ? "Generate"
                        : "Regenerate"}
                    </span>
                  </>
                )}
              </button>
            )}

          {/* Verification UI */}
          {letter.metadataContentStatus === "VERIFIED" ? (
            <div className="verified-info">
              <Icon name="check" size={14} />
              <span>
                Verified
                {letter.metadataVerifiedAt &&
                  ` on ${new Date(letter.metadataVerifiedAt).toLocaleDateString()}`}
              </span>
            </div>
          ) : (
            <button
              className="verify-btn"
              onClick={onVerifyMetadata}
              disabled={saving}
              title="Mark metadata verified"
            >
              Verify
            </button>
          )}
        </div>
      </div>
      <div
        className={`metadata-form ${letter.metadataContentStatus === "VERIFIED" ? "verified" : ""}`}
        onClick={onMetadataFieldClick}
        onDoubleClick={onMetadataFieldDoubleClick}
      >
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="sender">Sender</label>
            <input
              type="text"
              id="sender"
              value={sender}
              onChange={(e) => {
                onSenderChange(e.target.value);
                onTriggerAutoSave({ sender: e.target.value || null });
              }}
              placeholder="Who wrote the letter"
              readOnly={letter.metadataContentStatus === "VERIFIED"}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
          </div>
          <div className="form-group">
            <label htmlFor="recipient">Recipient</label>
            <input
              type="text"
              id="recipient"
              value={recipient}
              onChange={(e) => {
                onRecipientChange(e.target.value);
                onTriggerAutoSave({ recipient: e.target.value || null });
              }}
              placeholder="Who received the letter"
              readOnly={letter.metadataContentStatus === "VERIFIED"}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
          </div>
        </div>

        {/* Re-extraction notification bar — shown when sender or recipient has changed */}
        {letter.metadataContentStatus !== "VERIFIED" &&
          letter.metadataContentStatus !== "EMPTY" &&
          (sender.trim() !== originalSender.trim() ||
            recipient.trim() !== originalRecipient.trim()) && (
            <div className="re-extract-bar">
              <div className="re-extract-message">
                <Icon name="refresh" size={14} />
                <span>
                  {sender.trim() !== originalSender.trim() &&
                  recipient.trim() !== originalRecipient.trim()
                    ? "Sender and recipient have been changed."
                    : sender.trim() !== originalSender.trim()
                      ? "Sender has been changed."
                      : "Recipient has been changed."}
                  {" "}Re-extract metadata with the corrected{" "}
                  {sender.trim() !== originalSender.trim() &&
                  recipient.trim() !== originalRecipient.trim()
                    ? "identities"
                    : "identity"}?
                </span>
              </div>
              <div className="re-extract-actions">
                <button
                  className="re-extract-btn re-extract-btn-secondary"
                  disabled={saving || reExtractState === "extracting"}
                  title="Keep name changes without re-extracting metadata"
                >
                  Update Names Only
                </button>
                <button
                  className="re-extract-btn re-extract-btn-primary"
                  onClick={() => onReExtract("full")}
                  disabled={saving || reExtractState === "extracting"}
                  title="Re-extract all metadata using corrected sender/recipient"
                >
                  {reExtractState === "extracting" ? (
                    <>
                      <Icon name="process" size={14} className="spinning" />
                      <span>Extracting...</span>
                    </>
                  ) : reExtractState === "done" ? (
                    <>
                      <Icon name="check" size={14} />
                      <span>Done</span>
                    </>
                  ) : (
                    <>
                      <Icon name="refresh" size={14} />
                      <span>Re-extract with Corrections</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              type="text"
              id="date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              placeholder="e.g., March 15, 1920"
              readOnly={letter.metadataContentStatus === "VERIFIED"}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
          </div>
          <div className="form-group">
            <label htmlFor="dateConfidence">Date Confidence</label>
            <select
              id="dateConfidence"
              value={dateConfidence}
              onChange={(e) =>
                onDateConfidenceChange(
                  e.target.value as typeof dateConfidence,
                )
              }
              disabled={letter.metadataContentStatus === "VERIFIED"}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            >
              <option value="exact">Exact</option>
              <option value="inferred">Inferred</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="location">Location Written</label>
          <input
            type="text"
            id="location"
            value={location}
            onChange={(e) => {
              onLocationChange(e.target.value);
              onTriggerAutoSave({
                locationWritten: e.target.value || null,
              });
            }}
            placeholder="e.g., New York, NY"
            readOnly={letter.metadataContentStatus === "VERIFIED"}
            className={
              letter.metadataContentStatus === "VERIFIED"
                ? "verified-field"
                : ""
            }
          />
        </div>

        <div className="form-group">
          <label htmlFor="hook">Hook</label>
          <textarea
            ref={hookRef}
            id="hook"
            value={hook}
            onChange={(e) => {
              onHookChange(e.target.value);
              onTriggerAutoSave({ hook: e.target.value || null });
            }}
            placeholder="Short teaser to engage readers (shown in list view)"
            maxLength={150}
            readOnly={letter.metadataContentStatus === "VERIFIED"}
            className={
              letter.metadataContentStatus === "VERIFIED"
                ? "verified-field"
                : ""
            }
          />
          <span className="help-text">
            Max 150 characters - displayed on letter cards
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="description">Summary</label>
          <textarea
            ref={descriptionRef}
            id="description"
            value={description}
            onChange={(e) => {
              onDescriptionChange(e.target.value);
              onTriggerAutoSave({ summary: e.target.value || null });
            }}
            placeholder="Factual description of letter content (shown in detail view)"
            readOnly={letter.metadataContentStatus === "VERIFIED"}
            className={
              letter.metadataContentStatus === "VERIFIED"
                ? "verified-field"
                : ""
            }
          />
        </div>


        {/* AI-Extracted Metadata Section */}
        <div className="v2-metadata-section">
          <div className="v2-fields">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="emotionalTone">Emotional Tone</label>
                <select
                  id="emotionalTone"
                  value={emotionalTone}
                  onChange={(e) =>
                    onEmotionalToneChange(
                      e.target.value as EmotionalTone | "",
                    )
                  }
                  disabled={
                    letter.metadataContentStatus === "VERIFIED"
                  }
                  className={
                    letter.metadataContentStatus === "VERIFIED"
                      ? "verified-field"
                      : ""
                  }
                >
                  <option value="">— Select —</option>
                  {EMOTIONAL_TONE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="relationship">Relationship</label>
                <select
                  id="relationship"
                  value={relationship}
                  onChange={(e) =>
                    onRelationshipChange(
                      e.target.value as RelationshipType | "",
                    )
                  }
                  disabled={
                    letter.metadataContentStatus === "VERIFIED"
                  }
                  className={
                    letter.metadataContentStatus === "VERIFIED"
                      ? "verified-field"
                      : ""
                  }
                >
                  <option value="">— Select —</option>
                  {METADATA_RELATIONSHIP_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Primary Topics</label>
              <div className="topics-display">
                {primaryTopics.length > 0 ? (
                  <div className="topic-tags">
                    {primaryTopics.map((topic) => (
                      <span key={topic} className="topic-tag">
                        {topic.replace("/", " / ")}
                        {letter.metadataContentStatus !== "VERIFIED" && (
                          <button
                            type="button"
                            className="topic-tag-remove"
                            onClick={() => onPrimaryTopicsChange(primaryTopics.filter((t) => t !== topic))}
                            title="Remove topic"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="no-topics">No topics selected</span>
                )}
                {letter.metadataContentStatus !== "VERIFIED" && (
                  <Dropdown
                    trigger={
                      <button
                        type="button"
                        className="add-topic-btn"
                        onClick={() => onTopicsDropdownOpenChange(!topicsDropdownOpen)}
                      >
                        <Icon name="plus" size={14} />
                        Add Topic
                      </button>
                    }
                    isOpen={topicsDropdownOpen}
                    onClose={() => onTopicsDropdownOpenChange(false)}
                    align="left"
                  >
                    <div className="topics-dropdown-content">
                      {PRIMARY_TOPIC_OPTIONS.filter((t) => !primaryTopics.includes(t)).map((topic) => (
                        <DropdownItem
                          key={topic}
                          title={topic.replace("/", " / ")}
                          onClick={() => {
                            onPrimaryTopicsChange([...primaryTopics, topic]);
                            onTopicsDropdownOpenChange(false);
                          }}
                        />
                      ))}
                      {PRIMARY_TOPIC_OPTIONS.filter((t) => !primaryTopics.includes(t)).length === 0 && (
                        <div className="dropdown-empty">All topics selected</div>
                      )}
                    </div>
                  </Dropdown>
                )}
              </div>
            </div>

            {/* Notable Quotes (read-only display) - at the bottom */}
            {letter.metadata.notableQuotes &&
              letter.metadata.notableQuotes.length > 0 && (
                <div className="form-group">
                  <label>Notable Quotes</label>
                  <div className="notable-quotes">
                    {letter.metadata.notableQuotes.map(
                      (quote, idx) => (
                        <blockquote
                          key={idx}
                          className="notable-quote"
                        >
                          <p>"{quote.text}"</p>
                          {quote.context && (
                            <cite>— {quote.context}</cite>
                          )}
                        </blockquote>
                      ),
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Metadata double-click tooltip */}
      {showMetadataTooltip && (
        <div
          className="field-tooltip"
          style={{
            left: Math.min(
              metadataTooltipPosition.x,
              window.innerWidth - 280,
            ),
            top: metadataTooltipPosition.y + 10,
          }}
        >
          Verified. Double-click to edit.
        </div>
      )}
    </div>
  );
}
