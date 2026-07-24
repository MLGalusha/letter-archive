import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../api/client';
import { useLetterSourceConflict } from '../useLetterSourceConflict';

describe('useLetterSourceConflict', () => {
  it('enters one terminal conflict state for source-bound 409 responses', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useLetterSourceConflict(showToast, {
      letterId: 'letter-1',
    }));

    act(() => {
      expect(result.current.handleMutationError(
        new ApiError(409, 'Primary source changed', {
          code: 'SOURCE_REVISION_CHANGED',
        }),
        'Save failed',
      )).toBe(true);
    });

    expect(result.current.sourceConflict).toEqual({
      detail: 'Primary source changed',
    });
    expect(result.current.mutationsBlocked).toBe(true);
    expect(result.current.isMutationBlocked()).toBe(true);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('reload before making more changes'),
      'error',
    );

    act(() => {
      result.current.handleMutationError(
        new ApiError(409, 'A later conflict', {
          code: 'SOURCE_REVISION_CHANGED',
        }),
        'Save failed',
      );
    });
    expect(result.current.sourceConflict).toEqual({
      detail: 'Primary source changed',
    });
  });

  it('keeps ordinary write conflicts recoverable without blocking the editor', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useLetterSourceConflict(showToast, {
      letterId: 'letter-1',
    }));

    act(() => {
      expect(result.current.handleMutationError(
        new ApiError(409, 'Version history changed'),
        'History save failed',
      )).toBe(false);
    });

    expect(result.current.sourceConflict).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Version history changed', 'error');
  });

  it('reports non-conflict errors without blocking the editor', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useLetterSourceConflict(showToast, {
      letterId: 'letter-1',
    }));

    act(() => {
      expect(result.current.handleMutationError(
        new Error('Network unavailable'),
        'Save failed',
      )).toBe(false);
    });

    expect(result.current.sourceConflict).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Network unavailable', 'error');
  });

  it.each([
    { refreshKind: 'source-blind flag response' },
    { refreshKind: 'line-review background refetch' },
  ])('stays terminal when a $refreshKind reports a newer same-letter revision', () => {
    const showToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ letterId, primarySourceRevision }) => ({
        owner: useLetterSourceConflict(showToast, { letterId }),
        primarySourceRevision,
      }),
      {
        initialProps: {
          letterId: 'letter-1',
          primarySourceRevision: 7,
        },
      },
    );

    act(() => {
      result.current.owner.handleMutationError(
        new ApiError(409, 'Primary source changed', {
          code: 'SOURCE_REVISION_CHANGED',
        }),
        'Save failed',
      );
    });
    expect(result.current.owner.isMutationBlocked()).toBe(true);

    act(() => {
      rerender({
        letterId: 'letter-1',
        primarySourceRevision: 8,
      });
    });

    expect(result.current.primarySourceRevision).toBe(8);
    expect(result.current.owner.sourceConflict).toEqual({
      detail: 'Primary source changed',
    });
    expect(result.current.owner.mutationsBlocked).toBe(true);
    expect(result.current.owner.isMutationBlocked()).toBe(true);
  });

  it('resets terminal state when navigation changes the letter owner', () => {
    const showToast = vi.fn();
    const { result, rerender } = renderHook(
      ({ letterId }) => useLetterSourceConflict(showToast, { letterId }),
      { initialProps: { letterId: 'letter-1' } },
    );

    act(() => {
      result.current.handleMutationError(
        new ApiError(409, 'Primary source changed', {
          code: 'SOURCE_REVISION_CHANGED',
        }),
        'Save failed',
      );
    });
    act(() => {
      rerender({ letterId: 'letter-2' });
    });

    expect(result.current.sourceConflict).toBeNull();
    expect(result.current.mutationsBlocked).toBe(false);
    expect(result.current.isMutationBlocked()).toBe(false);

    act(() => {
      rerender({ letterId: 'letter-1' });
    });
    expect(result.current.sourceConflict).toBeNull();
    expect(result.current.mutationsBlocked).toBe(false);
    expect(result.current.isMutationBlocked()).toBe(false);
  });

  it('starts clean after a full application remount', () => {
    const showToast = vi.fn();
    const first = renderHook(() => useLetterSourceConflict(showToast, {
      letterId: 'letter-1',
    }));
    act(() => {
      first.result.current.handleMutationError(
        new ApiError(409, 'Primary source changed', {
          code: 'SOURCE_REVISION_CHANGED',
        }),
        'Save failed',
      );
    });
    expect(first.result.current.isMutationBlocked()).toBe(true);
    first.unmount();

    const reloaded = renderHook(() => useLetterSourceConflict(showToast, {
      letterId: 'letter-1',
    }));
    expect(reloaded.result.current.sourceConflict).toBeNull();
    expect(reloaded.result.current.isMutationBlocked()).toBe(false);
  });
});
