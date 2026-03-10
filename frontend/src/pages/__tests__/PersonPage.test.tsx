import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PersonPage from "../PersonPage";
import type { PublicPersonDetail } from "../../api/entities";

const mockNavigate = vi.fn();
const getPersonPublicMock = vi.fn();

vi.mock("../../api/entities", () => ({
  getPersonPublic: (...args: unknown[]) => getPersonPublicMock(...args),
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

function renderPersonPage() {
  return render(
    <MemoryRouter initialEntries={["/people/person-1"]}>
      <Routes>
        <Route path="/people/:personId" element={<PersonPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PersonPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const data: PublicPersonDetail = {
      person: {
        id: "person-1",
        canonicalName: "Alice Smith",
        aliases: ["Ally"],
        biography: "First paragraph.\n\nSecond paragraph.",
        biographyStatus: "VERIFIED",
      },
      relationships: [
        {
          id: "rel-1",
          relatedPersonId: "person-2",
          relatedPersonName: "Bob Baker",
          relationshipType: "friend",
        },
      ],
      stats: {
        asSender: 1,
        asRecipient: 0,
        asMentioned: 1,
        total: 2,
      },
      letters: [
        {
          id: "letter-1",
          dateRaw: "19470810",
          letterDate: "1947-08-10",
          role: "sender",
          sender: "Alice Smith",
          recipient: "Bob Baker",
          hook: "First public letter",
          summary: "Summary one",
        },
      ],
    };

    getPersonPublicMock.mockResolvedValue(data);
  });

  it("renders biography, relationship links, stats, and navigates from letter items", async () => {
    const user = userEvent.setup();
    const { container } = renderPersonPage();

    expect(await screen.findByRole("heading", { name: "Alice Smith" })).toBeInTheDocument();
    expect(screen.getByText("Also known as: Ally")).toBeInTheDocument();
    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bob Baker" })).toHaveAttribute(
      "href",
      "/people/person-2",
    );
    expect(screen.getByText("Letters Sent")).toBeInTheDocument();
    expect(screen.getByText("Letters (1)")).toBeInTheDocument();

    const letterItem = container.querySelector(".letter-item");
    expect(letterItem).not.toBeNull();

    await user.click(letterItem!);

    expect(mockNavigate).toHaveBeenCalledWith("/letter/letter-1");
  });

  it("shows an empty-state message when the person has no published letters", async () => {
    getPersonPublicMock.mockResolvedValueOnce({
      person: {
        id: "person-1",
        canonicalName: "Alice Smith",
        aliases: [],
      },
      relationships: [],
      stats: {
        asSender: 0,
        asRecipient: 0,
        asMentioned: 0,
        total: 0,
      },
      letters: [],
    });

    renderPersonPage();

    expect(await screen.findByRole("heading", { name: "Alice Smith" })).toBeInTheDocument();
    expect(
      screen.getByText("No published letters involving this person."),
    ).toBeInTheDocument();
  });

  it("shows the not-found state and navigates back on failure", async () => {
    const user = userEvent.setup();
    getPersonPublicMock.mockRejectedValueOnce(new Error("Person unavailable"));

    renderPersonPage();

    expect(await screen.findByRole("heading", { name: "Person Not Found" })).toBeInTheDocument();
    expect(screen.getByText("Person unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← Back" }));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
