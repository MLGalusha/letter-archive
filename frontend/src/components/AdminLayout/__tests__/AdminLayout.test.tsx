import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureImageSessionMock,
  isAuthenticatedMock,
} = vi.hoisted(() => ({
  ensureImageSessionMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
}));

vi.mock('../../../api/auth', () => ({
  ensureImageSession: ensureImageSessionMock,
  isAuthenticated: isAuthenticatedMock,
}));

vi.mock('../../AdminSidebar', () => ({
  default: () => <nav>Admin navigation</nav>,
}));

vi.mock('../../UploadStatusBanner', () => ({
  default: () => null,
}));

vi.mock('../../common/Icon', () => ({
  default: () => <span aria-hidden="true" />,
}));

import AdminLayout from '../AdminLayout';

function renderAdminLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route
          path="/admin"
          element={(
            <AdminLayout>
              <div>Private image content</div>
            </AdminLayout>
          )}
        />
        <Route path="/admin-login" element={<div>Admin login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout image-session bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticatedMock.mockReturnValue(true);
  });

  it('does not mount private image content until the HttpOnly session exists', async () => {
    let resolveSession!: () => void;
    ensureImageSessionMock.mockReturnValue(new Promise<void>((resolve) => {
      resolveSession = resolve;
    }));

    renderAdminLayout();

    expect(screen.getByText('Restoring admin session…')).toBeInTheDocument();
    expect(screen.queryByText('Private image content')).not.toBeInTheDocument();

    resolveSession();

    expect(await screen.findByText('Private image content')).toBeInTheDocument();
    expect(ensureImageSessionMock).toHaveBeenCalledTimes(1);
  });

  it('redirects when a 401 bootstrap clears the stored bearer', async () => {
    ensureImageSessionMock.mockImplementation(async () => {
      isAuthenticatedMock.mockReturnValue(false);
      throw new Error('expired');
    });

    renderAdminLayout();

    expect(await screen.findByText('Admin login')).toBeInTheDocument();
    expect(screen.queryByText('Private image content')).not.toBeInTheDocument();
  });
});
