import { VISIBILITY_FILTERS } from "./constants";
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
            <button
              key={filter.value}
              type="button"
              className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
              onClick={() => toggleVisibilityFilter(filter.value)}
              aria-pressed={isActive}
              title={filter.title}
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
