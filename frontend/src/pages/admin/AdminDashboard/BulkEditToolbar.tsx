import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";
import BulkCopyControls from "./BulkCopyControls";
import BulkDestructiveControls from "./BulkDestructiveControls";
import BulkProcessingControls from "./BulkProcessingControls";
import BulkPublishingMenu from "./BulkPublishingMenu";
import BulkSelectionControls from "./BulkSelectionControls";
import type { PublishCounts } from "./useDashboardSelectionDetails";

interface BulkEditToolbarProps {
  selectedCount: number;
  pageCount: number;
  totalCount: number;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  copyModeActive: boolean;
  copiedValue: string | null;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChangesCount: number;
  isSaving: boolean;
  bulkActionLoading: boolean;
  processingStatus: ProcessingStatus | null;
  pausePending: boolean;
  abortPending: boolean;
  publishCounts: PublishCounts;
  onSelectPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onToggleCopyMode: () => void;
  onOpenTranscription: () => void;
  onOpenMetadataExtraction: () => void;
  onPauseProcessing: () => void;
  onResumeProcessing: () => void;
  onAbortProcessing: () => void;
  onBulkHide: () => void;
  onBulkPublish: () => void;
  onBulkContentVisibility: (field: "transcriptPublished" | "metadataPublished", value: boolean) => void;
  onClearTranscriptions: () => void;
  onClearMetadata: () => void;
  onDelete: () => void;
  onDone: () => void;
  onExit: () => void;
}

export default function BulkEditToolbar({
  selectedCount,
  pageCount,
  totalCount,
  allPageSelected,
  allFilteredSelected,
  copyModeActive,
  copiedValue,
  sourceCell,
  pendingChangesCount,
  isSaving,
  bulkActionLoading,
  processingStatus,
  pausePending,
  abortPending,
  publishCounts,
  onSelectPage,
  onSelectAllFiltered,
  onClearSelection,
  onToggleCopyMode,
  onOpenTranscription,
  onOpenMetadataExtraction,
  onPauseProcessing,
  onResumeProcessing,
  onAbortProcessing,
  onBulkHide,
  onBulkPublish,
  onBulkContentVisibility,
  onClearTranscriptions,
  onClearMetadata,
  onDelete,
  onDone,
  onExit,
}: BulkEditToolbarProps) {
  return (
    <div className="edit-toolbar visible">
      <div className="edit-toolbar-content">
        <div className="edit-toolbar-left">
          <BulkSelectionControls
            selectedCount={selectedCount}
            pageCount={pageCount}
            totalCount={totalCount}
            allPageSelected={allPageSelected}
            allFilteredSelected={allFilteredSelected}
            onSelectPage={onSelectPage}
            onSelectAllFiltered={onSelectAllFiltered}
            onClearSelection={onClearSelection}
          />
          <div className="toolbar-divider" />
          <BulkCopyControls
            copyModeActive={copyModeActive}
            copiedValue={copiedValue}
            sourceCell={sourceCell}
            pendingChangesCount={pendingChangesCount}
            isSaving={isSaving}
            onToggleCopyMode={onToggleCopyMode}
          />
        </div>

        <div className="edit-toolbar-center">
          <BulkProcessingControls
            selectedCount={selectedCount}
            processingStatus={processingStatus}
            pausePending={pausePending}
            abortPending={abortPending}
            onOpenTranscription={onOpenTranscription}
            onOpenMetadataExtraction={onOpenMetadataExtraction}
            onPauseProcessing={onPauseProcessing}
            onResumeProcessing={onResumeProcessing}
            onAbortProcessing={onAbortProcessing}
          />
        </div>

        <div className="edit-toolbar-right">
          <BulkPublishingMenu
            selectedCount={selectedCount}
            bulkActionLoading={bulkActionLoading}
            publishCounts={publishCounts}
            onBulkHide={onBulkHide}
            onBulkPublish={onBulkPublish}
            onBulkContentVisibility={onBulkContentVisibility}
          />
          <div className="toolbar-divider" />
          <BulkDestructiveControls
            selectedCount={selectedCount}
            bulkActionLoading={bulkActionLoading}
            onClearTranscriptions={onClearTranscriptions}
            onClearMetadata={onClearMetadata}
            onDelete={onDelete}
          />
          <div className="toolbar-divider" />
          {pendingChangesCount > 0 ? (
            <button className="toolbar-done-btn" onClick={onDone} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save & Close"}
            </button>
          ) : (
            <button className="toolbar-close-btn" onClick={onExit} title="Clear selection">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
