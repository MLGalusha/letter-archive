import type { RefObject } from "react";
import Icon from "../../../components/common/Icon";
import type { ContentStatus } from "../../../types/Letter";
import { DAY_OPTIONS, MONTH_OPTIONS, YEAR_OPTIONS } from "./constants";
import type { ContentFilterView, DateMode, VisibilityFilter } from "./types";

interface DashboardFilterPanelStats {
  published: number;
  hidden: number;
  transcriptEmpty: number;
  transcriptAiDraft: number;
  transcriptEdited: number;
  transcriptVerified: number;
  metadataEmpty: number;
  metadataAiDraft: number;
  metadataEdited: number;
  metadataVerified: number;
}

interface DashboardFilterPanelProps {
  open: boolean;
  stats: DashboardFilterPanelStats;
  collectionInput: string;
  handleCollectionInputChange: (value: string) => void;
  visibilityFilter: VisibilityFilter;
  toggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
  contentFilterView: ContentFilterView;
  setContentFilterView: (value: ContentFilterView) => void;
  transcriptStatusFilters: ContentStatus[];
  toggleTranscriptFilter: (value: ContentStatus) => void;
  metadataStatusFilters: ContentStatus[];
  toggleMetadataFilter: (value: ContentStatus) => void;
  showDateDropdown: boolean;
  setShowDateDropdown: (value: boolean) => void;
  dateDropdownRef: RefObject<HTMLDivElement | null>;
  dateMode: DateMode;
  setDateMode: (value: DateMode) => void;
  hasDateFilter: boolean;
  yearFilter: number | null;
  setYearFilter: (value: number | null) => void;
  monthFilter: number | null;
  setMonthFilter: (value: number | null) => void;
  dayFilter: number | null;
  setDayFilter: (value: number | null) => void;
  dateFromFilter: string | null;
  setDateFromFilter: (value: string | null) => void;
  dateToFilter: string | null;
  setDateToFilter: (value: string | null) => void;
  clearDateFilters: () => void;
  getDateButtonText: () => string;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
}

