import { useCallback, useMemo, useState } from "react";
import {
  bulkExtractMetadata,
  bulkTranscribe,
  confirmTranscript,
  regenerateMetadata,
  startMetadataExtraction,
  startTranscription,
} from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";
import type { Letter } from "../../../types/Letter";
import {
  getDashboardProcessingFilters,
  type DashboardFilterControls,
} from "./useDashboardFilters";

type SingleMetadataMode = "extract" | "regenerate";

interface UseDashboardProcessingActionsOptions {
  selectedIds: Set<string>;
  letters: Letter[];
  singleSelectedLetter: Letter | null;
  filters: DashboardFilterControls;
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

function summarizeWorkerRequest(total: number, stage: string) {
  const subject = total === 1 ? "letter is" : "letters are";
  return `Worker requested; ${total} matching ${subject} currently queued for ${stage}`;
}

export function useDashboardProcessingActions({
  selectedIds,
  letters,
  singleSelectedLetter,
  filters,
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
  const [transcribeExistingCount, setTranscribeExistingCount] = useState(0);
  const [metadataExistingCount, setMetadataExistingCount] = useState(0);

  const singleMetadataMode = useMemo<SingleMetadataMode>(
    () =>
      singleSelectedLetter && singleSelectedLetter.metadataContentStatus !== "EMPTY"
        ? "regenerate"
        : "extract",
    [singleSelectedLetter],
  );

  const buildProcessingFilters = useCallback(
    () => getDashboardProcessingFilters(filters),
    [filters],
  );

  const handleStartTranscription = useCallback(async (skipExisting = false) => {
    try {
      if (selectedIds.size > 0) {
        let ids = Array.from(selectedIds);
        if (skipExisting) {
          ids = letters.filter(l => ids.includes(l.id) && l.transcriptStatus === "EMPTY").map(l => l.id);
          if (ids.length === 0) {
            showToast("No letters without transcripts to process", "info");
            return;
          }
        }
        const result = await bulkTranscribe(ids, !skipExisting);
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
      } else {
        const result = await startTranscription(buildProcessingFilters());
        showToast(
          result.total === 0
            ? result.message
            : summarizeWorkerRequest(result.total, "transcription"),
          result.total === 0 ? "info" : "success",
        );
      }
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", "error");
    }
  }, [buildProcessingFilters, exitEditMode, fetchLetters, letters, selectedIds, showToast]);

  const handleStartMetadataExtraction = useCallback(async (skipExisting = false) => {
    try {
      if (selectedIds.size > 0) {
        let ids = Array.from(selectedIds);
        if (skipExisting) {
          ids = letters.filter(l => ids.includes(l.id) && l.metadataContentStatus === "EMPTY").map(l => l.id);
          if (ids.length === 0) {
            showToast("No letters without metadata to process", "info");
            return;
          }
        }
        const result = await bulkExtractMetadata(ids);

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
      } else {
        const result = await startMetadataExtraction(buildProcessingFilters());
        showToast(
          result.total === 0
            ? result.message
            : summarizeWorkerRequest(result.total, "metadata extraction"),
          result.total === 0 ? "info" : "success",
        );
      }
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", "error");
    }
  }, [buildProcessingFilters, exitEditMode, fetchLetters, letters, selectedIds, showToast]);

  const handleOpenTranscription = useCallback(() => {
    if (selectedIds.size > 0) {
      const existing = letters.filter(
        (letter) => selectedIds.has(letter.id) && letter.transcriptStatus !== "EMPTY",
      ).length;
      setTranscribeExistingCount(existing);
    } else {
      setTranscribeExistingCount(0);
    }

    setShowTranscribeConfirm(true);
  }, [letters, selectedIds]);

  const handleOpenMetadataExtraction = useCallback(() => {
    if (selectedIds.size === 1 && singleSelectedLetter) {
      setSingleMetadataSender(singleSelectedLetter.metadata.sender ?? "");
      setSingleMetadataRecipient(singleSelectedLetter.metadata.recipient ?? "");
      setShowSingleMetadataModal(true);
      return;
    }

    if (selectedIds.size > 0) {
      const existing = letters.filter(
        (letter) =>
          selectedIds.has(letter.id) && letter.metadataContentStatus !== "EMPTY",
      ).length;
      setMetadataExistingCount(existing);
    } else {
      setMetadataExistingCount(0);
    }

    setShowMetadataConfirm(true);
  }, [letters, selectedIds, singleSelectedLetter]);

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
    handleOpenTranscription,
    handleOpenMetadataExtraction,
    handleSingleMetadataExtraction,
  };
}
