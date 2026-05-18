import type { ProcessingStatus } from "../../../api/admin";

interface BulkProcessingControlsProps {
  selectedCount: number;
  processingStatus: ProcessingStatus | null;
  pausePending: boolean;
  abortPending: boolean;
  onOpenTranscription: () => void;
  onOpenMetadataExtraction: () => void;
  onPauseProcessing: () => void;
  onResumeProcessing: () => void;
  onAbortProcessing: () => void;
}

export default function BulkProcessingControls({
  selectedCount,
  processingStatus,
  pausePending,
  abortPending,
  onOpenTranscription,
  onOpenMetadataExtraction,
  onPauseProcessing,
  onResumeProcessing,
  onAbortProcessing,
}: BulkProcessingControlsProps) {
  if (!processingStatus?.isRunning) {
    return (
      <div className="toolbar-process-actions">
        <button type="button" className="toolbar-process-btn" onClick={onOpenTranscription}>
          Transcribe{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
        <button type="button" className="toolbar-process-btn" onClick={onOpenMetadataExtraction}>
          Extract Metadata{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
      </div>
    );
  }

  return (
    <div className="toolbar-processing-controls">
      <div className="toolbar-progress">
        <span className="toolbar-progress-text">
          {processingStatus.currentJob?.type === "transcription" ? "Transcribing" : "Extracting"}:{" "}
          {processingStatus.completed}/{processingStatus.total}
          {processingStatus.failed > 0 && (
            <span className="failed-count"> ({processingStatus.failed} failed)</span>
          )}
        </span>
        <div className="toolbar-progress-bar">
          <div
            className="toolbar-progress-fill"
            style={{
              width: `${processingStatus.total > 0 ? (processingStatus.completed / processingStatus.total) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      {processingStatus.isPaused ? (
        <button type="button" onClick={onResumeProcessing} className="toolbar-process-btn toolbar-process-resume">
          Resume
        </button>
      ) : (
        <button
          type="button"
          onClick={onPauseProcessing}
          className="toolbar-process-btn toolbar-process-pause"
          disabled={pausePending || abortPending}
        >
          {pausePending ? "Pausing..." : "Pause"}
        </button>
      )}
      <button
        type="button"
        onClick={onAbortProcessing}
        className="toolbar-process-btn toolbar-process-abort"
        disabled={abortPending}
      >
        {abortPending ? "Aborting..." : "Abort"}
      </button>
    </div>
  );
}
