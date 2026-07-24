import { useState, type Dispatch, type SetStateAction } from "react";
import ActiveFilterChips from "./ActiveFilterChips";
import DashboardFilterPanel from "./DashboardFilterPanel";
import DashboardFilterTrigger from "./DashboardFilterTrigger";
import DashboardSearchField from "./DashboardSearchField";
import DashboardSortControl from "./DashboardSortControl";
import DashboardViewToggle from "./DashboardViewToggle";
import SavedViewsMenu from "./SavedViewsMenu";
import { createDashboardActiveFilters } from "./dashboardActiveFilters";
import type { DashboardFilterState } from "./dashboardFilterStateModel";
import type {
  DashboardFilterActions,
  DashboardFilterDrafts,
} from "./useDashboardFilters";
import type {
  DashboardView,
  DashboardFilterStats,
  SavedDashboardView,
  SortColumn,
} from "./types";

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
  filterState: DashboardFilterState;
  filterDrafts: DashboardFilterDrafts;
  filterActions: DashboardFilterActions;
  dateButtonText: string;
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
  filterState,
  filterDrafts,
  filterActions,
  dateButtonText,
  onManagerOpen,
}: DashboardToolbarProps) {
  const { activeFilterCount, activeFilterChips } =
    createDashboardActiveFilters({
      state: filterState,
      actions: filterActions,
      dateButtonText,
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
              value={filterDrafts.searchInput}
              onChange={filterActions.changeSearchInput}
              onClear={filterActions.clearSearch}
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
            onClearAllFilters={filterActions.clearAllFilters}
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
            filterState={filterState}
            filterDrafts={filterDrafts}
            filterActions={filterActions}
            dateButtonText={dateButtonText}
            activeFilterCount={activeFilterCount}
            onClose={() => onFiltersOpenChange(false)}
          />
        </>
      )}
    </div>
  );
}
