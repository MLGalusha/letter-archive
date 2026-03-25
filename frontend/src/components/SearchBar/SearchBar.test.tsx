import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveSearchFacets } from "../../types/Letter";
import SearchBar, { type SearchFilters } from "./SearchBar";

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchBar", () => {
  const baseFacets: ArchiveSearchFacets = {
    formats: [{ value: "letter", label: "Letters", count: 12 }],
    collections: [{ value: "009", label: "Collection Nine", count: 12 }],
    correspondents: [{ value: "Jimmie", count: 23 }],
    places: [{ value: "Overland Park, Kans.", count: 4 }],
    years: [{ value: 1947, count: 27 }],
    topics: [{ value: "family/marriage", count: 9 }],
    tones: [{ value: "hopeful", count: 5 }],
    relationships: [{ value: "romantic-partner", count: 7 }],
  };

  it("renders archive facets and notifies callers when a facet is selected", async () => {
    const user = userEvent.setup();
    const handleQueryChange = vi.fn();
    const handleFiltersChange = vi.fn();
    const filters: SearchFilters = {
      sort: "relevance",
      sortOrder: "desc",
    };

    render(
      <SearchBar
        query=""
        filters={filters}
        facets={baseFacets}
        total={95}
        loading={false}
        onQueryChange={handleQueryChange}
        onFiltersChange={handleFiltersChange}
      />,
    );

    expect(screen.getByText("95 published archive items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Best Match/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Letters 12/i }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "relevance",
      sortOrder: "desc",
      format: ["letter"],
    });
  });

  it("does not auto-open refine when a top-level format chip is toggled", async () => {
    const user = userEvent.setup();

    function SearchBarHarness() {
      const [filters, setFilters] = useState<SearchFilters>({});

      return (
        <SearchBar
          query=""
          filters={filters}
          facets={baseFacets}
          total={95}
          loading={false}
          onQueryChange={vi.fn()}
          onFiltersChange={setFilters}
        />
      );
    }

    render(<SearchBarHarness />);

    expect(screen.getByRole("button", { name: "Open archive refine controls" })).toHaveTextContent("Refine");
    expect(screen.queryByRole("button", { name: "Sort archive results" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Letters 12/i }));

    expect(screen.queryByRole("button", { name: "Sort archive results" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Letters 12" })).toBeInTheDocument();
  });

  it("keeps format selection on the chips and only shows removable pills for other filters", async () => {
    const user = userEvent.setup();
    const handleQueryChange = vi.fn();
    const handleFiltersChange = vi.fn();

    render(
      <SearchBar
        query="Molly"
        filters={{
          format: ["photo"],
          person: "Jimmie",
          personRole: "sender",
          sort: "relevance",
          sortOrder: "desc",
        }}
        facets={{
          ...baseFacets,
          formats: [{ value: "photo", label: "Photos", count: 3 }],
        }}
        total={3}
        loading={false}
        onQueryChange={handleQueryChange}
        onFiltersChange={handleFiltersChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Photos 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sender or recipient: Jimmie" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Photos 3" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Sender or recipient: Jimmie" }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      format: ["photo"],
      person: null,
      personRole: null,
      sort: "relevance",
      sortOrder: "desc",
    });
  });

  it("lets the selected format chip remain the only visible format state", async () => {
    const user = userEvent.setup();
    const handleFiltersChange = vi.fn();

    render(
      <SearchBar
        query=""
        filters={{
          format: ["photo"],
          sort: "createdAt",
          sortOrder: "desc",
        }}
        facets={{
          ...baseFacets,
          formats: [
            { value: "letter", label: "Letters", count: 12 },
            { value: "photo", label: "Photos", count: 3 },
          ],
        }}
        total={15}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={handleFiltersChange}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Photos 3" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Photos 3" }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      format: null,
      sort: "createdAt",
      sortOrder: "desc",
    });
  });

  it("keeps sorting inside refine instead of rendering quick-sort chips", () => {
    render(
      <SearchBar
        query="Molly"
        filters={{}}
        facets={baseFacets}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Best Match/i })).not.toBeInTheDocument();
  });

  it("uses refine wording for the compact sticky-search controls", async () => {
    const user = userEvent.setup();

    render(
      <SearchBar
        query="Molly"
        filters={{}}
        facets={baseFacets}
        total={12}
        loading={false}
        variant="compact"
        embedded
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    const refineButton = screen.getByRole("button", { name: "Open archive refine controls" });
    expect(refineButton).toHaveTextContent("Refine");

    await user.click(refineButton);

    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();
  });

  it("gives the compact refine flyout a hover grace period and allows click pinning", async () => {
    vi.useFakeTimers();

    render(
      <SearchBar
        query="Molly"
        filters={{}}
        facets={baseFacets}
        total={12}
        loading={false}
        variant="compact"
        embedded
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    const refineButton = screen.getByRole("button", { name: "Open archive refine controls" });

    fireEvent.mouseEnter(refineButton);
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    const flyout = screen.getByText('12 results for "Molly"').closest(".search-compact-flyout") as HTMLElement;
    fireEvent.mouseEnter(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.mouseLeave(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.queryByText('12 results for "Molly"')).not.toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();
    expect(screen.getByText("Pinned open")).toBeInTheDocument();
    expect(refineButton).toHaveClass("is-pinned");

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.queryByText('12 results for "Molly"')).not.toBeInTheDocument();
  });

  it("gives the page refine flyout the same hover grace period and click pinning", async () => {
    vi.useFakeTimers();

    render(
      <SearchBar
        query=""
        filters={{}}
        facets={baseFacets}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    const refineButton = screen.getByRole("button", { name: "Open archive refine controls" });

    fireEvent.mouseEnter(refineButton);
    expect(screen.getByRole("button", { name: "Sort archive results" })).toBeInTheDocument();

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole("button", { name: "Sort archive results" })).toBeInTheDocument();

    const flyout = screen.getByRole("button", { name: "Sort archive results" }).closest(".search-full-flyout") as HTMLElement;
    fireEvent.mouseLeave(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.queryByRole("button", { name: "Sort archive results" })).not.toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.getByRole("button", { name: "Sort archive results" })).toBeInTheDocument();
    expect(screen.getByText("Pinned open")).toBeInTheDocument();
    expect(refineButton).toHaveClass("is-pinned");

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.getByRole("button", { name: "Sort archive results" })).toBeInTheDocument();
  });

  it("shows Clear All inside the page refine flyout instead of beside the toolbar", async () => {
    const user = userEvent.setup();

    render(
      <SearchBar
        query="Molly"
        filters={{ format: ["letter"] }}
        facets={baseFacets}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear All" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open archive refine controls" }));

    const flyout = screen.getByRole("button", { name: "Sort archive results" }).closest(".search-full-flyout");
    expect(flyout).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear All" })).toBeInTheDocument();
  });

  it("lets people choose advanced archive-wide sorts from refine", async () => {
    const user = userEvent.setup();
    const handleFiltersChange = vi.fn();

    render(
      <SearchBar
        query=""
        filters={{}}
        facets={baseFacets}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={handleFiltersChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open archive refine controls" }));
    await user.click(screen.getByRole("button", { name: "Sort archive results" }));
    await user.click(screen.getByRole("button", { name: "Collection" }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "collection",
      sortOrder: "asc",
    });
  });

  it("lets people flip sort direction separately from the sort field", async () => {
    const user = userEvent.setup();
    const handleFiltersChange = vi.fn();

    render(
      <SearchBar
        query=""
        filters={{ sort: "letterDate", sortOrder: "desc" }}
        facets={baseFacets}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={handleFiltersChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open archive refine controls" }));
    await user.click(screen.getByRole("button", { name: /Toggle sort direction, currently Newest letter first/i }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "letterDate",
      sortOrder: "asc",
    });
  });
});
