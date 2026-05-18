import Icon from "../../../components/common/Icon";

interface DashboardFilterTriggerProps {
  activeFilterCount: number;
  filtersOpen: boolean;
  onToggle: () => void;
}

export default function DashboardFilterTrigger({
  activeFilterCount,
  filtersOpen,
  onToggle,
}: DashboardFilterTriggerProps) {
  return (
    <button
      type="button"
      className={`dashboard-control-btn dashboard-filter-trigger ${activeFilterCount > 0 ? "has-filters" : ""} ${filtersOpen ? "active" : ""}`}
      onClick={onToggle}
      aria-expanded={filtersOpen}
    >
      <Icon name="settings" size={15} />
      <span>Filters</span>
      {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
    </button>
  );
}
