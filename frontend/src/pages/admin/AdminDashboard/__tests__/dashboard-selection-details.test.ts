import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AdminLetterSummary } from "../../../../types/Letter";
import { makeAdminLetterSummary } from "../../../../test/adminLetterSummary";
import { useDashboardSelectionDetails } from "../useDashboardSelectionDetails";

function makeSummary(
  overrides: Partial<AdminLetterSummary> & Pick<AdminLetterSummary, "id">,
): AdminLetterSummary {
  return makeAdminLetterSummary({
    title: overrides.title ?? overrides.id,
    ...overrides,
  });
}

describe("useDashboardSelectionDetails", () => {
  it("returns the selected letter when exactly one id is selected", () => {
    const letters = [
      makeSummary({ id: "letter-1", title: "First" }),
      makeSummary({ id: "letter-2", title: "Second" }),
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
      makeSummary({
        id: "letter-1",
        visibility: "PUBLISHED",
        transcriptPublished: true,
        metadataPublished: false,
      }),
      makeSummary({
        id: "letter-2",
        visibility: "HIDDEN",
        transcriptPublished: false,
        metadataPublished: false,
      }),
      makeSummary({
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
      makeSummary({ id: "letter-1", visibility: "PUBLISHED" }),
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
