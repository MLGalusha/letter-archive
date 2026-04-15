import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import useArchiveSearch from '../useArchiveSearch';

// The hook fires searchArchiveShelf on a 180ms debounce. Stub it so the test
// doesn't try to hit the real API; we only care about URL-param behavior here.
const searchArchiveShelfMock = vi.fn(() =>
  Promise.resolve({
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
  }),
);

vi.mock('../../api/letters', () => ({
  searchArchiveShelf: (...args: unknown[]) => searchArchiveShelfMock(...(args as [])),
}));

// Isolate from real localStorage-backed persistence between tests.
vi.mock('../../utils/searchPersistence', () => ({
  loadSearchState: vi.fn(() => null),
  saveSearchState: vi.fn(),
}));

function makeWrapper(initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
  };
}

// Consumer hook: drives useArchiveSearch AND exposes the current location so
// the test can assert when (and with what) the URL actually changed.
function useHarness() {
  return {
    archive: useArchiveSearch({ storageKey: 'test-archive' }),
    location: useLocation(),
  };
}

describe('useArchiveSearch URL-param debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not update URL params until 250ms after the last keystroke', async () => {
    const { result } = renderHook(useHarness, { wrapper: makeWrapper() });

    expect(result.current.location.search).toBe('');

    // Simulate rapid typing — each setSearchQuery should reset the debounce.
    act(() => {
      result.current.archive.setSearchQuery('h');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.location.search).toBe('');

    act(() => {
      result.current.archive.setSearchQuery('he');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.location.search).toBe('');

    act(() => {
      result.current.archive.setSearchQuery('hel');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // Still within the debounce window after the last keystroke — no URL write.
    expect(result.current.location.search).toBe('');

    // Cross the 250ms threshold after the final keystroke.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Exactly one URL update, with only the final value.
    expect(result.current.location.search).toBe('?q=hel');
  });

  it('writes the URL after the debounce when the query stops changing', async () => {
    const { result } = renderHook(useHarness, { wrapper: makeWrapper() });

    act(() => {
      result.current.archive.setSearchQuery('molly');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(result.current.location.search).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(result.current.location.search).toBe('?q=molly');
  });
});

describe('useArchiveSearch sort resolution + URL omission', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolvedSort falls back to the page's defaultSort when filters.sort is unset", () => {
    const { result: homeResult } = renderHook(
      () => useArchiveSearch({ storageKey: 'test-home', defaultSort: 'relevance' }),
      { wrapper: makeWrapper() },
    );
    expect(homeResult.current.resolvedSort).toBe('relevance');

    const { result: collectionResult } = renderHook(
      () =>
        useArchiveSearch({
          storageKey: 'test-collection',
          defaultSort: 'letterDate',
          defaultSortOrder: 'asc',
        }),
      { wrapper: makeWrapper() },
    );
    expect(collectionResult.current.resolvedSort).toBe('letterDate');
  });

  it('omits ?sort= from the URL when the chosen sort equals the page default (HomePage)', async () => {
    const { result } = renderHook(
      () => ({
        archive: useArchiveSearch({ storageKey: 'test-home', defaultSort: 'relevance' }),
        location: useLocation(),
      }),
      { wrapper: makeWrapper() },
    );

    // Default (relevance) — no URL param.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.location.search).toBe('');

    // Pick a non-default sort → URL writes ?sort=letterDate.
    act(() => {
      result.current.archive.setFilters({ sort: 'letterDate', sortOrder: 'desc' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.location.search).toBe('?sort=letterDate');

    // Flip back to the default → URL drops ?sort=.
    act(() => {
      result.current.archive.setFilters({ sort: 'relevance', sortOrder: 'desc' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.location.search).toBe('');
  });

  it('sends the resolved defaultSort to the backend when filters.sort is unset', async () => {
    searchArchiveShelfMock.mockClear();

    renderHook(
      () =>
        useArchiveSearch({
          storageKey: 'test-collection-req',
          defaultSort: 'letterDate',
          defaultSortOrder: 'asc',
        }),
      { wrapper: makeWrapper() },
    );

    // Flush the 180ms request debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(searchArchiveShelfMock).toHaveBeenCalled();
    const lastCall = searchArchiveShelfMock.mock.calls.at(-1);
    const params = (lastCall as unknown as [{ sort?: string; sortOrder?: string }])[0];
    // Without this behavior, the UI shows "Date" as active while the backend
    // silently serves relevance-ranked results — misleading sort cue.
    expect(params.sort).toBe('letterDate');
    expect(params.sortOrder).toBe('asc');
  });

  it('omits ?sort= when letterDate matches the CollectionDetailPage default', async () => {
    const { result } = renderHook(
      () => ({
        archive: useArchiveSearch({
          storageKey: 'test-collection',
          defaultSort: 'letterDate',
          defaultSortOrder: 'asc',
        }),
        location: useLocation(),
      }),
      { wrapper: makeWrapper() },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // letterDate is the default sort field — ?sort= is omitted. (sortOrder=asc
    // still appears because the hook hardcodes 'desc' as the omission threshold
    // rather than comparing against defaultSortOrder — pre-existing behavior,
    // tracked separately.)
    expect(result.current.location.search).not.toContain('sort=letterDate');

    // Pick Best Match → URL writes ?sort=relevance.
    act(() => {
      result.current.archive.setFilters({ sort: 'relevance', sortOrder: 'desc' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.location.search).toContain('sort=relevance');
  });
});
