import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHelpText,
  parseArgs,
  runQueryLogs,
} from '../log-query-cli.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-archive-query-logs-cli-'));
  tempDirs.push(dir);
  return dir;
}

function writeLogFile(logDir: string, filename: string, lines: string[]): void {
  fs.writeFileSync(path.join(logDir, filename), `${lines.join('\n')}\n`);
}

describe('query-logs CLI', () => {
  it('parses supported flags and rejects invalid values', () => {
    expect(
      parseArgs([
        '--request-id', 'req-123',
        '--hours', '12',
        '--level', 'error',
        '--path', '/admin/letters/abc',
        '--text', 'opencv',
        '--limit', '5',
        '--log-dir', '/tmp/logs',
        '--json',
      ]),
    ).toEqual({
      requestId: 'req-123',
      hours: 12,
      level: 'error',
      path: '/admin/letters/abc',
      text: 'opencv',
      limit: 5,
      logDir: '/tmp/logs',
      json: true,
      help: false,
    });

    expect(() => parseArgs(['--hours', '0'])).toThrow('hours must be a positive number');
    expect(() => parseArgs(['--level', 'verbose'])).toThrow('Invalid level "verbose"');
    expect(() => parseArgs(['--limit'])).toThrow('Missing value for --limit');
  });

  it('prints help text without error', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runQueryLogs(['--help'], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      now: () => Date.parse('2026-03-10T12:00:00.000Z'),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toBe(buildHelpText());
  });

  it('filters by request id and supports JSON output', () => {
    const logDir = makeTempDir();
    writeLogFile(logDir, 'app-2026-03-10-10.log', [
      JSON.stringify({
        level: 30,
        time: Date.parse('2026-03-10T10:30:00.000Z'),
        requestId: 'req-keep',
        path: '/health',
        msg: 'Request completed',
      }),
      JSON.stringify({
        level: 50,
        time: Date.parse('2026-03-10T10:45:00.000Z'),
        requestId: 'req-keep',
        path: '/admin/letters/abc',
        msg: 'Request failed: detector offline',
      }),
      JSON.stringify({
        level: 40,
        time: Date.parse('2026-03-10T10:50:00.000Z'),
        requestId: 'req-drop',
        path: '/admin/letters/xyz',
        msg: 'Retry scheduled',
      }),
    ]);

    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runQueryLogs([
      '--log-dir', logDir,
      '--request-id', 'req-keep',
      '--hours', '3',
      '--limit', '1',
      '--json',
    ], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      now: () => Date.parse('2026-03-10T12:00:00.000Z'),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toMatchObject({
      requestId: 'req-keep',
      path: '/admin/letters/abc',
      msg: 'Request failed: detector offline',
    });
  });

  it('returns a non-zero exit code when no entries match', () => {
    const logDir = makeTempDir();
    writeLogFile(logDir, 'app-2026-03-10-08.log', [
      JSON.stringify({
        level: 30,
        time: Date.parse('2026-03-10T08:00:00.000Z'),
        requestId: 'req-old',
        path: '/health',
        msg: 'Request completed',
      }),
    ]);

    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runQueryLogs([
      '--log-dir', logDir,
      '--request-id', 'req-missing',
      '--hours', '1',
    ], {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      now: () => Date.parse('2026-03-10T12:00:00.000Z'),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`No matching log entries in ${logDir}`]);
  });
});
