import express, { Router, type RequestHandler } from 'express';
import { imagePerfRateLimit } from './rate-limit.js';

export const DEFAULT_JSON_BODY_LIMIT = '5mb';
export const IMAGE_PERF_JSON_BODY_LIMIT = '32kb';

export function isImagePerfPath(path: string): boolean {
  return path.replace(/\/+$/, '') === '/images/perf';
}

export function jsonBodyLimitForPath(path: string): string {
  return isImagePerfPath(path)
    ? IMAGE_PERF_JSON_BODY_LIMIT
    : DEFAULT_JSON_BODY_LIMIT;
}

const defaultJsonBodyParser = express.json({ limit: DEFAULT_JSON_BODY_LIMIT });
export const imagePerfJsonBodyParser = express.json({
  limit: IMAGE_PERF_JSON_BODY_LIMIT,
});

/**
 * Parse non-telemetry API JSON. Telemetry is handled by the pre-body pipeline
 * below so its limiter always runs before any request body is read.
 */
export const jsonBodyParser: RequestHandler = (req, res, next) => {
  if (isImagePerfPath(req.path)) {
    next();
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    next();
    return;
  }

  defaultJsonBodyParser(req, res, next);
};

/**
 * Rate-limit image telemetry before applying its small JSON transport limit,
 * then parse all other JSON with the normal API limit.
 */
export function createJsonBodyPipeline(
  imagePerfLimiter: RequestHandler = imagePerfRateLimit,
) {
  const router = Router();
  router.use('/images/perf', imagePerfLimiter, imagePerfJsonBodyParser);
  router.use(jsonBodyParser);
  return router;
};
