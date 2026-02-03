import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getLetterById } from "../../api/letters";
import { updateLetter, deleteLetter, markAsReviewed } from "../../api/admin";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import type { Letter, VisibilityState, WorkflowState } from "../../types/Letter";
import "./LetterReviewPage.css";

const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  UPLOADED: "Uploaded",
  TRANSCRIBING: "Transcribing",
  TRANSCRIBED: "Transcribed",
  METADATA_EXTRACTING: "Extracting Metadata",
  METADATA_DRAFTED: "Metadata Ready",
  REVIEWED: "Reviewed",
};

export default function LetterReviewPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [transcript, setTranscript] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [date, setDate] = useState("");
  const [dateConfidence, setDateConfidence] = useState<"exact" | "unknown" | "inferred">("unknown");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
          const foundLetter = await getLetterById(letterId!);
          setLetter(foundLetter);
          setTranscript(foundLetter.transcript.fullText);
          setSender(foundLetter.metadata.sender || "");
          setRecipient(foundLetter.metadata.recipient || "");
          setDate(foundLetter.metadata.date || "");
          setDateConfidence(foundLetter.metadata.dateConfidence || "unknown");
          setLocation(foundLetter.metadata.location || "");
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

  // Auto-resize transcript textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [transcript]);

  // Auto-resize description textarea
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [description]);

  // Auto-resize notes textarea
  useEffect(() => {
    const textarea = notesRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
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

      const updated = await updateLetter(letterId, {
        transcriptionText: transcript,
        sender: sender || null,
        recipient: recipient || null,
        extractedDate: date || null,
        extractedDateConfidence: dateConfidence,
        locationWritten: location || null,
        summary: description || null,
        tags: tagsArray.length > 0 ? tagsArray : null,
        notes: notes || null,
      });
      setLetter(updated);
      setMessage("Changes saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleVisibilityChange = async (newVisibility: VisibilityState) => {
    if (!letterId || !letter) return;
    if (letter.visibility === newVisibility) return;

    setSaving(true);
    setMessage("");

    try {
      const updated = await updateLetter(letterId, { visibility: newVisibility });
      setLetter(updated);
      setMessage(`Visibility changed to ${newVisibility.toLowerCase()}`);

      // Only redirect on publish
      if (newVisibility === "PUBLISHED") {
        setTimeout(() => navigate("/admin"), 1500);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update visibility");
      console.error("Visibility change error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkReviewed = async () => {
    if (!letterId) return;
    setSaving(true);
    setMessage("");

    try {
      const updated = await markAsReviewed(letterId);
      setLetter(updated);
      setMessage("Letter marked as reviewed");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to mark as reviewed");
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
    setMessage("");

    try {
      await deleteLetter(letterId);
      setMessage("Letter deleted");
      setTimeout(() => navigate("/admin"), 1500);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete");
      console.error("Delete error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    navigate("/admin");
  };

  if (loading || !letter) {
    return (
      <div className="letter-review-page">
        <header className="review-header">
          <h1>Letter Review</h1>
          <button onClick={handleBack} className="back-button">
            Back to Dashboard
          </button>
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
        <h1>{letter.title}</h1>
        <button onClick={handleBack} className="back-button">
          Back
        </button>
      </header>

      <div className="review-content">
        <div className="review-layout">
          {/* Left side: Letter viewer */}
          <div className="images-panel">
            <LetterViewer images={letter.images} showOnlyLetterPages={false} />
          </div>

          {/* Right side: Editable content */}
          <div className="edit-panel">
            {/* Status Panel */}
            <div className="status-panel">
              <div className="status-item">
                <span className="status-label">Workflow</span>
                <span className={`status-badge badge-workflow-${letter.workflowState.toLowerCase()}`}>
                  {WORKFLOW_LABELS[letter.workflowState]}
                </span>
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
                  <span className="auto-badge">Auto-transcribed</span>
                )}
              </div>
              <div className="editor-container">
                <textarea
                  ref={textareaRef}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="transcript-textarea"
                  placeholder="Enter letter transcription..."
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
                  <label htmlFor="description">Summary</label>
                  <textarea
                    ref={descriptionRef}
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of letter content"
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

            {/* Action Buttons */}
            <div className="action-bar">
              <div className="left-actions">
                <button onClick={handleSave} disabled={saving} className="save-btn">
                  {saving ? "Saving..." : "Save Changes"}
                </button>

                {letter.workflowState !== "REVIEWED" && (
                  <button onClick={handleMarkReviewed} disabled={saving} className="review-btn">
                    Mark as Reviewed
                  </button>
                )}

                {letter.workflowState === "REVIEWED" && letter.metadata.verifiedAt && (
                  <span className="reviewed-indicator">
                    Reviewed on {new Date(letter.metadata.verifiedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="right-actions">
                <button onClick={handleDelete} disabled={saving} className="delete-btn">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
