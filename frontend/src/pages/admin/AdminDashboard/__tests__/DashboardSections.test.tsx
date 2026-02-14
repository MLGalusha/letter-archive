import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Letter } from "../../../../types/Letter";
import DashboardFilterBar from "../DashboardFilterBar";
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

describe("DashboardFilterBar", () => {
  it("fires filter callbacks", async () => {
    const user = userEvent.setup();
    const onToggleVisibilityFilter = vi.fn();
    const onToggleDateDropdown = vi.fn();
    const onClearAllFilters = vi.fn();

    render(
      <DashboardFilterBar
        visibilityFilter="ALL"
        onToggleVisibilityFilter={onToggleVisibilityFilter}
        contentFilterView="transcript"
        onContentFilterViewChange={vi.fn()}
        transcriptStatusFilters={[]}
        metadataStatusFilters={[]}
        onToggleTranscriptFilter={vi.fn()}
        onToggleMetadataFilter={vi.fn()}
        collectionInput=""
        onCollectionInputChange={vi.fn()}
        dateDropdownRef={createRef<HTMLDivElement>()}
        showDateDropdown={false}
        hasDateFilter={false}
        dateButtonText="Date"
        onToggleDateDropdown={onToggleDateDropdown}
        dateMode="specific"
        onDateModeChange={vi.fn()}
        yearFilter={null}
        monthFilter={null}
        dayFilter={null}
        onYearFilterChange={vi.fn()}
        onMonthFilterChange={vi.fn()}
        onDayFilterChange={vi.fn()}
        yearOptions={[1880]}
        monthOptions={[{ value: 1, label: "Jan" }]}
        dayOptions={[1]}
        dateFromFilter={null}
        dateToFilter={null}
        dateRawToDisplay={() => ""}
        displayToDateRaw={() => null}
        onDateFromChange={vi.fn()}
        onDateToChange={vi.fn()}
        onClearDateFilters={vi.fn()}
        searchInput=""
        onSearchInputChange={vi.fn()}
        activeFilterCount={1}
        onClearAllFilters={onClearAllFilters}
        processingStatus={null}
        pagination={{ page: 1, limit: 50, total: 1 }}
        stats={{
          published: 2,
          hidden: 3,
          transcriptAiDraft: 1,
          transcriptEdited: 0,
          transcriptVerified: 0,
          metadataAiDraft: 0,
          metadataEdited: 0,
          metadataVerified: 0,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "2 Pub" }));
    expect(onToggleVisibilityFilter).toHaveBeenCalledWith("PUBLISHED");

    await user.click(screen.getByRole("button", { name: /Date/ }));
    expect(onToggleDateDropdown).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear All" }));
    expect(onClearAllFilters).toHaveBeenCalled();
  });
});

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
