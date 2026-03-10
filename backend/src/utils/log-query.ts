import fs from 'node:fs';
import path from 'node:path';
import {
  LOG_FILE_EXTENSION,
  LOG_FILE_PREFIX,
  LOG_DIR,
} from './logger.js';

export const LOG_LEVEL_VALUES = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type LogLevelName = keyof typeof LOG_LEVEL_VALUES;

export interface ParsedLogEntry {
  raw: Record<string, unknown>;
  time: number;
  level: number;
  levelLabel: LogLevelName;
  message: string;
  requestId?: string;
  path?: string;
}

export interface LogQueryOptions {
  requestId?: string;
  path?: string;
  text?: string;
  minLevel?: LogLevelName;
  sinceTime?: number;
  untilTime?: number;
  limit?: number;
}

const LOG_LEVEL_LABELS = new Map<number, LogLevelName>(
  Object.entries(LOG_LEVEL_VALUES).map(([label, value]) => [value, label as LogLevelName]),
);

function isLogFile(filename: string): boolean {
  return filename.startsWith(`${LOG_FILE_PREFIX}-`) && filename.endsWith(LOG_FILE_EXTENSION);
}

export function listLogFiles(logDir: string = LOG_DIR): string[] {
  if (!fs.existsSync(logDir)) {
    return [];
  }

  return fs.readdirSync(logDir)
    .filter(isLogFile)
    .sort()
    .map((entry) => path.join(logDir, entry));
}

export function parseLogLine(line: string): ParsedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const raw = parsed as Record<string, unknown>;
  const time = typeof raw.time === 'number' ? raw.time : Number.NaN;
  const level = typeof raw.level === 'number' ? raw.level : Number.NaN;
  const message = typeof raw.msg === 'string' ? raw.msg : '';
  const levelLabel = LOG_LEVEL_LABELS.get(level);

  if (!Number.isFinite(time) || !Number.isFinite(level) || !levelLabel) {
    return null;
  }

  return {
    raw,
    time,
    level,
    levelLabel,
    message,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : undefined,
    path: typeof raw.path === 'string' ? raw.path : undefined,
  };
}

export function readLogEntries(logDir: string = LOG_DIR): ParsedLogEntry[] {
  const entries: ParsedLogEntry[] = [];

  for (const filePath of listLogFiles(logDir)) {
    const contents = fs.readFileSync(filePath, 'utf8');
    for (const line of contents.split('\n')) {
      const parsed = parseLogLine(line);
      if (parsed) {
        entries.push(parsed);
      }
    }
  }

  return entries.sort((left, right) => left.time - right.time);
}

export function filterLogEntries(
  entries: ParsedLogEntry[],
  options: LogQueryOptions = {},
): ParsedLogEntry[] {
  const minLevel = options.minLevel ? LOG_LEVEL_VALUES[options.minLevel] : null;

  const filtered = entries.filter((entry) => {
    if (options.requestId && entry.requestId !== options.requestId) {
      return false;
    }

    if (options.path && entry.path !== options.path) {
      return false;
    }

    if (minLevel !== null && entry.level < minLevel) {
      return false;
    }

    if (typeof options.sinceTime === 'number' && entry.time < options.sinceTime) {
      return false;
    }

    if (typeof options.untilTime === 'number' && entry.time > options.untilTime) {
      return false;
    }

    if (options.text) {
      const haystack = JSON.stringify(entry.raw).toLowerCase();
      if (!haystack.includes(options.text.toLowerCase())) {
        return false;
      }
    }

    return true;
  });

  if (typeof options.limit === 'number' && options.limit > 0 && filtered.length > options.limit) {
    return filtered.slice(-options.limit);
  }

  return filtered;
}

export function formatLogEntry(entry: ParsedLogEntry): string {
  const timestamp = new Date(entry.time).toISOString();
  const requestId = entry.requestId ?? '-';
  const requestPath = entry.path ?? '-';
  return `${timestamp} ${entry.levelLabel.toUpperCase()} ${requestId} ${requestPath} ${entry.message}`;
}
