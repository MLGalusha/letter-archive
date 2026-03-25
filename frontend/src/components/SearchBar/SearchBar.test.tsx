import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchBar, { type SearchFilters } from "./SearchBar";

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchBar", () => {
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
        facets={{
          formats: [{ value: "letter", label: "Letters", count: 12 }],
          correspondents: [{ value: "Jimmie", count: 23 }],
          places: [{ value: "Overland Park, Kans.", count: 4 }],
          years: [{ value: 1947, count: 27 }],
        }}
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
      format: "letter",
    });
  });

  it("shows active filters as removable pills", async () => {
    const user = userEvent.setup();
    const handleQueryChange = vi.fn();
    const handleFiltersChange = vi.fn();

    render(
      <SearchBar
        query="Molly"
        filters={{
          format: "photo",
          person: "Jimmie",
          sort: "relevance",
          sortOrder: "desc",
        }}
        facets={{
          formats: [{ value: "photo", label: "Photos", count: 3 }],
          correspondents: [{ value: "Jimmie", count: 23 }],
          places: [],
          years: [],
        }}
        total={3}
        loading={false}
        onQueryChange={handleQueryChange}
        onFiltersChange={handleFiltersChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jimmie" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Photos" }));

    expect(handleFiltersChange).toHaveBeenCalledWith({
      format: null,
      person: "Jimmie",
      sort: "relevance",
      sortOrder: "desc",
    });
  });

  it("shows best-match sorting only when there is an active query", () => {
    render(
      <SearchBar
        query="Molly"
        filters={{}}
        facets={{
          formats: [{ value: "letter", label: "Letters", count: 12 }],
          correspondents: [],
          places: [],
          years: [],
        }}
        total={12}
        loading={false}
        onQueryChange={vi.fn()}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Best Match/i })).toBeInTheDocument();
  });

  it("uses refine wording for the compact sticky-search controls", async () => {
    const user = userEvent.setup();

    render(
      <SearchBar
        query="Molly"
        filters={{}}
        facets={{
          formats: [{ value: "letter", label: "Letters", count: 12 }],
          correspondents: [],
          places: [],
          years: [],
        }}
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
        facets={{
          formats: [{ value: "letter", label: "Letters", count: 12 }],
          correspondents: [],
          places: [],
          years: [],
        }}
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
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    const flyout = screen.getByText('12 results for "Molly"').closest(".search-compact-flyout") as HTMLElement;
    fireEvent.mouseEnter(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.mouseLeave(flyout);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText('12 results for "Molly"')).not.toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.mouseLeave(refineButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('12 results for "Molly"')).toBeInTheDocument();

    fireEvent.click(refineButton);
    expect(screen.queryByText('12 results for "Molly"')).not.toBeInTheDocument();
  });
});
