import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardFilterPanel from "../DashboardFilterPanel";
import {
  emptyDashboardFilterStats,
  makeDashboardFilterActions,
  makeDashboardFilterDrafts,
  makeDashboardFilterState,
} from "./dashboardFilterFixtures";

function renderFilterPanel(
  overrides: Partial<ComponentProps<typeof DashboardFilterPanel>> = {},
) {
  const props: ComponentProps<typeof DashboardFilterPanel> = {
    open: true,
    stats: emptyDashboardFilterStats,
    filterState: makeDashboardFilterState(),
    filterDrafts: makeDashboardFilterDrafts(),
    filterActions: makeDashboardFilterActions(),
    dateButtonText: "Date",
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
    const clearAllFilters = vi.fn();
    const onClose = vi.fn();

    renderFilterPanel({
      filterActions: makeDashboardFilterActions({ clearAllFilters }),
      activeFilterCount: 2,
      onClose,
    });

    expect(screen.getByText("2 active")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(
      screen.getByRole("button", { name: "Close filters" }),
    );

    expect(clearAllFilters).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not show the clear action without active filters", () => {
    renderFilterPanel({ activeFilterCount: 0 });

    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });

  it("routes collection drafts and additions through named actions", () => {
    const changeCollectionInput = vi.fn();
    const addCollectionFilter = vi.fn();
    const filterActions = makeDashboardFilterActions({
      changeCollectionInput,
      addCollectionFilter,
    });

    renderFilterPanel({ filterActions });

    fireEvent.change(
      screen.getByRole("textbox", { name: "Collection code" }),
      { target: { value: "123" } },
    );

    expect(changeCollectionInput).toHaveBeenLastCalledWith("123");

    cleanup();
    renderFilterPanel({
      filterDrafts: makeDashboardFilterDrafts({
        collectionInput: "123",
      }),
      filterActions,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add collection filter" }),
    );

    expect(addCollectionFilter).toHaveBeenCalledOnce();
  });

  it("clears every collection through one atomic action", async () => {
    const user = userEvent.setup();
    const clearCollectionFilters = vi.fn();
    const removeCollectionFilter = vi.fn();

    renderFilterPanel({
      filterState: makeDashboardFilterState({
        query: { collectionFilter: "003,009" },
      }),
      filterActions: makeDashboardFilterActions({
        clearCollectionFilters,
        removeCollectionFilter,
      }),
    });

    await user.click(
      screen.getByRole("button", { name: "Clear collection filters" }),
    );

    expect(clearCollectionFilters).toHaveBeenCalledOnce();
    expect(removeCollectionFilter).not.toHaveBeenCalled();
  });

  it("routes cleanup and content-shape filters through named actions", async () => {
    const user = userEvent.setup();
    const toggleMissingFilter = vi.fn();
    const toggleContentShapeFilter = vi.fn();

    renderFilterPanel({
      filterActions: makeDashboardFilterActions({
        toggleMissingFilter,
        toggleContentShapeFilter,
      }),
      stats: {
        ...emptyDashboardFilterStats,
        missingSender: 4,
        hasPhotos: 3,
      },
    });

    await user.click(
      screen.getByRole("button", { name: "Missing sender 4" }),
    );
    await user.click(screen.getByRole("button", { name: "Photos 3" }));

    expect(toggleMissingFilter).toHaveBeenCalledWith("sender");
    expect(toggleContentShapeFilter).toHaveBeenCalledWith("photos");
  });

  it("routes visibility, content, workflow, and flag intents correctly", async () => {
    const user = userEvent.setup();
    const toggleVisibilityFilter = vi.fn();
    const toggleTranscriptFilter = vi.fn();
    const toggleMetadataFilter = vi.fn();
    const toggleExtraContentFilter = vi.fn();
    const toggleWorkflowFilter = vi.fn();
    const toggleFlaggedFilter = vi.fn();
    const changeContentFilterView = vi.fn();
    const filterActions = makeDashboardFilterActions({
      changeContentFilterView,
      toggleVisibilityFilter,
      toggleTranscriptFilter,
      toggleMetadataFilter,
      toggleExtraContentFilter,
      toggleWorkflowFilter,
      toggleFlaggedFilter,
    });

    renderFilterPanel({
      filterActions,
    });

    await user.click(screen.getByRole("button", { name: "Public 0" }));
    await user.click(screen.getByRole("button", { name: "Draft 0" }));
    await user.click(
      screen.getByRole("button", { name: /^Metadata$/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /^Extras$/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Awaiting transcript 0" }),
    );
    await user.click(screen.getByRole("button", { name: "Flagged 0" }));

    expect(changeContentFilterView).toHaveBeenNthCalledWith(1, "metadata");
    expect(changeContentFilterView).toHaveBeenNthCalledWith(2, "extras");
    expect(toggleVisibilityFilter).toHaveBeenCalledWith("PUBLISHED");
    expect(toggleTranscriptFilter).toHaveBeenCalledWith("AI_DRAFT");
    expect(toggleWorkflowFilter).toHaveBeenCalledWith("UPLOADED");
    expect(toggleFlaggedFilter).toHaveBeenCalledWith("FLAGGED");

    cleanup();
    renderFilterPanel({
      filterDrafts: makeDashboardFilterDrafts({
        contentFilterView: "metadata",
      }),
      filterActions,
    });
    await user.click(screen.getByRole("button", { name: "Edited 0" }));
    expect(toggleMetadataFilter).toHaveBeenCalledWith("EDITED");

    cleanup();
    renderFilterPanel({
      filterDrafts: makeDashboardFilterDrafts({
        contentFilterView: "extras",
      }),
      filterActions,
    });
    await user.click(screen.getByRole("button", { name: "Done 0" }));
    expect(toggleExtraContentFilter).toHaveBeenCalledWith("VERIFIED");
  });
});
