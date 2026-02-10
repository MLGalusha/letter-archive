import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import {
  updateLetter,
  confirmTranscript,
  verifyTranscript,
  unverifyTranscript,
  verifyMetadata,
  unverifyMetadata,
  createVersion,
  resyncMetadata,
  checkResyncNeeded,
} from "../../api/admin";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import { useToast } from "../../contexts/ToastContext";
import { Button, Icon, WorkflowBadge, ResizableSplitPane } from "../../components/common";
import { trackEdit } from "../../utils/recentEdits";
import type {
  Letter,
  LetterImage,
  VisibilityState,
  ContentStatus,
  EmotionalTone,
  RelationshipType,
} from "../../types/Letter";
import "./LetterReviewPage.css";

// V2 Metadata constants
const EMOTIONAL_TONES: { value: EmotionalTone; label: string }[] = [
  { value: 'joyful', label: 'Joyful' },
  { value: 'hopeful', label: 'Hopeful' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'sad', label: 'Sad' },
  { value: 'angry', label: 'Angry' },
  { value: 'desperate', label: 'Desperate' },
];

const RELATIONSHIP_TYPES: { value: RelationshipType; label: string }[] = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'fiancé/fiancée', label: 'Fiancé/Fiancée' },
  { value: 'romantic-partner', label: 'Romantic Partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'aunt/uncle', label: 'Aunt/Uncle' },
  { value: 'nephew/niece', label: 'Nephew/Niece' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'in-law', label: 'In-Law' },
  { value: 'friend', label: 'Friend' },
  { value: 'acquaintance', label: 'Acquaintance' },
  { value: 'business-associate', label: 'Business Associate' },
  { value: 'employer', label: 'Employer' },
  { value: 'employee', label: 'Employee' },
  { value: 'unknown', label: 'Unknown' },
];

