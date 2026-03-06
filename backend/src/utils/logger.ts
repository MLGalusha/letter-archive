import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

// Log file path - backend/logs/app.log
const logDir = path.join(__dirname, '../../logs');
const logFile = path.join(logDir, 'app.log');

// Ensure logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Allow overriding log level via environment variable
// Levels: trace, debug, info, warn, error, fatal
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  return isDev ? 'debug' : 'info';
};

// Create file stream for logging
const fileStream = fs.createWriteStream(logFile, { flags: 'a' });

// Multi-destination: both console (pretty) and file (JSON)
export const logger = pino({
  level: getLogLevel(),
  base: {
    env: process.env.NODE_ENV || 'development',
  },
}, pino.multistream([
  // Console output with pretty printing in dev
  {
    stream: isDev
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        })
      : process.stdout,
  },
  // File output (JSON format for easy parsing)
  { stream: fileStream },
]));

// Create child loggers for different areas of the application
export const createLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
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
