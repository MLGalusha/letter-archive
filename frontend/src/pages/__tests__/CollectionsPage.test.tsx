import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import CollectionsPage from "../CollectionsPage";

const listCollectionsMock = vi.fn();

vi.mock("../../api/collections", () => ({
  getCachedCollections: () => null,
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
  prefetchCollections: vi.fn(),
}));

const mockCollections = [
  {
    id: "c1",
    collectionCode: "001",
    title: "War Letters",
    description: "Frontline correspondence",
    hook: "A soldier writes home from the trenches",
    letterCount: 12,
    dateRange: { min: "1943-08-12", max: "1945-12-01" },
    primarySender: "James",
    primaryRecipient: "Margaret",
  },
  {
    id: "c2",
    collectionCode: "002",
    title: "Family Notes",
    description: "Domestic stories",
    hook: null,
    letterCount: 4,
    dateRange: { min: "1952-03-10", max: "1952-06-22" },
    primarySender: "Helen",
    primaryRecipient: "Robert",
  },
  {
    id: "c3",
    collectionCode: "003",
    title: "Travel Diary",
    description: "Journey observations",
    hook: null,
    letterCount: 2,
    dateRange: null,
    primarySender: null,
    primaryRecipient: null,
  },
];

describe("CollectionsPage", () => {
  beforeEach(() => {
    listCollectionsMock.mockReset();
    listCollectionsMock.mockResolvedValue(mockCollections);
  });

  it("sorts collections via custom dropdown", async () => {
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

    // Default sort is collection number asc — War Letters (001) first
    let titles = Array.from(container.querySelectorAll(".collection-card-top h3")).map((el) =>
      el.textContent?.trim(),
    );
    expect(titles[0]).toBe("War Letters");

    // Open dropdown and click active "Collection" to toggle to desc
    await user.click(screen.getByLabelText("Sort collections"));
    let menuOptions = container.querySelectorAll(".sort-option");
    await user.click(menuOptions[0]); // Collection (active) — toggles to desc
    titles = Array.from(container.querySelectorAll(".collection-card-top h3")).map((el) =>
      el.textContent?.trim(),
    );
    expect(titles[0]).toBe("Travel Diary");

    // Dropdown stayed open after toggle — pick "Date" directly
    menuOptions = container.querySelectorAll(".sort-option");
    if (menuOptions.length > 0) {
      await user.click(menuOptions[2]); // Date
    } else {
      // Dropdown closed, reopen and pick
      await user.click(screen.getByLabelText("Sort collections"));
      menuOptions = container.querySelectorAll(".sort-option");
      await user.click(menuOptions[2]);
    }
    titles = Array.from(container.querySelectorAll(".collection-card-top h3")).map((el) =>
      el.textContent?.trim(),
    );
    // Date desc (newest) — Family Notes (1952) first
    expect(titles[0]).toBe("Family Notes");
  });

  it("sort dropdown closes on Escape key", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("War Letters")).toBeInTheDocument();
    });

    // Open the sort dropdown
    await user.click(screen.getByLabelText("Sort collections"));
    const menu = container.querySelector(".sort-menu");
    expect(menu).not.toHaveClass("sort-menu--hidden");

    // Press Escape on a sort option
    const firstOption = container.querySelector(".sort-option")!;
    await user.type(firstOption, "{Escape}");

    // Dropdown should be closed
    expect(container.querySelector(".sort-menu")).toHaveClass("sort-menu--hidden");
  });

  it("sort options respond to Enter key", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("War Letters")).toBeInTheDocument();
    });

    // Default sort is letter count desc — War Letters (12) first
    let titles = Array.from(container.querySelectorAll(".collection-card-top h3")).map((el) =>
      el.textContent?.trim(),
    );
    expect(titles[0]).toBe("War Letters");

    // Open dropdown and use Enter on "Title" option (3rd option)
    await user.click(screen.getByLabelText("Sort collections"));
    const titleOption = container.querySelectorAll(".sort-option")[2]; // Title is 3rd
    (titleOption as HTMLElement).focus();
    await user.keyboard("{Enter}");

    // Should re-sort by title asc — Family Notes first
    titles = Array.from(container.querySelectorAll(".collection-card-top h3")).map((el) =>
      el.textContent?.trim(),
    );
    expect(titles[0]).toBe("Family Notes");
  });

});
