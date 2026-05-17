import type { Dispatch, SetStateAction } from "react";
import type { ProcessingStatus } from "../../../api/admin";
import ActiveFilterChips from "./ActiveFilterChips";
import DashboardFilterPanel from "./DashboardFilterPanel";
import DashboardSearchField from "./DashboardSearchField";
import DashboardSortControl from "./DashboardSortControl";
import DashboardViewToggle from "./DashboardViewToggle";
import MobileFilterTrigger from "./MobileFilterTrigger";
import SavedViewsMenu from "./SavedViewsMenu";
import type { useDashboardFilters } from "./useDashboardFilters";
import type {
  DashboardView,
  DashboardFilterStats,
  SavedDashboardView,
  SortColumn,
} from "./types";
import { useDashboardActiveFilters } from "./useDashboardActiveFilters";

type DashboardFilterControls = ReturnType<typeof useDashboardFilters>;

interface DashboardToolbarProps {
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
  mobileFiltersOpen: boolean;
  onMobileFiltersOpenChange: Dispatch<SetStateAction<boolean>>;
  paginationTotal: number;
  stats: DashboardFilterStats;
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
  savedViews: SavedDashboardView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedDashboardView) => void;
  onDeleteView: (viewId: string) => void;
  filters: DashboardFilterControls;
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
  filters,
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
  processingStatus,
  selectedCount,
}: DashboardToolbarProps) {
  const {
    handleCollectionInputChange,
    visibilityFilter,
    toggleVisibilityFilter,
    transcriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    toggleMetadataFilter,
    collectionFilter,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    hasDateFilter,
    clearDateFilters,
    handleClearAllFilters,
  } = filters;

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

  return (
    <div className="dashboard-toolbar-stack">
      <div className="dashboard-toolbar-primary">
        <DashboardViewToggle
          dashboardView={dashboardView}
          onDashboardViewChange={onDashboardViewChange}
        />

        {dashboardView === "letters" && (
          <>
            <DashboardSearchField
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              setSearchQuery={setSearchQuery}
            />

            <MobileFilterTrigger
              activeFilterCount={activeFilterCount}
              mobileFiltersOpen={mobileFiltersOpen}
              onToggle={() => onMobileFiltersOpenChange((open) => !open)}
            />

            <SavedViewsMenu
              savedViews={savedViews}
              onSaveView={onSaveView}
              onApplyView={onApplyView}
              onDeleteView={onDeleteView}
            />

            <DashboardSortControl
              sortColumns={sortColumns}
              setSortColumns={setSortColumns}
            />
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
            filters={filters}
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
