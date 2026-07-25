import { useMemo } from "react";
import type { AdminLetterSummary } from "../../../types/Letter";

export interface PublishCounts {
  lettersPublished: number;
  lettersHidden: number;
  transcriptsPublished: number;
  transcriptsUnpublished: number;
  metadataPublished: number;
  metadataUnpublished: number;
}

export function useDashboardSelectionDetails({
  letters,
  filteredLetters,
  selectedIds,
}: {
  letters: AdminLetterSummary[];
  filteredLetters: AdminLetterSummary[];
  selectedIds: Set<string>;
}) {
  const singleSelectedLetter = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const [selectedId] = Array.from(selectedIds);
    return letters.find((letter) => letter.id === selectedId) ?? null;
  }, [letters, selectedIds]);

  const publishCounts = useMemo(() => {
    // Counts are limited to loaded rows; select-all-filtered can include IDs from unloaded pages.
    const selected = filteredLetters.filter((letter) => selectedIds.has(letter.id));

    return {
      lettersPublished: selected.filter((letter) => letter.visibility === "PUBLISHED").length,
      lettersHidden: selected.filter((letter) => letter.visibility === "HIDDEN").length,
      transcriptsPublished: selected.filter((letter) => letter.transcriptPublished).length,
      transcriptsUnpublished: selected.filter((letter) => !letter.transcriptPublished).length,
      metadataPublished: selected.filter((letter) => letter.metadataPublished).length,
      metadataUnpublished: selected.filter((letter) => !letter.metadataPublished).length,
    };
  }, [filteredLetters, selectedIds]);

  return {
    singleSelectedLetter,
    publishCounts,
  };
}
