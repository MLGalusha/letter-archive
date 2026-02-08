import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAdminLetterById, deleteLetter } from "../../api/letters";
import { updateLetter, markAsReviewed, confirmTranscript } from "../../api/admin";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import { useToast } from "../../contexts/ToastContext";
import { Button, Icon, WorkflowBadge, StatusBadge } from "../../components/common";
import { trackEdit } from "../../utils/recentEdits";
import type { Letter, LetterImage, VisibilityState } from "../../types/Letter";
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
  const [dateConfidence, setDateConfidence] = useState<"exact" | "unknown" | "inferred">("unknown");
  const [location, setLocation] = useState("");
  const [hook, setHook] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [transcriptFontSize, setTranscriptFontSize] = useState("1.1rem");
  const [currentFilename, setCurrentFilename] = useState<string | undefined>(undefined);
  const editorRef = useRef<HTMLDivElement>(null);
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

    const containerWidth = editor.clientWidth - 32; // Account for padding
    const lines = transcript.split('\n');
    const baseFontSize = 1.1; // rem

    // Create canvas for measuring text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get computed font to match actual rendering
    const computedStyle = window.getComputedStyle(editor);
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
      const scale = Math.max(0.5, containerWidth / maxWidth); // Don't go below 50%
      setTranscriptFontSize(`${baseFontSize * scale}rem`);
    } else {
      setTranscriptFontSize(`${baseFontSize}rem`);
    }
  }, [transcript]);

  // Recalculate font size when transcript changes or on resize
  useEffect(() => {
    calculateFontSize();

    // Also recalculate on window resize
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
    setSaving(true);
    setMessage("");

    try {
      const tagsArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Read transcript directly from contenteditable ref to ensure we have latest content
      const currentTranscript = editorRef.current?.innerText || transcript;

      const updated = await updateLetter(letterId, {
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
      });

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

  const handleVisibilityChange = async (newVisibility: VisibilityState) => {
    if (!letterId || !letter) return;
    if (letter.visibility === newVisibility) return;

    setSaving(true);

    try {
      const updated = await updateLetter(letterId, { visibility: newVisibility });
      setLetter(updated);
      showToast(`Visibility changed to ${newVisibility.toLowerCase()}`, "success");

      // Only redirect on publish
      if (newVisibility === "PUBLISHED") {
        setTimeout(() => navigate("/admin"), 1500);
      }
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

  const handleMarkReviewed = async () => {
    if (!letterId) return;
    setSaving(true);

    try {
      const updated = await markAsReviewed(letterId);
      setLetter(updated);
      showToast("Letter marked as reviewed", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to mark as reviewed", "error");
      console.error("Review error:", err);
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
        <div className="header-actions">
          <button
            className="header-action save"
            onClick={handleSave}
            disabled={saving}
            data-tooltip="Save"
          >
            <Icon name="save" size={18} />
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

          {/* Review button - for METADATA states */}
          {["METADATA_EXTRACTING", "METADATA_DRAFTED"].includes(letter.workflowState) && (
            <button
              className="header-action review"
              onClick={handleMarkReviewed}
              disabled={saving}
              data-tooltip="Mark Reviewed"
            >
              <Icon name="check" size={18} />
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
        <div className="review-layout">
          {/* Left side: Letter viewer */}
          <div className="images-panel">
            <LetterViewer
              images={letter.images}
              showOnlyLetterPages={false}
              onPageChange={handlePageChange}
            />
          </div>

          {/* Right side: Editable content */}
          <div className="edit-panel">
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
                    className={`toggle-btn ${letter.visibility === "DRAFT" ? "active" : ""}`}
                    onClick={() => handleVisibilityChange("DRAFT")}
                    disabled={saving}
                  >
                    Draft
                  </button>
                  <button
                    className={`toggle-btn ${letter.visibility === "PUBLISHED" ? "active published" : ""}`}
                    onClick={() => handleVisibilityChange("PUBLISHED")}
                    disabled={saving}
                  >
                    Published
                  </button>
                  <button
                    className={`toggle-btn ${letter.visibility === "HIDDEN" ? "active hidden" : ""}`}
                    onClick={() => handleVisibilityChange("HIDDEN")}
                    disabled={saving}
                  >
                    Hidden
                  </button>
                </div>
              </div>
            </div>

            {/* Transcription Editor */}
            <div className="editor-section">
              <div className="editor-header">
                <h2>Transcription</h2>
                {letter.workflowState !== "UPLOADED" && (
                  <StatusBadge status="auto" label="Auto-transcribed" />
                )}
              </div>
              <div className="editor-container">
                <div
                  ref={editorRef}
                  className="transcript-editor"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Enter letter transcription..."
                  style={{ "--transcript-font-size": transcriptFontSize } as React.CSSProperties}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    setTranscript(target.innerText);
                  }}
                  onKeyDown={handleEditorKeyDown}
                />
              </div>
            </div>

            {/* Metadata Form */}
            <div className="metadata-section">
              <h2>Metadata</h2>
              <div className="metadata-form">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="sender">Sender</label>
                    <input
                      type="text"
                      id="sender"
                      value={sender}
                      onChange={(e) => setSender(e.target.value)}
                      placeholder="Who wrote the letter"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="recipient">Recipient</label>
                    <input
                      type="text"
                      id="recipient"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
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
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., New York, NY"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="hook">Hook</label>
                  <textarea
                    ref={hookRef}
                    id="hook"
                    value={hook}
                    onChange={(e) => setHook(e.target.value)}
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
                    onChange={(e) => setDescription(e.target.value)}
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
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Internal notes (not shown publicly)"
                  />
                  <span className="help-text">For internal reference only</span>
                </div>
              </div>
            </div>

            {/* Message */}
            {message && (
              <div className={`message ${message.includes("Failed") ? "error" : "success"}`}>
                {message}
              </div>
            )}

            {/* Status indicators (processing, reviewed) */}
            {letter.workflowState === "TRANSCRIBED" && letter.transcriptConfirmedAt && (
              <div className="processing-indicator">
                Extracting metadata...
              </div>
            )}

            {letter.workflowState === "REVIEWED" && letter.metadata.verifiedAt && (
              <div className="reviewed-indicator">
                Reviewed on {new Date(letter.metadata.verifiedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
