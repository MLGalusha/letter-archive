import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { AdminNotification } from '../../../api/admin/notifications';

const {
  getNotificationsMock,
  getNotificationCountsMock,
  bulkMarkReadMock,
  bulkResolveMock,
  bulkArchiveMock,
  bulkDeleteMock,
  resolveNotificationMock,
  archiveNotificationMock,
  deleteNotificationMock,
  markAsReadMock,
} = vi.hoisted(() => ({
  getNotificationsMock: vi.fn(),
  getNotificationCountsMock: vi.fn(),
  bulkMarkReadMock: vi.fn(),
  bulkResolveMock: vi.fn(),
  bulkArchiveMock: vi.fn(),
  bulkDeleteMock: vi.fn(),
  resolveNotificationMock: vi.fn(),
  archiveNotificationMock: vi.fn(),
  deleteNotificationMock: vi.fn(),
  markAsReadMock: vi.fn(),
}));

vi.mock('../../../api/admin/notifications', () => ({
  getNotifications: getNotificationsMock,
  getNotificationCounts: getNotificationCountsMock,
  bulkMarkRead: bulkMarkReadMock,
  bulkResolve: bulkResolveMock,
  bulkArchive: bulkArchiveMock,
  bulkDelete: bulkDeleteMock,
  resolveNotification: resolveNotificationMock,
  archiveNotification: archiveNotificationMock,
  deleteNotification: deleteNotificationMock,
  markAsRead: markAsReadMock,
}));

vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../components/common/Icon', () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import NotificationsPage from '../NotificationsPage';

function makeNotif(overrides: Partial<AdminNotification> = {}): AdminNotification {
  return {
    id: overrides.id ?? 'n1',
    type: 'transcription_failed',
    severity: 'error',
    status: 'open',
    sourceType: 'letter',
    sourceId: 'letter-1',
    title: 'Transcription failed',
    message: 'Could not transcribe page 3',
    link: '/admin/letters/letter-1',
    metadata: null,
    read: false,
    dedupeKey: null,
    dedupeCount: 1,
    lastOccurredAt: '2026-04-08T10:00:00.000Z',
    expiresAt: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: '2026-04-08T10:00:00.000Z',
    ...overrides,
  };
}

function defaultListResponse(notifications: AdminNotification[] = []) {
  return {
    notifications,
    total: notifications.length,
    unreadCount: notifications.filter((n) => !n.read).length,
  };
}

