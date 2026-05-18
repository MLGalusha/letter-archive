import { MISSING_FILTERS } from "./constants";
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
            <button
              key={filter.value}
              type="button"
              className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
              onClick={() => toggleMissingFilter(filter.value)}
              aria-pressed={isActive}
            >
              <span className="filter-pill-count">{stats[filter.countKey]}</span>
              <span>{filter.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
