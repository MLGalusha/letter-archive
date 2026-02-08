import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Allow overriding log level via environment variable
// Levels: trace, debug, info, warn, error, fatal
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  return isDev ? 'debug' : 'info';
};

export const logger = pino({
  level: getLogLevel(),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    env: process.env.NODE_ENV || 'development',
  },
});

// Create child loggers for different areas of the application
export const createLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};

// Helper to measure operation duration
export const withTiming = async <T>(
  log: pino.Logger,
  operation: string,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {}
): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    log.debug({ ...context, operation, duration, success: true }, `${operation} completed`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, operation, duration, success: false, err: error }, `${operation} failed`);
    throw error;
  }
};

// Timing thresholds for warnings (in ms)
export const TIMING_THRESHOLDS = {
  DB_QUERY: 500,
  OPENAI_API: 30000,
  FILE_UPLOAD: 10000,
  IMAGE_STREAM: 5000,
  REQUEST_TOTAL: 3000,
} as const;

// Log slow operations
export const logIfSlow = (
  log: pino.Logger,
  operation: string,
  duration: number,
  threshold: number,
  context: Record<string, unknown> = {}
) => {
  if (duration > threshold) {
    log.warn(
      { ...context, operation, duration, threshold, slow: true },
      `Slow ${operation}: ${duration}ms exceeds threshold of ${threshold}ms`
    );
  }
};

export type Logger = pino.Logger;
