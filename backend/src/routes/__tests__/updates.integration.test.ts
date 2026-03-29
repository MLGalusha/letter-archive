import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  selectMock,
  fromMock,
  whereMock,
  orderByMock,
  limitMock,
  offsetMock,
  countFromMock,
  countWhereMock,
  eqMock,
  andMock,
  lteMock,
  descMock,
  ascMock,
  sqlMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
  offsetMock: vi.fn(),
  countFromMock: vi.fn(),
  countWhereMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  lteMock: vi.fn(),
  descMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  lte: lteMock,
  desc: descMock,
  asc: ascMock,
  sql: sqlMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
  updatePosts: {
    status: 'updatePosts.status',
    publishedAt: 'updatePosts.publishedAt',
    slug: 'updatePosts.slug',
    title: 'updatePosts.title',
    authorDisplayName: 'updatePosts.authorDisplayName',
    category: 'updatePosts.category',
  },
}));

import updatesRouter from '../updates.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    slug: 'hello-world',
    title: 'Hello World',
    excerpt: 'An intro post',
    bodyMarkdown: '# Hello',
    status: 'published',
    category: 'news',
    authorDisplayName: 'Alice',
    authorRole: 'editor',
    heroImageUrl: null,
    heroImageAlt: null,
    seoTitle: null,
    seoDescription: null,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2026-03-01T00:00:00Z',
    createdAt: '2026-02-28T00:00:00Z',
    updatedAt: '2026-02-28T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wire up the db.select() chain that the route builds via
 * db.select().from().where().orderBy().limit().offset()
 * and the count query db.select({count}).from().where().
 *
 * The route issues both in a Promise.all, so selectMock is called twice per
 * request. We use call order to distinguish them.
 */
