import { MISSING_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { DashboardFilterStats, MissingFilter } from "./types";

interface MissingDataFilterSectionProps {
  stats: DashboardFilterStats;
  missingFilters: MissingFilter[];
  toggleMissingFilter: (value: MissingFilter) => void;
}

export default function MissingDataFilterSection({
  stats,
  missingFilters,
  toggleMissingFilter,
}: MissingDataFilterSectionProps) {
  return (
    <section className="filter-panel-section">
      <div className="filter-section-heading">
        <h3>Cleanup</h3>
      </div>
      <div className="filter-button-grid">
        {MISSING_FILTERS.map((filter) => {
          const isActive = missingFilters.includes(filter.value);

          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={stats[filter.countKey]}
              label={filter.label}
              active={isActive}
              onClick={() => toggleMissingFilter(filter.value)}
            />
          );
        })}
      </div>
    </section>
  );
}
