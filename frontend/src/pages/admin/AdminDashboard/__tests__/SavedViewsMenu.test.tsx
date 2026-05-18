import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SavedViewsMenu from "../SavedViewsMenu";
import type { SavedDashboardView } from "../types";

const savedView: SavedDashboardView = {
  id: "view-1",
  name: "Needs review",
  createdAt: "2026-01-01T00:00:00.000Z",
  state: {
    visibilityFilter: "ALL",
    collectionFilter: "",
    searchQuery: "",
    sortColumns: [],
    dateMode: "specific",
    year: null,
    month: null,
    day: null,
    dateFrom: null,
    dateTo: null,
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    visibleColumns: [],
    columnOrder: [],
  },
};

describe("SavedViewsMenu", () => {
  it("renders saved views inside the shared manager dialog", async () => {
    const user = userEvent.setup();

    render(
      <SavedViewsMenu
        savedViews={[savedView]}
        onSaveView={vi.fn()}
        onApplyView={vi.fn()}
        onDeleteView={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save view" }));

    expect(screen.getByRole("dialog", { name: "Saved views" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs review" })).toBeInTheDocument();
  });

  it("saves a named dashboard view", async () => {
    const user = userEvent.setup();
    const onSaveView = vi.fn();

    render(
      <SavedViewsMenu
        savedViews={[]}
        onSaveView={onSaveView}
        onApplyView={vi.fn()}
        onDeleteView={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByPlaceholderText("View name"), "Cleanup");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSaveView).toHaveBeenCalledWith("Cleanup");
    expect(screen.queryByRole("dialog", { name: "Saved views" })).not.toBeInTheDocument();
  });
});
