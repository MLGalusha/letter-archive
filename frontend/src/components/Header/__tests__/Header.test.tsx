import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Header from "../Header";
import HeaderDock from "../HeaderDock";
import { HeaderDockProvider } from "../../../contexts/HeaderDockContext";

vi.mock("../../../hooks/useHeaderScroll", () => ({
  default: () => ({ visible: true, atTop: true }),
}));

vi.mock("../../../api/collections", () => ({
  listCollections: vi.fn(),
}));

function renderHeader(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <HeaderDockProvider>
        <Header />
      </HeaderDockProvider>
    </MemoryRouter>,
  );
}

describe("Header", () => {
  it("renders all navigation links", () => {
    renderHeader();

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Journal")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
  });

  it("renders the current site brand", () => {
    renderHeader();

    expect(screen.getByText("A Letter Archive")).toBeInTheDocument();
    expect(screen.getByText("Voices That Remain")).toBeInTheDocument();
  });

  it("Home link is active when on /", () => {
    renderHeader(["/"]);

    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink).toHaveClass("active");
  });

  it("Journal link is active when on /blog", () => {
    renderHeader(["/blog"]);

    const journalLink = screen.getByText("Journal").closest("a");
    expect(journalLink).toHaveClass("active");
  });

  it("Collections link is active when on /collections", () => {
    renderHeader(["/collections"]);

    const collectionsLink = screen.getByText("Collections").closest("a");
    expect(collectionsLink).toHaveClass("active");
  });

  it("About link is active when on /about", () => {
    renderHeader(["/about"]);

    const aboutLink = screen.getByText("About").closest("a");
    expect(aboutLink).toHaveClass("active");
  });

  it("mobile menu toggle opens and closes nav", async () => {
    const user = userEvent.setup();
    const { container } = renderHeader();

    const nav = container.querySelector("nav");
    expect(nav).not.toHaveClass("open");

    const toggleBtn = screen.getByLabelText("Toggle navigation");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");

    await user.click(toggleBtn);
    expect(nav).toHaveClass("open");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");

    await user.click(toggleBtn);
    expect(nav).not.toHaveClass("open");
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("menu closes on link click", async () => {
    const user = userEvent.setup();
    const { container } = renderHeader();

    const toggleBtn = screen.getByLabelText("Toggle navigation");
    await user.click(toggleBtn);

    const nav = container.querySelector("nav");
    expect(nav).toHaveClass("open");

    await user.click(screen.getByText("Journal"));

    expect(nav).not.toHaveClass("open");
  });

  it("menu closes when Support link is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderHeader();

    await user.click(screen.getByLabelText("Toggle navigation"));
    const nav = container.querySelector("nav");
    expect(nav).toHaveClass("open");

    await user.click(screen.getByText("Support"));
    expect(nav).not.toHaveClass("open");
  });

  it("menu closes when brand link is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderHeader();

    await user.click(screen.getByLabelText("Toggle navigation"));
    const nav = container.querySelector("nav");
    expect(nav).toHaveClass("open");

    await user.click(screen.getByRole("link", { name: /A Letter Archive/i }));
    expect(nav).not.toHaveClass("open");
  });

  it("renders a skip-to-content link", () => {
    renderHeader();

    const skipLink = screen.getByText("Skip to content");
    expect(skipLink.tagName).toBe("A");
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(skipLink).toHaveClass("skip-link");
  });

  it("dock content renders when provided via HeaderDock", async () => {
    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <Header />
          <HeaderDock>
            <span>Dock Content Here</span>
          </HeaderDock>
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    // Portal lands in the slot once it registers (synchronous in tests).
    expect(await screen.findByText("Dock Content Here")).toBeInTheDocument();
  });
});
