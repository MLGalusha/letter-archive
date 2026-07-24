import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { redactSensitiveQuery } from '../utils/log-redaction.js';
import { AppError } from '../utils/response-helpers.js';

interface BodyParserFailure {
  statusCode: number;
  errorType: string;
  message: string;
  logError: {
    name: string;
    type: string;
    statusCode: number;
    message: string;
  };
}

function getBodyParserFailure(err: unknown): BodyParserFailure | null {
  if (!err || typeof err !== 'object') return null;

  const candidate = err as {
    name?: unknown;
    type?: unknown;
  };
  if (
    candidate.type !== 'entity.parse.failed'
    && candidate.type !== 'entity.too.large'
  ) {
    return null;
  }

  const malformed = candidate.type === 'entity.parse.failed';
  const statusCode = malformed ? 400 : 413;
  const message = malformed
    ? 'Malformed JSON request body'
    : 'Request body too large';

  return {
    statusCode,
    errorType: malformed ? 'malformed_json' : 'request_body_too_large',
    message,
    // Deliberately construct an allow-listed object. Body-parser errors can
    // expose the entire raw request through enumerable `body` properties and
    // can repeat fragments of it in their original message and stack.
    logError: {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      type: candidate.type,
      statusCode,
      message,
    },
  };
}

function getExplicitStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) {
    return null;
  }

  const statusCode = 'statusCode' in err ? (err as { statusCode?: unknown }).statusCode : undefined;
  if (typeof statusCode === 'number') {
    return statusCode;
  }

  const status = 'status' in err ? (err as { status?: unknown }).status : undefined;
  if (typeof status === 'number') {
    return status;
  }

  return null;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;
  const log = req.log || logger;
  const bodyParserFailure = getBodyParserFailure(err);
  const errorMessage = bodyParserFailure?.message ?? (
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error'
  );

  // Determine error type and status code
  let statusCode = 500;
  let errorType = 'internal_error';
  let userMessage = 'Internal server error';
  let details: unknown;
  let code: string | undefined;

  if (bodyParserFailure) {
    statusCode = bodyParserFailure.statusCode;
    errorType = bodyParserFailure.errorType;
    userMessage = bodyParserFailure.message;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    errorType = 'validation_error';
    userMessage = 'Validation error';
    details = err.errors;
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorType = err.name || 'application_error';
    userMessage = err.message;
    details = err.details;
    code = err.code;
  } else {
    const explicitStatus = getExplicitStatus(err);
    if (explicitStatus !== null) {
      // Support typed errors that carry either statusCode or Express-style status
      statusCode = explicitStatus;
      errorType = (err as { name?: string }).name || 'application_error';
      userMessage = (err as { message?: string }).message || userMessage;
    } else if (errorMessage.includes('Invalid filename')) {
      statusCode = 400;
      errorType = 'invalid_filename';
      userMessage = errorMessage;
    } else if (errorMessage.includes('not found')) {
      statusCode = 404;
      errorType = 'not_found';
      userMessage = errorMessage;
    }
  }

  if (requestId) {
    res.setHeader('x-request-id', requestId);
  }

  // Log with full context
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  log[logLevel](
    {
      err: bodyParserFailure?.logError ?? err,
      errorType,
      statusCode,
      requestId,
      method: req.method,
      path: req.path,
      query: redactSensitiveQuery(req.query),
      stack: (
        !bodyParserFailure
        && process.env.NODE_ENV === 'development'
        && err instanceof Error
      ) ? err.stack : undefined,
    },
    `Request failed: ${errorMessage}`
  );

  // Send response
  if (err instanceof ZodError) {
    res.status(statusCode).json({
      error: userMessage,
      details,
      requestId,
    });
    return;
  }

  res.status(statusCode).json({
    error: userMessage,
    details,
    ...(code ? { code } : {}),
    message: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    requestId,
  });
};
