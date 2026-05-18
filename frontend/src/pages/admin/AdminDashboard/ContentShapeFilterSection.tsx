import { CONTENT_SHAPE_FILTERS } from "./constants";
import type { ContentShapeFilter, DashboardFilterStats } from "./types";

interface ContentShapeFilterSectionProps {
  stats: DashboardFilterStats;
  contentShapeFilters: ContentShapeFilter[];
  toggleContentShapeFilter: (value: ContentShapeFilter) => void;
}

export default function ContentShapeFilterSection({
  stats,
  contentShapeFilters,
  toggleContentShapeFilter,
}: ContentShapeFilterSectionProps) {
  return (
    <section className="filter-panel-section">
      <div className="filter-section-heading">
        <h3>Content shape</h3>
      </div>
      <div className="filter-button-grid">
        {CONTENT_SHAPE_FILTERS.map((filter) => {
          const isActive = contentShapeFilters.includes(filter.value);

          return (
            <button
              key={filter.value}
              type="button"
              className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
              onClick={() => toggleContentShapeFilter(filter.value)}
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
