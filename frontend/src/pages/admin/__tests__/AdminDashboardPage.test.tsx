import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { Letter } from "../../../types/Letter";

const {
  confirmTranscriptMock,
  getAdminLettersMock,
  getFilteredLetterSourcesMock,
  deleteLetterMock,
  toggleLetterFlagMock,
  regenerateMetadataMock,
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
  getFilteredLetterSourcesMock: vi.fn(),
  deleteLetterMock: vi.fn(),
  toggleLetterFlagMock: vi.fn(),
  regenerateMetadataMock: vi.fn(),
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
  getFilteredLetterSources: (...args: unknown[]) => (
    getFilteredLetterSourcesMock(...args)
  ),
  deleteLetter: (...args: unknown[]) => deleteLetterMock(...args),
}));

vi.mock("../../../api/admin/letters", () => ({
  toggleLetterFlag: (...args: unknown[]) => toggleLetterFlagMock(...args),
}));

vi.mock("../../../api/admin", () => ({
  confirmTranscript: (...args: unknown[]) => confirmTranscriptMock(...args),
  regenerateMetadata: (...args: unknown[]) => regenerateMetadataMock(...args),
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
    columns,
    selection,
  }: {
    filteredLetters: Letter[];
    columns: {
      showColumnMenu: boolean;
      onToggleColumnMenu: () => void;
      onCloseColumnMenu: () => void;
    };
    selection: {
      onCheckboxChange: (letterId: string, index: number, options?: { shiftKey?: boolean }) => void;
      selectedIds: Set<string>;
    };
  }) => (
    <div>
      <div>Recent activity table</div>
      <button
        type="button"
        aria-expanded={columns.showColumnMenu}
        onClick={columns.onToggleColumnMenu}
      >
        Configure columns
      </button>
      {columns.showColumnMenu && (
        <div role="dialog" aria-label="Column settings">
          <button type="button" onClick={columns.onCloseColumnMenu}>
            Close columns
          </button>
        </div>
      )}
      {filteredLetters.map((letter, index) => (
        <button
          key={letter.id}
          type="button"
          onClick={(event) => selection.onCheckboxChange(letter.id, index, { shiftKey: event.shiftKey })}
        >
          {selection.selectedIds.has(letter.id) ? `Selected ${letter.title}` : `Select ${letter.title}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../AdminCollectionsListPage", () => ({
  default: () => <div>Collections dashboard</div>,
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
    primarySourceRevision: 0,
    images: [{ id: "img-1", type: "letter", imageUrl: "test.jpg" }],
    transcript: { pages: [], fullText: "hello", verified: false },
    metadata: { sender: "Alice", recipient: "Bob", dateRaw: "19470810", verified: false },
    status: "uploaded",
    workflowState: "UPLOADED",
    visibility: "HIDDEN",
    transcriptPublished: false,
    metadataPublished: false,
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
      transcribing: 0,
      transcribed: 0,
      metadataExtracting: 0,
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
      extraContent: {
        empty: letters.length,
        aiDraft: 0,
        edited: 0,
        verified: 0,
      },
    },
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe("AdminDashboard processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isAuthenticatedMock.mockReturnValue(true);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    getAdminLettersMock.mockResolvedValue(createLettersResponse());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("closes every dashboard manager when the mobile admin nav opens", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /Filters/i }));
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("admin-mobile-nav-open"));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Filters" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save view" }));
    expect(screen.getByRole("dialog", { name: "Saved views" })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("admin-mobile-nav-open"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Saved views" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Sort/i }));
    expect(screen.getByRole("dialog", { name: "Sort rules" })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("admin-mobile-nav-open"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Sort rules" })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Configure columns" }));
    expect(screen.getByRole("dialog", { name: "Column settings" })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("admin-mobile-nav-open"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Column settings" })).not.toBeInTheDocument();
    });
  });

  it("keeps only one letter dashboard manager open at a time", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Configure columns" }));
    expect(screen.getByRole("dialog", { name: "Column settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save view" }));

    expect(screen.queryByRole("dialog", { name: "Column settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Saved views" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Sort/i }));

    expect(screen.queryByRole("dialog", { name: "Saved views" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sort rules" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/i }));

    expect(screen.queryByRole("dialog", { name: "Sort rules" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();
  });

  it("does not reopen a letter manager after visiting Collections", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /Filters/i }));
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collections" }));
    expect(screen.getByText("Collections dashboard")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Letters" }));

    expect(screen.queryByRole("heading", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps the active manager open when the selected view is clicked again", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    const filtersTrigger = await screen.findByRole("button", { name: /Filters/i });
    await user.click(filtersTrigger);
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Letters" }));

    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();
    expect(filtersTrigger).toHaveAttribute("aria-expanded", "true");
  });

  it("preserves selection for Columns while toolbar managers retain mobile dismissal", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Select Test Letter" }));
    expect(screen.getByRole("button", { name: "Selected Test Letter" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Configure columns" }));
    expect(screen.getByRole("button", { name: "Selected Test Letter" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.getByRole("button", { name: "Select Test Letter" })).toBeInTheDocument();
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

    expect(
      screen.getByRole("heading", { name: "Generate Metadata" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Sender")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
    expect(
      screen.queryByText(/Queue metadata extraction for 1 selected letter\?/i),
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
      screen.getByText(/Queue metadata extraction for 2 selected letters\?/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Sender")).not.toBeInTheDocument();
  });

  it("submits single-letter generation with the provided sender and recipient", async () => {
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
    await user.click(screen.getByRole("button", { name: "Generate Metadata" }));
    expect(
      screen.queryByRole("heading", { name: "Generate Metadata" }),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(confirmTranscriptMock).toHaveBeenCalledWith(
        "letter-1",
        0,
        {
          confirmedSender: "Mabel",
          confirmedRecipient: "Theo",
        },
      );
    });
    expect(regenerateMetadataMock).not.toHaveBeenCalled();
  });

  it("shows generate copy after metadata has been cleared even when the transcript is confirmed", async () => {
    const user = userEvent.setup();

    getAdminLettersMock.mockResolvedValue(
      createLettersResponse([
        makeLetter({
          metadataContentStatus: "EMPTY",
          transcriptConfirmedAt: "2026-03-30T12:00:00.000Z",
          metadata: {
            sender: "",
            recipient: "",
            dateRaw: "19470810",
            verified: false,
          },
        }),
      ]),
    );
    regenerateMetadataMock.mockResolvedValue(
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

    expect(
      screen.getByRole("heading", { name: "Generate Metadata" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate Metadata" }));

    await waitFor(() => {
      expect(regenerateMetadataMock).toHaveBeenCalledWith(
        "letter-1",
        0,
        {
          confirmedRecipient: undefined,
          confirmedSender: undefined,
        },
      );
    });
    expect(showToastMock).toHaveBeenCalledWith("Metadata generated", "success");
  });
});
