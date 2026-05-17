import { useEffect, useRef, useState } from "react";
import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";

interface PublishCounts {
  lettersPublished: number;
  lettersHidden: number;
  transcriptsPublished: number;
  transcriptsUnpublished: number;
  metadataPublished: number;
  metadataUnpublished: number;
}

interface BulkEditToolbarProps {
  selectedCount: number;
  pageCount: number;
  totalCount: number;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  copyModeActive: boolean;
  copiedValue: string | null;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChangesCount: number;
  isSaving: boolean;
  bulkActionLoading: boolean;
  processingStatus: ProcessingStatus | null;
  pausePending: boolean;
  abortPending: boolean;
  publishCounts: PublishCounts;
  onSelectPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onToggleCopyMode: () => void;
  onOpenTranscription: () => void;
  onOpenMetadataExtraction: () => void;
  onPauseProcessing: () => void;
  onResumeProcessing: () => void;
  onAbortProcessing: () => void;
  onBulkHide: () => void;
  onBulkPublish: () => void;
  onBulkContentVisibility: (field: "transcriptPublished" | "metadataPublished", value: boolean) => void;
  onClearTranscriptions: () => void;
  onClearMetadata: () => void;
  onDelete: () => void;
  onDone: () => void;
  onExit: () => void;
}

