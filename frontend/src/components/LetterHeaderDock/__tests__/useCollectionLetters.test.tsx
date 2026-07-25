import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveShelfResponse } from '../../../api/letters';
import type { ArchiveShelfItem } from '../../../types/Letter';
import useCollectionLetters from '../useCollectionLetters';

const { getArchiveShelfItemsMock } = vi.hoisted(() => ({
  getArchiveShelfItemsMock: vi.fn(),
}));

vi.mock('../../../api/letters', () => ({
  getArchiveShelfItems: (...args: unknown[]) => (
    getArchiveShelfItemsMock(...args)
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function shelfItem(id: string, collectionCode: string): ArchiveShelfItem {
  return {
    id,
    collectionCode,
    imageType: 'letter',
    verified: true,
  };
}

function shelfResponse(
  letters: ArchiveShelfItem[],
): ArchiveShelfResponse {
  return {
    letters,
    page: 1,
    limit: 100,
    total: letters.length,
  };
}

describe('useCollectionLetters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the previous collection list while the next collection loads', async () => {
    const collectionB = deferred<ArchiveShelfResponse>();
    getArchiveShelfItemsMock.mockImplementation((params: {
      collection: string;
    }) => (
      params.collection === 'route-owner-a'
        ? Promise.resolve(shelfResponse([
            shelfItem('a-1', 'route-owner-a'),
            shelfItem('a-2', 'route-owner-a'),
          ]))
        : collectionB.promise
    ));

    const { result, rerender } = renderHook(
      ({ collectionCode }) => useCollectionLetters(collectionCode),
      { initialProps: { collectionCode: 'route-owner-a' } },
    );
    await waitFor(() => {
      expect(result.current?.map((letter) => letter.id)).toEqual([
        'a-1',
        'a-2',
      ]);
    });

    rerender({ collectionCode: 'route-owner-b' });
    expect(result.current).toBeNull();

    await act(async () => {
      collectionB.resolve(shelfResponse([
        shelfItem('b-1', 'route-owner-b'),
      ]));
      await collectionB.promise;
    });
    expect(result.current?.map((letter) => letter.id)).toEqual(['b-1']);
  });
});
