import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Letter } from "../../../../types/Letter";
import { useDashboardSelectionDetails } from "../useDashboardSelectionDetails";

function makeLetter(overrides: Partial<Letter> & Pick<Letter, "id">): Letter {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    collectionCode: overrides.collectionCode ?? "001",
    images: overrides.images ?? [],
    transcript: overrides.transcript ?? { pages: [], fullText: "", verified: false },
    metadata: overrides.metadata ?? { sender: null, recipient: null, dateRaw: null, verified: false },
    status: overrides.status ?? "uploaded",
    workflowState: overrides.workflowState ?? "UPLOADED",
    visibility: overrides.visibility ?? "HIDDEN",
    transcriptPublished: overrides.transcriptPublished ?? false,
    metadataPublished: overrides.metadataPublished ?? false,
    transcriptStatus: overrides.transcriptStatus ?? "EMPTY",
    metadataContentStatus: overrides.metadataContentStatus ?? "EMPTY",
    extraContentStatus: overrides.extraContentStatus ?? "EMPTY",
    flagged: overrides.flagged ?? false,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt,
    lastOpenedAt: overrides.lastOpenedAt,
    lettersCount: overrides.lettersCount,
    extrasCount: overrides.extrasCount,
    photosCount: overrides.photosCount,
    metadataPublishedAt: overrides.metadataPublishedAt,
    transcriptPublishedAt: overrides.transcriptPublishedAt,
    photoDescriptionStatus: overrides.photoDescriptionStatus,
  };
}

describe("useDashboardSelectionDetails", () => {
  it("returns the selected letter when exactly one id is selected", () => {
    const letters = [
      makeLetter({ id: "letter-1", title: "First" }),
      makeLetter({ id: "letter-2", title: "Second" }),
    ];

    const { result } = renderHook(() => useDashboardSelectionDetails({
      letters,
      filteredLetters: letters,
      selectedIds: new Set(["letter-2"]),
    }));

    expect(result.current.singleSelectedLetter?.title).toBe("Second");
  });

  it("counts publishing state for selected loaded rows", () => {
    const filteredLetters = [
      makeLetter({
        id: "letter-1",
        visibility: "PUBLISHED",
        transcriptPublished: true,
        metadataPublished: false,
      }),
      makeLetter({
        id: "letter-2",
        visibility: "HIDDEN",
        transcriptPublished: false,
        metadataPublished: false,
      }),
      makeLetter({
        id: "letter-3",
        visibility: "PUBLISHED",
        transcriptPublished: true,
        metadataPublished: true,
      }),
    ];

    const { result } = renderHook(() => useDashboardSelectionDetails({
      letters: filteredLetters,
      filteredLetters,
      selectedIds: new Set(["letter-1", "letter-2"]),
    }));

    expect(result.current.publishCounts).toEqual({
      lettersPublished: 1,
      lettersHidden: 1,
      transcriptsPublished: 1,
      transcriptsUnpublished: 1,
      metadataPublished: 0,
      metadataUnpublished: 2,
    });
  });

  it("does not count selected ids that are not loaded in filtered letters", () => {
    const filteredLetters = [
      makeLetter({ id: "letter-1", visibility: "PUBLISHED" }),
    ];

    const { result } = renderHook(() => useDashboardSelectionDetails({
      letters: filteredLetters,
      filteredLetters,
      selectedIds: new Set(["letter-1", "unloaded-letter"]),
    }));

    expect(result.current.publishCounts.lettersPublished).toBe(1);
    expect(result.current.publishCounts.lettersHidden).toBe(0);
  });
});
