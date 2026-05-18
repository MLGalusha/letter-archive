import { useState, type Dispatch, type SetStateAction } from "react";
import type { ProcessingStatus } from "../../../api/admin";
import ActiveFilterChips from "./ActiveFilterChips";
import DashboardFilterPanel from "./DashboardFilterPanel";
import DashboardFilterTrigger from "./DashboardFilterTrigger";
import DashboardSearchField from "./DashboardSearchField";
import DashboardSortControl from "./DashboardSortControl";
import DashboardViewToggle from "./DashboardViewToggle";
import SavedViewsMenu from "./SavedViewsMenu";
import type { DashboardFilterControls } from "./useDashboardFilters";
import type {
  DashboardView,
  DashboardFilterStats,
  SavedDashboardView,
  SortColumn,
} from "./types";
import { useDashboardActiveFilters } from "./useDashboardActiveFilters";

type ToolbarManager = "savedViews" | "sort";

interface DashboardToolbarProps {
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: Dispatch<SetStateAction<boolean>>;
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
  onManagerOpen?: () => void;
}

export default function DashboardToolbar({
  dashboardView,
  onDashboardViewChange,
  filtersOpen,
  onFiltersOpenChange,
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
  onManagerOpen,
}: DashboardToolbarProps) {
  const {
    collectionFilters,
    removeCollectionFilter,
    visibilityFilter,
    toggleVisibilityFilter,
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
    collectionFilter,
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
    collectionFilters,
    visibilityFilter,
    searchQuery,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    missingFilters,
    contentShapeFilters,
    hasDateFilter,
    toggleVisibilityFilter,
    removeCollectionFilter,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
    toggleExtraContentFilter,
    toggleWorkflowFilter,
    toggleFlaggedFilter,
    toggleMissingFilter,
    toggleContentShapeFilter,
  });

  const [openManager, setOpenManager] = useState<ToolbarManager | null>(null);

  const handleFiltersToggle = () => {
    const nextFiltersOpen = !filtersOpen;
    if (nextFiltersOpen) {
      setOpenManager(null);
      onManagerOpen?.();
    }
    onFiltersOpenChange(nextFiltersOpen);
  };

  const handleSavedViewsOpenChange = (open: boolean) => {
    setOpenManager(open ? "savedViews" : null);
    if (open) {
      onFiltersOpenChange(false);
      onManagerOpen?.();
    }
  };

  const handleSortOpenChange = (open: boolean) => {
    setOpenManager(open ? "sort" : null);
    if (open) {
      onFiltersOpenChange(false);
      onManagerOpen?.();
    }
  };

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

            <DashboardFilterTrigger
              activeFilterCount={activeFilterCount}
              filtersOpen={filtersOpen}
              onToggle={handleFiltersToggle}
            />

            <SavedViewsMenu
              savedViews={savedViews}
              onSaveView={onSaveView}
              onApplyView={onApplyView}
              onDeleteView={onDeleteView}
              open={openManager === "savedViews"}
              onOpenChange={handleSavedViewsOpenChange}
            />

            <DashboardSortControl
              sortColumns={sortColumns}
              setSortColumns={setSortColumns}
              open={openManager === "sort"}
              onOpenChange={handleSortOpenChange}
            />
          </>
        )}
      </div>

      {dashboardView === "letters" && (
        <>
          <ActiveFilterChips
            paginationTotal={paginationTotal}
            activeFilterChips={activeFilterChips}
            processingStatus={processingStatus}
            selectedCount={selectedCount}
            onClearAllFilters={handleClearAllFilters}
          />

          {filtersOpen && (
            <button
              type="button"
              className="filter-panel-backdrop"
              aria-label="Close filters"
              onClick={() => onFiltersOpenChange(false)}
            />
          )}
          <DashboardFilterPanel
            open={filtersOpen}
            stats={stats}
            filters={filters}
            getDateButtonText={getDateButtonText}
            dateRawToDisplay={dateRawToDisplay}
            displayToDateRaw={displayToDateRaw}
            activeFilterCount={activeFilterCount}
            onClose={() => onFiltersOpenChange(false)}
          />
        </>
      )}
    </div>
  );
}
