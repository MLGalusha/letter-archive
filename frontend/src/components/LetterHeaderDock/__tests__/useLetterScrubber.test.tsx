import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useLetterScrubber from '../useLetterScrubber';
import type { AdjacentLettersResponse } from '../../../api/letters';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../useCollectionLetters', () => ({ default: () => null }));

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
