import type { ReactNode } from "react";
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

interface ToolbarSectionProps {
  label: string;
  modifier: string;
  children: ReactNode;
}

function ToolbarSection({ label, modifier, children }: ToolbarSectionProps) {
  return (
    <section className={`toolbar-section toolbar-section--${modifier}`} aria-label={`${label} actions`}>
      <span className="toolbar-section-label">{label}</span>
      <div className="toolbar-section-controls">{children}</div>
    </section>
  );
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
    <div className="edit-toolbar visible" role="region" aria-label="Bulk actions">
      <div className="edit-toolbar-content">
        <div className="edit-toolbar-left">
          <ToolbarSection label="Selection" modifier="selection">
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
          </ToolbarSection>
          <ToolbarSection label="Edit" modifier="copy">
            <BulkCopyControls
              copyModeActive={copy.copyModeActive}
              copiedValue={copy.copiedValue}
              sourceCell={copy.sourceCell}
              pendingChangesCount={copy.pendingChangesCount}
              isSaving={copy.isSaving}
              onToggleCopyMode={copy.onToggleCopyMode}
            />
          </ToolbarSection>
        </div>

        <div className="edit-toolbar-center">
          <ToolbarSection label="Process" modifier="processing">
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
          </ToolbarSection>
        </div>

        <div className="edit-toolbar-right">
          <ToolbarSection label="Publish" modifier="publishing">
            <BulkPublishingMenu
              selectedCount={selection.selectedCount}
              bulkActionLoading={publishing.bulkActionLoading}
              publishCounts={publishing.publishCounts}
              onBulkHide={publishing.onBulkHide}
              onBulkPublish={publishing.onBulkPublish}
              onBulkContentVisibility={publishing.onBulkContentVisibility}
            />
          </ToolbarSection>
          <ToolbarSection label="Danger" modifier="danger">
            <BulkDestructiveControls
              selectedCount={selection.selectedCount}
              bulkActionLoading={danger.bulkActionLoading}
              onClearTranscriptions={danger.onClearTranscriptions}
              onClearMetadata={danger.onClearMetadata}
              onDelete={danger.onDelete}
            />
          </ToolbarSection>
          <div className="toolbar-completion-actions">
            {completion.pendingChangesCount > 0 ? (
              <button type="button" className="toolbar-done-btn" onClick={completion.onDone} disabled={completion.isSaving}>
                {completion.isSaving ? "Saving..." : "Save & Close"}
              </button>
            ) : (
              <button type="button" className="toolbar-close-btn" onClick={completion.onExit} aria-label="Clear selection" title="Clear selection">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
