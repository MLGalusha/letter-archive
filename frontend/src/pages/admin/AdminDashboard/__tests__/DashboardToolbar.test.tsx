import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardToolbar from "../DashboardToolbar";
import { MAX_DASHBOARD_SEARCH_LENGTH } from "../constants";
import { useDashboardManagerState } from "../useDashboardManagerState";
import type { DashboardFilterState } from "../dashboardFilterStateModel";
import type {
  DashboardFilterActions,
  DashboardFilterDrafts,
} from "../useDashboardFilters";
import type { DashboardView } from "../types";
import {
  emptyDashboardFilterStats,
  makeDashboardFilterActions,
  makeDashboardFilterDrafts,
  makeDashboardFilterState,
} from "./dashboardFilterFixtures";

function ToolbarHarness({
  initialView = "letters",
  filterState = makeDashboardFilterState(),
  filterDrafts = makeDashboardFilterDrafts(),
  filterActions = makeDashboardFilterActions(),
  onManagerOpen,
}: {
  initialView?: DashboardView;
  filterState?: DashboardFilterState;
  filterDrafts?: DashboardFilterDrafts;
  filterActions?: DashboardFilterActions;
  onManagerOpen?: () => void;
}) {
  const [dashboardView, setDashboardView] =
    useState<DashboardView>(initialView);
  const managerState = useDashboardManagerState();

  return (
    <DashboardToolbar
      dashboardView={dashboardView}
      onDashboardViewChange={setDashboardView}
      activeManager={managerState.activeManager}
      onManagerOpenChange={managerState.setManagerOpen}
      paginationTotal={12}
      stats={emptyDashboardFilterStats}
      sortColumns={[{ field: "lastOpenedAt", direction: "desc" }]}
      setSortColumns={vi.fn()}
      savedViews={[]}
      onSaveView={vi.fn()}
      onApplyView={vi.fn()}
      onDeleteView={vi.fn()}
      filterState={filterState}
      filterDrafts={filterDrafts}
      filterActions={filterActions}
      dateButtonText="Date"
      onManagerOpen={onManagerOpen}
    />
  );
}

describe("DashboardToolbar", () => {
  it("opens and closes the mobile filter panel from the toolbar", async () => {
    const user = userEvent.setup();
    render(<ToolbarHarness />);

    const trigger = screen.getByRole("button", { name: /Filters/ });
    await user.click(trigger);
    expect(
      screen.getByRole("heading", { name: "Filters" }),
    ).toBeInTheDocument();
    const closeButtons = screen.getAllByRole(
      "button",
      { name: "Close filters" },
    );
    expect(closeButtons).toHaveLength(2);

    await user.click(closeButtons[1]);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Close filters" }),
    ).not.toBeInTheDocument();
  });

  it("routes active search chip clearing through one named action", async () => {
    const user = userEvent.setup();
    const clearSearch = vi.fn();
    const clearAllFilters = vi.fn();

    render(
      <ToolbarHarness
        filterState={makeDashboardFilterState({
          query: { searchQuery: "molly" },
        })}
        filterDrafts={makeDashboardFilterDrafts({
          searchInput: "molly",
        })}
        filterActions={makeDashboardFilterActions({
          clearSearch,
          clearAllFilters,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Search: molly/ }),
    );
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(clearSearch).toHaveBeenCalledOnce();
    expect(clearAllFilters).toHaveBeenCalledOnce();
  });

  it("hides letter-only controls when switching to collections", async () => {
    const user = userEvent.setup();
    render(<ToolbarHarness />);

    expect(
      screen.getByPlaceholderText(
        "Search letters, senders, recipients...",
      ),
    ).toHaveAttribute("maxLength", String(MAX_DASHBOARD_SEARCH_LENGTH));

    await user.click(screen.getByRole("button", { name: "Collections" }));

    expect(
      screen.queryByPlaceholderText(
        "Search letters, senders, recipients...",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
  });

  it("keeps only one dashboard toolbar manager open at a time", async () => {
    const user = userEvent.setup();
    render(<ToolbarHarness />);

    const filtersTrigger = screen.getByRole("button", { name: /Filters/ });
    await user.click(filtersTrigger);
    expect(
      screen.getByRole("heading", { name: "Filters" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save view" }));
    expect(filtersTrigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("heading", { name: "Filters" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Saved views" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Sort/i }));
    expect(
      screen.queryByRole("dialog", { name: "Saved views" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Sort rules" }),
    ).toBeInTheDocument();

    await user.click(filtersTrigger);
    expect(
      screen.queryByRole("dialog", { name: "Sort rules" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Filters" }),
    ).toBeInTheDocument();
  });

  it("announces toolbar manager opens for mobile selection dismissal", async () => {
    const user = userEvent.setup();
    const onManagerOpen = vi.fn();
    render(<ToolbarHarness onManagerOpen={onManagerOpen} />);

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.click(screen.getByRole("button", { name: /Sort/i }));

    expect(onManagerOpen).toHaveBeenCalledTimes(3);
  });
});
