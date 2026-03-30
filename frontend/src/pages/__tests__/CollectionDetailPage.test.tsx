import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CollectionDetailPage from "../CollectionDetailPage";
import type { Letter } from "../../types/Letter";

// Polyfill IntersectionObserver for jsdom
beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    globalThis.IntersectionObserver = class IntersectionObserver {
      readonly root: Element | null = null;
      readonly rootMargin: string = "";
      readonly thresholds: ReadonlyArray<number> = [];
      constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
    } as unknown as typeof globalThis.IntersectionObserver;
  }
});

const mockNavigate = vi.fn();
const getCollectionByCodeMock = vi.fn();
const getCollectionProfileMock = vi.fn();
const searchArchiveShelfMock = vi.fn();

vi.mock("../../api/collections", () => ({
  getCollectionByCode: (...args: unknown[]) => getCollectionByCodeMock(...args),
  getCollectionProfile: (...args: unknown[]) => getCollectionProfileMock(...args),
  listCollections: () => Promise.resolve([]),
}));

vi.mock("../../api/letters", () => ({
  searchArchiveShelf: (...args: unknown[]) => searchArchiveShelfMock(...args),
}));

const mockSetDock = vi.fn();
vi.mock("../../contexts/HeaderDockContext", () => ({
  useHeaderDock: () => ({ dock: { content: null, active: false, visible: false }, setDock: mockSetDock }),
  EMPTY_DOCK: { content: null, active: false, visible: false },
}));

vi.mock("../../components/SearchBar/SearchBar", () => ({
  default: () => <div data-testid="search-bar">SearchBar</div>,
}));

vi.mock("../../components/ArchiveList/ArchiveList", () => ({
  default: ({ letters }: { letters: Array<{ id: string }> }) => (
    <div data-testid="archive-list">{letters.length} archive items</div>
  ),
}));

vi.mock("../../api/client", () => ({
  getImageUrl: (url: string) => url,
}));

vi.mock("../../components/Footer/Footer", () => ({
  default: () => <footer>Footer</footer>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createLetter(
  id: string,
  overrides: Partial<Letter> & {
    metadata?: Partial<Letter["metadata"]>;
  } = {},
): Letter {
  return {
    id,
    title: id,
    collectionCode: "009",
    images: [{ id: `image-${id}`, type: "letter", imageUrl: `/images/${id}` }],
    transcript: {
      pages: [],
      fullText: "Some transcript text here for word counting purposes.",
      verified: false,
    },
    metadata: {
      dateRaw: "19470810",
      verified: false,
      ...overrides.metadata,
    },
    status: "published",
    workflowState: "REVIEWED",
    visibility: "PUBLISHED",
    transcriptStatus: "VERIFIED",
    metadataContentStatus: "VERIFIED",
    extraContentStatus: "EMPTY",
    createdAt: "2026-03-09T12:00:00.000Z",
    flagged: false,
    ...overrides,
  };
}

const EMPTY_ARCHIVE_RESPONSE = {
  letters: [],
  page: 1,
  limit: 24,
  total: 0,
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
};

function renderCollectionDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/collections/009"]}>
      <Routes>
        <Route path="/collections/:collectionCode" element={<CollectionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CollectionDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getCollectionProfileMock.mockResolvedValue(null);
    searchArchiveShelfMock.mockResolvedValue(EMPTY_ARCHIVE_RESPONSE);

    getCollectionByCodeMock.mockResolvedValue({
      id: "collection-9",
      collectionCode: "009",
      title: "Collection Nine",
      description: "A focused set of letters",
      createdAt: "2026-03-09T12:00:00.000Z",
      letterCount: 3,
      letters: [
        createLetter("letter-1", {
          metadata: {
            date: "1947-08-10",
            dateRaw: "19470810",
            sender: "Alice Smith",
            recipient: "Bob Baker",
            hook: "First travel note",
            primaryTopics: ["Travel"],
            verified: false,
          },
        }),
        createLetter("letter-2", {
          metadata: {
            date: "1947-08-11",
            dateRaw: "19470811",
            sender: "Cara Jones",
            recipient: "Dan Stone",
            hook: "Music update",
            primaryTopics: ["Music"],
            verified: false,
          },
        }),
        createLetter("letter-3", {
          images: [{ id: "photo-image", type: "photo", imageUrl: "/images/photo" }],
          photoDescription: "A snapshot of Jimmy and Molly standing on a porch.",
          metadata: {
            date: "1947-08-12",
            dateRaw: "19470812",
            hook: "Summer porch portrait",
            primaryTopics: ["Family"],
            verified: false,
          },
        }),
      ],
    });
  });

  it("renders header with inline stats, people, highlights, and archive search", async () => {
    renderCollectionDetailPage();

    // Header
    expect(await screen.findByRole("heading", { name: "Collection Nine" })).toBeInTheDocument();

    // Inline stats (format breakdown)
    expect(screen.getByText("2 letters \u00B7 1 photo")).toBeInTheDocument();

    // People section
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();

    // Highlights (featured letter + gallery)
    expect(screen.getByText(/Featured/)).toBeInTheDocument();
    expect(screen.getByText("Photo")).toBeInTheDocument();

    // Archive search components
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByTestId("archive-list")).toBeInTheDocument();
  });

  it("calls searchArchiveShelf with collection code pre-set", async () => {
    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });

    await waitFor(() => {
      expect(searchArchiveShelfMock).toHaveBeenCalled();
    });

    const callArgs = searchArchiveShelfMock.mock.calls[0][0];
    expect(callArgs.collection).toBe("009");
  });

  it("navigates to the selected letter when a highlight is clicked", async () => {
    const user = userEvent.setup();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.4);
    try {
      renderCollectionDetailPage();

      await screen.findByRole("heading", { name: "Collection Nine" });
      const highlightButtons = screen.getAllByRole("button").filter(
        (btn) => btn.classList.contains("cd-highlight-card"),
      );
      await user.click(highlightButtons[0]);

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining("/letter/letter-2"),
      );
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("shows the not-found state and returns to collections when loading fails", async () => {
    const user = userEvent.setup();
    getCollectionByCodeMock.mockRejectedValueOnce(new Error("Collection 009 missing"));

    renderCollectionDetailPage();

    expect(await screen.findByRole("heading", { name: "Collection Not Found" })).toBeInTheDocument();
    expect(screen.getByText("Collection 009 missing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← All Collections" }));

    expect(mockNavigate).toHaveBeenCalledWith("/collections");
  });

  it("works without profile data (no narrative section)", async () => {
    getCollectionProfileMock.mockResolvedValue(null);

    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });

    // Narrative should not appear when profile is null
    expect(screen.queryByText(/narrative/i)).not.toBeInTheDocument();

    // But highlights and archive should still render
    expect(screen.getByText(/Featured/)).toBeInTheDocument();
    expect(screen.getByTestId("archive-list")).toBeInTheDocument();
  });

  it("shows narrative when profile has one", async () => {
    getCollectionProfileMock.mockResolvedValue({
      narrative: "This collection tells the story of wartime correspondence.",
      profileStatus: "AI_DRAFT",
    });

    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });

    expect(screen.getByText("This collection tells the story of wartime correspondence.")).toBeInTheDocument();
  });
});
