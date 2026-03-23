import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { getNotesMock } = vi.hoisted(() => ({
  getNotesMock: vi.fn(),
}));

vi.mock('../../../api/admin/notes', () => ({
  getNotes: getNotesMock,
}));

vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../components/common/Icon', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

import NotesPage from '../NotesPage';

function createResponse() {
  return {
    notes: [
      {
        id: 'ai-note-1',
        type: 'ai' as const,
        content: 'AI flagged a date mismatch.',
        category: 'date',
        priority: 'high' as const,
        status: 'open' as const,
        resolves_when: 'date_confirmed',
        resolved_at: null,
        resolved_by: null,
        source: 'ai' as const,
        letterId: 'letter-ai',
        letterDate: '1947-10-16',
        collectionCode: '009',
        sender: 'Jimmy',
        recipient: 'Molly',
      },
      {
        id: 'personal-letter-personal',
        type: 'personal' as const,
        content: 'Double-check the family relationship mentioned in paragraph two.',
        category: null,
        priority: null,
        status: null,
        resolves_when: null,
        resolved_at: null,
        resolved_by: null,
        source: 'personal' as const,
        letterId: 'letter-personal',
        letterDate: '1947-10-17',
        collectionCode: '009',
        sender: 'Jimmy',
        recipient: 'Molly',
      },
    ],
    total: 2,
    counts: {
      open: 1,
      resolved: 0,
      dismissed: 0,
      ai: 1,
      personal: 1,
    },
  };
}

describe('NotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both AI and personal notes with direct section links', async () => {
    getNotesMock.mockResolvedValueOnce(createResponse());

    render(
      <MemoryRouter>
        <NotesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Notes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Personal Notes/i })).toBeInTheDocument();
    expect(screen.getByText('AI flagged a date mismatch.')).toBeInTheDocument();
    expect(screen.getByText('Double-check the family relationship mentioned in paragraph two.')).toBeInTheDocument();

    const aiLink = screen.getByRole('link', { name: /Oct 16, 1947/i });
    const personalLink = screen.getByRole('link', { name: /Oct 17, 1947/i });

    expect(aiLink).toHaveAttribute('href', '/admin/letters/letter-ai#ai-notes-section');
    expect(personalLink).toHaveAttribute('href', '/admin/letters/letter-personal#personal-notes-section');
  });

  it('switches to the personal tab without sending AI-only filters', async () => {
    const user = userEvent.setup();
    getNotesMock
      .mockResolvedValueOnce(createResponse())
      .mockResolvedValueOnce({
        notes: [createResponse().notes[1]],
        total: 1,
        counts: createResponse().counts,
      });

    const { container } = render(
      <MemoryRouter>
        <NotesPage />
      </MemoryRouter>,
    );

    await screen.findByText('AI flagged a date mismatch.');
    await user.click(screen.getByRole('button', { name: /Personal Notes/i }));

    await waitFor(() => {
      expect(getNotesMock).toHaveBeenLastCalledWith({
        type: 'personal',
        limit: 50,
        offset: 0,
      });
    });

    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(screen.getByPlaceholderText('Search personal notes...')).toBeInTheDocument();
  });
});
