import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Header from "../Header";
import { HeaderDockProvider, useHeaderDock } from "../../../contexts/HeaderDockContext";

vi.mock("../../../hooks/useScrollDirection", () => ({
  default: () => true, // always visible
}));

vi.mock("../../../api/collections", () => ({
  getCachedCollections: () => null,
  listCollections: vi.fn(),
  prefetchCollections: vi.fn(),
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

    // Click a nav link
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

  it("dock content renders when provided via context", () => {
    render(
      <MemoryRouter>
        <HeaderDockProvider>
          <DockSetter content={<span>Dock Content Here</span>} />
          <Header />
        </HeaderDockProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Dock Content Here")).toBeInTheDocument();
  });
});

/** Helper component that sets dock state from inside the provider tree */
function DockSetter({ content }: { content: React.ReactNode }) {
  const { setDock } = useHeaderDock();

  useEffect(() => {
    setDock({
      content,
      active: true,
      visible: true,
    });
  }, []);

  return null;
}
