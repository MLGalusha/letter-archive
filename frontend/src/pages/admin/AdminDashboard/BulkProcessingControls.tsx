interface BulkProcessingControlsProps {
  selectedCount: number;
  onOpenTranscription: () => void;
  onOpenMetadataExtraction: () => void;
}

export default function BulkProcessingControls({
  selectedCount,
  onOpenTranscription,
  onOpenMetadataExtraction,
}: BulkProcessingControlsProps) {
  return (
    <div className="toolbar-process-actions">
      <button
        type="button"
        className="toolbar-process-btn"
        disabled={selectedCount === 0}
        onClick={onOpenTranscription}
      >
        Transcribe{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>
      <button
        type="button"
        className="toolbar-process-btn"
        disabled={selectedCount === 0}
        onClick={onOpenMetadataExtraction}
      >
        Extract Metadata{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>
    </div>
  );
}
