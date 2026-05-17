interface BulkCopyControlsProps {
  copyModeActive: boolean;
  copiedValue: string | null;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChangesCount: number;
  isSaving: boolean;
  onToggleCopyMode: () => void;
}

export default function BulkCopyControls({
  copyModeActive,
  copiedValue,
  sourceCell,
  pendingChangesCount,
  isSaving,
  onToggleCopyMode,
}: BulkCopyControlsProps) {
  return (
    <>
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
    </>
  );
}
