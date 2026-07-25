import { useCallback, useMemo, useState } from "react";
import {
  bulkExtractMetadata,
  bulkTranscribe,
  regenerateMetadata,
  type BulkProcessResponse,
  type BulkSource,
} from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";
import type { Letter } from "../../../types/Letter";
import { sha256Utf8 } from "../../../utils/sha256";
import {
  getTranscriptConfirmationFeedback,
  resolveTranscriptConfirmationOutcome,
  TranscriptConfirmationAcceptedError,
  TranscriptConfirmationOutcomeUnknownError,
} from "../transcriptConfirmationOutcome";
import {
  includeUnobservedSelections,
  summarizeSourceSkips,
} from "./sourceBoundBulk";
import type { DashboardSelectionIntent } from "./useDashboardSelection";

type SingleMetadataMode = "extract" | "regenerate";

interface UseDashboardProcessingActionsOptions {
  selectedIds: Set<string>;
  selectedSources: BulkSource[];
  singleSelectedLetter: Letter | null;
  makeSelectionExplicit: () => DashboardSelectionIntent;
  exitEditMode: (expectedIntent?: DashboardSelectionIntent) => void;
  fetchLetters: () => Promise<void>;
}

const emptyProcessOutcome = (): BulkProcessResponse => ({
  requested: 0,
  queued: 0,
  skipped: 0,
  skipReasons: [],
});

function processLabel(count: number) {
  return `${count} letter${count === 1 ? "" : "s"}`;
}

