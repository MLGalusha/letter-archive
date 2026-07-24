import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import AdminLayout from "../../components/AdminLayout";
import useIsMobile from "../../hooks/useIsMobile";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import DashboardToolbar from "./AdminDashboard/DashboardToolbar";
import BulkEditToolbar from "./AdminDashboard/BulkEditToolbar";
import DashboardDialogs from "./AdminDashboard/DashboardDialogs";
import {
  formatDashboardDateTime,
  formatDateRaw,
  getDashboardDateButtonText,
  getCombinedTranscriptStatus,
  loadPersistedState,
} from "./AdminDashboard/utils";
import { StatusIcon } from "./AdminDashboard/StatusIcon";
import { useDashboardBulkActions } from "./AdminDashboard/useDashboardBulkActions";
import { useDashboardColumns } from "./AdminDashboard/useDashboardColumns";
import { useDashboardCopyPasteEdit } from "./AdminDashboard/useDashboardCopyPasteEdit";
import { useDashboardFilteredSelection } from "./AdminDashboard/useDashboardFilteredSelection";
import { useDashboardFlagActions } from "./AdminDashboard/useDashboardFlagActions";
import { useDashboardFilters } from "./AdminDashboard/useDashboardFilters";
import { useDashboardLettersData } from "./AdminDashboard/useDashboardLettersData";
import { useDashboardPersistedState } from "./AdminDashboard/useDashboardPersistedState";
import { useDashboardProcessingActions } from "./AdminDashboard/useDashboardProcessingActions";
import { useDashboardRowSelection } from "./AdminDashboard/useDashboardRowSelection";
import { useDashboardSavedViewState } from "./AdminDashboard/useDashboardSavedViewState";
import { useDashboardSelection } from "./AdminDashboard/useDashboardSelection";
import { useDashboardSelectionDetails } from "./AdminDashboard/useDashboardSelectionDetails";
import { useDashboardSort } from "./AdminDashboard/useDashboardSort";
import { useDashboardViewState } from "./AdminDashboard/useDashboardViewState";
import { createDashboardCommittedQuery } from "./AdminDashboard/dashboardQueryModel";
import { getDashboardDateFilterValue } from "./AdminDashboard/dashboardFilterStateModel";
import { createDashboardStoredState } from "./AdminDashboard/dashboardStoredStateModel";
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile(768);
  const { dashboardView, handleDashboardViewChange } = useDashboardViewState();

  const [initialStoredState] = useState(loadPersistedState);
  const dashboardFilters = useDashboardFilters(initialStoredState);
  const {
    sortColumns,
    setSortColumns,
    replaceSortColumns,
  } = useDashboardSort(initialStoredState.sortColumns);
  const committedQuery = useMemo(
    () => createDashboardCommittedQuery(
      dashboardFilters.state.query,
      sortColumns,
    ),
    [
      dashboardFilters.state.query,
      sortColumns,
    ],
  );
  const dashboardStoredState = useMemo(
    () => createDashboardStoredState(
      committedQuery,
      dashboardFilters.state.dateMode,
    ),
    [committedQuery, dashboardFilters.state.dateMode],
  );
  const {
    visibleColumns,
    columnOrder,
    replaceStoredColumns,
    orderedColumns,
    showColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    moveColumn,
    reorderColumn,
    resetColumnOrder,
    toggleColumnMenu,
    closeColumnMenu,
  } = useDashboardColumns();

  useDashboardPersistedState(dashboardStoredState);

  const {
    letters,
    setLetters,
    filteredLetters,
    loading,
    isInitialLoad,
    error,
    pagination,
    stats,
    fetchLetters,
  } = useDashboardLettersData({
    query: committedQuery,
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
    }
  }, [navigate]);

  useEffect(() => {
    const closeDashboardOverlays = () => {
      setFiltersOpen(false);
      closeColumnMenu();
    };

    window.addEventListener("admin-mobile-nav-open", closeDashboardOverlays);
    return () => window.removeEventListener("admin-mobile-nav-open", closeDashboardOverlays);
  }, [closeColumnMenu]);

  const {
    selectedIds,
    selectedSources,
    selectionIntent,
    replaceExplicitSelection,
    reconcileSelection,
    makeSelectionExplicit,
    isSelectionIntentCurrent,
    allFilteredSelected,
    toggleSelection,
    clearSelection,
    clearSelectionIfCurrent,
    allPageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  } = useDashboardSelection(filteredLetters, committedQuery);

  const {
    hasDragMoved,
    handleCheckboxChange,
    handleRowMouseDown,
    handleRowMouseEnter,
  } = useDashboardRowSelection({
    rows: filteredLetters,
    selectedIds,
    replaceExplicitSelection,
    toggleSelection,
  });

  const {
    editMode,
    copyModeActive,
    copiedValue,
    sourceCell,
    pendingChanges,
    isSaving,
    exitEditMode,
    closeEditToolbar,
    handleDone,
    toggleCopyMode,
    handleCellClick,
    handleEditModeRowClick,
  } = useDashboardCopyPasteEdit({
    selectedIds,
    clearSelection,
    makeSelectionExplicit,
    isSelectionIntentCurrent,
    handleCheckboxChange,
    fetchLetters,
  });

  const { handleSelectAllFiltered } = useDashboardFilteredSelection({
    query: committedQuery,
    selectedIds,
    selectionIntent,
    reconcileSelection,
    clearSelectionIfCurrent,
    closeEditToolbar,
    selectAllFiltered,
  });

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (hasDragMoved) return;
    if (handleEditModeRowClick(letterId, index, e)) return;
    navigate(`/admin/letters/${letterId}`);
  };

  const handleToolbarManagerOpen = () => {
    if (isMobile && selectedIds.size > 0) {
      exitEditMode();
    }
  };

  const { singleSelectedLetter, publishCounts } = useDashboardSelectionDetails({
    letters,
    filteredLetters,
    selectedIds,
  });

  const { handleToggleFlag } = useDashboardFlagActions({
    setLetters,
    makeSelectionExplicit,
  });

  const bulkActions = useDashboardBulkActions({
    selectedIds,
    selectedSources,
    replaceExplicitSelection,
    makeSelectionExplicit,
    exitEditMode,
    fetchLetters,
  });
  const {
    bulkActionLoading,
    handleDeleteClick,
    handleClearTranscriptionsClick,
    handleClearMetadataClick,
    handleBulkPublish,
    handleBulkHide,
    handleBulkContentVisibility,
  } = bulkActions;

  const processingActions = useDashboardProcessingActions({
    selectedIds,
    selectedSources,
    singleSelectedLetter,
    makeSelectionExplicit,
    exitEditMode,
    fetchLetters,
  });
  const {
    handleOpenTranscription,
    handleOpenMetadataExtraction,
  } = processingActions;

  const dateButtonText = getDashboardDateButtonText(
    getDashboardDateFilterValue(dashboardFilters.state),
  );

  const {
    savedViews,
    saveView: handleSaveDashboardView,
    applyView: handleApplyDashboardView,
    deleteView: handleDeleteDashboardView,
  } = useDashboardSavedViewState({
    storedState: dashboardStoredState,
    visibleColumns,
    columnOrder,
    replaceStoredFilters: dashboardFilters.actions.replaceStoredFilters,
    replaceSortColumns,
    replaceStoredColumns,
  });

  if (loading && isInitialLoad) {
    return (
      <AdminLayout fullHeight>
        <div className="admin-dashboard">
          <div className="admin-content loading-content">
            <p>Loading letters...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout fullHeight>
        <div className="admin-dashboard">
          <div className="admin-content error-content">
            <p className="error-message">{error}</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout fullHeight>
    <div className="admin-dashboard">
      <section className="dashboard-toolbar" aria-label="Dashboard controls">
        <DashboardToolbar
          dashboardView={dashboardView}
          onDashboardViewChange={handleDashboardViewChange}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          paginationTotal={pagination.total}
          stats={stats}
          sortColumns={sortColumns}
          setSortColumns={setSortColumns}
          savedViews={savedViews}
          onSaveView={handleSaveDashboardView}
          onApplyView={handleApplyDashboardView}
          onDeleteView={handleDeleteDashboardView}
          filterState={dashboardFilters.state}
          filterDrafts={dashboardFilters.drafts}
          filterActions={dashboardFilters.actions}
          dateButtonText={dateButtonText}
          onManagerOpen={handleToolbarManagerOpen}
        />
      </section>
      {dashboardView === 'collections' && <CollectionsDashboard />}
      {dashboardView === 'letters' && <>
      <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
        <RecentActivityTable
          filteredLetters={filteredLetters}
          columns={{
            visibleColumns,
            orderedColumns,
            showColumnMenu,
            onToggleColumnMenu: toggleColumnMenu,
            onCloseColumnMenu: closeColumnMenu,
            onToggleColumn: toggleColumnVisibility,
            onMoveColumn: moveColumn,
            onReorderColumn: reorderColumn,
            onResetColumnOrder: resetColumnOrder,
            columnMenuRef,
          }}
          selection={{
            selectedIds,
            onRowClick: handleRowClick,
            onRowMouseDown: handleRowMouseDown,
            onRowMouseEnter: handleRowMouseEnter,
            onCheckboxChange: handleCheckboxChange,
          }}
          copyEdit={{
            editMode,
            copyModeActive,
            sourceCell,
            pendingChanges,
            onCellClick: handleCellClick,
          }}
          formatting={{
            formatDate: formatDashboardDateTime,
            formatDateRaw,
            getCombinedTranscriptStatus,
            renderStatusIcon: (status, type) => <StatusIcon status={status} type={type} />,
          }}
          pagination={{
            pagination,
            loading,
            onPageChange: (page) => fetchLetters(true, page),
            letterCountText: `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`,
          }}
          rowActions={{ onToggleFlag: handleToggleFlag }}
        />
      </div>

      <DashboardDialogs
        selectedCount={selectedIds.size}
        singleMetadataLetterTitle={singleSelectedLetter?.title}
        bulkActions={bulkActions}
        processingActions={processingActions}
      />


      {editMode && (
        <BulkEditToolbar
          selection={{
            selectedCount: selectedIds.size,
            pageCount: filteredLetters.length,
            totalCount: pagination.total,
            allPageSelected,
            allFilteredSelected,
            onSelectPage: handleSelectAllPage,
            onSelectAllFiltered: handleSelectAllFiltered,
            onClearSelection: clearSelection,
          }}
          copy={{
            copyModeActive,
            copiedValue,
            sourceCell,
            pendingChangesCount: pendingChanges.size,
            isSaving,
            onToggleCopyMode: toggleCopyMode,
          }}
          processing={{
            onOpenTranscription: handleOpenTranscription,
            onOpenMetadataExtraction: handleOpenMetadataExtraction,
          }}
          publishing={{
            bulkActionLoading,
            publishCounts,
            onBulkHide: handleBulkHide,
            onBulkPublish: handleBulkPublish,
            onBulkContentVisibility: handleBulkContentVisibility,
          }}
          danger={{
            bulkActionLoading,
            onClearTranscriptions: handleClearTranscriptionsClick,
            onClearMetadata: handleClearMetadataClick,
            onDelete: handleDeleteClick,
          }}
          completion={{
            pendingChangesCount: pendingChanges.size,
            isSaving,
            onDone: handleDone,
            onExit: exitEditMode,
          }}
        />
      )}
      </>}
    </div>
    </AdminLayout>
  );
}
