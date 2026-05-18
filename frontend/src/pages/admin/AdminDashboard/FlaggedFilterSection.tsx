import { FLAGGED_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { DashboardFilterStats, FlaggedFilter } from "./types";

interface FlaggedFilterSectionProps {
  stats: DashboardFilterStats;
  flaggedFilter: FlaggedFilter;
  toggleFlaggedFilter: (value: Exclude<FlaggedFilter, "ALL">) => void;
}

export default function FlaggedFilterSection({
  stats,
  flaggedFilter,
  toggleFlaggedFilter,
}: FlaggedFilterSectionProps) {
  return (
    <section className="filter-panel-section">
      <span className="filter-panel-label">Review</span>
      <div className="filter-button-grid filter-button-grid--flagged">
        {FLAGGED_FILTERS.map((filter) => {
          const isActive = flaggedFilter === filter.value;
          const count = filter.value === "FLAGGED"
            ? stats.flagged
            : Math.max(stats.total - stats.flagged, 0);

          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={count}
              label={filter.label}
              active={isActive}
              onClick={() => toggleFlaggedFilter(filter.value)}
              title={filter.title}
            />
          );
        })}
      </div>
    </section>
  );
}
