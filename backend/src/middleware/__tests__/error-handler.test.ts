import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { errorHandler } from '../error-handler.js';
import { SourceRevisionChangedError } from '../../services/letter/source-revision.js';
import { AppError } from '../../utils/response-helpers.js';

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

  it('serializes the stable code only for source-epoch conflicts', () => {
    const req = createReq();
    const sourceResponse = createRes();
    const ordinaryResponse = createRes();

    errorHandler(
      new SourceRevisionChangedError('Primary source changed'),
      req,
      sourceResponse,
      vi.fn(),
    );
    errorHandler(
      new AppError(409, 'Version history changed'),
      req,
      ordinaryResponse,
      vi.fn(),
    );

    expect(sourceResponse.status).toHaveBeenCalledWith(409);
    expect(sourceResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Primary source changed',
        code: 'SOURCE_REVISION_CHANGED',
      }),
    );
    expect(ordinaryResponse.status).toHaveBeenCalledWith(409);
    expect(ordinaryResponse.json.mock.calls[0]?.[0]).not.toHaveProperty('code');
  });

  it('honors express-style status properties on thrown errors', () => {
    const req = createReq();
    const res = createRes();

    errorHandler(
      Object.assign(new Error('Bad request'), { status: 400 }),
      req,
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Bad request',
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

  it('redacts query credentials from error logs', () => {
    const req = createReq();
    req.query = {
      token: 'reusable-admin-jwt',
      adminToken: 'legacy-admin-jwt',
      q: 'alice',
    };
    const res = createRes();

    errorHandler(new Error('boom'), req, res, vi.fn());

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          token: '[REDACTED]',
          adminToken: '[REDACTED]',
          q: 'alice',
        },
      }),
      'Request failed: boom',
    );
  });

  it('does not log raw bodies or credential fragments from JSON parser errors', () => {
    const req = createReq();
    req.method = 'POST';
    req.path = '/images/perf';
    const res = createRes();
    const err = Object.assign(
      new SyntaxError('Unexpected token near reusable-admin-jwt'),
      {
        status: 400,
        type: 'entity.parse.failed',
        body: '{"token":"reusable-admin-jwt"',
      },
    );

    errorHandler(err, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Malformed JSON request body',
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: {
          name: 'SyntaxError',
          type: 'entity.parse.failed',
          statusCode: 400,
          message: 'Malformed JSON request body',
        },
        errorType: 'malformed_json',
      }),
      'Request failed: Malformed JSON request body',
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('reusable-admin-jwt');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('"body"');
  });
});
