import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import {
  updateLetter,
  confirmTranscript,
  regenerateMetadata,
  verifyTranscript,
  unverifyTranscript,
  verifyMetadata,
  unverifyMetadata,
  createVersion,
  transcribeExtras,
  updateExtraContent,
  verifyExtraContent,
  unverifyExtraContent,
  transcribeLetter,
} from "../../api/admin";
import { toggleLetterFlag, reExtractLetter, updateIdentity, updateNoteStatus, addNote } from "../../api/admin/letters";
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
import type {
  Letter,
  LetterImage,
  VisibilityState,
  EmotionalTone,
  RelationshipType,
} from "../../types/Letter";
import TranscriptionSection from "./LetterReview/TranscriptionSection";
import { ExtraContentSection } from "./LetterReview/ExtraContentSection";
import MetadataSection from "./LetterReview/MetadataSection";
import EntitySection from "./LetterReview/EntitySection";
import NotesSection from "./LetterReview/NotesSection";
import LineReviewMode, {
  type LineReviewModeHandle,
} from "../../components/LineReviewMode/LineReviewMode";
import "./LetterReviewPage.css";

export default function LetterReviewPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [transcript, setTranscript] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [date, setDate] = useState("");
  const [dateConfidence, setDateConfidence] = useState<
    "exact" | "unknown" | "inferred"
  >("unknown");
  const [location, setLocation] = useState("");
  const [hook, setHook] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  // V2 Metadata state
  const [emotionalTone, setEmotionalTone] = useState<EmotionalTone | "">("");
  const [relationship, setRelationship] = useState<RelationshipType | "">("");
  const [primaryTopics, setPrimaryTopics] = useState<string[]>([]);
  const [topicsDropdownOpen, setTopicsDropdownOpen] = useState(false);

  // Extra content state
  const [extraContent, setExtraContent] = useState("");
  const [extraContentTranscribing, setExtraContentTranscribing] =
    useState(false);

  // Extra content refs
  const extraContentRef = useRef<DynamicEditorRef>(null);

  // Track original identity values for re-sync detection
  const [originalSender, setOriginalSender] = useState("");
  const [originalRecipient, setOriginalRecipient] = useState("");

  // Metadata regeneration state
  const [regenerateState, setRegenerateState] = useState<
    "idle" | "regenerating" | "done"
  >("idle");

  // Re-extraction state (for metadata re-extract with corrected identity)
  const [reExtractState, setReExtractState] = useState<
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

  // Confirmation dialog state (for transcription when content exists)
  const [showTranscribeConfirm, setShowTranscribeConfirm] = useState(false);
  const [showExtrasTranscribeConfirm, setShowExtrasTranscribeConfirm] =
    useState(false);

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track transient status-reset timeouts for cleanup on unmount
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transcriptFontSize, setTranscriptFontSize] = useState("1.1rem");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(
    undefined,
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const lineReviewRef = useRef<LineReviewModeHandle>(null);

  // Verified transcript editing flow state
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [originalTranscriptText, setOriginalTranscriptText] = useState<
    string | null
  >(null);
  const [originalTranscriptVerified, setOriginalTranscriptVerified] =
    useState(false);
  const [hasTranscriptChanges, setHasTranscriptChanges] = useState(false);
  const [showEditTooltip, setShowEditTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Verified metadata editing flow state
  const [showMetadataTooltip, setShowMetadataTooltip] = useState(false);
  const [metadataTooltipPosition, setMetadataTooltipPosition] = useState({
    x: 0,
    y: 0,
  });
  const metadataTooltipTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Verified extra content editing flow state
  const [isExtraContentEditing, setIsExtraContentEditing] = useState(false);
  const [showExtraContentTooltip, setShowExtraContentTooltip] = useState(false);
  const [extraContentTooltipPosition, setExtraContentTooltipPosition] =
    useState({ x: 0, y: 0 });
  const extraContentTooltipTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Line highlighting state
  const [_currentLineIndex, setCurrentLineIndex] = useState<number | null>(
    null,
  );
  const [reviewMode, setReviewMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const hookRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Cleanup transient status timeouts on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

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
          setSender(foundLetter.metadata.sender || "");
          setRecipient(foundLetter.metadata.recipient || "");
          setDate(foundLetter.metadata.date || "");
          setDateConfidence(foundLetter.metadata.dateConfidence || "unknown");
          setLocation(foundLetter.metadata.location || "");
          setHook(foundLetter.metadata.hook || "");
          setDescription(foundLetter.metadata.description || "");
          setNotes(foundLetter.metadata.notes || "");
          // V2 metadata
          setEmotionalTone(foundLetter.metadata.emotionalTone || "");
          setRelationship(
            foundLetter.metadata.senderRecipientRelationship || "",
          );
          setPrimaryTopics(foundLetter.metadata.primaryTopics || []);
          // Store original values for AI sync detection
          setOriginalSender(foundLetter.metadata.sender || "");
          setOriginalRecipient(foundLetter.metadata.recipient || "");
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
  }, [letterId, navigate]);

  // Calculate font size based on longest line to prevent wrapping
  const calculateFontSize = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !transcript) {
      setTranscriptFontSize("1.1rem");
      return;
    }

    // Get computed styles for padding and font
    const computedStyle = window.getComputedStyle(editor);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const containerWidth = editor.clientWidth - paddingLeft - paddingRight;
    const lines = transcript.split("\n");
    const baseFontSize = 1.1; // rem

    // Create canvas for measuring text
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use computed font to match actual rendering
    const fontFamily = computedStyle.fontFamily || "inherit";
    ctx.font = `${baseFontSize * 16}px ${fontFamily}`; // Convert rem to px (assuming 16px base)

    // Find the widest line
    let maxWidth = 0;
    for (const line of lines) {
      if (line.trim()) {
        const width = ctx.measureText(line).width;
        if (width > maxWidth) maxWidth = width;
      }
    }

    // Calculate scale factor (with a minimum to prevent text being too small)
    if (maxWidth > containerWidth) {
      const scale = Math.max(0.4, containerWidth / maxWidth); // Don't go below 40%
      setTranscriptFontSize(`${baseFontSize * scale}rem`);
    } else {
      setTranscriptFontSize(`${baseFontSize}rem`);
    }
  }, [transcript]);

  // Recalculate font size when transcript changes or on container resize
  useEffect(() => {
    calculateFontSize();

    // Use ResizeObserver to detect container size changes (from split pane drag)
    const editor = editorRef.current;
    // Also observe the parent container which actually resizes with the split pane
    const editorContainer = editor?.parentElement;

    if (editor || editorContainer) {
      const resizeObserver = new ResizeObserver(() => {
        calculateFontSize();
      });
      if (editor) resizeObserver.observe(editor);
      if (editorContainer) resizeObserver.observe(editorContainer);
      return () => resizeObserver.disconnect();
    }

    // Fallback: window resize
    window.addEventListener("resize", calculateFontSize);
    return () => window.removeEventListener("resize", calculateFontSize);
  }, [calculateFontSize]);

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
      // Recalculate font size after content is set
      calculateFontSize();
    }
  }, [transcript, reviewMode, calculateFontSize]);

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

      // Check if transcript already has content and show confirmation
      if (!skipConfirm && letter.transcript.fullText.trim()) {
        setShowTranscribeConfirm(true);
        return;
      }

      setShowTranscribeConfirm(false);
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

        // Clear done state after a moment
        statusTimeoutRef.current = setTimeout(() => {
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
    [letterId, letter, showToast],
  );

  // Extra content transcription handler with confirmation
  const handleTranscribeExtrasWithConfirm = useCallback(
    async (skipConfirm = false) => {
      if (!letterId || !letter) return;

      // Check if extra content already has content and show confirmation
      if (!skipConfirm && letter.extraContentTranscript?.trim()) {
        setShowExtrasTranscribeConfirm(true);
        return;
      }

      setShowExtrasTranscribeConfirm(false);
      // Use existing handleTranscribeExtras logic
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
      // Populate form fields with extracted metadata
      setSender(updated.metadata.sender || "");
      setRecipient(updated.metadata.recipient || "");
      setDate(updated.metadata.date || "");
      setDateConfidence(updated.metadata.dateConfidence || "unknown");
      setLocation(updated.metadata.location || "");
      setHook(updated.metadata.hook || "");
      setDescription(updated.metadata.description || "");
      setEmotionalTone(updated.metadata.emotionalTone || "");
      setRelationship(updated.metadata.senderRecipientRelationship || "");
      setPrimaryTopics(updated.metadata.primaryTopics || []);
      setOriginalSender(updated.metadata.sender || "");
      setOriginalRecipient(updated.metadata.recipient || "");
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

  // Regenerate metadata handler
  const handleRegenerateMetadata = async () => {
    if (!letterId) return;

    setRegenerateState("regenerating");
    try {
      const updated = await regenerateMetadata(letterId);
      setLetter(updated);
      // Update form fields with new metadata
      setSender(updated.metadata.sender || "");
      setRecipient(updated.metadata.recipient || "");
      setDate(updated.metadata.date || "");
      setDateConfidence(updated.metadata.dateConfidence || "unknown");
      setLocation(updated.metadata.location || "");
      setHook(updated.metadata.hook || "");
      setDescription(updated.metadata.description || "");
      setEmotionalTone(updated.metadata.emotionalTone || "");
      setRelationship(updated.metadata.senderRecipientRelationship || "");
      setPrimaryTopics(updated.metadata.primaryTopics || []);
      // Update original values for sync detection
      setOriginalSender(updated.metadata.sender || "");
      setOriginalRecipient(updated.metadata.recipient || "");
      setRegenerateState("done");
      showToast("Metadata regenerated", "success");

      // Reset state after a moment
      statusTimeoutRef.current = setTimeout(() => {
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
    async (mode: "full" | "metadata_only" | "entities_only") => {
      if (!letterId || !letter) return;

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
          // Update form fields with fresh metadata
          setSender(updated.metadata.sender || "");
          setRecipient(updated.metadata.recipient || "");
          setDate(updated.metadata.date || "");
          setDateConfidence(updated.metadata.dateConfidence || "unknown");
          setLocation(updated.metadata.location || "");
          setHook(updated.metadata.hook || "");
          setDescription(updated.metadata.description || "");
          setEmotionalTone(updated.metadata.emotionalTone || "");
          setRelationship(
            updated.metadata.senderRecipientRelationship || "",
          );
          setPrimaryTopics(updated.metadata.primaryTopics || []);
          // Update original values so the notification bar dismisses
          setOriginalSender(updated.metadata.sender || "");
          setOriginalRecipient(updated.metadata.recipient || "");

          setReExtractState("done");
          showToast("Metadata re-extracted with corrections", "success");

          statusTimeoutRef.current = setTimeout(() => {
            setReExtractState("idle");
          }, 2000);
        } else {
          setEntityReExtractState("done");
          showToast("Entities re-extracted", "success");

          statusTimeoutRef.current = setTimeout(() => {
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
    [letterId, letter, sender, recipient, showToast],
  );

  // Auto-save function (debounced)
  const triggerAutoSave = useCallback(
    async (data: {
      transcriptionText?: string;
      sender?: string | null;
      recipient?: string | null;
      locationWritten?: string | null;
      hook?: string | null;
      summary?: string | null;
      notes?: string | null;
    }) => {
      if (!letterId || !letter) return;

      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Sender/recipient changes go through the smart identity endpoint IMMEDIATELY (no debounce)
      const hasSenderChange = data.sender !== undefined;
      const hasRecipientChange = data.recipient !== undefined;

      if (hasSenderChange || hasRecipientChange) {
        // Immediate identity update — no timer
        setAutoSaveStatus("saving");
        try {
          const identityData: { sender?: string; recipient?: string } = {};
          if (hasSenderChange) identityData.sender = data.sender || '';
          if (hasRecipientChange) identityData.recipient = data.recipient || '';
          const updated = await updateIdentity(letterId, identityData);
          setLetter(updated);
          // Refresh form state with propagated values
          setSender(updated.metadata.sender || "");
          setRecipient(updated.metadata.recipient || "");
          setHook(updated.metadata.hook || "");
          setDescription(updated.metadata.description || "");
          setAutoSaveStatus("saved");
          showToast("Name updated across metadata", "success");

          // Also save any other fields that changed alongside
          const otherData = { ...data };
          delete otherData.sender;
          delete otherData.recipient;
          if (Object.keys(otherData).length > 0) {
            await updateLetter(letterId, otherData);
          }
        } catch (err) {
          setAutoSaveStatus("error");
          showToast(getErrorMessage(err, "Failed to update name"), "error");
        }
        return;
      }

      // Set up debounced save for non-identity fields
      autoSaveTimerRef.current = setTimeout(async () => {
        setAutoSaveStatus("saving");
        try {
          const updated = await updateLetter(letterId, data);
          setLetter(updated);

          // Create version for transcript
          if (data.transcriptionText !== undefined) {
            await createVersion(
              letterId,
              "transcript",
              data.transcriptionText,
              "human",
            );
          }

          // Create version for metadata (if any metadata field changed)
          if (
            data.sender !== undefined ||
            data.recipient !== undefined ||
            data.locationWritten !== undefined ||
            data.hook !== undefined ||
            data.summary !== undefined
          ) {
            await createVersion(
              letterId,
              "metadata",
              {
                sender: data.sender ?? letter.metadata.sender,
                recipient: data.recipient ?? letter.metadata.recipient,
                locationWritten:
                  data.locationWritten ?? letter.metadata.location,
                hook: data.hook ?? letter.metadata.hook,
                summary: data.summary ?? letter.metadata.description,
              },
              "human",
            );
          }

          setAutoSaveStatus("saved");

          // Track edit
          trackEdit({
            id: updated.id,
            metadata: updated.metadata,
            collectionCode: updated.collectionCode,
          });
        } catch (err) {
          setAutoSaveStatus("error");
          console.error("Auto-save error:", err);
          showToast(getErrorMessage(err, "Save failed"), "error");
        }
      }, 1500);
    },
    [letterId, letter, showToast],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Handlers for transcript verification
  const handleVerifyTranscript = async () => {
    if (!letterId) return;
    setSaving(true);
    try {
      const updated = await verifyTranscript(letterId);
      setLetter(updated);
      // Reset editing state since we're now verified
      setIsTranscriptEditing(false);
      setOriginalTranscriptText(null);
      setOriginalTranscriptVerified(false);
      setHasTranscriptChanges(false);
      showToast("Transcript verified", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to verify transcript",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  // Handlers for metadata verification
  const handleVerifyMetadata = async () => {
    if (!letterId) return;

    setSaving(true);
    try {
      const updated = await verifyMetadata(letterId);
      setLetter(updated);
      showToast("Metadata verified", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to verify metadata",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

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

  // Verified transcript editing flow handlers
  const handleTranscriptClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        !letter?.transcriptStatus ||
        letter.transcriptStatus !== "VERIFIED" ||
        isTranscriptEditing
      )
        return;

      // Show tooltip near click position
      setTooltipPosition({ x: e.clientX, y: e.clientY });
      setShowEditTooltip(true);

      // Clear existing timeout
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }

      // Auto-dismiss after 3 seconds
      tooltipTimeoutRef.current = setTimeout(() => {
        setShowEditTooltip(false);
      }, 3000);
    },
    [letter?.transcriptStatus, isTranscriptEditing],
  );

  const handleTranscriptDoubleClick = useCallback(async () => {
    if (
      !letter?.transcriptStatus ||
      letter.transcriptStatus !== "VERIFIED" ||
      !letterId
    )
      return;

    // Dismiss tooltip
    setShowEditTooltip(false);
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }

    // Store original state for potential revert
    setOriginalTranscriptText(transcript);
    setOriginalTranscriptVerified(true);

    // Unverify via API
    setSaving(true);
    try {
      const updated = await unverifyTranscript(letterId);
      setLetter(updated);
      setIsTranscriptEditing(true);
      setHasTranscriptChanges(false);
      showToast("Verification removed", "info");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to unverify transcript",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letter?.transcriptStatus, letterId, transcript, showToast]);

  const handleTranscriptRevert = useCallback(async () => {
    if (!letterId || originalTranscriptText === null) return;

    // Show confirmation dialog
    if (!window.confirm("Discard all changes since editing started?")) {
      return;
    }

    setSaving(true);
    try {
      // Restore original text
      const updated = await updateLetter(letterId, {
        transcriptionText: originalTranscriptText,
      });
      setLetter(updated);
      setTranscript(originalTranscriptText);

      // Update contenteditable with highlighted markers
      if (editorRef.current) {
        editorRef.current.innerHTML = highlightTranscriptMarkers(originalTranscriptText);
      }

      // If was originally verified, re-verify
      if (originalTranscriptVerified) {
        const verifiedLetter = await verifyTranscript(letterId);
        setLetter(verifiedLetter);
        showToast("Changes reverted and verification restored", "success");
      } else {
        showToast("Changes reverted", "success");
      }

      // Reset editing state
      setIsTranscriptEditing(false);
      setOriginalTranscriptText(null);
      setOriginalTranscriptVerified(false);
      setHasTranscriptChanges(false);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to revert changes",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letterId, originalTranscriptText, originalTranscriptVerified, showToast]);

  // Cleanup tooltip timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      if (metadataTooltipTimeoutRef.current) {
        clearTimeout(metadataTooltipTimeoutRef.current);
      }
    };
  }, []);

  // Verified metadata editing flow handlers
  const handleMetadataFieldClick = useCallback(
    (e: React.MouseEvent) => {
      if (letter?.metadataContentStatus !== "VERIFIED") return;

      // Show tooltip near click position
      setMetadataTooltipPosition({ x: e.clientX, y: e.clientY });
      setShowMetadataTooltip(true);

      // Clear existing timeout
      if (metadataTooltipTimeoutRef.current) {
        clearTimeout(metadataTooltipTimeoutRef.current);
      }

      // Auto-dismiss after 3 seconds
      metadataTooltipTimeoutRef.current = setTimeout(() => {
        setShowMetadataTooltip(false);
      }, 3000);
    },
    [letter?.metadataContentStatus],
  );

  const handleMetadataFieldDoubleClick = useCallback(async () => {
    if (letter?.metadataContentStatus !== "VERIFIED" || !letterId) return;

    // Dismiss tooltip
    setShowMetadataTooltip(false);
    if (metadataTooltipTimeoutRef.current) {
      clearTimeout(metadataTooltipTimeoutRef.current);
    }

    // Unverify via API
    setSaving(true);
    try {
      const updated = await unverifyMetadata(letterId);
      setLetter(updated);
      showToast("Verification removed", "info");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to unverify metadata",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [letter?.metadataContentStatus, letterId, showToast]);

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

      // Show tooltip near click position
      setExtraContentTooltipPosition({ x: e.clientX, y: e.clientY });
      setShowExtraContentTooltip(true);

      // Clear existing timeout
      if (extraContentTooltipTimeoutRef.current) {
        clearTimeout(extraContentTooltipTimeoutRef.current);
      }

      // Auto-dismiss after 3 seconds
      extraContentTooltipTimeoutRef.current = setTimeout(() => {
        setShowExtraContentTooltip(false);
      }, 3000);
    },
    [letter?.extraContentStatus, isExtraContentEditing],
  );

  const handleExtraContentDoubleClick = useCallback(async () => {
    if (
      !letter?.extraContentStatus ||
      letter.extraContentStatus !== "VERIFIED" ||
      !letterId
    )
      return;

    // Dismiss tooltip
    setShowExtraContentTooltip(false);
    if (extraContentTooltipTimeoutRef.current) {
      clearTimeout(extraContentTooltipTimeoutRef.current);
    }

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
  }, [letter?.extraContentStatus, letterId, showToast]);

  // Extra content auto-save
  const handleExtraContentChange = useCallback(
    (newContent: string) => {
      setExtraContent(newContent);
      if (!letterId) return;

      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Set up debounced save
      autoSaveTimerRef.current = setTimeout(async () => {
        setAutoSaveStatus("saving");
        try {
          const updated = await updateExtraContent(letterId, newContent);
          setLetter(updated);
          setAutoSaveStatus("saved");
        } catch (err) {
          setAutoSaveStatus("error");
          console.error("Extra content auto-save error:", err);
          showToast(getErrorMessage(err, "Failed to save extra content"), "error");
        }
      }, 1500);
    },
    [letterId, showToast],
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
  const hasExtras = letter.images.some((img) =>
    ["telegram", "cover", "ephemera"].includes(img.type)
  );

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
            onAutoSave={triggerAutoSave}
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
                saving={saving}
                editorRef={editorRef}
                onTranscribeLetter={handleTranscribeLetter}
                onVerifyTranscript={handleVerifyTranscript}
                onTranscriptClick={handleTranscriptClick}
                onTranscriptDoubleClick={handleTranscriptDoubleClick}
                onTranscriptInput={(newText) => {
                  setTranscript(newText);
                  setHasTranscriptChanges(
                    originalTranscriptText !== null &&
                      newText !== originalTranscriptText,
                  );
                  triggerAutoSave({ transcriptionText: newText });
                }}
                onEditorKeyDown={handleEditorKeyDown}
              />
            )}

            {/* Extra Content Section - only shown when letter has transcribable extras */}
            {hasExtras && (
              <ExtraContentSection
                letter={letter}
                extraContent={extraContent}
                extraContentTranscribing={extraContentTranscribing}
                isExtraContentEditing={isExtraContentEditing}
                showExtraContentTooltip={showExtraContentTooltip}
                extraContentTooltipPosition={extraContentTooltipPosition}
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
            )}

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
              originalSender={originalSender}
              originalRecipient={originalRecipient}
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
                triggerAutoSave(
                  updates as Parameters<typeof triggerAutoSave>[0],
                )
              }
              hookRef={hookRef}
              descriptionRef={descriptionRef}
              regenerateState={regenerateState}
              reExtractState={reExtractState}
              onReExtract={handleReExtract}
              onVerifyMetadata={handleVerifyMetadata}
              onConfirmTranscript={handleConfirmTranscript}
              onRegenerateMetadata={handleRegenerateMetadata}
              onMetadataFieldClick={handleMetadataFieldClick}
              onMetadataFieldDoubleClick={handleMetadataFieldDoubleClick}
              showMetadataTooltip={showMetadataTooltip}
              metadataTooltipPosition={metadataTooltipPosition}
              saving={saving}
              showToast={showToast}
            />

            {/* Entity Extraction Section */}
            {letter.entityExtractionJson && (
              <EntitySection
                entityExtractionJson={letter.entityExtractionJson}
                reExtractState={entityReExtractState}
                onReExtractEntities={() => handleReExtract("entities_only")}
              />
            )}

            {/* AI Notes Section (structured) */}
            <NotesSection
              notes={letter.aiNotes as import("./LetterReview/NotesSection").StructuredNote[] | string | null}
              letterId={letterId!}
              onNoteStatusChange={handleNoteStatusChange}
              onAddNote={handleAddNote}
            />

            {/* Admin Notes Section */}
            <div className="editor-section notes-section">
              <div className="notes-section-header">
                <span className="help-text">Internal reference only</span>
              </div>
              <div className="notes-container">
                <div className="form-group">
                  <label htmlFor="notes">Admin Notes</label>
                  <textarea
                    ref={notesRef}
                    id="notes"
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      triggerAutoSave({ notes: e.target.value || null });
                    }}
                    placeholder="Internal notes (not shown publicly)"
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

      {/* Confirmation dialog for letter transcription */}
      {showTranscribeConfirm && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowTranscribeConfirm(false)}
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Replace Transcription?</h3>
            <p>
              This letter already has a transcription. Are you sure you want to
              replace it?
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowTranscribeConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="btn-confirm"
                onClick={() => handleTranscribeLetter(true)}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation dialog for extra content transcription */}
      {showExtrasTranscribeConfirm && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => setShowExtrasTranscribeConfirm(false)}
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Replace Extra Content?</h3>
            <p>
              This letter already has extra content transcription. Are you sure
              you want to replace it?
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => setShowExtrasTranscribeConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="btn-confirm"
                onClick={() => handleTranscribeExtrasWithConfirm(true)}
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </AdminLayout>
  );
}
