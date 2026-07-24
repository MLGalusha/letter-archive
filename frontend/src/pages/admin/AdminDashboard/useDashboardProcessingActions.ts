import { useCallback, useMemo, useState } from "react";
import {
  bulkExtractMetadata,
  bulkTranscribe,
  confirmTranscript,
  regenerateMetadata,
} from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";
import type { Letter } from "../../../types/Letter";

type SingleMetadataMode = "extract" | "regenerate";

interface UseDashboardProcessingActionsOptions {
  selectedIds: Set<string>;
  singleSelectedLetter: Letter | null;
  exitEditMode: () => void;
  fetchLetters: () => Promise<void>;
}

function summarizeSkipReasons(reasons: Array<{ reason: string }>) {
  const counts = new Map<string, number>();
  for (const { reason } of reasons) {
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => count > 1 ? `${count} ${reason}` : reason)
    .join(", ");
}

export function useDashboardProcessingActions({
  selectedIds,
  singleSelectedLetter,
  exitEditMode,
  fetchLetters,
}: UseDashboardProcessingActionsOptions) {
  const { showToast } = useToast();
  const [showTranscribeConfirm, setShowTranscribeConfirm] = useState(false);
  const [showMetadataConfirm, setShowMetadataConfirm] = useState(false);
  const [showSingleMetadataModal, setShowSingleMetadataModal] = useState(false);
  const [singleMetadataSender, setSingleMetadataSender] = useState("");
  const [singleMetadataRecipient, setSingleMetadataRecipient] = useState("");
  const [singleMetadataSubmitting, setSingleMetadataSubmitting] = useState(false);

  const singleMetadataMode = useMemo<SingleMetadataMode>(
    () =>
      singleSelectedLetter && singleSelectedLetter.metadataContentStatus !== "EMPTY"
        ? "regenerate"
        : "extract",
    [singleSelectedLetter],
  );

  const handleStartTranscription = useCallback(async (overwriteExisting = false) => {
    if (selectedIds.size === 0) return;
    try {
      const result = await bulkTranscribe(
        Array.from(selectedIds),
        overwriteExisting,
      );
      if (result.queued === 0 && result.skipped > 0) {
        const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
        showToast(`No letters processed: ${summary}`, "error");
      } else if (result.skipped > 0) {
        const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
        showToast(`Queued ${result.queued} for transcription. Skipped: ${summary}`, "info");
      } else {
        showToast(`Queued ${result.queued} letters for transcription`, "success");
      }
      exitEditMode();
      await fetchLetters();
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", "error");
    }
  }, [exitEditMode, fetchLetters, selectedIds, showToast]);

  const handleStartMetadataExtraction = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const result = await bulkExtractMetadata(Array.from(selectedIds));

      if (result.queued === 0 && result.skipped > 0) {
        const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
        showToast(`No letters processed: ${summary}`, "error");
      } else if (result.skipped > 0) {
        const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
        showToast(`Queued ${result.queued} for metadata extraction. Skipped: ${summary}`, "info");
      } else {
        showToast(`Queued ${result.queued} letters for metadata extraction`, "success");
      }
      exitEditMode();
      await fetchLetters();
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", "error");
    }
  }, [exitEditMode, fetchLetters, selectedIds, showToast]);

  const handleOpenTranscription = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowTranscribeConfirm(true);
  }, [selectedIds]);

  const handleOpenMetadataExtraction = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (selectedIds.size === 1 && singleSelectedLetter) {
      setSingleMetadataSender(singleSelectedLetter.metadata.sender ?? "");
      setSingleMetadataRecipient(singleSelectedLetter.metadata.recipient ?? "");
      setShowSingleMetadataModal(true);
      return;
    }

    setShowMetadataConfirm(true);
  }, [selectedIds, singleSelectedLetter]);

  const handleSingleMetadataExtraction = useCallback(async () => {
    if (!singleSelectedLetter) return;

    const extractionOptions = {
      confirmedSender: singleMetadataSender.trim() || undefined,
      confirmedRecipient: singleMetadataRecipient.trim() || undefined,
    };
    const hadExistingMetadata =
      singleSelectedLetter.metadataContentStatus !== "EMPTY";

    setShowSingleMetadataModal(false);
    setSingleMetadataSubmitting(true);

    try {
      let updatedLetter: Letter | null = null;
      let didRefresh = hadExistingMetadata;

      if (!singleSelectedLetter.transcriptConfirmedAt) {
        updatedLetter = await confirmTranscript(
          singleSelectedLetter.id,
          extractionOptions,
        );

        if (
          singleSelectedLetter.metadataContentStatus !== "EMPTY" ||
          updatedLetter.metadataContentStatus === "EMPTY"
        ) {
          didRefresh = true;
          updatedLetter = await regenerateMetadata(
            singleSelectedLetter.id,
            extractionOptions,
          );
        }
      } else {
        updatedLetter = await regenerateMetadata(
          singleSelectedLetter.id,
          extractionOptions,
        );
      }

      if (!updatedLetter) {
        throw new Error("Metadata extraction did not return an updated letter");
      }

      showToast(
        didRefresh
          ? "Metadata regenerated"
          : "Metadata generated",
        "success",
      );
      exitEditMode();
      await fetchLetters();
    } catch (err) {
      console.error("Failed to extract metadata for selected letter:", err);
      showToast(
        err instanceof Error
          ? err.message
          : "Failed to extract metadata for selected letter",
        "error",
      );
    } finally {
      setSingleMetadataSubmitting(false);
    }
  }, [
    exitEditMode,
    fetchLetters,
    showToast,
    singleMetadataRecipient,
    singleMetadataSender,
    singleSelectedLetter,
  ]);

  return {
    showTranscribeConfirm,
    setShowTranscribeConfirm,
    showMetadataConfirm,
    setShowMetadataConfirm,
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
    handleOpenTranscription,
    handleOpenMetadataExtraction,
    handleSingleMetadataExtraction,
  };
}
