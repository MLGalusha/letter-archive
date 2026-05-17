import IdentityExtractionModal from "../../../components/admin/IdentityExtractionModal";
import { ConfirmDialog } from "../../../components/common";
import ProcessingConfirmDialog from "./ProcessingConfirmDialog";

type SingleMetadataMode = "extract" | "regenerate";

interface DashboardDialogsProps {
  selectedCount: number;
  deleting: boolean;
  bulkActionLoading: boolean;
  showDeleteModal: boolean;
  showResetModal: boolean;
  showClearMetadataModal: boolean;
  showUnconfirmedDialog: boolean;
  unconfirmedCount: number;
  showTranscribeConfirm: boolean;
  transcribeExistingCount: number;
  showMetadataConfirm: boolean;
  metadataExistingCount: number;
  showSingleMetadataModal: boolean;
  singleMetadataSender: string;
  singleMetadataRecipient: string;
  singleMetadataSubmitting: boolean;
  singleMetadataMode: SingleMetadataMode;
  singleMetadataLetterTitle?: string;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onConfirmClearTranscriptions: () => void;
  onCancelClearTranscriptions: () => void;
  onConfirmClearMetadata: () => void;
  onCancelClearMetadata: () => void;
  onConfirmUnverified: () => void;
  onCancelUnverified: () => void;
  onCancelTranscribe: () => void;
  onStartTranscription: (skipExisting?: boolean) => void;
  onCancelMetadata: () => void;
  onStartMetadataExtraction: (skipConfirmation?: boolean, skipExisting?: boolean) => void;
  onCloseSingleMetadata: () => void;
  onConfirmSingleMetadata: () => void;
  onSingleMetadataSenderChange: (value: string) => void;
  onSingleMetadataRecipientChange: (value: string) => void;
}

export default function DashboardDialogs({
  selectedCount,
  deleting,
  bulkActionLoading,
  showDeleteModal,
  showResetModal,
  showClearMetadataModal,
  showUnconfirmedDialog,
  unconfirmedCount,
  showTranscribeConfirm,
  transcribeExistingCount,
  showMetadataConfirm,
  metadataExistingCount,
  showSingleMetadataModal,
  singleMetadataSender,
  singleMetadataRecipient,
  singleMetadataSubmitting,
  singleMetadataMode,
  singleMetadataLetterTitle,
  onConfirmDelete,
  onCancelDelete,
  onConfirmClearTranscriptions,
  onCancelClearTranscriptions,
  onConfirmClearMetadata,
  onCancelClearMetadata,
  onConfirmUnverified,
  onCancelUnverified,
  onCancelTranscribe,
  onStartTranscription,
  onCancelMetadata,
  onStartMetadataExtraction,
  onCloseSingleMetadata,
  onConfirmSingleMetadata,
  onSingleMetadataSenderChange,
  onSingleMetadataRecipientChange,
}: DashboardDialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={showDeleteModal}
        title="Delete Letters"
        message={`Are you sure you want to delete ${selectedCount} letter${selectedCount === 1 ? "" : "s"}?`}
        confirmText={deleting ? "Deleting..." : "Delete"}
        variant="danger"
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />

      <ConfirmDialog
        isOpen={showResetModal}
        title="Clear Transcriptions"
        message={`This will clear all transcriptions (including extra content), metadata, and entity links for ${selectedCount} letter${selectedCount === 1 ? "" : "s"}, returning them to UPLOADED state. You will need to re-transcribe them.`}
        confirmText={bulkActionLoading ? "Clearing..." : "Clear Transcriptions"}
        loading={bulkActionLoading}
        onConfirm={onConfirmClearTranscriptions}
        onCancel={onCancelClearTranscriptions}
      />

      <ConfirmDialog
        isOpen={showClearMetadataModal}
        title="Clear Metadata"
        message={`This will clear all metadata, entity links, and extracted entities for ${selectedCount} letter${selectedCount === 1 ? "" : "s"}. The transcriptions will be kept intact.`}
        confirmText={bulkActionLoading ? "Clearing..." : "Clear Metadata"}
        loading={bulkActionLoading}
        onConfirm={onConfirmClearMetadata}
        onCancel={onCancelClearMetadata}
      />

      <ConfirmDialog
        isOpen={showUnconfirmedDialog}
        title="Unverified Transcripts"
        message={`${unconfirmedCount} of the selected letter${unconfirmedCount === 1 ? " has an" : "s have"} unverified transcript${unconfirmedCount === 1 ? "" : "s"}. Metadata extraction may be less accurate without verified transcripts. Do you want to proceed anyway?`}
        confirmText="Extract Anyway"
        onConfirm={onConfirmUnverified}
        onCancel={onCancelUnverified}
      />

      {showTranscribeConfirm && (
        <ProcessingConfirmDialog
          title="Transcribe Letters"
          selectedCount={selectedCount}
          existingCount={transcribeExistingCount}
          existingSingularText="a transcript"
          existingPluralText="transcripts"
          emptyActionText="Transcribe"
          confirmText="Transcribe"
          skipActionText="Skip Existing"
          overwriteActionText="Overwrite All"
          onCancel={onCancelTranscribe}
          onConfirm={() => onStartTranscription()}
          onSkipExisting={() => onStartTranscription(true)}
          onOverwriteAll={() => onStartTranscription(false)}
        />
      )}

      {showMetadataConfirm && (
        <ProcessingConfirmDialog
          title="Extract Metadata"
          selectedCount={selectedCount}
          existingCount={metadataExistingCount}
          existingSingularText="metadata"
          existingPluralText="metadata"
          emptyActionText="Extract metadata for"
          confirmText="Extract"
          skipActionText="Skip Existing"
          overwriteActionText="Overwrite All"
          onCancel={onCancelMetadata}
          onConfirm={() => onStartMetadataExtraction()}
          onSkipExisting={() => onStartMetadataExtraction(false, true)}
          onOverwriteAll={() => onStartMetadataExtraction()}
        />
      )}

      <IdentityExtractionModal
        isOpen={showSingleMetadataModal}
        onClose={onCloseSingleMetadata}
        onConfirm={onConfirmSingleMetadata}
        sender={singleMetadataSender}
        recipient={singleMetadataRecipient}
        onSenderChange={onSingleMetadataSenderChange}
        onRecipientChange={onSingleMetadataRecipientChange}
        submitting={singleMetadataSubmitting}
        mode={singleMetadataMode}
        letterTitle={singleMetadataLetterTitle}
      />
    </>
  );
}
