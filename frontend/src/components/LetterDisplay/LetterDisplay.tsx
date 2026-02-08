import { useNavigate } from "react-router-dom";
import type { Letter } from "../../types/Letter";
import LetterViewer from "../LetterViewer/LetterViewer";
import { Button } from "../common";
import "./LetterDisplay.css";

interface LetterDisplayProps {
  letter: Letter;
}

export default function LetterDisplay({ letter }: LetterDisplayProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <div className="letter-display">
      <header className="display-header">
        <h1>{letter.title}</h1>
        <Button icon="back" onClick={handleBack}>
          Back
        </Button>
      </header>

      <div className="display-body">
        <div className="display-layout">
          {/* Left side: Letter viewer */}
          <div className="images-panel">
            <LetterViewer images={letter.images} showOnlyLetterPages={false} />
          </div>

          {/* Right side: Read-only content */}
          <div className="details-panel">
            {/* Transcript Section */}
            <div className="transcript-section">
              <div className="section-header">
                <h2>Transcript</h2>
                {letter.transcript.verified && (
                  <span className="verified-badge">✓ Verified</span>
                )}
              </div>
              <div className="section-content">
                {letter.transcript.pages.length > 0 ? (
                  <div className="transcript-pages">
                    {letter.transcript.pages.map((page) => (
                      <div key={page.pageNumber} className="transcript-page">
                        <div className="page-number">Page {page.pageNumber}</div>
                        <p className="transcript-text">{page.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="transcript-full">
                    <p className="transcript-text">{letter.transcript.fullText}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Section */}
            <div className="metadata-section">
              <h2>Details</h2>
              <div className="metadata-grid">
                {letter.metadata.sender && (
                  <div className="metadata-item">
                    <span className="metadata-label">From</span>
                    <span className="metadata-value">{letter.metadata.sender}</span>
                  </div>
                )}
                {letter.metadata.recipient && (
                  <div className="metadata-item">
                    <span className="metadata-label">To</span>
                    <span className="metadata-value">{letter.metadata.recipient}</span>
                  </div>
                )}
                {letter.metadata.date && (
                  <div className="metadata-item">
                    <span className="metadata-label">Date</span>
                    <span className="metadata-value">{letter.metadata.date}</span>
                  </div>
                )}
                {letter.metadata.location && (
                  <div className="metadata-item">
                    <span className="metadata-label">Location</span>
                    <span className="metadata-value">{letter.metadata.location}</span>
                  </div>
                )}
                {letter.metadata.description && (
                  <div className="metadata-item metadata-full-width">
                    <span className="metadata-label">Description</span>
                    <span className="metadata-value">{letter.metadata.description}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
