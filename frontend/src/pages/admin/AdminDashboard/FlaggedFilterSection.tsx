import { FLAGGED_FILTERS } from "./constants";
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
            <button
              key={filter.value}
              type="button"
              className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
              onClick={() => toggleFlaggedFilter(filter.value)}
              aria-pressed={isActive}
              title={filter.title}
            >
              <span className="filter-pill-count">{count}</span>
              <span>{filter.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
