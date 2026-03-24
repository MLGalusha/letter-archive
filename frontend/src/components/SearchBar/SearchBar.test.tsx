import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SearchBar, { type SearchFilters } from "./SearchBar";

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
});
