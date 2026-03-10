import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_RETENTION_HOURS,
  formatLogFileHour,
  getLogFilePath,
  purgeExpiredLogs,
} from '../logger.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-archive-logs-'));
  tempDirs.push(dir);
  return dir;
}

describe('logger helpers', () => {
  it('formats hourly log file keys in local time', () => {
    expect(formatLogFileHour(new Date(2026, 2, 9, 16, 30, 0))).toBe('2026-03-09-16');
  });

  it('builds log paths using the hourly filename convention', () => {
    const logDir = '/tmp/letter-archive';
    expect(getLogFilePath(logDir, new Date(2026, 2, 9, 7, 0, 0))).toBe(
      path.join(logDir, 'app-2026-03-09-07.log'),
    );
  });

  it('removes only log files older than the retention window', () => {
    const logDir = makeTempDir();
    const now = new Date(2026, 2, 9, 16, 0, 0);

    const staleLog = path.join(logDir, 'app-2026-03-01-12.log');
    const freshLog = path.join(logDir, 'app-2026-03-09-10.log');
    const ignoredFile = path.join(logDir, 'notes.txt');

    fs.writeFileSync(staleLog, 'old');
    fs.writeFileSync(freshLog, 'fresh');
    fs.writeFileSync(ignoredFile, 'keep');

    const removed = purgeExpiredLogs(logDir, now, 24);

    expect(removed).toEqual([staleLog]);
    expect(fs.existsSync(staleLog)).toBe(false);
    expect(fs.existsSync(freshLog)).toBe(true);
    expect(fs.existsSync(ignoredFile)).toBe(true);
  });

  it('falls back to a seven day retention window when no override is set', () => {
    expect(DEFAULT_LOG_RETENTION_HOURS).toBe(168);
  });
});
