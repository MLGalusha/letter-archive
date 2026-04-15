import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import useArchiveSearch from '../useArchiveSearch';

// The hook fires searchArchiveShelf on a 180ms debounce. Stub it so the test
// doesn't try to hit the real API; we only care about URL-param behavior here.
vi.mock('../../api/letters', () => ({
  searchArchiveShelf: vi.fn(() =>
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
  ),
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
