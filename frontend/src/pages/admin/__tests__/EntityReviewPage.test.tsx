import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { EntityMatch, EntityReviewItem, ReviewQueueStats } from '../../../api/entities';

const {
  navigateMock,
  showToastMock,
  getReviewQueueMock,
  resolveReviewItemMock,
  searchPersonsMock,
  searchPlacesMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  showToastMock: vi.fn(),
  getReviewQueueMock: vi.fn(),
  resolveReviewItemMock: vi.fn(),
  searchPersonsMock: vi.fn(),
  searchPlacesMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      ...props
    }: {
      children?: ReactNode;
      to: string;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../../api/entities', () => ({
  getReviewQueue: getReviewQueueMock,
  resolveReviewItem: resolveReviewItemMock,
  searchPersons: searchPersonsMock,
  searchPlaces: searchPlacesMock,
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Icon: () => <span aria-hidden="true">icon</span>,
}));

import EntityReviewPage from '../EntityReviewPage';

function makeStats(
  overrides: Partial<ReviewQueueStats> = {},
): ReviewQueueStats {
  return {
    pending: {
      persons: 1,
      places: 1,
      ...overrides.pending,
    },
    resolved: {
      confirmed: 0,
      rejected: 0,
      newEntity: 0,
      ...overrides.resolved,
    },
  };
}

function makeItem(
  overrides: Partial<EntityReviewItem> = {},
): EntityReviewItem {
  return {
    id: 'review-1',
    entityType: 'person',
    extractedText: 'Alice Smith',
    letterId: 'letter-1',
    suggestedEntityId: 'person-1',
    suggestedEntityName: 'Alice B. Smith',
    context: 'Alice Smith wrote to Bob about the trip.',
    confidence: 87,
    status: 'pending',
    createdAt: '2026-03-09T12:00:00.000Z',
    ...overrides,
  };
}

function makeMatch(overrides: Partial<EntityMatch> = {}): EntityMatch {
  return {
    entityId: 'person-1',
    canonicalName: 'Alice B. Smith',
    matchedOn: 'canonical_name',
    similarity: 94,
    ...overrides,
  };
}

describe('EntityReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('adminAuth', 'true');

    getReviewQueueMock.mockResolvedValue({
      items: [makeItem()],
      stats: makeStats(),
    });
    resolveReviewItemMock.mockResolvedValue({ message: 'ok' });
    searchPersonsMock.mockResolvedValue({ matches: [] });
    searchPlacesMock.mockResolvedValue({ matches: [] });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders the loaded queue with stats and suggested matches', async () => {
    render(<EntityReviewPage />);

    await waitFor(() => {
      expect(getReviewQueueMock).toHaveBeenCalledWith(undefined);
    });

    expect(await screen.findByText('Suggested match:')).toBeInTheDocument();
    expect(screen.getByText('Suggested match:')).toBeInTheDocument();
    expect(screen.getByText('Alice B. Smith')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Places' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Match' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search...' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Letter' })).toHaveAttribute(
      'href',
      '/admin/letters/letter-1',
    );
  });

  it('refetches the queue when switching filters', async () => {
    const user = userEvent.setup();
    getReviewQueueMock.mockReset();
    getReviewQueueMock
      .mockResolvedValueOnce({
        items: [makeItem()],
        stats: makeStats(),
      })
      .mockResolvedValueOnce({
        items: [
          makeItem({
            id: 'review-2',
            entityType: 'place',
            extractedText: 'Vienna',
            letterId: 'letter-2',
            suggestedEntityId: undefined,
            suggestedEntityName: undefined,
            context: 'The letter mentions Vienna repeatedly.',
            confidence: 76,
          }),
        ],
        stats: makeStats({
          pending: {
            persons: 0,
            places: 1,
          },
        }),
      });

    render(<EntityReviewPage />);

    expect(await screen.findByRole('button', { name: 'Confirm Match' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Places' }));

    await waitFor(() => {
      expect(getReviewQueueMock).toHaveBeenNthCalledWith(2, 'place');
    });
    expect(await screen.findByText('76%')).toBeInTheDocument();
    expect(screen.queryByText('87%')).not.toBeInTheDocument();
  });

  it('resolves a suggested match and removes it from the queue', async () => {
    const user = userEvent.setup();
    getReviewQueueMock.mockResolvedValueOnce({
      items: [makeItem()],
      stats: makeStats({
        pending: {
          persons: 1,
          places: 0,
        },
      }),
    });

    render(<EntityReviewPage />);

    await screen.findByRole('button', { name: 'Confirm Match' });
    await user.click(screen.getByRole('button', { name: 'Confirm Match' }));

    await waitFor(() => {
      expect(resolveReviewItemMock).toHaveBeenCalledWith('review-1', {
        status: 'confirmed',
        reviewedBy: 'admin',
      });
    });

    expect(await screen.findByText('No pending items to review')).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith('Entity confirmed', 'success');
    expect(screen.getByText('Confirmed').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Pending').previousElementSibling).toHaveTextContent('0');
  });

  it('searches for people from the modal and closes after selecting a result', async () => {
    const user = userEvent.setup();
    searchPersonsMock.mockResolvedValueOnce({
      matches: [makeMatch()],
    });

    render(<EntityReviewPage />);

    await screen.findByRole('button', { name: 'Search...' });
    await user.click(screen.getByRole('button', { name: 'Search...' }));

    const searchInput = screen.getByPlaceholderText('Search by name...');
    expect(searchInput).toHaveValue('Alice Smith');

    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(searchPersonsMock).toHaveBeenCalledWith('Alice Smith');
    });

    const resultSimilarity = await screen.findByText('94% match');
    expect(resultSimilarity).toBeInTheDocument();

    await user.click(resultSimilarity);

    expect(showToastMock).toHaveBeenCalledWith('Reassign not yet implemented', 'info');
    await waitFor(() => {
      expect(screen.queryByText('94% match')).not.toBeInTheDocument();
    });
  });

  it('shows the request id when a search request fails', async () => {
    const user = userEvent.setup();
    searchPersonsMock.mockRejectedValueOnce(
      new ApiError(500, 'Search service unavailable', undefined, 'req-search-123'),
    );

    render(<EntityReviewPage />);

    await screen.findByRole('button', { name: 'Search...' });
    await user.click(screen.getByRole('button', { name: 'Search...' }));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(searchPersonsMock).toHaveBeenCalledWith('Alice Smith');
    });
    expect(showToastMock).toHaveBeenCalledWith(
      'Search service unavailable (Request ID: req-search-123)',
      'error',
    );
  });
});
