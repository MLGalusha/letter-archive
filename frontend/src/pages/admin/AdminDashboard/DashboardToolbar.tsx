import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";
import type { ContentStatus } from "../../../types/Letter";
import { DAY_OPTIONS, MONTH_OPTIONS, YEAR_OPTIONS } from "./constants";
import type {
  ContentFilterView,
  DashboardView,
  DateMode,
  SavedDashboardView,
  ServerSortField,
  SortColumn,
  VisibilityFilter,
} from "./types";
import { isServerSortField } from "./utils";

interface DashboardToolbarStats {
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

interface DashboardToolbarProps {
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
  mobileFiltersOpen: boolean;
  onMobileFiltersOpenChange: Dispatch<SetStateAction<boolean>>;
  paginationTotal: number;
  stats: DashboardToolbarStats;
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
  savedViews: SavedDashboardView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedDashboardView) => void;
  onDeleteView: (viewId: string) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  collectionInput: string;
  collectionFilter: string;
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
  handleClearAllFilters: () => void;
  getDateButtonText: () => string;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
  processingStatus: ProcessingStatus | null;
  selectedCount: number;
}

export default function DashboardToolbar({
  dashboardView,
  onDashboardViewChange,
  mobileFiltersOpen,
  onMobileFiltersOpenChange,
  paginationTotal,
  stats,
  sortColumns,
  setSortColumns,
  savedViews,
  onSaveView,
  onApplyView,
  onDeleteView,
  searchInput,
  setSearchInput,
  searchQuery,
  setSearchQuery,
  collectionInput,
  collectionFilter,
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
  handleClearAllFilters,
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
  processingStatus,
  selectedCount,
}: DashboardToolbarProps) {
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const savedViewsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedViewsOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (savedViewsRef.current && !savedViewsRef.current.contains(event.target as Node)) {
        setSavedViewsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [savedViewsOpen]);

  const handleSaveView = () => {
    onSaveView(newViewName || "Dashboard view");
    setNewViewName("");
    setSavedViewsOpen(false);
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (collectionFilter !== "all") count++;
    if (visibilityFilter !== "ALL") count++;
    if (searchQuery) count++;
    if (transcriptStatusFilters.length > 0) count += transcriptStatusFilters.length;
    if (metadataStatusFilters.length > 0) count += metadataStatusFilters.length;
    if (yearFilter !== null) count++;
    if (monthFilter !== null) count++;
    if (dayFilter !== null) count++;
    if (dateFromFilter !== null) count++;
    if (dateToFilter !== null) count++;
    return count;
  }, [
    collectionFilter,
    visibilityFilter,
    searchQuery,
    transcriptStatusFilters,
    metadataStatusFilters,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  const primarySortValue = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find(col => isServerSortField(col.field));
    if (!serverSort) return "createdAt:desc";
    return `${serverSort.field}:${serverSort.direction}`;
  }, [sortColumns]);

  const handlePrimarySortChange = (value: string) => {
    const [field, direction] = value.split(":") as [ServerSortField, "asc" | "desc"];
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction },
    ]);
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

    if (visibilityFilter !== "ALL") {
      chips.push({
        key: "visibility",
        label: visibilityFilter === "PUBLISHED" ? "Published" : "Hidden",
        onRemove: () => toggleVisibilityFilter(visibilityFilter),
      });
    }

    if (collectionFilter !== "all") {
      chips.push({
        key: "collection",
        label: `Collection ${collectionFilter}`,
        onRemove: () => handleCollectionInputChange(""),
      });
    }

    if (searchQuery) {
      chips.push({
        key: "search",
        label: `Search: ${searchQuery}`,
        onRemove: () => {
          setSearchInput("");
          setSearchQuery("");
        },
      });
    }

    if (hasDateFilter) {
      chips.push({
        key: "date",
        label: getDateButtonText(),
        onRemove: clearDateFilters,
      });
    }

    transcriptStatusFilters.forEach((status) => {
      chips.push({
        key: `transcript-${status}`,
        label: `Transcript ${status.toLowerCase().replace("_", " ")}`,
        onRemove: () => toggleTranscriptFilter(status),
      });
    });

    metadataStatusFilters.forEach((status) => {
      chips.push({
        key: `metadata-${status}`,
        label: `Metadata ${status.toLowerCase().replace("_", " ")}`,
        onRemove: () => toggleMetadataFilter(status),
      });
    });

    return chips;
  }, [
    visibilityFilter,
    collectionFilter,
    searchQuery,
    hasDateFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    toggleVisibilityFilter,
    handleCollectionInputChange,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
  ]);

  return (
    <div className="dashboard-toolbar-stack">
      <div className="dashboard-toolbar-primary">
        <div className="dashboard-view-toggle" aria-label="Dashboard view">
          <button
            className={`view-toggle-btn ${dashboardView === "letters" ? "active" : ""}`}
            onClick={() => onDashboardViewChange("letters")}
          >
            Letters
          </button>
          <button
            className={`view-toggle-btn ${dashboardView === "collections" ? "active" : ""}`}
            onClick={() => onDashboardViewChange("collections")}
          >
            Collections
          </button>
        </div>

        {dashboardView === "letters" && (
          <>
            <div className="dashboard-search-field">
              <input
                type="search"
                placeholder="Search letters, senders, recipients..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput && (
                <button
                  className="dashboard-search-clear"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  aria-label="Clear search"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>

            <button
              className={`dashboard-control-btn mobile-filter-trigger ${activeFilterCount > 0 ? "has-filters" : ""}`}
              onClick={() => onMobileFiltersOpenChange((open) => !open)}
              aria-expanded={mobileFiltersOpen}
            >
              <Icon name="settings" size={15} />
              <span>Filters</span>
              {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
            </button>

            <div className="saved-view-menu" ref={savedViewsRef}>
              <button
                className={`dashboard-control-btn saved-view-btn ${savedViewsOpen ? "active" : ""}`}
                type="button"
                onClick={() => setSavedViewsOpen((open) => !open)}
                aria-expanded={savedViewsOpen}
              >
                <Icon name="save" size={15} />
                <span>Save view</span>
              </button>
              {savedViewsOpen && (
                <div className="saved-view-popover">
                  <div className="saved-view-form">
                    <input
                      type="text"
                      placeholder="View name"
                      value={newViewName}
                      onChange={(event) => setNewViewName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          handleSaveView();
                        }
                      }}
                    />
                    <button type="button" onClick={handleSaveView}>
                      Save
                    </button>
                  </div>

                  <div className="saved-view-list">
                    {savedViews.length === 0 ? (
                      <div className="saved-view-empty">No saved views</div>
                    ) : (
                      savedViews.map((view) => (
                        <div className="saved-view-item" key={view.id}>
                          <button
                            className="saved-view-load"
                            type="button"
                            onClick={() => {
                              onApplyView(view);
                              setSavedViewsOpen(false);
                            }}
                          >
                            {view.name}
                          </button>
                          <button
                            className="saved-view-delete"
                            type="button"
                            aria-label={`Delete ${view.name}`}
                            onClick={() => onDeleteView(view.id)}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <label className="dashboard-sort-control">
              <span>Sort</span>
              <select value={primarySortValue} onChange={(event) => handlePrimarySortChange(event.target.value)}>
                <option value="lastOpenedAt:desc">Last opened</option>
                <option value="letterDate:asc">Letter date oldest</option>
                <option value="letterDate:desc">Letter date newest</option>
                <option value="collection:asc">Collection</option>
                <option value="createdAt:desc">Created newest</option>
                <option value="sender:asc">Sender</option>
                <option value="recipient:asc">Recipient</option>
                <option value="visibility:asc">Visibility</option>
                <option value="flagged:desc">Flagged</option>
              </select>
            </label>
          </>
        )}
      </div>

      {dashboardView === "letters" && (
        <>
          <div className="active-filter-chips" aria-label="Active filters">
            <span className="dashboard-result-count">{paginationTotal} letters</span>
            {activeFilterChips.map((chip) => (
              <button key={chip.key} className="active-filter-chip" onClick={chip.onRemove}>
                <span>{chip.label}</span>
                <Icon name="close" size={12} />
              </button>
            ))}
            {activeFilterCount > 0 && (
              <button className="clear-all-link" onClick={handleClearAllFilters}>
                Clear all
              </button>
            )}
            {processingStatus?.isRunning && selectedCount === 0 && (
              <span className="stat-pill stat-processing">
                {processingStatus.currentJob?.type === "transcription" ? "T" : "M"}:{" "}
                {processingStatus.completed}/{processingStatus.total}
              </span>
            )}
          </div>

          <div className={`dashboard-filter-panel ${mobileFiltersOpen ? "open" : ""}`}>
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
        </>
      )}
    </div>
  );
}
