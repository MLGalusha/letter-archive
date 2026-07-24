import { useEffect, useRef } from "react";
import Icon from "../../../components/common/Icon";
import ContentShapeFilterSection from "./ContentShapeFilterSection";
import ContentStatusFilterSection from "./ContentStatusFilterSection";
import DashboardCollectionFilterControl from "./DashboardCollectionFilterControl";
import DashboardDateFilterControl from "./DashboardDateFilterControl";
import FlaggedFilterSection from "./FlaggedFilterSection";
import MissingDataFilterSection from "./MissingDataFilterSection";
import VisibilityFilterSection from "./VisibilityFilterSection";
import WorkflowFilterSection from "./WorkflowFilterSection";
import {
  getDashboardCollectionFilters,
  getDashboardDateFilterValue,
  type DashboardFilterState,
} from "./dashboardFilterStateModel";
import type { DashboardFilterStats } from "./types";
import type {
  DashboardFilterActions,
  DashboardFilterDrafts,
} from "./useDashboardFilters";

interface DashboardFilterPanelProps {
  open: boolean;
  stats: DashboardFilterStats;
  filterState: DashboardFilterState;
  filterDrafts: DashboardFilterDrafts;
  filterActions: DashboardFilterActions;
  dateButtonText: string;
  activeFilterCount: number;
  onClose: () => void;
}

export default function DashboardFilterPanel({
  open,
  stats,
  filterState,
  filterDrafts,
  filterActions,
  dateButtonText,
  activeFilterCount,
  onClose,
}: DashboardFilterPanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const {
    visibilityFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    missingFilters,
    contentShapeFilters,
  } = filterState.query;
  const collectionFilters = getDashboardCollectionFilters(filterState);

  useEffect(() => {
    if (open) {
      const body = bodyRef.current;
      if (body) {
        body.scrollTop = 0;
      }
    }
  }, [open]);

  return (
    <div className={`dashboard-filter-panel ${open ? "open" : ""}`} hidden={!open}>
      <div className="filter-panel-header">
        <div>
          <h2>Filters</h2>
          <span>{activeFilterCount > 0 ? `${activeFilterCount} active` : "No active filters"}</span>
        </div>
        <div className="filter-panel-header-actions">
          {activeFilterCount > 0 && (
            <button type="button" className="filter-panel-clear" onClick={filterActions.clearAllFilters}>
              Clear
            </button>
          )}
          <button type="button" className="filter-panel-close" onClick={onClose} aria-label="Close filters">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="filter-panel-body" ref={bodyRef}>
        <VisibilityFilterSection
          stats={stats}
          visibilityFilter={visibilityFilter}
          toggleVisibilityFilter={filterActions.toggleVisibilityFilter}
        />

        <ContentStatusFilterSection
          stats={stats}
          contentFilterView={filterDrafts.contentFilterView}
          onContentFilterViewChange={filterActions.changeContentFilterView}
          transcriptStatusFilters={transcriptStatusFilters}
          toggleTranscriptFilter={filterActions.toggleTranscriptFilter}
          metadataStatusFilters={metadataStatusFilters}
          toggleMetadataFilter={filterActions.toggleMetadataFilter}
          extraContentStatusFilters={extraContentStatusFilters}
          toggleExtraContentFilter={filterActions.toggleExtraContentFilter}
        />

        <DashboardCollectionFilterControl
          collectionInput={filterDrafts.collectionInput}
          collectionFilters={collectionFilters}
          onCollectionInputChange={filterActions.changeCollectionInput}
          onAddCollectionFilter={filterActions.addCollectionFilter}
          onRemoveCollectionFilter={filterActions.removeCollectionFilter}
          onClearCollectionFilters={filterActions.clearCollectionFilters}
        />

        <DashboardDateFilterControl
          value={getDashboardDateFilterValue(filterState)}
          summary={dateButtonText}
          onModeChange={filterActions.changeDateMode}
          onYearChange={filterActions.changeYear}
          onMonthChange={filterActions.changeMonth}
          onDayChange={filterActions.changeDay}
          onDateFromChange={filterActions.changeDateFrom}
          onDateToChange={filterActions.changeDateTo}
          onClear={filterActions.clearDateFilters}
        />

        <ContentShapeFilterSection
          stats={stats}
          contentShapeFilters={contentShapeFilters}
          toggleContentShapeFilter={filterActions.toggleContentShapeFilter}
        />

        <WorkflowFilterSection
          stats={stats}
          workflowFilters={workflowFilters}
          toggleWorkflowFilter={filterActions.toggleWorkflowFilter}
        />

        <MissingDataFilterSection
          stats={stats}
          missingFilters={missingFilters}
          toggleMissingFilter={filterActions.toggleMissingFilter}
        />

        <FlaggedFilterSection
          stats={stats}
          flaggedFilter={flaggedFilter}
          toggleFlaggedFilter={filterActions.toggleFlaggedFilter}
        />
      </div>

      <div className="filter-panel-footer">
        <button type="button" className="filter-panel-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