const PRIMARY_TOPICS = [
  'family/marriage', 'family/children', 'family/death-grief', 'family/separation', 'family/reunion',
  'health/illness', 'health/recovery', 'health/pregnancy-birth',
  'work/employment', 'work/job-loss', 'finances/hardship', 'finances/prosperity',
  'travel/journey', 'travel/immigration', 'home/moving', 'home/property',
  'correspondence/news-sharing', 'correspondence/advice', 'correspondence/gratitude', 'correspondence/apology',
  'war/service', 'war/homefront', 'religion/faith', 'community/local-events',
  'daily-life/weather', 'daily-life/farming', 'daily-life/household', 'daily-life/social',
];

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
  const [dateConfidence, setDateConfidence] = useState<"exact" | "unknown" | "inferred">("unknown");
  const [location, setLocation] = useState("");
  const [hook, setHook] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  // V2 Metadata state
  const [emotionalTone, setEmotionalTone] = useState<EmotionalTone | "">("");
  const [relationship, setRelationship] = useState<RelationshipType | "">("");
  const [primaryTopics, setPrimaryTopics] = useState<string[]>([]);
  const [showV2Section, setShowV2Section] = useState(true);

  // Track original identity values for re-sync detection
  const [originalSender, setOriginalSender] = useState("");
  const [originalRecipient, setOriginalRecipient] = useState("");


  // AI sync state - single button that checks and auto-applies
  const [syncState, setSyncState] = useState<'idle' | 'checking' | 'updating' | 'done'>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transcriptFontSize, setTranscriptFontSize] = useState("1.1rem");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(undefined);
  const editorRef = useRef<HTMLDivElement>(null);

  // Verified transcript editing flow state
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [originalTranscriptText, setOriginalTranscriptText] = useState<string | null>(null);
  const [originalTranscriptVerified, setOriginalTranscriptVerified] = useState(false);
  const [hasTranscriptChanges, setHasTranscriptChanges] = useState(false);
  const [showEditTooltip, setShowEditTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Line highlighting state
  const [currentLineIndex, setCurrentLineIndex] = useState<number | null>(null);

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
          setRelationship(foundLetter.metadata.senderRecipientRelationship || "");
          setPrimaryTopics(foundLetter.metadata.primaryTopics || []);
          // Store original values for AI sync detection
          setOriginalSender(foundLetter.metadata.sender || "");
          setOriginalRecipient(foundLetter.metadata.recipient || "");
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
    const lines = transcript.split('\n');
    const baseFontSize = 1.1; // rem

    // Create canvas for measuring text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use computed font to match actual rendering
    const fontFamily = computedStyle.fontFamily || 'inherit';
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
    window.addEventListener('resize', calculateFontSize);
    return () => window.removeEventListener('resize', calculateFontSize);
  }, [calculateFontSize]);

  // Set initial content in contenteditable when letter loads
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && letter) {
      // Only set content if it's different (prevents cursor jumping)
      const currentContent = editor.innerText;
      const newContent = letter.transcript.fullText || "";
      if (currentContent !== newContent) {
        editor.innerText = newContent;
      }
    }
  }, [letter]);

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

  // Single AI Sync button: checks if updates needed and auto-applies them
  const handleAISync = async () => {
    if (!letterId || !letter) return;

    // Step 1: Check if sync is needed
    setSyncState('checking');
    setSyncMessage('Checking metadata...');

    try {
      const checkResult = await checkResyncNeeded(letterId, {
        oldSender: originalSender || null,
        newSender: sender || null,
        oldRecipient: originalRecipient || null,
        newRecipient: recipient || null,
      });

      if (!checkResult.needsResync) {
        // No changes needed
        setSyncState('done');
        setSyncMessage('Already up to date');
        showToast("Metadata is already in sync", "success");
        setTimeout(() => {
          setSyncState('idle');
          setSyncMessage(null);
        }, 2000);
        return;
      }

      // Step 2: Apply the changes automatically
      setSyncState('updating');
      const issueCount = checkResult.decision.issues?.length || 0;
      setSyncMessage(`Updating ${issueCount} issue${issueCount !== 1 ? 's' : ''}...`);

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
      if (resyncResult.resync.updatedFields.summary) updatedFields.push("summary");
      if (resyncResult.resync.updatedFields.hook) updatedFields.push("hook");
      if (resyncResult.resync.updatedFields.senderPerson) updatedFields.push("sender link");
      if (resyncResult.resync.updatedFields.recipientPerson) updatedFields.push("recipient link");
      if (resyncResult.resync.updatedFields.relationshipType) updatedFields.push("relationship");

      setSyncState('done');
      if (updatedFields.length > 0) {
        setSyncMessage(`Updated: ${updatedFields.join(", ")}`);
        showToast(`AI updated ${updatedFields.join(", ")}`, "success");
      } else {
        setSyncMessage('No changes needed');
      }

      // Track this edit
      trackEdit({
        id: resyncResult.letter.id,
        metadata: resyncResult.letter.metadata,
        collectionCode: resyncResult.letter.collectionCode,
      });

      // Clear done state after a moment
      setTimeout(() => {
        setSyncState('idle');
        setSyncMessage(null);
      }, 3000);
    } catch (err) {
      setSyncState('idle');
      setSyncMessage(null);
      showToast(err instanceof Error ? err.message : "AI sync failed", "error");
      console.error("AI Sync error:", err);
    }
  };

  const handleVisibilityChange = async (newVisibility: VisibilityState) => {
    if (!letterId || !letter) return;
    if (letter.visibility === newVisibility) return;

    setSaving(true);

    try {
      const updated = await updateLetter(letterId, { visibility: newVisibility });
      setLetter(updated);
      showToast(newVisibility === "PUBLISHED" ? "Letter published" : "Letter hidden", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update visibility", "error");
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
      showToast("Transcript confirmed - metadata extraction will begin shortly", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to confirm transcript", "error");
      console.error("Confirm transcript error:", err);
    } finally {
      setSaving(false);
    }
  };

  // Auto-save function (debounced)
  const triggerAutoSave = useCallback(async (data: {
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
      setAutoSaveStatus('saving');
      try {
        const updated = await updateLetter(letterId, data);
        setLetter(updated);

        // Create version for transcript
        if (data.transcriptionText !== undefined) {
          await createVersion(letterId, 'transcript', data.transcriptionText, 'human');
        }

        // Create version for metadata (if any metadata field changed)
        if (data.sender !== undefined || data.recipient !== undefined ||
            data.locationWritten !== undefined || data.hook !== undefined ||
            data.summary !== undefined) {
          await createVersion(letterId, 'metadata', {
            sender: data.sender ?? letter.metadata.sender,
            recipient: data.recipient ?? letter.metadata.recipient,
            locationWritten: data.locationWritten ?? letter.metadata.location,
            hook: data.hook ?? letter.metadata.hook,
            summary: data.summary ?? letter.metadata.description,
          }, 'human');
        }

        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);

        // Track edit
        trackEdit({
          id: updated.id,
          metadata: updated.metadata,
          collectionCode: updated.collectionCode,
        });
      } catch (err) {
        setAutoSaveStatus('error');
        console.error('Auto-save error:', err);
      }
    }, 1500);
  }, [letterId, letter]);

  // Cleanup timer on unmount
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
      showToast("Transcript verified", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to verify transcript", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUnverifyTranscript = async () => {
    if (!letterId) return;
    setSaving(true);
    try {
      const updated = await unverifyTranscript(letterId);
      setLetter(updated);
      showToast("Transcript verification removed", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to unverify transcript", "error");
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
      showToast(err instanceof Error ? err.message : "Failed to verify metadata", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUnverifyMetadata = async () => {
    if (!letterId) return;
    setSaving(true);
    try {
      const updated = await unverifyMetadata(letterId);
      setLetter(updated);
      showToast("Metadata verification removed", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to unverify metadata", "error");
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
      showToast(err instanceof Error ? err.message : "Failed to delete", "error");
      console.error("Delete error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    navigate("/admin");
  };

  // Helper: render status indicator for two-track system
  const renderContentStatus = (status: ContentStatus | undefined) => {
    switch (status) {
      case 'EMPTY':
        return <span className="content-status status-empty">Empty</span>;
      case 'AI_DRAFT':
        return <span className="content-status status-ai">AI Draft</span>;
      case 'EDITED':
        return <span className="content-status status-edited">Edited</span>;
      case 'VERIFIED':
        return <span className="content-status status-verified">Verified</span>;
      default:
        return null;
    }
  };

  const handlePageChange = useCallback((_index: number, image: LetterImage) => {
    setCurrentFilename(image.originalFilename);
  }, []);

  // Handle Tab key to insert spaces instead of changing focus
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();

      // Insert 4 spaces at cursor position
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode('    '); // 4 spaces
        range.insertNode(textNode);

        // Move cursor after inserted spaces
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);

        // Update state
        const target = e.currentTarget;
        setTranscript(target.innerText);
      }
    }
  };

  // Verified transcript editing flow handlers
  const handleTranscriptClick = useCallback((e: React.MouseEvent) => {
    if (!letter?.transcriptStatus || letter.transcriptStatus !== 'VERIFIED' || isTranscriptEditing) return;

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
  }, [letter?.transcriptStatus, isTranscriptEditing]);

  const handleTranscriptDoubleClick = useCallback(async () => {
    if (!letter?.transcriptStatus || letter.transcriptStatus !== 'VERIFIED' || !letterId) return;

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
      showToast(err instanceof Error ? err.message : "Failed to unverify transcript", "error");
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
      const updated = await updateLetter(letterId, { transcriptionText: originalTranscriptText });
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
      showToast(err instanceof Error ? err.message : "Failed to revert changes", "error");
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
    };
  }, []);

  // Line highlighting - update on cursor move
  useEffect(() => {
    const isEditing = letter && letter.transcriptStatus !== 'VERIFIED' || isTranscriptEditing;

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

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [letter?.transcriptStatus, isTranscriptEditing]);

  if (loading || !letter) {
    return (
      <div className="letter-review-page">
        <header className="review-header">
          <h1>Letter Review</h1>
          <Button icon="back" onClick={handleBack}>Back to Dashboard</Button>
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
        <Button icon="back" onClick={handleBack}>Back</Button>
        <h1>{letter.title}</h1>
        {/* Auto-save status indicator */}
        <div className="auto-save-indicator">
          {autoSaveStatus === 'saving' && <span className="save-status saving">Saving...</span>}
          {autoSaveStatus === 'saved' && <span className="save-status saved">Saved</span>}
          {autoSaveStatus === 'error' && <span className="save-status error">Save failed</span>}
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

          {/* AI Sync button - checks and auto-applies updates */}
          <button
            className={`header-action ai-sync ${syncState !== 'idle' ? syncState : ''}`}
            onClick={handleAISync}
            disabled={saving || syncState !== 'idle' || !letter.transcript.fullText}
            data-tooltip="AI Sync"
          >
            <Icon name={syncState === 'done' ? 'check' : 'process'} size={18} />
          </button>

          {/* Confirm button - only for TRANSCRIBED without confirmation */}
          {letter.workflowState === "TRANSCRIBED" && !letter.transcriptConfirmedAt && (
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
                  <code className="filename-value">{currentFilename || letter.images[0]?.originalFilename}</code>
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
                    {letter.visibility === "PUBLISHED" ? "Published" : "Publish"}
                  </button>
                </div>
              </div>
            </div>

            {/* Transcription Editor */}
            <div className="editor-section">
              <div className="editor-header">
                <h2>Transcription</h2>
                <div className="header-right">
                  {/* Status badge - only show "Edited" when NOT verified */}
                  {letter.transcriptStatus === 'EDITED' && !isTranscriptEditing && (
                    renderContentStatus(letter.transcriptStatus)
                  )}

                  {/* Verification UI */}
                  {letter.transcriptStatus === 'VERIFIED' && !isTranscriptEditing ? (
                    <div className="verified-info">
                      <Icon name="check" size={14} />
                      <span>Verified{letter.transcriptVerifiedAt && ` on ${new Date(letter.transcriptVerifiedAt).toLocaleDateString()}`}</span>
                      <button
                        className="unverify-btn"
                        onClick={handleUnverifyTranscript}
                        disabled={saving}
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    <button
                      className="verify-btn"
                      onClick={handleVerifyTranscript}
                      disabled={saving || letter.transcriptStatus === 'EMPTY'}
                      title="Mark transcript verified"
                    >
                      <Icon name="check" size={18} />
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
                  className={`transcript-editor ${letter.transcriptStatus === 'VERIFIED' && !isTranscriptEditing ? 'verified' : ''}`}
                  contentEditable={letter.transcriptStatus !== 'VERIFIED' || isTranscriptEditing}
                  suppressContentEditableWarning
                  data-placeholder="Enter letter transcription..."
                  style={{ "--transcript-font-size": transcriptFontSize } as React.CSSProperties}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    const newText = target.innerText;
                    setTranscript(newText);
                    setHasTranscriptChanges(originalTranscriptText !== null && newText !== originalTranscriptText);
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
                    top: tooltipPosition.y + 10
                  }}
                >
                  Verified. Double-click to edit and unverify.
                </div>
              )}
            </div>

            {/* Metadata Form */}
            <div className="metadata-section">
              <div className="metadata-header">
                <h2>Metadata</h2>
                {renderContentStatus(letter.metadataContentStatus)}
                {/* AI sync status indicator */}
                {syncMessage && (
                  <span className={`sync-status-indicator ${syncState}`}>
                    {syncState === 'checking' && <Icon name="process" size={14} className="spinning" />}
                    {syncState === 'updating' && <Icon name="process" size={14} className="spinning" />}
                    {syncState === 'done' && <Icon name="check" size={14} />}
                    <span>{syncMessage}</span>
                  </span>
                )}
              </div>
              <div className="metadata-form">
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
                      }}
                      placeholder="Who wrote the letter"
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
                      }}
                      placeholder="Who received the letter"
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
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="dateConfidence">Date Confidence</label>
                    <select
                      id="dateConfidence"
                      value={dateConfidence}
                      onChange={(e) => setDateConfidence(e.target.value as typeof dateConfidence)}
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
                      triggerAutoSave({ locationWritten: e.target.value || null });
                    }}
                    placeholder="e.g., New York, NY"
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
                  />
                  <span className="help-text">Max 150 characters - displayed on letter cards</span>
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
                  />
                  <span className="help-text">For internal reference only</span>
                </div>

                {/* V2 Metadata Section */}
                <div className="v2-metadata-section">
                  <button
                    type="button"
                    className="v2-section-toggle"
                    onClick={() => setShowV2Section(!showV2Section)}
                  >
                    <Icon name={showV2Section ? "chevron-down" : "chevron-right"} size={16} />
                    <span>AI-Extracted Metadata</span>
                    {letter.metadata.emotionalTone && (
                      <span className="v2-preview-badge">{letter.metadata.emotionalTone}</span>
                    )}
                  </button>

                  {showV2Section && (
                    <div className="v2-fields">
                      <div className="form-row">
                        <div className="form-group">
                          <label htmlFor="emotionalTone">Emotional Tone</label>
                          <select
                            id="emotionalTone"
                            value={emotionalTone}
                            onChange={(e) => setEmotionalTone(e.target.value as EmotionalTone | "")}
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
                          <label htmlFor="relationship">Sender/Recipient Relationship</label>
                          <select
                            id="relationship"
                            value={relationship}
                            onChange={(e) => setRelationship(e.target.value as RelationshipType | "")}
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
                        <div className="topics-grid">
                          {PRIMARY_TOPICS.map((topic) => (
                            <label key={topic} className="topic-checkbox">
                              <input
                                type="checkbox"
                                checked={primaryTopics.includes(topic)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setPrimaryTopics([...primaryTopics, topic]);
                                  } else {
                                    setPrimaryTopics(primaryTopics.filter((t) => t !== topic));
                                  }
                                }}
                              />
                              <span>{topic.replace('/', ' / ')}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Notable Quotes (read-only display) */}
                      {letter.metadata.notableQuotes && letter.metadata.notableQuotes.length > 0 && (
                        <div className="form-group">
                          <label>Notable Quotes</label>
                          <div className="notable-quotes">
                            {letter.metadata.notableQuotes.map((quote, idx) => (
                              <blockquote key={idx} className="notable-quote">
                                <p>"{quote.text}"</p>
                                {quote.context && <cite>— {quote.context}</cite>}
                              </blockquote>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Linked Entities Section */}
                      {(letter.linkedPersons?.length || letter.linkedPlaces?.length) ? (
                        <div className="linked-entities">
                          {letter.linkedPersons && letter.linkedPersons.length > 0 && (
                            <div className="entity-group">
                              <label>Linked People</label>
                              <div className="entity-list">
                                {letter.linkedPersons.map((lp) => (
                                  <div key={lp.id} className="entity-item">
                                    <span className="entity-name">{lp.canonicalName}</span>
                                    <span className={`entity-role role-${lp.role}`}>{lp.role}</span>
                                    <span className="entity-confidence">{lp.confidence}%</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {letter.linkedPlaces && letter.linkedPlaces.length > 0 && (
                            <div className="entity-group">
                              <label>Linked Places</label>
                              <div className="entity-list">
                                {letter.linkedPlaces.map((lpl) => (
                                  <div key={lpl.id} className="entity-item">
                                    <span className="entity-name">{lpl.canonicalName}</span>
                                    <span className={`entity-role role-${lpl.role}`}>{lpl.role}</span>
                                    <span className="entity-confidence">{lpl.confidence}%</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              {/* Metadata Verification footer */}
              <div className="section-footer">
                {letter.metadataContentStatus === 'VERIFIED' ? (
                  <div className="verified-info">
                    <Icon name="check" size={14} />
                    <span>Verified{letter.metadataVerifiedAt && ` on ${new Date(letter.metadataVerifiedAt).toLocaleDateString()}`}</span>
                    <button
                      className="unverify-btn"
                      onClick={handleUnverifyMetadata}
                      disabled={saving}
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    icon="check"
                    onClick={handleVerifyMetadata}
                    disabled={saving || letter.metadataContentStatus === 'EMPTY'}
                  >
                    Mark Metadata Done
                  </Button>
                )}
              </div>
            </div>

            {/* Message */}
            {message && (
              <div className={`message ${message.includes("Failed") ? "error" : "success"}`}>
                {message}
              </div>
            )}

            {/* Status indicators (processing, complete) */}
            {letter.workflowState === "TRANSCRIBED" && letter.transcriptConfirmedAt && (
              <div className="processing-indicator">
                Extracting metadata...
              </div>
            )}

            {letter.transcriptStatus === "VERIFIED" && letter.metadataContentStatus === "VERIFIED" && (
              <div className="reviewed-indicator">
                Complete — both transcript and metadata verified
              </div>
            )}
          </div>
        </ResizableSplitPane>
      </div>

    </div>
  );
}
