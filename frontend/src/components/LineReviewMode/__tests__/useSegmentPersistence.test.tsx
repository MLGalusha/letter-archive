// @vitest-environment jsdom
import { StrictMode, useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savePageLineSegments } from '../../../api/admin/letters';
import type { LineSegment } from '../../../types/Letter';
import { useSegmentPersistence } from '../useSegmentPersistence';

vi.mock('../../../api/admin/letters', () => ({ savePageLineSegments: vi.fn() }));
const target = { letterId: 'letter', pageId: 'page', letterPageIndex: 0, primarySourceRevision: 1, sourceChecksum: 'checksum' };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function options() {
  const draft: LineSegment[] = [{ line: 1, ocrText: '', bbox: [0, 0, 20, 10], baseline: [[0, 10], [20, 10]] }];
  return { target, draft, isDirty: true, getSegmentsForSave: () => draft, blocked: false, onSaved: vi.fn(), onError: vi.fn() };
}

describe('segment persistence lifetime', () => {
  beforeEach(() => { vi.mocked(savePageLineSegments).mockReset().mockResolvedValue(undefined); });
  afterEach(() => vi.useRealTimers());

  it.each(['resolve', 'reject'] as const)('ignores a late %s after unmount', async outcome => {
    const pending = deferred();
    vi.mocked(savePageLineSegments).mockReturnValueOnce(pending.promise);
    const props = options();
    const { result, unmount } = renderHook(() => useSegmentPersistence(props), { wrapper: StrictMode });
    const flush = result.current.flush();
    unmount();
    pending[outcome](new Error('late failure'));
    expect(await flush).toBe(false);
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('coalesces debounce and explicit flush and waits for the most recent committed draft', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    vi.mocked(savePageLineSegments).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const props = options();
    const { result, rerender } = renderHook(useSegmentPersistence, { initialProps: props });
    act(() => vi.advanceTimersByTime(1499));
    expect(savePageLineSegments).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    const flush = result.current.flush();
    expect(result.current.flush()).toBe(flush);
    const newest: LineSegment[] = [];
    rerender({ ...props, draft: newest, getSegmentsForSave: () => newest });
    await act(async () => { first.resolve(); await first.promise; });
    expect(savePageLineSegments).toHaveBeenCalledTimes(2);
    expect(props.onSaved).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1500));
    expect(savePageLineSegments).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(); expect(await flush).toBe(true); });
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(newest, target);
  });

  it('serializes a newer draft behind a revoked transport across block then unblock', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(savePageLineSegments).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const props = options();
    const { result, rerender } = renderHook(useSegmentPersistence, { initialProps: props });
    const oldFlush = result.current.flush();
    rerender({ ...props, blocked: true });
    const newest: LineSegment[] = [];
    rerender({ ...props, draft: newest, getSegmentsForSave: () => newest });
    const newFlush = result.current.flush();
    expect(savePageLineSegments).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); expect(await oldFlush).toBe(false); });
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(savePageLineSegments).toHaveBeenCalledTimes(2);
    expect(savePageLineSegments).toHaveBeenLastCalledWith('page', newest, { primarySourceRevision: 1, sourceChecksum: 'checksum' });
    await act(async () => { second.resolve(); expect(await newFlush).toBe(true); });
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(newest, target);
  });

  it('drains an old transport without writing an untouched different page', async () => {
    const pending = deferred();
    vi.mocked(savePageLineSegments).mockReturnValueOnce(pending.promise);
    const props = options();
    const { result, rerender } = renderHook(useSegmentPersistence, { initialProps: props });
    const oldFlush = result.current.flush();
    rerender({ ...props, target: { ...target, pageId: 'next-page' }, isDirty: false });
    const newFlush = result.current.flush();
    await act(async () => { pending.resolve(); expect(await oldFlush).toBe(false); expect(await newFlush).toBe(true); });
    expect(savePageLineSegments).toHaveBeenCalledTimes(1);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('drains the revoked first-mount transport during StrictMode effect replay', async () => {
    const pending = deferred();
    vi.mocked(savePageLineSegments).mockReturnValueOnce(pending.promise);
    const props = options();
    const attempts: Promise<boolean>[] = [];
    renderHook(() => {
      const { flush } = useSegmentPersistence(props);
      useLayoutEffect(() => { attempts.push(flush()); }, [flush]);
    }, { wrapper: StrictMode });
    expect(attempts).toHaveLength(2);
    expect(savePageLineSegments).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve();
      expect(await attempts[0]).toBe(false);
      expect(await attempts[1]).toBe(true);
    });
    expect(savePageLineSegments).toHaveBeenCalledTimes(2);
    expect(props.onSaved).toHaveBeenCalledTimes(1);
  });

  it('revokes even a clean transition guard when the target changes', async () => {
    const props = { ...options(), isDirty: false };
    const { result, rerender } = renderHook(useSegmentPersistence, { initialProps: props });
    const isCurrent = result.current.captureGuard();
    expect(await result.current.flush()).toBe(true);
    rerender({ ...props, target: { ...target, sourceChecksum: 'replacement' } });
    expect(isCurrent()).toBe(false);
    expect(savePageLineSegments).not.toHaveBeenCalled();
  });
});
