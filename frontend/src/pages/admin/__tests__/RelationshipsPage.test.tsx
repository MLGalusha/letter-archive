import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../../api/client';
import type { PersonRelationship, RelationshipGraphData } from '../../../api/entities';

const {
  navigateMock,
  showToastMock,
  getAdminRelationshipsMock,
  getRelationshipGraphMock,
  deleteAdminRelationshipMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  showToastMock: vi.fn(),
  getAdminRelationshipsMock: vi.fn(),
  getRelationshipGraphMock: vi.fn(),
  deleteAdminRelationshipMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../../api/entities', () => ({
  backfillAdminRelationshipsFromLetters: vi.fn(),
  getAdminRelationships: getAdminRelationshipsMock,
  createAdminRelationship: vi.fn(),
  updateAdminRelationship: vi.fn(),
  deleteAdminRelationship: deleteAdminRelationshipMock,
  searchPersons: vi.fn(),
  getRelationshipGraph: getRelationshipGraphMock,
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
  Modal: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    children?: ReactNode;
  }) => (isOpen ? <div aria-label={title}>{children}</div> : null),
}));

vi.mock('../../../components/RelationshipGraph/RelationshipGraph', () => ({
  default: () => <div>Relationship Graph</div>,
}));

vi.mock('../../../components/ConnectionFinder/ConnectionFinder', () => ({
  default: () => <div>Connection Finder</div>,
}));

import RelationshipsPage from '../RelationshipsPage';

let confirmMock: ReturnType<typeof vi.fn>;

function makeRelationship(
  overrides: Partial<PersonRelationship> = {},
): PersonRelationship {
  return {
    id: 'rel-1',
    personAId: 'person-a',
    personBId: 'person-b',
    personAName: 'Alice Smith',
    personBName: 'Bob Baker',
    relationshipType: 'friend',
    confidence: 82,
    notes: 'Family friends',
    createdAt: '2026-03-09T12:00:00.000Z',
    updatedAt: '2026-03-09T12:00:00.000Z',
    ...overrides,
  };
}

function makeGraphData(): RelationshipGraphData {
  return {
    nodes: [
      { id: 'person-a', name: 'Alice Smith', letterCount: 3 },
      { id: 'person-b', name: 'Bob Baker', letterCount: 2 },
      { id: 'person-c', name: 'Clara Jones', letterCount: 1 },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'person-a',
        target: 'person-b',
        relationshipType: 'friend',
        confidence: 82,
      },
      {
        id: 'edge-2',
        source: 'person-a',
        target: 'person-c',
        relationshipType: 'sibling',
        confidence: 64,
      },
    ],
  };
}

describe('RelationshipsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('adminAuth', 'true');
    confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);

    getAdminRelationshipsMock.mockResolvedValue([
      makeRelationship(),
      makeRelationship({
        id: 'rel-2',
        personAId: 'person-c',
        personBId: 'person-d',
        personAName: 'Clara Jones',
        personBName: 'David Stone',
        relationshipType: 'sibling',
        confidence: 64,
        notes: 'Unconfirmed family link',
      }),
    ]);
    getRelationshipGraphMock.mockResolvedValue(makeGraphData());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders loaded relationship data and summary metrics', async () => {
    render(<RelationshipsPage />);

    expect(await screen.findByText('Total Relationships')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Baker')).toBeInTheDocument();
    expect(document.querySelector('.table-summary')).toHaveTextContent(
      'Showing 2 of 2 relationships',
    );
  });

  it('filters the relationship table from the search box', async () => {
    const user = userEvent.setup();
    render(<RelationshipsPage />);

    await screen.findByText('Alice Smith');
    const searchInput = screen.getByPlaceholderText('Search names or type...');
    await user.type(searchInput, 'sibling');

    await waitFor(() => {
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Clara Jones')).toBeInTheDocument();
    expect(screen.getByText('David Stone')).toBeInTheDocument();
  });

  it('shows the request id when deleting a relationship fails', async () => {
    const user = userEvent.setup();
    deleteAdminRelationshipMock.mockRejectedValueOnce(
      new ApiError(500, 'Delete failed', undefined, 'req-rel-123'),
    );

    render(<RelationshipsPage />);

    await screen.findByText('Alice Smith');
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete relationship' });
    await user.click(deleteButtons[0]);

    expect(confirmMock).toHaveBeenCalledWith('Delete this relationship?');
    expect(deleteAdminRelationshipMock).toHaveBeenCalledWith('rel-1');
    expect(showToastMock).toHaveBeenCalledWith(
      'Delete failed (Request ID: req-rel-123)',
      'error',
    );
  });
});
