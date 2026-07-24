import { describe, expect, it } from 'vitest';
import { formatLetterDate } from '../letter.dto.js';

type LetterDateInput = Parameters<typeof formatLetterDate>[0];

function letterDateInput(
  extractedDate: string | null,
  dateRaw: string,
): LetterDateInput {
  return { extractedDate, dateRaw } as LetterDateInput;
}

describe('letter DTO date formatting', () => {
  it('prefers the reviewed extracted date over filename identity', () => {
    expect(formatLetterDate(
      letterDateInput('1886-03-14', '18860315'),
    )).toBe('March 14th, 1886');
  });

  it('falls back to the partial filename date without JavaScript Date parsing', () => {
    expect(formatLetterDate(
      letterDateInput(null, '1947XXXX'),
    )).toBe('1947');
  });

  it('falls back when a stored extracted date is not canonical ISO', () => {
    expect(formatLetterDate(
      letterDateInput('not-a-date', '18860315'),
    )).toBe('March 15th, 1886');
  });
});