export default function DashboardFilterPanel({
  open,
  stats,
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
  showDateDropdown,
  setShowDateDropdown,
  dateDropdownRef,
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
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
}: DashboardFilterPanelProps) {
  return (
    <div className={`dashboard-filter-panel ${open ? "open" : ""}`}>
      <div className="filter-panel-section">
        <span className="filter-panel-label">Visibility</span>
        <div className="filter-buttons">
          <button
            className={`filter-pill filter-published ${visibilityFilter === "PUBLISHED" ? "active" : ""}`}
            onClick={() => toggleVisibilityFilter("PUBLISHED")}
            title="Published letters"
          >
            {stats.published} Public
          </button>
          <button
            className={`filter-pill filter-hidden ${visibilityFilter === "HIDDEN" ? "active" : ""}`}
            onClick={() => toggleVisibilityFilter("HIDDEN")}
            title="Hidden letters"
          >
            {stats.hidden} Hidden
          </button>
        </div>
      </div>

      <div className="filter-panel-section content-filter-section">
        <div className="content-filter-toggle">
          <button
            className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
            onClick={() => setContentFilterView("transcript")}
          >
            Transcript
            {contentFilterView !== "transcript" && transcriptStatusFilters.length > 0 && (
              <span className="toggle-badge">{transcriptStatusFilters.length}</span>
            )}
          </button>
          <button
            className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
            onClick={() => setContentFilterView("metadata")}
          >
            Metadata
            {contentFilterView !== "metadata" && metadataStatusFilters.length > 0 && (
              <span className="toggle-badge">{metadataStatusFilters.length}</span>
            )}
          </button>
        </div>
        <div className="filter-buttons">
          {contentFilterView === "transcript" ? (
            <>
              <button className={`filter-pill filter-content-none ${transcriptStatusFilters.includes("EMPTY") ? "active" : ""}`} onClick={() => toggleTranscriptFilter("EMPTY")}>{stats.transcriptEmpty} None</button>
              <button className={`filter-pill filter-content-draft ${transcriptStatusFilters.includes("AI_DRAFT") ? "active" : ""}`} onClick={() => toggleTranscriptFilter("AI_DRAFT")}>{stats.transcriptAiDraft} Draft</button>
              <button className={`filter-pill filter-content-edited ${transcriptStatusFilters.includes("EDITED") ? "active" : ""}`} onClick={() => toggleTranscriptFilter("EDITED")}>{stats.transcriptEdited} Edited</button>
              <button className={`filter-pill filter-content-verified ${transcriptStatusFilters.includes("VERIFIED") ? "active" : ""}`} onClick={() => toggleTranscriptFilter("VERIFIED")}>{stats.transcriptVerified} Done</button>
            </>
          ) : (
            <>
              <button className={`filter-pill filter-content-none ${metadataStatusFilters.includes("EMPTY") ? "active" : ""}`} onClick={() => toggleMetadataFilter("EMPTY")}>{stats.metadataEmpty} None</button>
              <button className={`filter-pill filter-content-draft ${metadataStatusFilters.includes("AI_DRAFT") ? "active" : ""}`} onClick={() => toggleMetadataFilter("AI_DRAFT")}>{stats.metadataAiDraft} Draft</button>
              <button className={`filter-pill filter-content-edited ${metadataStatusFilters.includes("EDITED") ? "active" : ""}`} onClick={() => toggleMetadataFilter("EDITED")}>{stats.metadataEdited} Edited</button>
              <button className={`filter-pill filter-content-verified ${metadataStatusFilters.includes("VERIFIED") ? "active" : ""}`} onClick={() => toggleMetadataFilter("VERIFIED")}>{stats.metadataVerified} Done</button>
            </>
          )}
        </div>
      </div>

      <div className="filter-panel-section filter-panel-fields">
        <div className="dropdown-container" ref={dateDropdownRef}>
          <button
            className={`dropdown-trigger ${hasDateFilter ? "active" : ""}`}
            onClick={() => setShowDateDropdown(!showDateDropdown)}
          >
            {getDateButtonText()} <Icon name="chevron-down" size={12} />
          </button>
          {showDateDropdown && (
            <div className="date-dropdown-panel">
              <div className="date-mode-toggle">
                <button
                  className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
                  onClick={() => {
                    setDateMode("specific");
                    setDateFromFilter(null);
                    setDateToFilter(null);
                  }}
                >
                  Specific
                </button>
                <button
                  className={`mode-btn ${dateMode === "range" ? "active" : ""}`}
                  onClick={() => {
                    setDateMode("range");
                    setYearFilter(null);
                    setMonthFilter(null);
                    setDayFilter(null);
                  }}
                >
                  Range
                </button>
              </div>

              {dateMode === "specific" ? (
                <div className="date-dropdowns">
                  <select value={yearFilter ?? ""} onChange={(event) => setYearFilter(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Year</option>
                    {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                  <select value={monthFilter ?? ""} onChange={(event) => setMonthFilter(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Month</option>
                    {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
                  </select>
                  <select value={dayFilter ?? ""} onChange={(event) => setDayFilter(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">Day</option>
                    {DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </div>
              ) : (
                <div className="date-range-inputs">
                  <div className="date-range-field">
                    <label>From</label>
                    <input type="text" placeholder="mm/dd/yyyy" value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""} onChange={(event) => setDateFromFilter(displayToDateRaw(event.target.value))} maxLength={10} />
                  </div>
                  <div className="date-range-field">
                    <label>To</label>
                    <input type="text" placeholder="mm/dd/yyyy" value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""} onChange={(event) => setDateToFilter(displayToDateRaw(event.target.value))} maxLength={10} />
                  </div>
                </div>
              )}

              {hasDateFilter && <button className="date-clear-btn" onClick={clearDateFilters}>Clear Date</button>}
            </div>
          )}
        </div>
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
      </div>
    </div>
  );
}