export default function BulkEditToolbar({
  selectedCount,
  pageCount,
  totalCount,
  allPageSelected,
  allFilteredSelected,
  copyModeActive,
  copiedValue,
  sourceCell,
  pendingChangesCount,
  isSaving,
  bulkActionLoading,
  processingStatus,
  pausePending,
  abortPending,
  publishCounts,
  onSelectPage,
  onSelectAllFiltered,
  onClearSelection,
  onToggleCopyMode,
  onOpenTranscription,
  onOpenMetadataExtraction,
  onPauseProcessing,
  onResumeProcessing,
  onAbortProcessing,
  onBulkHide,
  onBulkPublish,
  onBulkContentVisibility,
  onClearTranscriptions,
  onClearMetadata,
  onDelete,
  onDone,
  onExit,
}: BulkEditToolbarProps) {
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const publishMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPublishMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (publishMenuRef.current && !publishMenuRef.current.contains(event.target as Node)) {
        setShowPublishMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPublishMenu]);

  return (
    <div className="edit-toolbar visible">
      <div className="edit-toolbar-content">
        <div className="edit-toolbar-left">
          <span className="toolbar-selection-count">
            {selectedCount} selected
          </span>
          <div className="toolbar-select-actions">
            {!allPageSelected ? (
              <button className="toolbar-select-btn" onClick={onSelectPage}>
                Page ({pageCount})
              </button>
            ) : (
              <button className="toolbar-select-btn active" onClick={onSelectPage}>
                Page ✓
              </button>
            )}
            {totalCount > pageCount && (
              !allFilteredSelected ? (
                <button className="toolbar-select-btn" onClick={onSelectAllFiltered}>
                  All {totalCount}
                </button>
              ) : (
                <button className="toolbar-select-btn active" onClick={onClearSelection}>
                  All {totalCount} ✓
                </button>
              )
            )}
          </div>
          <div className="toolbar-divider" />
          <button
            className={`toolbar-copy-btn ${copyModeActive ? "active" : ""}`}
            onClick={onToggleCopyMode}
            disabled={isSaving}
          >
            {copyModeActive ? "✓ Copy Mode" : "Copy Mode"}
          </button>
          {copyModeActive && !sourceCell && (
            <span className="toolbar-hint">Click a cell to copy</span>
          )}
          {copyModeActive && sourceCell && (
            <span className="toolbar-hint">
              Copying: <strong>"{copiedValue || "(empty)"}"</strong>
            </span>
          )}
          {pendingChangesCount > 0 && (
            <span className="toolbar-changes">
              {pendingChangesCount} change{pendingChangesCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="edit-toolbar-center">
          {processingStatus?.isRunning ? (
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
                <button onClick={onResumeProcessing} className="toolbar-process-btn toolbar-process-resume">
                  Resume
                </button>
              ) : (
                <button
                  onClick={onPauseProcessing}
                  className="toolbar-process-btn toolbar-process-pause"
                  disabled={pausePending || abortPending}
                >
                  {pausePending ? "Pausing..." : "Pause"}
                </button>
              )}
              <button
                onClick={onAbortProcessing}
                className="toolbar-process-btn toolbar-process-abort"
                disabled={abortPending}
              >
                {abortPending ? "Aborting..." : "Abort"}
              </button>
            </div>
          ) : (
            <div className="toolbar-process-actions">
              <button className="toolbar-process-btn" onClick={onOpenTranscription}>
                Transcribe{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
              <button className="toolbar-process-btn" onClick={onOpenMetadataExtraction}>
                Extract Metadata{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
            </div>
          )}
        </div>

        <div className="edit-toolbar-right">
          <div className="publish-menu-container" ref={publishMenuRef}>
            <button
              className={`toolbar-process-btn${showPublishMenu ? " active" : ""}`}
              onClick={() => setShowPublishMenu((current) => !current)}
              disabled={selectedCount === 0}
            >
              Publishing
            </button>
            {showPublishMenu && (
              <div className="publish-menu-dropdown">
                <div className="publish-menu-section">
                  <div className="publish-menu-header">
                    <span className="publish-menu-label">Letters</span>
                    <span className="publish-menu-counts">
                      {publishCounts.lettersPublished} published · {publishCounts.lettersHidden} hidden
                    </span>
                  </div>
                  <div className="publish-menu-actions">
                    <button
                      className="publish-menu-btn publish-menu-btn--unpublish"
                      onClick={() => { onBulkHide(); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Hide
                    </button>
                    <button
                      className="publish-menu-btn publish-menu-btn--publish"
                      onClick={() => { onBulkPublish(); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Publish
                    </button>
                  </div>
                </div>
                <div className="publish-menu-divider" />
                <div className="publish-menu-section">
                  <div className="publish-menu-header">
                    <span className="publish-menu-label">Transcripts</span>
                    <span className="publish-menu-counts">
                      {publishCounts.transcriptsPublished} published · {publishCounts.transcriptsUnpublished} hidden
                    </span>
                  </div>
                  <div className="publish-menu-actions">
                    <button
                      className="publish-menu-btn publish-menu-btn--unpublish"
                      onClick={() => { onBulkContentVisibility("transcriptPublished", false); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Hide
                    </button>
                    <button
                      className="publish-menu-btn publish-menu-btn--publish"
                      onClick={() => { onBulkContentVisibility("transcriptPublished", true); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Publish
                    </button>
                  </div>
                </div>
                <div className="publish-menu-divider" />
                <div className="publish-menu-section">
                  <div className="publish-menu-header">
                    <span className="publish-menu-label">Metadata</span>
                    <span className="publish-menu-counts">
                      {publishCounts.metadataPublished} published · {publishCounts.metadataUnpublished} hidden
                    </span>
                  </div>
                  <div className="publish-menu-actions">
                    <button
                      className="publish-menu-btn publish-menu-btn--unpublish"
                      onClick={() => { onBulkContentVisibility("metadataPublished", false); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Hide
                    </button>
                    <button
                      className="publish-menu-btn publish-menu-btn--publish"
                      onClick={() => { onBulkContentVisibility("metadataPublished", true); setShowPublishMenu(false); }}
                      disabled={bulkActionLoading}
                    >
                      Publish
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="toolbar-divider" />
          <div className="toolbar-destructive-actions">
            <button
              className="toolbar-btn-destructive"
              onClick={onClearTranscriptions}
              disabled={selectedCount === 0 || bulkActionLoading}
            >
              Clear Transcripts
            </button>
            <button
              className="toolbar-btn-destructive"
              onClick={onClearMetadata}
              disabled={selectedCount === 0 || bulkActionLoading}
            >
              Clear Metadata
            </button>
            <button
              className="toolbar-btn-danger"
              onClick={onDelete}
              disabled={selectedCount === 0}
            >
              Delete
            </button>
          </div>
          <div className="toolbar-divider" />
          {pendingChangesCount > 0 ? (
            <button className="toolbar-done-btn" onClick={onDone} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save & Close"}
            </button>
          ) : (
            <button className="toolbar-close-btn" onClick={onExit} title="Clear selection">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
