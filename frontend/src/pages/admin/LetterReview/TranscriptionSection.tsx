import { memo, useState, useMemo, useEffect, useCallback, type RefObject, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../components/common";
import { countMarkers, highlightTranscriptMarkers, type MarkerType } from "../../../utils/transcriptHighlight";

const MARKER_LABELS: Record<MarkerType, string> = {
  illegible: "illegible",
  unclear: "unclear",
  "crossed out": "crossed out",
  insertion: "insertion",
  margin: "margin",
};

interface TranscriptionSectionProps {
  letter: {
    transcriptStatus: string;
    transcriptVerifiedAt?: string;
    transcript: { fullText: string };
  };
  /** Live transcript text (from React state), may differ from letter.transcript.fullText */
  transcriptText: string;
  letterTranscribeState: "idle" | "transcribing" | "done";
  letterTranscribeMessage: string | null;
  isTranscriptEditing: boolean;
  hasTranscriptChanges: boolean;
  originalTranscriptText: string | null;
  transcriptFontSize: string;
  showEditTooltip: boolean;
  tooltipPosition: { x: number; y: number };
  editTooltipRef: RefObject<HTMLDivElement | null>;
  saving: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  onTranscribeLetter: (force?: boolean) => void;
  onVerifyTranscript: () => void;
  onTranscriptClick: (e: React.MouseEvent) => void;
  onTranscriptDoubleClick: (e: React.MouseEvent) => void;
  onTranscriptInput: (text: string) => void;
  onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onViewModeChange?: (mode: "edit" | "preview") => void;
  readerText: string;
  onReaderTextChange: (text: string) => void;
  /** Hide the reading view toggle (e.g. for non-letter types like telegrams, covers) */
  hideReadingView?: boolean;
  onGenerateReadingView?: () => void;
  readingViewGenerating?: boolean;
}

const hasContent = (text: string) => text.trim().length > 0;

const TranscriptionSection = memo(function TranscriptionSection({
  letter,
  transcriptText,
  letterTranscribeState,
  letterTranscribeMessage,
  isTranscriptEditing,
  transcriptFontSize,
  showEditTooltip,
  tooltipPosition,
  editTooltipRef,
  saving,
  editorRef,
  onTranscribeLetter,
  onVerifyTranscript,
  onTranscriptClick,
  onTranscriptDoubleClick,
  onTranscriptInput,
  onEditorKeyDown,
  onViewModeChange,
  readerText,
  hideReadingView,
  onGenerateReadingView,
  readingViewGenerating,
}: TranscriptionSectionProps) {
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const showReadingView = !hideReadingView && viewMode === "preview" && hasContent(transcriptText);

  const changeViewMode = useCallback((mode: "edit" | "preview") => {
    setViewMode(mode);
    onViewModeChange?.(mode);
  }, [onViewModeChange]);

  // Re-populate editor when switching back from preview to edit.
  useEffect(() => {
    if (viewMode === "edit" && editorRef.current && transcriptText) {
      const current = editorRef.current.innerText;
      if (current !== transcriptText) {
        editorRef.current.innerHTML = highlightTranscriptMarkers(transcriptText);
      }
    }
  }, [viewMode, transcriptText, editorRef]);

  useEffect(() => {
    if (!showReadingView) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        changeViewMode("edit");
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showReadingView, changeViewMode]);

  const markerCounts = useMemo(
    () => countMarkers(transcriptText),
    [transcriptText]
  );
  const totalMarkers = Object.values(markerCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="editor-section">
      <div className="editor-header">
        <h2>
          Transcription
          {totalMarkers > 0 && (
            <span
              className="transcript-markers-badge"
              title={Object.entries(markerCounts)
                .filter(([, n]) => n > 0)
                .map(([type, n]) => `${n} ${MARKER_LABELS[type as MarkerType]}`)
                .join(", ")}
            >
              {totalMarkers} uncertain
            </span>
          )}
          {letterTranscribeState !== "idle" && (
            <span className={`transcribe-status-indicator ${letterTranscribeState}`}>
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
          {!hideReadingView && hasContent(transcriptText) && (
            <div className="view-mode-toggle">
              <button
                type="button"
                className={`view-mode-btn${viewMode === "edit" ? " active" : ""}`}
                onClick={() => changeViewMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={`view-mode-btn${viewMode === "preview" ? " active" : ""}`}
                onClick={() => changeViewMode("preview")}
              >
                Reading view
              </button>
            </div>
          )}

          {(letter.transcriptStatus !== "VERIFIED" || isTranscriptEditing) && (
            <button
              className="action-btn transcribe-btn"
              onClick={() => onTranscribeLetter()}
              disabled={saving || letterTranscribeState === "transcribing"}
              title={hasContent(transcriptText)
                ? "Regenerate transcription from images"
                : "Transcribe letter pages"}
            >
              {letterTranscribeState === "transcribing" ? (
                <>
                  <Icon name="process" size={14} className="spinning" />
                  <span>Transcribing...</span>
                </>
              ) : (
                <>
                  <Icon name="process" size={14} />
                  <span>{hasContent(transcriptText) ? "Regenerate" : "Transcribe"}</span>
                </>
              )}
            </button>
          )}

          {letter.transcriptStatus === "VERIFIED" && !isTranscriptEditing ? (
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
              onClick={onVerifyTranscript}
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
        onClick={saving ? undefined : onTranscriptClick}
        onDoubleClick={saving ? undefined : onTranscriptDoubleClick}
      >
        <div
          ref={editorRef}
          className={`transcript-editor ${letter.transcriptStatus === "VERIFIED" && !isTranscriptEditing ? "verified" : ""}`}
          contentEditable={
            !saving
            && (letter.transcriptStatus !== "VERIFIED" || isTranscriptEditing)
          }
          suppressContentEditableWarning
          data-placeholder=""
          style={{ "--transcript-font-size": transcriptFontSize } as CSSProperties}
          onInput={(e) => {
            onTranscriptInput(e.currentTarget.innerText);
          }}
          onKeyDown={onEditorKeyDown}
        />
      </div>

      {showEditTooltip && (
        <div
          ref={editTooltipRef}
          className="edit-tooltip"
          style={{
            left: Math.min(tooltipPosition.x, window.innerWidth - 280),
            top: tooltipPosition.y + 10,
          }}
        >
          Verified. Double-click to edit and unverify.
        </div>
      )}

      {showReadingView && createPortal(
        <div
          className="reading-view-overlay"
          onMouseDown={() => changeViewMode("edit")}
        >
          <div
            className="reading-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-view-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="reading-view-modal-header">
              <div className="reading-view-modal-copy">
                <h3 id="reading-view-title">Reading view</h3>
                <p className="reading-view-modal-note">
                  This is how the transcript will appear on the public page.
                </p>
              </div>
              <div className="reading-view-modal-actions">
                {onGenerateReadingView && (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={onGenerateReadingView}
                    disabled={saving || readingViewGenerating}
                  >
                    {readingViewGenerating ? (
                      <>
                        <Icon name="process" size={14} className="spinning" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Icon name="process" size={14} />
                        <span>{readerText ? "Regenerate" : "Generate"} Reading View</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="reading-view-close-btn"
                  onClick={() => changeViewMode("edit")}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="reading-view-modal-body">
              <div className="reading-view-modal-article">
                <div className="reading-view-modal-label">Transcript</div>
                <div className="reading-view-modal-column">
                  {readingViewGenerating ? (
                    <div className="reading-view-generating">
                      <Icon name="process" size={20} className="spinning" />
                      <p className="reading-view-generating-text">
                        Generating reading view...
                      </p>
                      <p className="reading-view-generating-sub">
                        AI is identifying paragraph breaks in the transcript.
                      </p>
                    </div>
                  ) : readerText ? (
                    <div className="reading-view-text" style={{ whiteSpace: "pre-wrap" }}>
                      {readerText}
                    </div>
                  ) : (
                    <div className="reading-view-empty">
                      <p>No reading view generated yet.</p>
                      {onGenerateReadingView && (
                        <button
                          type="button"
                          className="action-btn generate-reading-view-cta"
                          onClick={onGenerateReadingView}
                          disabled={saving || readingViewGenerating}
                        >
                          <Icon name="process" size={14} />
                          <span>Generate Reading View</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

TranscriptionSection.displayName = "TranscriptionSection";

export default TranscriptionSection;
