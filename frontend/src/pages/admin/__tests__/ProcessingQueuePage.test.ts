import { describe, expect, it } from 'vitest';
import { formatDateRaw, getBatchProgress } from '../ProcessingQueuePage';

describe('ProcessingQueuePage / formatDateRaw', () => {
  it('formats a full YYYYMMDD date with the full month name', () => {
    expect(formatDateRaw('19470921')).toBe('September 21, 1947');
  });

  it('uses full month names for every month (no abbreviations)', () => {
    const expected = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    expected.forEach((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(formatDateRaw(`1947${mm}15`)).toBe(`${name} 15, 1947`);
    });
  });

  it('falls back to "Month Year" when day is missing or invalid', () => {
    expect(formatDateRaw('194708')).toBe('August 1947');
  });

  it('falls back to just the year when only the year is present', () => {
    expect(formatDateRaw('1947')).toBe('1947');
  });

  it('returns the raw string when shorter than a year', () => {
    expect(formatDateRaw('47')).toBe('47');
  });
});

describe('ProcessingQueuePage / getBatchProgress', () => {
  it('counts completed, failed, and skipped work toward truthful progress', () => {
    expect(getBatchProgress({
      total: 4,
      completed: 2,
      failed: 1,
      skipped: 1,
    })).toEqual({ processed: 4, percent: 100 });
  });
});
