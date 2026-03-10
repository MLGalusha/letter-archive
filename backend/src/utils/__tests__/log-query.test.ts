import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  filterLogEntries,
  formatLogEntry,
  listLogFiles,
  parseLogLine,
  readLogEntries,
} from '../log-query.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-archive-log-query-'));
  tempDirs.push(dir);
  return dir;
}

function writeLogFile(logDir: string, filename: string, lines: string[]): void {
  fs.writeFileSync(path.join(logDir, filename), `${lines.join('\n')}\n`);
}

describe('log query helpers', () => {
  it('parses valid NDJSON log lines and ignores invalid ones', () => {
    expect(
      parseLogLine(
        JSON.stringify({
          level: 30,
          time: Date.parse('2026-03-09T17:00:00.000Z'),
          requestId: 'req-1',
          path: '/health',
          msg: 'Request completed',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        levelLabel: 'info',
        requestId: 'req-1',
        path: '/health',
        message: 'Request completed',
      }),
    );
    expect(parseLogLine('not-json')).toBeNull();
    expect(parseLogLine('')).toBeNull();
  });

  it('lists matching log files in chronological filename order', () => {
    const logDir = makeTempDir();
    writeLogFile(logDir, 'app-2026-03-09-16.log', []);
    writeLogFile(logDir, 'app-2026-03-09-15.log', []);
    writeLogFile(logDir, 'notes.txt', ['ignore']);

    expect(listLogFiles(logDir)).toEqual([
      path.join(logDir, 'app-2026-03-09-15.log'),
      path.join(logDir, 'app-2026-03-09-16.log'),
    ]);
  });

  it('reads and filters entries by request id, severity, text, and limit', () => {
    const logDir = makeTempDir();
    writeLogFile(logDir, 'app-2026-03-09-15.log', [
      JSON.stringify({
        level: 30,
        time: Date.parse('2026-03-09T15:01:00.000Z'),
        requestId: 'req-1',
        path: '/health',
        msg: 'Request completed',
      }),
      JSON.stringify({
        level: 50,
        time: Date.parse('2026-03-09T15:05:00.000Z'),
        requestId: 'req-2',
        path: '/admin/letters/1',
        msg: 'Request failed: database offline',
      }),
    ]);
    writeLogFile(logDir, 'app-2026-03-09-16.log', [
      'not-json',
      JSON.stringify({
        level: 40,
        time: Date.parse('2026-03-09T16:00:00.000Z'),
        requestId: 'req-2',
        path: '/admin/letters/1',
        msg: 'Retry scheduled',
      }),
    ]);

    const entries = readLogEntries(logDir);
    expect(entries).toHaveLength(3);

    expect(
      filterLogEntries(entries, {
        requestId: 'req-2',
      }).map((entry) => entry.message),
    ).toEqual(['Request failed: database offline', 'Retry scheduled']);

    expect(
      filterLogEntries(entries, {
        minLevel: 'error',
      }).map((entry) => entry.levelLabel),
    ).toEqual(['error']);

    expect(
      filterLogEntries(entries, {
        text: 'retry',
        limit: 1,
      }).map((entry) => entry.message),
    ).toEqual(['Retry scheduled']);
  });

  it('formats a concise human-readable summary line', () => {
    const formatted = formatLogEntry({
      raw: {},
      time: Date.parse('2026-03-09T17:32:01.000Z'),
      level: 50,
      levelLabel: 'error',
      message: 'Request failed: opencv offline',
      requestId: 'req-500',
      path: '/letters/pages/page-1/detect-lines',
    });

    expect(formatted).toBe(
      '2026-03-09T17:32:01.000Z ERROR req-500 /letters/pages/page-1/detect-lines Request failed: opencv offline',
    );
  });
});
