import type { RefObject } from "react";
import type { ContentStatus } from "../../../types/Letter";

type VisibilityFilter = "ALL" | "PUBLISHED" | "HIDDEN";
type DateMode = "specific" | "range";
type ContentFilterView = "transcript" | "metadata";

interface DashboardStats {
  published: number;
  hidden: number;
  transcriptAiDraft: number;
  transcriptEdited: number;
  transcriptVerified: number;
  metadataAiDraft: number;
  metadataEdited: number;
  metadataVerified: number;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
}

interface ProcessingSummary {
  isRunning: boolean;
  completed: number;
  total: number;
}

interface DashboardFilterBarProps {
  visibilityFilter: VisibilityFilter;
  onToggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
  contentFilterView: ContentFilterView;
  onContentFilterViewChange: (view: ContentFilterView) => void;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
  onToggleTranscriptFilter: (value: ContentStatus) => void;
  onToggleMetadataFilter: (value: ContentStatus) => void;
  collectionInput: string;
  onCollectionInputChange: (value: string) => void;
  dateDropdownRef: RefObject<HTMLDivElement | null>;
  showDateDropdown: boolean;
  hasDateFilter: boolean;
  dateButtonText: string;
  onToggleDateDropdown: () => void;
  dateMode: DateMode;
  onDateModeChange: (mode: DateMode) => void;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  onYearFilterChange: (value: number | null) => void;
  onMonthFilterChange: (value: number | null) => void;
  onDayFilterChange: (value: number | null) => void;
  yearOptions: number[];
  monthOptions: Array<{ value: number; label: string }>;
  dayOptions: number[];
  dateFromFilter: string | null;
  dateToFilter: string | null;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
  onDateFromChange: (value: string | null) => void;
  onDateToChange: (value: string | null) => void;
  onClearDateFilters: () => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  activeFilterCount: number;
  onClearAllFilters: () => void;
  processingStatus: ProcessingSummary | null;
  pagination: PaginationState;
  stats: DashboardStats;
}

