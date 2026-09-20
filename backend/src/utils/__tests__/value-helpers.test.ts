import { describe, expect, it } from 'vitest';
import { serializeDate, uniqueStrings } from '../value-helpers.js';

describe('serializeDate', () => {
  it('returns null for missing dates and an ISO string for dates', () => {
    expect(serializeDate(null)).toBeNull();
    expect(serializeDate(undefined)).toBeNull();
    expect(serializeDate(new Date('2020-02-03T04:05:06.000Z'))).toBe(
      '2020-02-03T04:05:06.000Z',
    );
  });
});

describe('uniqueStrings', () => {
  it('trims values, skips empty entries, and preserves first-seen order', () => {
    expect(uniqueStrings([
      '  Ada Lovelace ',
      null,
      '   ',
      'Charles Babbage',
      'Ada Lovelace',
      undefined,
      ' Babbage ',
    ])).toEqual(['Ada Lovelace', 'Charles Babbage', 'Babbage']);
  });
});
