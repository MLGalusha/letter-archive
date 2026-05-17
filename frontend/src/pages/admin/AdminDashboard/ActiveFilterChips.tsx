import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";
import type { DashboardFilterChip } from "./useDashboardActiveFilters";

interface ActiveFilterChipsProps {
  paginationTotal: number;
  activeFilterCount: number;
  activeFilterChips: DashboardFilterChip[];
  processingStatus: ProcessingStatus | null;
  selectedCount: number;
  onClearAllFilters: () => void;
}

export default function ActiveFilterChips({
  paginationTotal,
  activeFilterCount,
  activeFilterChips,
  processingStatus,
  selectedCount,
  onClearAllFilters,
}: ActiveFilterChipsProps) {
  return (
    <div className="active-filter-chips" aria-label="Active filters">
      <span className="dashboard-result-count">{paginationTotal} letters</span>
      {activeFilterChips.map((chip) => (
        <button key={chip.key} className="active-filter-chip" onClick={chip.onRemove}>
          <span>{chip.label}</span>
          <Icon name="close" size={12} />
        </button>
      ))}
      {activeFilterCount > 0 && (
        <button className="clear-all-link" onClick={onClearAllFilters}>
          Clear all
        </button>
      )}
      {processingStatus?.isRunning && selectedCount === 0 && (
        <span className="stat-pill stat-processing">
          {processingStatus.currentJob?.type === "transcription" ? "T" : "M"}:{" "}
          {processingStatus.completed}/{processingStatus.total}
        </span>
      )}
    </div>
  );
}
