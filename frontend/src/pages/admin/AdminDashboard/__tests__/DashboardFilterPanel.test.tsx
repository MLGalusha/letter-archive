import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardFilterPanel from "../DashboardFilterPanel";
import type { DashboardFilterStats } from "../types";
import type { DashboardFilterControls } from "../useDashboardFilters";

const emptyStats: DashboardFilterStats = {
  total: 0,
  published: 0,
  hidden: 0,
  flagged: 0,
  uploaded: 0,
  transcribing: 0,
  transcribed: 0,
  metadataExtracting: 0,
  metadataReady: 0,
  reviewed: 0,
  transcriptEmpty: 0,
  transcriptAiDraft: 0,
  transcriptEdited: 0,
  transcriptVerified: 0,
  metadataEmpty: 0,
  metadataAiDraft: 0,
  metadataEdited: 0,
  metadataVerified: 0,
  extraContentEmpty: 0,
  extraContentAiDraft: 0,
  extraContentEdited: 0,
  extraContentVerified: 0,
};

function makeFilters(overrides: Partial<DashboardFilterControls> = {}): DashboardFilterControls {
  return {
    collectionInput: "",
    handleCollectionInputChange: vi.fn(),
    visibilityFilter: "ALL",
    toggleVisibilityFilter: vi.fn(),
    contentFilterView: "transcript",
    setContentFilterView: vi.fn(),
    transcriptStatusFilters: [],
    toggleTranscriptFilter: vi.fn(),
    metadataStatusFilters: [],
    toggleMetadataFilter: vi.fn(),
    extraContentStatusFilters: [],
    toggleExtraContentFilter: vi.fn(),
    workflowFilters: [],
    toggleWorkflowFilter: vi.fn(),
    flaggedFilter: "ALL",
    toggleFlaggedFilter: vi.fn(),
    dateMode: "specific",
    setDateMode: vi.fn(),
    hasDateFilter: false,
    yearFilter: null,
    setYearFilter: vi.fn(),
    monthFilter: null,
    setMonthFilter: vi.fn(),
    dayFilter: null,
    setDayFilter: vi.fn(),
    dateFromFilter: null,
    setDateFromFilter: vi.fn(),
    dateToFilter: null,
    setDateToFilter: vi.fn(),
    clearDateFilters: vi.fn(),
    handleClearAllFilters: vi.fn(),
    ...overrides,
  } as unknown as DashboardFilterControls;
}

function renderFilterPanel(overrides: Partial<ComponentProps<typeof DashboardFilterPanel>> = {}) {
  const props: ComponentProps<typeof DashboardFilterPanel> = {
    open: true,
    stats: emptyStats,
    filters: makeFilters(),
    getDateButtonText: () => "Date",
    dateRawToDisplay: (dateRaw) => dateRaw ?? "",
    displayToDateRaw: (display) => display || null,
    activeFilterCount: 0,
    onClose: vi.fn(),
    ...overrides,
  };

  render(<DashboardFilterPanel {...props} />);
  return props;
}

describe("DashboardFilterPanel", () => {
  it("shows active filter count and routes clear/close actions", async () => {
    const user = userEvent.setup();
    const filters = makeFilters({ handleClearAllFilters: vi.fn() });
    const onClose = vi.fn();

    renderFilterPanel({
      filters,
      activeFilterCount: 2,
      onClose,
    });

    expect(screen.getByText("2 active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Close filters" }));

    expect(filters.handleClearAllFilters).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not show the clear action without active filters", () => {
    renderFilterPanel({ activeFilterCount: 0 });

    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("routes collection input changes through the filter controller", async () => {
    const handleCollectionInputChange = vi.fn();
    const filters = makeFilters({ handleCollectionInputChange });

    renderFilterPanel({ filters });

    fireEvent.change(screen.getByRole("textbox", { name: "Collection" }), {
      target: { value: "123" },
    });

    expect(handleCollectionInputChange).toHaveBeenLastCalledWith("123");
  });
});
