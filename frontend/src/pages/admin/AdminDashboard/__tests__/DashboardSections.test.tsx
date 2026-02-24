import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Letter } from "../../../../types/Letter";
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
    transcriptStatus: "AI_DRAFT",
    metadataContentStatus: "AI_DRAFT",
    extraContentStatus: "EMPTY",
    createdAt: "2025-01-01T00:00:00.000Z",
    lettersCount: 1,
    extrasCount: 0,
  };
}

describe("RecentActivityTable", () => {
  it("renders rows and forwards table interactions", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const onCellClick = vi.fn();

    render(
      <RecentActivityTable
        filteredLetters={[makeLetter()]}
        visibleColumns={new Set([
          "sender",
          "recipient",
          "date",
          "collection",
          "letters",
          "extras",
          "transcript",
          "metadata",
          "sync",
          "visibility",
          "created",
        ])}
        getSortInfo={() => null}
        onSort={onSort}
        onRowClick={vi.fn()}
        onRowMouseDown={vi.fn()}
        onRowMouseEnter={vi.fn()}
        selectedIds={new Set()}
        editMode={false}
        copyModeActive
        sourceCell={null}
        pendingChanges={new Map()}
        onCellClick={onCellClick}
        formatDate={() => "1/1/2025"}
        formatDateRaw={() => "03/14/1886"}
        checkNeedsSync={() => false}
        getCombinedTranscriptStatus={() => "AI_DRAFT"}
        renderStatusIcon={(status, type) => <span>{`${type}:${status}`}</span>}
        pagination={{ page: 1, totalPages: 1 }}
        loading={false}
        onPageChange={vi.fn()}
        allColumns={[
          { id: "sender", label: "Sender" },
          { id: "recipient", label: "Recipient" },
          { id: "date", label: "Date" },
        ]}
        showColumnMenu={false}
        onToggleColumnMenu={vi.fn()}
        onToggleColumn={vi.fn()}
        columnMenuRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await user.click(screen.getByRole("columnheader", { name: /Sender/ }));
    expect(onSort).toHaveBeenCalledWith("sender");

    await user.click(screen.getByText("Alice"));
    expect(onCellClick).toHaveBeenCalled();
  });
});
