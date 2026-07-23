import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { createLogger, logIfSlow, TIMING_THRESHOLDS, type Logger } from '../utils/logger.js';
import { redactSensitiveQuery } from '../utils/log-redaction.js';

// Extend Express Request to include logger and requestId
declare global {
  namespace Express {
    interface Request {
      log: Logger;
      requestId: string;
    }
  }
}

// Paths that are polled frequently - only log errors/slow requests for these
const QUIET_PATHS = [
  '/admin/processing/status',
];

// Paths to completely skip logging (health checks, etc.)
const SKIP_PATHS: string[] = [
  // Add paths like '/health' if needed
];

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  const start = Date.now();

  // Check if this is a quiet or skip path
  const isQuietPath = QUIET_PATHS.includes(req.path);
  const isSkipPath = SKIP_PATHS.includes(req.path);

  // Cloud Trace header: extract trace ID for log correlation in Cloud Logging.
  // Format: "X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE"
  const traceHeader = req.get('x-cloud-trace-context');
  const traceId = traceHeader?.split('/')[0];
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const traceContext = traceId && gcpProject
    ? { 'logging.googleapis.com/trace': `projects/${gcpProject}/traces/${traceId}` }
    : {};

  // Create a child logger with request context
  const log = createLogger({
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent'),
    ...traceContext,
  });

  // Attach to request for use in route handlers
  req.log = log;
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  if (typeof res.json === 'function') {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (
        res.statusCode >= 400
        && body
        && typeof body === 'object'
        && !Array.isArray(body)
        && !('requestId' in (body as Record<string, unknown>))
      ) {
        return originalJson({
          ...(body as Record<string, unknown>),
          requestId,
        });
      }

      return originalJson(body);
    }) as Response['json'];
  }

  // Skip logging entirely for skip paths
  if (isSkipPath) {
    next();
    return;
  }

  // Log incoming request (skip for quiet paths)
  if (!isQuietPath) {
    log.debug(
      {
        query: Object.keys(req.query).length > 0
          ? redactSensitiveQuery(req.query)
          : undefined,
        contentLength: req.get('content-length'),
      },
      'Request started'
    );
  }

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;
    const isSlow = duration > TIMING_THRESHOLDS.REQUEST_TOTAL;

    // For quiet paths, only log if there's an error or it's slow
    if (isQuietPath && !isError && !isSlow) {
      return;
    }

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    log[level](
      {
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('content-length'),
        ip: req.ip,
      },
      'Request completed'
    );

    // Warn if request took too long
    if (isSlow) {
      logIfSlow(log, 'request', duration, TIMING_THRESHOLDS.REQUEST_TOTAL);
    }
  });

  next();
};
