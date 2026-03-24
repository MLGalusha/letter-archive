import { useCallback, useRef, useState, useEffect, type CSSProperties } from "react";
import type { Letter, LetterImage } from "../../types/Letter";
import LetterViewer from "../LetterViewer/LetterViewer";
import { ResizableSplitPane } from "../common";
import {
  EMOTIONAL_TONE_OPTIONS,
  METADATA_RELATIONSHIP_OPTIONS,
} from "../../constants/enums";
import "./LetterDisplay.css";

interface LetterDisplayProps {
  letter: Letter;
}

export default function LetterDisplay({ letter }: LetterDisplayProps) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [isTranscriptVisible, setIsTranscriptVisible] = useState(true);
  const [transcriptFontSize, setTranscriptFontSize] = useState("1.1rem");

  // Count letter pages for single-page header hiding
  const letterPageCount = letter.images.filter(img => img.type === 'letter').length;

  const fullText = letter.transcript.fullText;

  // Calculate font size so the longest line fits the container width
  const calculateFontSize = useCallback(() => {
    const container = transcriptRef.current;
    if (!container || !fullText) {
      setTranscriptFontSize("1.1rem");
      return;
    }

    const computedStyle = window.getComputedStyle(container);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const containerWidth = container.clientWidth - paddingLeft - paddingRight;
    const baseFontSize = 1.1; // rem

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use the actual transcript text element's font for accurate measurement
    const textEl = container.querySelector(".transcript-text");
    const fontFamily = textEl
      ? window.getComputedStyle(textEl).fontFamily
      : "'Courier New', Courier, monospace";
    ctx.font = `${baseFontSize * 16}px ${fontFamily}`;

    let maxWidth = 0;
    for (const line of fullText.split("\n")) {
      if (line.trim()) {
        const width = ctx.measureText(line).width;
        if (width > maxWidth) maxWidth = width;
      }
    }

    if (maxWidth > containerWidth) {
      const scale = Math.max(0.4, containerWidth / maxWidth);
      setTranscriptFontSize(`${baseFontSize * scale}rem`);
    } else {
      setTranscriptFontSize(`${baseFontSize}rem`);
    }
  }, [fullText]);

  // Recalculate font size on mount, text change, and container resize
  useEffect(() => {
    calculateFontSize();
    const container = transcriptRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => calculateFontSize());
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [calculateFontSize]);

  // Track transcript visibility with Intersection Observer
  useEffect(() => {
    if (!transcriptRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
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

  const buildImageAlt = useCallback((image: LetterImage) => {
    const people = letter.metadata.sender && letter.metadata.recipient
      ? `letter from ${letter.metadata.sender} to ${letter.metadata.recipient}`
      : letter.metadata.sender
        ? `letter from ${letter.metadata.sender}`
        : letter.metadata.recipient
          ? `letter to ${letter.metadata.recipient}`
          : `${image.type} item`;
    const pagePart = image.pageNumber ? `Page ${image.pageNumber} of ${people}` : people;
    const datePart = letter.metadata.date ? `, ${letter.metadata.date}` : '';
    return `${pagePart}${datePart}`;
  }, [
    letter.metadata.date,
    letter.metadata.recipient,
    letter.metadata.sender,
  ]);

  return (
    <div className="letter-display">
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
            getImageAlt={buildImageAlt}
          />

          {/* Right side: Read-only content */}
          <div className="details-panel-content">
            {/* Transcript Section - only shown when letter has letter-type images */}
            {letterPageCount > 0 && (
            <div className="transcript-section">
              <div className="section-header">
                <h2>Transcript</h2>
                {letter.transcript.verified && (
                  <span className="verified-badge">Verified</span>
                )}
              </div>
              <div
                className="section-content"
                ref={transcriptRef}
                style={{ "--transcript-font-size": transcriptFontSize } as CSSProperties}
              >
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

            {/* Extra Content Section - shown for telegrams, covers, ephemera */}
            {letter.extraContentTranscript && (
              <div className="extra-content-section">
                <div className="section-header">
                  <h2>Extra Content</h2>
                  {letter.extraContentStatus === "VERIFIED" && (
                    <span className="verified-badge">Verified</span>
                  )}
                </div>
                <div className="section-content">
                  <p className="transcript-text">{letter.extraContentTranscript}</p>
                </div>
              </div>
            )}

            {/* Metadata Section - mirrors admin layout */}
            <div className="metadata-section">
              <div className="section-header">
                <h2>Details</h2>
              </div>
              <div className="metadata-form-readonly">
                {/* From / To row */}
                {(letter.metadata.sender || letter.metadata.recipient) && (
                  <div className="form-row-readonly">
                    {letter.metadata.sender && (
                      <div className="form-group-readonly">
                        <span className="field-label">From</span>
                        <span className="field-value">{letter.metadata.sender}</span>
                      </div>
                    )}
                    {letter.metadata.recipient && (
                      <div className="form-group-readonly">
                        <span className="field-label">To</span>
                        <span className="field-value">{letter.metadata.recipient}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Date / Location row */}
                {(letter.metadata.date || letter.metadata.location) && (
                  <div className="form-row-readonly">
                    {letter.metadata.date && (
                      <div className="form-group-readonly">
                        <span className="field-label">Date</span>
                        <span className="field-value">
                          {letter.metadata.date}
                          {letter.metadata.dateConfidence && letter.metadata.dateConfidence !== "exact" && (
                            <span className="confidence-inline"> ({letter.metadata.dateConfidence})</span>
                          )}
                        </span>
                      </div>
                    )}
                    {letter.metadata.location && (
                      <div className="form-group-readonly">
                        <span className="field-label">Location</span>
                        <span className="field-value">{letter.metadata.location}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Hook */}
                {letter.metadata.hook && (
                  <div className="form-group-readonly">
                    <span className="field-label">Hook</span>
                    <span className="field-value">{letter.metadata.hook}</span>
                  </div>
                )}

                {/* Summary / Description */}
                {letter.metadata.description && (
                  <div className="form-group-readonly">
                    <span className="field-label">Summary</span>
                    <span className="field-value description-value">{letter.metadata.description}</span>
                  </div>
                )}

                {/* Emotional Tone / Relationship row */}
                {(letter.metadata.emotionalTone || letter.metadata.senderRecipientRelationship) && (
                  <div className="form-row-readonly">
                    {letter.metadata.emotionalTone && (
                      <div className="form-group-readonly">
                        <span className="field-label">Emotional Tone</span>
                        <span className="field-value">
                          {EMOTIONAL_TONE_OPTIONS.find(o => o.value === letter.metadata.emotionalTone)?.label ?? letter.metadata.emotionalTone}
                        </span>
                      </div>
                    )}
                    {letter.metadata.senderRecipientRelationship && (
                      <div className="form-group-readonly">
                        <span className="field-label">Relationship</span>
                        <span className="field-value">
                          {METADATA_RELATIONSHIP_OPTIONS.find(o => o.value === letter.metadata.senderRecipientRelationship)?.label ?? letter.metadata.senderRecipientRelationship}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Primary Topics */}
                {letter.metadata.primaryTopics && letter.metadata.primaryTopics.length > 0 && (
                  <div className="form-group-readonly">
                    <span className="field-label">Topics</span>
                    <div className="topic-tags-readonly">
                      {letter.metadata.primaryTopics.map((topic) => (
                        <span key={topic} className="topic-tag">{topic.replace("/", " / ")}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notable Quotes */}
                {letter.metadata.notableQuotes && letter.metadata.notableQuotes.length > 0 && (
                  <div className="form-group-readonly">
                    <span className="field-label">Notable Quotes</span>
                    <div className="notable-quotes-readonly">
                      {letter.metadata.notableQuotes.map((quote, idx) => (
                        <blockquote key={idx} className="notable-quote">
                          <p>"{quote.text}"</p>
                          {quote.context && <cite>— {quote.context}</cite>}
                        </blockquote>
                      ))}
                    </div>
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
