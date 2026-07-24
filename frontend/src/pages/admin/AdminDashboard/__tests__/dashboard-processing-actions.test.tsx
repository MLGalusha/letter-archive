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

function renderProcessingActions(selectedIds = new Set<string>()) {
  const exitEditMode = vi.fn();
  const fetchLetters = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useDashboardProcessingActions({
      selectedIds,
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
      queued: 2,
      skipped: 0,
      skipReasons: [],
    });
    bulkExtractMetadataMock.mockResolvedValue({
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

  it("passes every selected id to transcription instead of filtering through loaded rows", async () => {
    const selectedIds = new Set(["letter-on-page", "letter-on-another-page"]);
    const { result, exitEditMode, fetchLetters } =
      renderProcessingActions(selectedIds);

    await act(async () => {
      await result.current.handleStartTranscription(false);
    });

    expect(bulkTranscribeMock).toHaveBeenCalledWith(
      ["letter-on-page", "letter-on-another-page"],
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

    expect(bulkTranscribeMock).toHaveBeenCalledWith(["letter-1"], true);
  });

  it("lets durable metadata eligibility evaluate every selected id", async () => {
    const selectedIds = new Set(["letter-on-page", "letter-on-another-page"]);
    const { result } = renderProcessingActions(selectedIds);

    await act(async () => {
      await result.current.handleStartMetadataExtraction();
    });

    expect(bulkExtractMetadataMock).toHaveBeenCalledWith([
      "letter-on-page",
      "letter-on-another-page",
    ]);
  });
});
