import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkUpdateContentVisibility,
  type BulkClearResponse,
  type BulkContentVisibilityAction,
  type BulkContentVisibilityResponse,
  type BulkPublicationSource,
  type BulkSourceSkip,
} from "../../../api/admin";
import {
  ApiError,
  SOURCE_REVISION_CHANGED_ERROR_CODE,
} from "../../../api/client";
import { deleteLetter } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";
import {
  includeUnobservedSelections,
  summarizeSourceSkips,
} from "./sourceBoundBulk";

interface UseDashboardBulkActionsOptions {
  selectedIds: Set<string>;
  selectedSources: BulkPublicationSource[];
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  exitEditMode: () => void;
  fetchLetters: () => Promise<void>;
}

function deletionSkipReason(
  letterId: string,
  error: unknown,
): BulkSourceSkip {
  if (
    error instanceof ApiError
    && error.code === SOURCE_REVISION_CHANGED_ERROR_CODE
  ) {
    return {
      letterId,
      code: "SOURCE_CHANGED",
      reason: "Letter source changed; refresh and reselect",
    };
  }
  if (error instanceof ApiError && error.status === 404) {
    return {
      letterId,
      code: "NOT_FOUND",
      reason: "Letter no longer exists",
    };
  }
  return {
    letterId,
    code: "MUTATION_FAILED",
    reason: "Deletion outcome could not be confirmed; refresh before retrying",
  };
}

