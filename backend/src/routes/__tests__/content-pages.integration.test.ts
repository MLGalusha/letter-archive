import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  selectMock,
  insertMock,
  deleteMock,
  eqMock,
  andMock,
  sqlMock,
  pickFeaturedLetterMock,
  resolveRepresentativeLetterIdMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  deleteMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  sqlMock: vi.fn(),
  pickFeaturedLetterMock: vi.fn(),
  resolveRepresentativeLetterIdMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  sql: sqlMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
    insert: insertMock,
    delete: deleteMock,
  },
  collections: {
    collectionCode: 'collections.collectionCode',
    title: 'collections.title',
  },
  contentPages: {
    id: 'contentPages.id',
    slug: 'contentPages.slug',
    title: 'contentPages.title',
    contentJson: 'contentPages.contentJson',
    updatedAt: 'contentPages.updatedAt',
    updatedBy: 'contentPages.updatedBy',
  },
  letters: {
    id: 'letters.id',
    hook: 'letters.hook',
    summary: 'letters.summary',
    letterDate: 'letters.letterDate',
    dateRaw: 'letters.dateRaw',
    sender: 'letters.sender',
    recipient: 'letters.recipient',
    visibility: 'letters.visibility',
    metadataPublished: 'letters.metadataPublished',
    photoDescriptionStatus: 'letters.photoDescriptionStatus',
    collectionId: 'letters.collectionId',
    type: 'letters.type',
  },
  siteSettings: {
    key: 'siteSettings.key',
    value: 'siteSettings.value',
  },
}));

vi.mock('../../services/pick-featured-letter.js', () => ({
  pickFeaturedLetter: pickFeaturedLetterMock,
}));

vi.mock('../../services/letters.js', () => ({
  resolveRepresentativeLetterId: resolveRepresentativeLetterIdMock,
}));

vi.mock('../../services/public-read-model.js', () => ({
  publicFieldSql: vi.fn((_published, field) => field),
}));

vi.mock('../../services/public-catalogue-unit.js', () => ({
  publicCatalogueLetterTypeSql: vi.fn((field) => ({
    op: 'publicCatalogueLetterType',
    field,
  })),
}));

import contentPagesRouter from '../content-pages.js';

describe('public content pages route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));
    insertMock.mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    deleteMock.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it('returns an explicit public page projection without ids or editor identities', async () => {
    const limitMock = vi.fn().mockResolvedValue([{
      slug: 'about',
      title: 'About',
      contentJson: { blocks: [] },
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });

    const response = await invokeRouter(contentPagesRouter, {
      method: 'GET',
      url: '/content/pages/about',
      path: '/content/pages/about',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      slug: 'about',
      title: 'About',
      contentJson: { blocks: [] },
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(selectMock).toHaveBeenCalledWith({
      slug: 'contentPages.slug',
      title: 'contentPages.title',
      contentJson: 'contentPages.contentJson',
      updatedAt: 'contentPages.updatedAt',
    });
  });

  it('returns null and does not persist a raw auto-pick that becomes unpublished', async () => {
    const settingSelect = (rows: unknown[]) => {
      const limit = vi.fn().mockResolvedValue(rows);
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      };
    };
    const detailSelect = (rows: unknown[]) => {
      const limit = vi.fn().mockResolvedValue(rows);
      const query = {
        leftJoin: vi.fn(),
        where: vi.fn().mockReturnValue({ limit }),
      };
      query.leftJoin.mockReturnValue(query);
      return {
        from: vi.fn().mockReturnValue(query),
      };
    };

    selectMock
      .mockReturnValueOnce(settingSelect([]))
      .mockReturnValueOnce(settingSelect([]))
      // The representative was unpublished/deleted after resolution.
      .mockReturnValueOnce(detailSelect([]));
    pickFeaturedLetterMock.mockResolvedValue({
      id: 'raw-picked-letter',
      hook: 'Raw picker data must never escape',
      type: 'L',
    });
    resolveRepresentativeLetterIdMock.mockResolvedValue('representative-letter');

    const response = await invokeRouter(contentPagesRouter, {
      method: 'GET',
      url: '/content/featured-letter',
      path: '/content/featured-letter',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeNull();
    expect(resolveRepresentativeLetterIdMock).toHaveBeenCalledWith(
      'raw-picked-letter',
      { publishedOnly: true },
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('does not fall back to the raw pick when no public representative resolves', async () => {
    const settingSelect = () => {
      const limit = vi.fn().mockResolvedValue([]);
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      };
    };

    selectMock
      .mockReturnValueOnce(settingSelect())
      .mockReturnValueOnce(settingSelect());
    pickFeaturedLetterMock.mockResolvedValue({
      id: 'raw-picked-letter',
      hook: 'Raw picker data must never escape',
      type: 'L',
    });
    resolveRepresentativeLetterIdMock.mockResolvedValue(null);

    const response = await invokeRouter(contentPagesRouter, {
      method: 'GET',
      url: '/content/featured-letter',
      path: '/content/featured-letter',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('persists and returns only the revalidated public representative', async () => {
    const settingSelect = (rows: unknown[]) => {
      const limit = vi.fn().mockResolvedValue(rows);
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      };
    };
    const publicRepresentative = {
      id: 'representative-letter',
      hook: 'Current public hook',
      summary: 'Current public summary',
      letterDate: null,
      dateRaw: '19440101',
      sender: 'Alice',
      recipient: 'Bob',
      collectionId: 'collection-1',
      collectionCode: 'ABC',
      collectionTitle: 'Archive',
      type: 'L',
    };
    const limit = vi.fn().mockResolvedValue([publicRepresentative]);
    const detailQuery = {
      leftJoin: vi.fn(),
      where: vi.fn().mockReturnValue({ limit }),
    };
    detailQuery.leftJoin.mockReturnValue(detailQuery);

    selectMock
      .mockReturnValueOnce(settingSelect([]))
      .mockReturnValueOnce(settingSelect([]))
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue(detailQuery),
      });
    pickFeaturedLetterMock.mockResolvedValue({
      id: 'raw-picked-letter',
      hook: 'Stale picker hook',
      type: 'L',
    });
    resolveRepresentativeLetterIdMock.mockResolvedValue('representative-letter');

    const response = await invokeRouter(contentPagesRouter, {
      method: 'GET',
      url: '/content/featured-letter',
      path: '/content/featured-letter',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ...publicRepresentative,
      imageType: 'L',
      source: 'auto',
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertBuilder = insertMock.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertBuilder.values).toHaveBeenCalledWith({
      key: 'auto_featured_letter_id',
      value: 'representative-letter',
    });
  });
});
