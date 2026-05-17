import IdentityExtractionModal from "../../../components/admin/IdentityExtractionModal";
import { Button, ConfirmDialog } from "../../../components/common";

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
        <div className="modal-overlay" onClick={onCancelTranscribe}>
          <div className="modal-content modal-sm confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <h2 className="confirm-dialog-title">Transcribe Letters</h2>
            <div className="confirm-dialog-message">
              {transcribeExistingCount > 0 && selectedCount > 0 ? (
                <p>
                  {transcribeExistingCount} of {selectedCount} selected letter{selectedCount === 1 ? "" : "s"} already
                  {transcribeExistingCount === 1 ? " has a" : " have"} transcript{transcribeExistingCount === 1 ? "" : "s"}.
                  Would you like to overwrite existing transcripts or skip them?
                </p>
              ) : (
                <p>Transcribe {selectedCount > 0 ? `${selectedCount} selected` : "all"} letter{selectedCount === 1 ? "" : "s"}?</p>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <Button variant="secondary" onClick={onCancelTranscribe}>Cancel</Button>
              {transcribeExistingCount > 0 && selectedCount > 0 ? (
                <>
                  <Button variant="secondary" onClick={() => onStartTranscription(true)}>
                    Skip Existing ({selectedCount - transcribeExistingCount})
                  </Button>
                  <Button variant="primary" onClick={() => onStartTranscription(false)}>
                    Overwrite All ({selectedCount})
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => onStartTranscription()}>
                  Transcribe
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {showMetadataConfirm && (
        <div className="modal-overlay" onClick={onCancelMetadata}>
          <div className="modal-content modal-sm confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <h2 className="confirm-dialog-title">Extract Metadata</h2>
            <div className="confirm-dialog-message">
              {metadataExistingCount > 0 && selectedCount > 0 ? (
                <p>
                  {metadataExistingCount} of {selectedCount} selected letter{selectedCount === 1 ? "" : "s"} already
                  {metadataExistingCount === 1 ? " has" : " have"} metadata.
                  Would you like to overwrite existing metadata or skip them?
                </p>
              ) : (
                <p>Extract metadata for {selectedCount > 0 ? `${selectedCount} selected` : "all"} letter{selectedCount === 1 ? "" : "s"}?</p>
              )}
            </div>
            <div className="confirm-dialog-actions">
              <Button variant="secondary" onClick={onCancelMetadata}>Cancel</Button>
              {metadataExistingCount > 0 && selectedCount > 0 ? (
                <>
                  <Button variant="secondary" onClick={() => onStartMetadataExtraction(false, true)}>
                    Skip Existing ({selectedCount - metadataExistingCount})
                  </Button>
                  <Button variant="primary" onClick={() => onStartMetadataExtraction()}>
                    Overwrite All ({selectedCount})
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => onStartMetadataExtraction()}>
                  Extract
                </Button>
              )}
            </div>
          </div>
        </div>
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