export function useDashboardBulkActions({
  selectedIds,
  selectedSources,
  setSelectedIds,
  exitEditMode,
  fetchLetters,
}: UseDashboardBulkActionsOptions) {
  const { showToast } = useToast();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showClearMetadataModal, setShowClearMetadataModal] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const applySourceBoundClear = async (
    clear: (sources: BulkPublicationSource[]) => Promise<BulkClearResponse>,
  ): Promise<BulkClearResponse> => {
    const mutation = selectedSources.length > 0
      ? await clear(selectedSources)
      : {
          requested: 0,
          applied: 0,
          skipped: 0,
          skipReasons: [],
        };
    return includeUnobservedSelections(
      mutation,
      selectedIds,
      selectedSources,
    );
  };

  const reportBulkClearResult = (
    result: BulkClearResponse,
    content: "transcriptions" | "metadata",
  ) => {
    const success = `Cleared ${content} for ${result.applied} letter${result.applied === 1 ? "" : "s"}`;
    if (result.skipped === 0) {
      showToast(success, "success");
      return;
    }
    showToast(
      `${success}. Skipped: ${summarizeSourceSkips(result.skipReasons)}`,
      result.applied > 0 ? "info" : "error",
    );
  };

  const reportBulkVisibilityResult = (
    result: BulkContentVisibilityResponse,
    success: string,
  ) => {
    if (result.skipped === 0) {
      showToast(success, "success");
      return;
    }
    const missing = result.skipReasons.filter(
      ({ code }) => code === "NOT_FOUND",
    ).length;
    const changedOrIneligible = result.skipReasons.filter(
      ({ code }) => code === "SOURCE_CHANGED_OR_INELIGIBLE",
    ).length;
    const failed = result.skipReasons.filter(
      ({ code }) => code === "MUTATION_FAILED",
    ).length;
    const unobserved = result.skipReasons.filter(
      ({ code }) => code === "SOURCE_NOT_OBSERVED",
    ).length;
    const reasons = [
      changedOrIneligible > 0
        ? `${changedOrIneligible} because the content changed or is no longer eligible`
        : null,
      missing > 0
        ? `${missing} because ${missing === 1 ? "it no longer exists" : "they no longer exist"}`
        : null,
      failed > 0
        ? `${failed} because ${failed === 1 ? "its update failed" : "their updates failed"}`
        : null,
      unobserved > 0
        ? `${unobserved} because ${unobserved === 1 ? "its source version was not loaded" : "their source versions were not loaded"}`
        : null,
    ].filter((reason): reason is string => reason !== null);

    showToast(
      `${success}; skipped ${reasons.join(" and ")}`,
      result.applied > 0 ? "info" : "error",
    );
  };

  const applyContentVisibilityAction = async (
    action: BulkContentVisibilityAction,
  ): Promise<BulkContentVisibilityResponse> => {
    const observedIds = new Set(selectedSources.map(({ letterId }) => letterId));
    const mutation = selectedSources.length > 0
      ? await bulkUpdateContentVisibility(selectedSources, action)
      : {
          requested: 0,
          applied: 0,
          skipped: 0,
          skipReasons: [],
        };
    const missingReasons = Array.from(selectedIds)
      .filter((letterId) => !observedIds.has(letterId))
      .map((letterId) => ({
      letterId,
      code: "SOURCE_NOT_OBSERVED" as const,
    }));

    return {
      requested: selectedIds.size,
      applied: mutation.applied,
      skipped: mutation.skipped + missingReasons.length,
      skipReasons: [...mutation.skipReasons, ...missingReasons],
    };
  };

  const refreshAfterVisibilityAttempt = async () => {
    try {
      await fetchLetters();
    } catch (err) {
      console.error("Failed to refresh letters after visibility update:", err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedIds.size > 0) {
      setShowDeleteModal(true);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      const attempts = await Promise.all(selectedSources.map(async ({
        letterId,
        primarySourceRevision,
      }) => {
        try {
          await deleteLetter(letterId, primarySourceRevision);
          return null;
        } catch (error) {
          console.error(`Failed to delete letter ${letterId}:`, error);
          return deletionSkipReason(letterId, error);
        }
      }));
      const observedSkips = attempts.filter(
        (reason): reason is BulkSourceSkip => reason !== null,
      );
      const result = includeUnobservedSelections({
        requested: selectedSources.length,
        applied: selectedSources.length - observedSkips.length,
        skipped: observedSkips.length,
        skipReasons: observedSkips,
      }, selectedIds, selectedSources);

      setShowDeleteModal(false);
      if (result.skipped === 0) {
        exitEditMode();
        showToast(
          `Deleted ${result.applied} letter${result.applied === 1 ? "" : "s"}`,
          "success",
        );
      } else {
        setSelectedIds(new Set(
          result.skipReasons.map(({ letterId }) => letterId),
        ));
        showToast(
          `Deleted ${result.applied} letter${result.applied === 1 ? "" : "s"}. Skipped: ${summarizeSourceSkips(result.skipReasons)}`,
          result.applied > 0 ? "info" : "error",
        );
      }
    } catch (err) {
      console.error("Failed to delete letters:", err);
      showToast(err instanceof Error ? err.message : "Failed to delete letters", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after deletion:", err);
      }
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
    try {
      const result = await applySourceBoundClear(bulkClearTranscriptions);
      setShowResetModal(false);
      reportBulkClearResult(result, "transcriptions");
      if (result.skipped === 0) exitEditMode();
    } catch (err) {
      console.error("Failed to clear transcriptions:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear transcriptions", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after clearing transcriptions:", err);
      }
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
    try {
      const result = await applySourceBoundClear(bulkClearMetadata);
      setShowClearMetadataModal(false);
      reportBulkClearResult(result, "metadata");
      if (result.skipped === 0) exitEditMode();
    } catch (err) {
      console.error("Failed to clear metadata:", err);
      showToast(err instanceof Error ? err.message : "Failed to clear metadata", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after clearing metadata:", err);
      }
      setBulkActionLoading(false);
    }
  };

  const handleBulkPublish = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      const result = await applyContentVisibilityAction("PUBLISH_LETTER");
      reportBulkVisibilityResult(
        result,
        `Published ${result.applied} letter${result.applied === 1 ? "" : "s"}`,
      );
    } catch (err) {
      console.error("Failed to publish:", err);
      showToast(err instanceof Error ? err.message : "Failed to publish letters", "error");
    } finally {
      await refreshAfterVisibilityAttempt();
    }
  };

  const handleBulkHide = async () => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    try {
      const result = await applyContentVisibilityAction("HIDE_LETTER");
      reportBulkVisibilityResult(
        result,
        `Hid ${result.applied} letter${result.applied === 1 ? "" : "s"}`,
      );
    } catch (err) {
      console.error("Failed to hide:", err);
      showToast(err instanceof Error ? err.message : "Failed to hide letters", "error");
    } finally {
      await refreshAfterVisibilityAttempt();
    }
  };

  const handleBulkContentVisibility = async (
    field: "transcriptPublished" | "metadataPublished",
    value: boolean,
  ) => {
    if (selectedIds.size === 0) return;
    setBulkActionLoading(true);
    const label = field === "transcriptPublished" ? "transcript" : "metadata";
    try {
      const action = field === "transcriptPublished"
        ? value ? "PUBLISH_TRANSCRIPT" : "HIDE_TRANSCRIPT"
        : value ? "PUBLISH_METADATA" : "HIDE_METADATA";
      const result = await applyContentVisibilityAction(action);
      reportBulkVisibilityResult(
        result,
        `${value ? "Published" : "Hid"} ${label} for ${result.applied} letter${result.applied === 1 ? "" : "s"}`,
      );
    } catch (err) {
      console.error(`Failed to update ${label} visibility:`, err);
      showToast(err instanceof Error ? err.message : `Failed to update ${label} visibility`, "error");
    } finally {
      await refreshAfterVisibilityAttempt();
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