function setupDbMocks(
  posts: Record<string, unknown>[],
  total: number,
) {
  let selectCallCount = 0;

  selectMock.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount % 2 === 1) {
      // First call: the posts query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(posts),
              }),
            }),
          }),
        }),
      };
    }
    // Second call: the count query
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: total }]),
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updates route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left: unknown, right: unknown) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions: unknown[]) => ({ op: 'and', conditions }));
    lteMock.mockImplementation((left: unknown, right: unknown) => ({ op: 'lte', left, right }));
    descMock.mockImplementation((value: unknown) => ({ direction: 'desc', value }));
    ascMock.mockImplementation((value: unknown) => ({ direction: 'asc', value }));
    sqlMock.mockImplementation((strings: unknown, ...values: unknown[]) => ({ strings, values }));
  });

  // =========================================================================
  // GET /blog — list published posts
  // =========================================================================

  describe('GET /blog', () => {
    it('returns published posts with pagination metadata', async () => {
      const posts = [makePost(), makePost({ id: 'post-2', slug: 'second', title: 'Second Post' })];
      setupDbMocks(posts, 2);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog',
        path: '/blog',
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ posts, total: 2 });
    });

    it('respects limit and offset query params', async () => {
      const post = makePost({ id: 'post-3', slug: 'third' });
      setupDbMocks([post], 5);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?limit=1&offset=2',
        path: '/blog',
        query: { limit: '1', offset: '2' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ posts: [post], total: 5 });

      // Verify the posts query chain was called — selectMock first call builds
      // the chain that ends in .offset()
      const firstCallResult = selectMock.mock.results[0].value;
      const fromResult = firstCallResult.from.mock.results[0].value;
      const whereResult = fromResult.where.mock.results[0].value;
      const orderByResult = whereResult.orderBy.mock.results[0].value;
      const limitResult = orderByResult.limit.mock.results[0].value;

      expect(orderByResult.limit).toHaveBeenCalledWith(1);
      expect(limitResult.offset).toHaveBeenCalledWith(2);
    });

    it('sorts by date desc by default', async () => {
      setupDbMocks([makePost()], 1);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog',
        path: '/blog',
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);

      // Default sort is desc on publishedAt
      expect(descMock).toHaveBeenCalledWith('updatePosts.publishedAt');
    });

    it('supports sort=title with sortOrder=asc', async () => {
      setupDbMocks([makePost()], 1);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?sort=title&sortOrder=asc',
        path: '/blog',
        query: { sort: 'title', sortOrder: 'asc' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(ascMock).toHaveBeenCalledWith('updatePosts.title');
    });

    it('supports sort=author with sortOrder=desc', async () => {
      setupDbMocks([makePost()], 1);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?sort=author&sortOrder=desc',
        path: '/blog',
        query: { sort: 'author', sortOrder: 'desc' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(descMock).toHaveBeenCalledWith('updatePosts.authorDisplayName');
    });

    it('filters by category when provided', async () => {
      setupDbMocks([makePost()], 1);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?category=news',
        path: '/blog',
        query: { category: 'news' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);

      // eq should be called 3 times: status, category (in conditions), slug is not in list query
      // Actually: eq(status, 'published') and eq(category, 'news')
      const eqCalls = eqMock.mock.calls;
      const categoryCall = eqCalls.find(
        (args: unknown[]) => args[0] === 'updatePosts.category' && args[1] === 'news',
      );
      expect(categoryCall).toBeDefined();
    });

    it('returns 400 for invalid query params', async () => {
      // limit must be between 1 and 50
      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?limit=0',
        path: '/blog',
        query: { limit: '0' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid query parameters',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['limit'] }),
        ]),
        requestId: expect.any(String),
      });
    });

    it('returns 400 for invalid sort value', async () => {
      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?sort=invalid',
        path: '/blog',
        query: { sort: 'invalid' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid query parameters',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['sort'] }),
        ]),
        requestId: expect.any(String),
      });
    });

    it('returns 400 when limit exceeds maximum', async () => {
      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog?limit=100',
        path: '/blog',
        query: { limit: '100' },
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid query parameters',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['limit'] }),
        ]),
        requestId: expect.any(String),
      });
    });

    it('returns empty posts array when none match', async () => {
      setupDbMocks([], 0);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog',
        path: '/blog',
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ posts: [], total: 0 });
    });
  });

  // =========================================================================
  // GET /blog/:slug — single published post
  // =========================================================================

  describe('GET /blog/:slug', () => {
    function setupSlugQuery(result: Record<string, unknown>[]) {
      selectMock.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      });
    }

    it('returns a single published post by slug', async () => {
      const post = makePost();
      setupSlugQuery([post]);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog/hello-world',
        path: '/blog/hello-world',
        params: { slug: 'hello-world' },
        headers: { accept: 'application/json' },
      } as Parameters<typeof invokeRouter>[1] & { params?: Record<string, string> });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual(post);
    });

    it('returns 404 for non-existent slug', async () => {
      setupSlugQuery([]);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog/does-not-exist',
        path: '/blog/does-not-exist',
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual({
        error: 'Blog post not found',
        requestId: expect.any(String),
      });
    });

    it('returns 404 for unpublished/draft post (query returns empty)', async () => {
      // The WHERE clause filters on status='published', so a draft slug yields empty results
      setupSlugQuery([]);

      const response = await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog/draft-post',
        path: '/blog/draft-post',
        headers: { accept: 'application/json' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).toEqual({
        error: 'Blog post not found',
        requestId: expect.any(String),
      });

      // Verify eq was called with slug and status filters
      expect(eqMock).toHaveBeenCalledWith('updatePosts.slug', 'draft-post');
      expect(eqMock).toHaveBeenCalledWith('updatePosts.status', 'published');
    });

    it('passes slug, status, and publishedAt conditions to the where clause', async () => {
      setupSlugQuery([makePost()]);

      await invokeRouter(updatesRouter, {
        method: 'GET',
        url: '/blog/hello-world',
        path: '/blog/hello-world',
        headers: { accept: 'application/json' },
      });

      expect(eqMock).toHaveBeenCalledWith('updatePosts.slug', 'hello-world');
      expect(eqMock).toHaveBeenCalledWith('updatePosts.status', 'published');
      expect(lteMock).toHaveBeenCalledWith('updatePosts.publishedAt', expect.any(Date));
      expect(andMock).toHaveBeenCalled();
    });
  });
});
