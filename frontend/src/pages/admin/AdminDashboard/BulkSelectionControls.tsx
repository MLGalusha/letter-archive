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
  const pageButtonLabel = allPageSelected ? "Page ✓" : `Page (${pageCount})`;
  const filteredButtonLabel = allFilteredSelected ? `All ${totalCount} ✓` : `All ${totalCount}`;

  return (
    <>
      <span className="toolbar-selection-count">
        {selectedCount} selected
      </span>
      <div className="toolbar-select-actions">
        <button className={`toolbar-select-btn ${allPageSelected ? "active" : ""}`} onClick={onSelectPage}>
          {pageButtonLabel}
        </button>
        {totalCount > pageCount && (
          <button
            className={`toolbar-select-btn ${allFilteredSelected ? "active" : ""}`}
            onClick={allFilteredSelected ? onClearSelection : onSelectAllFiltered}
          >
            {filteredButtonLabel}
          </button>
        )}
      </div>
    </>
  );
}
