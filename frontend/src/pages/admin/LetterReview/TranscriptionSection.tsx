import { useState, useMemo, useCallback, useEffect, type RefObject, type CSSProperties } from "react";
import { Icon } from "../../../components/common";
import { FORCE_CONTINUATION } from "../../../utils/reflowClassifier";
import { countMarkers, highlightTranscriptMarkers, type MarkerType } from "../../../utils/transcriptHighlight";
import { reflowTranscript, renderTranscriptLines, computeReferenceWidth } from "../../../utils/transcriptRendering";
import ReflowGutter from "./ReflowGutter";

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
}

const hasContent = (text: string) => text.trim().length > 0;

export default function TranscriptionSection({
  letter,
  transcriptText,
  letterTranscribeState,
  letterTranscribeMessage,
  isTranscriptEditing,
  hasTranscriptChanges: _hasTranscriptChanges,
  originalTranscriptText: _originalTranscriptText,
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
}: TranscriptionSectionProps) {
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

  // Re-populate editor when switching back from preview to edit.
  // The editor div is unmounted during preview mode, so it remounts empty.
  // The parent's sync useEffect depends on [transcript, reviewMode] which
  // don't change on a viewMode toggle, so we handle it here.
  useEffect(() => {
    if (viewMode === "edit" && editorRef.current && transcriptText) {
      const current = editorRef.current.innerText;
      if (current !== transcriptText) {
        editorRef.current.innerHTML = highlightTranscriptMarkers(transcriptText);
      }
    }
  }, [viewMode, transcriptText, editorRef]);

  // Pending combine: when a combine click is blocked by blank lines,
  // we highlight those blanks as red so the admin can click to remove them.
  const [pendingCombine, setPendingCombine] = useState<{
    targetLine: number;
    blankIndices: number[];
  } | null>(null);

  // Clear pending state when transcript changes from typing or other edits
  useEffect(() => {
    setPendingCombine(null);
  }, [transcriptText]);

  // Cancel pending on any click outside the red blank indicators.
  // Red blank clicks use stopPropagation, so they never reach the document.
  useEffect(() => {
    if (!pendingCombine) return;
    const cancel = () => setPendingCombine(null);
    document.addEventListener("click", cancel);
    return () => document.removeEventListener("click", cancel);
  }, [pendingCombine]);

  const pendingDeleteBlanks = useMemo(() => {
    if (!pendingCombine) return undefined;
    return new Set(pendingCombine.blankIndices);
  }, [pendingCombine]);

  const markerCounts = useMemo(
    () => countMarkers(transcriptText),
    [transcriptText]
  );
  const totalMarkers = Object.values(markerCounts).reduce((a, b) => a + b, 0);

  // Reading view preview — strip page separators before reflowing
  const previewContent = useMemo(() => {
    if (viewMode !== "preview") return null;
    const raw = transcriptText;
    if (!raw.trim()) return null;
    // Strip --- Page N --- lines so they don't appear in reading view
    const text = raw.replace(/^---\s*Page\s+\d+\s*---$/gm, "").replace(/\n{3,}/g, "\n\n");
    const refWidth = computeReferenceWidth(text);
    const reflowed = reflowTranscript(text);
    const isShortLine = refWidth < 40;
    return { elements: renderTranscriptLines(reflowed, refWidth), isShortLine };
  }, [viewMode, transcriptText]);

  // Gutter line toggle handler
  const handleToggleLine = useCallback(
    (lineIndex: number, action: "combine" | "separate") => {
      // Any gutter click clears previous pending state
      setPendingCombine(null);

      const lines = transcriptText.split("\n");
      if (lineIndex < 0 || lineIndex >= lines.length) return;

      if (action === "combine") {
        // Check for blank lines between target and the content above
        const blankIndices: number[] = [];
        let idx = lineIndex - 1;
        while (idx >= 0 && lines[idx].trim() === "") {
          blankIndices.push(idx);
          idx--;
        }

        if (blankIndices.length > 0) {
          // Blank lines are in the way — highlight them red, wait for confirmation
          setPendingCombine({ targetLine: lineIndex, blankIndices });
          return;
        }

        // No blanks — combine directly
        if (lineIndex <= 0) return;
        const stripped = lines[lineIndex].replace(/^[\u200B ]/, "");
        lines[lineIndex] = FORCE_CONTINUATION + stripped;
      } else {
        // Separate: force section-start with leading space
        const stripped = lines[lineIndex].replace(/^[\u200B ]/, "");
        lines[lineIndex] = " " + stripped;
      }

      onTranscriptInput(lines.join("\n"));
    },
    [transcriptText, onTranscriptInput],
  );

  // Confirm blank deletion: remove all pending blank lines and complete the combine
  const handleConfirmBlankDelete = useCallback(() => {
    if (!pendingCombine) return;

    const lines = transcriptText.split("\n");
    const { targetLine, blankIndices } = pendingCombine;

    // Remove blanks in reverse order to preserve indices
    const sorted = [...blankIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      lines.splice(idx, 1);
    }

    // Adjust target index: it shifted down by blanks removed above it
    const blanksAbove = blankIndices.filter(b => b < targetLine).length;
    const newIdx = targetLine - blanksAbove;

    // Apply force-continuation marker
    if (newIdx > 0 && newIdx < lines.length) {
      const stripped = lines[newIdx].replace(/^[\u200B ]/, "");
      lines[newIdx] = FORCE_CONTINUATION + stripped;
    }

    setPendingCombine(null);
    onTranscriptInput(lines.join("\n"));
  }, [pendingCombine, transcriptText, onTranscriptInput]);

  const showGutter = viewMode === "edit" && hasContent(transcriptText);

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
          {hasContent(transcriptText) && (
            <div className="view-mode-toggle">
              <button
                type="button"
                className={`view-mode-btn${viewMode === "edit" ? " active" : ""}`}
                onClick={() => setViewMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                className={`view-mode-btn${viewMode === "preview" ? " active" : ""}`}
                onClick={() => setViewMode("preview")}
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

      {viewMode === "preview" && previewContent ? (
        /* ── Reading view preview — matches public site ── */
        <div className="editor-container">
          <div className={`transcript-preview${previewContent.isShortLine ? " transcript-short-lines" : ""}`}>
            {previewContent.elements}
          </div>
        </div>
      ) : (
        /* ── Edit mode ── */
        <div
          className={`editor-container${showGutter ? " with-gutter" : ""}`}
          onClick={onTranscriptClick}
          onDoubleClick={onTranscriptDoubleClick}
        >
          {showGutter && (
            <ReflowGutter
              transcript={transcriptText}
              editorRef={editorRef}
              onToggleLine={handleToggleLine}
              pendingDeleteBlanks={pendingDeleteBlanks}
              onConfirmBlankDelete={handleConfirmBlankDelete}
            />
          )}
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
      )}

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
    </div>
  );
}
