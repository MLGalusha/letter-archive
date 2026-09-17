import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
const state = vi.hoisted(() => ({ post: undefined as Record<string, unknown> | undefined }));
vi.mock('../../../services/pick-featured-letter.js', () => ({ pickFeaturedLetter: vi.fn() }));
vi.mock('../../../services/letters.js', () => ({ resolveRepresentativeLetterId: vi.fn() }));
vi.mock('../../../services/featured-setting.js', () => ({ resolveFeaturedSetting: vi.fn() }));
vi.mock('../../../db/index.js', async () => ({ ...(await import('../../../db/schema.js')), db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => state.post ? [state.post] : [] }) }) }),
  insert: () => ({ values: (values: Record<string, unknown>) => ({ returning: async () => { state.post = { id: 'post', ...values }; return [state.post]; } }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => { state.post = { ...state.post, ...values }; return [state.post]; } }) }) }),
} }));
import router from '../content.js';
import publicRouter from '../../updates.js';
let server: Server, base: string;
beforeAll(async () => { const app = express(); app.use(express.json(), router, publicRouter); server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { state.post = undefined; });
const dimensions = { '/blog-images/a.jpg': { width: 80, height: 160 } };
async function save(method: string, path: string, body: unknown) { return fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
describe('journal dimensions API persistence', () => {
  it('saves and reloads dimensions through admin and published detail, preserves omitted maps and clears replacements', async () => {
    const response = await save('POST', '/content/blog', { title: 'Article', excerpt: null, bodyMarkdown: 'Text', imageDimensions: dimensions });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ imageDimensions: dimensions });
    expect(await (await fetch(base + '/content/blog/post')).json()).toMatchObject({ imageDimensions: dimensions });
    expect((await save('PUT', '/content/blog/post', { title: 'Edited' })).status).toBe(200);
    expect(state.post?.imageDimensions).toEqual(dimensions);
    expect(await (await fetch(base + '/blog/article')).json()).toMatchObject({ imageDimensions: dimensions });
    await save('PUT', '/content/blog/post', { heroImageUrl: '/blog-images/b.jpg', imageDimensions: {} });
    expect(state.post?.imageDimensions).toEqual({});
    await save('PUT', '/content/blog/post', { imageDimensions: null });
    expect(state.post?.imageDimensions).toEqual({});
  });
  it('rejects invalid metadata and resolves missing legacy sources without fake reservations', async () => {
    expect((await save('POST', '/content/blog', { title: 'Bad', imageDimensions: { '/a': { width: 0, height: 20 } } })).status).toBe(400);
    const response = await save('POST', '/content/blog', { title: 'Legacy', imageDimensions: dimensions, resolveImageSources: ['/blog-images/a.jpg'] });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ imageDimensions: {}, unresolvedImageSources: ['/blog-images/a.jpg'] });
  });
});
