import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import HomePage from "../HomePage";
import { HeaderDockProvider } from "../../contexts/HeaderDockContext";
import type { ArchiveShelfItem } from "../../types/Letter";

const listBlogPostsMock = vi.fn();
const getArchiveShelfItemsMock = vi.fn();
const searchArchiveShelfMock = vi.fn();

vi.mock("../../api/client", () => ({
  getImageUrl: (url: string) => url,
  listBlogPosts: (...args: unknown[]) => listBlogPostsMock(...args),
}));

vi.mock("../../api/letters", () => ({
  getArchiveShelfItems: (...args: unknown[]) => getArchiveShelfItemsMock(...args),
  searchArchiveShelf: (...args: unknown[]) => searchArchiveShelfMock(...args),
  getLetterById: vi.fn().mockResolvedValue({ images: [] }),
}));

vi.mock("../../components/SEO", () => ({
  default: () => null,
}));

vi.mock("../../components/Footer/Footer", () => ({
  default: () => <footer>Footer</footer>,
}));

function makeShelfItem(index: number): ArchiveShelfItem {
  return {
    id: `letter-${index}`,
    title: `Letter ${index}`,
    imageType: "letter",
    imageUrl: `/images/${index}.jpg`,
    primaryChip: `${(index % 3) + 1} pages`,
    sender: "Jimmie",
    recipient: "Molly",
    date: `March ${index}, 1947`,
    dateRaw: `194703${String((index % 28) + 1).padStart(2, "0")}`,
    hook: `Hook ${index}`,
    verified: true,
  };
}

describe("HomePage archive browsing", () => {
  beforeEach(() => {
    listBlogPostsMock.mockReset();
    getArchiveShelfItemsMock.mockReset();
    searchArchiveShelfMock.mockReset();

    listBlogPostsMock.mockResolvedValue({ posts: [], total: 0 });
    getArchiveShelfItemsMock.mockResolvedValue({
      letters: [makeShelfItem(101)],
      page: 1,
      limit: 100,
      total: 1,
    });

    searchArchiveShelfMock
      .mockResolvedValueOnce({
        letters: Array.from({ length: 24 }, (_, index) => makeShelfItem(index + 1)),
        page: 1,
        limit: 24,
        total: 30,
        facets: {
          formats: [],
          collections: [],
          correspondents: [],
          places: [],
          years: [],
          topics: [],
          tones: [],
          relationships: [],
        },
      })
      .mockResolvedValueOnce({
        letters: Array.from({ length: 6 }, (_, index) => makeShelfItem(index + 25)),
        page: 2,
        limit: 24,
        total: 30,
        facets: {
          formats: [],
          collections: [],
          correspondents: [],
          places: [],
          years: [],
          topics: [],
          tones: [],
          relationships: [],
        },
      });
  });

  it("appends later archive pages from the load-more control", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <HomePage />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Scroll to continue through the archive. 6 more items still below.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Load next 6" }));

    await waitFor(() => {
      expect(screen.getByText("Hook 30")).toBeInTheDocument();
    });

    expect(screen.getByText("All 30 archive items are loaded.")).toBeInTheDocument();
    expect(searchArchiveShelfMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2, limit: 24 }),
    );
  });
});
