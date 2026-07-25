import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminLetterSummary,
  ContentStatus,
  LetterImageType,
} from "../../../../types/Letter";
import {
  emptyAdminLetterPageCounts,
  makeAdminLetterSummary as makeSummary,
} from "../../../../test/adminLetterSummary";
import RecentActivityTable from "../RecentActivityTable";
import type { TableCopyEditModel, TableSelectionModel } from "../RecentActivityTable";
import type { ColumnDef } from "../types";

describe("RecentActivityTable", () => {
  function renderRecentActivityTable({
    selectedIds = new Set<string>(),
    onRowClick = vi.fn(),
    onCheckboxChange = vi.fn(),
    onCellClick = vi.fn(),
    showColumnMenu = false,
    onCloseColumnMenu = vi.fn(),
    letter = makeSummary(),
    orderedColumns = [
      { id: "sender", label: "Sender", defaultVisible: true },
      { id: "recipient", label: "Recipient", defaultVisible: true },
      { id: "date", label: "Letter date", defaultVisible: true },
      { id: "flag", label: "Review flag", defaultVisible: true },
    ],
    getCombinedTranscriptStatus = vi.fn(() => "AI_DRAFT" as const),
  }: {
    selectedIds?: Set<string>;
    onRowClick?: TableSelectionModel["onRowClick"];
    onCheckboxChange?: TableSelectionModel["onCheckboxChange"];
    onCellClick?: TableCopyEditModel["onCellClick"];
    showColumnMenu?: boolean;
    onCloseColumnMenu?: () => void;
    letter?: AdminLetterSummary;
    orderedColumns?: ColumnDef[];
    getCombinedTranscriptStatus?: (
      transcriptStatus: ContentStatus,
      extraContentStatus: ContentStatus,
      hasLetterPages: boolean,
      hasExtras: boolean,
    ) => ContentStatus;
  } = {}) {
    render(
      <RecentActivityTable
        filteredLetters={[letter]}
        columns={{
          visibleColumns: new Set(orderedColumns.map(({ id }) => id)),
          orderedColumns,
          showColumnMenu,
          onToggleColumnMenu: vi.fn(),
          onCloseColumnMenu,
          onToggleColumn: vi.fn(),
          onMoveColumn: vi.fn(),
          onReorderColumn: vi.fn(),
          onResetColumnOrder: vi.fn(),
        }}
        selection={{
          selectedIds,
          onRowClick,
          onRowMouseDown: vi.fn(),
          onRowMouseEnter: vi.fn(),
          onCheckboxChange,
        }}
        copyEdit={{
          editMode: false,
          copyModeActive: true,
          sourceCell: null,
          pendingChanges: new Map(),
          onCellClick,
        }}
        formatting={{
          formatDate: () => "1/1/2025",
          formatDateRaw: () => "03/14/1886",
          getCombinedTranscriptStatus,
          renderStatusIcon: (status: ContentStatus, type: "T" | "M") => <span>{`${type}:${status}`}</span>,
        }}
        pagination={{
          pagination: { page: 1, totalPages: 1 },
          loading: false,
          onPageChange: vi.fn(),
        }}
        rowActions={{ onToggleFlag: vi.fn() }}
      />,
    );

    return {
      onCellClick,
      onCheckboxChange,
      onCloseColumnMenu,
      onRowClick,
      getCombinedTranscriptStatus,
    };
  }

  it("renders rows and forwards table interactions", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();

    renderRecentActivityTable({ onCellClick });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: /Sender/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure columns" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("columnheader", { name: "Review flag" })).toBeInTheDocument();

    await user.click(screen.getByText("Alice"));
    expect(onCellClick).toHaveBeenCalled();
  });

  it("renders column settings in the shared manager dialog", () => {
    renderRecentActivityTable({ showColumnMenu: true });

    expect(screen.getByRole("dialog", { name: "Column settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("dismisses column settings from outside its locally owned boundary", async () => {
    const user = userEvent.setup();
    const onCloseColumnMenu = vi.fn();
    renderRecentActivityTable({
      showColumnMenu: true,
      onCloseColumnMenu,
    });

    await user.click(screen.getByText("Alice"));

    expect(onCloseColumnMenu).toHaveBeenCalledOnce();
  });

  it("exposes selected rows through checkbox and row state", () => {
    renderRecentActivityTable({ selectedIds: new Set(["letter-1"]) });

    const checkbox = screen.getByRole("checkbox", { name: "Select Test Letter" });
    expect(checkbox).toBeChecked();
    expect(checkbox.closest("tr")).toHaveAttribute("aria-selected", "true");
  });

  it("uses the row checkbox without triggering row open", async () => {
    const user = userEvent.setup();
    const onCheckboxChange = vi.fn();
    const onRowClick = vi.fn();
    renderRecentActivityTable({ onCheckboxChange, onRowClick });

    await user.click(screen.getByRole("checkbox", { name: "Select Test Letter" }));

    expect(onCheckboxChange).toHaveBeenCalledWith("letter-1", 0, { shiftKey: false });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("keeps row checkboxes keyboard focusable", async () => {
    const user = userEvent.setup();
    renderRecentActivityTable();

    await user.tab();
    await user.tab();
    await user.tab();

    expect(screen.getByRole("checkbox", { name: "Select Test Letter" })).toHaveFocus();
  });

  it("renders every count column from authoritative group-wide type counts", () => {
    const orderedColumns: ColumnDef[] = [
      { id: "letters", label: "Letters", defaultVisible: true },
      { id: "extras", label: "Extras", defaultVisible: true },
      { id: "photos", label: "Photos", defaultVisible: true },
      ...([
        "letter",
        "photo",
        "cover",
        "telegram",
        "card",
        "ephemera",
        "voice",
        "article",
        "diary",
      ] satisfies LetterImageType[]).map((type) => ({
        id: `type_${type}` as const,
        label: type,
        defaultVisible: true,
      })),
    ];
    const pageCountsByType = {
      letter: 1,
      photo: 2,
      cover: 3,
      telegram: 4,
      card: 5,
      ephemera: 6,
      voice: 7,
      article: 8,
      diary: 9,
    };

    renderRecentActivityTable({
      letter: makeSummary({ pageCountsByType }),
      orderedColumns,
    });

    expect(document.querySelector('tbody [data-column="letters"]')).toHaveTextContent("1");
    expect(document.querySelector('tbody [data-column="extras"]')).toHaveTextContent("44");
    expect(document.querySelector('tbody [data-column="photos"]')).toHaveTextContent("2");
    Object.entries(pageCountsByType).forEach(([type, count]) => {
      expect(document.querySelector(`tbody [data-column="type_${type}"]`))
        .toHaveTextContent(String(count));
    });
  });

  it.each([
    "cover",
    "telegram",
    "ephemera",
  ] satisfies LetterImageType[])(
    "combines %s companion status for a letter representative",
    (extraType) => {
      const getCombinedTranscriptStatus = vi.fn(() => "EDITED" as const);
      renderRecentActivityTable({
        letter: makeSummary({
          pageCountsByType: {
            ...emptyAdminLetterPageCounts(),
            letter: 1,
            [extraType]: 1,
          },
          transcriptStatus: "AI_DRAFT",
          extraContentStatus: "EDITED",
        }),
        orderedColumns: [
          { id: "transcript", label: "Transcript", defaultVisible: true },
        ],
        getCombinedTranscriptStatus,
      });

      expect(getCombinedTranscriptStatus).toHaveBeenCalledWith(
        "AI_DRAFT",
        "EDITED",
        true,
        true,
      );
    },
  );

  it.each([
    "photo",
    "card",
    "voice",
    "article",
    "diary",
  ] satisfies LetterImageType[])(
    "does not treat %s companion pages as combined extra transcription",
    (otherType) => {
      const getCombinedTranscriptStatus = vi.fn(() => "AI_DRAFT" as const);
      renderRecentActivityTable({
        letter: makeSummary({
          pageCountsByType: {
            ...emptyAdminLetterPageCounts(),
            letter: 1,
            [otherType]: 1,
          },
        }),
        orderedColumns: [
          { id: "transcript", label: "Transcript", defaultVisible: true },
        ],
        getCombinedTranscriptStatus,
      });

      expect(getCombinedTranscriptStatus).toHaveBeenCalledWith(
        "AI_DRAFT",
        "EMPTY",
        true,
        false,
      );
    },
  );

  it("uses photo-description status for a standalone photo representative", () => {
    const getCombinedTranscriptStatus = vi.fn(() => "EMPTY" as const);
    renderRecentActivityTable({
      letter: makeSummary({
        primaryImageType: "photo",
        pageCountsByType: {
          ...emptyAdminLetterPageCounts(),
          photo: 2,
        },
        photoDescriptionStatus: "VERIFIED",
        transcriptStatus: "AI_DRAFT",
      }),
      orderedColumns: [
        { id: "transcript", label: "Transcript", defaultVisible: true },
      ],
      getCombinedTranscriptStatus,
    });

    expect(screen.getByText("T:VERIFIED")).toBeInTheDocument();
    expect(getCombinedTranscriptStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["cover", true],
    ["telegram", true],
    ["card", true],
    ["ephemera", true],
    ["article", true],
    ["diary", true],
    ["voice", false],
  ] satisfies Array<[LetterImageType, boolean]>)(
    "preserves transcript applicability for a %s representative",
    (primaryImageType, hasPrimaryTranscript) => {
      const getCombinedTranscriptStatus = vi.fn(
        (
          _transcriptStatus: ContentStatus,
          _extraContentStatus: ContentStatus,
          hasPrimary: boolean,
        ) => hasPrimary ? "EDITED" as const : "EMPTY" as const,
      );
      renderRecentActivityTable({
        letter: makeSummary({
          primaryImageType,
          pageCountsByType: {
            ...emptyAdminLetterPageCounts(),
            [primaryImageType]: 1,
          },
          transcriptStatus: "EDITED",
          extraContentStatus: "VERIFIED",
        }),
        orderedColumns: [
          { id: "transcript", label: "Transcript", defaultVisible: true },
        ],
        getCombinedTranscriptStatus,
      });

      expect(getCombinedTranscriptStatus).toHaveBeenCalledWith(
        "EDITED",
        "VERIFIED",
        hasPrimaryTranscript,
        false,
      );
      expect(screen.getByText(
        hasPrimaryTranscript ? "T:EDITED" : "T:EMPTY",
      )).toBeInTheDocument();
    },
  );
});
