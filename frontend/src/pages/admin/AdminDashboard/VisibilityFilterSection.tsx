import { VISIBILITY_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { DashboardFilterStats, VisibilityFilter } from "./types";

interface VisibilityFilterSectionProps {
  stats: DashboardFilterStats;
  visibilityFilter: VisibilityFilter;
  toggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
}

export default function VisibilityFilterSection({
  stats,
  visibilityFilter,
  toggleVisibilityFilter,
}: VisibilityFilterSectionProps) {
  return (
    <section className="filter-panel-section">
      <span className="filter-panel-label">Visibility</span>
      <div className="filter-button-grid filter-button-grid--visibility">
        {VISIBILITY_FILTERS.map((filter) => {
          const isActive = visibilityFilter === filter.value;
          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={stats[filter.countKey]}
              label={filter.label}
              active={isActive}
              onClick={() => toggleVisibilityFilter(filter.value)}
              title={filter.title}
            />
          );
        })}
      </div>
    </section>
  );
}
