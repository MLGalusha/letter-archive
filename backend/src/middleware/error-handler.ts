import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('Error:', err);

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
    return;
  }

  // Custom validation errors (filename parsing, etc.)
  if (err.message?.includes('Invalid filename')) {
    res.status(400).json({ error: err.message });
    return;
  }

  // Not found errors
  if (err.message?.includes('not found')) {
    res.status(404).json({ error: err.message });
    return;
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};
