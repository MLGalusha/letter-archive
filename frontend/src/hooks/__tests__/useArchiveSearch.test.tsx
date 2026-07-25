import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  MemoryRouter,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import useArchiveSearch, {
  type UseArchiveSearchConfig,
} from '../useArchiveSearch';

const {
  loadSearchStateMock,
  saveSearchStateMock,
  searchArchiveShelfMock,
} = vi.hoisted(() => ({
  loadSearchStateMock: vi.fn(),
  saveSearchStateMock: vi.fn(),
  searchArchiveShelfMock: vi.fn(),
}));

const emptyArchiveResponse = () => ({
  letters: [],
  page: 1,
  limit: 24,
  total: 0,
  facets: {
    formats: [],
    collections: [],
    correspondents: [],
    places: [],
    years: [],
    topics: [],
    tones: [],
    relationships: [],
  },
});

vi.mock('../../api/letters', () => ({
  searchArchiveShelf: (...args: unknown[]) =>
    searchArchiveShelfMock(...args),
}));

vi.mock('../../utils/searchPersistence', () => ({
  loadSearchState: (...args: unknown[]) => loadSearchStateMock(...args),
  saveSearchState: (...args: unknown[]) => saveSearchStateMock(...args),
}));

const HOME_CONFIG: UseArchiveSearchConfig = {
  storageKey: 'test-home',
  defaultSort: 'relevance',
  defaultSortOrder: 'desc',
};

const COLLECTION_CONFIG: UseArchiveSearchConfig = {
  storageKey: 'test-collection',
  defaultSort: 'letterDate',
  defaultSortOrder: 'asc',
};

const PATH_SCOPED_CONFIGS: Record<string, UseArchiveSearchConfig> = {
  '/first-scope': {
    ...HOME_CONFIG,
    storageKey: 'storage-a',
    fixedFilters: { collection: '009' },
  },
  '/next-scope': {
    ...HOME_CONFIG,
    storageKey: 'storage-b',
    fixedFilters: { collection: '010' },
  },
};

type HarnessProps = {
  config: UseArchiveSearchConfig;
};

function makeWrapper(
  initialEntries: string[] = ['/'],
  initialIndex = initialEntries.length - 1,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter
        initialEntries={initialEntries}
        initialIndex={initialIndex}
      >
        {children}
      </MemoryRouter>
    );
  };
}

function useHarness({ config }: HarnessProps) {
  return {
    archive: useArchiveSearch(config),
    location: useLocation(),
    navigate: useNavigate(),
  };
}

function usePathScopedHarness() {
  const location = useLocation();
  const navigateTo = useNavigate();
  const config = PATH_SCOPED_CONFIGS[location.pathname] ?? PATH_SCOPED_CONFIGS['/first-scope'];

  return {
    archive: useArchiveSearch(config),
    location,
    navigate: navigateTo,
  };
}