function defaultCounts() {
  return {
    total: 12,
    unread: 5,
    bySeverity: { info: 3, warn: 2, error: 5, critical: 2 },
    byStatus: { open: 7, acknowledged: 1, resolved: 3, archived: 1 },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotificationsMock.mockResolvedValue(
      defaultListResponse([
        makeNotif({ id: 'a', title: 'Transcription failed', severity: 'error' }),
        makeNotif({
          id: 'b',
          title: 'Upload complete',
          severity: 'info',
          type: 'upload_success',
          sourceType: 'collection',
          sourceId: 'col-1',
          dedupeCount: 4,
        }),
      ]),
    );
    getNotificationCountsMock.mockResolvedValue(defaultCounts());
    bulkMarkReadMock.mockResolvedValue({ success: true, count: 0 });
    bulkResolveMock.mockResolvedValue({ success: true, count: 0 });
    bulkArchiveMock.mockResolvedValue({ success: true, count: 0 });
    bulkDeleteMock.mockResolvedValue({ success: true, count: 0 });
    resolveNotificationMock.mockResolvedValue(makeNotif({ status: 'resolved' }));
    archiveNotificationMock.mockResolvedValue(makeNotif({ status: 'archived' }));
    deleteNotificationMock.mockResolvedValue(undefined);
    markAsReadMock.mockResolvedValue(makeNotif({ read: true }));
  });

  it('renders rows with dedupe pill and severity pill counts', async () => {
    renderPage();

    await screen.findByText('Transcription failed');
    expect(screen.getByText('Upload complete')).toBeInTheDocument();

    // Dedupe pill shows ×4 for the upload notification
    expect(screen.getByText('×4')).toBeInTheDocument();

    // Severity counts from /counts populate the pill badges
    expect(screen.getByRole('button', { name: /Info\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Critical\s*2/ })).toBeInTheDocument();
  });

  it('refetches with severity filter when pill is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Transcription failed');

    getNotificationsMock.mockClear();
    await user.click(screen.getByRole('button', { name: /Critical/ }));

    await waitFor(() => {
      expect(getNotificationsMock).toHaveBeenCalled();
    });
    const lastCall = getNotificationsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.severity).toEqual(['critical']);
  });

  it('search updates trigger refetch', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Transcription failed');

    getNotificationsMock.mockClear();
    await user.type(screen.getByLabelText('Search'), 'boom');

    await waitFor(() => {
      const last = getNotificationsMock.mock.calls.at(-1)?.[0];
      expect(last?.search).toBe('boom');
    });
  });

  it('selects rows and runs bulk resolve on selection', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Transcription failed');

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /Select notification/i });
    await user.click(rowCheckboxes[0]);
    await user.click(rowCheckboxes[1]);

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Bulk Resolve lives inside .notif-bulk-actions. Per-row Resolve buttons
    // have aria-label="Resolve" too, so disambiguate by parent.
    const bulkBar = document.querySelector('.notif-bulk-actions') as HTMLElement;
    expect(bulkBar).not.toBeNull();
    await user.click(within(bulkBar).getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(bulkResolveMock).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  it('runs single-row resolve action', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Transcription failed');

    const resolveBtns = screen.getAllByTitle('Resolve');
    await user.click(resolveBtns[0]);

    await waitFor(() => {
      expect(resolveNotificationMock).toHaveBeenCalledWith('a');
    });
  });

  it('switches grouping mode (group-by selector)', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Transcription failed');

    const select = screen.getByLabelText('Group:') as HTMLSelectElement;
    await user.selectOptions(select, 'severity');

    await waitFor(() => {
      expect(
        screen.getByText('Error', { selector: '.notif-group-label' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Info', { selector: '.notif-group-label' }),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state with reset hint when filters return nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    getNotificationsMock.mockResolvedValueOnce(defaultListResponse([]));
    await user.click(screen.getByRole('button', { name: /Critical/ }));

    expect(
      await screen.findByText(/No notifications match these filters/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Try resetting filters or widening the date range/i),
    ).toBeInTheDocument();
  });

  it('opens type dropdown, opens category and filters by individual type checkbox', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    // Open the Type dropdown
    await user.click(screen.getByRole('button', { name: /Type:/i }));

    // Open the "Processing" category inside the dropdown
    await user.click(screen.getByRole('button', { name: /^Processing$/ }));

    const checkbox = screen.getByLabelText('Transcription failed');
    getNotificationsMock.mockClear();
    await user.click(checkbox);

    await waitFor(() => {
      const last = getNotificationsMock.mock.calls.at(-1)?.[0];
      expect(last?.type).toContain('transcription_failed');
    });
  });

  it('master checkbox selects all visible rows', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    const master = screen.getByLabelText('Select all visible');
    await user.click(master);
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(master);
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('renders friendly source label on rows that have a source', async () => {
    renderPage();
    await screen.findByText('Transcription failed');

    expect(screen.getByText(/letter: letter-1/i)).toBeInTheDocument();
    expect(screen.getByText(/collection: col-1/i)).toBeInTheDocument();
  });

  it('shows error banner when fetch fails', async () => {
    getNotificationsMock.mockRejectedValueOnce(new Error('boom'));
    renderPage();

    expect(await screen.findByText(/boom|Failed to load notifications/)).toBeInTheDocument();
  });

  it('renders unread pill in header', async () => {
    renderPage();
    expect(await screen.findByText('2 unread')).toBeInTheDocument();
  });

  it('does not show critical pill as active before click', async () => {
    renderPage();
    await screen.findByText('Transcription failed');

    const pill = screen.getByRole('button', { name: /Critical/ });
    expect(pill.className).not.toContain('active');
  });

  it('reset button clears active filters', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    await user.click(screen.getByRole('button', { name: /Critical/ }));
    const resetBtn = await screen.findByRole('button', { name: /^Reset/ });
    await user.click(resetBtn);

    await waitFor(() => {
      const pill = screen.getByRole('button', { name: /Critical/ });
      expect(pill.className).not.toContain('active');
    });
  });

  it('row checkbox selection invariant', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    const list = screen.getByText('Transcription failed').closest('.notif-list');
    expect(list).not.toBeNull();
    const rowCheckboxes = within(list as HTMLElement).getAllByRole('checkbox');
    expect(rowCheckboxes.length).toBeGreaterThanOrEqual(2);

    await user.click(rowCheckboxes[0]);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('clicking a row opens detail modal with metadata and marks as read', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Transcription failed');

    // Click the row (not the checkbox)
    const rowTitle = screen.getByText('Transcription failed');
    await user.click(rowTitle);

    // Modal shows — the common Modal component renders a dialog with the title
    await waitFor(() => {
      expect(markAsReadMock).toHaveBeenCalledWith('a');
    });
    // Full message rendered in modal body
    expect(screen.getAllByText(/Could not transcribe page 3/i).length).toBeGreaterThan(0);
    // "Open source" action button in modal footer
    expect(screen.getByRole('button', { name: /Open source/i })).toBeInTheDocument();
  });
});