export function useDashboardProcessingActions({
  selectedIds,
  selectedSources,
  singleSelectedLetter,
  makeSelectionExplicit,
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
    const mutationIntent = makeSelectionExplicit();
    try {
      const mutation = selectedSources.length > 0
        ? await bulkTranscribe(selectedSources, overwriteExisting)
        : emptyProcessOutcome();
      const result = includeUnobservedSelections(
        mutation,
        selectedIds,
        selectedSources,
      );
      if (result.queued === 0 && result.skipped > 0) {
        const summary = summarizeSourceSkips(result.skipReasons);
        showToast(`No letters processed: ${summary}`, "error");
      } else if (result.skipped > 0) {
        const summary = summarizeSourceSkips(result.skipReasons);
        showToast(`Queued ${processLabel(result.queued)} for transcription. Skipped: ${summary}`, "info");
      } else {
        showToast(`Queued ${processLabel(result.queued)} for transcription`, "success");
        exitEditMode(mutationIntent);
      }
    } catch (err) {
      console.error("Failed to start transcription:", err);
      showToast(err instanceof Error ? err.message : "Failed to start transcription", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after transcription attempt:", err);
      }
    }
  }, [
    exitEditMode,
    fetchLetters,
    makeSelectionExplicit,
    selectedIds,
    selectedSources,
    showToast,
  ]);

  const handleStartMetadataExtraction = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const mutationIntent = makeSelectionExplicit();
    try {
      const mutation = selectedSources.length > 0
        ? await bulkExtractMetadata(selectedSources)
        : emptyProcessOutcome();
      const result = includeUnobservedSelections(
        mutation,
        selectedIds,
        selectedSources,
      );

      if (result.queued === 0 && result.skipped > 0) {
        const summary = summarizeSourceSkips(result.skipReasons);
        showToast(`No letters processed: ${summary}`, "error");
      } else if (result.skipped > 0) {
        const summary = summarizeSourceSkips(result.skipReasons);
        showToast(`Queued ${processLabel(result.queued)} for metadata extraction. Skipped: ${summary}`, "info");
      } else {
        showToast(`Queued ${processLabel(result.queued)} for metadata extraction`, "success");
        exitEditMode(mutationIntent);
      }
    } catch (err) {
      console.error("Failed to start metadata extraction:", err);
      showToast(err instanceof Error ? err.message : "Failed to start metadata extraction", "error");
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error("Failed to refresh letters after metadata attempt:", err);
      }
    }
  }, [
    exitEditMode,
    fetchLetters,
    makeSelectionExplicit,
    selectedIds,
    selectedSources,
    showToast,
  ]);

  const handleOpenTranscription = useCallback(() => {
    if (selectedIds.size === 0) return;
    setShowTranscribeConfirm(true);
  }, [selectedIds]);

  const handleOpenMetadataExtraction = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (selectedIds.size === 1 && singleSelectedLetter) {
      if (
        singleSelectedLetter.metadataJobStatus === "PENDING"
        && Boolean(singleSelectedLetter.transcriptConfirmedAt)
      ) {
        showToast("Metadata extraction is queued.", "info");
        return;
      }
      if (
        singleSelectedLetter.metadataJobStatus === "RUNNING"
        || (
          singleSelectedLetter.metadataJobStatus === undefined
          && singleSelectedLetter.workflowState === "METADATA_EXTRACTING"
        )
      ) {
        showToast("Metadata extraction is already in progress.", "info");
        return;
      }
      setSingleMetadataSender(singleSelectedLetter.metadata.sender ?? "");
      setSingleMetadataRecipient(singleSelectedLetter.metadata.recipient ?? "");
      setShowSingleMetadataModal(true);
      return;
    }

    setShowMetadataConfirm(true);
  }, [selectedIds, showToast, singleSelectedLetter]);

  const handleSingleMetadataExtraction = useCallback(async () => {
    if (!singleSelectedLetter) return;
    const mutationIntent = makeSelectionExplicit();

    const extractionOptions = {
      confirmedSender: singleMetadataSender.trim() || undefined,
      confirmedRecipient: singleMetadataRecipient.trim() || undefined,
    };
    const target = {
      id: singleSelectedLetter.id,
      primarySourceRevision: singleSelectedLetter.primarySourceRevision,
      transcriptText: singleSelectedLetter.transcript.fullText,
      transcriptConfirmed: Boolean(singleSelectedLetter.transcriptConfirmedAt),
      hadExistingMetadata:
        singleSelectedLetter.metadataContentStatus !== "EMPTY",
    };

    setShowSingleMetadataModal(false);
    setSingleMetadataSubmitting(true);

    try {
      if (!target.transcriptConfirmed) {
        const outcome = await resolveTranscriptConfirmationOutcome({
          letterId: target.id,
          primarySourceRevision: target.primarySourceRevision,
          transcriptDigest: await sha256Utf8(target.transcriptText),
          ...extractionOptions,
        });

        if (
          outcome.letter.primarySourceRevision
          !== target.primarySourceRevision
        ) {
          showToast(
            "Letter source changed; refreshed the latest state.",
            "error",
          );
        } else {
          const feedback = getTranscriptConfirmationFeedback(outcome);
          showToast(feedback.message, feedback.type);
        }
        exitEditMode(mutationIntent);
      } else {
        await regenerateMetadata(
          target.id,
          target.primarySourceRevision,
          extractionOptions,
        );

        showToast(
          target.hadExistingMetadata
            ? "Metadata regenerated"
            : "Metadata generated",
          "success",
        );
        exitEditMode(mutationIntent);
      }
    } catch (err) {
      console.error("Failed to extract metadata for selected letter:", err);
      if (
        err instanceof TranscriptConfirmationAcceptedError
        || err instanceof TranscriptConfirmationOutcomeUnknownError
      ) {
        exitEditMode(mutationIntent);
      }
      showToast(
        err instanceof Error
          ? err.message
          : "Failed to extract metadata for selected letter",
        "error",
      );
    } finally {
      try {
        await fetchLetters();
      } catch (err) {
        console.error(
          "Failed to refresh letters after metadata attempt:",
          err,
        );
      }
      setSingleMetadataSubmitting(false);
    }
  }, [
    exitEditMode,
    fetchLetters,
    makeSelectionExplicit,
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
