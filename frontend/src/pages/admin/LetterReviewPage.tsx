import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import {
  updateLetter,
  confirmTranscript,
  regenerateMetadata,
  transcribeExtras,
  updateExtraContent,
  verifyExtraContent,
  unverifyExtraContent,
  transcribeLetter,
} from "../../api/admin";
import {
  toggleLetterFlag,
  reExtractLetter,
  updateNoteStatus,
  addNote,
} from "../../api/admin/letters";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import AdminLayout from "../../components/AdminLayout";
import { useToast } from "../../contexts/ToastContext";
import {
  Icon,
  WorkflowBadge,
  ResizableSplitPane,
  Dropdown,
  DropdownItem,
  type DynamicEditorRef,
} from "../../components/common";
import { trackEdit } from "../../utils/recentEdits";
import { highlightTranscriptMarkers } from "../../utils/transcriptHighlight";
import { useTooltip } from "../../hooks/useTooltip";
import type { Letter, LetterImage, VisibilityState } from "../../types/Letter";
import TranscriptionSection from "./LetterReview/TranscriptionSection";
import { ExtraContentSection } from "./LetterReview/ExtraContentSection";
import MetadataSection from "./LetterReview/MetadataSection";
import EntitySection from "./LetterReview/EntitySection";
import NotesSection from "./LetterReview/NotesSection";
import {
  type AutoSaveData,
  useAutoSave,
} from "./LetterReview/useAutoSave";
import { useMetadataEditing } from "./LetterReview/useMetadataEditing";
import { useTranscriptEditing } from "./LetterReview/useTranscriptEditing";
import { useTranscriptFontSize } from "./LetterReview/useTranscriptFontSize";
import LineReviewMode, {
  type LineReviewModeHandle,
} from "../../components/LineReviewMode/LineReviewMode";
import "./LetterReviewPage.css";

