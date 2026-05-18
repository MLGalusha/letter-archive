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
import type { DashboardFilterStats } from "./types";
import type { DashboardFilterControls } from "./useDashboardFilters";

interface DashboardFilterPanelProps {
  open: boolean;
  stats: DashboardFilterStats;
  filters: DashboardFilterControls;
  getDateButtonText: () => string;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
  activeFilterCount: number;
  onClose: () => void;
}

export default function DashboardFilterPanel({
  open,
  stats,
  filters,
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
  activeFilterCount,
  onClose,
}: DashboardFilterPanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const {
    collectionInput,
    handleCollectionInputChange,
    collectionFilters,
    addCollectionFilter,
    removeCollectionFilter,
    visibilityFilter,
    toggleVisibilityFilter,
    contentFilterView,
    setContentFilterView,
    transcriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    toggleMetadataFilter,
    extraContentStatusFilters,
    toggleExtraContentFilter,
    workflowFilters,
    toggleWorkflowFilter,
    flaggedFilter,
    toggleFlaggedFilter,
    missingFilters,
    toggleMissingFilter,
    contentShapeFilters,
    toggleContentShapeFilter,
    dateMode,
    setDateMode,
    hasDateFilter,
    yearFilter,
    setYearFilter,
    monthFilter,
    setMonthFilter,
    dayFilter,
    setDayFilter,
    dateFromFilter,
    setDateFromFilter,
    dateToFilter,
    setDateToFilter,
    clearDateFilters,
    handleClearAllFilters,
  } = filters;

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
            <button type="button" className="filter-panel-clear" onClick={handleClearAllFilters}>
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
          toggleVisibilityFilter={toggleVisibilityFilter}
        />

        <ContentStatusFilterSection
          stats={stats}
          contentFilterView={contentFilterView}
          setContentFilterView={setContentFilterView}
          transcriptStatusFilters={transcriptStatusFilters}
          toggleTranscriptFilter={toggleTranscriptFilter}
          metadataStatusFilters={metadataStatusFilters}
          toggleMetadataFilter={toggleMetadataFilter}
          extraContentStatusFilters={extraContentStatusFilters}
          toggleExtraContentFilter={toggleExtraContentFilter}
        />

        <DashboardCollectionFilterControl
          collectionInput={collectionInput}
          collectionFilters={collectionFilters}
          onCollectionInputChange={handleCollectionInputChange}
          onAddCollectionFilter={addCollectionFilter}
          onRemoveCollectionFilter={removeCollectionFilter}
        />

        <DashboardDateFilterControl
          dateMode={dateMode}
          setDateMode={setDateMode}
          hasDateFilter={hasDateFilter}
          yearFilter={yearFilter}
          setYearFilter={setYearFilter}
          monthFilter={monthFilter}
          setMonthFilter={setMonthFilter}
          dayFilter={dayFilter}
          setDayFilter={setDayFilter}
          dateFromFilter={dateFromFilter}
          setDateFromFilter={setDateFromFilter}
          dateToFilter={dateToFilter}
          setDateToFilter={setDateToFilter}
          clearDateFilters={clearDateFilters}
          getDateButtonText={getDateButtonText}
          dateRawToDisplay={dateRawToDisplay}
          displayToDateRaw={displayToDateRaw}
        />

        <ContentShapeFilterSection
          stats={stats}
          contentShapeFilters={contentShapeFilters}
          toggleContentShapeFilter={toggleContentShapeFilter}
        />

        <WorkflowFilterSection
          stats={stats}
          workflowFilters={workflowFilters}
          toggleWorkflowFilter={toggleWorkflowFilter}
        />

        <MissingDataFilterSection
          stats={stats}
          missingFilters={missingFilters}
          toggleMissingFilter={toggleMissingFilter}
        />

        <FlaggedFilterSection
          stats={stats}
          flaggedFilter={flaggedFilter}
          toggleFlaggedFilter={toggleFlaggedFilter}
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
