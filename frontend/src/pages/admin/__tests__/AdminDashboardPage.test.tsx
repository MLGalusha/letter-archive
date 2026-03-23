import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../../../api/client";
import type { Letter } from "../../../types/Letter";

const {
  getAdminLettersMock,
  getFilteredLetterIdsMock,
  deleteLetterMock,
  toggleLetterFlagMock,
  getProcessingStatusMock,
  startTranscriptionMock,
  startMetadataExtractionMock,
  pauseProcessingMock,
  resumeProcessingMock,
  abortProcessingMock,
  bulkClearTranscriptionsMock,
  bulkClearMetadataMock,
  bulkTranscribeMock,
  bulkExtractMetadataMock,
  bulkUpdateFieldsMock,
  showToastMock,
  isAuthenticatedMock,
} = vi.hoisted(() => ({
  getAdminLettersMock: vi.fn(),
  getFilteredLetterIdsMock: vi.fn(),
  deleteLetterMock: vi.fn(),
  toggleLetterFlagMock: vi.fn(),
  getProcessingStatusMock: vi.fn(),
  startTranscriptionMock: vi.fn(),
  startMetadataExtractionMock: vi.fn(),
  pauseProcessingMock: vi.fn(),
  resumeProcessingMock: vi.fn(),
  abortProcessingMock: vi.fn(),
  bulkClearTranscriptionsMock: vi.fn(),
  bulkClearMetadataMock: vi.fn(),
  bulkTranscribeMock: vi.fn(),
  bulkExtractMetadataMock: vi.fn(),
  bulkUpdateFieldsMock: vi.fn(),
  showToastMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
}));

vi.mock("../../../api/auth", () => ({
  isAuthenticated: isAuthenticatedMock,
}));

vi.mock("../../../api/letters", () => ({
  getAdminLetters: (...args: unknown[]) => getAdminLettersMock(...args),
  getFilteredLetterIds: (...args: unknown[]) => getFilteredLetterIdsMock(...args),
  deleteLetter: (...args: unknown[]) => deleteLetterMock(...args),
}));

vi.mock("../../../api/admin/letters", () => ({
  toggleLetterFlag: (...args: unknown[]) => toggleLetterFlagMock(...args),
}));

vi.mock("../../../api/admin", () => ({
  getProcessingStatus: (...args: unknown[]) => getProcessingStatusMock(...args),
  startTranscription: (...args: unknown[]) => startTranscriptionMock(...args),
  startMetadataExtraction: (...args: unknown[]) => startMetadataExtractionMock(...args),
  pauseProcessing: (...args: unknown[]) => pauseProcessingMock(...args),
  resumeProcessing: (...args: unknown[]) => resumeProcessingMock(...args),
  abortProcessing: (...args: unknown[]) => abortProcessingMock(...args),
  bulkClearTranscriptions: (...args: unknown[]) => bulkClearTranscriptionsMock(...args),
  bulkClearMetadata: (...args: unknown[]) => bulkClearMetadataMock(...args),
  bulkTranscribe: (...args: unknown[]) => bulkTranscribeMock(...args),
  bulkExtractMetadata: (...args: unknown[]) => bulkExtractMetadataMock(...args),
  bulkUpdateFields: (...args: unknown[]) => bulkUpdateFieldsMock(...args),
}));

vi.mock("../../../contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock("../../../components/AdminLayout", () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      <div>{headerActions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("../../../components/common", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ConfirmDialog: ({
    isOpen,
    title,
    message,
    confirmText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>
          {confirmText}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock("../../../components/common/Icon", () => ({
  default: () => <span>icon</span>,
}));

vi.mock("../AdminDashboard/RecentActivityTable", () => ({
  default: () => <div>Recent activity table</div>,
}));

vi.mock("../../../utils/recentEdits", () => ({
  getRecentEdits: () => [],
  formatTimeAgo: () => "just now",
}));

import AdminDashboard from "../AdminDashboard";

function makeLetter(): Letter {
  return {
    id: "letter-1",
    title: "Test Letter",
    collectionCode: "009",
    images: [{ id: "img-1", type: "letter", imageUrl: "test.jpg" }],
    transcript: { pages: [], fullText: "hello", verified: false },
    metadata: { sender: "Alice", recipient: "Bob", dateRaw: "19470810", verified: false },
    status: "uploaded",
    workflowState: "UPLOADED",
    visibility: "HIDDEN",
    transcriptStatus: "AI_DRAFT",
    metadataContentStatus: "AI_DRAFT",
    extraContentStatus: "EMPTY",
    flagged: false,
    createdAt: "2026-03-09T12:00:00.000Z",
    lettersCount: 1,
    extrasCount: 0,
  };
}

function createLettersResponse() {
  return {
    letters: [makeLetter()],
    pagination: {
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    },
    stats: {
      total: 1,
      uploaded: 1,
      transcribed: 0,
      metadataReady: 0,
      reviewed: 0,
      published: 0,
      hidden: 1,
      flagged: 0,
      transcript: {
        empty: 0,
        aiDraft: 1,
        edited: 0,
        verified: 0,
      },
      metadata: {
        empty: 0,
        aiDraft: 1,
        edited: 0,
        verified: 0,
      },
    },
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

describe("AdminDashboard processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isAuthenticatedMock.mockReturnValue(true);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    getAdminLettersMock.mockResolvedValue(createLettersResponse());
    getProcessingStatusMock.mockResolvedValue({
      isRunning: false,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: 0,
      errors: [],
      lastCompletedAt: null,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it("ignores processing status poll failures without surfacing a toast", async () => {
    getProcessingStatusMock.mockRejectedValueOnce(
      new ApiError(
        503,
        "processing status offline",
        undefined,
        "req-dashboard-status-503",
      ),
    );

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getProcessingStatusMock).toHaveBeenCalled();
    });
    expect(showToastMock).not.toHaveBeenCalledWith(
      "processing status offline (Request ID: req-dashboard-status-503)",
      "error",
    );
    expect(consoleDebugSpy).toHaveBeenCalled();
  });
});
