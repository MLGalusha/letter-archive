import IdentityExtractionModal from "../../../components/admin/IdentityExtractionModal";
import { ConfirmDialog } from "../../../components/common";
import ProcessingConfirmDialog from "./ProcessingConfirmDialog";
import type { useDashboardBulkActions } from "./useDashboardBulkActions";
import type { useDashboardProcessingActions } from "./useDashboardProcessingActions";

interface DashboardDialogsProps {
  selectedCount: number;
  singleMetadataLetterTitle?: string;
  bulkActions: ReturnType<typeof useDashboardBulkActions>;
  processingActions: ReturnType<typeof useDashboardProcessingActions>;
}

export default function DashboardDialogs({
  selectedCount,
  singleMetadataLetterTitle,
  bulkActions,
  processingActions,
}: DashboardDialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={bulkActions.showDeleteModal}
        title="Delete Letters"
        message={`Are you sure you want to delete ${selectedCount} letter${selectedCount === 1 ? "" : "s"}?`}
        confirmText={bulkActions.deleting ? "Deleting..." : "Delete"}
        variant="danger"
        loading={bulkActions.deleting}
        onConfirm={bulkActions.handleConfirmDelete}
        onCancel={bulkActions.handleCancelDelete}
      />

      <ConfirmDialog
        isOpen={bulkActions.showResetModal}
        title="Clear Transcriptions"
        message={`This will clear all transcriptions (including extra content), metadata, and entity links for ${selectedCount} letter${selectedCount === 1 ? "" : "s"}, returning them to UPLOADED state. You will need to re-transcribe them.`}
        confirmText={bulkActions.bulkActionLoading ? "Clearing..." : "Clear Transcriptions"}
        loading={bulkActions.bulkActionLoading}
        onConfirm={bulkActions.handleConfirmClearTranscriptions}
        onCancel={() => bulkActions.setShowResetModal(false)}
      />

      <ConfirmDialog
        isOpen={bulkActions.showClearMetadataModal}
        title="Clear Metadata"
        message={`This will clear all metadata, entity links, and extracted entities for ${selectedCount} letter${selectedCount === 1 ? "" : "s"}. The transcriptions will be kept intact.`}
        confirmText={bulkActions.bulkActionLoading ? "Clearing..." : "Clear Metadata"}
        loading={bulkActions.bulkActionLoading}
        onConfirm={bulkActions.handleConfirmClearMetadata}
        onCancel={() => bulkActions.setShowClearMetadataModal(false)}
      />

      {processingActions.showTranscribeConfirm && (
        <ProcessingConfirmDialog
          title="Transcribe Letters"
          selectedCount={selectedCount}
          existingCount={processingActions.transcribeExistingCount}
          existingSingularText="a transcript"
          existingPluralText="transcripts"
          emptyActionText="Transcribe"
          confirmText="Transcribe"
          skipActionText="Skip Existing"
          overwriteActionText="Overwrite All"
          onCancel={() => processingActions.setShowTranscribeConfirm(false)}
          onConfirm={() => {
            processingActions.setShowTranscribeConfirm(false);
            void processingActions.handleStartTranscription();
          }}
          onSkipExisting={() => {
            processingActions.setShowTranscribeConfirm(false);
            void processingActions.handleStartTranscription(true);
          }}
          onOverwriteAll={() => {
            processingActions.setShowTranscribeConfirm(false);
            void processingActions.handleStartTranscription(false);
          }}
        />
      )}

      {processingActions.showMetadataConfirm && (
        <ProcessingConfirmDialog
          title="Extract Metadata"
          selectedCount={selectedCount}
          existingCount={processingActions.metadataExistingCount}
          existingSingularText="metadata"
          existingPluralText="metadata"
          emptyActionText="Extract metadata for"
          confirmText="Extract"
          skipActionText="Skip Existing"
          overwriteActionText="Overwrite All"
          onCancel={() => processingActions.setShowMetadataConfirm(false)}
          onConfirm={() => {
            processingActions.setShowMetadataConfirm(false);
            void processingActions.handleStartMetadataExtraction();
          }}
          onSkipExisting={() => {
            processingActions.setShowMetadataConfirm(false);
            void processingActions.handleStartMetadataExtraction(true);
          }}
          onOverwriteAll={() => {
            processingActions.setShowMetadataConfirm(false);
            void processingActions.handleStartMetadataExtraction();
          }}
        />
      )}

      <IdentityExtractionModal
        isOpen={processingActions.showSingleMetadataModal}
        onClose={() => processingActions.setShowSingleMetadataModal(false)}
        onConfirm={() => void processingActions.handleSingleMetadataExtraction()}
        sender={processingActions.singleMetadataSender}
        recipient={processingActions.singleMetadataRecipient}
        onSenderChange={processingActions.setSingleMetadataSender}
        onRecipientChange={processingActions.setSingleMetadataRecipient}
        submitting={processingActions.singleMetadataSubmitting}
        mode={processingActions.singleMetadataMode}
        letterTitle={singleMetadataLetterTitle}
      />
    </>
  );
}
