import { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';
import { lazyRouter } from '../lazy-router.js';

describe('optional route loading', () => {
  it('keeps public reads independent while concurrent admin requests share loading and preserve request data', async () => {
    const optional = Router();
    optional.post('/items/:id', (req, res) => res.json({ id: req.params.id, body: req.body, base: req.baseUrl }));
    let release!: (value: { default: typeof optional }) => void;
    const load = vi.fn(() => new Promise<{ default: typeof optional }>(resolve => { release = resolve; }));
    const app = Router();
    app.get('/public', (_req, res) => res.json({ ok: true }));
    app.use('/admin', lazyRouter(load));
    const first = invokeRouter(app, { method: 'POST', url: '/admin/items/one', body: { title: 'one' } });
    const second = invokeRouter(app, { method: 'POST', url: '/admin/items/two', body: { title: 'two' } });
    expect((await invokeRouter(app, { method: 'GET', url: '/public' })).body).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(1);
    release({ default: optional });
    expect((await first).body).toEqual({ id: 'one', body: { title: 'one' }, base: '/admin' });
    expect((await second).body).toEqual({ id: 'two', body: { title: 'two' }, base: '/admin' });
    expect((await invokeRouter(app, { method: 'POST', url: '/admin/items/three', body: {} })).statusCode).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports loading failures through Express and permits a subsequent successful load', async () => {
    const optional = Router();
    optional.get('/ok', (_req, res) => res.json({ ok: true }));
    const load = vi.fn().mockRejectedValueOnce(new Error('load failed')).mockResolvedValue({ default: optional });
    const app = Router();
    app.use('/admin', lazyRouter(load));
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    expect((await invokeRouter(app, { method: 'GET', url: '/admin/ok' })).statusCode).toBe(500);
    expect((await invokeRouter(app, { method: 'GET', url: '/admin/ok' })).body).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
    expect((await invokeRouter(app, { method: 'GET', url: '/admin/missing' })).statusCode).toBe(404);
  });
});
