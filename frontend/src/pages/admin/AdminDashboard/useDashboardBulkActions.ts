import { useState } from "react";
import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkUpdateContentVisibility,
} from "../../../api/admin";
import { deleteLetter } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";

interface UseDashboardBulkActionsOptions {
  selectedIds: Set<string>;
  exitEditMode: () => void;
  fetchLetters: () => Promise<void>;
}

export function useDashboardBulkActions({
  selectedIds,
  exitEditMode,
  fetchLetters,
}: UseDashboardBulkActionsOptions) {
  const { showToast } = useToast();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showClearMetadataModal, setShowClearMetadataModal] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const handleDeleteClick = () => {
    if (selectedIds.size > 0) {
      setShowDeleteModal(true);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    const count = selectedIds.size;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteLetter(id)));
      exitEditMode();
      setShowDeleteModal(false);

      showToast(`Deleted ${count} letter${count === 1 ? "" : "s"}`, "success");
      await fetchLetters();
    } catch (err) {
      console.error("Failed to delete letters:", err);
      showToast(err instanceof Error ? err.message : "Failed to delete letters", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
  };

  const handleClearTranscriptionsClick = () => {
    if (selectedIds.size > 0) {
      setShowResetModal(true);
    }
  };

  const handleConfirmClearTranscriptions = async () => {
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkClearTranscriptions(Array.from(selectedIds));
      exitEditMode();
      setShowResetModal(false);
      showToast(`Cleared transcriptions for ${count} letter${count === 1 ? "" : "s"}`, "success");
      await fetchLetters();
    } catch (err) {
      console.error("Failed to clear transcriptions:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear transcriptions", "error");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleClearMetadataClick = () => {
    if (selectedIds.size > 0) {
      setShowClearMetadataModal(true);
    }
  };

  const handleConfirmClearMetadata = async () => {
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkClearMetadata(Array.from(selectedIds));
      exitEditMode();
      setShowClearMetadataModal(false);
      showToast(`Cleared metadata for ${count} letter${count === 1 ? "" : "s"}`, "success");
      await fetchLetters();
    } catch (err) {
      console.error("Failed to clear metadata:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear metadata", "error");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkPublish = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkUpdateContentVisibility(Array.from(selectedIds), { visibility: "PUBLISHED" });
      showToast(`Published ${count} letter${count === 1 ? "" : "s"}`, "success");
      await fetchLetters();
    } catch (err) {
      console.error("Failed to publish:", err);
      showToast(err instanceof Error ? err.message : "Failed to publish letters", "error");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkHide = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const count = selectedIds.size;
    try {
      await bulkUpdateContentVisibility(Array.from(selectedIds), { visibility: "HIDDEN" });
      showToast(`Hid ${count} letter${count === 1 ? "" : "s"}`, "success");
      await fetchLetters();
    } catch (err) {
      console.error("Failed to hide:", err);
      showToast(err instanceof Error ? err.message : "Failed to hide letters", "error");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkContentVisibility = async (
    field: "transcriptPublished" | "metadataPublished",
    value: boolean,
  ) => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const count = selectedIds.size;
    const label = field === "transcriptPublished" ? "transcript" : "metadata";
    try {
      await bulkUpdateContentVisibility(Array.from(selectedIds), { [field]: value });
      showToast(
        `${value ? "Published" : "Hid"} ${label} for ${count} letter${count === 1 ? "" : "s"}`,
        "success",
      );
      await fetchLetters();
    } catch (err) {
      console.error(`Failed to update ${label} visibility:`, err);
      showToast(err instanceof Error ? err.message : `Failed to update ${label} visibility`, "error");
    } finally {
      setBulkActionLoading(false);
    }
  };

  return {
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
  };
}
