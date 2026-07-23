import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicLetterQueryParams } from '../letters';

const apiGetMock = vi.fn();

vi.mock('../client', () => ({
  apiDelete: vi.fn(),
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

import { listCollections } from '../collections';
import { getLetters } from '../letters';

describe('public read API contracts', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it('forwards every declared public letter query option', async () => {
    apiGetMock.mockResolvedValue({ letters: [], page: 2, limit: 12 });

    await getLetters({
      page: 2,
      limit: 12,
      collection: '003',
      sort: 'sender',
      sortOrder: 'asc',
    });

    expect(apiGetMock).toHaveBeenCalledWith('/letters', {
      page: 2,
      limit: 12,
      collection: '003',
      sort: 'sender',
      sortOrder: 'asc',
    });
  });

  it('keeps internal letter filters and sorts out of the public query type', () => {
    const acceptPublicQuery = (query: PublicLetterQueryParams) => query;

    // @ts-expect-error Public reads cannot query hidden letters.
    acceptPublicQuery({ visibility: 'HIDDEN' });
    // @ts-expect-error Public reads cannot filter on workflow state.
    acceptPublicQuery({ workflow: 'REVIEWED' });
    // @ts-expect-error Public reads cannot sort on internal visibility state.
    acceptPublicQuery({ sort: 'visibility' });
  });

  it('requests the current collection list on every call', async () => {
    apiGetMock
      .mockResolvedValueOnce([{ id: 'one', collectionCode: '001' }])
      .mockResolvedValueOnce([]);

    const first = await listCollections();
    const second = await listCollections();

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/collections');
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/collections');
  });
});
