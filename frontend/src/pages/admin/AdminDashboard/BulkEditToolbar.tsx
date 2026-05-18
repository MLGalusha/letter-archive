import type { ProcessingStatus } from "../../../api/admin";
import Icon from "../../../components/common/Icon";
import BulkCopyControls from "./BulkCopyControls";
import BulkDestructiveControls from "./BulkDestructiveControls";
import BulkProcessingControls from "./BulkProcessingControls";
import BulkPublishingMenu from "./BulkPublishingMenu";
import BulkSelectionControls from "./BulkSelectionControls";
import type { PublishCounts } from "./useDashboardSelectionDetails";

export interface BulkSelectionToolbarModel {
  selectedCount: number;
  pageCount: number;
  totalCount: number;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  onSelectPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}

export interface BulkCopyToolbarModel {
  copyModeActive: boolean;
  copiedValue: string | null;
  sourceCell: { letterId: string; column: "sender" | "recipient" } | null;
  pendingChangesCount: number;
  isSaving: boolean;
  onToggleCopyMode: () => void;
}

export interface BulkProcessingToolbarModel {
  processingStatus: ProcessingStatus | null;
  pausePending: boolean;
  abortPending: boolean;
  onOpenTranscription: () => void;
  onOpenMetadataExtraction: () => void;
  onPauseProcessing: () => void;
  onResumeProcessing: () => void;
  onAbortProcessing: () => void;
}

export interface BulkPublishingToolbarModel {
  bulkActionLoading: boolean;
  publishCounts: PublishCounts;
  onBulkHide: () => void;
  onBulkPublish: () => void;
  onBulkContentVisibility: (field: "transcriptPublished" | "metadataPublished", value: boolean) => void;
}

export interface BulkDangerToolbarModel {
  bulkActionLoading: boolean;
  onClearTranscriptions: () => void;
  onClearMetadata: () => void;
  onDelete: () => void;
}

export interface BulkCompletionToolbarModel {
  pendingChangesCount: number;
  isSaving: boolean;
  onDone: () => void;
  onExit: () => void;
}

interface BulkEditToolbarProps {
  selection: BulkSelectionToolbarModel;
  copy: BulkCopyToolbarModel;
  processing: BulkProcessingToolbarModel;
  publishing: BulkPublishingToolbarModel;
  danger: BulkDangerToolbarModel;
  completion: BulkCompletionToolbarModel;
}

export default function BulkEditToolbar({
  selection,
  copy,
  processing,
  publishing,
  danger,
  completion,
}: BulkEditToolbarProps) {
  return (
    <div className="edit-toolbar visible">
      <div className="edit-toolbar-content">
        <div className="edit-toolbar-left">
          <div className="toolbar-section toolbar-section--selection">
            <span className="toolbar-section-label">Selection</span>
            <BulkSelectionControls
              selectedCount={selection.selectedCount}
              pageCount={selection.pageCount}
              totalCount={selection.totalCount}
              allPageSelected={selection.allPageSelected}
              allFilteredSelected={selection.allFilteredSelected}
              onSelectPage={selection.onSelectPage}
              onSelectAllFiltered={selection.onSelectAllFiltered}
              onClearSelection={selection.onClearSelection}
            />
          </div>
          <div className="toolbar-section toolbar-section--copy">
            <span className="toolbar-section-label">Edit</span>
            <BulkCopyControls
              copyModeActive={copy.copyModeActive}
              copiedValue={copy.copiedValue}
              sourceCell={copy.sourceCell}
              pendingChangesCount={copy.pendingChangesCount}
              isSaving={copy.isSaving}
              onToggleCopyMode={copy.onToggleCopyMode}
            />
          </div>
        </div>

        <div className="edit-toolbar-center">
          <div className="toolbar-section toolbar-section--processing">
            <span className="toolbar-section-label">Process</span>
            <BulkProcessingControls
              selectedCount={selection.selectedCount}
              processingStatus={processing.processingStatus}
              pausePending={processing.pausePending}
              abortPending={processing.abortPending}
              onOpenTranscription={processing.onOpenTranscription}
              onOpenMetadataExtraction={processing.onOpenMetadataExtraction}
              onPauseProcessing={processing.onPauseProcessing}
              onResumeProcessing={processing.onResumeProcessing}
              onAbortProcessing={processing.onAbortProcessing}
            />
          </div>
        </div>

        <div className="edit-toolbar-right">
          <div className="toolbar-section toolbar-section--publishing">
            <span className="toolbar-section-label">Publish</span>
            <BulkPublishingMenu
              selectedCount={selection.selectedCount}
              bulkActionLoading={publishing.bulkActionLoading}
              publishCounts={publishing.publishCounts}
              onBulkHide={publishing.onBulkHide}
              onBulkPublish={publishing.onBulkPublish}
              onBulkContentVisibility={publishing.onBulkContentVisibility}
            />
          </div>
          <div className="toolbar-section toolbar-section--danger">
            <span className="toolbar-section-label">Danger</span>
            <BulkDestructiveControls
              selectedCount={selection.selectedCount}
              bulkActionLoading={danger.bulkActionLoading}
              onClearTranscriptions={danger.onClearTranscriptions}
              onClearMetadata={danger.onClearMetadata}
              onDelete={danger.onDelete}
            />
          </div>
          {completion.pendingChangesCount > 0 ? (
            <button className="toolbar-done-btn" onClick={completion.onDone} disabled={completion.isSaving}>
              {completion.isSaving ? "Saving..." : "Save & Close"}
            </button>
          ) : (
            <button className="toolbar-close-btn" onClick={completion.onExit} title="Clear selection">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
