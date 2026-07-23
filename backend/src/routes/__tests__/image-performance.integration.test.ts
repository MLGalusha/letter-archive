import { describe, expect, it } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';
import imagePerformanceRouter, {
  IMAGE_PERF_BATCH_LIMIT,
  sanitizeImageTelemetryUrl,
} from '../image-performance.js';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    url: '/images/page-1?w=640',
    tier: 'mid',
    context: 'letter-viewer',
    durationMs: 42,
    cached: false,
    ...overrides,
  };
}

describe('image performance route contract', () => {
  it('accepts a bounded telemetry batch', async () => {
    const response = await invokeRouter(imagePerformanceRouter, {
      method: 'POST',
      url: '/images/perf',
      path: '/images/perf',
      body: [entry(), entry({ tier: 'thumb', cached: true })],
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(204);
  });

  it('rejects a batch instead of silently truncating beyond its maximum', async () => {
    const response = await invokeRouter(imagePerformanceRouter, {
      method: 'POST',
      url: '/images/perf',
      path: '/images/perf',
      body: Array.from({ length: IMAGE_PERF_BATCH_LIMIT + 1 }, () => entry()),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Invalid image performance report',
    });
  });

  it('rejects unbounded or unknown entry fields', async () => {
    const response = await invokeRouter(imagePerformanceRouter, {
      method: 'POST',
      url: '/images/perf',
      path: '/images/perf',
      body: [entry({
        context: 'x'.repeat(65),
        reusableCredential: 'must-not-be-logged',
      })],
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('removes query strings and fragments before telemetry is logged', () => {
    expect(
      sanitizeImageTelemetryUrl(
        '/images/page-hidden?ToKeN=reusable-admin-jwt&w=640#preview',
      ),
    ).toBe('/images/page-hidden');
  });
});
