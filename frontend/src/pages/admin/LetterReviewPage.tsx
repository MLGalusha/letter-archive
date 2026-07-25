import {
  startTransition,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import { updateLetter } from "../../api/admin";
import { toggleLetterFlag } from "../../api/admin/letters";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import AdminLayout from "../../components/AdminLayout";
import { useToast } from "../../contexts/ToastContext";
import {
  Icon,
  WorkflowBadge,
  ResizableSplitPane,
  Dropdown,
  DropdownItem,
} from "../../components/common";
import type { Letter, VisibilityState } from "../../types/Letter";
import {
  hasPrimaryTranscriptContent,
  hasRelatedExtraContent,
  shouldShowPhotoDescriptionWorkflow,
  shouldShowMetadataWorkflow,
} from "../../utils/letterContent";
import TranscriptionSection from "./LetterReview/TranscriptionSection";
import { ExtraContentSection } from "./LetterReview/ExtraContentSection";
import { PhotoDescriptionSection } from "./LetterReview/PhotoDescriptionSection";
import { PhotoDescriptionContextModal } from "./LetterReview/PhotoDescriptionContextModal";
import MetadataSection from "./LetterReview/MetadataSection";
import EntitySection from "./LetterReview/EntitySection";
import NotesSection from "./LetterReview/NotesSection";
import {
  type AutoSaveData,
  useAutoSave,
} from "./LetterReview/useAutoSave";
import { useMetadataFormState } from "./LetterReview/useMetadataFormState";
import { useMetadataVerificationActions } from "./LetterReview/useMetadataVerificationActions";
import { useTranscriptEditing } from "./LetterReview/useTranscriptEditing";
import { useLetterSourceConflict } from "./LetterReview/useLetterSourceConflict";
import { useGuardedLetterState } from "./LetterReview/useGuardedLetterState";
import { useLetterSavingState } from "./LetterReview/useLetterSavingState";
import { useLetterReviewVisit } from "./LetterReview/useLetterReviewVisit";
import { useLetterReviewMutationExecutor } from "./LetterReview/useLetterReviewMutationExecutor";
import { useLetterReviewStatusResets } from "./LetterReview/useLetterReviewStatusResets";
import { useStructuredNoteActions } from "./LetterReview/useStructuredNoteActions";
import { usePhotoDescriptionWorkspace } from "./LetterReview/usePhotoDescriptionWorkspace";
import { useExtraContentWorkspace } from "./LetterReview/useExtraContentWorkspace";
import { useReadingViewWorkspace } from "./LetterReview/useReadingViewWorkspace";
import { useLetterTranscriptionWorkspace } from "./LetterReview/useLetterTranscriptionWorkspace";
import { useLineReviewWorkspace } from "./LetterReview/useLineReviewWorkspace";
import { useAnalysisRegenerationWorkspace } from "./LetterReview/useAnalysisRegenerationWorkspace";
import { useTranscriptConfirmationWorkspace } from "./LetterReview/useTranscriptConfirmationWorkspace";
import TranscriptionRegenerationDialog from "./LetterReview/TranscriptionRegenerationDialog";
import AnalysisRegenerationDialog from "./LetterReview/AnalysisRegenerationDialog";
import { loadCurrentLetter } from "./LetterReview/loadCurrentLetter";
import { usePretextFontSize } from "../../hooks/usePretextFontSize";
import LineReviewMode from "../../components/LineReviewMode/LineReviewMode";
import IdentityExtractionModal from "../../components/admin/IdentityExtractionModal";
import "./LetterReviewPage.css";

export default function LetterReviewPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const visit = useLetterReviewVisit(letterId);
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const {
    handleMutationError,
    isMutationBlocked,
    markSourceConflict,
    mutationsBlocked,
    sourceConflict,
  } = useLetterSourceConflict(showToast, visit);
  const {
    letter,
    setAuthoritativeLetter,
    tryAdoptLetter,
  } = useGuardedLetterState(markSourceConflict, visit);

  const [transcript, setTranscript] = useState("");

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const { saving, beginSaving } = useLetterSavingState(visit);
  const [message, setMessage] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);

  const transcriptFontSize = usePretextFontSize(
    editorRef,
    transcript,
    { fontFamily: "Georgia, 'Times New Roman', serif" },
  );
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const {
    applyLetterMetadata,
    date,
    description,
    emotionalTone,
    hook,
    location,
    notes,
    primaryTopics,
    recipient,
    relationship,
    sender,
    setDate,
    setDescription,
    setEmotionalTone,
    setHook,
    setLocation,
    setNotes,
    setPrimaryTopics,
    setRecipient,
    setRelationship,
    setSender,
    setTopicsDropdownOpen,
    syncIdentityMetadata,
    topicsDropdownOpen,
  } = useMetadataFormState();
  const {
    autoSaveStatus,
    flushPendingSaves,
    identityUpdateSecondsRemaining,
    identityUpdateState,
    retagState,
    scheduleDebouncedSave,
    triggerAutoSave,
  } = useAutoSave({
    visit,
    letter,
    tryAdoptLetter,
    handleMutationError,
    isMutationBlocked,
    mutationsBlocked,
    syncIdentityMetadata,
  });
  const scheduleStatusReset = useLetterReviewStatusResets(visit);
  const photoDescriptionWorkspace = usePhotoDescriptionWorkspace({
    visit,
    letter,
    saving,
    beginSaving,
    tryAdoptLetter,
    scheduleDebouncedSave,
    flushPendingSaves,
    handleMutationError,
  });
  const hydratePhotoDescription =
    photoDescriptionWorkspace.hydratePersistedLetter;
  const {
    editTooltipRef,
    handleTranscriptClick,
    handleTranscriptDoubleClick,
    handleTranscriptInput,
    handleTranscriptRevert,
    handleVerifyTranscript,
    hasTranscriptChanges,
    isTranscriptEditing,
    showEditTooltip,
    tooltipPosition,
  } = useTranscriptEditing({
    visit,
    letterId,
    letter,
    transcript,
    tryAdoptLetter,
    beginSaving,
    flushPendingSaves,
    setTranscript,
    handleMutationError,
    showToast,
    triggerAutoSave,
  });
  const hydrateAdoptedLetter = useCallback((updatedLetter: Letter) => {
    setTranscript(updatedLetter.transcript.fullText);
    applyLetterMetadata(updatedLetter);
    hydratePhotoDescription(updatedLetter);
  }, [
    applyLetterMetadata,
    hydratePhotoDescription,
  ]);
  const executeLetterMutation = useLetterReviewMutationExecutor({
    visit,
    beginSaving,
    flushPendingSaves,
    tryAdoptLetter,
    hydrateAdoptedLetter,
    handleMutationError,
  });
  const {
    handleMetadataFieldClick,
    handleMetadataFieldDoubleClick,
    handleVerifyMetadata,
    metadataTooltipPosition,
    metadataTooltipRef,
    showMetadataTooltip,
  } = useMetadataVerificationActions({
    visit,
    letter,
    executeLetterMutation,
    showToast,
  });
  const letterTranscriptionWorkspace = useLetterTranscriptionWorkspace({
    visit,
    letter,
    transcriptText: transcript,
    executeLetterMutation,
    scheduleStatusReset,
  });
  const analysisRegenerationWorkspace = useAnalysisRegenerationWorkspace({
    visit,
    letter,
    sender,
    recipient,
    executeLetterMutation,
    scheduleStatusReset,
  });
  const transcriptConfirmationWorkspace =
    useTranscriptConfirmationWorkspace({
      visit,
      letter,
      transcriptText: transcript,
      sender,
      recipient,
      executeLetterMutation,
    });
  const extraContentWorkspace = useExtraContentWorkspace({
    visit,
    letter,
    saving,
    scheduleDebouncedSave,
    tryAdoptLetter,
    executeLetterMutation,
  });
  const {
    active: lineReviewActive,
    currentFilename: lineReviewCurrentFilename,
    headerControls: lineReviewHeaderControls,
    mappingControls: lineReviewMappingControls,
    modeProps: lineReviewModeProps,
    modeRef: lineReviewModeRef,
    selectedText: lineReviewSelectedText,
    viewerProps: lineReviewViewerProps,
  } = useLineReviewWorkspace({
    visit,
    letter,
    editorRef,
    isTranscriptEditing,
    lineReviewBlocked: extraContentWorkspace.lineReviewBlocked,
    tryAdoptLetter,
    onTranscriptChange: setTranscript,
    onAutoSave: triggerAutoSave,
  });
  const readingViewWorkspace = useReadingViewWorkspace({
    visit,
    letter,
    transcriptText: transcript,
    surfaceActive: !lineReviewActive,
    executeLetterMutation,
  });
  const {
    handleAddNote,
    handleNoteStatusChange,
  } = useStructuredNoteActions({
    letter,
    executeLetterMutation,
    showToast,
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
      return;
    }

    if (letterId) {
      let requestIsCurrent = true;
      const requestedLetterId = letterId;
      async function fetchLetter() {
        setLoading(true);
        try {
          await loadCurrentLetter({
            requestedLetterId,
            isCurrent: () => requestIsCurrent,
            getLetter: getAdminLetterById,
            adoptAndHydrate: (foundLetter) => {
              setAuthoritativeLetter(foundLetter);
              setTranscript(foundLetter.transcript.fullText);
              applyLetterMetadata(foundLetter);
            },
          });
        } catch (err) {
          if (!requestIsCurrent) return;
          setMessage(err instanceof Error ? err.message : "Letter not found");
          console.error("Failed to fetch letter:", err);
        } finally {
          if (requestIsCurrent) setLoading(false);
        }
      }
      void fetchLetter();
      return () => {
        requestIsCurrent = false;
      };
    }
  }, [applyLetterMetadata, letterId, navigate, setAuthoritativeLetter]);

  useEffect(() => {
    if (!letter || !routeLocation.hash) return;

    const sectionId = routeLocation.hash.slice(1);
    const frameId = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [letter, routeLocation.hash]);

  // Auto-resize textareas to fit content
  const autoResizeTextarea = (textarea: HTMLTextAreaElement | null, minHeight = 80) => {
    if (!textarea) return;
    // Grow to fit content but never shrink below minHeight.
    // Avoid setting height to "auto" which causes a momentary collapse
    // and scroll jump when the user is scrolled down.
    const needed = Math.max(textarea.scrollHeight, minHeight);
    if (Math.abs(textarea.offsetHeight - needed) > 1) {
      textarea.style.height = needed + "px";
    }
  };

  useEffect(() => autoResizeTextarea(notesRef.current), [notes]);

  const handleVisibilityChange = useCallback(async (newVisibility: VisibilityState) => {
    if (!letterId || !letter) return;
    if (letter.visibility === newVisibility) return;

    await executeLetterMutation({
      request: () => updateLetter(letterId, {
        primarySourceRevision: letter.primarySourceRevision,
        visibility: newVisibility,
      }),
      failureMessage: "Failed to update visibility",
      afterAdopt: () => {
        showToast(
          newVisibility === "PUBLISHED" ? "Letter published" : "Letter hidden",
          "success",
        );
      },
    });
  }, [
    executeLetterMutation,
    letter,
    letterId,
    showToast,
  ]);

  const handleContentPublishToggle = useCallback(async (
    field: 'transcriptPublished' | 'metadataPublished',
    value: boolean,
  ) => {
    if (!letterId || !letter) return;
    await executeLetterMutation({
      request: () => updateLetter(letterId, {
        primarySourceRevision: letter.primarySourceRevision,
        [field]: value,
      }),
      failureMessage: 'Failed to update content visibility',
      afterAdopt: () => {
        const label =
          field === 'transcriptPublished' ? 'Transcript' : 'Metadata';
        showToast(`${label} ${value ? 'published' : 'hidden'}`, 'success');
      },
    });
  }, [
    executeLetterMutation,
    letter,
    letterId,
    showToast,
  ]);

  const handleDelete = useCallback(async () => {
    if (!letterId || !letter) return;
    const primarySourceRevision = letter.primarySourceRevision;
    if (!window.confirm("Are you sure you want to delete this letter?")) {
      return;
    }

    const releaseSaving = beginSaving();

    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      await deleteLetter(letterId, primarySourceRevision);
      if (!visit.isActive()) return;
      showToast("Letter deleted", "success");
      setTimeout(() => {
        if (visit.isActive()) navigate("/admin");
      }, 1500);
    } catch (err) {
      handleMutationError(err, "Failed to delete");
      console.error("Delete error:", err);
    } finally {
      releaseSaving();
    }
  }, [
    beginSaving,
    flushPendingSaves,
    handleMutationError,
    letter,
    letterId,
    navigate,
    showToast,
    visit,
  ]);

  const handleFlagToggle = useCallback(async () => {
    if (!letter) return;
    const newFlagged = !letter.flagged;
    await executeLetterMutation({
      request: () => toggleLetterFlag(letter.id, newFlagged),
      failureMessage:
        `Failed to ${newFlagged ? 'flag' : 'unflag'} letter`,
    });
  }, [
    executeLetterMutation,
    letter,
  ]);

  const handleMetadataAutoSave = useCallback((updates: AutoSaveData) => {
    void triggerAutoSave(updates);
  }, [triggerAutoSave]);

  const handlePersonalNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    startTransition(() => {
      setNotes(nextValue);
    });
    void triggerAutoSave({ notes: nextValue || null });
  }, [triggerAutoSave, setNotes]);

  if (loading || !letter) {
    return (
      <AdminLayout fullHeight>
        <div className="letter-review-page">
          <div className="review-content loading-content">
            <p>{message || (loading ? "Loading..." : "Letter not found")}</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const showTranscriptSection = hasPrimaryTranscriptContent(letter);
  const showPhotoDescriptionSection = shouldShowPhotoDescriptionWorkflow(letter);
  const hasExtras = hasRelatedExtraContent(letter);
  const showMetadataSections = shouldShowMetadataWorkflow(letter);

  const headerActions = (
    <>
      <div className="auto-save-indicator">
        {autoSaveStatus === "saving" && (
          <span className="save-status saving">Saving...</span>
        )}
        {autoSaveStatus === "saved" && (
          <span className="save-status saved">Saved</span>
        )}
        {autoSaveStatus === "error" && (
          <span className="save-status error">Save failed</span>
        )}
      </div>
      <div className="header-actions">
        <button
          className={`header-action flag ${letter.flagged ? "active" : ""}`}
          onClick={() => void handleFlagToggle()}
          disabled={saving}
          data-tooltip={letter.flagged ? "Unflag" : "Flag for follow-up"}
        >
          <Icon name={letter.flagged ? "flag-filled" : "flag"} size={18} />
        </button>
        {/* Confirm button - only for TRANSCRIBED without confirmation */}
        {letter.workflowState === "TRANSCRIBED" &&
          !letter.transcriptConfirmedAt &&
          !transcriptConfirmationWorkspace.replayBlocked && (
            <button
              className="header-action confirm"
              onClick={transcriptConfirmationWorkspace.openDialog}
              disabled={saving}
              data-tooltip="Confirm Transcript"
            >
              <Icon name="confirm" size={18} />
            </button>
          )}

        {/* Revert button - when editing a verified transcript with changes */}
        {isTranscriptEditing && hasTranscriptChanges && (
          <button
            className="header-action revert"
            onClick={handleTranscriptRevert}
            disabled={saving}
            data-tooltip="Revert Changes"
          >
            <Icon name="reset" size={18} />
          </button>
        )}

        {lineReviewActive && (
          <button
            className={`header-action debug ${
              lineReviewHeaderControls.debugMode ? "active" : ""
            }`}
            onClick={lineReviewHeaderControls.toggleDebugMode}
            data-tooltip={
              lineReviewHeaderControls.debugMode
                ? "Hide Debug Overlay"
                : "Show Debug Overlay"
            }
          >
            <Icon name="code" size={18} />
          </button>
        )}

        {lineReviewActive && (
          <button
            className="header-action redetect"
            onClick={lineReviewHeaderControls.reloadSegments}
            disabled={lineReviewHeaderControls.reloadDisabled}
            data-tooltip="Reload Segments"
          >
            <Icon name="refresh" size={18} />
          </button>
        )}

      </div>
    </>
  );

  return (
    <AdminLayout
      headerActions={headerActions}
      fullHeight
    >
    <div className="letter-review-page">
      <div className="review-body">
        {lineReviewActive ? (
          <LineReviewMode
            ref={lineReviewModeRef}
            letter={letter}
            transcript={transcript}
            handleMutationError={handleMutationError}
            mutationsBlocked={mutationsBlocked}
            {...lineReviewModeProps}
          />
        ) : (
        <ResizableSplitPane
          letterId={letterId}
          className="review-layout"
          firstPanelClassName="images-panel"
          secondPanelClassName="edit-panel"
          forceSplit={readingViewWorkspace.readingViewOpen ? 0.4 : undefined}
        >
          {/* Left side: Letter viewer */}
          <div className="image-review-shell">
            <LetterViewer
              images={letter.images}
              letterId={letterId}
              showOnlyLetterPages={false}
              {...lineReviewViewerProps}
            />
          </div>

          {/* Right side: Editable content */}
          <div className="edit-panel-content">
            {/* Status Panel */}
            <div className="status-panel">
              {/* Filename Display - shows current page's filename */}
              {lineReviewCurrentFilename && (
                <div className="filename-row">
                  <div className="filename-display">
                    <span className="filename-label">File</span>
                    <code className="filename-value">
                      {lineReviewCurrentFilename}
                    </code>
                  </div>
                  <Dropdown
                    trigger={
                      <button
                        className="more-menu-btn"
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                      >
                        <Icon name="more" size={16} />
                      </button>
                    }
                    isOpen={showMoreMenu}
                    onClose={() => setShowMoreMenu(false)}
                    align="right"
                  >
                    <DropdownItem
                      title="Delete Letter"
                      description="Permanently delete this letter"
                      onClick={() => { setShowMoreMenu(false); handleDelete(); }}
                      disabled={saving}
                      variant="danger"
                    />
                  </Dropdown>
                </div>
              )}

              <div className="status-item">
                <span className="status-label">Workflow</span>
                <WorkflowBadge state={letter.workflowState} />
              </div>
              <div className="status-item">
                <span className="status-label">Visibility</span>
                <div className="visibility-toggle">
                  <button
                    className={`toggle-btn ${letter.visibility === "HIDDEN" ? "active hidden" : ""}`}
                    onClick={() => handleVisibilityChange("HIDDEN")}
                    disabled={saving}
                  >
                    {letter.visibility === "HIDDEN" ? "Hidden" : "Hide"}
                  </button>
                  <button
                    className={`toggle-btn ${letter.visibility === "PUBLISHED" ? "active published" : ""}`}
                    onClick={() => handleVisibilityChange("PUBLISHED")}
                    disabled={saving}
                  >
                    {letter.visibility === "PUBLISHED"
                      ? "Published"
                      : "Publish"}
                  </button>
                </div>
              </div>
              {letter.visibility === "PUBLISHED" && !showPhotoDescriptionSection && (
                <>
                  <div className="status-item">
                    <span className="status-label">Transcript</span>
                    <div className="visibility-toggle">
                      <button
                        className={`toggle-btn ${!letter.transcriptPublished ? "active hidden" : ""}`}
                        onClick={() => handleContentPublishToggle("transcriptPublished", false)}
                        disabled={saving}
                      >
                        {!letter.transcriptPublished ? "Hidden" : "Hide"}
                      </button>
                      <button
                        className={`toggle-btn ${letter.transcriptPublished ? "active published" : ""}`}
                        onClick={() => handleContentPublishToggle("transcriptPublished", true)}
                        disabled={saving}
                      >
                        {letter.transcriptPublished ? "Published" : "Publish"}
                      </button>
                    </div>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Metadata</span>
                    <div className="visibility-toggle">
                      <button
                        className={`toggle-btn ${!letter.metadataPublished ? "active hidden" : ""}`}
                        onClick={() => handleContentPublishToggle("metadataPublished", false)}
                        disabled={saving}
                      >
                        {!letter.metadataPublished ? "Hidden" : "Hide"}
                      </button>
                      <button
                        className={`toggle-btn ${letter.metadataPublished ? "active published" : ""}`}
                        onClick={() => handleContentPublishToggle("metadataPublished", true)}
                        disabled={saving}
                      >
                        {letter.metadataPublished ? "Published" : "Publish"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Unmapped special segment warning */}
            {(() => {
              const letterImages = letter.images.filter((img) => img.type === 'letter');
              const unmappedCount = letterImages.reduce((sum, img) => {
                if (!img.lineSegments) return sum;
                return sum + img.lineSegments.filter(
                  (s) =>
                    (s.segmentClass === 'continuation' || s.segmentClass === 'addition') &&
                    !s.isMapped,
                ).length;
              }, 0);
              if (unmappedCount === 0) return null;
              return (
                <div className="unmapped-segment-warning">
                  <span className="unmapped-segment-icon">⚠</span>
                  <span>{unmappedCount} unmapped special segment{unmappedCount !== 1 ? 's' : ''}</span>
                  {lineReviewSelectedText.length > 0 && (
                    <button
                      className="unmapped-segment-map-btn"
                      onClick={
                        lineReviewMappingControls.mapSelectedText
                      }
                    >
                      Map to Segment
                    </button>
                  )}
                  <button
                    className="unmapped-segment-review-btn"
                    onClick={
                      lineReviewMappingControls.reviewSegments
                    }
                  >
                    Review
                  </button>
                </div>
              );
            })()}

            {/* Transcription Editor - only shown when letter has letter-type images */}
            {showTranscriptSection && (
              <TranscriptionSection
                letter={letter}
                transcriptText={transcript}
                isTranscriptEditing={isTranscriptEditing}
                transcriptFontSize={transcriptFontSize}
                showEditTooltip={showEditTooltip}
                tooltipPosition={tooltipPosition}
                editTooltipRef={editTooltipRef}
                saving={saving}
                editorRef={editorRef}
                onVerifyTranscript={handleVerifyTranscript}
                onTranscriptClick={handleTranscriptClick}
                onTranscriptDoubleClick={handleTranscriptDoubleClick}
                onTranscriptInput={handleTranscriptInput}
                {...letterTranscriptionWorkspace.sectionProps}
                {...readingViewWorkspace.sectionProps}
              />
            )}

            {showPhotoDescriptionSection && (
              <PhotoDescriptionSection {...photoDescriptionWorkspace.sectionProps} />
            )}

            {/* Extra Content Section - only shown when letter has transcribable extras */}
            {hasExtras ? (
              <ExtraContentSection {...extraContentWorkspace.sectionProps} />
            ) : null}

            {showMetadataSections && (
              <MetadataSection
                letter={letter}
                letterId={letterId!}
                sender={sender}
                recipient={recipient}
                date={date}
                location={location}
                hook={hook}
                description={description}
                emotionalTone={emotionalTone}
                relationship={relationship}
                primaryTopics={primaryTopics}
                topicsDropdownOpen={topicsDropdownOpen}
                onSenderChange={setSender}
                onRecipientChange={setRecipient}
                onDateChange={setDate}
                onLocationChange={setLocation}
                onHookChange={setHook}
                onDescriptionChange={setDescription}
                onEmotionalToneChange={setEmotionalTone}
                onRelationshipChange={setRelationship}
                onPrimaryTopicsChange={setPrimaryTopics}
                onTopicsDropdownOpenChange={setTopicsDropdownOpen}
                onTriggerAutoSave={handleMetadataAutoSave}
                identityUpdateState={identityUpdateState}
                identityUpdateSecondsRemaining={identityUpdateSecondsRemaining}
                retagState={retagState}
                onVerifyMetadata={handleVerifyMetadata}
                onConfirmTranscript={
                  transcriptConfirmationWorkspace.openDialog
                }
                confirmationReplayBlocked={
                  transcriptConfirmationWorkspace.replayBlocked
                }
                {...analysisRegenerationWorkspace.metadataSectionProps}
                onMetadataFieldClick={handleMetadataFieldClick}
                onMetadataFieldDoubleClick={handleMetadataFieldDoubleClick}
                showMetadataTooltip={showMetadataTooltip}
                metadataTooltipPosition={metadataTooltipPosition}
                metadataTooltipRef={metadataTooltipRef}
                saving={saving}
                showToast={showToast}
              />
            )}

            {/* Entity Extraction Section */}
            {showMetadataSections && letter.entityExtractionJson ? (
              <EntitySection
                entityExtractionJson={letter.entityExtractionJson}
                senderName={letter.metadata.sender}
                recipientName={letter.metadata.recipient}
                {...analysisRegenerationWorkspace.entitySectionProps}
                disabled={saving}
              />
            ) : null}

            {/* AI Notes Section (structured) */}
            {showMetadataSections && (
              <div id="ai-notes-section">
                <NotesSection
                  notes={letter.aiNotes ?? null}
                  disabled={saving}
                  onNoteStatusChange={handleNoteStatusChange}
                  onAddNote={handleAddNote}
                />
              </div>
            )}

            {/* Personal Notes Section */}
            <div id="personal-notes-section" className="editor-section notes-section">
              <div className="notes-section-header">
                <span className="help-text">Personal reference only</span>
              </div>
              <div className="notes-container">
                <div className="form-group">
                  <label htmlFor="notes">Personal Notes</label>
                  <textarea
                    ref={notesRef}
                    id="notes"
                    value={notes}
                    onChange={handlePersonalNotesChange}
                    placeholder="Personal notes (not shown publicly)"
                    readOnly={
                      saving || letter.metadataContentStatus === "VERIFIED"
                    }
                    className={
                      letter.metadataContentStatus === "VERIFIED"
                        ? "verified-field"
                        : ""
                    }
                  />
                </div>
              </div>
            </div>

            {/* Message */}
            {message && (
              <div
                className={`message ${message.includes("Failed") ? "error" : "success"}`}
              >
                {message}
              </div>
            )}
          </div>
        </ResizableSplitPane>
        )}
      </div>

      <TranscriptionRegenerationDialog
        isOpen={letterTranscriptionWorkspace.regenerationDialogOpen}
        onClose={letterTranscriptionWorkspace.closeRegenerationDialog}
        onLetter={async () => {
          letterTranscriptionWorkspace.closeRegenerationDialog();
          await letterTranscriptionWorkspace.transcribe();
        }}
        onExtras={hasExtras ? async () => {
          letterTranscriptionWorkspace.closeRegenerationDialog();
          await extraContentWorkspace.transcribe({
            confirmReplacement: false,
          });
        } : undefined}
        onBoth={hasExtras ? async () => {
          letterTranscriptionWorkspace.closeRegenerationDialog();
          if (
            !await letterTranscriptionWorkspace.transcribe()
            || !visit.isActive()
          ) {
            return;
          }
          await extraContentWorkspace.transcribe({
            confirmReplacement: false,
          });
        } : undefined}
      />

      <IdentityExtractionModal
        {...transcriptConfirmationWorkspace.dialogProps}
        submitting={saving}
        mode="extract"
        letterTitle={letter?.title}
      />

      <AnalysisRegenerationDialog
        {...analysisRegenerationWorkspace.dialogProps}
      />

      <PhotoDescriptionContextModal
        {...photoDescriptionWorkspace.dialogProps}
      />

      {sourceConflict && (
        <div
          className="confirm-dialog-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="letter-source-conflict-title"
        >
          <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <h3 id="letter-source-conflict-title">Letter source changed</h3>
            <p>
              Another session replaced or changed the source pages. Your local
              draft remains on this screen, but it cannot be saved against the
              new source.
            </p>
            <p>{sourceConflict.detail}</p>
            <div className="confirm-dialog-actions">
              <button
                className="btn-confirm"
                autoFocus
                onClick={() => {
                  // A full reload reconstructs every draft from the authoritative
                  // DTO before the terminal mutation owner is reset.
                  window.location.reload();
                }}
              >
                Reload latest source
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </AdminLayout>
  );
}
