import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

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
  const errorMessage = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : 'Unknown error';

  // Determine error type and status code
  let statusCode = 500;
  let errorType = 'internal_error';
  let userMessage = 'Internal server error';

  if (err instanceof ZodError) {
    statusCode = 400;
    errorType = 'validation_error';
    userMessage = 'Validation error';
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
      err,
      errorType,
      statusCode,
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined,
    },
    `Request failed: ${errorMessage}`
  );

  // Send response
  if (err instanceof ZodError) {
    res.status(statusCode).json({
      error: userMessage,
      details: err.errors,
      requestId,
    });
    return;
  }

  res.status(statusCode).json({
    error: userMessage,
    message: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    requestId,
  });
};
