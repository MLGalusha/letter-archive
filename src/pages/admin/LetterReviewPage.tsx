import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getLetterById } from "../../data/mockLetters";
import LetterViewer from "../../components/LetterViewer/LetterViewer";
import type { Letter } from "../../types/Letter";
import "./LetterReviewPage.css";

export default function LetterReviewPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [transcript, setTranscript] = useState("");
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check if admin is authenticated
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
      return;
    }

    // Load letter data
    if (letterId) {
      const foundLetter = getLetterById(letterId);
      if (foundLetter) {
        setLetter(foundLetter);
        setTranscript(foundLetter.transcript.fullText);
        setSender(foundLetter.metadata.sender || "");
        setRecipient(foundLetter.metadata.recipient || "");
        setDate(foundLetter.metadata.date || "");
        setLocation(foundLetter.metadata.location || "");
        setDescription(foundLetter.metadata.description || "");
      } else {
        setMessage("Letter not found");
      }
    }
  }, [letterId, navigate]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [transcript]);

  const handleSave = () => {
    setSaving(true);
    setMessage("");

    // Mock save - in real app, this would call an API
    setTimeout(() => {
      setSaving(false);
      setMessage("Changes saved successfully");
    }, 1000);
  };

  const handlePublish = () => {
    setSaving(true);
    setMessage("");

    // Mock publish - in real app, this would update status via API
    setTimeout(() => {
      setSaving(false);
      setMessage("Letter published successfully");
      setTimeout(() => navigate("/admin"), 1500);
    }, 1000);
  };

  const handleHide = () => {
    setSaving(true);
    setMessage("");

    // Mock hide - in real app, this would update status via API
    setTimeout(() => {
      setSaving(false);
      setMessage("Letter hidden successfully");
      setTimeout(() => navigate("/admin"), 1500);
    }, 1000);
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this letter?")) {
      setSaving(true);
      setMessage("");

      // Mock delete - in real app, this would call delete API
      setTimeout(() => {
        setSaving(false);
        setMessage("Letter deleted successfully");
        setTimeout(() => navigate("/admin"), 1500);
      }, 1000);
    }
  };

  const handleBack = () => {
    navigate("/admin");
  };

  if (!letter) {
    return (
      <div className="letter-review-page">
        <header className="review-header">
          <h1>Letter Review</h1>
          <button onClick={handleBack} className="back-button">
            Back to Dashboard
          </button>
        </header>
        <div className="review-content">
          <p>{message || "Loading..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="letter-review-page">
      <header className="review-header">
        <h1>Review Letter #{letter.id}</h1>
        <button onClick={handleBack} className="back-button">
          Back to Dashboard
        </button>
      </header>

      <div className="review-content">
        <div className="review-layout">
          {/* Left side: Letter viewer */}
          <div className="images-panel">
            <LetterViewer images={letter.images} showOnlyLetterPages={true} />
          </div>

          {/* Right side: Editable content */}
          <div className="edit-panel">
            <div className="edit-section">
              <h2>Transcription</h2>
              <textarea
                ref={textareaRef}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="transcript-textarea"
                placeholder="Enter letter transcription..."
              />
            </div>

            <div className="edit-section">
              <h2>Metadata</h2>
              <div className="metadata-form">
                <div className="form-group">
                  <label htmlFor="sender">Sender</label>
                  <input
                    type="text"
                    id="sender"
                    value={sender}
                    onChange={(e) => setSender(e.target.value)}
                    placeholder="Sender name"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="recipient">Recipient</label>
                  <input
                    type="text"
                    id="recipient"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Recipient name"
                  />
                </div>
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
                  <label htmlFor="location">Location</label>
                  <input
                    type="text"
                    id="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., New York, NY"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="description">Description</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Brief description of letter content"
                  />
                </div>
              </div>
            </div>

            {message && (
              <div className={`message ${message.includes("success") ? "success" : "error"}`}>
                {message}
              </div>
            )}

            <div className="action-buttons">
              <div className="primary-actions">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="save-button"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handlePublish}
                  disabled={saving}
                  className="publish-button"
                >
                  Publish
                </button>
                <button
                  onClick={handleHide}
                  disabled={saving}
                  className="hide-button"
                >
                  Hide
                </button>
              </div>
              <div className="danger-actions">
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="delete-button"
                >
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
