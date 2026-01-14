import { useState } from "react";
import type { Letter } from "../../types/Letter";
import LetterViewer from "../LetterViewer/LetterViewer";
import "./LetterDisplay.css";

interface LetterDisplayProps {
  letter: Letter;
}

export default function LetterDisplay({ letter }: LetterDisplayProps) {
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  return (
    <div className="letter-display">
      <div className="letter-display-container">
        {/* Header */}
        <div className="letter-header">
          <h1>{letter.title}</h1>
          {letter.metadata.date && (
            <p className="letter-date-large">{letter.metadata.date}</p>
          )}
        </div>

        {/* Image Section - Using LetterViewer component */}
        <div className="letter-image-section">
          <LetterViewer images={letter.images} showOnlyLetterPages={false} />
        </div>

        {/* Transcript Section */}
        <div className="letter-transcript-section card">
          <div className="transcript-header">
            <h2>Transcript</h2>
            {letter.transcript.verified && (
              <span className="verified-badge">✓ Verified</span>
            )}
          </div>

          {letter.transcript.pages.length > 1 && !showFullTranscript ? (
            <div className="transcript-pages">
              {letter.transcript.pages.map((page) => (
                <div key={page.pageNumber} className="transcript-page">
                  <h4>Page {page.pageNumber}</h4>
                  <p className="transcript-text">{page.text}</p>
                  {page.confidence && (
                    <span className="confidence-badge">
                      {Math.round(page.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="transcript-full">
              <p className="transcript-text">{letter.transcript.fullText}</p>
            </div>
          )}

          {letter.transcript.pages.length > 1 && (
            <button
              className="toggle-transcript-button"
              onClick={() => setShowFullTranscript(!showFullTranscript)}
            >
              {showFullTranscript ? "Show by page" : "Show full text"}
            </button>
          )}
        </div>

        {/* Metadata Section */}
        <div className="letter-metadata-section card">
          <h3>Details</h3>
          <div className="metadata-grid">
            {letter.metadata.sender && (
              <div className="metadata-item">
                <h4>From</h4>
                <p>{letter.metadata.sender}</p>
              </div>
            )}
            {letter.metadata.recipient && (
              <div className="metadata-item">
                <h4>To</h4>
                <p>{letter.metadata.recipient}</p>
              </div>
            )}
            {letter.metadata.date && (
              <div className="metadata-item">
                <h4>Date</h4>
                <p>{letter.metadata.date}</p>
              </div>
            )}
            {letter.metadata.location && (
              <div className="metadata-item">
                <h4>Location</h4>
                <p>{letter.metadata.location}</p>
              </div>
            )}
            {letter.metadata.description && (
              <div className="metadata-item metadata-description">
                <h4>Description</h4>
                <p>{letter.metadata.description}</p>
              </div>
            )}
          </div>

          {letter.metadata.verified && (
            <div className="verification-info">
              <hr className="divider" />
              <h4>Verification</h4>
              <p>
                {letter.metadata.verifiedBy && (
                  <>Verified by {letter.metadata.verifiedBy}</>
                )}
                {letter.metadata.verifiedAt && (
                  <>
                    {" "}
                    on{" "}
                    {new Date(letter.metadata.verifiedAt).toLocaleDateString()}
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
