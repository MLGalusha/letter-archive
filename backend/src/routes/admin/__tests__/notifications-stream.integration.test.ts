import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';

// The stream route doesn't touch the DB — it's all in-memory token + client
// registry logic. We mock the notifications service so we don't pull in the
// real drizzle imports.
vi.mock('../../../services/notifications.js', () => ({
  registerNotificationBroadcaster: vi.fn(),
}));

import streamRouter, {
  issueStreamToken,
  _clearStreamTokensForTests,
  _getStreamClientCountForTests,
} from '../notifications-stream.js';

interface MockRes extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  chunks: string[];
  body: unknown;
  setHeader(name: string, value: string): void;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  write(chunk: string): boolean;
  flushHeaders?(): void;
}

function createMockRes(): MockRes {
  const res = new EventEmitter() as MockRes;
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.setHeader = (name: string, value: string) => {
    res.headers[name.toLowerCase()] = String(value);
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.write = (chunk: string) => {
    res.chunks.push(chunk);
    return true;
  };
  res.flushHeaders = () => undefined;
  return res;
}

function invokeStream(url: string, query: Record<string, unknown>): {
  req: EventEmitter;
  res: MockRes;
} {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    originalUrl: string;
    path: string;
    query: Record<string, unknown>;
    headers: Record<string, string>;
  };
  req.method = 'GET';
  req.url = url;
  req.originalUrl = url;
  req.path = url.split('?')[0];
  req.query = query;
  req.headers = {};

  const res = createMockRes();
  (streamRouter as unknown as {
    handle(req: unknown, res: unknown, next: NextFunction): void;
  }).handle(req, res as unknown as Response, (() => undefined) as NextFunction);
  return { req, res };
}

describe('notifications-stream route', () => {
  beforeEach(() => {
    _clearStreamTokensForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('issueStreamToken', () => {
    it('returns a non-empty token with a future expiry', () => {
      const { token, expiresAt } = issueStreamToken('user-1', 'user@example.com');
      expect(token).toBeTruthy();
      expect(token.length).toBeGreaterThan(10);
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('issues unique tokens on successive calls', () => {
      const a = issueStreamToken('user-1', 'a@example.com');
      const b = issueStreamToken('user-1', 'a@example.com');
      expect(a.token).not.toBe(b.token);
    });
  });

  describe('GET /notifications/stream', () => {
    it('rejects requests with no token (401)', () => {
      const { res } = invokeStream('/notifications/stream', {});
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Missing stream token' });
    });

    it('rejects invalid tokens (401)', () => {
      const { res } = invokeStream('/notifications/stream', { token: 'bogus' });
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid or expired stream token' });
    });

    it('accepts a valid token, writes SSE headers, and registers a client', () => {
      const { token } = issueStreamToken('user-1', 'a@example.com');
      const beforeCount = _getStreamClientCountForTests();
      const { req, res } = invokeStream('/notifications/stream', { token });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toContain('no-cache');
      // retry directive + connected event
      const joined = res.chunks.join('');
      expect(joined).toContain('retry: 3000');
      expect(joined).toContain('event: connected');
      expect(_getStreamClientCountForTests()).toBe(beforeCount + 1);

      // Simulate client disconnect → should unregister
      req.emit('close');
      expect(_getStreamClientCountForTests()).toBe(beforeCount);
    });

    it('rejects a token that has already been consumed', () => {
      const { token } = issueStreamToken('user-1', 'a@example.com');
      const { req: req1 } = invokeStream('/notifications/stream', { token });
      req1.emit('close'); // clean up

      const { res: res2 } = invokeStream('/notifications/stream', { token });
      expect(res2.statusCode).toBe(401);
      expect(res2.body).toEqual({ error: 'Invalid or expired stream token' });
    });
  });
});
