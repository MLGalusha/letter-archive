import { memo, type RefObject } from "react";
import { Icon, Dropdown, DropdownItem } from "../../../components/common";
import TagEditor from "../../../components/admin/TagEditor";
import TaggedText from "../../../components/admin/TaggedText";
import type { Letter, EmotionalTone, RelationshipType } from "../../../types/Letter";
import {
  EMOTIONAL_TONE_OPTIONS,
  METADATA_RELATIONSHIP_OPTIONS,
  PRIMARY_TOPIC_OPTIONS,
} from "../../../constants/enums";
import type { AutoSaveData } from "./useAutoSave";

interface MetadataSectionProps {
  letter: Letter;
  letterId: string;

  // Metadata form values
  sender: string;
  recipient: string;
  date: string;
  location: string;
  hook: string;
  description: string;
  emotionalTone: EmotionalTone | "";
  relationship: RelationshipType | "";
  primaryTopics: string[];
  topicsDropdownOpen: boolean;

  // Setter callbacks
  onSenderChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onHookChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onEmotionalToneChange: (value: EmotionalTone | "") => void;
  onRelationshipChange: (value: RelationshipType | "") => void;
  onPrimaryTopicsChange: (value: string[]) => void;
  onTopicsDropdownOpenChange: (value: boolean) => void;

  // Auto-save
  onTriggerAutoSave: (updates: AutoSaveData) => void;

  // Regenerate state
  regenerateState: string;
  identityUpdateState: "idle" | "pending" | "saving";
  identityUpdateSecondsRemaining: number;
  retagState: "idle" | "retagging" | "done";

  // Verification and generation handlers
  onVerifyMetadata: () => void;
  onConfirmTranscript: () => void;
  onRegenerateMetadata: () => void;
  confirmationReplayBlocked: boolean;
  // Metadata field click/double-click handlers
  onMetadataFieldClick: (e: React.MouseEvent) => void;
  onMetadataFieldDoubleClick: (e: React.MouseEvent) => void;

  // Metadata tooltip
  showMetadataTooltip: boolean;
  metadataTooltipPosition: { x: number; y: number };
  metadataTooltipRef: RefObject<HTMLDivElement | null>;

  // General state
  saving: boolean;
  showToast: (message: string, type: "success" | "error" | "info") => void;
}

