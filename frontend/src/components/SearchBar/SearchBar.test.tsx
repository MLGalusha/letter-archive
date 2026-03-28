import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

    // Format chips are inside the flyout — open it first
    await user.click(screen.getByRole("button", { name: /Open archive refine controls/i }));
    await user.click(screen.getByRole("button", { name: /Letters 12/i }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "relevance",
      sortOrder: "desc",
      format: ["letter"],
    });
  });

  it("shows format chips inside the refine flyout", async () => {
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

    // Format chips are only visible after opening the flyout
    expect(screen.queryByRole("button", { name: /Letters/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open archive refine controls/i }));

    expect(screen.getByRole("button", { name: /Letters 12/i })).toBeInTheDocument();
  });

  it("shows filter count badge when filters are active", () => {
    render(
      <SearchBar
        query="Molly"
        filters={{
          format: ["photo"],
          sender: "Jimmie",
          sort: "relevance",
          sortOrder: "desc",
        }}
        facets={{
          ...baseFacets,
          formats: [{ value: "photo", label: "Photos", count: 3 }],
        }}
        total={3}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    // Format + sender both count in the badge
    const refineButton = screen.getByRole("button", { name: /Open archive refine controls, 2 active/i });
    expect(refineButton).toBeInTheDocument();
    expect(refineButton.querySelector(".filter-count-badge")).toHaveTextContent("2");
  });

  it("lets the selected format chip be toggled inside the flyout", async () => {
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

    // Open flyout to access format chips
    await user.click(screen.getByRole("button", { name: /Open archive refine controls/i }));
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
    expect(refineButton).toBeInTheDocument();

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
    // Second click unpins but flyout stays open until mouse leaves
    expect(refineButton).not.toHaveClass("is-pinned");
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
    const flyout = screen.getByText("Refine", { selector: ".search-facet-label" }).closest(".search-full-flyout") as HTMLElement;
    expect(flyout).toBeTruthy();

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(flyout).toBeInTheDocument();

    fireEvent.mouseLeave(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(flyout).not.toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.getByText("Pinned open")).toBeInTheDocument();
    expect(refineButton).toHaveClass("is-pinned");

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(screen.getByText("Pinned open")).toBeInTheDocument();
  });

  it("shows Clear All inside the page refine flyout", async () => {
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

    await user.click(screen.getByRole("button", { name: /Open archive refine controls/i }));

    const flyout = screen.getByText("Refine", { selector: ".search-facet-label" }).closest(".search-full-flyout");
    expect(flyout).toBeTruthy();
    expect(within(flyout!).getByRole("button", { name: "Clear All" })).toBeInTheDocument();
  });

  it("lets people choose archive-wide sorts from the sort dropdown", async () => {
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

    await user.click(screen.getByRole("button", { name: "Sort archive results" }));
    await user.click(screen.getByRole("option", { name: /Collection/i }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "collection",
      sortOrder: "asc",
    });
  });

  it("lets people flip sort direction by clicking the active sort option", async () => {
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

    await user.click(screen.getByRole("button", { name: "Sort archive results" }));
    await user.click(screen.getByRole("option", { name: /Letter Date/i }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      sort: "letterDate",
      sortOrder: "asc",
    });
  });
});
