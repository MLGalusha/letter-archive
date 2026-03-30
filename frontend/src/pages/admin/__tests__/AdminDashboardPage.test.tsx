import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../../api/client";
import type { Letter } from "../../../types/Letter";

const {
  confirmTranscriptMock,
  getAdminLettersMock,
  getFilteredLetterIdsMock,
  deleteLetterMock,
  toggleLetterFlagMock,
  getProcessingStatusMock,
  regenerateMetadataMock,
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
  confirmTranscriptMock: vi.fn(),
  getAdminLettersMock: vi.fn(),
  getFilteredLetterIdsMock: vi.fn(),
  deleteLetterMock: vi.fn(),
  toggleLetterFlagMock: vi.fn(),
  getProcessingStatusMock: vi.fn(),
  regenerateMetadataMock: vi.fn(),
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
  confirmTranscript: (...args: unknown[]) => confirmTranscriptMock(...args),
  getProcessingStatus: (...args: unknown[]) => getProcessingStatusMock(...args),
  regenerateMetadata: (...args: unknown[]) => regenerateMetadataMock(...args),
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
  default: ({
    filteredLetters,
    onCheckboxChange,
    selectedIds,
  }: {
    filteredLetters: Letter[];
    onCheckboxChange: (letterId: string, index: number, event: unknown) => void;
    selectedIds: Set<string>;
  }) => (
    <div>
      <div>Recent activity table</div>
      {filteredLetters.map((letter, index) => (
        <button
          key={letter.id}
          type="button"
          onClick={(event) => onCheckboxChange(letter.id, index, event)}
        >
          {selectedIds.has(letter.id) ? `Selected ${letter.title}` : `Select ${letter.title}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../../utils/recentEdits", () => ({
  getRecentEdits: () => [],
  formatTimeAgo: () => "just now",
}));

import AdminDashboard from "../AdminDashboard";

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  const baseLetter: Letter = {
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

  return {
    ...baseLetter,
    ...overrides,
    transcript: {
      ...baseLetter.transcript,
      ...(overrides.transcript ?? {}),
    },
    metadata: {
      ...baseLetter.metadata,
      ...(overrides.metadata ?? {}),
    },
    images: overrides.images ?? baseLetter.images,
  };
}

function createLettersResponse(letters: Letter[] = [makeLetter()]) {
  return {
    letters,
    pagination: {
      page: 1,
      limit: 50,
      total: letters.length,
      totalPages: 1,
    },
    stats: {
      total: letters.length,
      uploaded: letters.length,
      transcribed: 0,
      metadataReady: 0,
      reviewed: 0,
      published: 0,
      hidden: letters.length,
      flagged: 0,
      transcript: {
        empty: 0,
        aiDraft: letters.length,
        edited: 0,
        verified: 0,
      },
      metadata: {
        empty: 0,
        aiDraft: letters.length,
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

  it("opens the sender and recipient modal when exactly one letter is selected", async () => {
    const user = userEvent.setup();

    getAdminLettersMock.mockResolvedValue(
      createLettersResponse([
        makeLetter({
          metadataContentStatus: "EMPTY",
          metadata: {
            sender: "",
            recipient: "",
            dateRaw: "19470810",
            verified: false,
          },
        }),
      ]),
    );

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Select Test Letter" }));
    await user.click(
      await screen.findByRole("button", { name: /Extract Metadata \(1\)/ }),
    );

    expect(screen.getByLabelText("Sender")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
    expect(
      screen.queryByText(/Extract metadata for 1 selected letter\?/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the bulk confirmation flow when more than one letter is selected", async () => {
    const user = userEvent.setup();

    getAdminLettersMock.mockResolvedValue(
      createLettersResponse([
        makeLetter({
          id: "letter-1",
          title: "Letter One",
          metadataContentStatus: "EMPTY",
        }),
        makeLetter({
          id: "letter-2",
          title: "Letter Two",
          metadataContentStatus: "EMPTY",
        }),
      ]),
    );

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Select Letter One" }));
    await user.click(await screen.findByRole("button", { name: "Select Letter Two" }));
    await user.click(
      await screen.findByRole("button", { name: /Extract Metadata \(2\)/ }),
    );

    expect(
      screen.getByText(/Extract metadata for 2 selected letters\?/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Sender")).not.toBeInTheDocument();
  });

  it("submits single-letter extraction with the provided sender and recipient", async () => {
    const user = userEvent.setup();

    getAdminLettersMock.mockResolvedValue(
      createLettersResponse([
        makeLetter({
          metadataContentStatus: "EMPTY",
          metadata: {
            sender: "",
            recipient: "",
            dateRaw: "19470810",
            verified: false,
          },
        }),
      ]),
    );
    confirmTranscriptMock.mockResolvedValue(
      makeLetter({
        metadataContentStatus: "AI_DRAFT",
        transcriptConfirmedAt: "2026-03-30T12:00:00.000Z",
      }),
    );

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Select Test Letter" }));
    await user.click(
      await screen.findByRole("button", { name: /Extract Metadata \(1\)/ }),
    );

    await user.type(screen.getByLabelText("Sender"), "Mabel");
    await user.type(screen.getByLabelText("Recipient"), "Theo");
    await user.click(screen.getByRole("button", { name: "Extract Metadata" }));

    await waitFor(() => {
      expect(confirmTranscriptMock).toHaveBeenCalledWith("letter-1", {
        confirmedSender: "Mabel",
        confirmedRecipient: "Theo",
      });
    });
    expect(regenerateMetadataMock).not.toHaveBeenCalled();
  });
});