export default function LetterReviewPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { showToast } = useToast();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);

  const [transcript, setTranscript] = useState("");

  // Extra content state
  const [extraContent, setExtraContent] = useState("");
  const [extraContentTranscribing, setExtraContentTranscribing] =
    useState(false);

  // Extra content refs
  const extraContentRef = useRef<DynamicEditorRef>(null);

  // Metadata regeneration state
  const [regenerateState, setRegenerateState] = useState<
    "idle" | "regenerating" | "done"
  >("idle");

  // Re-extraction state (for metadata re-extract with corrected identity)
  const [, setReExtractState] = useState<
    "idle" | "extracting" | "done"
  >("idle");

  // Entity re-extraction state (separate from metadata re-extract)
  const [entityReExtractState, setEntityReExtractState] = useState<
    "idle" | "extracting" | "done"
  >("idle");

  // Letter transcription state (transcribe letter only, no extras)
  const [letterTranscribeState, setLetterTranscribeState] = useState<
    "idle" | "transcribing" | "done"
  >("idle");
  const [letterTranscribeMessage, setLetterTranscribeMessage] = useState<
    string | null
  >(null);

  // Regenerate popup state
  const [showTranscriptRegeneratePopup, setShowTranscriptRegeneratePopup] = useState(false);
  const [showMetadataRegeneratePopup, setShowMetadataRegeneratePopup] = useState(false);

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(
    undefined,
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const lineReviewRef = useRef<LineReviewModeHandle>(null);

  // Verified extra content editing flow state
  const [isExtraContentEditing, setIsExtraContentEditing] = useState(false);
  const {
    show: showExtraContentTooltip,
    position: extraContentTooltipPosition,
    ref: extraContentTooltipRef,
    showAt: showExtraContentTooltipAt,
    close: closeExtraContentTooltip,
  } = useTooltip();

  // Line highlighting state
  const [_currentLineIndex, setCurrentLineIndex] = useState<number | null>(
    null,
  );
  const [reviewMode, setReviewMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const transcriptFontSize = useTranscriptFontSize(
    editorRef,
    transcript,
    reviewMode,
  );
  const hookRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const {
    applyLetterMetadata,
    date,
    dateConfidence,
    description,
    emotionalTone,
    handleMetadataFieldClick,
    handleMetadataFieldDoubleClick,
    handleVerifyMetadata,
    hook,
    location,
    metadataTooltipPosition,
    metadataTooltipRef,
    notes,
    primaryTopics,
    recipient,
    relationship,
    sender,
    setDate,
    setDateConfidence,
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
    showMetadataTooltip,
    syncIdentityMetadata,
    topicsDropdownOpen,
  } = useMetadataEditing({
    letterId,
    letter,
    setLetter,
    setSaving,
    showToast,
  });
  const {
    autoSaveStatus,
    scheduleDebouncedSave,
    scheduleStatusReset,
    triggerAutoSave,
  } = useAutoSave({
    letterId,
    letter,
    setLetter,
    showToast,
    syncIdentityMetadata,
  });
  const {
    editTooltipRef,
    handleTranscriptClick,
    handleTranscriptDoubleClick,
    handleTranscriptInput,
    handleTranscriptRevert,
    handleVerifyTranscript,
    hasTranscriptChanges,
    isTranscriptEditing,
    originalTranscriptText,
    showEditTooltip,
    tooltipPosition,
  } = useTranscriptEditing({
    letterId,
    letter,
    transcript,
    setLetter,
    setSaving,
    setTranscript,
    showToast,
    editorRef,
    triggerAutoSave,
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
      return;
    }

    if (letterId) {
      async function fetchLetter() {
        setLoading(true);
        try {
          const foundLetter = await getAdminLetterById(letterId!);
          setLetter(foundLetter);
          setTranscript(foundLetter.transcript.fullText);
          applyLetterMetadata(foundLetter);
          // Extra content
          setExtraContent(foundLetter.extraContentTranscript || "");
          // Reset extra content editing state for new letter
          setIsExtraContentEditing(false);
        } catch (err) {
          setMessage(err instanceof Error ? err.message : "Letter not found");
          console.error("Failed to fetch letter:", err);
        } finally {
          setLoading(false);
        }
      }
      fetchLetter();
    }
  }, [applyLetterMetadata, letterId, navigate]);

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

  // Keep the contenteditable DOM in sync when the editor mounts or when
  // transcript state changes outside direct typing (for example after exiting
  // line review). We only write when the DOM is actually out of sync to avoid
  // cursor jumps during normal editing.
  // Uses innerHTML to render highlighted uncertainty markers ([illegible], etc.)
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      const currentContent = editor.innerText;
      if (currentContent !== transcript) {
        editor.innerHTML = highlightTranscriptMarkers(transcript);
      }
    }
  }, [transcript, reviewMode]);

  // Auto-resize textareas to fit content
  const autoResizeTextarea = (textarea: HTMLTextAreaElement | null, minHeight = 80) => {
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = Math.max(textarea.scrollHeight, minHeight) + "px";
  };

  useEffect(() => autoResizeTextarea(hookRef.current), [hook]);
  useEffect(() => autoResizeTextarea(descriptionRef.current), [description]);
  useEffect(() => autoResizeTextarea(notesRef.current), [notes]);

  // Clear any pending sync timer
  // Letter transcription handler (transcribes only the letter, not extras)
  const handleTranscribeLetter = useCallback(
    async (skipConfirm = false) => {
      if (!letterId || !letter) return;

      // Check if transcript already has content — show regenerate popup
      if (!skipConfirm && letter.transcript.fullText.trim()) {
        setShowTranscriptRegeneratePopup(true);
        return;
      }

      setShowTranscriptRegeneratePopup(false);
      setLetterTranscribeState("transcribing");
      setLetterTranscribeMessage("Transcribing letter...");

      try {
        const result = await transcribeLetter(letterId);

        // Update local state with transcribed letter
        setLetter(result.letter);
        setTranscript(result.letter.transcript.fullText);

        setLetterTranscribeState("done");
        setLetterTranscribeMessage(
          `Transcribed ${result.transcribed.pageCount} page(s)`,
        );
        showToast(
          `Letter transcribed (${result.transcribed.pageCount} page(s))`,
          "success",
        );

        scheduleStatusReset(() => {
          setLetterTranscribeState("idle");
          setLetterTranscribeMessage(null);
        }, 3000);
      } catch (err) {
        setLetterTranscribeState("idle");
        setLetterTranscribeMessage(null);
        showToast(
          err instanceof Error ? err.message : "Transcription failed",
          "error",
        );
        console.error("Letter transcription error:", err);
      }
    },
    [letterId, letter, scheduleStatusReset, showToast],
  );

  // Extra content transcription handler with confirmation
  const handleTranscribeExtrasWithConfirm = useCallback(
    async (skipConfirm = false) => {
      if (!letterId || !letter) return;

      // Check if extra content already has content — confirm before replacing
      if (!skipConfirm && letter.extraContentTranscript?.trim()) {
        if (!window.confirm("Replace extra content transcription? This will overwrite the current content.")) return;
      }

      setExtraContentTranscribing(true);
      try {
        const result = await transcribeExtras(letterId);
        setLetter(result.letter);
        setExtraContent(result.letter.extraContentTranscript || "");
        if (result.transcribedCount > 0) {
          showToast(
            `Transcribed ${result.transcribedCount} extra item(s)`,
            "success",
          );
        } else {
          showToast("No transcribable extra content found", "info");
        }
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to transcribe extras",
          "error",
        );
      } finally {
        setExtraContentTranscribing(false);
      }
    },
    [letterId, letter, showToast],
  );

  const handleVisibilityChange = async (newVisibility: VisibilityState) => {
    if (!letterId || !letter) return;
    if (letter.visibility === newVisibility) return;

    setSaving(true);

    try {
      const updated = await updateLetter(letterId, {
        visibility: newVisibility,
      });
      setLetter(updated);
      showToast(
        newVisibility === "PUBLISHED" ? "Letter published" : "Letter hidden",
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update visibility",
        "error",
      );
      console.error("Visibility change error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmTranscript = async () => {
    if (!letterId) return;
    setSaving(true);

    try {
      const updated = await confirmTranscript(letterId);
      setLetter(updated);
      applyLetterMetadata(updated, { includeNotes: false });
      showToast(
        "Transcript confirmed — metadata extracted",
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to confirm transcript",
        "error",
      );
      console.error("Confirm transcript error:", err);
    } finally {
      setSaving(false);
    }
  };

  // Regenerate metadata handler — shows popup for options
  const handleRegenerateMetadata = () => {
    if (!letterId) return;
    setShowMetadataRegeneratePopup(true);
  };

  // Execute metadata regeneration (metadata only)
  const executeMetadataRegenerate = async () => {
    if (!letterId) return;
      setShowMetadataRegeneratePopup(false);
      setRegenerateState("regenerating");
    try {
      const updated = await regenerateMetadata(letterId);
      setLetter(updated);
      applyLetterMetadata(updated, { includeNotes: false });
      setRegenerateState("done");
      showToast("Metadata regenerated", "success");

      scheduleStatusReset(() => {
        setRegenerateState("idle");
      }, 2000);
    } catch (err) {
      setRegenerateState("idle");
      showToast(
        err instanceof Error ? err.message : "Failed to regenerate metadata",
        "error",
      );
      console.error("Regenerate metadata error:", err);
    }
  };

  // Re-extract handler — calls the re-extract API with corrected sender/recipient
  const handleReExtract = useCallback(
    async (mode: "full" | "metadata_only" | "entities_only", skipConfirm = false) => {
      if (!letterId || !letter) return;

      if (!skipConfirm) {
        const confirmMsg = mode === "entities_only"
          ? "Re-extract entities from the transcript? This will overwrite current entity data."
          : "Re-extract all metadata and entities? This will overwrite current data.";
        if (!window.confirm(confirmMsg)) return;
      }

      const isEntityOnly = mode === "entities_only";
      if (isEntityOnly) {
        setEntityReExtractState("extracting");
      } else {
        setReExtractState("extracting");
      }

      try {
        const updated = await reExtractLetter(letterId, {
          confirmedSender: sender || undefined,
          confirmedRecipient: recipient || undefined,
          mode,
        });

        // Update letter state
        setLetter(updated);

        if (!isEntityOnly) {
          applyLetterMetadata(updated, { includeNotes: false });

          setReExtractState("done");
          showToast("Metadata re-extracted with corrections", "success");

          scheduleStatusReset(() => {
            setReExtractState("idle");
          }, 2000);
        } else {
          setEntityReExtractState("done");
          showToast("Entities re-extracted", "success");

          scheduleStatusReset(() => {
            setEntityReExtractState("idle");
          }, 2000);
        }

        // Track this edit
        trackEdit({
          id: updated.id,
          metadata: updated.metadata,
          collectionCode: updated.collectionCode,
        });
      } catch (err) {
        if (isEntityOnly) {
          setEntityReExtractState("idle");
        } else {
          setReExtractState("idle");
        }
        showToast(
          err instanceof Error ? err.message : "Re-extraction failed",
          "error",
        );
        console.error("Re-extract error:", err);
      }
    },
    [
      applyLetterMetadata,
      letterId,
      letter,
      recipient,
      scheduleStatusReset,
      sender,
      showToast,
    ],
  );

  const handleDelete = async () => {
    if (!letterId) return;
    if (!window.confirm("Are you sure you want to delete this letter?")) {
      return;
    }

    setSaving(true);

    try {
      await deleteLetter(letterId);
      showToast("Letter deleted", "success");
      setTimeout(() => navigate("/admin"), 1500);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to delete",
        "error",
      );
      console.error("Delete error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handlePageChange = useCallback((_index: number, image: LetterImage) => {
    setCurrentFilename(image.originalFilename);
  }, []);

  // Handle Tab key to insert spaces instead of changing focus (for transcript editor)
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();

      // Use execCommand to insert text - works better with contentEditable
      // and integrates with browser's undo/redo stack
      // The onInput handler will update React state after execCommand modifies the DOM
      document.execCommand("insertText", false, "    ");
    }
  };

  // Handle Tab key for extra content editor
  const handleExtraContentKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();

      // Ensure the editor is focused before inserting text
      const editor = e.currentTarget;
      if (document.activeElement !== editor) {
        editor.focus();
      }

      // Use execCommand to insert text - works better with contentEditable
      // and integrates with browser's undo/redo stack
      document.execCommand("insertText", false, "    ");

      // Update state
      setExtraContent(editor.innerText);
    }
  };

  // Extra content verification handlers
  const handleVerifyExtraContent = useCallback(async () => {
    if (!letterId) return;
    setSaving(true);
    try {
      const updated = await verifyExtraContent(letterId);
      setLetter(updated);
      setIsExtraContentEditing(false);
      showToast("Extra content verified", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to verify extra content",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letterId, showToast]);

  const handleUnverifyExtraContent = useCallback(async () => {
    if (!letterId || !letter) return;
    if (letter.extraContentStatus !== "VERIFIED") return;

    setSaving(true);
    try {
      const updated = await unverifyExtraContent(letterId);
      setLetter(updated);
      setIsExtraContentEditing(true);
      showToast("Extra content verification removed", "info");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to unverify extra content",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letterId, letter, showToast]);

  // Extra content click/double-click handlers for verified state
  const handleExtraContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        !letter?.extraContentStatus ||
        letter.extraContentStatus !== "VERIFIED" ||
        isExtraContentEditing
      )
        return;

      showExtraContentTooltipAt(e.clientX, e.clientY);
    },
    [letter?.extraContentStatus, isExtraContentEditing, showExtraContentTooltipAt],
  );

  const handleExtraContentDoubleClick = useCallback(async () => {
    if (
      !letter?.extraContentStatus ||
      letter.extraContentStatus !== "VERIFIED" ||
      !letterId
    )
      return;

    closeExtraContentTooltip();

    // Unverify via API
    setSaving(true);
    try {
      const updated = await unverifyExtraContent(letterId);
      setLetter(updated);
      setIsExtraContentEditing(true);
      showToast("Extra content verification removed", "info");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to unverify extra content",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letter?.extraContentStatus, letterId, showToast, closeExtraContentTooltip]);

  // Extra content auto-save
  const handleExtraContentChange = useCallback(
    (newContent: string) => {
      setExtraContent(newContent);
      if (!letterId) return;

      scheduleDebouncedSave(
        async () => {
          const updated = await updateExtraContent(letterId, newContent);
          setLetter(updated);
        },
        {
          errorMessage: "Failed to save extra content",
          onError: (error) => {
            console.error("Extra content auto-save error:", error);
          },
        },
      );
    },
    [letterId, scheduleDebouncedSave],
  );

  // Structured note handlers
  const handleNoteStatusChange = useCallback(
    async (noteId: string, status: 'resolved' | 'dismissed') => {
      if (!letterId) return;
      try {
        const updated = await updateNoteStatus(letterId, noteId, status);
        setLetter(updated);
        showToast(`Note ${status}`, 'success');
      } catch (err) {
        showToast(getErrorMessage(err, `Failed to ${status} note`), 'error');
      }
    },
    [letterId, showToast],
  );

  const handleAddNote = useCallback(
    async (note: { content: string; category: string; priority: string }) => {
      if (!letterId) return;
      try {
        const updated = await addNote(letterId, note);
        setLetter(updated);
        showToast('Note added', 'success');
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to add note'), 'error');
      }
    },
    [letterId, showToast],
  );

  const handleToggleReviewMode = useCallback(() => {
    if (reviewMode) {
      lineReviewRef.current?.saveCurrentLine();
    }

    setReviewMode((prev) => !prev);
  }, [reviewMode]);

  // Line highlighting - update on cursor move
  useEffect(() => {
    const isEditing =
      (letter && letter.transcriptStatus !== "VERIFIED") || isTranscriptEditing;

    const handleSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor || !isEditing) {
        setCurrentLineIndex(null);
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setCurrentLineIndex(null);
        return;
      }

      // Check if selection is within the editor
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        setCurrentLineIndex(null);
        return;
      }

      // Find the cursor position
      const preRange = document.createRange();
      preRange.setStart(editor, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const textBeforeCursor = preRange.toString();

      // Count newlines to determine line index
      const lineIndex = (textBeforeCursor.match(/\n/g) || []).length;
      setCurrentLineIndex(lineIndex);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [letter?.transcriptStatus, isTranscriptEditing]);

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

  // Check if letter has letter-type images (for transcript section visibility)
  const hasLetterPages = letter.images.some((img) => img.type === "letter");

  // Types that produce transcribable extra content (photo is excluded — can't transcribe photos)
  const hasExtras = Boolean(letter.images.some((img) =>
    ["telegram", "cover", "ephemera"].includes(img.type)
  ));

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
          onClick={async () => {
            const newFlagged = !letter.flagged;
            try {
              const updated = await toggleLetterFlag(letter.id, newFlagged);
              setLetter(updated);
            } catch (err) {
              showToast(
                getErrorMessage(err, `Failed to ${newFlagged ? 'flag' : 'unflag'} letter`),
                'error',
              );
            }
          }}
          data-tooltip={letter.flagged ? "Unflag" : "Flag for follow-up"}
        >
          <Icon name={letter.flagged ? "flag-filled" : "flag"} size={18} />
        </button>
        {/* Confirm button - only for TRANSCRIBED without confirmation */}
        {letter.workflowState === "TRANSCRIBED" &&
          !letter.transcriptConfirmedAt && (
            <button
              className="header-action confirm"
              onClick={handleConfirmTranscript}
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

        <button
          className={`header-action review ${reviewMode ? "active" : ""}`}
          onClick={handleToggleReviewMode}
          data-tooltip={reviewMode ? "Switch to Edit Mode" : "Switch to Review Mode"}
        >
          <Icon name={reviewMode ? "edit" : "eye"} size={18} />
        </button>

        {reviewMode && (
          <button
            className={`header-action debug ${debugMode ? "active" : ""}`}
            onClick={() => setDebugMode(prev => !prev)}
            data-tooltip={debugMode ? "Hide Debug Overlay" : "Show Debug Overlay"}
          >
            <Icon name="code" size={18} />
          </button>
        )}

        {reviewMode && (
          <button
            className="header-action redetect"
            onClick={() => lineReviewRef.current?.redetectLines()}
            disabled={lineReviewRef.current?.isDetecting}
            data-tooltip="Re-detect Lines"
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
        {reviewMode ? (
          <LineReviewMode
            ref={lineReviewRef}
            letter={letter}
            transcript={transcript}
            onTranscriptChange={(newText) => setTranscript(newText)}
            onExit={() => setReviewMode(false)}
            onAutoSave={(data) => {
              void triggerAutoSave(data);
            }}
            debugMode={debugMode}
            onDebugModeChange={setDebugMode}
          />
        ) : (
        <ResizableSplitPane
          letterId={letterId}
          className="review-layout"
          firstPanelClassName="images-panel"
          secondPanelClassName="edit-panel"
        >
          {/* Left side: Letter viewer */}
          <div className="image-review-shell">
            <LetterViewer
              images={letter.images}
              letterId={letterId}
              showOnlyLetterPages={false}
              onPageChange={handlePageChange}
            />
          </div>

          {/* Right side: Editable content */}
          <div className="edit-panel-content">
            {/* Status Panel */}
            <div className="status-panel">
              {/* Filename Display - shows current page's filename */}
              {(currentFilename || letter.images[0]?.originalFilename) && (
                <div className="filename-row">
                  <div className="filename-display">
                    <span className="filename-label">File</span>
                    <code className="filename-value">
                      {currentFilename || letter.images[0]?.originalFilename}
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
            </div>

            {/* Transcription Editor - only shown when letter has letter-type images */}
            {hasLetterPages && (
              <TranscriptionSection
                letter={letter}
                letterTranscribeState={letterTranscribeState}
                letterTranscribeMessage={letterTranscribeMessage}
                isTranscriptEditing={isTranscriptEditing}
                hasTranscriptChanges={hasTranscriptChanges}
                originalTranscriptText={originalTranscriptText}
                transcriptFontSize={transcriptFontSize}
                showEditTooltip={showEditTooltip}
                tooltipPosition={tooltipPosition}
                editTooltipRef={editTooltipRef}
                saving={saving}
                editorRef={editorRef}
                onTranscribeLetter={handleTranscribeLetter}
                onVerifyTranscript={handleVerifyTranscript}
                onTranscriptClick={handleTranscriptClick}
                onTranscriptDoubleClick={handleTranscriptDoubleClick}
                onTranscriptInput={handleTranscriptInput}
                onEditorKeyDown={handleEditorKeyDown}
              />
            )}

            {/* Extra Content Section - only shown when letter has transcribable extras */}
            {hasExtras ? (
              <ExtraContentSection
                letter={letter}
                extraContent={extraContent}
                extraContentTranscribing={extraContentTranscribing}
                isExtraContentEditing={isExtraContentEditing}
                showExtraContentTooltip={showExtraContentTooltip}
                extraContentTooltipPosition={extraContentTooltipPosition}
                extraContentTooltipRef={extraContentTooltipRef}
                saving={saving}
                extraContentRef={extraContentRef}
                onTranscribeExtras={handleTranscribeExtrasWithConfirm}
                onVerifyExtraContent={
                  letter.extraContentStatus === "VERIFIED"
                    ? handleUnverifyExtraContent
                    : handleVerifyExtraContent
                }
                onExtraContentChange={handleExtraContentChange}
                onExtraContentKeyDown={handleExtraContentKeyDown}
                onExtraContentClick={handleExtraContentClick}
                onExtraContentDoubleClick={handleExtraContentDoubleClick}
              />
            ) : null}

            <MetadataSection
              letter={letter}
              letterId={letterId!}
              sender={sender}
              recipient={recipient}
              date={date}
              dateConfidence={dateConfidence}
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
              onDateConfidenceChange={setDateConfidence}
              onLocationChange={setLocation}
              onHookChange={setHook}
              onDescriptionChange={setDescription}
              onEmotionalToneChange={setEmotionalTone}
              onRelationshipChange={setRelationship}
              onPrimaryTopicsChange={setPrimaryTopics}
              onTopicsDropdownOpenChange={setTopicsDropdownOpen}
              onTriggerAutoSave={(updates) =>
                void triggerAutoSave(updates as AutoSaveData)
              }
              hookRef={hookRef}
              descriptionRef={descriptionRef}
              regenerateState={regenerateState}
              onVerifyMetadata={handleVerifyMetadata}
              onConfirmTranscript={handleConfirmTranscript}
              onRegenerateMetadata={handleRegenerateMetadata}
              onMetadataFieldClick={handleMetadataFieldClick}
              onMetadataFieldDoubleClick={handleMetadataFieldDoubleClick}
              showMetadataTooltip={showMetadataTooltip}
              metadataTooltipPosition={metadataTooltipPosition}
              metadataTooltipRef={metadataTooltipRef}
              saving={saving}
              showToast={showToast}
            />

            {/* Entity Extraction Section */}
            {letter.entityExtractionJson ? (
              <EntitySection
                entityExtractionJson={letter.entityExtractionJson}
                reExtractState={entityReExtractState}
                onReExtractEntities={() => handleReExtract("entities_only")}
              />
            ) : null}

            {/* AI Notes Section (structured) */}
            <div id="ai-notes-section">
              <NotesSection
                notes={letter.aiNotes as import("./LetterReview/NotesSection").StructuredNote[] | string | null}
                letterId={letterId!}
                onNoteStatusChange={handleNoteStatusChange}
                onAddNote={handleAddNote}
              />
            </div>

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
                    onChange={(e) => {
                      setNotes(e.target.value);
                      void triggerAutoSave({ notes: e.target.value || null });
                    }}
                    placeholder="Personal notes (not shown publicly)"
                    readOnly={letter.metadataContentStatus === "VERIFIED"}
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

      {/* Regenerate Transcription popup */}
      {showTranscriptRegeneratePopup && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowTranscriptRegeneratePopup(false)}
        >
          <div className="confirm-dialog regenerate-popup" onClick={(e) => e.stopPropagation()}>
            <h3>Regenerate Transcription</h3>
            <p>Choose what to regenerate. This will overwrite the existing content.</p>
            <div className="regenerate-options">
              <button
                className="btn-option"
                onClick={() => {
                  setShowTranscriptRegeneratePopup(false);
                  handleTranscribeLetter(true);
                }}
              >
                <Icon name="file" size={16} />
                <span>Letter Transcript</span>
              </button>
              {hasExtras && (
                <button
                  className="btn-option"
                  onClick={() => {
                    setShowTranscriptRegeneratePopup(false);
                    handleTranscribeExtrasWithConfirm(true);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>Extra Content</span>
                </button>
              )}
              {hasExtras && (
                <button
                  className="btn-option"
                  onClick={async () => {
                    setShowTranscriptRegeneratePopup(false);
                    // Transcribe both: letter first, then extras
                    await handleTranscribeLetter(true);
                    await handleTranscribeExtrasWithConfirm(true);
                  }}
                >
                  <Icon name="process" size={16} />
                  <span>Both</span>
                </button>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowTranscriptRegeneratePopup(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Metadata popup */}
      {showMetadataRegeneratePopup && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowMetadataRegeneratePopup(false)}
        >
          <div className="confirm-dialog regenerate-popup" onClick={(e) => e.stopPropagation()}>
            <h3>Regenerate Analysis</h3>
            <p>Choose what to regenerate. This will overwrite the existing data.</p>
            <div className="regenerate-options">
              <button
                className="btn-option"
                onClick={() => {
                  setShowMetadataRegeneratePopup(false);
                  executeMetadataRegenerate();
                }}
              >
                <Icon name="edit" size={16} />
                <span>Metadata Only</span>
              </button>
              <button
                className="btn-option"
                onClick={() => {
                  setShowMetadataRegeneratePopup(false);
                  handleReExtract("entities_only", true);
                }}
              >
                <Icon name="person" size={16} />
                <span>Entities Only</span>
              </button>
              <button
                className="btn-option"
                onClick={() => {
                  setShowMetadataRegeneratePopup(false);
                  handleReExtract("full", true);
                }}
              >
                <Icon name="process" size={16} />
                <span>Both</span>
              </button>
            </div>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowMetadataRegeneratePopup(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </AdminLayout>
  );
}
