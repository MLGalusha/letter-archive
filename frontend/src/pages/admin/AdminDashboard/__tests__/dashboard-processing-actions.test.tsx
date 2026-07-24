import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardProcessingActions } from "../useDashboardProcessingActions";
import type { DashboardFilterControls } from "../useDashboardFilters";

const {
  bulkTranscribeMock,
  startMetadataExtractionMock,
  startTranscriptionMock,
  showToastMock,
} = vi.hoisted(() => ({
  bulkTranscribeMock: vi.fn(),
  startMetadataExtractionMock: vi.fn(),
  startTranscriptionMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../../../../api/admin", () => ({
  bulkExtractMetadata: vi.fn(),
  bulkTranscribe: bulkTranscribeMock,
  confirmTranscript: vi.fn(),
  regenerateMetadata: vi.fn(),
  startMetadataExtraction: startMetadataExtractionMock,
  startTranscription: startTranscriptionMock,
}));

vi.mock("../../../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function makeFilters(): DashboardFilterControls {
  return {
    collectionFilter: "009",
    visibilityFilter: "ALL",
    searchQuery: "",
    yearFilter: null,
    monthFilter: null,
    dayFilter: null,
    dateFromFilter: null,
    dateToFilter: null,
  } as unknown as DashboardFilterControls;
}

function renderProcessingActions(selectedIds = new Set<string>()) {
  const exitEditMode = vi.fn();
  const fetchLetters = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useDashboardProcessingActions({
    selectedIds,
    letters: [],
    singleSelectedLetter: null,
    filters: makeFilters(),
    exitEditMode,
    fetchLetters,
  }));

  return { ...hook, exitEditMode, fetchLetters };
}

describe("useDashboardProcessingActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces the backend message when no filtered transcription work is eligible", async () => {
    startTranscriptionMock.mockResolvedValue({
      message: "No letters to process",
      total: 0,
    });
    const { result } = renderProcessingActions();

    await act(async () => {
      await result.current.handleStartTranscription();
    });

    expect(startTranscriptionMock).toHaveBeenCalledWith({ collectionCode: "009" });
    expect(showToastMock).toHaveBeenCalledWith("No letters to process", "info");
  });

  it("surfaces the backend message when a filtered collection is not found", async () => {
    startMetadataExtractionMock.mockResolvedValue({
      message: "Collection not found",
      total: 0,
    });
    const { result } = renderProcessingActions();

    await act(async () => {
      await result.current.handleStartMetadataExtraction();
    });

    expect(startMetadataExtractionMock).toHaveBeenCalledWith({ collectionCode: "009" });
    expect(showToastMock).toHaveBeenCalledWith("Collection not found", "info");
  });

  it("does not imply that a positive filter response scopes worker execution", async () => {
    startTranscriptionMock.mockResolvedValue({
      message: "Processing queued",
      total: 2,
    });
    const { result } = renderProcessingActions();

    await act(async () => {
      await result.current.handleStartTranscription();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      "Worker requested; 2 matching letters are currently queued for transcription",
      "success",
    );
  });

  it("describes accepted bulk work as queued", async () => {
    bulkTranscribeMock.mockResolvedValue({
      queued: 1,
      skipped: 0,
      skipReasons: [],
    });
    const { result, exitEditMode, fetchLetters } = renderProcessingActions(
      new Set(["letter-1"]),
    );

    await act(async () => {
      await result.current.handleStartTranscription();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      "Queued 1 letters for transcription",
      "success",
    );
    expect(exitEditMode).toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalled();
  });
});
