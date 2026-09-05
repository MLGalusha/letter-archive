import { describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';
import healthRouter from '../health.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db/index.js', () => ({ sql: query }));

describe('health route integration', () => {
  it('returns ok with request correlation header', async () => {
    const response = await invokeRouter(healthRouter, {
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      releaseSha: 'development',
    });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it('reports readiness without exposing database errors', async () => {
    query.mockRejectedValueOnce(new Error('private database connection details'));
    const response = await invokeRouter(healthRouter, { method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ ok: false, db: 'disconnected', requestId: expect.any(String) });
  });

  it('reports a connected database', async () => {
    query.mockResolvedValueOnce([{ ok: 1 }]);
    const response = await invokeRouter(healthRouter, { method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, db: 'connected' });
  });

});