function renderArchiveHarness({
  config = HOME_CONFIG,
  initialEntries = ['/'],
  initialIndex = initialEntries.length - 1,
}: {
  config?: UseArchiveSearchConfig;
  initialEntries?: string[];
  initialIndex?: number;
} = {}) {
  return renderHook(useHarness, {
    initialProps: { config },
    wrapper: makeWrapper(initialEntries, initialIndex),
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function navigate(
  harness: ReturnType<typeof renderArchiveHarness>,
  to: string | number,
) {
  await act(async () => {
    if (typeof to === 'number') {
      await harness.result.current.navigate(to);
    } else {
      await harness.result.current.navigate(to);
    }
  });
}

function currentParams(
  harness: ReturnType<typeof renderArchiveHarness>,
) {
  return new URLSearchParams(harness.result.current.location.search);
}

function lastArchiveRequest() {
  return searchArchiveShelfMock.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  loadSearchStateMock.mockReset();
  loadSearchStateMock.mockReturnValue(null);
  saveSearchStateMock.mockReset();
  searchArchiveShelfMock.mockReset();
  searchArchiveShelfMock.mockResolvedValue(emptyArchiveResponse());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useArchiveSearch URL and stored-state ownership', () => {
  it('uses saved state only when the initial URL has no owned archive params', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'saved phrase',
      filters: {
        sender: 'Saved Sender',
        hasTranscript: false,
        sort: 'createdAt',
        sortOrder: 'asc',
      },
    });

    const harness = renderArchiveHarness();

    expect(harness.result.current.archive.searchQuery).toBe('saved phrase');
    expect(harness.result.current.archive.filters).toMatchObject({
      sender: 'Saved Sender',
      hasTranscript: false,
      sort: 'createdAt',
      sortOrder: 'asc',
    });

    await advance(301);

    expect(currentParams(harness).get('q')).toBe('saved phrase');
    expect(currentParams(harness).get('sender')).toBe('Saved Sender');
    expect(currentParams(harness).get('hasTranscript')).toBe('false');
    expect(lastArchiveRequest()).toMatchObject({
      search: 'saved phrase',
      sender: 'Saved Sender',
      hasTranscript: false,
      sort: 'createdAt',
      sortOrder: 'asc',
    });
  });

  it('lets a recognized URL replace the saved query and filters wholesale', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'private saved phrase',
      filters: {
        sender: 'Saved Sender',
        collection: 'saved-collection',
        verified: true,
      },
    });

    const harness = renderArchiveHarness({
      initialEntries: ['/?q=url+phrase&year=1947'],
    });

    expect(harness.result.current.archive.searchQuery).toBe('url phrase');
    expect(harness.result.current.archive.filters.year).toBe(1947);
    expect(harness.result.current.archive.filters.sender).toBeNull();
    expect(harness.result.current.archive.filters.collection).toBeNull();
    expect(harness.result.current.archive.filters.verified).toBeNull();

    await advance(301);

    expect(lastArchiveRequest()).toMatchObject({
      search: 'url phrase',
      year: 1947,
    });
    expect(lastArchiveRequest()?.sender).toBeUndefined();
    expect(lastArchiveRequest()?.collection).toBeUndefined();
    expect(lastArchiveRequest()?.verified).toBeNull();
  });

  it('does not inherit a saved query when the URL contains only a filter', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'private saved phrase',
      filters: { sender: 'Saved Sender' },
    });

    const harness = renderArchiveHarness({
      initialEntries: ['/?year=1947'],
    });

    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.year).toBe(1947);
    expect(harness.result.current.archive.filters.sender).toBeNull();

    await advance(301);

    expect(currentParams(harness).get('q')).toBeNull();
    expect(currentParams(harness).get('year')).toBe('1947');
    expect(lastArchiveRequest()?.search).toBeUndefined();
    expect(lastArchiveRequest()?.year).toBe(1947);
  });

  it('makes a local clear durable before an immediate unmount and clean remount', () => {
    let storedState = {
      query: 'saved phrase',
      filters: {},
    };
    loadSearchStateMock.mockImplementation(() => storedState);
    saveSearchStateMock.mockImplementation((
      _storageKey: string,
      query: string,
      filters: Record<string, unknown>,
    ) => {
      storedState = { query, filters };
    });

    const first = renderArchiveHarness();
    expect(first.result.current.archive.searchQuery).toBe('saved phrase');

    act(() => {
      first.result.current.archive.setSearchQuery('');
    });

    expect(saveSearchStateMock).toHaveBeenCalledWith(
      'test-home',
      '',
      expect.objectContaining({
        sort: 'relevance',
        sortOrder: 'desc',
      }),
    );

    first.unmount();
    const remounted = renderArchiveHarness();

    expect(remounted.result.current.archive.searchQuery).toBe('');
    expect(remounted.result.current.location.search).toBe('');
  });

  it('makes clean same-scope navigation durable before an immediate unmount', async () => {
    let storedState = {
      query: 'saved phrase',
      filters: {},
    };
    loadSearchStateMock.mockImplementation(() => storedState);
    saveSearchStateMock.mockImplementation((
      _storageKey: string,
      query: string,
      filters: Record<string, unknown>,
    ) => {
      storedState = { query, filters };
    });

    const first = renderArchiveHarness();
    expect(first.result.current.location.search).toBe('?q=saved+phrase');

    await navigate(first, '/');

    expect(first.result.current.archive.searchQuery).toBe('');
    expect(saveSearchStateMock).toHaveBeenCalledWith(
      'test-home',
      '',
      expect.objectContaining({
        sort: 'relevance',
        sortOrder: 'desc',
      }),
    );

    first.unmount();
    const remounted = renderArchiveHarness();

    expect(remounted.result.current.archive.searchQuery).toBe('');
    expect(remounted.result.current.location.search).toBe('');
  });
});

