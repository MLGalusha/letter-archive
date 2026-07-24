import type { Dispatch, SetStateAction } from "react";
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
import type { DashboardManager } from "./useDashboardManagerState";
import type {
  DashboardView,
  DashboardFilterStats,
  SavedDashboardView,
  SortColumn,
} from "./types";

interface DashboardToolbarProps {
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
  activeManager: DashboardManager | null;
  onManagerOpenChange: (manager: DashboardManager, open: boolean) => void;
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
  activeManager,
  onManagerOpenChange,
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

  const filtersOpen = activeManager === "filters";

  const handleFiltersToggle = () => {
    const nextFiltersOpen = !filtersOpen;
    if (nextFiltersOpen) {
      onManagerOpen?.();
    }
    onManagerOpenChange("filters", nextFiltersOpen);
  };

  const handleSavedViewsOpenChange = (open: boolean) => {
    if (open) {
      onManagerOpen?.();
    }
    onManagerOpenChange("savedViews", open);
  };

  const handleSortOpenChange = (open: boolean) => {
    if (open) {
      onManagerOpen?.();
    }
    onManagerOpenChange("sort", open);
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
              open={activeManager === "savedViews"}
              onOpenChange={handleSavedViewsOpenChange}
            />

            <DashboardSortControl
              sortColumns={sortColumns}
              setSortColumns={setSortColumns}
              open={activeManager === "sort"}
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
              onClick={() => onManagerOpenChange("filters", false)}
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
            onClose={() => onManagerOpenChange("filters", false)}
          />
        </>
      )}
    </div>
  );
}
