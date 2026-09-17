import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import CollectionDetailPage from "../CollectionDetailPage";
import type { Letter } from "../../types/Letter";

// Polyfill IntersectionObserver for jsdom
beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    globalThis.IntersectionObserver = class IntersectionObserver {
      readonly root: Element | null = null;
      readonly rootMargin: string = "";
      readonly thresholds: ReadonlyArray<number> = [];
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

// HeaderDock is now a portal wrapper — stub it out so tests don't need a
// real slot mounted. Just render children inline.
vi.mock("../../components/Header/HeaderDock", () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("../../components/SearchBar/SearchBar", () => ({
  default: ({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) => (
    <div data-testid="search-bar"><input aria-label="Search collection" value={query} onChange={(event) => onQueryChange(event.target.value)} /></div>
  ),
}));

vi.mock("../../components/ArchiveList/ArchiveList", () => ({
  default: ({ letters }: { letters: Array<{ id: string }> }) => (
    <div data-testid="archive-list">{letters.length} archive items</div>
  ),
}));

vi.mock("../../api/client", () => ({
  getImageUrl: (url: string) => url,
  apiGet: () => Promise.resolve({}),
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
    primarySourceRevision: 0,
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
    transcriptPublished: true,
    metadataPublished: true,
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
      <Link to="/collections/010">Switch to Ten</Link>
      <Routes>
        <Route path="/collections/:collectionCode" element={<CollectionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CollectionDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

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
    expect(screen.getByText("Featured Letter")).toBeInTheDocument();
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
      const highlightLinks = screen.getAllByRole("link").filter(
        (link) => link.classList.contains("cd-highlight-open-link"),
      );
      expect(highlightLinks[0]).toHaveAttribute('href', expect.stringContaining('/letter/letter-2'));
      await user.click(highlightLinks[0]);

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
    expect(screen.getByText("Featured Letter")).toBeInTheDocument();
    expect(screen.getByTestId("archive-list")).toBeInTheDocument();
  });

  it("keeps the collection highlight label as Featured Letter even for a start-here selection", async () => {
    getCollectionProfileMock.mockResolvedValue({
      profileStatus: "AI_DRAFT",
      startHere: {
        letterId: "letter-1",
        reason: "Begin here.",
        hook: "First travel note",
        date: "1947-08-10",
      },
    });

    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });

    expect(screen.getByText("Featured Letter")).toBeInTheDocument();
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("shows the published overview narrative", async () => {
    const overview = await getCollectionByCodeMock();
    getCollectionByCodeMock.mockResolvedValue({ ...overview,
      profileNarrative: "This collection tells the story of wartime correspondence.",
    });

    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });

    expect(screen.getByText("This collection tells the story of wartime correspondence.")).toBeInTheDocument();
  });
  it('renders overview, narrative and searchable archive while profile is held', async () => {
    let resolveProfile!: (value: unknown) => void;
    getCollectionProfileMock.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
    const overview = await getCollectionByCodeMock();
    getCollectionByCodeMock.mockResolvedValue({ ...overview, profileNarrative: 'Published narrative', profileStartHereLetterId: 'letter-1' });
    renderCollectionDetailPage();
    await screen.findByRole('heading', { name: 'Collection Nine' });
    expect(screen.getByText('Published narrative')).toBeInTheDocument();
    const archiveNode = screen.getByTestId('archive-list');
    const input = screen.getByRole('textbox', { name: 'Search collection' });
    await userEvent.setup().type(input, 'travel');
    await act(async () => { resolveProfile({ narrative: 'Different late narrative', keyPeople: [] }); });
    expect(input).toHaveValue('travel');
    expect(screen.getByTestId('archive-list')).toBe(archiveNode);
    expect(screen.getByText('Published narrative')).toBeInTheDocument();
    expect(screen.queryByText('Different late narrative')).not.toBeInTheDocument();
  });

  it('keeps the usable collection when profile fails', async () => {
    getCollectionProfileMock.mockRejectedValue(new Error('Profile unavailable'));
    renderCollectionDetailPage();
    await screen.findByRole('heading', { name: 'Collection Nine' });
    expect(screen.getByTestId('archive-list')).toBeInTheDocument();
    expect(screen.queryByText('Collection Not Found')).not.toBeInTheDocument();
  });

  it('reports an overview failure without waiting for profile and cancels its request', async () => {
    getCollectionProfileMock.mockReturnValue(new Promise(() => {}));
    getCollectionByCodeMock.mockRejectedValue(new Error('Overview failed'));
    renderCollectionDetailPage();
    await screen.findByText('Overview failed');
    expect(getCollectionProfileMock.mock.calls[0][1].aborted).toBe(true);
  });

  it('aborts old requests and ignores late results after a collection switch', async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveOldProfile!: (value: unknown) => void;
    const oldOverview = await getCollectionByCodeMock();
    getCollectionByCodeMock.mockImplementation((code: string) => code === '009'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ...oldOverview, collectionCode: '010', title: 'Collection Ten' }));
    getCollectionProfileMock.mockImplementation((code: string) => code === '009'
      ? new Promise((resolve) => { resolveOldProfile = resolve; }) : Promise.resolve(null));
    renderCollectionDetailPage();
    const oldSignal = getCollectionProfileMock.mock.calls[0][1] as AbortSignal;
    await userEvent.setup().click(screen.getByRole('link', { name: 'Switch to Ten' }));
    await screen.findByRole('heading', { name: 'Collection Ten' });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { resolveOld(oldOverview); resolveOldProfile({ narrative: 'Old collection narrative' }); });
    expect(screen.getByRole('heading', { name: 'Collection Ten' })).toBeInTheDocument();
    expect(screen.queryByText('Old collection narrative')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collection Nine' })).not.toBeInTheDocument();
  });

});
