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
  dateRawToDisplay,
  displayToDateRaw,
  formatDashboardDateTime,
  formatDateRaw,
  getDashboardDateButtonText,
  getCombinedTranscriptStatus,
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
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile(768);
  const { dashboardView, handleDashboardViewChange } = useDashboardViewState();

  const dashboardFilters = useDashboardFilters();
  const {
    collectionFilter,
    visibilityFilter,
    searchQuery,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    missingFilters,
    contentShapeFilters,
    initialSortColumns,
  } = dashboardFilters;
  const { sortColumns, setSortColumns } = useDashboardSort(initialSortColumns);
  const committedQuery = useMemo(
    () => createDashboardCommittedQuery(
      {
        collectionFilter,
        visibilityFilter,
        searchQuery,
        yearFilter,
        monthFilter,
        dayFilter,
        dateFromFilter,
        dateToFilter,
        transcriptStatusFilters,
        metadataStatusFilters,
        extraContentStatusFilters,
        workflowFilters,
        flaggedFilter,
        missingFilters,
        contentShapeFilters,
      },
      sortColumns,
    ),
    [
      collectionFilter,
      visibilityFilter,
      searchQuery,
      yearFilter,
      monthFilter,
      dayFilter,
      dateFromFilter,
      dateToFilter,
      transcriptStatusFilters,
      metadataStatusFilters,
      extraContentStatusFilters,
      workflowFilters,
      flaggedFilter,
      missingFilters,
      contentShapeFilters,
      sortColumns,
    ],
  );
  const {
    visibleColumns,
    setVisibleColumns,
    columnOrder,
    setColumnOrder,
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

  useDashboardPersistedState({ filters: dashboardFilters, sortColumns });

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
    setSelectedIds,
    allFilteredSelected,
    setAllFilteredSelected,
    toggleSelection,
    clearSelection,
    allPageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  } = useDashboardSelection(filteredLetters);

  const {
    hasDragMoved,
    handleCheckboxChange,
    handleRowMouseDown,
    handleRowMouseEnter,
  } = useDashboardRowSelection({
    rows: filteredLetters,
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
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
    handleCheckboxChange,
    fetchLetters,
  });

  const { handleSelectAllFiltered } = useDashboardFilteredSelection({
    query: committedQuery,
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
    clearSelection,
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

  const { handleToggleFlag } = useDashboardFlagActions({ setLetters });

  const bulkActions = useDashboardBulkActions({
    selectedIds,
    selectedSources,
    setSelectedIds,
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
    exitEditMode,
    fetchLetters,
  });
  const {
    handleOpenTranscription,
    handleOpenMetadataExtraction,
  } = processingActions;

  const getDateButtonText = () => getDashboardDateButtonText({
    dateMode: dashboardFilters.dateMode,
    yearFilter: dashboardFilters.yearFilter,
    monthFilter: dashboardFilters.monthFilter,
    dayFilter: dashboardFilters.dayFilter,
    dateFromFilter: dashboardFilters.dateFromFilter,
    dateToFilter: dashboardFilters.dateToFilter,
  });

  const {
    savedViews,
    saveView: handleSaveDashboardView,
    applyView: handleApplyDashboardView,
    deleteView: handleDeleteDashboardView,
  } = useDashboardSavedViewState({
    filters: dashboardFilters,
    sortColumns,
    setSortColumns,
    visibleColumns,
    setVisibleColumns,
    columnOrder,
    setColumnOrder,
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
          filters={dashboardFilters}
          getDateButtonText={getDateButtonText}
          dateRawToDisplay={dateRawToDisplay}
          displayToDateRaw={displayToDateRaw}
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
