import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useLetterScrubber from '../useLetterScrubber';
import type { AdjacentLettersResponse } from '../../../api/letters';

const { navigate, collectionLetters } = vi.hoisted(() => ({ navigate: vi.fn(), collectionLetters: vi.fn(() => null as { id: string }[] | null) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../useCollectionLetters', () => ({ default: () => collectionLetters() }));

it('uses adjacent navigation when the full collection is unavailable', () => {
  const adjacent = { collectionCode: '009', total: 3, position: 2,
    prev: { id: 'previous' }, next: { id: 'next' } } as AdjacentLettersResponse;
  const { result } = renderHook(() => useLetterScrubber(adjacent, 'current'));
  expect(result.current?.position).toBe(2);
  result.current?.onPrev();
  expect(navigate).toHaveBeenLastCalledWith('/letter/previous');
  result.current?.onNext();
  expect(navigate).toHaveBeenLastCalledWith('/letter/next');
});

it('does not let a stale cached count revive a single-item scrubber or stale destinations', () => {
  collectionLetters.mockReturnValue([{ id: 'old' }, { id: 'current' }, { id: 'stale' }]);
  const adjacent = { collectionCode: '009', total: 1, position: 1, prev: null, next: null } as AdjacentLettersResponse;
  const { result, rerender } = renderHook(({ data }) => useLetterScrubber(data, 'current'), { initialProps: { data: adjacent } });
  expect(result.current).toBeNull();
  rerender({ data: { ...adjacent, total: 2, next: { id: 'fresh' } } });
  expect(result.current?.seekEnabled).toBe(false);
  navigate.mockClear();
  result.current?.onNavigate(2);
  expect(navigate).not.toHaveBeenCalled();
  result.current?.onNext();
  expect(navigate).toHaveBeenCalledWith('/letter/fresh');
  collectionLetters.mockReturnValue(null);
});
