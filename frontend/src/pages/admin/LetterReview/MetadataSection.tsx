import type { RefObject } from "react";
import { getErrorMessage } from "../../../api/client";
import { Icon, Dropdown, DropdownItem } from "../../../components/common";
import EditableEntityItem from "./EditableEntityItem";
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

  // Auto-save and sync
  onTriggerAutoSave: (updates: Record<string, unknown>) => void;
  onStartSyncTimer: () => void;

  // Refs
  hookRef: RefObject<HTMLTextAreaElement | null>;
  descriptionRef: RefObject<HTMLTextAreaElement | null>;

  // Sync/regenerate state
  syncState: string;
  syncMessage: string | null;
  syncCountdown: number | null;
  showCancelHint: boolean;
  regenerateState: string;

  // Sync handlers
  onAISync: () => void;
  onCountdownClick: () => void;
  onCountdownDoubleClick: () => void;

  // Verification and generation handlers
  onVerifyMetadata: () => void;
  onConfirmTranscript: () => void;
  onRegenerateMetadata: () => void;
  onRegenerateEntities: () => Promise<void>;

  // Metadata field click/double-click handlers
  onMetadataFieldClick: (e: React.MouseEvent) => void;
  onMetadataFieldDoubleClick: (e: React.MouseEvent) => void;

  // Metadata tooltip
  showMetadataTooltip: boolean;
  metadataTooltipPosition: { x: number; y: number };

  // Entity handlers
  onUpdateLinkedPerson: (personId: string, newName: string) => Promise<Letter>;
  onUpdateLinkedPlace: (placeId: string, newName: string) => Promise<Letter>;
  onRemoveLinkedPerson: (personId: string) => Promise<Letter>;
  onRemoveLinkedPlace: (placeId: string) => Promise<Letter>;
  onSetLetter: (letter: Letter) => void;

  // Add entity modals
  onShowAddPersonModal: (show: boolean) => void;
  onShowAddPlaceModal: (show: boolean) => void;
  onOpenLinkedPerson: (personId: string) => void;
  onOpenLinkedPlace: (placeId: string) => void;

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
  onStartSyncTimer,
  hookRef,
  descriptionRef,
  syncState,
  syncMessage,
  syncCountdown,
  showCancelHint,
  regenerateState,
  onAISync,
  onCountdownClick,
  onCountdownDoubleClick,
  onVerifyMetadata,
  onConfirmTranscript,
  onRegenerateMetadata,
  onRegenerateEntities,
  onMetadataFieldClick,
  onMetadataFieldDoubleClick,
  showMetadataTooltip,
  metadataTooltipPosition,
  onUpdateLinkedPerson,
  onUpdateLinkedPlace,
  onRemoveLinkedPerson,
  onRemoveLinkedPlace,
  onSetLetter,
  onShowAddPersonModal,
  onShowAddPlaceModal,
  onOpenLinkedPerson,
  onOpenLinkedPlace,
  saving,
  showToast,
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

          {/* Sync button - hidden when verified or empty */}
          {letter.metadataContentStatus !== "EMPTY" &&
            letter.metadataContentStatus !== "VERIFIED" && (
              <button
                className={`action-btn sync-btn ${syncState !== "idle" ? syncState : ""} ${syncCountdown !== null && syncState === "idle" ? "has-countdown" : ""}`}
                onClick={onAISync}
                onDoubleClick={syncCountdown !== null && syncState === "idle" ? onCountdownDoubleClick : undefined}
                onMouseEnter={syncCountdown !== null && syncState === "idle" ? onCountdownClick : undefined}
                onFocus={syncCountdown !== null && syncState === "idle" ? onCountdownClick : undefined}
                disabled={
                  saving ||
                  (syncState !== "idle" && syncCountdown === null) ||
                  !letter.transcript.fullText
                }
                title={syncCountdown !== null && syncState === "idle"
                  ? "Click to sync now, double-click to cancel"
                  : "Sync metadata with identity changes"
                }
              >
                {syncState === "checking" ||
                syncState === "updating" ? (
                  <>
                    <Icon
                      name="process"
                      size={14}
                      className="spinning"
                    />
                    <span>Syncing...</span>
                  </>
                ) : syncState === "done" ? (
                  <>
                    <Icon name="check" size={14} />
                    <span>Synced</span>
                  </>
                ) : syncCountdown !== null ? (
                  <>
                    <Icon name="process" size={14} />
                    <span className="sync-countdown-text">
                      {Math.floor(syncCountdown / 60)}:{String(syncCountdown % 60).padStart(2, "0")}
                    </span>
                    {showCancelHint && (
                      <span className="cancel-hint">
                        Double-click to cancel
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Icon name="process" size={14} />
                    <span>Sync</span>
                  </>
                )}
              </button>
            )}

          {/* AI sync status indicator */}
          {syncMessage && (
            <span className={`sync-status-indicator ${syncState}`}>
              {syncState === "checking" && (
                <Icon name="process" size={14} className="spinning" />
              )}
              {syncState === "updating" && (
                <Icon name="process" size={14} className="spinning" />
              )}
              {syncState === "done" && <Icon name="check" size={14} />}
              <span>{syncMessage}</span>
            </span>
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
                onStartSyncTimer();
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
                onStartSyncTimer();
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

            {/* Linked Entities Section */}
            <div className="linked-entities">
              <div className="entity-extraction-status" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Entity extraction:{" "}
                  <span style={{
                    color: letter.entityExtractionStatus === "SUCCESS" ? "var(--green, #22c55e)"
                      : letter.entityExtractionStatus === "FAILED" ? "var(--red, #ef4444)"
                      : letter.entityExtractionStatus === "RUNNING" ? "var(--blue, #3b82f6)"
                      : "var(--text-muted)",
                    fontWeight: 600,
                  }}>
                    {letter.entityExtractionStatus || "PENDING"}
                  </span>
                  {letter.entityExtractionError && (
                    <span title={letter.entityExtractionError} style={{ color: "var(--red, #ef4444)", marginLeft: "4px" }}> (error)</span>
                  )}
                </span>
                <button
                  type="button"
                  className="add-entity-btn"
                  onClick={async () => {
                    try {
                      showToast("Re-extracting entities...", "info");
                      await onRegenerateEntities();
                    } catch (err) {
                      showToast(getErrorMessage(err, "Failed to re-extract entities"), "error");
                    }
                  }}
                  title="Re-run entity extraction (Prompt 2)"
                  disabled={letter.entityExtractionStatus === "RUNNING"}
                  style={{ fontSize: "11px" }}
                >
                  Re-extract
                </button>
              </div>
              <div className="entity-group">
                <div className="entity-group-header">
                  <label>Linked People</label>
                  {letter.metadataContentStatus !== "VERIFIED" && (
                    <button
                      type="button"
                      className="add-entity-btn"
                      onClick={() => onShowAddPersonModal(true)}
                      title="Add a person"
                    >
                      <Icon name="plus" size={12} />
                      Add
                    </button>
                  )}
                </div>
                <div className="entity-list">
                  {letter.linkedPersons && letter.linkedPersons.length > 0 ? (
                    letter.linkedPersons.map((lp) => (
                      <EditableEntityItem
                        key={lp.id}
                        id={lp.id}
                        name={lp.canonicalName}
                        role={lp.role}
                        confidence={lp.confidence}
                        isVerified={letter.metadataContentStatus === "VERIFIED"}
                        onOpenEntity={() => onOpenLinkedPerson(lp.personId)}
                        openEntityLabel={`Open ${lp.canonicalName} in People`}
                        onSave={async (newName) => {
                          const updated = await onUpdateLinkedPerson(lp.id, newName);
                          onSetLetter(updated);
                          showToast("Person name updated", "success");
                        }}
                        onRemove={async () => {
                          const updated = await onRemoveLinkedPerson(lp.id);
                          onSetLetter(updated);
                          showToast("Person removed", "success");
                        }}
                      />
                    ))
                  ) : (
                    <span className="no-entities">No people linked</span>
                  )}
                </div>
              </div>
              <div className="entity-group">
                <div className="entity-group-header">
                  <label>Linked Places</label>
                  {letter.metadataContentStatus !== "VERIFIED" && (
                    <button
                      type="button"
                      className="add-entity-btn"
                      onClick={() => onShowAddPlaceModal(true)}
                      title="Add a place"
                    >
                      <Icon name="plus" size={12} />
                      Add
                    </button>
                  )}
                </div>
                <div className="entity-list">
                  {letter.linkedPlaces && letter.linkedPlaces.length > 0 ? (
                    letter.linkedPlaces.map((lpl) => (
                      <EditableEntityItem
                        key={lpl.id}
                        id={lpl.id}
                        name={lpl.canonicalName}
                        role={lpl.role}
                        confidence={lpl.confidence}
                        isVerified={letter.metadataContentStatus === "VERIFIED"}
                        onOpenEntity={() => onOpenLinkedPlace(lpl.placeId)}
                        openEntityLabel={`Open ${lpl.canonicalName} in Places`}
                        onSave={async (newName) => {
                          const updated = await onUpdateLinkedPlace(lpl.id, newName);
                          onSetLetter(updated);
                          showToast("Place name updated", "success");
                        }}
                        onRemove={async () => {
                          const updated = await onRemoveLinkedPlace(lpl.id);
                          onSetLetter(updated);
                          showToast("Place removed", "success");
                        }}
                      />
                    ))
                  ) : (
                    <span className="no-entities">No places linked</span>
                  )}
                </div>
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
