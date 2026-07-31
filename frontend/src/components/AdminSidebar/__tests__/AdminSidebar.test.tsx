import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const { getUnreadCountMock, getRecentNotificationsMock } = vi.hoisted(() => ({
  getUnreadCountMock: vi.fn(),
  getRecentNotificationsMock: vi.fn(),
}));

vi.mock("../../../api/admin/notifications", () => ({
  getUnreadCount: getUnreadCountMock,
  getRecentNotifications: getRecentNotificationsMock,
}));

import AdminSidebar from "../AdminSidebar";

describe("AdminSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUnreadCountMock.mockResolvedValue({
      count: 0,
      bySeverity: { info: 0, warn: 0, error: 0, critical: 0 },
      maxSeverity: null,
    });
    getRecentNotificationsMock.mockResolvedValue({ notifications: [] });
  });

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
      "Layout Lab",
      "Notes",
      "Usage",
      "Upload",
    ]);

    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("colors the bell badge by max severity", async () => {
    getUnreadCountMock.mockResolvedValue({
      count: 7,
      bySeverity: { info: 1, warn: 0, error: 4, critical: 2 },
      maxSeverity: "critical",
    });

    const { container } = render(
      <MemoryRouter>
        <AdminSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument();
    });
    const badge = container.querySelector(".bell-badge");
    expect(badge?.className).toContain("sev-critical");
  });

  it("opens the popover on hover and lists recent unread notifications", async () => {
    const user = userEvent.setup();
    getUnreadCountMock.mockResolvedValue({
      count: 2,
      bySeverity: { info: 1, warn: 0, error: 1, critical: 0 },
      maxSeverity: "error",
    });
    getRecentNotificationsMock.mockResolvedValue({
      notifications: [
        {
          id: "n1",
          type: "transcription_failed",
          severity: "error",
          status: "open",
          sourceType: "letter",
          sourceId: "letter-42",
          sourceLabel: "014 · 1864-03-15",
          title: "Transcription failed",
          message: null,
          link: "/admin/letters/letter-42",
          metadata: null,
          read: false,
          dedupeKey: null,
          dedupeCount: 1,
          lastOccurredAt: "2026-04-08T10:00:00.000Z",
          expiresAt: null,
          resolvedAt: null,
          resolvedBy: null,
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      ],
    });

    const { container } = render(
      <MemoryRouter>
        <AdminSidebar />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    const wrapper = container.querySelector(".bell-wrapper");
    expect(wrapper).not.toBeNull();
    await user.hover(wrapper as HTMLElement);

    expect(await screen.findByText("Transcription failed")).toBeInTheDocument();
    // Source now renders the friendly server-enriched label, not the raw UUID.
    expect(screen.getByText("014 · 1864-03-15")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all notifications/i })).toBeInTheDocument();
  });

  it("does not render popover when there are no unread notifications", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <AdminSidebar />
      </MemoryRouter>,
    );

    const wrapper = container.querySelector(".bell-wrapper");
    await user.hover(wrapper as HTMLElement);

    // Popover does not render when count is 0
    expect(container.querySelector(".bell-popover")).toBeNull();
  });
});
