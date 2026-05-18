import type { WorkflowState } from "../../../types/Letter";
import { WORKFLOW_FILTERS } from "./constants";
import FilterOptionButton from "./FilterOptionButton";
import type { DashboardFilterStats } from "./types";

interface WorkflowFilterSectionProps {
  stats: DashboardFilterStats;
  workflowFilters: WorkflowState[];
  toggleWorkflowFilter: (value: WorkflowState) => void;
}

export default function WorkflowFilterSection({
  stats,
  workflowFilters,
  toggleWorkflowFilter,
}: WorkflowFilterSectionProps) {
  return (
    <section className="filter-panel-section filter-panel-section--advanced">
      <span className="filter-panel-label">Stage</span>
      <div className="filter-button-grid filter-button-grid--workflow">
        {WORKFLOW_FILTERS.map((filter) => {
          const isActive = workflowFilters.includes(filter.value);
          return (
            <FilterOptionButton
              key={filter.value}
              className={filter.className}
              count={stats[filter.countKey]}
              label={filter.label}
              active={isActive}
              onClick={() => toggleWorkflowFilter(filter.value)}
              title={filter.title}
              aria-label={`${filter.label}: ${filter.title}`}
            />
          );
        })}
      </div>
    </section>
  );
}
