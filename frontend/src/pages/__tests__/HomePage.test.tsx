import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import HomePage from "../HomePage";
import { HeaderDockProvider } from "../../contexts/HeaderDockContext";
import type { ArchiveShelfItem } from "../../types/Letter";

const listBlogPostsMock = vi.fn();
const searchArchiveShelfMock = vi.fn();
const getFeaturedLetterMock = vi.fn();
const getContentPageMock = vi.fn();
const getLetterByIdMock = vi.fn();

vi.mock("../../api/client", () => ({
  getImageUrl: (url: string) => url,
  listBlogPosts: (...args: unknown[]) => listBlogPostsMock(...args),
  getFeaturedLetter: (...args: unknown[]) => getFeaturedLetterMock(...args),
  getContentPage: (...args: unknown[]) => getContentPageMock(...args),
  ApiError: class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
}));

vi.mock("../../api/letters", () => ({
  searchArchiveShelf: (...args: unknown[]) => searchArchiveShelfMock(...args),
  getLetterById: (...args: unknown[]) => getLetterByIdMock(...args),
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
    searchArchiveShelfMock.mockReset();
    getFeaturedLetterMock.mockReset();
    getContentPageMock.mockReset();
    getLetterByIdMock.mockReset();

    listBlogPostsMock.mockResolvedValue({ posts: [], total: 0 });
    getFeaturedLetterMock.mockResolvedValue(null);
    getContentPageMock.mockResolvedValue(null);
    getLetterByIdMock.mockResolvedValue({ images: [] });

    searchArchiveShelfMock
      .mockResolvedValueOnce({
        letters: Array.from({ length: 18 }, (_, index) => makeShelfItem(index + 1)),
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
        letters: Array.from({ length: 12 }, (_, index) => makeShelfItem(index + 19)),
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
      expect(screen.getByText("Scroll to continue through the archive. 12 more items still below.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Load next 12" }));

    await waitFor(() => {
      expect(screen.getByText("Hook 30")).toBeInTheDocument();
    });

    expect(screen.getByText("All 30 archive items are loaded.")).toBeInTheDocument();
    expect(searchArchiveShelfMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2, limit: 24 }),
    );
  });

  it("cycles featured letter pages from the hero controls", async () => {
    const user = userEvent.setup();

    getFeaturedLetterMock.mockResolvedValueOnce({
      id: "featured-letter",
      hook: "A featured note.",
      summary: null,
      sender: "Jimmie",
      recipient: "Molly",
      letterDate: "August 10, 1947",
      dateRaw: "19470810",
      collectionCode: "009",
      collectionTitle: "Collection Nine",
      imageUrl: "/images/featured-page-1",
      imageType: "letter",
      source: "manual",
    });
    getLetterByIdMock.mockResolvedValueOnce({
      images: [
        { id: "page-1", type: "letter", imageUrl: "/images/featured-page-1" },
        { id: "page-2", type: "letter", imageUrl: "/images/featured-page-2" },
      ],
    });

    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <HomePage />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("1/2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(await screen.findByText("2/2")).toBeInTheDocument();
    const featureLink = document.querySelector('.home-hero-open-link');
    expect(featureLink).toHaveAttribute('href', '/letter/featured-letter?from=highlight&image=page-2');
    expect(screen.getByRole('button', { name: 'Next page' }).closest('a')).toBeNull();
  });

  it("smoothly scrolls the hero CTA to the full search panel below the header", async () => {
    const user = userEvent.setup();
    const scrollToMock = vi.fn();

    vi.stubGlobal("scrollTo", scrollToMock);
    // smoothScrollToY RAF loop: fire synchronously, jump performance.now()
    // past duration so animation finalizes on first tick.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now() + 10_000);
      return 0;
    });
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

    expect(scrollToMock).toHaveBeenLastCalledWith(0, 868);
  });

  it("formats featured letter dates into human-readable month names", async () => {
    getFeaturedLetterMock.mockResolvedValueOnce({
      id: "featured-letter",
      hook: "A featured note.",
      summary: null,
      sender: "Jimmie",
      recipient: "Molly",
      letterDate: "09/21/2000",
      dateRaw: "20000921",
      collectionCode: "009",
      collectionTitle: "Collection Nine",
      imageUrl: "/images/featured-page-1",
      imageType: "letter",
      source: "manual",
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

  it("hero image has descriptive alt text", async () => {
    getFeaturedLetterMock.mockResolvedValueOnce({
      id: "featured-letter",
      hook: "A featured note.",
      summary: null,
      sender: "Jimmie",
      recipient: "Molly",
      letterDate: "August 10, 1947",
      dateRaw: "19470810",
      collectionCode: "009",
      collectionTitle: "Collection Nine",
      imageUrl: "/images/featured-page-1",
      imageType: "letter",
      source: "manual",
    });
    getLetterByIdMock.mockResolvedValueOnce({
      images: [
        { id: "page-1", type: "letter", imageUrl: "/images/featured-page-1" },
      ],
    });

    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <HomePage />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    await screen.findByText("A featured note.");

    const heroImg = screen.getByAltText(/Scan of letter/);
    expect(heroImg).toBeInTheDocument();
    expect(heroImg.getAttribute("alt")).toContain("Jimmie");
    expect(heroImg.getAttribute("alt")).toContain("Molly");
  });
});
