import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EntityListPanel from "../EntityListPanel";

vi.mock("../../../../components/DuplicateSuggestions", () => ({
  default: ({ onRefresh, onMerge }: { onRefresh: () => void; onMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void }) => (
    <div>
      <button onClick={onRefresh}>refresh-suggestions</button>
      <button onClick={() => onMerge("keep", "merge", "Keep", "Merge")}>merge-suggestion</button>
    </div>
  ),
}));

describe("EntityListPanel", () => {
  const baseProps = {
    entityType: "person" as const,
    refreshKey: 1,
    onSuggestionMerge: vi.fn(),
    onRefreshSuggestions: vi.fn(),
    searchQuery: "",
    onSearchQueryChange: vi.fn(),
    searchPlaceholder: "Search people...",
    items: [
      { id: "1", canonicalName: "Alice", letterCount: 2, aliases: ["Al"] },
      { id: "2", canonicalName: "Bob", letterCount: 1, aliases: [] },
    ],
    loading: false,
    emptyMessage: "No people found",
    selectedEntityId: "1",
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    onSelectItem: vi.fn(),
    onSelectAll: vi.fn(),
    onOpenBulkMerge: vi.fn(),
    onClearSelection: vi.fn(),
    panelClassName: "people-list-panel",
    listClassName: "people-list",
    itemClassName: "person-item",
    contentClassName: "person-content",
    renderItemContent: (item: { canonicalName: string; letterCount: number }) => (
      <>
        <div>{item.canonicalName}</div>
        <div>{item.letterCount}</div>
      </>
    ),
  };

  it("renders and delegates selection/search callbacks", () => {
    render(<EntityListPanel {...baseProps} />);

    fireEvent.change(screen.getByPlaceholderText("Search people..."), {
      target: { value: "ali" },
    });
    expect(baseProps.onSearchQueryChange).toHaveBeenCalledWith("ali");

    fireEvent.click(screen.getByLabelText("Select Alice"));
    expect(baseProps.onToggleSelect).toHaveBeenCalledWith("1");

    fireEvent.click(screen.getByText("Alice"));
    expect(baseProps.onSelectItem).toHaveBeenCalledWith(baseProps.items[0]);

    fireEvent.click(screen.getByText("refresh-suggestions"));
    expect(baseProps.onRefreshSuggestions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("merge-suggestion"));
    expect(baseProps.onSuggestionMerge).toHaveBeenCalledWith("keep", "merge", "Keep", "Merge");
  });

  it("shows bulk actions when items are selected", () => {
    const props = {
      ...baseProps,
      selectedIds: new Set<string>(["1", "2"]),
    };

    render(<EntityListPanel {...props} />);

    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Merge Selected"));
    expect(props.onOpenBulkMerge).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Clear"));
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("renders empty and loading states", () => {
    const { rerender } = render(
      <EntityListPanel
        {...baseProps}
        items={[]}
        loading
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(
      <EntityListPanel
        {...baseProps}
        items={[]}
        loading={false}
      />,
    );

    expect(screen.getByText("No people found")).toBeInTheDocument();
  });
});
