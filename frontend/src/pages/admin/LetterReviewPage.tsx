import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  resyncMetadata,
  checkResyncNeeded,
  transcribeExtras,
  updateExtraContent,
  verifyExtraContent,
  unverifyExtraContent,
  updateAiNotes,
  transcribeLetter,
  updateLinkedPerson,
  updateLinkedPlace,
  addLinkedPerson,
  addLinkedPlace,
  removeLinkedPerson,
  removeLinkedPlace,
} from "../../api/admin";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import { useToast } from "../../contexts/ToastContext";
import {
  Button,
  Icon,
  WorkflowBadge,
  ResizableSplitPane,
  DynamicEditor,
  Dropdown,
  DropdownItem,
  type DynamicEditorRef,
} from "../../components/common";
import { trackEdit } from "../../utils/recentEdits";
import type {
  Letter,
  LetterImage,
  VisibilityState,
  EmotionalTone,
  RelationshipType,
} from "../../types/Letter";
import "./LetterReviewPage.css";

// V2 Metadata constants
const EMOTIONAL_TONES: { value: EmotionalTone; label: string }[] = [
  { value: "joyful", label: "Joyful" },
  { value: "hopeful", label: "Hopeful" },
  { value: "neutral", label: "Neutral" },
  { value: "anxious", label: "Anxious" },
  { value: "sad", label: "Sad" },
  { value: "angry", label: "Angry" },
  { value: "desperate", label: "Desperate" },
];

const RELATIONSHIP_TYPES: { value: RelationshipType; label: string }[] = [
  { value: "spouse", label: "Spouse" },
  { value: "fiancé/fiancée", label: "Fiancé/Fiancée" },
  { value: "romantic-partner", label: "Romantic Partner" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "grandparent", label: "Grandparent" },
  { value: "grandchild", label: "Grandchild" },
  { value: "aunt/uncle", label: "Aunt/Uncle" },
  { value: "nephew/niece", label: "Nephew/Niece" },
  { value: "cousin", label: "Cousin" },
  { value: "in-law", label: "In-Law" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "business-associate", label: "Business Associate" },
  { value: "employer", label: "Employer" },
  { value: "employee", label: "Employee" },
  { value: "unknown", label: "Unknown" },
];

const PRIMARY_TOPICS = [
  "family/marriage",
  "family/children",
  "family/death-grief",
  "family/separation",
  "family/reunion",
  "health/illness",
  "health/recovery",
  "health/pregnancy-birth",
  "work/employment",
  "work/job-loss",
  "finances/hardship",
  "finances/prosperity",
  "travel/journey",
  "travel/immigration",
  "home/moving",
  "home/property",
  "correspondence/news-sharing",
  "correspondence/advice",
  "correspondence/gratitude",
  "correspondence/apology",
  "war/service",
  "war/homefront",
  "religion/faith",
  "community/local-events",
  "daily-life/weather",
  "daily-life/farming",
  "daily-life/household",
  "daily-life/social",
];

/**
 * Inline editable entity item component
 */
