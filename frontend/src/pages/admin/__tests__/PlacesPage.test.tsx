import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../../api/client';
import type {
  LetterForEntity,
  PlaceWithCount,
  SameNamePlaceCandidate,
} from '../../../api/entities';

const {
  navigateMock,
  setSearchParamsMock,
  showToastMock,
  getAllPlacesMock,
  getPlaceByIdMock,
  getPlaceSameNameCandidatesMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setSearchParamsMock: vi.fn(),
  showToastMock: vi.fn(),
  getAllPlacesMock: vi.fn(),
  getPlaceByIdMock: vi.fn(),
  getPlaceSameNameCandidatesMock: vi.fn(),
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
  getAllPlaces: getAllPlacesMock,
  getPlaceById: getPlaceByIdMock,
  getPlaceSameNameCandidates: getPlaceSameNameCandidatesMock,
  createPlace: vi.fn(),
  updatePlace: vi.fn(),
  searchPlaces: vi.fn(),
  mergePlaces: vi.fn(),
  bulkMergePlaces: vi.fn(),
  generatePlaceThemes: vi.fn(),
  undoPlaceAction: vi.fn(),
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
    candidates: SameNamePlaceCandidate[];
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
    items: PlaceWithCount[];
    onSelectItem: (place: PlaceWithCount) => void;
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

import PlacesPage from '../PlacesPage';

function makePlace(overrides: Partial<PlaceWithCount> = {}): PlaceWithCount {
  return {
    id: 'place-1',
    canonicalName: 'Manchester',
    aliases: ['Mcr'],
    placeType: 'city',
    notes: [
      'Industrial center',
      '',
      '[AI_PLACE_THEMES_START]',
      '- rail travel',
      '- family visits',
      '[AI_PLACE_THEMES_END]',
    ].join('\n'),
    letterCount: 4,
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:00:00.000Z',
    ...overrides,
  };
}

function makeLetterReference(
  overrides: Partial<LetterForEntity> = {},
): LetterForEntity {
  return {
    letterId: 'letter-1',
    dateRaw: '19470810',
    role: 'written_from',
    hook: 'Train changes in Manchester',
    visibility: 'HIDDEN',
    ...overrides,
  };
}

describe('PlacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('adminAuth', 'true');

    getAllPlacesMock.mockResolvedValue({
      places: [
        makePlace(),
        makePlace({
          id: 'place-2',
          canonicalName: 'Liverpool',
          aliases: [],
          placeType: 'city',
          notes: '',
          letterCount: 1,
        }),
      ],
    });
    getPlaceByIdMock.mockResolvedValue({
      place: makePlace(),
      letters: [makeLetterReference()],
    });
    getPlaceSameNameCandidatesMock.mockResolvedValue({
      candidates: [
        {
          id: 'candidate-1',
          canonicalName: 'Manchester, NH',
          aliases: [],
          placeType: 'city',
          letterCount: 1,
        },
      ],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders the places list after loading', async () => {
    render(<PlacesPage />);

    expect(await screen.findByText('Manchester')).toBeInTheDocument();
    expect(screen.getByText('Liverpool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Place' })).toBeInTheDocument();
    expect(screen.getByText('Select a place to view details')).toBeInTheDocument();
  });

  it('loads place details, themes, and references after selecting a place', async () => {
    const user = userEvent.setup();
    render(<PlacesPage />);

    await screen.findByText('Manchester');
    await user.click(screen.getByRole('button', { name: 'Manchester' }));

    await waitFor(() => {
      expect(getPlaceByIdMock).toHaveBeenCalledWith('place-1');
    });
    expect(getPlaceSameNameCandidatesMock).toHaveBeenCalledWith('place-1');
    expect(screen.getByRole('heading', { name: 'Manchester' })).toBeInTheDocument();
    expect(screen.getByText('Same-Name Candidates')).toBeInTheDocument();
    expect(screen.getByText('Industrial center')).toBeInTheDocument();
    expect(screen.getByText('rail travel')).toBeInTheDocument();
    expect(screen.getByText('family visits')).toBeInTheDocument();
    expect(screen.getByText('Train changes in Manchester')).toBeInTheDocument();
  });

  it('shows the request id when loading place references fails', async () => {
    const user = userEvent.setup();
    getPlaceByIdMock.mockRejectedValueOnce(
      new ApiError(500, 'Place references unavailable', undefined, 'req-place-123'),
    );

    render(<PlacesPage />);

    await screen.findByText('Manchester');
    await user.click(screen.getByRole('button', { name: 'Manchester' }));

    await waitFor(() => {
      expect(getPlaceByIdMock).toHaveBeenCalledWith('place-1');
    });
    expect(showToastMock).toHaveBeenCalledWith(
      'Place references unavailable (Request ID: req-place-123)',
      'error',
    );
  });
});
