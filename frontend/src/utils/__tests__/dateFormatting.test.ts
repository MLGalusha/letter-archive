import { describe, expect, it } from 'vitest';
import { formatDate } from '../dateFormatting';

describe('formatDate', () => {
  it('formats a full ISO datetime string', () => {
    expect(formatDate('2026-03-30T12:00:00Z')).toBe('March 30, 2026');
  });

  it('handles single-digit days correctly', () => {
    expect(formatDate('2026-01-05T12:00:00Z')).toBe('January 5, 2026');
    expect(formatDate('2026-06-01T12:00:00Z')).toBe('June 1, 2026');
  });

  it('handles edge-of-year dates', () => {
    expect(formatDate('2025-12-31T12:00:00Z')).toBe('December 31, 2025');
    expect(formatDate('2026-01-01T12:00:00Z')).toBe('January 1, 2026');
  });

  it('returns "Invalid Date" for empty string', () => {
    expect(formatDate('')).toBe('Invalid Date');
  });

  it('returns "Invalid Date" for malformed input', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date');
  });
});