function EditableEntityItem({
  id,
  name,
  role,
  confidence,
  onSave,
  onRemove,
  isVerified,
}: {
  id: string;
  name: string;
  role: string;
  confidence: number;
  onSave: (newName: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  isVerified?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue.trim() === name || !editValue.trim()) {
      setEditValue(name);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue.trim());
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save entity name:", err);
      setEditValue(name);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(name);
      setIsEditing(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;
    setIsSaving(true);
    try {
      await onRemove();
    } catch (err) {
      console.error("Failed to remove entity:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div key={id} className="entity-item">
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="entity-name-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
        />
      ) : (
        <span
          className={`entity-name ${!isVerified ? "editable" : ""}`}
          onClick={!isVerified ? () => setIsEditing(true) : undefined}
          title={!isVerified ? "Click to edit" : undefined}
        >
          {name}
        </span>
      )}
      <span className={`entity-role role-${role}`}>{role}</span>
      <span className="entity-confidence">{confidence}%</span>
      {onRemove && !isVerified && (
        <button
          type="button"
          className="entity-remove-btn"
          onClick={handleRemove}
          disabled={isSaving}
          title="Remove from letter"
        >
          ×
        </button>
      )}
    </div>
  );
}

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
  const [tags, setTags] = useState("");
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

  // AI notes state
  const [aiNotes, setAiNotes] = useState("");

  // Extra content refs
  const extraContentRef = useRef<DynamicEditorRef>(null);
  const aiNotesRef = useRef<HTMLTextAreaElement>(null);

  // Track original identity values for re-sync detection
  const [originalSender, setOriginalSender] = useState("");
  const [originalRecipient, setOriginalRecipient] = useState("");

  // AI sync state - single button that checks and auto-applies
  const [syncState, setSyncState] = useState<
    "idle" | "checking" | "updating" | "done"
  >("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Metadata regeneration state
  const [regenerateState, setRegenerateState] = useState<
    "idle" | "regenerating" | "done"
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

  // Add entity modal state
  const [showAddPersonModal, setShowAddPersonModal] = useState(false);
  const [showAddPlaceModal, setShowAddPlaceModal] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonRole, setNewPersonRole] = useState<"sender" | "recipient" | "mentioned">("mentioned");
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceRole, setNewPlaceRole] = useState<"written_from" | "mentioned" | "destination">("mentioned");
  const [addingEntity, setAddingEntity] = useState(false);

  // 5-minute auto-sync timer
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [syncCountdown, setSyncCountdown] = useState<number | null>(null);
  const [showCancelHint, setShowCancelHint] = useState(false);
  const cancelHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transcriptFontSize, setTranscriptFontSize] = useState("1.1rem");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(
    undefined,
  );
  const editorRef = useRef<HTMLDivElement>(null);

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

  const hookRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
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
          setTags(foundLetter.metadata.tags?.join(", ") || "");
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
          // Extra content and AI notes
          setExtraContent(foundLetter.extraContentTranscript || "");
          setAiNotes(foundLetter.aiNotes || "");
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

  // Set initial content in contenteditable when letter loads
  // IMPORTANT: Only depend on letter.id, not the whole letter object or calculateFontSize
  // Otherwise this effect runs on every edit and overwrites the DOM
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && letter) {
      editor.innerText = letter.transcript.fullText || "";
      // Recalculate font size after content is set
      calculateFontSize();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter?.id]);

  // Auto-resize hook textarea (min 80px)
  useEffect(() => {
    const textarea = hookRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.max(textarea.scrollHeight, 80) + "px";
    }
  }, [hook]);

  // Auto-resize description textarea (min 80px)
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.max(textarea.scrollHeight, 80) + "px";
    }
  }, [description]);

  // Auto-resize notes textarea (min 80px)
  useEffect(() => {
    const textarea = notesRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.max(textarea.scrollHeight, 80) + "px";
    }
  }, [notes]);

  // Auto-resize AI notes textarea (min 80px)
  useEffect(() => {
    const textarea = aiNotesRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.max(textarea.scrollHeight, 80) + "px";
    }
  }, [aiNotes]);

  const handleSave = async () => {
    if (!letterId) return;

    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Read transcript directly from contenteditable ref to ensure we have latest content
    const currentTranscript = editorRef.current?.innerText || transcript;

    const saveData = {
      transcriptionText: currentTranscript,
      sender: sender || null,
      recipient: recipient || null,
      extractedDate: date || null,
      extractedDateConfidence: dateConfidence,
      locationWritten: location || null,
      hook: hook || null,
      summary: description || null,
      tags: tagsArray.length > 0 ? tagsArray : null,
      notes: notes || null,
    };

    // Proceed with save
    setSaving(true);
    setMessage("");

    try {
      const updated = await updateLetter(letterId, saveData);

      // Sync all states with the response to ensure UI reflects saved data
      setLetter(updated);
      setTranscript(updated.transcript.fullText);
      setSender(updated.metadata.sender || "");
      setRecipient(updated.metadata.recipient || "");
      setDate(updated.metadata.date || "");
      setDateConfidence(updated.metadata.dateConfidence || "unknown");
      setLocation(updated.metadata.location || "");
      setHook(updated.metadata.hook || "");
      setDescription(updated.metadata.description || "");
      setTags(updated.metadata.tags?.join(", ") || "");
      setNotes(updated.metadata.notes || "");
      // Update original values after successful save
      setOriginalSender(updated.metadata.sender || "");
      setOriginalRecipient(updated.metadata.recipient || "");

      // Track this edit for the Recent Activity feature
      trackEdit({
        id: updated.id,
        metadata: updated.metadata,
        collectionCode: updated.collectionCode,
      });

      showToast("Changes saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  // Clear any pending sync timer
  const clearSyncTimer = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSyncCountdown(null);
    setShowCancelHint(false);
  }, []);

  // Countdown click handlers for cancel UX
  const handleCountdownClick = useCallback(() => {
    setShowCancelHint(true);
    if (cancelHintTimeoutRef.current) {
      clearTimeout(cancelHintTimeoutRef.current);
    }
    cancelHintTimeoutRef.current = setTimeout(() => {
      setShowCancelHint(false);
    }, 2000);
  }, []);

  const handleCountdownDoubleClick = useCallback(() => {
    clearSyncTimer();
    setShowCancelHint(false);
  }, [clearSyncTimer]);

  // Single AI Sync button: checks if updates needed and auto-applies them
  const handleAISync = useCallback(async () => {
    if (!letterId || !letter) return;

    // Clear any pending auto-sync timer
    clearSyncTimer();

    // Step 1: Check if sync is needed
    setSyncState("checking");
    setSyncMessage("Checking metadata...");

    try {
      const checkResult = await checkResyncNeeded(letterId, {
        oldSender: originalSender || null,
        newSender: sender || null,
        oldRecipient: originalRecipient || null,
        newRecipient: recipient || null,
      });

      if (!checkResult.needsResync) {
        // No changes needed
        setSyncState("done");
        setSyncMessage("Already up to date");
        showToast("Metadata is already in sync", "success");
        setTimeout(() => {
          setSyncState("idle");
          setSyncMessage(null);
        }, 2000);
        return;
      }

      // Step 2: Apply the changes automatically
      setSyncState("updating");
      const issueCount = checkResult.decision.issues?.length || 0;
      setSyncMessage(
        `Updating ${issueCount} issue${issueCount !== 1 ? "s" : ""}...`,
      );

      const resyncResult = await resyncMetadata(letterId, {
        oldSender: originalSender || null,
        newSender: sender || null,
        oldRecipient: originalRecipient || null,
        newRecipient: recipient || null,
      });

      // Update local state with the synced letter
      setLetter(resyncResult.letter);
      setDescription(resyncResult.letter.metadata.description || "");
      setHook(resyncResult.letter.metadata.hook || "");

      // Update original values for future change detection
      setOriginalSender(sender);
      setOriginalRecipient(recipient);

      // Build success message
      const updatedFields: string[] = [];
      if (resyncResult.resync.updatedFields.summary)
        updatedFields.push("summary");
      if (resyncResult.resync.updatedFields.hook) updatedFields.push("hook");
      if (resyncResult.resync.updatedFields.senderPerson)
        updatedFields.push("sender link");
      if (resyncResult.resync.updatedFields.recipientPerson)
        updatedFields.push("recipient link");
      if (resyncResult.resync.updatedFields.relationshipType)
        updatedFields.push("relationship");
      if (resyncResult.resync.updatedFields.quoteContexts)
        updatedFields.push("quote contexts");

      setSyncState("done");
      if (updatedFields.length > 0) {
        setSyncMessage(`Updated: ${updatedFields.join(", ")}`);
        showToast(`AI updated ${updatedFields.join(", ")}`, "success");
      } else {
        setSyncMessage("No changes needed");
      }

      // Track this edit
      trackEdit({
        id: resyncResult.letter.id,
        metadata: resyncResult.letter.metadata,
        collectionCode: resyncResult.letter.collectionCode,
      });

      // Clear done state after a moment
      setTimeout(() => {
        setSyncState("idle");
        setSyncMessage(null);
      }, 3000);
    } catch (err) {
      setSyncState("idle");
      setSyncMessage(null);
      showToast(err instanceof Error ? err.message : "AI sync failed", "error");
      console.error("AI Sync error:", err);
    }
  }, [
    letterId,
    letter,
    originalSender,
    originalRecipient,
    sender,
    recipient,
    showToast,
    clearSyncTimer,
  ]);

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
        setTimeout(() => {
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

  // Start 5-minute auto-sync timer when metadata changes
  const startSyncTimer = useCallback(() => {
    // Clear existing timer
    clearSyncTimer();

    // Start countdown at 5 minutes (300 seconds)
    setSyncCountdown(300);

    // Update countdown every second
    countdownIntervalRef.current = setInterval(() => {
      setSyncCountdown((prev) => {
        if (prev === null || prev <= 1) {
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    // Set 5-minute timer for auto-sync
    syncTimerRef.current = setTimeout(
      () => {
        clearSyncTimer();
        handleAISync();
      },
      5 * 60 * 1000,
    );
  }, [clearSyncTimer, handleAISync]);

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
      showToast(
        "Transcript confirmed - metadata extraction will begin shortly",
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
      setTags(updated.metadata.tags?.join(", ") || "");
      setEmotionalTone(updated.metadata.emotionalTone || "");
      setRelationship(updated.metadata.senderRecipientRelationship || "");
      setPrimaryTopics(updated.metadata.primaryTopics || []);
      // Update original values for sync detection
      setOriginalSender(updated.metadata.sender || "");
      setOriginalRecipient(updated.metadata.recipient || "");
      setRegenerateState("done");
      showToast("Metadata regenerated", "success");

      // Reset state after a moment
      setTimeout(() => {
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

      // Set up debounced save
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
          setTimeout(() => setAutoSaveStatus("idle"), 2000);

          // Track edit
          trackEdit({
            id: updated.id,
            metadata: updated.metadata,
            collectionCode: updated.collectionCode,
          });
        } catch (err) {
          setAutoSaveStatus("error");
          console.error("Auto-save error:", err);
        }
      }, 1500);
    },
    [letterId, letter],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
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

    // Cancel any pending sync timer - user is verifying current state
    clearSyncTimer();

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

  const handleBack = () => {
    navigate("/admin");
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

      // Update contenteditable
      if (editorRef.current) {
        editorRef.current.innerText = originalTranscriptText;
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

    // Cancel any pending sync timer
    clearSyncTimer();

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
  }, [letter?.metadataContentStatus, letterId, showToast, clearSyncTimer]);

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
          setTimeout(() => setAutoSaveStatus("idle"), 2000);
        } catch (err) {
          setAutoSaveStatus("error");
          console.error("Extra content auto-save error:", err);
        }
      }, 1500);
    },
    [letterId],
  );

  // AI notes auto-save
  const handleAiNotesChange = useCallback(
    (newNotes: string) => {
      setAiNotes(newNotes);
      if (!letterId) return;

      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Set up debounced save
      autoSaveTimerRef.current = setTimeout(async () => {
        setAutoSaveStatus("saving");
        try {
          const updated = await updateAiNotes(letterId, newNotes);
          setLetter(updated);
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus("idle"), 2000);
        } catch (err) {
          setAutoSaveStatus("error");
          console.error("AI notes auto-save error:", err);
        }
      }, 1500);
    },
    [letterId],
  );

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
      <div className="letter-review-page">
        <header className="review-header">
          <h1>Letter Review</h1>
          <Button icon="back" onClick={handleBack}>
            Back to Dashboard
          </Button>
        </header>
        <div className="review-content">
          <p>{message || (loading ? "Loading..." : "Letter not found")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="letter-review-page">
      <header className="review-header">
        <Button icon="back" onClick={handleBack}>
          Back
        </Button>
        <h1>{letter.title}</h1>
        {/* Auto-save status indicator */}
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
            className="header-action save"
            onClick={() => handleSave()}
            disabled={saving}
            data-tooltip="Save"
          >
            <Icon name="save" size={18} />
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
            className="header-action delete"
            onClick={handleDelete}
            disabled={saving}
            data-tooltip="Delete"
          >
            <Icon name="delete" size={18} />
          </button>
        </div>
      </header>

      <div className="review-body">
        <ResizableSplitPane
          letterId={letterId}
          className="review-layout"
          firstPanelClassName="images-panel"
          secondPanelClassName="edit-panel"
        >
          {/* Left side: Letter viewer */}
          <LetterViewer
            images={letter.images}
            letterId={letterId}
            showOnlyLetterPages={false}
            onPageChange={handlePageChange}
          />

          {/* Right side: Editable content */}
          <div className="edit-panel-content">
            {/* Status Panel */}
            <div className="status-panel">
              {/* Filename Display - shows current page's filename */}
              {(currentFilename || letter.images[0]?.originalFilename) && (
                <div className="filename-display">
                  <span className="filename-label">File</span>
                  <code className="filename-value">
                    {currentFilename || letter.images[0]?.originalFilename}
                  </code>
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

            {/* Transcription Editor */}
            <div className="editor-section">
              <div className="editor-header">
                <h2>
                  Transcription
                  {/* Transcription status indicator */}
                  {letterTranscribeState !== "idle" && (
                    <span
                      className={`transcribe-status-indicator ${letterTranscribeState}`}
                    >
                      {letterTranscribeState === "transcribing" && (
                        <Icon name="process" size={14} className="spinning" />
                      )}
                      {letterTranscribeState === "done" && (
                        <Icon name="check" size={14} />
                      )}
                      <span>{letterTranscribeMessage}</span>
                    </span>
                  )}
                </h2>
                <div className="header-right">
                  {/* Transcribe button - hidden when verified */}
                  {(letter.transcriptStatus !== "VERIFIED" ||
                    isTranscriptEditing) && (
                    <button
                      className="action-btn transcribe-btn"
                      onClick={() => handleTranscribeLetter()}
                      disabled={
                        saving || letterTranscribeState === "transcribing"
                      }
                      title="Transcribe letter pages"
                    >
                      {letterTranscribeState === "transcribing" ? (
                        <>
                          <Icon name="process" size={14} className="spinning" />
                          <span>Transcribing...</span>
                        </>
                      ) : (
                        <>
                          <Icon name="process" size={14} />
                          <span>Transcribe</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Verification UI */}
                  {letter.transcriptStatus === "VERIFIED" &&
                  !isTranscriptEditing ? (
                    <div className="verified-info">
                      <Icon name="check" size={14} />
                      <span>
                        Verified
                        {letter.transcriptVerifiedAt &&
                          ` on ${new Date(letter.transcriptVerifiedAt).toLocaleDateString()}`}
                      </span>
                    </div>
                  ) : (
                    <button
                      className="verify-btn"
                      onClick={handleVerifyTranscript}
                      disabled={saving}
                      title="Mark transcript verified"
                    >
                      Verify
                    </button>
                  )}
                </div>
              </div>
              <div
                className="editor-container"
                onClick={handleTranscriptClick}
                onDoubleClick={handleTranscriptDoubleClick}
              >
                <div
                  ref={editorRef}
                  className={`transcript-editor ${letter.transcriptStatus === "VERIFIED" && !isTranscriptEditing ? "verified" : ""}`}
                  contentEditable={
                    letter.transcriptStatus !== "VERIFIED" ||
                    isTranscriptEditing
                  }
                  suppressContentEditableWarning
                  data-placeholder="Enter letter transcription..."
                  style={
                    {
                      "--transcript-font-size": transcriptFontSize,
                    } as React.CSSProperties
                  }
                  onInput={(e) => {
                    const target = e.currentTarget;
                    const newText = target.innerText;
                    setTranscript(newText);
                    setHasTranscriptChanges(
                      originalTranscriptText !== null &&
                        newText !== originalTranscriptText,
                    );
                    triggerAutoSave({ transcriptionText: newText });
                  }}
                  onKeyDown={handleEditorKeyDown}
                />
              </div>

              {/* Double-click to edit tooltip */}
              {showEditTooltip && (
                <div
                  className="edit-tooltip"
                  style={{
                    left: Math.min(tooltipPosition.x, window.innerWidth - 280),
                    top: tooltipPosition.y + 10,
                  }}
                >
                  Verified. Double-click to edit and unverify.
                </div>
              )}
            </div>

            {/* Extra Content Section (always visible) */}
            <div className="editor-section extra-content-section">
              <div className="editor-header">
                <h2>Extra Content</h2>
                <div className="header-right">
                  {/* Transcribe button - hidden when verified */}
                  {letter.images.some((img) =>
                    ["telegram", "cover", "ephemera"].includes(img.type),
                  ) &&
                    (letter.extraContentStatus !== "VERIFIED" ||
                      isExtraContentEditing) && (
                      <button
                        className="action-btn transcribe-btn"
                        onClick={() => handleTranscribeExtrasWithConfirm()}
                        disabled={saving || extraContentTranscribing}
                        title="Transcribe telegrams, covers, and ephemera"
                      >
                        {extraContentTranscribing ? (
                          <>
                            <Icon
                              name="process"
                              size={14}
                              className="spinning"
                            />
                            <span>Transcribing...</span>
                          </>
                        ) : (
                          <>
                            <Icon name="process" size={14} />
                            <span>Transcribe</span>
                          </>
                        )}
                      </button>
                    )}

                  {/* Verification UI */}
                  {letter.extraContentStatus === "VERIFIED" ? (
                    <div
                      className="verified-info"
                      onClick={handleUnverifyExtraContent}
                      style={{ cursor: "pointer" }}
                      title="Click to unverify"
                    >
                      <Icon name="check" size={14} />
                      <span>
                        Verified
                        {letter.extraContentVerifiedAt &&
                          ` on ${new Date(letter.extraContentVerifiedAt).toLocaleDateString()}`}
                      </span>
                    </div>
                  ) : (
                    letter.extraContentStatus !== "EMPTY" && (
                      <button
                        className="verify-btn"
                        onClick={handleVerifyExtraContent}
                        disabled={saving}
                        title="Mark extra content verified"
                      >
                        Verify
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="extra-content-container">
                {letter.extraContentStatus === "EMPTY" &&
                !letter.images.some((img) =>
                  ["telegram", "cover", "ephemera"].includes(img.type),
                ) ? (
                  <div className="empty-state">
                    <p>No extra content for this letter</p>
                  </div>
                ) : letter.extraContentStatus === "EMPTY" ? (
                  <div className="empty-state">
                    <p>
                      Click "Transcribe" to extract text from extras (telegrams,
                      covers, ephemera)
                    </p>
                  </div>
                ) : (
                  <DynamicEditor
                    ref={extraContentRef}
                    value={extraContent}
                    onChange={handleExtraContentChange}
                    onKeyDown={handleExtraContentKeyDown}
                    onClick={handleExtraContentClick}
                    onDoubleClick={handleExtraContentDoubleClick}
                    placeholder="Extra content transcription..."
                    readOnly={
                      letter.extraContentStatus === "VERIFIED" &&
                      !isExtraContentEditing
                    }
                    verified={
                      letter.extraContentStatus === "VERIFIED" &&
                      !isExtraContentEditing
                    }
                    baseFontSize={1.0}
                    minHeight={180}
                  />
                )}

                {/* Double-click to edit tooltip for extra content */}
                {showExtraContentTooltip && (
                  <div
                    className="edit-tooltip"
                    style={{
                      left: Math.min(
                        extraContentTooltipPosition.x,
                        window.innerWidth - 280,
                      ),
                      top: extraContentTooltipPosition.y + 10,
                    }}
                  >
                    Verified. Double-click to edit and unverify.
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Form */}
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
                            ? handleConfirmTranscript
                            : handleRegenerateMetadata
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
                        className={`action-btn sync-btn ${syncState !== "idle" ? syncState : ""}`}
                        onClick={handleAISync}
                        disabled={
                          saving ||
                          syncState !== "idle" ||
                          !letter.transcript.fullText
                        }
                        title="Sync metadata with identity changes"
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
                        ) : (
                          <>
                            <Icon name="process" size={14} />
                            <span>Sync</span>
                          </>
                        )}
                      </button>
                    )}

                  {/* Sync countdown (when 5-min timer is running) */}
                  {syncCountdown !== null && syncState === "idle" && (
                    <span
                      className="sync-countdown"
                      onClick={handleCountdownClick}
                      onDoubleClick={handleCountdownDoubleClick}
                    >
                      Syncing in {Math.floor(syncCountdown / 60)}:
                      {String(syncCountdown % 60).padStart(2, "0")}
                      {showCancelHint && (
                        <span className="cancel-hint">
                          Double-click to cancel
                        </span>
                      )}
                    </span>
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
                      onClick={handleVerifyMetadata}
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
                onClick={handleMetadataFieldClick}
                onDoubleClick={handleMetadataFieldDoubleClick}
              >
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="sender">Sender</label>
                    <input
                      type="text"
                      id="sender"
                      value={sender}
                      onChange={(e) => {
                        setSender(e.target.value);
                        triggerAutoSave({ sender: e.target.value || null });
                        startSyncTimer();
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
                        setRecipient(e.target.value);
                        triggerAutoSave({ recipient: e.target.value || null });
                        startSyncTimer();
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
                      onChange={(e) => setDate(e.target.value)}
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
                        setDateConfidence(
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
                      setLocation(e.target.value);
                      triggerAutoSave({
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
                      setHook(e.target.value);
                      triggerAutoSave({ hook: e.target.value || null });
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
                      setDescription(e.target.value);
                      triggerAutoSave({ summary: e.target.value || null });
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

                <div className="form-group">
                  <label htmlFor="tags">Tags</label>
                  <input
                    type="text"
                    id="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="family, business, travel (comma separated)"
                    readOnly={letter.metadataContentStatus === "VERIFIED"}
                    className={
                      letter.metadataContentStatus === "VERIFIED"
                        ? "verified-field"
                        : ""
                    }
                  />
                  <span className="help-text">Comma-separated list</span>
                </div>

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
                  <span className="help-text">For internal reference only</span>
                </div>

                {/* AI-Extracted Metadata Section */}
                <div className="v2-metadata-section">
                  <h3 className="v2-section-header">AI-Extracted Metadata</h3>

                  <div className="v2-fields">
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor="emotionalTone">Emotional Tone</label>
                        <select
                          id="emotionalTone"
                          value={emotionalTone}
                          onChange={(e) =>
                            setEmotionalTone(
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
                          {EMOTIONAL_TONES.map((t) => (
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
                            setRelationship(
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
                          {RELATIONSHIP_TYPES.map((r) => (
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
                                    onClick={() => setPrimaryTopics(primaryTopics.filter((t) => t !== topic))}
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
                                onClick={() => setTopicsDropdownOpen(!topicsDropdownOpen)}
                              >
                                <Icon name="plus" size={14} />
                                Add Topic
                              </button>
                            }
                            isOpen={topicsDropdownOpen}
                            onClose={() => setTopicsDropdownOpen(false)}
                            align="left"
                          >
                            <div className="topics-dropdown-content">
                              {PRIMARY_TOPICS.filter((t) => !primaryTopics.includes(t)).map((topic) => (
                                <DropdownItem
                                  key={topic}
                                  title={topic.replace("/", " / ")}
                                  onClick={() => {
                                    setPrimaryTopics([...primaryTopics, topic]);
                                    setTopicsDropdownOpen(false);
                                  }}
                                />
                              ))}
                              {PRIMARY_TOPICS.filter((t) => !primaryTopics.includes(t)).length === 0 && (
                                <div className="dropdown-empty">All topics selected</div>
                              )}
                            </div>
                          </Dropdown>
                        )}
                      </div>
                    </div>

                    {/* Linked Entities Section */}
                    <div className="linked-entities">
                      <div className="entity-group">
                        <div className="entity-group-header">
                          <label>Linked People</label>
                          {letter.metadataContentStatus !== "VERIFIED" && (
                            <button
                              type="button"
                              className="add-entity-btn"
                              onClick={() => setShowAddPersonModal(true)}
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
                                onSave={async (newName) => {
                                  const updated = await updateLinkedPerson(letterId!, lp.id, newName);
                                  setLetter(updated);
                                  showToast("Person name updated", "success");
                                }}
                                onRemove={async () => {
                                  const updated = await removeLinkedPerson(letterId!, lp.id);
                                  setLetter(updated);
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
                              onClick={() => setShowAddPlaceModal(true)}
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
                                onSave={async (newName) => {
                                  const updated = await updateLinkedPlace(letterId!, lpl.id, newName);
                                  setLetter(updated);
                                  showToast("Place name updated", "success");
                                }}
                                onRemove={async () => {
                                  const updated = await removeLinkedPlace(letterId!, lpl.id);
                                  setLetter(updated);
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

            {/* AI Notes Section (always visible) */}
            <div className="editor-section ai-notes-section">
              <div className="editor-header">
                <h2>AI Notes</h2>
                <span className="help-text">
                  Observations, suggestions, and hunches from AI analysis
                </span>
              </div>
              <div className="ai-notes-container">
                <textarea
                  ref={aiNotesRef}
                  className="ai-notes-editor"
                  value={aiNotes}
                  onChange={(e) => handleAiNotesChange(e.target.value)}
                  placeholder="AI observations and admin notes will appear here. You can edit or add your own notes."
                />
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

      {/* Add Person Modal */}
      {showAddPersonModal && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => {
            setShowAddPersonModal(false);
            setNewPersonName("");
            setNewPersonRole("mentioned");
          }}
        >
          <div className="confirm-dialog add-entity-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Add Linked Person</h3>
            <div className="form-group">
              <label htmlFor="newPersonName">Name</label>
              <input
                type="text"
                id="newPersonName"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder="Enter person's name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPersonRole">Role</label>
              <select
                id="newPersonRole"
                value={newPersonRole}
                onChange={(e) => setNewPersonRole(e.target.value as typeof newPersonRole)}
              >
                <option value="sender">Sender</option>
                <option value="recipient">Recipient</option>
                <option value="mentioned">Mentioned</option>
              </select>
            </div>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setShowAddPersonModal(false);
                  setNewPersonName("");
                  setNewPersonRole("mentioned");
                }}
              >
                Cancel
              </button>
              <button
                className="btn-confirm"
                disabled={!newPersonName.trim() || addingEntity}
                onClick={async () => {
                  if (!newPersonName.trim() || !letterId) return;
                  setAddingEntity(true);
                  try {
                    const updated = await addLinkedPerson(letterId, newPersonName.trim(), newPersonRole);
                    setLetter(updated);
                    showToast("Person added", "success");
                    setShowAddPersonModal(false);
                    setNewPersonName("");
                    setNewPersonRole("mentioned");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "Failed to add person", "error");
                  } finally {
                    setAddingEntity(false);
                  }
                }}
              >
                {addingEntity ? "Adding..." : "Add Person"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Place Modal */}
      {showAddPlaceModal && (
        <div
          className="confirm-dialog-overlay"
          onClick={() => {
            setShowAddPlaceModal(false);
            setNewPlaceName("");
            setNewPlaceRole("mentioned");
          }}
        >
          <div className="confirm-dialog add-entity-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Add Linked Place</h3>
            <div className="form-group">
              <label htmlFor="newPlaceName">Name</label>
              <input
                type="text"
                id="newPlaceName"
                value={newPlaceName}
                onChange={(e) => setNewPlaceName(e.target.value)}
                placeholder="Enter place name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPlaceRole">Role</label>
              <select
                id="newPlaceRole"
                value={newPlaceRole}
                onChange={(e) => setNewPlaceRole(e.target.value as typeof newPlaceRole)}
              >
                <option value="written_from">Written From</option>
                <option value="destination">Destination</option>
                <option value="mentioned">Mentioned</option>
              </select>
            </div>
            <div className="confirm-dialog-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setShowAddPlaceModal(false);
                  setNewPlaceName("");
                  setNewPlaceRole("mentioned");
                }}
              >
                Cancel
              </button>
              <button
                className="btn-confirm"
                disabled={!newPlaceName.trim() || addingEntity}
                onClick={async () => {
                  if (!newPlaceName.trim() || !letterId) return;
                  setAddingEntity(true);
                  try {
                    const updated = await addLinkedPlace(letterId, newPlaceName.trim(), newPlaceRole);
                    setLetter(updated);
                    showToast("Place added", "success");
                    setShowAddPlaceModal(false);
                    setNewPlaceName("");
                    setNewPlaceRole("mentioned");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "Failed to add place", "error");
                  } finally {
                    setAddingEntity(false);
                  }
                }}
              >
                {addingEntity ? "Adding..." : "Add Place"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
