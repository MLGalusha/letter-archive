import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsync } from '../useAsync';

describe('useAsync', () => {
  it('starts with loading=true and data=null', () => {
    const fn = vi.fn(() => new Promise<string>(() => {})); // never resolves
    const { result } = renderHook(() => useAsync(fn, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('returns data after successful resolve', async () => {
    const fn = vi.fn(() => Promise.resolve('hello'));
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe('hello');
    expect(result.current.error).toBeNull();
  });

  it('returns error on rejection', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('fetch failed')));
    // Suppress console.error from the unhandled rejection noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('fetch failed');
    expect(result.current.data).toBeNull();
    spy.mockRestore();
  });

  it('returns generic error message for non-Error rejections', async () => {
    const fn = vi.fn(() => Promise.reject('string error'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('An error occurred');
    spy.mockRestore();
  });

  it('aborts previous request when deps change', async () => {
    let callCount = 0;
    const fn1 = () =>
      new Promise<string>((resolve) => {
        callCount++;
        setTimeout(() => resolve('first'), 100);
      });
    const fn2 = () => Promise.resolve('second');

    const { result, rerender } = renderHook(
      ({ fn }) => useAsync(fn, [fn]),
      { initialProps: { fn: fn1 } },
    );

    // Re-render with a new function before the first resolves
    rerender({ fn: fn2 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // The second call should win
    expect(result.current.data).toBe('second');
  });

  it('does not update state after unmount', async () => {
    let resolvePromise: (value: string) => void;
    const fn = vi.fn(
      () => new Promise<string>((resolve) => { resolvePromise = resolve; }),
    );

    const { result, unmount } = renderHook(() => useAsync(fn, []));
    expect(result.current.loading).toBe(true);

    // Unmount before resolution
    unmount();

    // Resolve after unmount - should not throw or update
    await act(async () => {
      resolvePromise!('late');
      // Give microtask queue time to flush
      await new Promise((r) => setTimeout(r, 10));
    });

    // After unmount, result.current reflects the last state before unmount
    // No error should have been thrown
  });

  it('refetch() re-executes the async function', async () => {
    let count = 0;
    const fn = vi.fn(() => Promise.resolve(++count));
    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toBe(2);
  });

  it('refetch() clears error state on success', async () => {
    let shouldFail = true;
    const fn = vi.fn(() => {
      if (shouldFail) return Promise.reject(new Error('oops'));
      return Promise.resolve('recovered');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAsync(fn, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('oops');

    shouldFail = false;
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('recovered');
    spy.mockRestore();
  });
});
