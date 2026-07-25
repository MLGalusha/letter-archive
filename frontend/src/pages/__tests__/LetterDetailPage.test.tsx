import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import LetterDetailPage from "../LetterDetailPage";
import { HeaderDockProvider } from "../../contexts/HeaderDockContext";
import type { Letter } from "../../types/Letter";

const { latestSwipeOptions } = vi.hoisted(() => ({
  latestSwipeOptions: {
    current: null as null | {
      onSwipeLeft?: () => void;
      onSwipeRight?: () => void;
      enabled?: boolean;
    },
  },
}));
const mockNavigate = vi.fn();
const getLetterByIdMock = vi.fn();
const getAdjacentLettersMock = vi.fn();

vi.mock("../../api/letters", () => ({
  getLetterById: (...args: unknown[]) => getLetterByIdMock(...args),
  getAdjacentLetters: (...args: unknown[]) => getAdjacentLettersMock(...args),
  getArchiveShelfItems: vi.fn().mockResolvedValue({ letters: [], total: 0 }),
}));

// Mock LetterViewer since it requires complex DOM setup
vi.mock("../../components/LetterViewer/LetterViewer", () => ({
  default: () => <div>LetterViewer</div>,
}));

vi.mock("../../hooks/useIsTouchDevice", () => ({
  default: () => true,
}));

vi.mock("../../hooks/useSwipeNavigation", () => ({
  default: (options: {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    enabled?: boolean;
  }) => {
    latestSwipeOptions.current = options;
    return {
      ref: { current: null },
      offset: 0,
      isSwiping: false,
      isAnimating: false,
    };
  },
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

function renderLetterDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/letter/letter-1"]}>
      <HeaderDockProvider>
        <Link to="/letter/letter-2">Go to letter 2</Link>
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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

describe("LetterDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("renders the editorial page with hero, summary, transcript, and nav", async () => {
    renderLetterDetailPage();

    // Hero: hook as headline
    expect(await screen.findByText(/A bright dispatch from Vienna/)).toBeInTheDocument();

    // Hero: correspondent line
    expect(screen.getByText("Written by Alice Smith to Bob Baker")).toBeInTheDocument();

    // Hero: dateline
    expect(screen.getByText(/August 10, 1947 — Vienna/)).toBeInTheDocument();

    // Summary
    expect(screen.getByText("About This Letter")).toBeInTheDocument();
    expect(screen.getByText(/Alice writes to Bob/)).toBeInTheDocument();

    // Transcript
    expect(screen.getByText(/My dearest friend/)).toBeInTheDocument();

    // Position label
    expect(screen.getByText("Letter 2 of 3")).toBeInTheDocument();

    // Teaser cards
    expect(screen.getByText(/Previous/)).toBeInTheDocument();
    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });

  it("renders teaser cards with correct links", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    const prevLink = screen.getByText(/Previous/).closest("a");
    expect(prevLink).toHaveAttribute("href", "/letter/letter-0");

    const nextLink = screen.getByText(/Next/).closest("a");
    expect(nextLink).toHaveAttribute("href", "/letter/letter-2");
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

  it("does not render entity chips on the public letter page", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    expect(screen.queryByText("People & Places")).not.toBeInTheDocument();
  });

  it("renders an sr-only h1 with sender/recipient info", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch from Vienna/);

    const h1 = screen.getByRole("heading", { level: 1, name: /Letter from Alice Smith to Bob Baker/ });
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveClass("sr-only");
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

  it("keeps the previous letter visible but disables stale navigation until the new route owns both responses", async () => {
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
    expect(latestSwipeOptions.current?.enabled).toBe(true);
    mockNavigate.mockClear();

    await user.click(screen.getByRole("link", { name: "Go to letter 2" }));
    await waitFor(() => {
      expect(getLetterByIdMock).toHaveBeenCalledWith(
        "letter-2",
        expect.any(AbortSignal),
      );
    });

    expect(screen.getByText(/A bright dispatch from Vienna/)).toBeInTheDocument();
    expect(document.querySelector(".letter-nav-section")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(latestSwipeOptions.current).toMatchObject({
      enabled: false,
      onSwipeLeft: undefined,
      onSwipeRight: undefined,
    });

    await act(async () => {
      letter2.resolve(createLetter({
        id: "letter-2",
        title: "letter-2",
        metadata: {
          ...createLetter().metadata,
          hook: "A second dispatch",
        },
      }));
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
    expect(document.querySelector(".letter-nav-section")).not.toBeNull();
    expect(latestSwipeOptions.current?.enabled).toBe(true);
    expect(latestSwipeOptions.current?.onSwipeLeft).toEqual(
      expect.any(Function),
    );
    expect(latestSwipeOptions.current?.onSwipeRight).toEqual(
      expect.any(Function),
    );
  });

});
