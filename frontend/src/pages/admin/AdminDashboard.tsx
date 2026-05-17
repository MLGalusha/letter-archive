import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import AdminLayout from "../../components/AdminLayout";
import RecentActivityTable from "./AdminDashboard/RecentActivityTable";
import DashboardToolbar from "./AdminDashboard/DashboardToolbar";
import BulkEditToolbar from "./AdminDashboard/BulkEditToolbar";
import DashboardDialogs from "./AdminDashboard/DashboardDialogs";
import { ALL_COLUMNS } from "./AdminDashboard/constants";
import type { DashboardView } from "./AdminDashboard/types";
import {
  dateRawToDisplay,
  displayToDateRaw,
  formatDateRaw,
  getDashboardDateButtonText,
  getCombinedTranscriptStatus,
  savePersistedState,
  StatusIcon,
} from "./AdminDashboard/utils";
import { useDashboardBulkActions } from "./AdminDashboard/useDashboardBulkActions";
import { useDashboardColumns } from "./AdminDashboard/useDashboardColumns";
import { useDashboardCopyPasteEdit } from "./AdminDashboard/useDashboardCopyPasteEdit";
import { useDashboardFilteredSelection } from "./AdminDashboard/useDashboardFilteredSelection";
import { useDashboardFlagActions } from "./AdminDashboard/useDashboardFlagActions";
import { useDashboardFilters } from "./AdminDashboard/useDashboardFilters";
import { useDashboardLettersData } from "./AdminDashboard/useDashboardLettersData";
import { useDashboardProcessingActions } from "./AdminDashboard/useDashboardProcessingActions";
import { useDashboardProcessingControls } from "./AdminDashboard/useDashboardProcessingControls";
import { useDashboardRowSelection } from "./AdminDashboard/useDashboardRowSelection";
import { useDashboardSavedViewState } from "./AdminDashboard/useDashboardSavedViewState";
import { useDashboardSelection } from "./AdminDashboard/useDashboardSelection";
import { useDashboardSort } from "./AdminDashboard/useDashboardSort";
import CollectionsDashboard from "./AdminCollectionsListPage";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>(
    () => (localStorage.getItem('dashboard-view') as DashboardView) || 'letters',
  );

  const {
    showDateDropdown,
    setShowDateDropdown,
    dateMode,
    setDateMode,
    dateDropdownRef,
    contentFilterView,
    setContentFilterView,
    collectionInput,
    setCollectionInput,
    handleCollectionInputChange,
    visibilityFilter,
    setVisibilityFilter,
    toggleVisibilityFilter,
    transcriptStatusFilters,
    setTranscriptStatusFilters,
    toggleTranscriptFilter,
    metadataStatusFilters,
    setMetadataStatusFilters,
    toggleMetadataFilter,
    collectionFilter,
    setCollectionFilter,
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
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    hasDateFilter,
    clearDateFilters,
    handleClearAllFilters,
    initialSortColumns,
  } = useDashboardFilters();
  const { sortColumns, setSortColumns, handleSort, getSortInfo } = useDashboardSort(initialSortColumns);
  const {
    visibleColumns,
    setVisibleColumns,
    showColumnMenu,
    columnMenuRef,
    toggleColumnVisibility,
    toggleColumnMenu,
  } = useDashboardColumns();

  useEffect(() => {
    savePersistedState({
      visibilityFilter,
      collectionFilter,
      searchQuery,
      sortColumns,
      dateMode,
      year: yearFilter,
      month: monthFilter,
      day: dayFilter,
      dateFrom: dateFromFilter,
      dateTo: dateToFilter,
      transcriptStatusFilters,
      metadataStatusFilters,
    });
  }, [visibilityFilter, collectionFilter, searchQuery, sortColumns, dateMode, yearFilter, monthFilter, dayFilter, dateFromFilter, dateToFilter, transcriptStatusFilters, metadataStatusFilters]);

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
    collectionFilter,
    visibilityFilter,
    searchQuery,
    sortColumns,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
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
    collectionFilter,
    visibilityFilter,
    searchQuery,
    sortColumns,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
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

  const singleSelectedLetter = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const [selectedId] = Array.from(selectedIds);
    return letters.find((letter) => letter.id === selectedId) ?? null;
  }, [letters, selectedIds]);

  // Publish menu counts for selected letters
  const publishCounts = useMemo(() => {
    const selected = filteredLetters.filter(l => selectedIds.has(l.id));
    return {
      lettersPublished: selected.filter(l => l.visibility === 'PUBLISHED').length,
      lettersHidden: selected.filter(l => l.visibility === 'HIDDEN').length,
      transcriptsPublished: selected.filter(l => l.transcriptPublished).length,
      transcriptsUnpublished: selected.filter(l => !l.transcriptPublished).length,
      metadataPublished: selected.filter(l => l.metadataPublished).length,
      metadataUnpublished: selected.filter(l => !l.metadataPublished).length,
    };
  }, [filteredLetters, selectedIds]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  const { handleToggleFlag } = useDashboardFlagActions({ setLetters });

  const {
    showDeleteModal,
    deleting,
    showResetModal,
    showClearMetadataModal,
    bulkActionLoading,
    setShowResetModal,
    setShowClearMetadataModal,
    handleDeleteClick,
    handleConfirmDelete,
    handleCancelDelete,
    handleClearTranscriptionsClick,
    handleConfirmClearTranscriptions,
    handleClearMetadataClick,
    handleConfirmClearMetadata,
    handleBulkPublish,
    handleBulkHide,
    handleBulkContentVisibility,
  } = useDashboardBulkActions({
    selectedIds,
    exitEditMode,
    fetchLetters,
  });

  const {
    processingStatus,
    pausePending,
    abortPending,
    handlePauseProcessing,
    handleResumeProcessing,
    handleAbortProcessing,
  } = useDashboardProcessingControls({ fetchLetters });

  const {
    showUnconfirmedDialog,
    setShowUnconfirmedDialog,
    unconfirmedCount,
    showTranscribeConfirm,
    setShowTranscribeConfirm,
    transcribeExistingCount,
    showMetadataConfirm,
    setShowMetadataConfirm,
    metadataExistingCount,
    showSingleMetadataModal,
    setShowSingleMetadataModal,
    singleMetadataSender,
    setSingleMetadataSender,
    singleMetadataRecipient,
    setSingleMetadataRecipient,
    singleMetadataSubmitting,
    singleMetadataMode,
    handleStartTranscription,
    handleStartMetadataExtraction,
    handleConfirmUnverified,
    handleOpenTranscription,
    handleOpenMetadataExtraction,
    handleSingleMetadataExtraction,
  } = useDashboardProcessingActions({
    selectedIds,
    letters,
    singleSelectedLetter,
    collectionFilter,
    visibilityFilter,
    searchQuery,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    exitEditMode,
    fetchLetters,
  });

  const getDateButtonText = () => getDashboardDateButtonText({
    dateMode,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
  });

  const handleDashboardViewChange = (view: DashboardView) => {
    setDashboardView(view);
    localStorage.setItem("dashboard-view", view);
  };

  const {
    savedViews,
    saveView: handleSaveDashboardView,
    applyView: handleApplyDashboardView,
    deleteView: handleDeleteDashboardView,
  } = useDashboardSavedViewState({
    visibilityFilter,
    setVisibilityFilter,
    collectionFilter,
    setCollectionFilter,
    setCollectionInput,
    searchQuery,
    setSearchInput,
    setSearchQuery,
    sortColumns,
    setSortColumns,
    dateMode,
    setDateMode,
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
    transcriptStatusFilters,
    setTranscriptStatusFilters,
    metadataStatusFilters,
    setMetadataStatusFilters,
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
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          collectionInput={collectionInput}
          collectionFilter={collectionFilter}
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
          handleClearAllFilters={handleClearAllFilters}
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
          formatDate={formatDate}
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
        deleting={deleting}
        bulkActionLoading={bulkActionLoading}
        showDeleteModal={showDeleteModal}
        showResetModal={showResetModal}
        showClearMetadataModal={showClearMetadataModal}
        showUnconfirmedDialog={showUnconfirmedDialog}
        unconfirmedCount={unconfirmedCount}
        showTranscribeConfirm={showTranscribeConfirm}
        transcribeExistingCount={transcribeExistingCount}
        showMetadataConfirm={showMetadataConfirm}
        metadataExistingCount={metadataExistingCount}
        showSingleMetadataModal={showSingleMetadataModal}
        singleMetadataSender={singleMetadataSender}
        singleMetadataRecipient={singleMetadataRecipient}
        singleMetadataSubmitting={singleMetadataSubmitting}
        singleMetadataMode={singleMetadataMode}
        singleMetadataLetterTitle={singleSelectedLetter?.title}
        onConfirmDelete={handleConfirmDelete}
        onCancelDelete={handleCancelDelete}
        onConfirmClearTranscriptions={handleConfirmClearTranscriptions}
        onCancelClearTranscriptions={() => setShowResetModal(false)}
        onConfirmClearMetadata={handleConfirmClearMetadata}
        onCancelClearMetadata={() => setShowClearMetadataModal(false)}
        onConfirmUnverified={handleConfirmUnverified}
        onCancelUnverified={() => setShowUnconfirmedDialog(false)}
        onCancelTranscribe={() => setShowTranscribeConfirm(false)}
        onStartTranscription={(skipExisting) => {
          setShowTranscribeConfirm(false);
          void handleStartTranscription(skipExisting);
        }}
        onCancelMetadata={() => setShowMetadataConfirm(false)}
        onStartMetadataExtraction={(skipConfirmation, skipExisting) => {
          setShowMetadataConfirm(false);
          void handleStartMetadataExtraction(skipConfirmation, skipExisting);
        }}
        onCloseSingleMetadata={() => setShowSingleMetadataModal(false)}
        onConfirmSingleMetadata={() => void handleSingleMetadataExtraction()}
        onSingleMetadataSenderChange={setSingleMetadataSender}
        onSingleMetadataRecipientChange={setSingleMetadataRecipient}
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
