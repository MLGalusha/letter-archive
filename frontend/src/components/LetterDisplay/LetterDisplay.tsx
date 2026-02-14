import { useCallback, useRef, useState, useEffect } from "react";
import type { Letter, LetterImage } from "../../types/Letter";
import LetterViewer from "../LetterViewer/LetterViewer";
import Breadcrumb from "../Breadcrumb";
import LetterNav from "../LetterNav";
import { ResizableSplitPane } from "../common";
import "./LetterDisplay.css";

interface LetterDisplayProps {
  letter: Letter;
}

export default function LetterDisplay({ letter }: LetterDisplayProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [isTranscriptVisible, setIsTranscriptVisible] = useState(true);

  // Count letter pages for single-page header hiding
  const letterPageCount = letter.images.filter(img => img.type === 'letter').length;

  // Build breadcrumb items
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Collections', href: '/collections' },
  ];
  if (letter.collectionCode) {
    breadcrumbItems.push({
      label: letter.collectionCode,
      href: `/collections/${letter.collectionCode}`,
    });
  }
  breadcrumbItems.push({ label: letter.title, href: `/letters/${letter.id}` });

  // Track transcript visibility with Intersection Observer
  useEffect(() => {
    if (!transcriptRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Consider visible if >10% is showing
        setIsTranscriptVisible(entry.intersectionRatio > 0.1);
      },
      { threshold: [0, 0.1, 0.5, 1] }
    );

    observer.observe(transcriptRef.current);
    return () => observer.disconnect();
  }, []);

  // Handle page change from LetterViewer - smooth scroll to corresponding transcript
  const handlePageChange = useCallback((_index: number, image: LetterImage) => {
    // Only scroll for letter pages, not envelopes/cards
    if (image.type !== 'letter') return;

    // Only scroll if transcript is visible (user hasn't scrolled to metadata)
    if (!isTranscriptVisible) return;

    // Don't scroll if only one letter page
    if (letterPageCount <= 1) return;

    // SMOOTH scroll to corresponding page section
    const pageHeader = document.querySelector(`[data-page="${image.pageNumber}"]`);
    pageHeader?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }, [isTranscriptVisible, letterPageCount]);

  return (
    <div className="letter-display">
      <Breadcrumb items={breadcrumbItems} />
      <LetterNav letterId={letter.id} />

      <div className="display-body">
        <ResizableSplitPane
          letterId={letter.id}
          className="display-layout"
          firstPanelClassName="images-panel"
          secondPanelClassName="details-panel"
        >
          {/* Left side: Letter viewer */}
          <LetterViewer
            images={letter.images}
            letterId={letter.id}
            showOnlyLetterPages={false}
            onPageChange={handlePageChange}
          />

          {/* Right side: Read-only content */}
          <div className="details-panel-content">
            {/* Transcript Section - only shown when letter has letter-type images */}
            {letterPageCount > 0 && (
            <div className="transcript-section">
              <div className="section-header">
                <h2>Transcript</h2>
                {letter.transcript.verified && (
                  <span className="verified-badge">✓ Verified</span>
                )}
              </div>
              <div className="section-content" ref={transcriptRef}>
                {letter.transcript.pages.length > 0 ? (
                  <div className="transcript-pages">
                    {letter.transcript.pages.map((page) => (
                      <div key={page.pageNumber} className="transcript-page" data-page={page.pageNumber}>
                        {/* Hide "Page X" header if only one letter page */}
                        {letterPageCount > 1 && (
                          <div className="page-number">Page {page.pageNumber}</div>
                        )}
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
            )}

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
        </ResizableSplitPane>
      </div>
    </div>
  );
}
