import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const { getUnreadCountMock, getRecentNotificationsMock } = vi.hoisted(() => ({
  getUnreadCountMock: vi.fn(),
  getRecentNotificationsMock: vi.fn(),
}));

vi.mock("../../../api/admin/notifications", () => ({
  getUnreadCount: getUnreadCountMock,
  getRecentNotifications: getRecentNotificationsMock,
}));

const stream = vi.hoisted(() => ({ options: null as import('../../../hooks/useNotificationStream').UseNotificationStreamOptions | null }));
vi.mock('../../../hooks/useNotificationStream', () => ({ useNotificationStream: (options: typeof stream.options) => { stream.options = options; } }));
import AdminSidebar from "../AdminSidebar";
import { NOTIFICATIONS_CHANGED_EVENT } from "../../../services/notificationEvents";

describe("AdminSidebar", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
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

  it('uses a slow healthy-stream safety read, falls back to 30 seconds, and pauses hidden polling', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { stream.options?.onConnectionChange?.(true); await Promise.resolve(); });
    const connectedReads = getUnreadCountMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(299_999); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(connectedReads);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(connectedReads + 1);
    visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(connectedReads + 1);
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(connectedReads + 2);
    await act(async () => { stream.options?.onFallback?.(); await Promise.resolve(); });
    const fallbackReads = getUnreadCountMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(fallbackReads + 1);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap slow unread reads and aborts them on unmount', async () => {
    vi.useFakeTimers();
    getUnreadCountMock.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    act(() => { window.dispatchEvent(new Event('focus')); stream.options?.onFallback?.(); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
    const signal = getUnreadCountMock.mock.calls[0][0] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
  });

  it('keeps incoming notifications when an older unread snapshot finishes late', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    getUnreadCountMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { container, unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    act(() => stream.options?.onNotification({ id: 'new', read: false, severity: 'error' } as import('../../../api/admin/notifications').AdminNotification));
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    await act(async () => { resolve({ count: 0, maxSeverity: null }); await Promise.resolve(); });
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    getUnreadCountMock.mockResolvedValue({ count: 1, maxSeverity: 'error' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    unmount();
  });


  it('refreshes an open notification popover after returning from a hidden tab', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    getUnreadCountMock.mockResolvedValue({ count: 1, maxSeverity: 'info' });
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await user.hover(container.querySelector('.bell-wrapper')!);
    expect(getRecentNotificationsMock).toHaveBeenCalledTimes(1);
    visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => stream.options?.onNotification({ read: false, severity: 'info' } as import('../../../api/admin/notifications').AdminNotification));
    expect(getRecentNotificationsMock).toHaveBeenCalledTimes(1);
    visibility = 'visible'; act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(getRecentNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces local mutations behind a pending count and rejects its stale snapshot', async () => {
    vi.useFakeTimers();
    getUnreadCountMock.mockResolvedValue({ count: 7, maxSeverity: 'error' });
    const { container, unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    let resolveOld!: (value: unknown) => void;
    getUnreadCountMock.mockReturnValueOnce(new Promise(done => { resolveOld = done; }));
    act(() => stream.options?.onConnectionChange?.(true));
    expect(getUnreadCountMock).toHaveBeenCalledTimes(2);
    act(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(2);
    await act(async () => { resolveOld({ count: 99, maxSeverity: 'critical' }); });
    expect(container.querySelector('.bell-badge')).toHaveTextContent('7');
    getUnreadCountMock.mockResolvedValue({ count: 1, maxSeverity: 'info' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(3);
    unmount();
    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)));
    expect(getUnreadCountMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes explicit local changes immediately, including an open preview while hidden', async () => {
    const user = userEvent.setup();
    getUnreadCountMock.mockResolvedValue({ count: 7, maxSeverity: 'error' });
    const { container, unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await user.hover(container.querySelector('.bell-wrapper')!);
    const reads = getUnreadCountMock.mock.calls.length;
    expect(getRecentNotificationsMock).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    getUnreadCountMock.mockResolvedValue({ count: 2, maxSeverity: 'info' });
    await act(async () => { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(reads + 1);
    expect(getRecentNotificationsMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('2');
    unmount();
  });

  it('retries failed initialization in 30 seconds even when SSE is healthy', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    getUnreadCountMock.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const { container, unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    act(() => stream.options?.onConnectionChange?.(true));
    await act(async () => { reject(new Error('Unavailable')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
    getUnreadCountMock.mockResolvedValue({ count: 7, maxSeverity: 'error' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('7');
    await act(async () => { await vi.advanceTimersByTimeAsync(299_999); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('reconciles repeated SSE updates without overlapping reads or polling a hidden tab', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    getUnreadCountMock.mockResolvedValue({ count: 1, maxSeverity: 'warn' });
    const { container, unmount } = render(<MemoryRouter><AdminSidebar /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { stream.options?.onConnectionChange?.(true); });
    const calls = getUnreadCountMock.mock.calls.length;
    let resolve!: (value: unknown) => void;
    getUnreadCountMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const event = { id: 'same-unread-row', read: false, severity: 'warn', dedupeCount: 2 } as import('../../../api/admin/notifications').AdminNotification;
    act(() => { stream.options?.onNotification(event); stream.options?.onNotification(event); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(calls + 1);
    await act(async () => { resolve({ count: 99, maxSeverity: 'critical' }); });
    expect(container.querySelector('.bell-badge')).not.toHaveTextContent('99');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(calls + 2);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    visibility = 'hidden'; act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => stream.options?.onNotification(event));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(calls + 2);
    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getUnreadCountMock).toHaveBeenCalledTimes(calls + 3);
    expect(container.querySelector('.bell-badge')).toHaveTextContent('1');
    unmount();
  });

});
