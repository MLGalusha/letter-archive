import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../../api/client';
import type {
  LetterForEntity,
  PersonRelationship,
  PersonWithCount,
  SameNamePersonCandidate,
} from '../../../api/entities';

const {
  navigateMock,
  setSearchParamsMock,
  showToastMock,
  getAllPersonsMock,
  getPersonByIdMock,
  getPersonSameNameCandidatesMock,
  unverifyBiographyMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setSearchParamsMock: vi.fn(),
  showToastMock: vi.fn(),
  getAllPersonsMock: vi.fn(),
  getPersonByIdMock: vi.fn(),
  getPersonSameNameCandidatesMock: vi.fn(),
  unverifyBiographyMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams(), setSearchParamsMock],
  };
});

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../../api/entities', () => ({
  getAllPersons: getAllPersonsMock,
  getPersonById: getPersonByIdMock,
  getPersonSameNameCandidates: getPersonSameNameCandidatesMock,
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  mergePersons: vi.fn(),
  bulkMergePersons: vi.fn(),
  undoPersonAction: vi.fn(),
  searchPersons: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
  generateBiography: vi.fn(),
  saveBiography: vi.fn(),
  unverifyBiography: unverifyBiographyMock,
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

vi.mock('../../../components/MergeComparison', () => ({
  default: () => <div>Merge Comparison</div>,
}));

vi.mock('../../../components/BulkMergeModal', () => ({
  default: () => <div>Bulk Merge Modal</div>,
}));

vi.mock('../EntityManagement/SameNameCandidatesCard', () => ({
  default: ({
    candidates,
  }: {
    candidates: SameNamePersonCandidate[];
  }) => (
    <div>
      Same-Name Candidates
      <span>{candidates.length}</span>
    </div>
  ),
}));

vi.mock('../EntityManagement/EntityListPanel', () => ({
  default: ({
    items,
    onSelectItem,
    searchPlaceholder,
  }: {
    items: PersonWithCount[];
    onSelectItem: (person: PersonWithCount) => void;
    searchPlaceholder: string;
  }) => (
    <div>
      <input placeholder={searchPlaceholder} readOnly />
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelectItem(item)}>
          {item.canonicalName}
        </button>
      ))}
    </div>
  ),
}));

import PeoplePage from '../PeoplePage';

function makePerson(overrides: Partial<PersonWithCount> = {}): PersonWithCount {
  return {
    id: 'person-1',
    canonicalName: 'Alice Smith',
    aliases: ['Al'],
    notes: 'Writes often',
    biography: 'Alice biography',
    biographyStatus: 'VERIFIED',
    biographyVerifiedAt: '2026-03-09T12:00:00.000Z',
    biographyVerifiedBy: 'admin',
    letterCount: 3,
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:00:00.000Z',
    ...overrides,
  };
}

function makeRelationship(
  overrides: Partial<PersonRelationship> = {},
): PersonRelationship {
  return {
    id: 'rel-1',
    personAId: 'person-1',
    personBId: 'person-2',
    personAName: 'Alice Smith',
    personBName: 'Bob Baker',
    relationshipType: 'friend',
    confidence: 82,
    createdAt: '2026-03-09T12:00:00.000Z',
    updatedAt: '2026-03-09T12:00:00.000Z',
    ...overrides,
  };
}

function makeLetterReference(
  overrides: Partial<LetterForEntity> = {},
): LetterForEntity {
  return {
    letterId: 'letter-1',
    dateRaw: '19470810',
    role: 'mentioned',
    sender: 'Alice Smith',
    recipient: 'Bob Baker',
    hook: 'Family update',
    visibility: 'HIDDEN',
    ...overrides,
  };
}

describe('PeoplePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('adminAuth', 'true');

    getAllPersonsMock.mockResolvedValue({
      persons: [
        makePerson(),
        makePerson({
          id: 'person-2',
          canonicalName: 'Bob Baker',
          aliases: [],
          biographyStatus: 'AI_DRAFT',
          biography: '',
          letterCount: 1,
        }),
      ],
    });
    getPersonByIdMock.mockResolvedValue({
      person: makePerson(),
      relationships: [makeRelationship()],
      letters: [makeLetterReference()],
    });
    getPersonSameNameCandidatesMock.mockResolvedValue({
      candidates: [
        {
          id: 'candidate-1',
          canonicalName: 'Alice S.',
          aliases: [],
          letterCount: 1,
        },
      ],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders the people list after loading', async () => {
    render(<PeoplePage />);

    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Baker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Person' })).toBeInTheDocument();
    expect(screen.getByText('Select a person to view details')).toBeInTheDocument();
  });

  it('loads person details after selecting a person from the list', async () => {
    const user = userEvent.setup();
    render(<PeoplePage />);

    await screen.findByText('Alice Smith');
    await user.click(screen.getByRole('button', { name: 'Alice Smith' }));

    await waitFor(() => {
      expect(getPersonByIdMock).toHaveBeenCalledWith('person-1');
    });
    expect(getPersonSameNameCandidatesMock).toHaveBeenCalledWith('person-1');
    expect(screen.getByRole('heading', { name: 'Alice Smith' })).toBeInTheDocument();
    expect(screen.getByText('Same-Name Candidates')).toBeInTheDocument();
    expect(screen.getByText('Family update')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unverify' })).toBeInTheDocument();
    expect(document.querySelector('.relationships-list')).toHaveTextContent('Bob Baker');
  });

  it('shows the request id when unverifying a biography fails', async () => {
    const user = userEvent.setup();
    unverifyBiographyMock.mockRejectedValueOnce(
      new ApiError(500, 'Biography service unavailable', undefined, 'req-bio-123'),
    );

    render(<PeoplePage />);

    await screen.findByText('Alice Smith');
    await user.click(screen.getByRole('button', { name: 'Alice Smith' }));
    await screen.findByRole('button', { name: 'Unverify' });
    await user.click(screen.getByRole('button', { name: 'Unverify' }));

    expect(unverifyBiographyMock).toHaveBeenCalledWith('person-1');
    expect(showToastMock).toHaveBeenCalledWith(
      'Biography service unavailable (Request ID: req-bio-123)',
      'error',
    );
  });
});
