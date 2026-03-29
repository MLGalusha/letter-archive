import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the api client before importing the hook
vi.mock('../../api/client', () => ({
  apiGet: vi.fn(),
}));

// We need to dynamically import the hook each test to reset the module-level cache
async function loadHook() {
  // Reset module cache so each test gets fresh cachedSettings/pendingFetch
  vi.resetModules();
  // Re-apply the mock after resetModules
  vi.doMock('../../api/client', () => ({
    apiGet: vi.fn(),
  }));
  const { apiGet } = await import('../../api/client');
  const { useSiteSettings } = await import('../useSiteSettings');
  return { useSiteSettings, apiGet: apiGet as ReturnType<typeof vi.fn> };
}

describe('useSiteSettings', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null initially, then settings after fetch', async () => {
    const { useSiteSettings, apiGet } = await loadHook();
    const settings = { site_title: 'My Archive', donate_onetime_url: 'https://donate.example.com' };
    apiGet.mockResolvedValueOnce(settings);

    const { result } = renderHook(() => useSiteSettings());

    // Initially null (before the fetch resolves)
    expect(result.current).toBeNull();

    await waitFor(() => {
      expect(result.current).toEqual(settings);
    });

    expect(apiGet).toHaveBeenCalledWith('/settings/public');
  });

  it('caches settings across multiple hook instances', async () => {
    const { useSiteSettings, apiGet } = await loadHook();
    const settings = { site_title: 'Cached' };
    apiGet.mockResolvedValueOnce(settings);

    // First render triggers fetch
    const { result: first } = renderHook(() => useSiteSettings());
    await waitFor(() => {
      expect(first.current).toEqual(settings);
    });

    // Second render should use cache - no additional API call
    const { result: second } = renderHook(() => useSiteSettings());
    // The cached value is available synchronously via the module-level variable
    await waitFor(() => {
      expect(second.current).toEqual(settings);
    });

    // apiGet should only have been called once
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('handles fetch failure gracefully', async () => {
    const { useSiteSettings, apiGet } = await loadHook();
    apiGet.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useSiteSettings());

    // Wait long enough for the rejection to be handled
    await new Promise((r) => setTimeout(r, 50));

    // Should remain null after failure
    expect(result.current).toBeNull();
    // Should have logged a warning
    expect(console.warn).toHaveBeenCalled();
  });

  it('deduplicates concurrent fetches', async () => {
    const { useSiteSettings, apiGet } = await loadHook();
    const settings = { site_title: 'Deduped' };
    apiGet.mockResolvedValueOnce(settings);

    // Render two hooks simultaneously
    const { result: first } = renderHook(() => useSiteSettings());
    const { result: second } = renderHook(() => useSiteSettings());

    await waitFor(() => {
      expect(first.current).toEqual(settings);
    });
    await waitFor(() => {
      expect(second.current).toEqual(settings);
    });

    // Only one API call despite two hook instances
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
