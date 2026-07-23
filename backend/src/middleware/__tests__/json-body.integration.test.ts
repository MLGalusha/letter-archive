import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import { describe, expect, it, vi } from 'vitest';
import imagePerformanceRouter from '../../routes/image-performance.js';
import { errorHandler } from '../error-handler.js';
import { createJsonBodyPipeline } from '../json-body.js';
import { createImagePerfRateLimit } from '../rate-limit.js';

function imagePerfEntry(overrides: Record<string, unknown> = {}) {
  return {
    url: '/images/page-1?w=640',
    tier: 'mid',
    context: 'letter-viewer',
    durationMs: 42,
    cached: false,
    ...overrides,
  };
}

function createTestApp(rateLimit = createImagePerfRateLimit()) {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const app = express();

  app.use((req, _res, next) => {
    req.log = log as never;
    req.requestId = 'json-boundary-test';
    next();
  });
  app.use(createJsonBodyPipeline(rateLimit));
  app.use(imagePerformanceRouter);
  app.post('/parse', (_req, res) => {
    res.status(204).end();
  });
  app.use(errorHandler);

  return { app, log };
}

async function withServer<T>(
  app: Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe('real JSON transport boundaries', () => {
  it('applies the 32KB telemetry envelope to the trailing-slash route', async () => {
    const { app } = createTestApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/images/perf/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          imagePerfEntry({ context: 'x'.repeat(40 * 1024) }),
        ]),
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        error: 'Request body too large',
      });
    });
  });

  it('rejects telemetry before malformed JSON is parsed once rate-limited', async () => {
    const { app, log } = createTestApp(createImagePerfRateLimit(1));

    await withServer(app, async (baseUrl) => {
      const accepted = await fetch(`${baseUrl}/images/perf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([imagePerfEntry()]),
      });
      expect(accepted.status).toBe(204);

      const limited = await fetch(`${baseUrl}/images/perf/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"token":"must-not-be-parsed"',
      });

      expect(limited.status).toBe(429);
      expect(await limited.json()).toMatchObject({
        error: 'Too many image performance reports, please try again later.',
      });
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  it('sanitizes malformed JSON before the error reaches application logs', async () => {
    const { app, log } = createTestApp();
    const credential = 'reusable-admin-jwt-from-malformed-body';

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: `{"token":"${credential}"`,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'Malformed JSON request body',
      });
    });

    const serializedLogs = JSON.stringify(log.warn.mock.calls);
    expect(serializedLogs).toContain('Malformed JSON request body');
    expect(serializedLogs).not.toContain(credential);
    expect(serializedLogs).not.toContain('"body"');
  });
});
