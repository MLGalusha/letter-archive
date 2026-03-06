import type { LetterType, DateConfidence } from '../db/schema.js';

/**
 * Pattern: CCC-YYYYMMDD-TII-PP.jpg or CCC-YYYYMMDD-TII.jpg
 * - collectionCode = first 3 digits (003)
 * - dateRaw = 8 chars YYYYMMDD with possible X anywhere (18XX0706, XXXXXXXX, etc.)
 * - type = any single letter A-Z (L=letter, C=envelope, E=extra, P=postcard, T=telegram, etc.)
 * - typeSequence = 2 digits after type (01 => 1)
 * - pageNumber = optional final 2 digits (01 => 1), defaults to 1 if omitted
 */
const FILENAME_PATTERN = /^(\d{3})-([\dX]{8})-([A-Z])(\d{2})(?:-(\d{2}))?\.\w+$/i;

export interface ParsedFilename {
  collectionCode: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
  pageNumber: number;
  letterDate: string | null; // ISO date string (YYYY-MM-DD) or null
  dateConfidence: DateConfidence;
}

export function parseFilename(filename: string): ParsedFilename | null {
  const match = filename.match(FILENAME_PATTERN);
  if (!match) {
    return null;
  }

  const [, collectionCode, dateRaw, typeStr, typeSeqStr, pageStr] = match;
  const type = typeStr.toUpperCase() as LetterType;
  const typeSequence = parseInt(typeSeqStr, 10);
  // Default to page 1 if no page number provided
  const pageNumber = pageStr ? parseInt(pageStr, 10) : 1;

  // Date parsing: if contains X, date is unknown
  const hasUnknownDate = dateRaw.includes('X');
  let letterDate: string | null = null;
  let dateConfidence: DateConfidence = 'unknown';

  if (!hasUnknownDate && dateRaw.length === 8) {
    const year = parseInt(dateRaw.slice(0, 4), 10);
    const month = parseInt(dateRaw.slice(4, 6), 10);
    const day = parseInt(dateRaw.slice(6, 8), 10);

    // Validate using Date constructor to reject invalid dates like Feb 31
    const testDate = new Date(year, month - 1, day);
    if (
      testDate.getFullYear() === year &&
      testDate.getMonth() === month - 1 &&
      testDate.getDate() === day
    ) {
      letterDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dateConfidence = 'exact';
    }
  }

  return {
    collectionCode,
    dateRaw,
    type,
    typeSequence,
    pageNumber,
    letterDate,
    dateConfidence,
  };
}

/**
 * Validates that a filename matches the expected pattern.
 */
export function isValidFilename(filename: string): boolean {
  return FILENAME_PATTERN.test(filename);
}
