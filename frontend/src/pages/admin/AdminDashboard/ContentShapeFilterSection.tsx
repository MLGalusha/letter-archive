import { CONTENT_SHAPE_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { ContentShapeFilter, DashboardFilterStats } from "./types";

interface ContentShapeFilterSectionProps {
  stats: DashboardFilterStats;
  contentShapeFilters: readonly ContentShapeFilter[];
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
        <h3>Contains</h3>
      </div>
      <div className="filter-button-grid filter-button-grid--shape">
        {CONTENT_SHAPE_FILTERS.map((filter) => {
          const isActive = contentShapeFilters.includes(filter.value);

          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={stats[filter.countKey]}
              label={filter.label}
              active={isActive}
              onClick={() => toggleContentShapeFilter(filter.value)}
            />
          );
        })}
      </div>
    </section>
  );
}
