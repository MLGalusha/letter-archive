import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LetterDetailPage from "../LetterDetailPage";
import { HeaderDockProvider } from "../../contexts/HeaderDockContext";
import type { Letter } from "../../types/Letter";

const mockNavigate = vi.fn();
const getLetterByIdMock = vi.fn();
const getAdjacentLettersMock = vi.fn();

vi.mock("../../api/letters", () => ({
  getLetterById: (...args: unknown[]) => getLetterByIdMock(...args),
  getAdjacentLetters: (...args: unknown[]) => getAdjacentLettersMock(...args),
}));

// Mock LetterViewer since it requires complex DOM setup
vi.mock("../../components/LetterViewer/LetterViewer", () => ({
  default: () => <div>LetterViewer</div>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function createLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: "letter-1",
    title: "letter-1",
    collectionCode: "009",
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
        <Routes>
          <Route path="/letter/:letterId" element={<LetterDetailPage />} />
        </Routes>
      </HeaderDockProvider>
    </MemoryRouter>,
  );
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

    // Filmstrip
    expect(screen.getByText("Letter 2 of 3")).toBeInTheDocument();

    // Teasers — unicode arrows in text
    expect(screen.getByText(/Previous Letter/)).toBeInTheDocument();
    expect(screen.getByText(/Next Letter/)).toBeInTheDocument();
  });

  it("renders teaser cards with correct links", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    const prevLink = screen.getByText(/Previous Letter/).closest("a");
    expect(prevLink).toHaveAttribute("href", "/letter/letter-0");

    const nextLink = screen.getByText(/Next Letter/).closest("a");
    expect(nextLink).toHaveAttribute("href", "/letter/letter-2");

    expect(screen.getByText("Tomorrow we leave for Salzburg")).toBeInTheDocument();
  });

  it("keeps the page usable when adjacent letter lookup fails", async () => {
    getAdjacentLettersMock.mockRejectedValueOnce(new Error("adjacency unavailable"));

    renderLetterDetailPage();

    expect(await screen.findByText(/A bright dispatch/)).toBeInTheDocument();
    expect(screen.queryByText(/Letter 2 of 3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Previous Letter/)).not.toBeInTheDocument();
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
    await screen.findByText("Letter 2 of 3");
    // No hero narrative
    expect(screen.queryByText(/Written by/)).not.toBeInTheDocument();
    // No scan image
    expect(screen.queryByRole("button", { name: "View full size" })).not.toBeInTheDocument();
  });

  it("renders entity chips with links to people and places", async () => {
    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    expect(screen.getByText("People & Places")).toBeInTheDocument();

    const personChip = screen.getByText("Alice Smith").closest("a");
    expect(personChip).toHaveAttribute("href", "/people/person-1");

    const placeChip = screen.getByText("Vienna").closest("a");
    expect(placeChip).toHaveAttribute("href", "/places/place-1");
  });

  it("shows wrap-around labels at collection boundaries", async () => {
    getAdjacentLettersMock.mockResolvedValue({
      prev: { id: "letter-last", dateRaw: "19471231", date: "December 31, 1947", sender: "Alice Smith" },
      next: { id: "letter-2", dateRaw: "19470811", date: "August 11, 1947" },
      prevWraps: true,
      nextWraps: false,
      position: 1,
      total: 5,
      collectionCode: "009",
      collectionTitle: "The Smith Letters",
    });

    renderLetterDetailPage();

    await screen.findByText(/A bright dispatch/);

    // First letter: prev wraps to last
    expect(screen.getByText(/Last in Collection/)).toBeInTheDocument();
    // Next is normal
    expect(screen.getByText(/Next Letter/)).toBeInTheDocument();
  });
});
