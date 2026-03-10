import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LetterDetailPage from "../LetterDetailPage";
import type { Letter } from "../../types/Letter";

const mockNavigate = vi.fn();
const getLetterByIdMock = vi.fn();
const getAdjacentLettersMock = vi.fn();

vi.mock("../../api/letters", () => ({
  getLetterById: (...args: unknown[]) => getLetterByIdMock(...args),
  getAdjacentLetters: (...args: unknown[]) => getAdjacentLettersMock(...args),
}));

vi.mock("../../components/LetterDisplay/LetterDisplay", () => ({
  default: ({ letter }: { letter: { id: string } }) => <div>LetterDisplay:{letter.id}</div>,
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
    images: [],
    transcript: {
      pages: [],
      fullText: "",
      verified: false,
    },
    metadata: {
      date: "1947-08-10",
      dateRaw: "19470810",
      sender: "Alice Smith",
      recipient: "Bob Baker",
      location: "Vienna",
      hook: "A bright dispatch from Vienna",
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
      {
        id: "lp-2",
        personId: "person-1",
        canonicalName: "Alice Smith",
        role: "mentioned",
        confidence: 0.88,
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
      <Routes>
        <Route path="/letter/:letterId" element={<LetterDetailPage />} />
      </Routes>
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
      prev: "letter-0",
      next: "letter-2",
      position: 2,
      total: 3,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders header controls, adjacent nav, and LetterDisplay", async () => {
    const user = userEvent.setup();

    renderLetterDetailPage();

    // Wait for data to load — LetterDisplay renders once letter is fetched
    expect(await screen.findByText("LetterDisplay:letter-1")).toBeInTheDocument();

    // Adjacent controls in header
    expect(screen.getByText("Letter 2 of 3 in this collection")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous Letter" }));
    await user.click(screen.getByRole("button", { name: "Collection 009" }));

    expect(mockNavigate).toHaveBeenCalledWith("/letter/letter-0");
    expect(mockNavigate).toHaveBeenCalledWith("/collections/009");
  });

  it("keeps the page usable when adjacent letter lookup fails", async () => {
    getAdjacentLettersMock.mockRejectedValueOnce(new Error("adjacency unavailable"));

    renderLetterDetailPage();

    expect(await screen.findByText("LetterDisplay:letter-1")).toBeInTheDocument();
    expect(screen.queryByText(/Letter 2 of 3/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous Letter" })).not.toBeInTheDocument();
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
});
