import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { errorHandler } from '../error-handler.js';

const log = {
  warn: vi.fn(),
  error: vi.fn(),
};

function createReq() {
  return {
    requestId: 'req-123',
    log,
    method: 'GET',
    path: '/letters',
    query: { q: 'alice' },
  } as any;
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as any;
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zod validation failures with request id', () => {
    const req = createReq();
    const res = createRes();
    const err = new ZodError(
      z.object({ name: z.string() }).safeParse({ name: 12 }).error?.issues ?? [],
    );

    errorHandler(err, req, res, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-123');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation error',
        requestId: 'req-123',
        details: expect.any(Array),
      }),
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('maps typed application errors to their status code', () => {
    const req = createReq();
    const res = createRes();

    errorHandler(
      { statusCode: 409, name: 'ConflictError', message: 'Already exists' } as any,
      req,
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Already exists',
        requestId: 'req-123',
      }),
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it('handles non-Error thrown values without crashing', () => {
    const req = createReq();
    const res = createRes();

    errorHandler('boom', req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Internal server error',
        requestId: 'req-123',
      }),
    );
    expect(log.error).toHaveBeenCalled();
  });
});
