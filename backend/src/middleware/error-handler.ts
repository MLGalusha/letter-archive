import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.requestId;
  const log = req.log || logger;

  // Determine error type and status code
  let statusCode = 500;
  let errorType = 'internal_error';
  let userMessage = 'Internal server error';

  if (err instanceof ZodError) {
    statusCode = 400;
    errorType = 'validation_error';
    userMessage = 'Validation error';
  } else if (err.message?.includes('Invalid filename')) {
    statusCode = 400;
    errorType = 'invalid_filename';
    userMessage = err.message;
  } else if (err.message?.includes('not found')) {
    statusCode = 404;
    errorType = 'not_found';
    userMessage = err.message;
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
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
    `Request failed: ${err.message}`
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
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    requestId,
  });
};
