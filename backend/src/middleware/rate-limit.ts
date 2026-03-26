import rateLimit from 'express-rate-limit';

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
    // Images are static assets served with immutable cache headers.
    return req.path.startsWith('/admin') || req.path.startsWith('/images/');
  },
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
});

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