describe('useArchiveSearch navigation synchronization', () => {
  it('replaces the current URL immediately without adding a history entry', async () => {
    const harness = renderArchiveHarness({
      initialEntries: ['/?q=prior', '/'],
      initialIndex: 1,
    });

    act(() => {
      harness.result.current.archive.setSearchQuery('final');
    });

    expect(harness.result.current.location.search).toBe('?q=final');

    await navigate(harness, -1);

    expect(harness.result.current.location.search).toBe('?q=prior');
    expect(harness.result.current.archive.searchQuery).toBe('prior');
  });

  it('adopts an external same-route PUSH instead of rewriting it from stale state', async () => {
    const harness = renderArchiveHarness({
      initialEntries: ['/?q=first'],
    });

    await navigate(harness, '/?year=1947');

    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.year).toBe(1947);

    await advance(501);

    expect(harness.result.current.location.search).toBe('?year=1947');
    expect(lastArchiveRequest()?.search).toBeUndefined();
    expect(lastArchiveRequest()?.year).toBe(1947);
  });

  it('treats an external POP to an empty entry as empty instead of reloading persistence', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'private saved phrase',
      filters: { sender: 'Saved Sender' },
    });
    const harness = renderArchiveHarness({
      initialEntries: ['/', '/?q=second'],
      initialIndex: 1,
    });

    expect(harness.result.current.archive.searchQuery).toBe('second');

    await navigate(harness, -1);

    expect(harness.result.current.location.search).toBe('');
    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.sender).toBeNull();

    await advance(501);

    expect(harness.result.current.location.search).toBe('');
    expect(lastArchiveRequest()?.search).toBeUndefined();
  });

  it('cancels a pending local write and stale persistence when POP selects another snapshot', async () => {
    const harness = renderArchiveHarness({
      initialEntries: ['/?q=first', '/?q=second'],
      initialIndex: 1,
    });

    act(() => {
      harness.result.current.archive.setSearchQuery('draft');
    });
    await advance(100);

    await navigate(harness, -1);
    await advance(501);

    expect(harness.result.current.location.search).toBe('?q=first');
    expect(harness.result.current.archive.searchQuery).toBe('first');
    expect(lastArchiveRequest()?.search).toBe('first');
    expect(
      saveSearchStateMock.mock.calls.some((call) => call[1] === 'draft'),
    ).toBe(false);
  });
});

describe('useArchiveSearch URL codec behavior', () => {
  it.each([true, false])(
    'round-trips hasTranscript=%s through state, URL, and request',
    async (hasTranscript) => {
      const harness = renderArchiveHarness({
        initialEntries: [`/?hasTranscript=${hasTranscript}`],
      });

      expect(harness.result.current.archive.filters.hasTranscript)
        .toBe(hasTranscript);

      await advance(301);

      expect(currentParams(harness).get('hasTranscript'))
        .toBe(String(hasTranscript));
      expect(lastArchiveRequest()?.hasTranscript).toBe(hasTranscript);
    },
  );

  it('preserves repeated unowned params while materializing saved archive state', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'saved phrase',
      filters: { sender: 'Saved Sender' },
    });
    const harness = renderArchiveHarness({
      initialEntries: ['/?utm_source=one&utm_source=two'],
    });

    await advance(301);

    expect(currentParams(harness).getAll('utm_source'))
      .toEqual(['one', 'two']);
    expect(currentParams(harness).get('q')).toBe('saved phrase');
    expect(currentParams(harness).get('sender')).toBe('Saved Sender');
  });

  it('sanitizes invalid recognized values without activating saved state', async () => {
    loadSearchStateMock.mockReturnValue({
      query: 'private saved phrase',
      filters: { sender: 'Saved Sender' },
    });
    const harness = renderArchiveHarness({
      initialEntries: [
        '/?utm_source=keep'
        + '&year=not-a-year'
        + '&verified=maybe'
        + '&hasTranscript=maybe'
        + '&sort=bogus'
        + '&sortOrder=sideways'
        + '&format=bogus',
      ],
    });

    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.year == null).toBe(true);
    expect(harness.result.current.archive.filters.verified == null).toBe(true);
    expect(harness.result.current.archive.filters.hasTranscript == null).toBe(true);
    expect(harness.result.current.archive.filters.format == null).toBe(true);
    expect(harness.result.current.archive.resolvedSort).toBe('relevance');
    expect(harness.result.current.archive.filters.sortOrder).toBe('desc');

    await advance(301);

    const params = currentParams(harness);
    expect(params.get('utm_source')).toBe('keep');
    for (const key of [
      'year',
      'verified',
      'hasTranscript',
      'sort',
      'sortOrder',
      'format',
    ]) {
      expect(params.get(key)).toBeNull();
    }
    expect(lastArchiveRequest()).toMatchObject({
      sort: 'relevance',
      sortOrder: 'desc',
    });
    expect(lastArchiveRequest()?.search).toBeUndefined();
    expect(lastArchiveRequest()?.year).toBeUndefined();
    expect(lastArchiveRequest()?.verified).toBeNull();
    expect(lastArchiveRequest()?.hasTranscript).toBeNull();
  });
});

