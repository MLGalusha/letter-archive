import { describe, expect, it } from 'vitest';
import { invokeRouter } from './express-test-utils.js';

describe('invokeRouter', () => {
  it('allows ordinary async handlers to finish under the default deadline', async () => {
    const router = {
      handle(_req: unknown, res: unknown) {
        setTimeout(() => {
          (res as { json(body: unknown): void }).json({ ok: true });
        }, 75);
      },
    };

    await expect(invokeRouter(router, {
      method: 'GET',
      url: '/delayed',
    })).resolves.toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
  });

  it('still rejects a handler that never completes', async () => {
    const router = {
      handle() {
        // Deliberately never writes a response or calls next.
      },
    };

    await expect(invokeRouter(router, {
      method: 'GET',
      url: '/stuck',
      timeoutMs: 10,
    })).rejects.toThrow(
      'Request did not complete within 10ms for GET /stuck',
    );
  });
});
