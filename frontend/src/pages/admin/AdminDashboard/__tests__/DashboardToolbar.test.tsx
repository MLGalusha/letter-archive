import { useState, type Dispatch, type SetStateAction } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardToolbar from "../DashboardToolbar";
import type { DashboardFilterControls } from "../useDashboardFilters";
import type { DashboardFilterStats, DashboardView } from "../types";

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
  missingSender: 0,
  missingRecipient: 0,
  missingDate: 0,
  hasExtras: 0,
  hasPhotos: 0,
  hasCover: 0,
  hasTelegram: 0,
  hasCard: 0,
  hasEphemera: 0,
  hasArticle: 0,
  hasDiary: 0,
  hasVoice: 0,
};

function makeFilters(overrides: Partial<DashboardFilterControls> = {}): DashboardFilterControls {
  return {
    collectionInput: "",
    collectionFilter: "all",
    collectionFilters: [],
    handleCollectionInputChange: vi.fn(),
    addCollectionFilter: vi.fn(),
    removeCollectionFilter: vi.fn(),
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
    missingFilters: [],
    toggleMissingFilter: vi.fn(),
    contentShapeFilters: [],
    toggleContentShapeFilter: vi.fn(),
    searchInput: "",
    setSearchInput: vi.fn(),
    searchQuery: "",
    setSearchQuery: vi.fn(),
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
  } as DashboardFilterControls;
}

function ToolbarHarness({
  initialView = "letters",
  filters = makeFilters(),
}: {
  initialView?: DashboardView;
  filters?: DashboardFilterControls;
}) {
  const [dashboardView, setDashboardView] = useState<DashboardView>(initialView);
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <DashboardToolbar
      dashboardView={dashboardView}
      onDashboardViewChange={setDashboardView}
      filtersOpen={filtersOpen}
      onFiltersOpenChange={setFiltersOpen as Dispatch<SetStateAction<boolean>>}
      paginationTotal={12}
      stats={emptyStats}
      sortColumns={[{ field: "lastOpenedAt", direction: "desc" }]}
      setSortColumns={vi.fn()}
      savedViews={[]}
      onSaveView={vi.fn()}
      onApplyView={vi.fn()}
      onDeleteView={vi.fn()}
      filters={filters}
      getDateButtonText={() => "Date"}
      dateRawToDisplay={(dateRaw) => dateRaw ?? ""}
      displayToDateRaw={(display) => display || null}
      processingStatus={null}
      selectedCount={0}
    />
  );
}

describe("DashboardToolbar", () => {
  it("opens and closes the mobile filter panel from the toolbar", async () => {
    const user = userEvent.setup();
    render(<ToolbarHarness />);

    const trigger = screen.getByRole("button", { name: /Filters/ });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();
    const closeButtons = screen.getAllByRole("button", { name: "Close filters" });
    expect(closeButtons).toHaveLength(2);

    await user.click(closeButtons[1]);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Close filters" })).not.toBeInTheDocument();
  });

  it("routes active search chip clearing through filter state", async () => {
    const user = userEvent.setup();
    const setSearchInput = vi.fn();
    const setSearchQuery = vi.fn();
    const handleClearAllFilters = vi.fn();

    render(
      <ToolbarHarness
        filters={makeFilters({
          searchInput: "molly",
          searchQuery: "molly",
          setSearchInput,
          setSearchQuery,
          handleClearAllFilters,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Search: molly/ }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(setSearchInput).toHaveBeenCalledWith("");
    expect(setSearchQuery).toHaveBeenCalledWith("");
    expect(handleClearAllFilters).toHaveBeenCalled();
  });

  it("hides letter-only controls when switching to collections", async () => {
    const user = userEvent.setup();
    render(<ToolbarHarness />);

    expect(screen.getByPlaceholderText("Search letters, senders, recipients...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collections" }));

    expect(screen.queryByPlaceholderText("Search letters, senders, recipients...")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
  });
});
