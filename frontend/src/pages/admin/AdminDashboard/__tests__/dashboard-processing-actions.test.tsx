import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardProcessingActions } from "../useDashboardProcessingActions";

const {
  bulkExtractMetadataMock,
  bulkTranscribeMock,
  showToastMock,
} = vi.hoisted(() => ({
  bulkExtractMetadataMock: vi.fn(),
  bulkTranscribeMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../../../../api/admin", () => ({
  bulkExtractMetadata: bulkExtractMetadataMock,
  bulkTranscribe: bulkTranscribeMock,
  confirmTranscript: vi.fn(),
  regenerateMetadata: vi.fn(),
}));

vi.mock("../../../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function renderProcessingActions(
  selectedIds = new Set<string>(),
  selectedSources = Array.from(selectedIds).map((letterId, index) => ({
    letterId,
    primarySourceRevision: 4 + (index * 5),
  })),
) {
  const exitEditMode = vi.fn();
  const fetchLetters = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useDashboardProcessingActions({
      selectedIds,
      selectedSources,
      singleSelectedLetter: null,
      exitEditMode,
      fetchLetters,
    }),
  );

  return { ...hook, exitEditMode, fetchLetters };
}

describe("useDashboardProcessingActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTranscribeMock.mockResolvedValue({
      requested: 2,
      queued: 2,
      skipped: 0,
      skipReasons: [],
    });
    bulkExtractMetadataMock.mockResolvedValue({
      requested: 2,
      queued: 2,
      skipped: 0,
      skipReasons: [],
    });
  });

  it("does nothing without an explicit selection", async () => {
    const { result } = renderProcessingActions();

    act(() => {
      result.current.handleOpenTranscription();
      result.current.handleOpenMetadataExtraction();
    });
    await act(async () => {
      await result.current.handleStartTranscription();
      await result.current.handleStartMetadataExtraction();
    });

    expect(result.current.showTranscribeConfirm).toBe(false);
    expect(result.current.showMetadataConfirm).toBe(false);
    expect(bulkTranscribeMock).not.toHaveBeenCalled();
    expect(bulkExtractMetadataMock).not.toHaveBeenCalled();
  });

  it("passes selection-time source pairs to transcription", async () => {
    const selectedIds = new Set(["letter-on-page", "letter-on-another-page"]);
    const { result, exitEditMode, fetchLetters } =
      renderProcessingActions(selectedIds);

    await act(async () => {
      await result.current.handleStartTranscription(false);
    });

    expect(bulkTranscribeMock).toHaveBeenCalledWith(
      [
        { letterId: "letter-on-page", primarySourceRevision: 4 },
        { letterId: "letter-on-another-page", primarySourceRevision: 9 },
      ],
      false,
    );
    expect(showToastMock).toHaveBeenCalledWith(
      "Queued 2 letters for transcription",
      "success",
    );
    expect(exitEditMode).toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalled();
  });

  it("passes the explicit transcription overwrite choice to the backend", async () => {
    const { result } = renderProcessingActions(new Set(["letter-1"]));

    await act(async () => {
      await result.current.handleStartTranscription(true);
    });

    expect(bulkTranscribeMock).toHaveBeenCalledWith(
      [{ letterId: "letter-1", primarySourceRevision: 4 }],
      true,
    );
  });

  it("passes selection-time source pairs to metadata extraction", async () => {
    const selectedIds = new Set(["letter-on-page", "letter-on-another-page"]);
    const { result } = renderProcessingActions(selectedIds);

    await act(async () => {
      await result.current.handleStartMetadataExtraction();
    });

    expect(bulkExtractMetadataMock).toHaveBeenCalledWith([
      { letterId: "letter-on-page", primarySourceRevision: 4 },
      { letterId: "letter-on-another-page", primarySourceRevision: 9 },
    ]);
  });

  it("reports unobserved selections without minting a source revision", async () => {
    const selectedIds = new Set(["letter-on-page", "letter-not-loaded"]);
    const { result, exitEditMode, fetchLetters } = renderProcessingActions(
      selectedIds,
      [{ letterId: "letter-on-page", primarySourceRevision: 4 }],
    );
    bulkTranscribeMock.mockResolvedValueOnce({
      requested: 1,
      queued: 1,
      skipped: 0,
      skipReasons: [],
    });

    await act(async () => {
      await result.current.handleStartTranscription();
    });

    expect(bulkTranscribeMock).toHaveBeenCalledWith(
      [{ letterId: "letter-on-page", primarySourceRevision: 4 }],
      false,
    );
    expect(showToastMock).toHaveBeenCalledWith(
      "Queued 1 letter for transcription. Skipped: Source version was not loaded; refresh and reselect",
      "info",
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it("does not send an empty mutation for an entirely unobserved selection", async () => {
    const { result, exitEditMode, fetchLetters } = renderProcessingActions(
      new Set(["letter-not-loaded"]),
      [],
    );

    await act(async () => {
      await result.current.handleStartMetadataExtraction();
    });

    expect(bulkExtractMetadataMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      "No letters processed: Source version was not loaded; refresh and reselect",
      "error",
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it("uses the backend queued count and preserves skipped selections", async () => {
    bulkExtractMetadataMock.mockResolvedValueOnce({
      requested: 2,
      queued: 1,
      skipped: 1,
      skipReasons: [{
        letterId: "letter-2",
        code: "SOURCE_CHANGED",
        reason: "Letter source changed; refresh and reselect",
      }],
    });
    const { result, exitEditMode } = renderProcessingActions(
      new Set(["letter-1", "letter-2"]),
    );

    await act(async () => {
      await result.current.handleStartMetadataExtraction();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      "Queued 1 letter for metadata extraction. Skipped: Letter source changed; refresh and reselect",
      "info",
    );
    expect(exitEditMode).not.toHaveBeenCalled();
  });
});
