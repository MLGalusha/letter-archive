import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import CollectionsPage from "../CollectionsPage";

const mockNavigate = vi.fn();
const listCollectionsMock = vi.fn();

vi.mock("../../api/collections", () => ({
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockCollections = [
  {
    id: "c1",
    collectionCode: "001",
    title: "War Letters",
    description: "Frontline correspondence",
    letterCount: 12,
  },
  {
    id: "c2",
    collectionCode: "002",
    title: "Family Notes",
    description: "Domestic stories",
    letterCount: 4,
  },
  {
    id: "c3",
    collectionCode: "003",
    title: "Travel Diary",
    description: "Journey observations",
    letterCount: 2,
  },
];

describe("CollectionsPage", () => {
  beforeEach(() => {
    listCollectionsMock.mockReset();
    mockNavigate.mockReset();
    listCollectionsMock.mockResolvedValue(mockCollections);
  });

  it("filters and sorts collections from the new controls", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("War Letters")).toBeInTheDocument();
    });

    expect(container.querySelectorAll(".public-collection-card")).toHaveLength(3);

    await user.type(screen.getByLabelText("Search collections"), "travel");
    expect(screen.getByText("Travel Diary")).toBeInTheDocument();
    expect(screen.queryByText("War Letters")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search collections"));
    await user.selectOptions(screen.getByLabelText("Sort collections"), "letters-asc");

    const titles = Array.from(container.querySelectorAll(".public-collection-card h3")).map((el) =>
      el.textContent?.trim(),
    );
    expect(titles[0]).toBe("Travel Diary");
  });

  it("random collection button navigates to a visible collection", async () => {
    const user = userEvent.setup();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("War Letters")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Random Collection" }));
    expect(mockNavigate).toHaveBeenCalledWith("/collections/001");

    randomSpy.mockRestore();
  });
});
