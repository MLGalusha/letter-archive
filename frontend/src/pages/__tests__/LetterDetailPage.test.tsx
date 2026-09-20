import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import LetterDetailPage from "../LetterDetailPage";
import { HeaderDockProvider } from "../../contexts/HeaderDockContext";
import type { Letter } from "../../types/Letter";

const mockNavigate = vi.fn();
const getLetterByIdMock = vi.fn();
const getAdjacentLettersMock = vi.fn();

vi.mock("../../hooks/useSiteSettings", () => ({ useSiteSettings: () => null }));

vi.mock("../../api/letters", () => ({
  getLetterById: (...args: unknown[]) => getLetterByIdMock(...args),
  getAdjacentLetters: (...args: unknown[]) => getAdjacentLettersMock(...args),
  getArchiveShelfItems: vi.fn().mockResolvedValue({ letters: [], total: 0 }),
}));

// Mock LetterViewer since it requires complex DOM setup
vi.mock("../../components/LetterViewer/LetterViewer", () => ({
  default: ({ initialIndex }: { initialIndex: number }) => <div data-index={initialIndex}>LetterViewer</div>,
}));

// Keep this regression touch-capable if a page gesture is accidentally restored.
vi.mock("../../hooks/useIsTouchDevice", () => ({
  default: () => true,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return (to: string) => {
        mockNavigate(to);
        navigate(to);
      };
    },
  };
});

function createLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: "letter-1",
    title: "letter-1",
    collectionCode: "009",
    primarySourceRevision: 0,
    images: [
      {
        id: "img-1",
        type: "letter",
        pageNumber: 1,
        imageUrl: "/images/test.jpg",
      },
    ],
    transcript: {
      pages: [{ pageNumber: 1, text: "My dearest friend..." }],
      fullText: "My dearest friend...",
      verified: true,
    },
    metadata: {
      date: "August 10, 1947",
      dateRaw: "19470810",
      sender: "Alice Smith",
      recipient: "Bob Baker",
      location: "Vienna",
      hook: "A bright dispatch from Vienna",
      description: "Alice writes to Bob about her adventures exploring the city.",
      verified: false,
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
    linkedPersons: [
      {
        id: "lp-1",
        personId: "person-1",
        canonicalName: "Alice Smith",
        role: "sender",
        confidence: 0.99,
      },
    ],
    linkedPlaces: [
      {
        id: "place-link-1",
        placeId: "place-1",
        canonicalName: "Vienna",
        role: "written_from",
        confidence: 0.97,
      },
    ],
    ...overrides,
  };
}

