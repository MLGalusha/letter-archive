import type { LetterType, DateConfidence } from '../db/schema.js';

/**
 * Pattern: 003-18XX0706-L01-01.jpg
 * - collectionCode = first 3 digits (003)
 * - dateRaw = 8 chars YYYYMMDD with possible X (18XX0706)
 * - type = L/C/E
 * - typeSequence = 2 digits after type (01 => 1)
 * - pageNumber = final 2 digits (01 => 1)
 */
const FILENAME_PATTERN = /^(\d{3})-(\d{4}[\dX]{4})-([LCE])(\d{2})-(\d{2})\.\w+$/i;

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
  const pageNumber = parseInt(pageStr, 10);

  // Date parsing: if contains X, date is unknown
  const hasUnknownDate = dateRaw.includes('X');
  let letterDate: string | null = null;
  let dateConfidence: DateConfidence = 'unknown';

  if (!hasUnknownDate && dateRaw.length === 8) {
    const year = parseInt(dateRaw.slice(0, 4), 10);
    const month = parseInt(dateRaw.slice(4, 6), 10);
    const day = parseInt(dateRaw.slice(6, 8), 10);

    // Basic validation
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Format as ISO date string
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
