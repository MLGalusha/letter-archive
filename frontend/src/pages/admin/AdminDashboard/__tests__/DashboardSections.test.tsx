import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Letter } from "../../../../types/Letter";
import type { ContentStatus } from "../../../../types/Letter";
import RecentActivityTable from "../RecentActivityTable";

function makeLetter(): Letter {
  return {
    id: "letter-1",
    title: "Test Letter",
    collectionCode: "001",
    images: [{ id: "img-1", type: "letter", imageUrl: "test.jpg" }],
    transcript: { pages: [], fullText: "hello", verified: false },
    metadata: { sender: "Alice", recipient: "Bob", dateRaw: "18860314", verified: false },
    status: "uploaded",
    workflowState: "UPLOADED",
    visibility: "HIDDEN",
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: "AI_DRAFT",
    metadataContentStatus: "AI_DRAFT",
    extraContentStatus: "EMPTY",
    flagged: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    lettersCount: 1,
    extrasCount: 0,
  };
}

describe("RecentActivityTable", () => {
  it("renders rows and forwards table interactions", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();

    render(
      <RecentActivityTable
        filteredLetters={[makeLetter()]}
        columns={{
          visibleColumns: new Set([
            "sender",
            "recipient",
            "date",
            "collection",
            "letters",
            "extras",
            "transcript",
            "metadata",
            "visibility",
            "created",
          ]),
          orderedColumns: [
            { id: "sender", label: "Sender", defaultVisible: true },
            { id: "recipient", label: "Recipient", defaultVisible: true },
            { id: "date", label: "Letter date", defaultVisible: true },
          ],
          showColumnMenu: false,
          onToggleColumnMenu: vi.fn(),
          onToggleColumn: vi.fn(),
          onMoveColumn: vi.fn(),
          onReorderColumn: vi.fn(),
          onResetColumnOrder: vi.fn(),
          columnMenuRef: createRef<HTMLTableCellElement>(),
        }}
        selection={{
          selectedIds: new Set(),
          onRowClick: vi.fn(),
          onRowMouseDown: vi.fn(),
          onRowMouseEnter: vi.fn(),
          onCheckboxChange: vi.fn(),
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
          getCombinedTranscriptStatus: () => "AI_DRAFT",
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

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: /Sender/ })).toBeInTheDocument();

    await user.click(screen.getByText("Alice"));
    expect(onCellClick).toHaveBeenCalled();
  });
});
