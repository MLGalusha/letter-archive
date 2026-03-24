import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CollectionDetailPage from "../CollectionDetailPage";
import type { Letter } from "../../types/Letter";

const mockNavigate = vi.fn();
const getCollectionByCodeMock = vi.fn();

vi.mock("../../api/collections", () => ({
  getCollectionByCode: (...args: unknown[]) => getCollectionByCodeMock(...args),
}));

vi.mock("../../components/LetterCard/LetterCard", () => ({
  default: ({
    letter,
    onClick,
  }: {
    letter: Letter;
    onClick: (letterId: string) => void;
  }) => (
    <button type="button" onClick={() => onClick(letter.id)}>
      {letter.photoDescription || letter.metadata.hook || letter.metadata.date || letter.id}
    </button>
  ),
}));

vi.mock("../../components/Breadcrumb", () => ({
  default: () => <nav>Breadcrumb</nav>,
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
      fullText: "",
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

  it("renders collection insights and lets readers reset empty filter combinations", async () => {
    const user = userEvent.setup();

    renderCollectionDetailPage();

    expect(await screen.findByRole("heading", { name: "Collection Nine" })).toBeInTheDocument();
    expect(screen.getByText("3 items", { selector: ".cd-letters-count" })).toBeInTheDocument();
    expect(screen.getByText(/1947-08-10.*1947-08-12/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visual Highlights" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Story Threads" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Explore by" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Photos 1/i }));
    expect(screen.getByText("1 of 3 items")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Travel 1/i }));

    expect(screen.getByText("0 of 3 items")).toBeInTheDocument();
    expect(screen.getByText("No collection items match the current filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    await waitFor(() => {
      expect(screen.queryByText("No collection items match the current filters.")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "First travel note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Music update" })).toBeInTheDocument();
  });

  it("navigates to the selected letter when a card is clicked", async () => {
    const user = userEvent.setup();

    renderCollectionDetailPage();

    await screen.findByRole("heading", { name: "Collection Nine" });
    await user.click(screen.getByRole("button", { name: "First travel note" }));

    expect(mockNavigate).toHaveBeenCalledWith("/letter/letter-1");
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
});
