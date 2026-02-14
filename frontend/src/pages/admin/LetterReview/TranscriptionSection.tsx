import type { RefObject, CSSProperties } from "react";
import { Icon } from "../../../components/common";

interface TranscriptionSectionProps {
  letter: {
    transcriptStatus: string;
    transcriptVerifiedAt?: string;
    transcript: { fullText: string };
  };
  letterTranscribeState: "idle" | "transcribing" | "done";
  letterTranscribeMessage: string | null;
  isTranscriptEditing: boolean;
  hasTranscriptChanges: boolean;
  originalTranscriptText: string | null;
  transcriptFontSize: string;
  showEditTooltip: boolean;
  tooltipPosition: { x: number; y: number };
  saving: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  onTranscribeLetter: (force?: boolean) => void;
  onVerifyTranscript: () => void;
  onTranscriptClick: (e: React.MouseEvent) => void;
  onTranscriptDoubleClick: (e: React.MouseEvent) => void;
  onTranscriptInput: (text: string) => void;
  onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export default function TranscriptionSection({
  letter,
  letterTranscribeState,
  letterTranscribeMessage,
  isTranscriptEditing,
  hasTranscriptChanges: _hasTranscriptChanges,
  originalTranscriptText: _originalTranscriptText,
  transcriptFontSize,
  showEditTooltip,
  tooltipPosition,
  saving,
  editorRef,
  onTranscribeLetter,
  onVerifyTranscript,
  onTranscriptClick,
  onTranscriptDoubleClick,
  onTranscriptInput,
  onEditorKeyDown,
}: TranscriptionSectionProps) {
  return (
    <div className="editor-section">
      <div className="editor-header">
        <h2>
          Transcription
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
          {(letter.transcriptStatus !== "VERIFIED" || isTranscriptEditing) && (
            <button
              className="action-btn transcribe-btn"
              onClick={() => onTranscribeLetter()}
              disabled={saving || letterTranscribeState === "transcribing"}
              title="Transcribe letter pages"
            >
              {letterTranscribeState === "transcribing" ? (
                <>
                  <Icon name="process" size={14} className="spinning" />
                  <span>Transcribing...</span>
                </>
              ) : (
                <>
                  <Icon name="process" size={14} />
                  <span>Transcribe</span>
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
        onClick={onTranscriptClick}
        onDoubleClick={onTranscriptDoubleClick}
      >
        <div
          ref={editorRef}
          className={`transcript-editor ${letter.transcriptStatus === "VERIFIED" && !isTranscriptEditing ? "verified" : ""}`}
          contentEditable={letter.transcriptStatus !== "VERIFIED" || isTranscriptEditing}
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
          className="edit-tooltip"
          style={{
            left: Math.min(tooltipPosition.x, window.innerWidth - 280),
            top: tooltipPosition.y + 10,
          }}
        >
          Verified. Double-click to edit and unverify.
        </div>
      )}
    </div>
  );
}
