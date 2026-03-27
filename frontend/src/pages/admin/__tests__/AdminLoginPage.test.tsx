import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';

const {
  navigateMock,
  loginMock,
  getAuthStatusMock,
  isAuthenticatedMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  loginMock: vi.fn(),
  getAuthStatusMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../api/auth', () => ({
  login: loginMock,
  getAuthStatus: getAuthStatusMock,
  isAuthenticated: isAuthenticatedMock,
}));

import AdminLoginPage from '../AdminLoginPage';

describe('AdminLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getAuthStatusMock.mockResolvedValue({ hasAdmin: true });
    isAuthenticatedMock.mockReturnValue(false);
    loginMock.mockImplementation(async (email: string) => {
      localStorage.setItem('adminToken', 'test-token');
      return { token: 'test-token', email };
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('stores admin auth state and redirects after a successful login', async () => {
    const user = userEvent.setup();
    render(<AdminLoginPage />);

    await user.type(await screen.findByLabelText('Email'), 'admin@letterarchive.com');
    await user.type(screen.getByLabelText('Password'), 'admin123');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(loginMock).toHaveBeenCalledWith('admin@letterarchive.com', 'admin123');
    expect(localStorage.getItem('adminToken')).toBe('test-token');
    expect(navigateMock).toHaveBeenCalledWith('/admin');
    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument();
  });

  it('shows an error and does not navigate for invalid credentials', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValueOnce(
      new ApiError(401, 'Invalid email or password'),
    );
    render(<AdminLoginPage />);

    await user.type(await screen.findByLabelText('Email'), 'editor@letterarchive.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(localStorage.getItem('adminToken')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
