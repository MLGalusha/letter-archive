import Icon from "../../../components/common/Icon";
import ContentStatusFilterSection from "./ContentStatusFilterSection";
import DashboardDateFilterControl from "./DashboardDateFilterControl";
import FlaggedFilterSection from "./FlaggedFilterSection";
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

      <WorkflowFilterSection
        stats={stats}
        workflowFilters={workflowFilters}
        toggleWorkflowFilter={toggleWorkflowFilter}
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
    </div>
  );
}
