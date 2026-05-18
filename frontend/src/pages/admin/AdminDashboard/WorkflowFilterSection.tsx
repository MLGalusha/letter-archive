import type { WorkflowState } from "../../../types/Letter";
import { WORKFLOW_FILTERS } from "./constants";
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
      <span className="filter-panel-label">Advanced: Pipeline stage</span>
      <div className="filter-button-grid filter-button-grid--workflow">
        {WORKFLOW_FILTERS.map((filter) => {
          const isActive = workflowFilters.includes(filter.value);
          return (
            <button
              key={filter.value}
              type="button"
              className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
              onClick={() => toggleWorkflowFilter(filter.value)}
              aria-pressed={isActive}
              title={filter.title}
              aria-label={`${filter.label}: ${filter.title}`}
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
