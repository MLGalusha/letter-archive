import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const {
  logoutMock,
  createInviteMock,
  getSettingsMock,
  updateSettingsMock,
  getInvitesMock,
  getAdminUsersMock,
  revokeInviteMock,
  deleteAdminUserMock,
  changePasswordMock,
  getSystemInfoMock,
} = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  createInviteMock: vi.fn(),
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  getInvitesMock: vi.fn(),
  getAdminUsersMock: vi.fn(),
  revokeInviteMock: vi.fn(),
  deleteAdminUserMock: vi.fn(),
  changePasswordMock: vi.fn(),
  getSystemInfoMock: vi.fn(),
}));

vi.mock('../../../api/auth', () => ({
  logout: logoutMock,
  createInvite: createInviteMock,
}));

vi.mock('../../../api/admin/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
  getInvites: getInvitesMock,
  getAdminUsers: getAdminUsersMock,
  revokeInvite: revokeInviteMock,
  deleteAdminUser: deleteAdminUserMock,
  changePassword: changePasswordMock,
  getSystemInfo: getSystemInfoMock,
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    size: _size,
    icon: _icon,
    iconPosition: _iconPosition,
    active: _active,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../../../components/common/Icon', () => ({
  default: () => <span aria-hidden="true" />,
}));

import SettingsPage from '../SettingsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSettingsMock.mockResolvedValue({
      auto_transcribe: 'false',
    });
    getAdminUsersMock.mockResolvedValue({
      currentUserId: 'owner-1',
      currentUserCanDeleteAdminProfiles: true,
      users: [
        {
          id: 'owner-1',
          email: 'owner@example.com',
          canDeleteAdminProfiles: true,
          createdAt: '2026-03-29T00:00:00.000Z',
          isCurrentUser: true,
          canBeDeleted: false,
        },
        {
          id: 'member-1',
          email: 'member@example.com',
          canDeleteAdminProfiles: false,
          createdAt: '2026-03-30T00:00:00.000Z',
          isCurrentUser: false,
          canBeDeleted: true,
        },
      ],
    });
    getInvitesMock.mockResolvedValue([
      {
        id: 'invite-1',
        email: 'pending@example.com',
        invitedBy: 'owner-1',
        inviterEmail: 'owner@example.com',
        createdAt: '2026-03-30T00:00:00.000Z',
        expiresAt: '2026-03-31T00:00:00.000Z',
      },
    ]);
    getSystemInfoMock.mockResolvedValue({
      openaiEnabled: true,
      corsOrigins: 'http://localhost:5174',
      letterCount: 10,
      totalLetters: 12,
      collectionCount: 2,
      pendingQueue: 0,
    });
    createInviteMock.mockResolvedValue({
      token: 'invite-token',
      expiresAt: '2026-03-31T00:00:00.000Z',
      email: 'newadmin@example.com',
      expiresInMs: 86400000,
    });
    updateSettingsMock.mockResolvedValue({});
    revokeInviteMock.mockResolvedValue(undefined);
    deleteAdminUserMock.mockResolvedValue(undefined);
    changePasswordMock.mockResolvedValue(undefined);
  });

  it('shows admin profiles, pending invite count, and generates the correct invite URL', async () => {
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText('Admin Profiles')).toBeInTheDocument();
    expect(screen.getAllByText('owner@example.com')).toHaveLength(2);
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending Invites (1)')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email (optional)'), 'newadmin@example.com');
    await user.click(screen.getByRole('button', { name: 'Generate Invite' }));

    expect(createInviteMock).toHaveBeenCalledWith('newadmin@example.com');
    const expectedInviteUrl = `${window.location.origin}/admin-invite?token=invite-token`;
    expect(
      await screen.findByDisplayValue(expectedInviteUrl),
    ).toBeInTheDocument();
    expect(screen.getByText('Invite link generated. It expires in 24 hours.')).toBeInTheDocument();
  });

  it('shows a retryable error when the secure logout request fails', async () => {
    const user = userEvent.setup();
    logoutMock.mockRejectedValueOnce(new Error('Cookie clear failed.'));

    renderPage();

    await screen.findByText('Admin Profiles');
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cookie clear failed.');
    expect(logoutMock).toHaveBeenCalledOnce();
  });
});
