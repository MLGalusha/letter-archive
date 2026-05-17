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
  clearAllFilters: () => void;
  getDateButtonText: () => string;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
  activeFilterCount: number;
  onClose: () => void;
}

const VISIBILITY_FILTERS = [
  {
    value: "PUBLISHED",
    label: "Public",
    countKey: "published",
    className: "filter-published",
    title: "Published letters",
  },
  {
    value: "HIDDEN",
    label: "Hidden",
    countKey: "hidden",
    className: "filter-hidden",
    title: "Hidden letters",
  },
] as const;

const CONTENT_STATUS_FILTERS = [
  {
    value: "EMPTY",
    label: "None",
    countKeys: {
      transcript: "transcriptEmpty",
      metadata: "metadataEmpty",
    },
    className: "filter-content-none",
  },
  {
    value: "AI_DRAFT",
    label: "Draft",
    countKeys: {
      transcript: "transcriptAiDraft",
      metadata: "metadataAiDraft",
    },
    className: "filter-content-draft",
  },
  {
    value: "EDITED",
    label: "Edited",
    countKeys: {
      transcript: "transcriptEdited",
      metadata: "metadataEdited",
    },
    className: "filter-content-edited",
  },
  {
    value: "VERIFIED",
    label: "Done",
    countKeys: {
      transcript: "transcriptVerified",
      metadata: "metadataVerified",
    },
    className: "filter-content-verified",
  },
] as const;

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
  clearAllFilters,
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
  activeFilterCount,
  onClose,
}: DashboardFilterPanelProps) {
  return (
    <div className={`dashboard-filter-panel ${open ? "open" : ""}`}>
      <div className="filter-panel-header">
        <div>
          <h2>Filters</h2>
          <span>{activeFilterCount > 0 ? `${activeFilterCount} active` : "No active filters"}</span>
        </div>
        <div className="filter-panel-header-actions">
          {activeFilterCount > 0 && (
            <button type="button" className="filter-panel-clear" onClick={clearAllFilters}>
              Clear
            </button>
          )}
          <button type="button" className="filter-panel-close" onClick={onClose} aria-label="Close filters">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <section className="filter-panel-section">
        <span className="filter-panel-label">Visibility</span>
        <div className="filter-button-grid filter-button-grid--visibility">
          {VISIBILITY_FILTERS.map((filter) => {
            const isActive = visibilityFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
                onClick={() => toggleVisibilityFilter(filter.value)}
                aria-pressed={isActive}
                title={filter.title}
              >
                <span className="filter-pill-count">{stats[filter.countKey]}</span>
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="filter-panel-section content-filter-section">
        <div className="content-filter-toggle">
          <button
            type="button"
            className={`content-toggle-btn ${contentFilterView === "transcript" ? "active" : ""}`}
            onClick={() => setContentFilterView("transcript")}
          >
            Transcript
            {contentFilterView !== "transcript" && transcriptStatusFilters.length > 0 && (
              <span className="toggle-badge">{transcriptStatusFilters.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`content-toggle-btn ${contentFilterView === "metadata" ? "active" : ""}`}
            onClick={() => setContentFilterView("metadata")}
          >
            Metadata
            {contentFilterView !== "metadata" && metadataStatusFilters.length > 0 && (
              <span className="toggle-badge">{metadataStatusFilters.length}</span>
            )}
          </button>
        </div>
        <div className="filter-button-grid filter-button-grid--content">
          {CONTENT_STATUS_FILTERS.map((filter) => {
            const selectedFilters = contentFilterView === "transcript"
              ? transcriptStatusFilters
              : metadataStatusFilters;
            const toggleFilter = contentFilterView === "transcript"
              ? toggleTranscriptFilter
              : toggleMetadataFilter;
            const isActive = selectedFilters.includes(filter.value);

            return (
              <button
                key={filter.value}
                type="button"
                className={`filter-pill ${filter.className} ${isActive ? "active" : ""}`}
                onClick={() => toggleFilter(filter.value)}
                aria-pressed={isActive}
              >
                <span className="filter-pill-count">{stats[filter.countKeys[contentFilterView]]}</span>
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="filter-panel-section filter-panel-fields">
        <div className="dropdown-container" ref={dateDropdownRef}>
          <button
            type="button"
            className={`dropdown-trigger ${hasDateFilter ? "active" : ""}`}
            onClick={() => setShowDateDropdown(!showDateDropdown)}
          >
            {getDateButtonText()} <Icon name="chevron-down" size={12} />
          </button>
          {showDateDropdown && (
            <div className="date-dropdown-panel">
              <div className="date-mode-toggle">
                <button
                  type="button"
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
                  type="button"
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

              {hasDateFilter && <button type="button" className="date-clear-btn" onClick={clearDateFilters}>Clear Date</button>}
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
      </section>
    </div>
  );
}
