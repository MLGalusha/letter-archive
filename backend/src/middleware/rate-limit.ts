import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Global rate limiter for the public API.
 * 100 requests per minute per IP address.
 */
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 500,
  standardHeaders: 'draft-7', // RateLimit-* headers (IETF draft-7)
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: {
    error: 'Too many requests, please try again later.',
  },
  skip: (req) => {
    // Admin endpoints have their own stricter limiter below.
    // Image bytes are high-volume assets. The image telemetry write endpoint
    // has its own bounded limiter below.
    return req.path.startsWith('/admin') || req.path.startsWith('/images/');
  },
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: process.env.NODE_ENV === 'production' ? 10 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
});

/**
 * Bound anonymous image telemetry independently from image asset traffic.
 * A single client can report at most 600 measurements per minute because the
 * route contract also caps each request at 20 entries.
 */
export function createImagePerfRateLimit(limit = 30) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    message: {
      error: 'Too many image performance reports, please try again later.',
    },
  });
}

export const imagePerfRateLimit = createImagePerfRateLimit();

// ------------------------------------------------------------
// To apply a stricter limit to specific routes, create another
// limiter and use it as route-level middleware. For example:
//
//   import rateLimit from 'express-rate-limit';
//
//   const strictLimit = rateLimit({
//     windowMs: 60 * 1000,
//     limit: 10,
//     message: { error: 'Too many requests to this endpoint.' },
//   });
//
//   router.post('/some-expensive-route', strictLimit, handler);
// ------------------------------------------------------------
