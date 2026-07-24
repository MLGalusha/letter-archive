import Icon from "../../../components/common/Icon";
import type { DashboardFilterChip } from "./useDashboardActiveFilters";

interface ActiveFilterChipsProps {
  paginationTotal: number;
  activeFilterChips: DashboardFilterChip[];
  onClearAllFilters: () => void;
}

export default function ActiveFilterChips({
  paginationTotal,
  activeFilterChips,
  onClearAllFilters,
}: ActiveFilterChipsProps) {
  const hasActiveFilters = activeFilterChips.length > 0;

  return (
    <div className="active-filter-chips" aria-label="Active filters">
      <span className="dashboard-result-count">{paginationTotal} letters</span>
      {activeFilterChips.map((chip) => (
        <button key={chip.key} type="button" className="active-filter-chip" onClick={chip.onRemove}>
          <span>{chip.label}</span>
          <Icon name="close" size={12} />
        </button>
      ))}
      {hasActiveFilters && (
        <button type="button" className="clear-all-link" onClick={onClearAllFilters}>
          Clear all
        </button>
      )}
    </div>
  );
}
