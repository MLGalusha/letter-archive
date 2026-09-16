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
import type { ArchiveSearchResponse } from '../../api/letters';
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

const emptyArchiveResponse = (): ArchiveSearchResponse => ({
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

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof emptyArchiveResponse>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof emptyArchiveResponse>>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pageResponse(page: number, id: string): ArchiveSearchResponse {
  return { ...emptyArchiveResponse(), page, total: 48,
    letters: [{ id, imageType: 'letter', verified: true }] };
}

describe('useArchiveSearch scheduling and request ownership', () => {
  it('dispatches initial, filter, sort, and clear immediately but coalesces rapid typing', async () => {
    const harness = renderArchiveHarness();
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    act(() => harness.result.current.archive.setSearchQuery('h'));
    await advance(100);
    act(() => harness.result.current.archive.setSearchQuery('ho'));
    await advance(100);
    act(() => harness.result.current.archive.setSearchQuery('home'));
    await advance(179);
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(lastArchiveRequest()?.search).toBe('home');
    act(() => harness.result.current.archive.setFilters({ sort: 'letterDate', sortOrder: 'asc' }));
    expect(lastArchiveRequest()?.sort).toBe('letterDate');
    act(() => harness.result.current.archive.setSearchQuery(''));
    expect(lastArchiveRequest()?.search).toBeUndefined();
  });

  it('blocks load-more during a changed-query debounce instead of mixing pages', async () => {
    searchArchiveShelfMock.mockResolvedValue(pageResponse(1, 'old-page-1'));
    const harness = renderArchiveHarness();
    await advance(180);
    searchArchiveShelfMock.mockClear();
    act(() => harness.result.current.archive.setSearchQuery('new'));
    await act(async () => harness.result.current.archive.handleArchiveLoadMore());
    expect(searchArchiveShelfMock).not.toHaveBeenCalled();
    expect(harness.result.current.archive.archiveLoading).toBe(true);
    expect(harness.result.current.archive.archiveResults.letters[0].id).toBe('old-page-1');
    await advance(180);
    expect(lastArchiveRequest()).toMatchObject({ search: 'new', page: 1 });
  });

  it('aborts superseded searches and ignores out-of-order responses even when transport ignores abort', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    searchArchiveShelfMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const harness = renderArchiveHarness();
    const firstSignal = searchArchiveShelfMock.mock.calls[0]?.[1] as AbortSignal;
    act(() => harness.result.current.archive.setSearchQuery('new'));
    expect(firstSignal.aborted).toBe(true);
    await advance(180);
    await act(async () => second.resolve(pageResponse(1, 'new')));
    await act(async () => first.resolve(pageResponse(1, 'obsolete')));
    expect(harness.result.current.archive.archiveResults.letters[0].id).toBe('new');
    expect(harness.result.current.archive.archiveLoading).toBe(false);
    expect(harness.result.current.archive.archiveError).toBeNull();
  });

  it('cancels an old next-page request and prevents double load-more dispatch', async () => {
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(1, 'old'));
    const harness = renderArchiveHarness();
    await advance(180);
    const more = deferredResponse();
    searchArchiveShelfMock.mockReturnValueOnce(more.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = harness.result.current.archive.handleArchiveLoadMore();
      void harness.result.current.archive.handleArchiveLoadMore();
    });
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(2);
    const moreSignal = searchArchiveShelfMock.mock.calls[1][1] as AbortSignal;
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(1, 'filtered'));
    act(() => harness.result.current.archive.setFilters({ sender: 'Alice' }));
    expect(moreSignal.aborted).toBe(true);
    await advance(0);
    await act(async () => { more.resolve(pageResponse(2, 'obsolete-page')); await pending; });
    expect(harness.result.current.archive.archiveResults.letters.map((letter) => letter.id)).toEqual(['filtered']);
    expect(harness.result.current.archive.archiveLoadingMore).toBe(false);
  });

  it('cancels requests on unmount without exposing an abort error', async () => {
    const pending = deferredResponse();
    searchArchiveShelfMock.mockReturnValueOnce(pending.promise);
    const harness = renderArchiveHarness();
    const signal = searchArchiveShelfMock.mock.calls[0]?.[1] as AbortSignal;
    harness.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new DOMException('Aborted', 'AbortError')));
  });

  it('dispatches Back immediately and never lets a pending typed query win', async () => {
    const harness = renderArchiveHarness({ initialEntries: ['/?q=first', '/?q=second'] });
    act(() => harness.result.current.archive.setSearchQuery('unfinished'));
    await navigate(harness, -1);
    expect(lastArchiveRequest()?.search).toBe('first');
    await advance(180);
    expect(lastArchiveRequest()?.search).toBe('first');
    expect(searchArchiveShelfMock.mock.calls.some(([params]) => params.search === 'unfinished')).toBe(false);
  });
});


