import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import AdminLoginPage from '../AdminLoginPage';

describe('AdminLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('stores admin auth state and redirects after a successful login', async () => {
    const user = userEvent.setup();
    render(<AdminLoginPage />);

    await user.type(screen.getByLabelText('Email'), 'admin@letterarchive.com');
    await user.type(screen.getByLabelText('Password'), 'admin123');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(sessionStorage.getItem('adminAuth')).toBe('true');
    expect(navigateMock).toHaveBeenCalledWith('/admin');
    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument();
  });

  it('shows an error and does not navigate for invalid credentials', async () => {
    const user = userEvent.setup();
    render(<AdminLoginPage />);

    await user.type(screen.getByLabelText('Email'), 'editor@letterarchive.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
    expect(sessionStorage.getItem('adminAuth')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
