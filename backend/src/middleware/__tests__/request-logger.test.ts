import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { mockLog, mockLogIfSlow } = vi.hoisted(() => ({
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockLogIfSlow: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => mockLog),
  logIfSlow: mockLogIfSlow,
  TIMING_THRESHOLDS: {
    REQUEST_TOTAL: 3000,
  },
}));

import { requestLogger } from '../request-logger.js';

describe('requestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches a request id and exposes it on the response header', () => {
    const finishHandlers: Array<() => void> = [];
    const req = {
      method: 'GET',
      path: '/letters',
      query: {},
      get: vi.fn((header: string) => {
        if (header === 'user-agent') return 'vitest';
        if (header === 'content-length') return '123';
        return undefined;
      }),
    } as unknown as Request;

    const res = {
      statusCode: 200,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandlers.push(handler);
        return res;
      }),
      get: vi.fn(() => '456'),
      setHeader: vi.fn(),
      json: vi.fn((body: unknown) => body),
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(req.log).toBe(mockLog);

    finishHandlers.forEach((handler) => handler());

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        contentLength: '123',
      }),
      'Request started',
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        contentLength: '456',
      }),
      'Request completed',
    );
    expect(mockLogIfSlow).not.toHaveBeenCalled();
  });
});
