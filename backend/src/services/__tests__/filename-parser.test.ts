import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { parseFilename, isValidFilename } from '../filename-parser.js';
import { buildStoragePath, getAbsoluteStoragePath } from '../storage.js';

describe('filename parser', () => {
  it('parses complete filenames with explicit page numbers', () => {
    expect(parseFilename('003-19320706-L01-02.jpg')).toEqual({
      collectionCode: '003',
      dateRaw: '19320706',
      type: 'L',
      typeSequence: 1,
      pageNumber: 2,
      letterDate: '1932-07-06',
      dateConfidence: 'exact',
    });
  });

  it('defaults page number to one when omitted', () => {
    expect(parseFilename('003-19320706-L01.jpg')).toMatchObject({
      pageNumber: 1,
    });
  });

  it('treats unknown dates as unknown confidence', () => {
    expect(parseFilename('003-18XX0706-L01-01.jpg')).toMatchObject({
      letterDate: null,
      dateConfidence: 'unknown',
    });
  });

  it('rejects invalid calendar dates without crashing', () => {
    expect(parseFilename('003-19320231-L01-01.jpg')).toMatchObject({
      letterDate: null,
      dateConfidence: 'unknown',
    });
  });

  it('validates filename shape independently', () => {
    expect(isValidFilename('003-19320706-L01-01.jpg')).toBe(true);
    expect(isValidFilename('bad-filename.jpg')).toBe(false);
  });
});

describe('storage path helpers', () => {
  it('builds storage paths from parsed identity fields', () => {
    expect(buildStoragePath('003', '19320706', 'L', 1, '003-19320706-L01-01.jpg')).toBe(
      path.join(env.STORAGE_DIR, 'collections', '003', '19320706', 'L01', '003-19320706-L01-01.jpg'),
    );
  });

  it('resolves relative storage paths inside the allowed storage root', () => {
    const resolved = getAbsoluteStoragePath(
      path.join(env.STORAGE_DIR, 'collections', '003', '19320706', 'L01', 'page.jpg'),
    );

    expect(resolved).toContain(`${path.sep}backend${path.sep}storage${path.sep}collections${path.sep}003`);
  });

  it('rejects path traversal outside the storage root', () => {
    expect(() => getAbsoluteStoragePath('../package.json')).toThrow(
      'Path traversal detected: resolved path is outside storage directory',
    );
  });
});
