import { describe, expect, it } from 'vitest';
import { formatProcessingDate } from '../ProcessingQueue/formatters';

describe('formatProcessingDate', () => {
  it('formats a full YYYYMMDD date with the full month name', () => {
    expect(formatProcessingDate('19470921')).toBe('September 21, 1947');
  });

  it('uses full month names for every month (no abbreviations)', () => {
    const expected = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    expected.forEach((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(formatProcessingDate(`1947${mm}15`)).toBe(`${name} 15, 1947`);
    });
  });

  it('falls back to "Month Year" when day is missing or invalid', () => {
    expect(formatProcessingDate('194708')).toBe('August 1947');
  });

  it('falls back to just the year when only the year is present', () => {
    expect(formatProcessingDate('1947')).toBe('1947');
  });

  it('returns the raw string when shorter than a year', () => {
    expect(formatProcessingDate('47')).toBe('47');
  });
});
