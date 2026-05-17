import type { Dispatch, RefObject, SetStateAction } from "react";
import { useMemo } from "react";
import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";
import type { ContentStatus } from "../../../types/Letter";
import ActiveFilterChips from "./ActiveFilterChips";
import DashboardFilterPanel from "./DashboardFilterPanel";
import SavedViewsMenu from "./SavedViewsMenu";
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
import { useDashboardActiveFilters } from "./useDashboardActiveFilters";
import { DEFAULT_DASHBOARD_SORT } from "./useDashboardSort";

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
  const { activeFilterCount, activeFilterChips } = useDashboardActiveFilters({
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
    hasDateFilter,
    toggleVisibilityFilter,
    handleCollectionInputChange,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
  });

  const primarySortValue = useMemo(() => {
    const serverSort = [...sortColumns].reverse().find(col => isServerSortField(col.field));
    if (!serverSort) return `${DEFAULT_DASHBOARD_SORT.field}:${DEFAULT_DASHBOARD_SORT.direction}`;
    return `${serverSort.field}:${serverSort.direction}`;
  }, [sortColumns]);

  const handlePrimarySortChange = (value: string) => {
    const [field, direction] = value.split(":") as [ServerSortField, "asc" | "desc"];
    setSortColumns((previous) => [
      ...previous.filter((column) => !isServerSortField(column.field)),
      { field, direction },
    ]);
  };

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

            <SavedViewsMenu
              savedViews={savedViews}
              onSaveView={onSaveView}
              onApplyView={onApplyView}
              onDeleteView={onDeleteView}
            />

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
          <ActiveFilterChips
            paginationTotal={paginationTotal}
            activeFilterCount={activeFilterCount}
            activeFilterChips={activeFilterChips}
            processingStatus={processingStatus}
            selectedCount={selectedCount}
            onClearAllFilters={handleClearAllFilters}
          />

          {mobileFiltersOpen && (
            <button
              type="button"
              className="filter-panel-backdrop"
              aria-label="Close filters"
              onClick={() => onMobileFiltersOpenChange(false)}
            />
          )}
          <DashboardFilterPanel
            open={mobileFiltersOpen}
            stats={stats}
            collectionInput={collectionInput}
            handleCollectionInputChange={handleCollectionInputChange}
            visibilityFilter={visibilityFilter}
            toggleVisibilityFilter={toggleVisibilityFilter}
            contentFilterView={contentFilterView}
            setContentFilterView={setContentFilterView}
            transcriptStatusFilters={transcriptStatusFilters}
            toggleTranscriptFilter={toggleTranscriptFilter}
            metadataStatusFilters={metadataStatusFilters}
            toggleMetadataFilter={toggleMetadataFilter}
            showDateDropdown={showDateDropdown}
            setShowDateDropdown={setShowDateDropdown}
            dateDropdownRef={dateDropdownRef}
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
            clearAllFilters={handleClearAllFilters}
            getDateButtonText={getDateButtonText}
            dateRawToDisplay={dateRawToDisplay}
            displayToDateRaw={displayToDateRaw}
            activeFilterCount={activeFilterCount}
            onClose={() => onMobileFiltersOpenChange(false)}
          />
        </>
      )}
    </div>
  );
}
