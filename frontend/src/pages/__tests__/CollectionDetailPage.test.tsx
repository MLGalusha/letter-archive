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
    id,
    hook,
    date,
    onClick,
  }: {
    id: string;
    hook?: string;
    date?: string;
    onClick: (letterId: string) => void;
  }) => (
    <button type="button" onClick={() => onClick(id)}>
      {hook || date || id}
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
    images: [],
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
          metadata: {
            date: "1947-08-12",
            dateRaw: "19470812",
            sender: "Alice Smith",
            recipient: "Bob Baker",
            hook: "Encore from the road",
            primaryTopics: ["Music"],
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
    expect(screen.getByText("3 letters in this collection")).toBeInTheDocument();
    expect(screen.getByText("1947-08-10 → 1947-08-12")).toBeInTheDocument();
    expect(screen.getByText("Frequent Names in This Collection")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Travel 1/i }));
    await user.click(screen.getByRole("button", { name: /Cara Jones → Dan Stone/i }));

    expect(screen.getByText("Showing 0 of 3 letters")).toBeInTheDocument();
    expect(screen.getByText("No letters match the current filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));

    await waitFor(() => {
      expect(screen.getByText("Showing 3 of 3 letters")).toBeInTheDocument();
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
