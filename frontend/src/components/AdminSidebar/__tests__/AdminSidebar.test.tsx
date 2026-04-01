import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminSidebar from "../AdminSidebar";

vi.mock("../../../api/admin/notifications", () => ({
  getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
}));

describe("AdminSidebar", () => {
  it("renders the primary admin navigation in the requested order", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AdminSidebar />
      </MemoryRouter>,
    );

    const nav = container.querySelector(".sidebar-nav");
    expect(nav).not.toBeNull();

    const links = within(nav as HTMLElement).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Dashboard",
      "Content",
      "Processing",
      "Notes",
      "Usage",
      "Upload",
    ]);

    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});