const MetadataSection = memo(function MetadataSection({
  letter,
  sender,
  recipient,
  date,
  location,
  hook,
  description,
  emotionalTone,
  relationship,
  primaryTopics,
  topicsDropdownOpen,
  onSenderChange,
  onRecipientChange,
  onDateChange,
  onLocationChange,
  onHookChange,
  onDescriptionChange,
  onEmotionalToneChange,
  onRelationshipChange,
  onPrimaryTopicsChange,
  onTopicsDropdownOpenChange,
  onTriggerAutoSave,
  regenerateState,
  identityUpdateState,
  identityUpdateSecondsRemaining,
  retagState,
  onVerifyMetadata,
  onConfirmTranscript,
  onRegenerateMetadata,
  confirmationReplayBlocked,
  onMetadataFieldClick,
  onMetadataFieldDoubleClick,
  showMetadataTooltip,
  metadataTooltipPosition,
  metadataTooltipRef,
  saving,
}: MetadataSectionProps) {
  const metadataLocked = saving || letter.metadataContentStatus === "VERIFIED";
  const identityLocked = metadataLocked || identityUpdateState === "saving";
  const metadataQueued =
    letter.metadataJobStatus === "PENDING"
    && Boolean(letter.transcriptConfirmedAt);
  const metadataExtracting =
    letter.metadataJobStatus === "RUNNING"
    || (
      letter.metadataJobStatus === undefined
      && letter.workflowState === "METADATA_EXTRACTING"
    );
  const metadataEmpty = letter.metadataContentStatus === "EMPTY";
  const needsTranscriptConfirmation =
    metadataEmpty && !letter.transcriptConfirmedAt;
  const metadataActionLabel =
    regenerateState === "regenerating"
      ? metadataEmpty
        ? "Generating..."
        : "Regenerating..."
      : metadataQueued
        ? "Queued"
        : metadataExtracting
          ? "Extracting..."
          : needsTranscriptConfirmation
            ? "Generate"
            : metadataEmpty
              ? "Retry"
              : "Regenerate";
  const metadataActionWorking =
    regenerateState === "regenerating" || metadataExtracting;
  const updatePrimaryTopics = (nextTopics: string[]) => {
    onPrimaryTopicsChange(nextTopics);
    onTriggerAutoSave({
      primaryTopics: nextTopics.length > 0 ? nextTopics : null,
    });
  };

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
                  needsTranscriptConfirmation
                    ? onConfirmTranscript
                    : onRegenerateMetadata
                }
                disabled={
                  saving
                  || metadataQueued
                  || metadataActionWorking
                  || confirmationReplayBlocked
                }
                title={
                  metadataQueued
                    ? "Metadata extraction is queued"
                    : metadataExtracting
                      ? "Metadata extraction is already in progress"
                      : needsTranscriptConfirmation
                        ? "Generate metadata from transcript"
                        : metadataEmpty
                          ? "Retry metadata extraction"
                          : "Regenerate metadata from transcript"
                }
              >
                {metadataActionWorking ? (
                  <>
                    <Icon name="process" size={14} className="spinning" />
                    <span>{metadataActionLabel}</span>
                  </>
                ) : regenerateState === "done" ? (
                  <>
                    <Icon name="check" size={14} />
                    <span>Queued</span>
                  </>
                ) : (
                  <>
                    <Icon name="process" size={14} />
                    <span>{metadataActionLabel}</span>
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
        onClick={saving ? undefined : onMetadataFieldClick}
        onDoubleClick={saving ? undefined : onMetadataFieldDoubleClick}
      >
        <div className="form-row">
          <div className="form-group sender-border">
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
              readOnly={identityLocked}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
          </div>
          <div className="form-group recipient-border">
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
              readOnly={identityLocked}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
          </div>
        </div>

        {identityUpdateState !== "idle" ? (
          <div
            className={`retag-indicator ${identityUpdateState}`}
            aria-live="polite"
          >
            {identityUpdateState === "pending" ? (
              <>
                <Icon name="edit" size={14} />
                <span>
                  Updating in {identityUpdateSecondsRemaining}s...
                </span>
              </>
            ) : (
              <>
                <Icon name="process" size={14} className="spinning" />
                <span>Saving name...</span>
              </>
            )}
          </div>
        ) : retagState !== "idle" && (
          <div
            className={`retag-indicator ${retagState}`}
            aria-live="polite"
          >
            {retagState === "retagging" ? (
              <>
                <Icon name="process" size={14} className="spinning" />
                <span>Updating references...</span>
              </>
            ) : (
              <>
                <Icon name="check" size={14} />
                <span>References updated</span>
              </>
            )}
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              type="date"
              id="date"
              value={date}
              onChange={(e) => {
                onDateChange(e.target.value);
                onTriggerAutoSave({
                  extractedDate: e.target.value || null,
                });
              }}
              readOnly={metadataLocked}
              className={
                letter.metadataContentStatus === "VERIFIED"
                  ? "verified-field"
                  : ""
              }
            />
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
            readOnly={metadataLocked}
            className={
              letter.metadataContentStatus === "VERIFIED"
                ? "verified-field"
                : ""
            }
          />
        </div>

        <div className="form-group">
          <label htmlFor="hook">Hook</label>
          <TagEditor
            value={hook}
            onChange={(val) => {
              onHookChange(val);
              onTriggerAutoSave({ hook: val || null });
            }}
            placeholder="Short teaser to engage readers (shown in list view)"
            maxLength={150}
            singleLine
            readOnly={metadataLocked}
          />
          <span className="help-text">
            Max 150 characters - displayed on letter cards
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="description">Summary</label>
          <TagEditor
            value={description}
            onChange={(val) => {
              onDescriptionChange(val);
              onTriggerAutoSave({ summary: val || null });
            }}
            placeholder="Factual description of letter content (shown in detail view)"
            readOnly={metadataLocked}
            className="multi-line"
          />
        </div>


        {/* AI-Extracted Metadata Section */}
        <div className="ai-metadata-section">
          <div className="ai-fields">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="emotionalTone">Emotional Tone</label>
                <select
                  id="emotionalTone"
                  value={emotionalTone}
                  onChange={(e) => {
                    const nextTone = e.target.value as EmotionalTone | "";
                    onEmotionalToneChange(nextTone);
                    onTriggerAutoSave({
                      emotionalTone: nextTone || null,
                    });
                  }}
                  disabled={metadataLocked}
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
                  onChange={(e) => {
                    const nextRelationship = (
                      e.target.value as RelationshipType | ""
                    );
                    onRelationshipChange(nextRelationship);
                    onTriggerAutoSave({
                      senderRecipientRelationship:
                        nextRelationship || null,
                    });
                  }}
                  disabled={metadataLocked}
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
                        {!metadataLocked && (
                          <button
                            type="button"
                            className="topic-tag-remove"
                            onClick={() => {
                              updatePrimaryTopics(
                                primaryTopics.filter((t) => t !== topic),
                              );
                            }}
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
                {!metadataLocked && (
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
                            updatePrimaryTopics([...primaryTopics, topic]);
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
                            <cite>— <TaggedText text={quote.context} /></cite>
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
          ref={metadataTooltipRef}
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
});

MetadataSection.displayName = "MetadataSection";

export default MetadataSection;