describe('useArchiveSearch failures and retries', () => {
  it('settles a failed refresh and recovers on the next search', async () => {
    searchArchiveShelfMock.mockRejectedValueOnce(new Error('Server unavailable'));
    const harness = renderArchiveHarness();
    await advance(0);
    expect(harness.result.current.archive.archiveError).toBe('Server unavailable');
    expect(harness.result.current.archive.archiveLoading).toBe(false);
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(1, 'recovered'));
    act(() => harness.result.current.archive.setFilters({ sender: 'Alice' }));
    await advance(0);
    expect(harness.result.current.archive.archiveError).toBeNull();
    expect(harness.result.current.archive.archiveResults.letters[0].id).toBe('recovered');
  });

  it('releases the next-page lock after failure so manual retry succeeds', async () => {
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(1, 'first'));
    const harness = renderArchiveHarness();
    await advance(0);
    searchArchiveShelfMock.mockRejectedValueOnce(new Error('Temporary failure'));
    await act(async () => harness.result.current.archive.handleArchiveLoadMore());
    expect(harness.result.current.archive.archiveLoadMoreError).toBe('Temporary failure');
    expect(harness.result.current.archive.archiveLoadingMore).toBe(false);
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(2, 'second'));
    await act(async () => harness.result.current.archive.handleArchiveLoadMore());
    expect(harness.result.current.archive.archiveLoadMoreError).toBeNull();
    expect(harness.result.current.archive.archiveResults.letters.map((letter) => letter.id)).toEqual(['first', 'second']);
  });
});

describe('useArchiveSearch invalid URL year ranges', () => {
  it('preserves reversed bounds without requesting results until corrected', async () => {
    const harness = renderArchiveHarness({ initialEntries: ['/?yearFrom=1900&yearTo=1863'] });
    await advance(500);
    expect(harness.result.current.archive.filters.dateRange).toEqual({ start: 1900, end: 1863 });
    expect(currentParams(harness).get('yearFrom')).toBe('1900');
    expect(currentParams(harness).get('yearTo')).toBe('1863');
    expect(harness.result.current.archive.archiveError).toMatch(/From year.*To year/);
    expect(harness.result.current.archive.archiveLoading).toBe(false);
    await act(async () => harness.result.current.archive.handleArchiveLoadMore());
    expect(searchArchiveShelfMock).not.toHaveBeenCalled();

    act(() => harness.result.current.archive.setFilters({ dateRange: { end: 1863 } }));
    await advance(180);
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    expect(lastArchiveRequest()).toMatchObject({ yearTo: 1863, page: 1 });
    expect(lastArchiveRequest()?.yearFrom).toBeUndefined();
    expect(harness.result.current.archive.archiveError).toBeNull();
  });

  it('blocks pagination of retained results while the URL range is invalid', async () => {
    searchArchiveShelfMock.mockResolvedValueOnce({ ...emptyArchiveResponse(), total: 48 });
    const harness = renderArchiveHarness();
    await advance(180);
    expect(harness.result.current.archive.archiveResults.total).toBe(48);
    await navigate(harness, '/?yearFrom=1900&yearTo=1863');
    await advance(180);
    await act(async () => harness.result.current.archive.handleArchiveLoadMore());
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    expect(harness.result.current.archive.archiveLoadingMore).toBe(false);
  });

  it('aborts an in-flight next page when history selects an invalid range', async () => {
    searchArchiveShelfMock.mockResolvedValueOnce(pageResponse(1, 'retained'));
    const harness = renderArchiveHarness();
    await advance(0);
    const more = deferredResponse();
    searchArchiveShelfMock.mockReturnValueOnce(more.promise);
    let pending!: Promise<void>;
    act(() => { pending = harness.result.current.archive.handleArchiveLoadMore(); });
    const signal = searchArchiveShelfMock.mock.calls[1][1] as AbortSignal;
    await navigate(harness, '/?yearFrom=1900&yearTo=1863');
    expect(signal.aborted).toBe(true);
    expect(harness.result.current.archive.archiveLoadingMore).toBe(false);
    await act(async () => { more.resolve(pageResponse(2, 'obsolete')); await pending; });
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(2);
    expect(harness.result.current.archive.archiveResults.letters.map((letter) => letter.id)).toEqual(['retained']);
    expect(harness.result.current.archive.archiveError).toMatch(/From year.*To year/);
  });

  it('ignores an older response after Back selects an invalid range and resumes after clearing', async () => {
    let resolve!: (response: ReturnType<typeof emptyArchiveResponse>) => void;
    searchArchiveShelfMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const harness = renderArchiveHarness({ initialEntries: ['/?yearFrom=1900&yearTo=1863', '/?yearTo=1863'] });
    await advance(180);
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    const signal = searchArchiveShelfMock.mock.calls[0][1] as AbortSignal;
    await navigate(harness, -1);
    expect(signal.aborted).toBe(true);
    await advance(500);
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ...emptyArchiveResponse(), total: 99 }));
    expect(harness.result.current.archive.archiveError).toMatch(/From year.*To year/);
    expect(harness.result.current.archive.archiveResults.total).toBe(0);
    expect(harness.result.current.archive.archiveLoading).toBe(false);
    act(() => harness.result.current.archive.setFilters({}));
    await advance(180);
    expect(searchArchiveShelfMock).toHaveBeenCalledTimes(2);
    expect(harness.result.current.archive.archiveError).toBeNull();
  });
});
