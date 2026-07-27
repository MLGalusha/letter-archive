import { describe, expect, it } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';
import healthRouter from '../health.js';

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
});
