import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const isDev = !isProduction;
const ONE_HOUR_MS = 60 * 60 * 1000;
const PROCESS_LOGGING_FLAG = Symbol.for('letter-archive.process-logging-installed');

export const LOG_FILE_PREFIX = 'app';
export const LOG_FILE_EXTENSION = '.log';
export const DEFAULT_LOG_RETENTION_HOURS = 24 * 7;
export const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

const LOG_FILENAME_PATTERN = /^app-(\d{4})-(\d{2})-(\d{2})-(\d{2})\.log$/;

function ensureLogDir(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Allow overriding log level via environment variable.
// Levels: trace, debug, info, warn, error, fatal
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  return isDev ? 'debug' : 'info';
};

export function getLogRetentionHours(): number {
  const raw = Number(process.env.LOG_RETENTION_HOURS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_LOG_RETENTION_HOURS;
}

function shouldLogToFiles(): boolean {
  if (process.env.LOG_TO_FILES === 'true') {
    return true;
  }
  if (process.env.LOG_TO_FILES === 'false') {
    return false;
  }
  return !isProduction;
}

export function formatLogFileHour(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day}-${hour}`;
}

export function getLogFilePath(logDir: string, date: Date): string {
  return path.join(logDir, `${LOG_FILE_PREFIX}-${formatLogFileHour(date)}${LOG_FILE_EXTENSION}`);
}

function parseLogFilenameTimestamp(filename: string): number | null {
  const match = filename.match(LOG_FILENAME_PATTERN);
  if (!match) return null;

  const [, year, month, day, hour] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    0,
    0,
    0,
  );

  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function purgeExpiredLogs(
  logDir: string,
  now: Date = new Date(),
  retentionHours: number = getLogRetentionHours(),
): string[] {
  ensureLogDir(logDir);

  const cutoff = now.getTime() - (retentionHours * ONE_HOUR_MS);
  const removed: string[] = [];

  for (const entry of fs.readdirSync(logDir)) {
    const timestamp = parseLogFilenameTimestamp(entry);
    if (timestamp === null || timestamp >= cutoff) {
      continue;
    }

    const absolutePath = path.join(logDir, entry);
    fs.rmSync(absolutePath, { force: true });
    removed.push(absolutePath);
  }

  return removed;
}

/**
 * Async version of purgeExpiredLogs — avoids blocking the event loop.
 * Use this from runtime code; the sync version is kept for startup/tests.
 */
export async function purgeExpiredLogsAsync(
  logDir: string,
  now: Date = new Date(),
  retentionHours: number = getLogRetentionHours(),
): Promise<string[]> {
  await fsp.mkdir(logDir, { recursive: true });

  const cutoff = now.getTime() - (retentionHours * ONE_HOUR_MS);
  const removed: string[] = [];
  const entries = await fsp.readdir(logDir);

  for (const entry of entries) {
    const timestamp = parseLogFilenameTimestamp(entry);
    if (timestamp === null || timestamp >= cutoff) continue;

    const absolutePath = path.join(logDir, entry);
    await fsp.rm(absolutePath, { force: true });
    removed.push(absolutePath);
  }

  return removed;
}

class HourlyRotatingLogStream extends Writable {
  private currentHourKey: string | null = null;
  private currentStream: fs.WriteStream | null = null;
  private nextCleanupAt = 0;

  constructor(
    private readonly logDir: string,
    private readonly retentionHours: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
    ensureLogDir(logDir);
    this.nextCleanupAt = this.now().getTime() + ONE_HOUR_MS;
    this.runCleanup();
  }

  private ensureActiveStream(): fs.WriteStream {
    const currentDate = this.now();
    const nextHourKey = formatLogFileHour(currentDate);

    if (this.currentStream && this.currentHourKey === nextHourKey) {
      return this.currentStream;
    }

    this.currentStream?.end();
    this.currentHourKey = nextHourKey;
    this.currentStream = fs.createWriteStream(
      getLogFilePath(this.logDir, currentDate),
      { flags: 'a' },
    );

    return this.currentStream;
  }

  private runCleanup(): void {
    this.nextCleanupAt = this.now().getTime() + ONE_HOUR_MS;
    purgeExpiredLogsAsync(this.logDir, this.now(), this.retentionHours).catch(
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[logger] failed to purge expired logs: ${message}`);
      },
    );
  }

  override _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const stream = this.ensureActiveStream();
      const shouldCleanup = this.now().getTime() >= this.nextCleanupAt;
      stream.write(chunk, encoding, (error) => {
        if (!error && shouldCleanup) {
          this.runCleanup();
        }
        callback(error ?? null);
      });
    } catch (error) {
      callback(error as Error);
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.currentStream) {
      callback();
      return;
    }

    this.currentStream.end(() => callback());
  }
}

const retentionHours = getLogRetentionHours();
const enableFileLogging = shouldLogToFiles();
const fileStream = enableFileLogging
  ? new HourlyRotatingLogStream(LOG_DIR, retentionHours)
  : null;

// Cloud Logging severity mapping — maps pino numeric levels to GCP severity strings.
// Only applied in production; dev uses pino-pretty which shows level names natively.
const PINO_TO_SEVERITY: Record<number, string> = {
  10: 'DEBUG',    // trace
  20: 'DEBUG',    // debug
  30: 'INFO',     // info
  40: 'WARNING',  // warn
  50: 'ERROR',    // error
  60: 'CRITICAL', // fatal
};

// Multi-destination: both console and hourly-rotated JSON log files.
export const logger = pino({
  level: getLogLevel(),
  // Cloud Logging reads "message" by default; pino uses "msg".
  messageKey: isProduction ? 'message' : 'msg',
  base: {
    env: process.env.NODE_ENV || 'development',
    service: process.env.LOG_SERVICE || 'backend',
  },
  formatters: {
    level(label, number) {
      // In production, emit "severity" for Cloud Logging instead of numeric level
      if (isProduction) {
        return { severity: PINO_TO_SEVERITY[number] || 'DEFAULT' };
      }
      return { level: number };
    },
  },
  // Omit pid/hostname in production — Cloud Run already provides instance metadata
  ...(isProduction ? { base: { service: process.env.LOG_SERVICE || 'backend' } } : {}),
}, pino.multistream([
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
  ...(fileStream ? [{ stream: fileStream }] : []),
]));

// Create child loggers for different areas of the application.
export const createLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};

export function installProcessLogging(log: pino.Logger = logger): void {
  const globalProcess = process as NodeJS.Process & {
    [PROCESS_LOGGING_FLAG]?: boolean;
  };

  if (globalProcess[PROCESS_LOGGING_FLAG]) {
    return;
  }

  globalProcess[PROCESS_LOGGING_FLAG] = true;

  process.on('warning', (warning) => {
    log.warn(
      {
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      },
      'Process warning',
    );
  });

  process.on('unhandledRejection', (reason) => {
    log.error(
      {
        reason,
      },
      'Unhandled promise rejection',
    );
  });

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    log.fatal(
      {
        err: error,
        origin,
      },
      'Uncaught exception',
    );
  });
}

installProcessLogging(logger);

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
  context: Record<string, unknown> = {},
) => {
  if (duration > threshold) {
    log.warn(
      { ...context, operation, duration, threshold, slow: true },
      `Slow ${operation}: ${duration}ms exceeds threshold of ${threshold}ms`,
    );
  }
};

export type Logger = pino.Logger;
