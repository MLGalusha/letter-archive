import {
  startTransition,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import {
  updateLetter,
  confirmTranscript,
  regenerateMetadata,
  transcribeLetter,
} from "../../api/admin";
import {
  toggleLetterFlag,
  reExtractLetter,
  generateReadingView,
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
} from "../../components/common";
import { trackEdit } from "../../utils/recentEdits";
import { highlightTranscriptMarkers } from "../../utils/transcriptHighlight";
import type { Letter, LetterImage, VisibilityState } from "../../types/Letter";
import {
  getPrimaryImageType,
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
import { useMetadataEditing } from "./LetterReview/useMetadataEditing";
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
import { loadCurrentLetter } from "./LetterReview/loadCurrentLetter";
import { usePretextFontSize } from "../../hooks/usePretextFontSize";
import LineReviewMode, {
  type LineReviewModeHandle,
} from "../../components/LineReviewMode/LineReviewMode";
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
    setLetter,
    tryAdoptLetter,
  } = useGuardedLetterState(markSourceConflict, visit);

  const [transcript, setTranscript] = useState("");
  const [transcriptViewMode, setTranscriptViewMode] = useState<"edit" | "preview">("edit");
  // Reader view text — sourced from backend readingText
  const [readerText, setReaderText] = useState<string | null>(null);
  const [readingViewGenerating, setReadingViewGenerating] = useState(false);

  // Initialize reader text from backend when switching to preview
  const handleViewModeChange = useCallback((mode: "edit" | "preview") => {
    setTranscriptViewMode(mode);
    if (mode === "preview" && readerText === null && letter?.readingText) {
      setReaderText(letter.readingText);
    }
  }, [readerText, letter?.readingText]);

  // Sync reader text when letter data updates (e.g. after verification auto-generates it)
  useEffect(() => {
    if (letter?.readingText && readerText === null) {
      // Don't auto-set — wait until user opens preview
    } else if (letter?.readingText && letter.readingText !== readerText) {
      // Backend has newer reading text (e.g. from auto-generation on verify)
      setReaderText(letter.readingText);
    }
  }, [letter?.readingText, readerText]);

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
  const [showExtractionPopup, setShowExtractionPopup] = useState(false);
  const [extractionSender, setExtractionSender] = useState("");
  const [extractionRecipient, setExtractionRecipient] = useState("");

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const { saving, beginSaving } = useLetterSavingState(visit);
  const [message, setMessage] = useState("");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(
    undefined,
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const lineReviewRef = useRef<LineReviewModeHandle>(null);

  // Line highlighting state
  const [, setCurrentLineIndex] = useState<number | null>(
    null,
  );
  const [reviewMode, setReviewMode] = useState(false);
  const [segmentFirstMode, setSegmentFirstMode] = useState(false);
  const segmentFirstTriggeredRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [viewerPageIndex, setViewerPageIndex] = useState(0);
  // Mapping mode: selected transcript text to map to a segment
  const [selectedText, setSelectedText] = useState("");
  const [mappingText, setMappingText] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    setReadingViewGenerating(false);
    setRegenerateState("idle");
    setReExtractState("idle");
    setEntityReExtractState("idle");
    setLetterTranscribeState("idle");
    setLetterTranscribeMessage(null);
    setShowTranscriptRegeneratePopup(false);
    setShowMetadataRegeneratePopup(false);
    setShowExtractionPopup(false);
    segmentFirstTriggeredRef.current = false;
  }, [visit]);

  const transcriptFontSize = usePretextFontSize(
    editorRef,
    transcript,
    { fontFamily: "Georgia, 'Times New Roman', serif" },
  );
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const identityMetadataSyncRef = useRef<(updatedLetter: Letter) => void>(
    () => {},
  );
  const syncIdentityMetadataForAutoSave = useCallback(
    (updatedLetter: Letter) => {
      identityMetadataSyncRef.current(updatedLetter);
    },
    [],
  );
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
    syncIdentityMetadata: syncIdentityMetadataForAutoSave,
  });
  const {
    applyLetterMetadata,
    date,
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
    visit,
    letterId,
    letter,
    tryAdoptLetter,
    beginSaving,
    flushPendingSaves,
    handleMutationError,
    showToast,
  });
  useLayoutEffect(() => {
    identityMetadataSyncRef.current = syncIdentityMetadata;
    return () => {
      if (identityMetadataSyncRef.current === syncIdentityMetadata) {
        identityMetadataSyncRef.current = () => {};
      }
    };
  }, [syncIdentityMetadata]);
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
    editorRef,
    triggerAutoSave,
  });
  const hydrateAdoptedLetter = useCallback((updatedLetter: Letter) => {
    setTranscript(updatedLetter.transcript.fullText);
    setReaderText(updatedLetter.readingText ?? null);
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
  const extraContentWorkspace = useExtraContentWorkspace({
    visit,
    letter,
    saving,
    scheduleDebouncedSave,
    tryAdoptLetter,
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

  // Segment-first entry: auto-enter full-viewport segment review when pages
  // have unverified segments with data. Only triggers once per letter visit.
  useEffect(() => {
    if (!letter || segmentFirstTriggeredRef.current) return;
    segmentFirstTriggeredRef.current = true;

    const letterImages = letter.images.filter((img) => img.type === 'letter');
    const hasUnverifiedSegments = letterImages.some(
      (img) =>
        img.segmentTrustState !== 'trusted' &&
        img.lineSegments &&
        img.lineSegments.length > 0,
    );

    if (hasUnverifiedSegments) {
      setReviewMode(true);
      setSegmentFirstMode(true);
    }
  }, [letter]);

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
    // Grow to fit content but never shrink below minHeight.
    // Avoid setting height to "auto" which causes a momentary collapse
    // and scroll jump when the user is scrolled down.
    const needed = Math.max(textarea.scrollHeight, minHeight);
    if (Math.abs(textarea.offsetHeight - needed) > 1) {
      textarea.style.height = needed + "px";
    }
  };

  useEffect(() => autoResizeTextarea(notesRef.current), [notes]);

  // Clear any pending sync timer
  // Letter transcription handler (transcribes only the letter, not extras)
  const handleTranscribeLetter = useCallback(
    async (skipConfirm = false): Promise<boolean> => {
      if (!letterId || !letter) return false;

      // Check if transcript already has content — show regenerate popup
      if (!skipConfirm && letter.transcript.fullText.trim()) {
        setShowTranscriptRegeneratePopup(true);
        return false;
      }

      setShowTranscriptRegeneratePopup(false);
      const releaseSaving = beginSaving();

      try {
        if (!visit.isActive() || !await flushPendingSaves()) return false;

        setLetterTranscribeState("transcribing");
        setLetterTranscribeMessage("Transcribing letter...");
        const result = await transcribeLetter(
          letterId,
          letter.primarySourceRevision,
        );

        if (!tryAdoptLetter(result.letter)) return false;
        hydrateAdoptedLetter(result.letter);

        setLetterTranscribeState("done");
        setLetterTranscribeMessage(
          `Transcribed ${result.transcribed.pageCount} page(s)`,
        );
        showToast(
          `Letter transcribed (${result.transcribed.pageCount} page(s))`,
          "success",
        );

        scheduleStatusReset("transcription", () => {
          setLetterTranscribeState("idle");
          setLetterTranscribeMessage(null);
        }, 3000);
        return true;
      } catch (err) {
        if (visit.isActive()) {
          setLetterTranscribeState("idle");
          setLetterTranscribeMessage(null);
        }
        handleMutationError(err, "Transcription failed");
        console.error("Letter transcription error:", err);
        return false;
      } finally {
        releaseSaving();
      }
    },
    [
      beginSaving,
      flushPendingSaves,
      handleMutationError,
      hydrateAdoptedLetter,
      letterId,
      letter,
      scheduleStatusReset,
      showToast,
      tryAdoptLetter,
      visit,
    ],
  );

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

  const handleConfirmTranscript = useCallback(() => {
    if (!letterId) return;
    setExtractionSender(sender || "");
    setExtractionRecipient(recipient || "");
    setShowExtractionPopup(true);
  }, [letterId, recipient, sender]);

  const executeConfirmTranscript = useCallback(async () => {
    if (!letterId || !letter) return;
    setShowExtractionPopup(false);
    const releaseSaving = beginSaving();

    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      const updated = await confirmTranscript(
        letterId,
        letter.primarySourceRevision,
        {
          confirmedSender: extractionSender || undefined,
          confirmedRecipient: extractionRecipient || undefined,
        },
      );
      if (!tryAdoptLetter(updated)) return;
      hydrateAdoptedLetter(updated);
      showToast(
        "Transcript confirmed — metadata extracted",
        "success",
      );
    } catch (err) {
      handleMutationError(err, "Failed to confirm transcript");
      console.error("Confirm transcript error:", err);
    } finally {
      releaseSaving();
    }
  }, [
    beginSaving,
    extractionRecipient,
    extractionSender,
    flushPendingSaves,
    handleMutationError,
    hydrateAdoptedLetter,
    letter,
    letterId,
    showToast,
    tryAdoptLetter,
    visit,
  ]);

  // Regenerate metadata handler — shows popup for options
  const handleRegenerateMetadata = useCallback(() => {
    if (!letterId) return;
    setExtractionSender(sender || "");
    setExtractionRecipient(recipient || "");
    setShowMetadataRegeneratePopup(true);
  }, [letterId, recipient, sender]);

  // Execute metadata regeneration (metadata only)
  const executeMetadataRegenerate = useCallback(async () => {
    if (!letterId || !letter) return;
    setShowMetadataRegeneratePopup(false);
    const releaseSaving = beginSaving();
    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      setRegenerateState("regenerating");
      const updated = await regenerateMetadata(
        letterId,
        letter.primarySourceRevision,
        {
          confirmedSender: extractionSender || undefined,
          confirmedRecipient: extractionRecipient || undefined,
        },
      );
      if (!tryAdoptLetter(updated)) return;
      hydrateAdoptedLetter(updated);
      setRegenerateState("done");
      showToast("Metadata regenerated", "success");

      scheduleStatusReset("metadata-regeneration", () => {
        setRegenerateState("idle");
      }, 2000);
    } catch (err) {
      if (visit.isActive()) setRegenerateState("idle");
      handleMutationError(err, "Failed to regenerate metadata");
      console.error("Regenerate metadata error:", err);
    } finally {
      releaseSaving();
    }
  }, [
    beginSaving,
    extractionRecipient,
    extractionSender,
    flushPendingSaves,
    handleMutationError,
    hydrateAdoptedLetter,
    letter,
    letterId,
    scheduleStatusReset,
    showToast,
    tryAdoptLetter,
    visit,
  ]);

  // Re-extract handler — calls the re-extract API with corrected sender/recipient
  const handleReExtract = useCallback(
    async (
      mode: "full" | "metadata_only" | "entities_only",
      skipConfirm = false,
      nameOverrides?: { sender?: string; recipient?: string },
    ) => {
      if (!letterId || !letter) return;

      if (!skipConfirm) {
        const confirmMsg = mode === "entities_only"
          ? "Re-extract entities from the transcript? This will overwrite current entity data."
          : "Re-extract all metadata and entities? This will overwrite current data.";
        if (!window.confirm(confirmMsg)) return;
      }

      const isEntityOnly = mode === "entities_only";
      const releaseSaving = beginSaving();

      try {
        if (!visit.isActive() || !await flushPendingSaves()) return;

        if (isEntityOnly) {
          setEntityReExtractState("extracting");
        } else {
          setReExtractState("extracting");
        }
        const updated = await reExtractLetter(letterId, {
          primarySourceRevision: letter.primarySourceRevision,
          confirmedSender: nameOverrides?.sender || sender || undefined,
          confirmedRecipient: nameOverrides?.recipient || recipient || undefined,
          mode,
        });

        if (!tryAdoptLetter(updated)) return;
        hydrateAdoptedLetter(updated);

        if (!isEntityOnly) {
          setReExtractState("done");
          showToast("Metadata re-extracted with corrections", "success");

          scheduleStatusReset("metadata-reextract", () => {
            setReExtractState("idle");
          }, 2000);
        } else {
          setEntityReExtractState("done");
          showToast("Entities re-extracted", "success");

          scheduleStatusReset("entity-reextract", () => {
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
        if (visit.isActive()) {
          if (isEntityOnly) {
            setEntityReExtractState("idle");
          } else {
            setReExtractState("idle");
          }
        }
        handleMutationError(err, "Re-extraction failed");
        console.error("Re-extract error:", err);
      } finally {
        releaseSaving();
      }
    },
    [
      beginSaving,
      flushPendingSaves,
      handleMutationError,
      hydrateAdoptedLetter,
      letterId,
      letter,
      recipient,
      scheduleStatusReset,
      sender,
      showToast,
      tryAdoptLetter,
      visit,
    ],
  );

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

  const handlePageChange = useCallback((index: number, image: LetterImage) => {
    setCurrentFilename(image.originalFilename);
    setViewerPageIndex(index);
  }, []);

  const isPageSepNode = useCallback((node: Node): boolean => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      return el.classList.contains("page-sep");
    }
    return false;
  }, []);

  // Handle Tab key to insert spaces instead of changing focus (for transcript editor)
  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand("insertText", false, "    ");
      return;
    }

    // Prevent deleting page separators
    if (e.key === "Backspace" || e.key === "Delete") {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return;
      const node = sel.focusNode;
      if (!node) return;

      // Check if adjacent node is a page separator
      const isInEditor = editorRef.current?.contains(node);
      if (!isInEditor) return;

      if (e.key === "Backspace") {
        // Check the node/element just before cursor
        const prev = sel.focusOffset === 0
          ? node.previousSibling || node.parentElement?.previousSibling
          : null;
        if (prev && isPageSepNode(prev)) {
          e.preventDefault();
        }
      } else {
        // Delete key: check element just after cursor
        const parent = node.parentNode;
        const next = node.nodeType === Node.TEXT_NODE && sel.focusOffset === node.textContent?.length
          ? node.nextSibling || parent?.nextSibling
          : null;
        if (next && isPageSepNode(next)) {
          e.preventDefault();
        }
      }
    }
  }, [isPageSepNode]);

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

  const handleImageClick = useCallback((pageIndex: number) => {
    if (
      !letter ||
      !hasPrimaryTranscriptContent(letter) ||
      isTranscriptEditing ||
      extraContentWorkspace.lineReviewBlocked
    ) {
      return;
    }
    setViewerPageIndex(pageIndex);
    setReviewMode(true);
  }, [
    extraContentWorkspace.lineReviewBlocked,
    isTranscriptEditing,
    letter,
  ]);

  const handleReaderTextChange = useCallback((text: string) => {
    startTransition(() => {
      setReaderText(text);
    });
    void triggerAutoSave({ readingText: text });
  }, [triggerAutoSave]);

  const handleGenerateReadingView = useCallback(async () => {
    if (!letterId || !letter) return;
    const releaseSaving = beginSaving();
    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      setReadingViewGenerating(true);
      const updated = await generateReadingView(
        letterId,
        letter.primarySourceRevision,
      );
      if (!tryAdoptLetter(updated)) return;
      hydrateAdoptedLetter(updated);
      showToast("Reading view generated", "success");
    } catch (error) {
      handleMutationError(error, "Failed to generate reading view");
    } finally {
      if (visit.isActive()) setReadingViewGenerating(false);
      releaseSaving();
    }
  }, [
    beginSaving,
    flushPendingSaves,
    handleMutationError,
    hydrateAdoptedLetter,
    letter,
    letterId,
    showToast,
    tryAdoptLetter,
    visit,
  ]);

  const handleMetadataAutoSave = useCallback((updates: AutoSaveData) => {
    void triggerAutoSave(updates);
  }, [triggerAutoSave]);

  const handleReExtractEntities = useCallback(() => {
    void handleReExtract("entities_only");
  }, [handleReExtract]);

  const handleTranscriptFromLineReview = useCallback((newText: string) => {
    startTransition(() => {
      setTranscript(newText);
    });
  }, []);

  const handleLineReviewAutoSave = useCallback((data: AutoSaveData) => {
    void triggerAutoSave(data);
  }, [triggerAutoSave]);

  const handlePersonalNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    startTransition(() => {
      setNotes(nextValue);
    });
    void triggerAutoSave({ notes: nextValue || null });
  }, [triggerAutoSave, setNotes]);

  // Line highlighting - update on cursor move
  useEffect(() => {
    const transcriptStatus = letter?.transcriptStatus;
    const isEditing =
      (transcriptStatus !== undefined && transcriptStatus !== "VERIFIED") ||
      isTranscriptEditing;

    const handleSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor || !isEditing) {
        setCurrentLineIndex(null);
        setSelectedText("");
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setCurrentLineIndex(null);
        setSelectedText("");
        return;
      }

      // Check if selection is within the editor
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        setCurrentLineIndex(null);
        setSelectedText("");
        return;
      }

      // Track selected text for mapping
      const selText = selection.toString().trim();
      setSelectedText(selText);

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
            onClick={() => lineReviewRef.current?.reloadSegments()}
            disabled={lineReviewRef.current?.isLoading}
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
        {reviewMode ? (
          <LineReviewMode
            ref={lineReviewRef}
            letter={letter}
            transcript={transcript}
            onTranscriptChange={handleTranscriptFromLineReview}
            onExit={() => {
              setReviewMode(false);
              setSegmentFirstMode(false);
              setMappingText(undefined);
            }}
            onAutoSave={handleLineReviewAutoSave}
            handleMutationError={handleMutationError}
            mutationsBlocked={mutationsBlocked}
            debugMode={debugMode}
            onDebugModeChange={setDebugMode}
            initialPageIndex={viewerPageIndex}
            fullViewport={segmentFirstMode}
            mappingText={mappingText}
            onMappingComplete={() => {
              setMappingText(undefined);
              // Re-fetch letter to reflect updated segment data
              if (letterId) {
                void getAdminLetterById(letterId).then((updated) => {
                  setLetter(updated);
                });
              }
            }}
          />
        ) : (
        <ResizableSplitPane
          letterId={letterId}
          className="review-layout"
          firstPanelClassName="images-panel"
          secondPanelClassName="edit-panel"
          forceSplit={transcriptViewMode === "preview" ? 0.4 : undefined}
        >
          {/* Left side: Letter viewer */}
          <div className="image-review-shell">
            <LetterViewer
              images={letter.images}
              letterId={letterId}
              showOnlyLetterPages={false}
              onPageChange={handlePageChange}
              onImageClick={handleImageClick}
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
                  {selectedText.length > 0 && (
                    <button
                      className="unmapped-segment-map-btn"
                      onClick={() => {
                        setMappingText(selectedText);
                        setReviewMode(true);
                        setSegmentFirstMode(true);
                      }}
                    >
                      Map to Segment
                    </button>
                  )}
                  <button
                    className="unmapped-segment-review-btn"
                    onClick={() => {
                      setReviewMode(true);
                      setSegmentFirstMode(true);
                    }}
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
                letterTranscribeState={letterTranscribeState}
                letterTranscribeMessage={letterTranscribeMessage}
                isTranscriptEditing={isTranscriptEditing}
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
                onViewModeChange={handleViewModeChange}
                readerText={readerText ?? ""}
                onReaderTextChange={handleReaderTextChange}
                hideReadingView={getPrimaryImageType(letter) !== "letter"}
                onGenerateReadingView={handleGenerateReadingView}
                readingViewGenerating={readingViewGenerating}
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
                regenerateState={regenerateState}
                identityUpdateState={identityUpdateState}
                identityUpdateSecondsRemaining={identityUpdateSecondsRemaining}
                retagState={retagState}
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
            )}

            {/* Entity Extraction Section */}
            {showMetadataSections && letter.entityExtractionJson ? (
              <EntitySection
                entityExtractionJson={letter.entityExtractionJson}
                senderName={letter.metadata.sender}
                recipientName={letter.metadata.recipient}
                reExtractState={entityReExtractState}
                onReExtractEntities={handleReExtractEntities}
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
                  void handleTranscribeLetter(true);
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
                    void extraContentWorkspace.transcribe({
                      confirmReplacement: false,
                    });
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
                    if (
                      !await handleTranscribeLetter(true)
                      || !visit.isActive()
                    ) {
                      return;
                    }
                    await extraContentWorkspace.transcribe({
                      confirmReplacement: false,
                    });
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

      <IdentityExtractionModal
        isOpen={showExtractionPopup}
        onClose={() => setShowExtractionPopup(false)}
        onConfirm={() => void executeConfirmTranscript()}
        sender={extractionSender}
        recipient={extractionRecipient}
        onSenderChange={setExtractionSender}
        onRecipientChange={setExtractionRecipient}
        submitting={saving}
        mode="extract"
        letterTitle={letter?.title}
      />

      {/* Regenerate Metadata popup */}
      {showMetadataRegeneratePopup && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowMetadataRegeneratePopup(false)}
        >
          <div className="confirm-dialog regenerate-popup" onClick={(e) => e.stopPropagation()}>
            <h3>Regenerate Analysis</h3>
            <p>Choose what to regenerate. This will overwrite the existing data.</p>
            <div className="extraction-popup-fields regenerate-name-fields">
              <div className="form-group">
                <label htmlFor="regen-sender">Sender</label>
                <input
                  type="text"
                  id="regen-sender"
                  value={extractionSender}
                  onChange={(e) => setExtractionSender(e.target.value)}
                  placeholder="Leave blank if unknown"
                />
              </div>
              <div className="form-group">
                <label htmlFor="regen-recipient">Recipient</label>
                <input
                  type="text"
                  id="regen-recipient"
                  value={extractionRecipient}
                  onChange={(e) => setExtractionRecipient(e.target.value)}
                  placeholder="Leave blank if unknown"
                />
              </div>
            </div>
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
                  handleReExtract("entities_only", true, {
                    sender: extractionSender,
                    recipient: extractionRecipient,
                  });
                }}
              >
                <Icon name="person" size={16} />
                <span>Entities Only</span>
              </button>
              <button
                className="btn-option"
                onClick={() => {
                  setShowMetadataRegeneratePopup(false);
                  handleReExtract("full", true, {
                    sender: extractionSender,
                    recipient: extractionRecipient,
                  });
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
