import { describe, expect, it } from 'vitest';
import {
  isUnboundedDetectionRun,
  parseDetectLinesCliOptions,
} from '../detect-lines-cli-options.js';

describe('detect-lines CLI options', () => {
  it('reads credentials from the environment and normalizes the target URL', () => {
    expect(parseDetectLinesCliOptions([], {
      REMOTE_URL: 'https://archive.example.test///',
      ADMIN_EMAIL: 'admin@example.test',
      ADMIN_PASSWORD: 'secret',
    })).toEqual({
      url: 'https://archive.example.test',
      email: 'admin@example.test',
      password: 'secret',
      debug: false,
      dryRun: false,
    });
  });

  it('accepts bounded and read-only command-line options', () => {
    expect(parseDetectLinesCliOptions([
      '--url',
      'http://localhost:3002/',
      '--email',
      'dev@localhost.test',
      '--password',
      'dev',
      '--limit',
      '5',
      '--page-id',
      'page-123',
      '--debug',
      '--dry-run',
      '--rotations',
      '0,90,270',
    ], {})).toEqual({
      url: 'http://localhost:3002',
      email: 'dev@localhost.test',
      password: 'dev',
      debug: true,
      dryRun: true,
      limit: 5,
      pageId: 'page-123',
      rotationsDegrees: [0, 90, 270],
    });
  });

  it.each([
    [['--limit', '0'], '--limit must be a positive integer'],
    [['--limit', '1.5'], '--limit must be a positive integer'],
    [['--limit'], 'Option --limit requires a value'],
    [['--unknown'], 'Unknown option: --unknown'],
    [['unexpected'], 'Unexpected positional argument: unexpected'],
    [['--rotations'], 'Option --rotations requires a value'],
  ])('rejects unsafe or malformed options', (argv, message) => {
    expect(() => parseDetectLinesCliOptions(argv, {})).toThrow(message);
  });

  it.each([
    '0,90,90',
    '90,270',
    '0,180,270',
    '0,45,90,270',
    '90,0,270',
    '0,90',
    '0,90,270,360',
  ])('rejects unsupported rotation profile %s', (profile) => {
    expect(() => parseDetectLinesCliOptions([
      '--rotations',
      profile,
    ], {})).toThrow(
      '--rotations must be exactly 0,90,270 in that order',
    );
  });

  it('omits rotationsDegrees when the rotation flag is absent', () => {
    const options = parseDetectLinesCliOptions([], {});

    expect(options).not.toHaveProperty('rotationsDegrees');
  });

  it('recognizes only runs without either bound as unbounded', () => {
    expect(isUnboundedDetectionRun({})).toBe(true);
    expect(isUnboundedDetectionRun({ limit: 1 })).toBe(false);
    expect(isUnboundedDetectionRun({ pageId: 'page-1' })).toBe(false);
  });
});
