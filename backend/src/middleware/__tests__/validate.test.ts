import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '../validate.js';

function createReq() {
  return {
    body: {},
    query: {},
    requestId: 'req-123',
    log: {
      warn: vi.fn(),
    },
  } as any;
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
}

describe('validate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses valid request bodies', () => {
    const req = createReq();
    req.body = { name: 'Ada' };
    const res = createRes();
    const next = vi.fn();

    validateBody(z.object({ name: z.string() }))(req, res, next);

    expect(req.body).toEqual({ name: 'Ada' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns validation errors for invalid request bodies and logs them', () => {
    const req = createReq();
    req.body = { name: 42 };
    const res = createRes();
    const next = vi.fn();

    validateBody(z.object({ name: z.string() }))(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation error',
        requestId: 'req-123',
        details: expect.any(Array),
      }),
    );
    expect(req.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        validationTarget: 'body',
        details: expect.any(Array),
      }),
      'Request validation failed',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns validation errors for invalid query params and logs them', () => {
    const req = createReq();
    req.query = { page: 'oops' };
    const res = createRes();
    const next = vi.fn();

    validateQuery(z.object({ page: z.coerce.number() }))(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Validation error',
        requestId: 'req-123',
        details: expect.any(Array),
      }),
    );
    expect(req.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        validationTarget: 'query',
        details: expect.any(Array),
      }),
      'Request validation failed',
    );
    expect(next).not.toHaveBeenCalled();
  });
});