function renderLetterDetailPage(entry = "/letter/letter-1") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <HeaderDockProvider>
        <Link to="/letter/letter-1?image=img-2">Select second scan</Link>
        <Link to="/letter/letter-1?image=unknown">Select unknown scan</Link>
        <Link to="/letter/letter-1">Clear scan selection</Link>
        <Link to="/letter/letter-2">Go to letter 2</Link>
        <Link to="/letter/letter-3">Go to letter 3</Link>
        <Routes>
          <Route path="/letter/:letterId" element={<LetterDetailPage />} />
        </Routes>
      </HeaderDockProvider>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const originalElementScrollTo = HTMLElement.prototype.scrollTo;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe("LetterDetailPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "");
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    HTMLElement.prototype.scrollTo = vi.fn();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    getLetterByIdMock.mockResolvedValue(createLetter());
    getAdjacentLettersMock.mockResolvedValue({
      prev: { id: "letter-0", dateRaw: "19470809", date: "August 9, 1947", sender: "Alice Smith", recipient: "Bob Baker" },
      next: { id: "letter-2", dateRaw: "19470811", date: "August 11, 1947", sender: "Alice Smith", recipient: "Bob Baker", hook: "Tomorrow we leave for Salzburg" },
      prevWraps: false,
      nextWraps: false,
      position: 2,
      total: 3,
      collectionCode: "009",
      collectionTitle: "The Smith Letters",
    });
    document.querySelector('meta[name="robots"]')?.remove();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    HTMLElement.prototype.scrollTo = originalElementScrollTo;
    vi.unstubAllGlobals();
  });

  it("updates the scan counter and selected thumbnail after scans load and scroll", async () => {
    const loaded = deferred<Letter>();
    getLetterByIdMock.mockReturnValue(loaded.promise);
    const { container } = renderLetterDetailPage();
    expect(screen.getByText("Loading letter...")).toBeInTheDocument();
    await act(async () => loaded.resolve(createLetter({ images: [
      { id: "scan-1", type: "letter", pageNumber: 1, imageUrl: "/images/one.jpg" },
      { id: "scan-2", type: "letter", pageNumber: 2, imageUrl: "/images/two.jpg" },
    ] })));
    const carousel = container.querySelector<HTMLDivElement>(".scan-carousel")!;
    Object.defineProperty(carousel, "clientWidth", { value: 200 });
    carousel.getBoundingClientRect = () => ({ left: 500, width: 200 }) as DOMRect;
    Array.from(carousel.children).forEach((slide, index) => {
      slide.getBoundingClientRect = () => ({ left: 510 + index * 220 - carousel.scrollLeft, width: 180 }) as DOMRect;
    });
    fireEvent.touchStart(carousel);
    carousel.scrollLeft = 220;
    fireEvent.scroll(carousel);
    await waitFor(() => expect(screen.getByRole("status", { name: "Scan page" })).toHaveTextContent("2 / 2"));
    expect(screen.getByRole("button", { name: "Go to scan 2: letter" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Go to scan 1: letter" })).not.toHaveAttribute("aria-current");
  });

  it("resets unknown and absent image parameters on same-letter navigation", async () => {
    const user = userEvent.setup();
    getLetterByIdMock.mockResolvedValue(createLetter({ images: [
      ...createLetter().images,
      { id: "img-2", type: "letter", pageNumber: 2, imageUrl: "/images/two.jpg" },
    ] }));
    const { container } = renderLetterDetailPage();
    await screen.findByRole("article");
    const carousel = container.querySelector<HTMLDivElement>(".scan-carousel")!;
    Object.defineProperty(carousel, "clientWidth", { value: 200 });
    carousel.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
    Array.from(carousel.children).forEach((slide, index) => {
      slide.getBoundingClientRect = () => ({ left: index * 220 - carousel.scrollLeft, width: 200 }) as DOMRect;
    });
    carousel.scrollTo = vi.fn();
    await user.click(screen.getByRole("link", { name: "Select second scan" }));
    expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: 220, behavior: "instant" });
    carousel.scrollLeft = 220;
    await user.click(screen.getByRole("link", { name: "Select unknown scan" }));
    expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "instant" });
    await user.click(screen.getByRole("link", { name: "Select second scan" }));
    await user.click(screen.getByRole("link", { name: "Clear scan selection" }));
    expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "instant" });
    expect(getLetterByIdMock).toHaveBeenCalledTimes(1);
  });

  it("renders the editorial page with hero, summary, and transcript", async () => {
    renderLetterDetailPage();

    // Hero: hook as headline
    expect(await screen.findByText(/A bright dispatch from Vienna/)).toBeInTheDocument();

    // Hero: correspondent line
    expect(screen.getByText("Written by Alice Smith to Bob Baker")).toBeInTheDocument();

    // Hero: dateline
    expect(screen.getByRole("heading", { name: "August 10, 1947" })).toBeInTheDocument();
    expect(screen.getByText("Vienna")).toBeInTheDocument();

    // Summary
    expect(screen.getByText("About This Letter")).toBeInTheDocument();
    expect(screen.getByText(/Alice writes to Bob/)).toBeInTheDocument();

    // Transcript
    expect(screen.getByText(/My dearest friend/)).toBeInTheDocument();

    // Collection navigation lives in the header, not below the letter.
    expect(screen.queryByText("Letter 2 of 3")).not.toBeInTheDocument();
    expect(document.querySelector(".letter-nav-section")).toBeNull();
  });

  it("keeps the page usable when adjacent letter lookup fails", async () => {
    getAdjacentLettersMock.mockRejectedValueOnce(new Error("adjacency unavailable"));

    renderLetterDetailPage();

    expect(await screen.findByText(/A bright dispatch/)).toBeInTheDocument();
    expect(screen.queryByText(/Previous/)).not.toBeInTheDocument();
  });

  it("shows the fallback error state when the letter cannot be loaded", async () => {
    const user = userEvent.setup();
    getLetterByIdMock.mockRejectedValueOnce(new Error("Letter is unavailable"));

    renderLetterDetailPage();

    expect(await screen.findByRole("heading", { name: "Letter is unavailable" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Browse Collections" }));
    expect(mockNavigate).toHaveBeenCalledWith("/collections");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("handles letters with minimal metadata gracefully", async () => {
    getLetterByIdMock.mockResolvedValue(
      createLetter({
        metadata: { verified: false },
        images: [],
        transcript: { pages: [], fullText: "", verified: false },
        linkedPersons: [],
        linkedPlaces: [],
      }),
    );

    renderLetterDetailPage();

    // Page loads without crashing on minimal data
    await screen.findByRole("article");
    // No hero narrative
    expect(screen.queryByText(/Written by/)).not.toBeInTheDocument();
    // No scan image
    expect(screen.queryByRole("button", { name: "View full size" })).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps photo-primary records in the photo workflow (mixed=%s)', async mixed => {
    getLetterByIdMock.mockResolvedValue(createLetter({
      images: [{ id: 'photo', type: 'photo', imageUrl: '/images/photo.jpg' }, ...(mixed ? createLetter().images : [])],
      readingText: 'Published reading text from an older workflow.',
      photoDescription: 'A family in the garden.',
    }));
    renderLetterDetailPage();
    await screen.findByText('A family in the garden.');
    expect(screen.queryByRole('heading', { name: 'Transcript' })).not.toBeInTheDocument();
    expect(screen.queryByText('Published reading text from an older workflow.')).not.toBeInTheDocument();
  });

  it('falls back to page text when saved reading text is only whitespace', async () => {
    getLetterByIdMock.mockResolvedValue(createLetter({ readingText: '  \n  ' }));
    renderLetterDetailPage();
    expect(await screen.findByText('My dearest friend...')).toBeVisible();
  });

  it("keeps published text readable when scans are absent", async () => {
    getLetterByIdMock.mockResolvedValue(createLetter({ images: [], readingText: "A saved paragraph.\n\nP.S. Please write soon." }));
    renderLetterDetailPage();
    await screen.findByText(/A saved paragraph/);
    expect(document.querySelector('.transcript-reading-saved')?.textContent).toBe("A saved paragraph.\n\nP.S. Please write soon.");
    expect(screen.getByText("Original scans are not available.")).toBeInTheDocument();
  });

  it("selects the main scan without opening focus mode and supports keyboard zoom", async () => {
    const user = userEvent.setup();
    getLetterByIdMock.mockResolvedValue(createLetter({ images: [
      { id: 'card-first', type: 'card', imageUrl: '/images/card.jpg' },
      ...createLetter().images,
    ] }));
    renderLetterDetailPage();
    await user.click(await screen.findByRole('button', { name: 'Original formatting' }));
    expect(screen.queryByRole('button', { name: /View page .* on scan/ })).not.toBeInTheDocument();
    const scan = screen.getByRole('button', { name: 'Select page 1' });
    await user.click(scan);
    expect(screen.queryByText('LetterViewer')).not.toBeInTheDocument();
    expect(scan).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(scan, { key: '+' });
    expect(await screen.findByText('LetterViewer')).toHaveAttribute('data-index', '1');
  });

  it("keeps extra documents separate and links every associated source", async () => {
    getLetterByIdMock.mockResolvedValue(createLetter({
      readingText: "The published letter.\n\nWith love, Alice.",
      extraContentStatus: "VERIFIED",
      extraContentItems: [{ type: "card", label: "Enclosed card", transcript: "A separate message.\nSecond line.", imageIds: ["card-1", "card-2"] }],
      images: [...createLetter().images, ...[1, 2].map(n => ({ id: `card-${n}`, type: "card" as const, imageUrl: `/images/card-${n}.jpg` }))],
    }));
    renderLetterDetailPage();
    const extra = (await screen.findByRole("heading", { name: "Enclosed card" })).closest("section");
    expect(extra).toHaveTextContent("A separate message.");
    expect(extra).not.toHaveTextContent("The published letter.");
    expect(extra?.querySelectorAll("button")).toHaveLength(2);
    expect(document.querySelector(".transcript-reading-saved")?.textContent).toBe("The published letter.\n\nWith love, Alice.");
  });

  it("does not render entity chips on the public letter page", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    expect(screen.queryByText("People & Places")).not.toBeInTheDocument();
  });

  it("renders a visible date heading with correspondent information", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch from Vienna/);

    const h1 = screen.getByRole("heading", { level: 1, name: "August 10, 1947" });
    expect(h1).toBeInTheDocument();
    expect(h1).not.toHaveClass("sr-only");
  });

  it("sets noindex meta on error state", async () => {
    getLetterByIdMock.mockRejectedValueOnce(new Error("Letter is unavailable"));

    renderLetterDetailPage();

    await screen.findByRole("heading", { name: "Letter is unavailable" });

    await waitFor(() => {
      expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
        "content",
        expect.stringContaining("noindex"),
      );
    });
  });

  it("leaves horizontal transcript touches to the browser without changing letters", async () => {
    renderLetterDetailPage();
    const transcript = await screen.findByText("My dearest friend...");
    const article = document.querySelector(".letter-article")!;
    Object.defineProperty(article, "clientWidth", { value: 390 });
    mockNavigate.mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.touchStart(transcript, { touches: [{ clientX: 300, clientY: 200 }] });
      const browserRetainsGesture = fireEvent.touchMove(transcript, {
        touches: [{ clientX: 80, clientY: 210 }], cancelable: true,
      });
      fireEvent.touchEnd(transcript, { touches: [] });
      act(() => vi.advanceTimersByTime(500));
      expect(browserRetainsGesture).toBe(true);
      expect((article as HTMLElement).style.transform).toBe("");
      expect(mockNavigate).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("keeps keyboard letter navigation active", async () => {
    renderLetterDetailPage();
    await screen.findByText(/A bright dispatch/);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(getLetterByIdMock).toHaveBeenCalledWith("letter-2", expect.any(AbortSignal)));
  });

  it("marks retained content pending and renders the next letter before adjacency arrives", async () => {
    const letter2 = deferred<Letter>();
    const adjacent2 = deferred<{
      prev: { id: string };
      next: { id: string };
      prevWraps: boolean;
      nextWraps: boolean;
      position: number;
      total: number;
      collectionCode: string;
      collectionTitle: string;
    }>();
    getLetterByIdMock.mockImplementation((id: string) => (
      id === "letter-2" ? letter2.promise : Promise.resolve(createLetter())
    ));
    getAdjacentLettersMock.mockImplementation((id: string) => (
      id === "letter-2"
        ? adjacent2.promise
        : Promise.resolve({
            prev: { id: "letter-0" },
            next: { id: "letter-2" },
            prevWraps: false,
            nextWraps: false,
            position: 2,
            total: 3,
            collectionCode: "009",
            collectionTitle: "The Smith Letters",
          })
    ));

    const user = userEvent.setup();
    renderLetterDetailPage();
    expect(await screen.findByText(/A bright dispatch from Vienna/)).toBeInTheDocument();
    mockNavigate.mockClear();

    await user.click(screen.getByRole("link", { name: "Go to letter 2" }));
    await waitFor(() => {
      expect(getLetterByIdMock).toHaveBeenCalledWith(
        "letter-2",
        expect.any(AbortSignal),
      );
    });

    expect(screen.getByText(/A bright dispatch from Vienna/)).toBeInTheDocument();
    expect(screen.getByText("Loading letter...")).toBeInTheDocument();
    expect(document.querySelector("article")).toHaveAttribute("inert");
    expect(document.querySelector(".letter-nav-section")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(mockNavigate).not.toHaveBeenCalled();


    await act(async () => {
      letter2.resolve(createLetter({
        id: "letter-2",
        title: "letter-2",
        metadata: {
          ...createLetter().metadata,
          hook: "A second dispatch",
        },
      }));
    });
    expect(await screen.findByText("A second dispatch")).toBeInTheDocument();
    expect(screen.queryByText("Loading letter...")).not.toBeInTheDocument();
    expect(document.querySelector("article")).not.toHaveAttribute("inert");
    expect(document.querySelector(".letter-nav-section")).toBeNull();

    await act(async () => {
      adjacent2.resolve({
        prev: { id: "letter-1" },
        next: { id: "letter-3" },
        prevWraps: false,
        nextWraps: false,
        position: 1,
        total: 2,
        collectionCode: "010",
        collectionTitle: "The Second Collection",
      });
      await Promise.all([letter2.promise, adjacent2.promise]);
    });

    expect(await screen.findByText("A second dispatch")).toBeInTheDocument();
    expect(document.querySelector(".letter-nav-section")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(mockNavigate).toHaveBeenCalledWith("/letter/letter-3");
  });

  it("renders initial letter content while adjacency is still pending", async () => {
    const adjacency = deferred<never>();
    getAdjacentLettersMock.mockReturnValueOnce(adjacency.promise);
    renderLetterDetailPage();
    expect(await screen.findByText(/A bright dispatch/)).toBeInTheDocument();
    expect(screen.queryByText("Loading letter...")).not.toBeInTheDocument();
    await act(async () => adjacency.reject(new Error("optional lookup failed")));
    expect(screen.getByText(/My dearest friend/)).toBeInTheDocument();
  });

  it("ignores late old detail errors and adjacency after rapid navigation", async () => {
    const oldDetail = deferred<Letter>();
    const oldAdjacent = deferred<never>();
    getLetterByIdMock.mockImplementation((id: string) => id === "letter-2"
      ? oldDetail.promise
      : Promise.resolve(createLetter({ id, metadata: { hook: id, verified: false } })));
    getAdjacentLettersMock.mockImplementation((id: string) => id === "letter-2"
      ? oldAdjacent.promise : Promise.resolve(null));
    const user = userEvent.setup();
    renderLetterDetailPage();
    await screen.findByText("letter-1", { exact: true });
    await user.click(screen.getByRole("link", { name: "Go to letter 2" }));
    const oldSignal = getLetterByIdMock.mock.calls.find(([id]) => id === "letter-2")![1] as AbortSignal;
    await user.click(screen.getByRole("link", { name: "Go to letter 3" }));
    await screen.findByText("letter-3", { exact: true });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => {
      oldDetail.reject(new Error("obsolete failure"));
      oldAdjacent.reject(new Error("obsolete adjacency"));
    });
    expect(screen.getByText("letter-3", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("obsolete failure")).not.toBeInTheDocument();
  });

});