export default function DashboardFilterBar({
  visibilityFilter,
  onToggleVisibilityFilter,
  contentFilterView,
  onContentFilterViewChange,
  transcriptStatusFilters,
  metadataStatusFilters,
  onToggleTranscriptFilter,
  onToggleMetadataFilter,
  collectionInput,
  onCollectionInputChange,
  dateDropdownRef,
  showDateDropdown,
  hasDateFilter,
  dateButtonText,
  onToggleDateDropdown,
  dateMode,
  onDateModeChange,
  yearFilter,
  monthFilter,
  dayFilter,
  onYearFilterChange,
  onMonthFilterChange,
  onDayFilterChange,
  yearOptions,
  monthOptions,
  dayOptions,
  dateFromFilter,
  dateToFilter,
  dateRawToDisplay,
  displayToDateRaw,
  onDateFromChange,
  onDateToChange,
  onClearDateFilters,
  searchInput,
  onSearchInputChange,
  activeFilterCount,
  onClearAllFilters,
  processingStatus,
  pagination,
  stats,
}: DashboardFilterBarProps) {
  return (
    <div className="dashboard-filter-bar">
      <div className="filter-pills">
        <div className="filter-group-inline">
          <span className="filter-section-label">Visibility</span>
          <div className="filter-buttons">
            <button
              className={`filter-pill filter-published ${visibilityFilter === "PUBLISHED" ? "active" : ""}`}
              onClick={() => onToggleVisibilityFilter("PUBLISHED")}
              title="Published letters"
            >
              {stats.published} Pub
            </button>
            <button
              className={`filter-pill filter-hidden ${visibilityFilter === "HIDDEN" ? "active" : ""}`}
              onClick={() => onToggleVisibilityFilter("HIDDEN")}
              title="Hidden letters"
            >
              {stats.hidden} Hidden
            </button>
          </div>
        </div>

        <div className="filter-group-inline">
          <div className="content-filter-toggle">
            <button
              className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
              onClick={() => onContentFilterViewChange("transcript")}
            >
              Transcript
              {contentFilterView !== "transcript" &&
                transcriptStatusFilters.length > 0 && (
                  <span className="toggle-badge">
                    {transcriptStatusFilters.length}
                  </span>
                )}
            </button>
            <button
              className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
              onClick={() => onContentFilterViewChange("metadata")}
            >
              Metadata
              {contentFilterView !== "metadata" &&
                metadataStatusFilters.length > 0 && (
                  <span className="toggle-badge">
                    {metadataStatusFilters.length}
                  </span>
                )}
            </button>
          </div>

          <div className="filter-buttons">
            {contentFilterView === "transcript" ? (
              <>
                <button
                  className={`filter-pill filter-content-draft ${transcriptStatusFilters.includes("AI_DRAFT") ? "active" : ""}`}
                  onClick={() => onToggleTranscriptFilter("AI_DRAFT")}
                  title="AI Draft transcripts"
                >
                  {stats.transcriptAiDraft} Draft
                </button>
                <button
                  className={`filter-pill filter-content-edited ${transcriptStatusFilters.includes("EDITED") ? "active" : ""}`}
                  onClick={() => onToggleTranscriptFilter("EDITED")}
                  title="Edited transcripts"
                >
                  {stats.transcriptEdited} Edit
                </button>
                <button
                  className={`filter-pill filter-content-verified ${transcriptStatusFilters.includes("VERIFIED") ? "active" : ""}`}
                  onClick={() => onToggleTranscriptFilter("VERIFIED")}
                  title="Verified transcripts"
                >
                  {stats.transcriptVerified} Done
                </button>
              </>
            ) : (
              <>
                <button
                  className={`filter-pill filter-content-draft ${metadataStatusFilters.includes("AI_DRAFT") ? "active" : ""}`}
                  onClick={() => onToggleMetadataFilter("AI_DRAFT")}
                  title="AI Draft metadata"
                >
                  {stats.metadataAiDraft} Draft
                </button>
                <button
                  className={`filter-pill filter-content-edited ${metadataStatusFilters.includes("EDITED") ? "active" : ""}`}
                  onClick={() => onToggleMetadataFilter("EDITED")}
                  title="Edited metadata"
                >
                  {stats.metadataEdited} Edit
                </button>
                <button
                  className={`filter-pill filter-content-verified ${metadataStatusFilters.includes("VERIFIED") ? "active" : ""}`}
                  onClick={() => onToggleMetadataFilter("VERIFIED")}
                  title="Verified metadata"
                >
                  {stats.metadataVerified} Done
                </button>
              </>
            )}
          </div>
        </div>

        <input
          type="text"
          className="collection-input"
          placeholder="000"
          title="Filter by collection number"
          value={collectionInput}
          onChange={(e) => onCollectionInputChange(e.target.value)}
          maxLength={3}
        />

        <div className="dropdown-container" ref={dateDropdownRef}>
          <button
            className={`dropdown-trigger ${hasDateFilter ? "active" : ""}`}
            onClick={onToggleDateDropdown}
          >
            {dateButtonText} ▾
          </button>
          {showDateDropdown && (
            <div className="date-dropdown-panel">
              <div className="date-mode-toggle">
                <button
                  className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
                  onClick={() => onDateModeChange("specific")}
                >
                  Specific
                </button>
                <button
                  className={`mode-btn ${dateMode === "range" ? "active" : ""}`}
                  onClick={() => onDateModeChange("range")}
                >
                  Range
                </button>
              </div>

              {dateMode === "specific" ? (
                <div className="date-dropdowns">
                  <select
                    value={yearFilter ?? ""}
                    onChange={(e) =>
                      onYearFilterChange(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">Year</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <select
                    value={monthFilter ?? ""}
                    onChange={(e) =>
                      onMonthFilterChange(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">Month</option>
                    {monthOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dayFilter ?? ""}
                    onChange={(e) =>
                      onDayFilterChange(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Day</option>
                    {dayOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="date-range-inputs">
                  <div className="date-range-field">
                    <label>From</label>
                    <input
                      type="text"
                      placeholder="mm/dd/yyyy"
                      value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""}
                      onChange={(e) => onDateFromChange(displayToDateRaw(e.target.value))}
                      maxLength={10}
                    />
                  </div>
                  <div className="date-range-field">
                    <label>To</label>
                    <input
                      type="text"
                      placeholder="mm/dd/yyyy"
                      value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""}
                      onChange={(e) => onDateToChange(displayToDateRaw(e.target.value))}
                      maxLength={10}
                    />
                  </div>
                </div>
              )}

              {hasDateFilter && (
                <button className="date-clear-btn" onClick={onClearDateFilters}>
                  Clear Date
                </button>
              )}
            </div>
          )}
        </div>

        <div className="filter-group search-group">
          <input
            type="text"
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
          />
        </div>

        {activeFilterCount > 0 && (
          <button className="clear-all-btn" onClick={onClearAllFilters}>
            Clear All
          </button>
        )}

        {processingStatus?.isRunning && (
          <span className="stat-processing">
            Processing: {processingStatus.completed}/{processingStatus.total}
          </span>
        )}
      </div>

      <span className="letter-count">
        {(pagination.page - 1) * pagination.limit + 1}–
        {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
      </span>
    </div>
  );
}
