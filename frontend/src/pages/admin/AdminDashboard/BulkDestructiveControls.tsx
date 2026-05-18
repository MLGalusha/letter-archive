interface BulkDestructiveControlsProps {
  selectedCount: number;
  bulkActionLoading: boolean;
  onClearTranscriptions: () => void;
  onClearMetadata: () => void;
  onDelete: () => void;
}

export default function BulkDestructiveControls({
  selectedCount,
  bulkActionLoading,
  onClearTranscriptions,
  onClearMetadata,
  onDelete,
}: BulkDestructiveControlsProps) {
  return (
    <div className="toolbar-destructive-actions">
      <button
        type="button"
        className="toolbar-btn-destructive"
        onClick={onClearTranscriptions}
        disabled={selectedCount === 0 || bulkActionLoading}
      >
        Clear Transcripts
      </button>
      <button
        type="button"
        className="toolbar-btn-destructive"
        onClick={onClearMetadata}
        disabled={selectedCount === 0 || bulkActionLoading}
      >
        Clear Metadata
      </button>
      <button
        type="button"
        className="toolbar-btn-danger"
        onClick={onDelete}
        disabled={selectedCount === 0}
      >
        Delete
      </button>
    </div>
  );
}
