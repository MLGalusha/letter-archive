import type { ReactNode } from "react";
import Icon from "../../../components/common/Icon";
import ContentShapeFilterSection from "./ContentShapeFilterSection";
import ContentStatusFilterSection from "./ContentStatusFilterSection";
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
  const {
    collectionInput,
    handleCollectionInputChange,
    collectionFilter,
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

  const worklistActiveCount =
    (visibilityFilter !== "ALL" ? 1 : 0)
    + (flaggedFilter !== "ALL" ? 1 : 0)
    + missingFilters.length;
  const contentActiveCount =
    contentShapeFilters.length
    + transcriptStatusFilters.length
    + metadataStatusFilters.length
    + extraContentStatusFilters.length;
  const refineActiveCount =
    (hasDateFilter ? 1 : 0)
    + (collectionFilter !== "all" ? 1 : 0);
  const advancedActiveCount = workflowFilters.length;

  return (
    <div className={`dashboard-filter-panel ${open ? "open" : ""}`}>
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

      <div className="filter-panel-body">
        <FilterPanelGroup
          id="worklist"
          title="Worklist"
          activeCount={worklistActiveCount}
        >
          <VisibilityFilterSection
            stats={stats}
            visibilityFilter={visibilityFilter}
            toggleVisibilityFilter={toggleVisibilityFilter}
          />

          <FlaggedFilterSection
            stats={stats}
            flaggedFilter={flaggedFilter}
            toggleFlaggedFilter={toggleFlaggedFilter}
          />

          <MissingDataFilterSection
            stats={stats}
            missingFilters={missingFilters}
            toggleMissingFilter={toggleMissingFilter}
          />
        </FilterPanelGroup>

        <FilterPanelGroup
          id="content"
          title="Content"
          activeCount={contentActiveCount}
          wide
        >
          <ContentShapeFilterSection
            stats={stats}
            contentShapeFilters={contentShapeFilters}
            toggleContentShapeFilter={toggleContentShapeFilter}
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
        </FilterPanelGroup>

        <FilterPanelGroup
          id="scope"
          title="Scope"
          activeCount={refineActiveCount}
        >
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

          <section className="filter-panel-section filter-panel-fields">
            <label className="collection-filter-field">
              <span>Collection</span>
              <input
                type="text"
                className="collection-input"
                placeholder="000"
                value={collectionInput}
                onChange={(event) => handleCollectionInputChange(event.target.value)}
                maxLength={3}
              />
            </label>
          </section>
        </FilterPanelGroup>

        <FilterPanelGroup
          id="pipeline"
          title="Pipeline"
          activeCount={advancedActiveCount}
          wide
        >
          <WorkflowFilterSection
            stats={stats}
            workflowFilters={workflowFilters}
            toggleWorkflowFilter={toggleWorkflowFilter}
          />
        </FilterPanelGroup>
      </div>

      <div className="filter-panel-footer">
        <button type="button" className="filter-panel-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

interface FilterPanelGroupProps {
  id: string;
  title: string;
  activeCount: number;
  wide?: boolean;
  children: ReactNode;
}

function FilterPanelGroup({
  id,
  title,
  activeCount,
  wide = false,
  children,
}: FilterPanelGroupProps) {
  const headingId = `filter-panel-group-${id}`;

  return (
    <section
      className={`filter-panel-group filter-panel-group--${id} ${wide ? "filter-panel-group--wide" : ""}`}
      aria-labelledby={headingId}
    >
      <div className="filter-panel-group-header">
        <div>
          <h3 id={headingId}>{title}</h3>
        </div>
        {activeCount > 0 && (
          <span className="filter-panel-group-count">{activeCount}</span>
        )}
      </div>
      <div className="filter-panel-group-content">{children}</div>
    </section>
  );
}
