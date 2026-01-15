import type { FormEvent } from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./UploadLetterPage.css";

interface ImagePreview {
  file: File;
  url: string;
}

export default function UploadLetterPage() {
  const navigate = useNavigate();
  const [letterImages, setLetterImages] = useState<ImagePreview[]>([]);
  const [envelopeImages, setEnvelopeImages] = useState<ImagePreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    // Check if admin is authenticated
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }

    // Cleanup URLs on unmount
    return () => {
      letterImages.forEach((img) => URL.revokeObjectURL(img.url));
      envelopeImages.forEach((img) => URL.revokeObjectURL(img.url));
    };
  }, [navigate]);

  const handleLetterFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const previews = files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      // Append new images to existing ones
      setLetterImages((prev) => [...prev, ...previews]);
    }
  };

  const handleEnvelopeFilesChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const previews = files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      // Append new images to existing ones
      setEnvelopeImages((prev) => [...prev, ...previews]);
    }
  };

  const handleDragStart = (index: number, _type: "letter" | "envelope") => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (
    e: React.DragEvent,
    dropIndex: number,
    type: "letter" | "envelope"
  ) => {
    e.preventDefault();
    if (draggedIndex === null) return;

    const images = type === "letter" ? [...letterImages] : [...envelopeImages];
    const [draggedImage] = images.splice(draggedIndex, 1);
    images.splice(dropIndex, 0, draggedImage);

    if (type === "letter") {
      setLetterImages(images);
    } else {
      setEnvelopeImages(images);
    }
    setDraggedIndex(null);
  };

  const handleRemoveImage = (index: number, type: "letter" | "envelope") => {
    if (type === "letter") {
      const newImages = [...letterImages];
      URL.revokeObjectURL(newImages[index].url);
      newImages.splice(index, 1);
      setLetterImages(newImages);
    } else {
      const newImages = [...envelopeImages];
      URL.revokeObjectURL(newImages[index].url);
      newImages.splice(index, 1);
      setEnvelopeImages(newImages);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (letterImages.length === 0) {
      setMessage("Please select at least one letter image");
      return;
    }

    setUploading(true);
    setMessage("");

    // Mock upload process
    // In real implementation, this would upload to backend and trigger AI processing
    setTimeout(() => {
      setUploading(false);
      setMessage(
        "Letter uploaded successfully! Processing will begin shortly."
      );

      // Redirect back to admin panel after a brief delay
      setTimeout(() => {
        navigate("/admin");
      }, 1500);
    }, 2000);
  };

  const handleCancel = () => {
    navigate("/admin");
  };

  return (
    <div className="upload-letter-page">
      <header className="upload-header">
        <h1>Upload New Letter</h1>
        <button onClick={handleCancel} className="cancel-button">
          Back to Dashboard
        </button>
      </header>

      <div className="upload-content">
        <form onSubmit={handleSubmit} className="upload-form">
          <div className="upload-section">
            <h2>Letter Images</h2>
            <p className="upload-description">
              Select images of the letter pages. Drag and drop to reorder.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleLetterFilesChange}
              className="file-input"
              id="letter-images"
            />
            <label htmlFor="letter-images" className="file-label">
              Choose Letter Images
            </label>
            {letterImages.length > 0 && (
              <div className="image-preview-grid">
                {letterImages.map((image, index) => (
                  <div
                    key={index}
                    className="image-preview-item"
                    draggable
                    onDragStart={() => handleDragStart(index, "letter")}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index, "letter")}
                  >
                    <div className="image-number">Page {index + 1}</div>
                    <img src={image.url} alt={`Letter page ${index + 1}`} />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index, "letter")}
                      className="remove-image-button"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="upload-section">
            <h2>Envelope Images (Optional)</h2>
            <p className="upload-description">
              Select images of the envelope. Drag and drop to reorder.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleEnvelopeFilesChange}
              className="file-input"
              id="envelope-images"
            />
            <label htmlFor="envelope-images" className="file-label">
              Choose Envelope Images
            </label>
            {envelopeImages.length > 0 && (
              <div className="image-preview-grid">
                {envelopeImages.map((image, index) => (
                  <div
                    key={index}
                    className="image-preview-item"
                    draggable
                    onDragStart={() => handleDragStart(index, "envelope")}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index, "envelope")}
                  >
                    <div className="image-number">Envelope {index + 1}</div>
                    <img src={image.url} alt={`Envelope ${index + 1}`} />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index, "envelope")}
                      className="remove-image-button"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {message && (
            <div
              className={`message ${
                message.includes("success") ? "success" : "error"
              }`}
            >
              {message}
            </div>
          )}

          <div className="upload-actions">
            <button
              type="button"
              onClick={handleCancel}
              className="cancel-action-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="submit-button"
            >
              {uploading ? "Uploading..." : "Upload & Process"}
            </button>
          </div>
        </form>

        <div className="upload-info">
          <h3>What happens after upload?</h3>
          <ol>
            <li>Images are uploaded to the server</li>
            <li>AI transcription is automatically triggered</li>
            <li>Metadata is extracted from the letter</li>
            <li>Letter status is set to "Needs Review"</li>
            <li>You can then review and edit the letter in the admin panel</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
