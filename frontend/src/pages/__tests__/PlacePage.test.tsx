import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlacePage from "../PlacePage";
import type { PublicPlaceDetail } from "../../api/entities";

const mockNavigate = vi.fn();
const getPlacePublicMock = vi.fn();

vi.mock("../../api/entities", () => ({
  getPlacePublic: (...args: unknown[]) => getPlacePublicMock(...args),
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

function renderPlacePage() {
  return render(
    <MemoryRouter initialEntries={["/places/place-1"]}>
      <Routes>
        <Route path="/places/:placeId" element={<PlacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const data: PublicPlaceDetail = {
      place: {
        id: "place-1",
        canonicalName: "Vienna",
        aliases: ["Wien"],
        placeType: "city",
        notes: "Historic capital.\n\nCultural crossroads.",
        themes: ["music", "travel"],
      },
      stats: {
        writtenFrom: 1,
        destination: 0,
        mentioned: 1,
        total: 2,
      },
      letters: [
        {
          id: "letter-1",
          dateRaw: "19470810",
          letterDate: "1947-08-10",
          role: "written_from",
          sender: "Alice Smith",
          recipient: "Bob Baker",
          hook: "Written from Vienna",
          summary: "Summary one",
        },
      ],
    };

    getPlacePublicMock.mockResolvedValue(data);
  });

  it("renders themes, description, stats, and navigates from letter items", async () => {
    const user = userEvent.setup();
    const { container } = renderPlacePage();

    expect(await screen.findByRole("heading", { name: "Vienna" })).toBeInTheDocument();
    expect(screen.getByText("city")).toBeInTheDocument();
    expect(screen.getByText("Also known as: Wien")).toBeInTheDocument();
    expect(screen.getByText("music")).toBeInTheDocument();
    expect(screen.getByText("travel")).toBeInTheDocument();
    expect(screen.getByText("Historic capital.")).toBeInTheDocument();
    expect(screen.getByText("Cultural crossroads.")).toBeInTheDocument();
    expect(screen.getByText("Letters (1)")).toBeInTheDocument();

    const letterItem = container.querySelector(".letter-item");
    expect(letterItem).not.toBeNull();

    await user.click(letterItem!);

    expect(mockNavigate).toHaveBeenCalledWith("/letter/letter-1");
  });

  it("shows an empty-state message when the place has no published letters", async () => {
    getPlacePublicMock.mockResolvedValueOnce({
      place: {
        id: "place-1",
        canonicalName: "Vienna",
        aliases: [],
      },
      stats: {
        writtenFrom: 0,
        destination: 0,
        mentioned: 0,
        total: 0,
      },
      letters: [],
    });

    renderPlacePage();

    expect(await screen.findByRole("heading", { name: "Vienna" })).toBeInTheDocument();
    expect(
      screen.getByText("No published letters mentioning this place."),
    ).toBeInTheDocument();
  });

  it("shows the not-found state and navigates back on failure", async () => {
    const user = userEvent.setup();
    getPlacePublicMock.mockRejectedValueOnce(new Error("Place unavailable"));

    renderPlacePage();

    expect(await screen.findByRole("heading", { name: "Place Not Found" })).toBeInTheDocument();
    expect(screen.getByText("Place unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back" }));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
