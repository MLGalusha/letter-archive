interface BulkSelectionControlsProps {
  selectedCount: number;
  pageCount: number;
  totalCount: number;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  onSelectPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}

export default function BulkSelectionControls({
  selectedCount,
  pageCount,
  totalCount,
  allPageSelected,
  allFilteredSelected,
  onSelectPage,
  onSelectAllFiltered,
  onClearSelection,
}: BulkSelectionControlsProps) {
  return (
    <>
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
    </>
  );
}
