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
import type { VisibilityFilter } from "./types";

type SingleMetadataMode = "extract" | "regenerate";

interface UseDashboardProcessingActionsOptions {
  selectedIds: Set<string>;
  letters: Letter[];
  singleSelectedLetter: Letter | null;
  collectionFilter: string;
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
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
  letters,
  singleSelectedLetter,
  collectionFilter,
  visibilityFilter,
  searchQuery,
  yearFilter,
  monthFilter,
  dayFilter,
  dateFromFilter,
  dateToFilter,
  exitEditMode,
  fetchLetters,
}: UseDashboardProcessingActionsOptions) {
  const { showToast } = useToast();
  const [showUnconfirmedDialog, setShowUnconfirmedDialog] = useState(false);
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);
  const [pendingMetadataIds, setPendingMetadataIds] = useState<string[]>([]);
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

  const buildProcessingFilters = useCallback(() => ({
    collectionCode: collectionFilter !== "all" ? collectionFilter : undefined,
    visibility: visibilityFilter !== "ALL" ? visibilityFilter : undefined,
    search: searchQuery || undefined,
    year: yearFilter ?? undefined,
    month: monthFilter ?? undefined,
    day: dayFilter ?? undefined,
    dateFrom: dateFromFilter ?? undefined,
    dateTo: dateToFilter ?? undefined,
  }), [
    collectionFilter,
    dateFromFilter,
    dateToFilter,
    dayFilter,
    monthFilter,
    searchQuery,
    visibilityFilter,
    yearFilter,
  ]);

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
          const verb = result.processing ? "Processing" : "Queued";
          showToast(`${verb} ${result.queued} for transcription. Skipped: ${summary}`, "info");
        } else {
          const verb = result.processing ? "Processing" : "Queued";
          showToast(`${verb} ${result.queued} letters for transcription`, "success");
        }
        exitEditMode();
        await fetchLetters();
      } else {
        const result = await startTranscription(buildProcessingFilters());
        showToast(`Started transcription for ${result.total} letters`, "success");
      }
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", "error");
    }
  }, [buildProcessingFilters, exitEditMode, fetchLetters, letters, selectedIds, showToast]);

  const handleStartMetadataExtraction = useCallback(async (skipConfirmation = false, skipExisting = false) => {
    try {
      if (selectedIds.size > 0) {
        let ids = skipConfirmation ? pendingMetadataIds : Array.from(selectedIds);
        if (skipExisting) {
          ids = letters.filter(l => ids.includes(l.id) && l.metadataContentStatus === "EMPTY").map(l => l.id);
          if (ids.length === 0) {
            showToast("No letters without metadata to process", "info");
            return;
          }
        }
        const result = await bulkExtractMetadata(ids, skipConfirmation);

        if (result.unconfirmedCount && result.unconfirmedCount > 0 && !skipConfirmation && result.queued === 0) {
          setUnconfirmedCount(result.unconfirmedCount);
          setPendingMetadataIds(ids);
          setShowUnconfirmedDialog(true);
          return;
        }

        if (result.queued === 0 && result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          showToast(`No letters processed: ${summary}`, "error");
        } else if (result.skipped > 0) {
          const summary = result.skipReasons ? summarizeSkipReasons(result.skipReasons) : `${result.skipped} skipped`;
          const verb = result.processing ? "Processing" : "Queued";
          showToast(`${verb} ${result.queued} for metadata extraction. Skipped: ${summary}`, "info");
        } else {
          const verb = result.processing ? "Processing" : "Queued";
          showToast(`${verb} ${result.queued} letters for metadata extraction`, "success");
        }
        exitEditMode();
        await fetchLetters();
      } else {
        const result = await startMetadataExtraction(buildProcessingFilters());
        showToast(`Started metadata extraction for ${result.total} letters`, "success");
      }
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", "error");
    }
  }, [buildProcessingFilters, exitEditMode, fetchLetters, letters, pendingMetadataIds, selectedIds, showToast]);

  const handleConfirmUnverified = useCallback(async () => {
    setShowUnconfirmedDialog(false);
    await handleStartMetadataExtraction(true);
  }, [handleStartMetadataExtraction]);

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
    showUnconfirmedDialog,
    setShowUnconfirmedDialog,
    unconfirmedCount,
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
    handleConfirmUnverified,
    handleOpenTranscription,
    handleOpenMetadataExtraction,
    handleSingleMetadataExtraction,
  };
}