describe('useArchiveSearch defaults and fixed configuration', () => {
  it('materializes page defaults while omitting the default pair from the URL', async () => {
    const harness = renderArchiveHarness({
      config: COLLECTION_CONFIG,
    });

    expect(harness.result.current.archive.filters.sort).toBe('letterDate');
    expect(harness.result.current.archive.filters.sortOrder).toBe('asc');
    expect(harness.result.current.archive.resolvedSort).toBe('letterDate');

    await advance(301);

    expect(currentParams(harness).get('sort')).toBeNull();
    expect(currentParams(harness).get('sortOrder')).toBeNull();
    expect(lastArchiveRequest()).toMatchObject({
      sort: 'letterDate',
      sortOrder: 'asc',
    });
  });

  it('keeps query and page defaults coherent across sequential Clear All callbacks', async () => {
    const harness = renderArchiveHarness({
      config: COLLECTION_CONFIG,
    });

    act(() => {
      harness.result.current.archive.setSearchQuery('draft');
      harness.result.current.archive.setFilters({
        sender: 'Alice',
        sort: 'relevance',
        sortOrder: 'desc',
      });
    });
    act(() => {
      harness.result.current.archive.setSearchQuery('');
      harness.result.current.archive.setFilters({});
    });

    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.sender == null).toBe(true);
    expect(harness.result.current.archive.filters.sort).toBe('letterDate');
    expect(harness.result.current.archive.filters.sortOrder).toBe('asc');

    await advance(301);

    expect(harness.result.current.location.search).toBe('');
    expect(lastArchiveRequest()).toMatchObject({
      sort: 'letterDate',
      sortOrder: 'asc',
    });
    expect(lastArchiveRequest()?.search).toBeUndefined();
  });

  it('round-trips a non-default sort and order against collection defaults', async () => {
    const first = renderArchiveHarness({
      config: COLLECTION_CONFIG,
    });

    act(() => {
      first.result.current.archive.setFilters({
        sort: 'relevance',
        sortOrder: 'desc',
      });
    });
    await advance(301);

    expect(currentParams(first).get('sort')).toBe('relevance');
    expect(currentParams(first).get('sortOrder')).toBe('desc');

    const second = renderArchiveHarness({
      config: COLLECTION_CONFIG,
      initialEntries: [first.result.current.location.search || '/'],
    });

    expect(second.result.current.archive.filters.sort).toBe('relevance');
    expect(second.result.current.archive.filters.sortOrder).toBe('desc');
  });

  it('enforces generic fixed filters without serializing their URL keys', async () => {
    const harness = renderArchiveHarness({
      config: {
        ...HOME_CONFIG,
        fixedFilters: {
          sender: 'Fixed Sender',
          place: 'Fixed Place',
          dateRange: { start: 1940, end: 1950 },
        },
      },
    });

    expect(harness.result.current.archive.filters).toMatchObject({
      sender: 'Fixed Sender',
      place: 'Fixed Place',
      dateRange: { start: 1940, end: 1950 },
    });

    await advance(301);

    const params = currentParams(harness);
    expect(params.get('sender')).toBeNull();
    expect(params.get('place')).toBeNull();
    expect(params.get('yearFrom')).toBeNull();
    expect(params.get('yearTo')).toBeNull();
    expect(lastArchiveRequest()).toMatchObject({
      sender: 'Fixed Sender',
      place: 'Fixed Place',
      yearFrom: 1940,
      yearTo: 1950,
    });
  });

  it('loads the new scope when navigation and config select a clean target together', async () => {
    loadSearchStateMock.mockImplementation((storageKey: string) => ({
      query: storageKey === 'storage-a' ? 'first saved' : 'second saved',
      filters: {},
    }));
    const harness = renderHook(usePathScopedHarness, {
      wrapper: makeWrapper(['/first-scope']),
    });

    expect(harness.result.current.archive.searchQuery).toBe('first saved');

    await navigate(harness, '/next-scope');

    expect(harness.result.current.location.pathname).toBe('/next-scope');
    expect(harness.result.current.archive.searchQuery).toBe('second saved');
    expect(harness.result.current.archive.filters.collection).toBe('010');

    await advance(301);

    expect(currentParams(harness).get('q')).toBe('second saved');
    expect(currentParams(harness).get('collection')).toBeNull();
  });

  it('keeps a recognized target URL authoritative when navigation changes scope', async () => {
    loadSearchStateMock.mockImplementation((storageKey: string) => ({
      query: `${storageKey} saved`,
      filters: { sender: `${storageKey} sender` },
    }));
    const harness = renderHook(usePathScopedHarness, {
      wrapper: makeWrapper(['/first-scope']),
    });

    await navigate(harness, '/next-scope?year=1947');

    expect(harness.result.current.location.pathname).toBe('/next-scope');
    expect(harness.result.current.archive.searchQuery).toBe('');
    expect(harness.result.current.archive.filters.year).toBe(1947);
    expect(harness.result.current.archive.filters.sender).toBeNull();
    expect(harness.result.current.archive.filters.collection).toBe('010');

    await advance(301);

    expect(currentParams(harness).get('year')).toBe('1947');
    expect(currentParams(harness).get('q')).toBeNull();
    expect(currentParams(harness).get('collection')).toBeNull();
    expect(lastArchiveRequest()).toMatchObject({
      collection: '010',
      year: 1947,
    });
  });
});
