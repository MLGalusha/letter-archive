import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll(".header").forEach((element) => element.remove());
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

  it("smoothly scrolls the hero CTA to the full search panel below the header", async () => {
    const user = userEvent.setup();
    const scrollToMock = vi.fn();

    vi.stubGlobal("scrollTo", scrollToMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      writable: true,
      value: 240,
    });

    const header = document.createElement("div");
    header.className = "header";
    Object.defineProperty(header, "offsetHeight", {
      configurable: true,
      value: 112,
    });
    document.body.appendChild(header);

    const { container } = render(
      <MemoryRouter>
        <HeaderDockProvider>
          <HomePage />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    const searchPanel = container.querySelector(".home-search-panel") as HTMLDivElement | null;
    expect(searchPanel).not.toBeNull();

    vi.spyOn(searchPanel!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 760,
      top: 760,
      bottom: 1000,
      left: 0,
      right: 900,
      width: 900,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);

    await user.click(screen.getByRole("link", { name: "Search the Archive" }));

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 868,
      behavior: "smooth",
    });
  });

  it("formats featured letter dates into human-readable month names", async () => {
    getArchiveShelfItemsMock.mockResolvedValueOnce({
      letters: [{ ...makeShelfItem(101), date: "09/21/2000", dateRaw: "20000921" }],
      page: 1,
      limit: 100,
      total: 1,
    });

    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <HomePage />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("September 21, 2000")).toBeInTheDocument();
    expect(screen.queryByText("09/21/2000")).not.toBeInTheDocument();
  });
});
