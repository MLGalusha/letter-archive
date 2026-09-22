import { expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const { load, authenticate } = vi.hoisted(() => ({ load: vi.fn(), authenticate: vi.fn() }));
vi.mock('../../../middleware/auth.js', () => ({
  requireAuth: (req: { headers: Record<string, string> }, res: { status: (code: number) => { json: (value: unknown) => void } }, next: () => void) => {
    authenticate();
    if (req.headers.authorization !== 'Bearer test-admin') return res.status(401).json({ error: 'Authentication required' });
    next();
  },
}));
vi.mock('../routes.js', async () => {
  load();
  const { Router } = await import('express');
  const router = Router();
  router.get('/fixture', (_req, res) => res.json({ ok: true }));
  return { default: router };
});

it('authenticates every admin request before evaluating the optional route graph', async () => {
  const { default: router } = await import('../index.js');
  expect(load).not.toHaveBeenCalled();
  expect((await invokeRouter(router, { method: 'GET', url: '/fixture' })).statusCode).toBe(401);
  expect(load).not.toHaveBeenCalled();
  expect((await invokeRouter(router, { method: 'GET', url: '/fixture', headers: { authorization: 'Bearer test-admin' } })).body).toEqual({ ok: true });
  expect(load).toHaveBeenCalledTimes(1);
  expect((await invokeRouter(router, { method: 'GET', url: '/fixture' })).statusCode).toBe(401);
  expect(authenticate).toHaveBeenCalledTimes(3);
});
