import Icon from "../../../components/common/Icon";

interface MobileFilterTriggerProps {
  activeFilterCount: number;
  mobileFiltersOpen: boolean;
  onToggle: () => void;
}

export default function MobileFilterTrigger({
  activeFilterCount,
  mobileFiltersOpen,
  onToggle,
}: MobileFilterTriggerProps) {
  return (
    <button
      type="button"
      className={`dashboard-control-btn mobile-filter-trigger ${activeFilterCount > 0 ? "has-filters" : ""}`}
      onClick={onToggle}
      aria-expanded={mobileFiltersOpen}
    >
      <Icon name="settings" size={15} />
      <span>Filters</span>
      {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
    </button>
  );
}
