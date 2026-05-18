import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import AdminLayout from "../../components/AdminLayout";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import DashboardToolbar from "./AdminDashboard/DashboardToolbar";
import BulkEditToolbar from "./AdminDashboard/BulkEditToolbar";
import DashboardDialogs from "./AdminDashboard/DashboardDialogs";
import { ALL_COLUMNS } from "./AdminDashboard/constants";
import {
  dateRawToDisplay,
  displayToDateRaw,
  formatDashboardDateTime,
  formatDateRaw,
  getDashboardDateButtonText,
  getCombinedTranscriptStatus,
  StatusIcon,
} from "./AdminDashboard/utils";
import { useDashboardBulkActions } from "./AdminDashboard/useDashboardBulkActions";
import { useDashboardColumns } from "./AdminDashboard/useDashboardColumns";
import { useDashboardCopyPasteEdit } from "./AdminDashboard/useDashboardCopyPasteEdit";
import { useDashboardFilteredSelection } from "./AdminDashboard/useDashboardFilteredSelection";
import { useDashboardFlagActions } from "./AdminDashboard/useDashboardFlagActions";
import { useDashboardFilters } from "./AdminDashboard/useDashboardFilters";
import { useDashboardLettersData } from "./AdminDashboard/useDashboardLettersData";
import { useDashboardPersistedState } from "./AdminDashboard/useDashboardPersistedState";
import { useDashboardProcessingActions } from "./AdminDashboard/useDashboardProcessingActions";
import { useDashboardProcessingControls } from "./AdminDashboard/useDashboardProcessingControls";
import { useDashboardRowSelection } from "./AdminDashboard/useDashboardRowSelection";
import { useDashboardSavedViewState } from "./AdminDashboard/useDashboardSavedViewState";
import { useDashboardSelection } from "./AdminDashboard/useDashboardSelection";
import { useDashboardSelectionDetails } from "./AdminDashboard/useDashboardSelectionDetails";
import { useDashboardSort } from "./AdminDashboard/useDashboardSort";
import { useDashboardViewState } from "./AdminDashboard/useDashboardViewState";
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const { dashboardView, handleDashboardViewChange } = useDashboardViewState();

  const dashboardFilters = useDashboardFilters();
  const {
    initialSortColumns,
  } = dashboardFilters;
  const { sortColumns, setSortColumns, handleSort, getSortInfo } = useDashboardSort(initialSortColumns);
  const {
    visibleColumns,
    setVisibleColumns,
    showColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    toggleColumnMenu,
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
    filters: dashboardFilters,
    sortColumns,
  });

  // Auth check — runs once on mount
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/admin-login");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const {
    selectedIds,
    setSelectedIds,
    allFilteredSelected,
    setAllFilteredSelected,
    toggleSelection,
    clearSelection,
    allPageSelected,
    somePageSelected: _somePageSelected,
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
    filters: dashboardFilters,
    sortColumns,
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
    clearSelection,
    closeEditToolbar,
    fetchLetters,
    selectAllFiltered,
  });

  const handleRowClick = (letterId: string, index: number, e: React.MouseEvent) => {
    if (hasDragMoved) return;
    if (handleEditModeRowClick(letterId, index, e)) return;
    navigate(`/admin/letters/${letterId}`);
  };

  const { singleSelectedLetter, publishCounts } = useDashboardSelectionDetails({
    letters,
    filteredLetters,
    selectedIds,
  });

  const { handleToggleFlag } = useDashboardFlagActions({ setLetters });

  const bulkActions = useDashboardBulkActions({
    selectedIds,
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

  const {
    processingStatus,
    pausePending,
    abortPending,
    handlePauseProcessing,
    handleResumeProcessing,
    handleAbortProcessing,
  } = useDashboardProcessingControls({ fetchLetters });

  const processingActions = useDashboardProcessingActions({
    selectedIds,
    letters,
    singleSelectedLetter,
    filters: dashboardFilters,
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
          mobileFiltersOpen={mobileFiltersOpen}
          onMobileFiltersOpenChange={setMobileFiltersOpen}
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
          processingStatus={processingStatus}
          selectedCount={selectedIds.size}
        />
      </section>
      {dashboardView === 'collections' && <CollectionsDashboard />}
      {dashboardView === 'letters' && <>
      <div className={`admin-content ${editMode ? 'has-edit-toolbar' : ''}`}>
        <RecentActivityTable
          filteredLetters={filteredLetters}
          visibleColumns={visibleColumns}
          getSortInfo={getSortInfo}
          onSort={handleSort}
          onRowClick={handleRowClick}
          onRowMouseDown={handleRowMouseDown}
          onRowMouseEnter={handleRowMouseEnter}
          onCheckboxChange={handleCheckboxChange}
          selectedIds={selectedIds}
          editMode={editMode}
          copyModeActive={copyModeActive}
          sourceCell={sourceCell}
          pendingChanges={pendingChanges}
          onCellClick={handleCellClick}
          formatDate={formatDashboardDateTime}
          formatDateRaw={formatDateRaw}
          getCombinedTranscriptStatus={getCombinedTranscriptStatus}
          renderStatusIcon={(status, type) => <StatusIcon status={status} type={type} />}
          pagination={pagination}
          loading={loading}
          onPageChange={(page) => fetchLetters(true, page)}
          letterCountText={`${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`}
          allColumns={ALL_COLUMNS}
          showColumnMenu={showColumnMenu}
          onToggleColumnMenu={toggleColumnMenu}
          onToggleColumn={toggleColumnVisibility}
          columnMenuRef={columnMenuRef}
          onToggleFlag={handleToggleFlag}
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
          selectedCount={selectedIds.size}
          pageCount={filteredLetters.length}
          totalCount={pagination.total}
          allPageSelected={allPageSelected}
          allFilteredSelected={allFilteredSelected}
          copyModeActive={copyModeActive}
          copiedValue={copiedValue}
          sourceCell={sourceCell}
          pendingChangesCount={pendingChanges.size}
          isSaving={isSaving}
          bulkActionLoading={bulkActionLoading}
          processingStatus={processingStatus}
          pausePending={pausePending}
          abortPending={abortPending}
          publishCounts={publishCounts}
          onSelectPage={handleSelectAllPage}
          onSelectAllFiltered={handleSelectAllFiltered}
          onClearSelection={clearSelection}
          onToggleCopyMode={toggleCopyMode}
          onOpenTranscription={handleOpenTranscription}
          onOpenMetadataExtraction={handleOpenMetadataExtraction}
          onPauseProcessing={handlePauseProcessing}
          onResumeProcessing={handleResumeProcessing}
          onAbortProcessing={handleAbortProcessing}
          onBulkHide={handleBulkHide}
          onBulkPublish={handleBulkPublish}
          onBulkContentVisibility={handleBulkContentVisibility}
          onClearTranscriptions={handleClearTranscriptionsClick}
          onClearMetadata={handleClearMetadataClick}
          onDelete={handleDeleteClick}
          onDone={handleDone}
          onExit={exitEditMode}
        />
      )}
      </>}
    </div>
    </AdminLayout>
  );
}
