import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import AcceptInvitePage from '../AcceptInvitePage';

const { acceptInviteMock, isAuthenticatedMock, validateInviteMock } = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  validateInviteMock: vi.fn(),
}));

vi.mock('../../../api/auth', () => ({
  acceptInvite: acceptInviteMock,
  isAuthenticated: isAuthenticatedMock,
  validateInvite: validateInviteMock,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function InviteHarness({ initialEntry }: { initialEntry: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <TokenSwitcher />
      <Routes>
        <Route path="/invite" element={<AcceptInvitePage />} />
        <Route path="/admin" element={<p>Admin destination</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function TokenSwitcher() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/invite?token=new-token')}>Use new token</button>;
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticatedMock.mockReturnValue(false);
  });

  it('renders an absent token as invalid without starting validation', () => {
    render(<InviteHarness initialEntry="/invite" />);

    expect(screen.getByRole('heading', { name: 'Invalid Invite' })).toBeInTheDocument();
    expect(screen.queryByText('Validating invite...')).not.toBeInTheDocument();
    expect(validateInviteMock).not.toHaveBeenCalled();
  });

  it('ignores validation from an older token after the URL changes', async () => {
    const oldValidation = deferred<{ valid: boolean; email?: string }>();
    const newValidation = deferred<{ valid: boolean; email?: string }>();
    validateInviteMock.mockImplementation((token: string) => (
      token === 'old-token' ? oldValidation.promise : newValidation.promise
    ));
    render(<InviteHarness initialEntry="/invite?token=old-token" />);
    expect(screen.getByText('Validating invite...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use new token' }));
    await act(async () => newValidation.resolve({ valid: true, email: 'new@example.test' }));
    expect(await screen.findByRole('heading', { name: 'Create Admin Account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.test');

    await act(async () => oldValidation.resolve({ valid: false }));
    expect(screen.getByRole('heading', { name: 'Create Admin Account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.test');
  });
});
