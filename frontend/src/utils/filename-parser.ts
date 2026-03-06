/**
 * Client-side filename parser for letter images.
 * Mirrors the backend logic in backend/src/services/filename-parser.ts
 *
 * Pattern: {collectionCode}-{dateRaw}-{type}{typeSequence}[-{pageNumber}].{ext}
 * Examples:
 *   003-18860314-L01-01.jpg  (full format with page number)
 *   005-19150813-L01.jpg     (single-page letter, no page number - defaults to 01)
 *   003-18XX0709-L01-03.jpg  (X's anywhere in date for unknown parts)
 */

// Accept any single letter A-Z as type for flexibility
export type LetterType = string;
export type DateConfidence = 'exact' | 'unknown' | 'inferred';

// Known types with human-readable names
export const KNOWN_TYPES: Record<string, string> = {
  'L': 'Letter',
  'P': 'Photo',
  'E': 'Ephemera',
  'V': 'Voice',
  'A': 'Article',
  'D': 'Diary',
  'C': 'Cover',
  'N': 'Card',
  'T': 'Telegram',
};

export interface ParsedFilename {
  collectionCode: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
  pageNumber: number;
  letterDate: string | null;
  dateConfidence: DateConfidence;
}

// Pattern breakdown:
// - (\d{3}): 3-digit collection code
// - ([\dX]{8}): 8-char date (digits or X for unknown anywhere)
// - ([A-Z]): any single letter type
// - (\d{2}): 2-digit type sequence
// - (?:-(\d{2}))?: optional page number (defaults to 1 if omitted)
const FILENAME_PATTERN = /^(\d{3})-([\dX]{8})-([A-Z])(\d{2})(?:-(\d{2}))?\.\w+$/i;

/**
 * Parse a filename into its components.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseFilename(filename: string): ParsedFilename | null {
  const match = filename.match(FILENAME_PATTERN);
  if (!match) return null;

  const [, collectionCode, dateRaw, typeStr, typeSeqStr, pageStr] = match;
  const type = typeStr.toUpperCase() as LetterType;
  const typeSequence = parseInt(typeSeqStr, 10);
  // Default to page 1 if no page number provided
  const pageNumber = pageStr ? parseInt(pageStr, 10) : 1;

  const hasUnknownDate = dateRaw.includes('X');
  let letterDate: string | null = null;
  let dateConfidence: DateConfidence = 'unknown';

  if (!hasUnknownDate && dateRaw.length === 8) {
    const year = parseInt(dateRaw.slice(0, 4), 10);
    const month = parseInt(dateRaw.slice(4, 6), 10);
    const day = parseInt(dateRaw.slice(6, 8), 10);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
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
 * Check if a filename matches the expected pattern.
 */
export function isValidFilename(filename: string): boolean {
  return FILENAME_PATTERN.test(filename);
}

/**
 * Get file extension from filename.
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot + 1).toLowerCase() : 'jpg';
}

/**
 * Update the type in a filename when moving between categories.
 */
export function updateFilenameType(filename: string, newType: LetterType): string {
  const parsed = parseFilename(filename);
  if (!parsed) {
    // If can't parse, try to replace type character if pattern looks close
    return filename.replace(/-[LPEVADCNT](\d{2})-/i, `-${newType}$1-`);
  }

  const ext = getFileExtension(filename);
  const typeSeqStr = String(parsed.typeSequence).padStart(2, '0');
  const pageStr = String(parsed.pageNumber).padStart(2, '0');
  return `${parsed.collectionCode}-${parsed.dateRaw}-${newType}${typeSeqStr}-${pageStr}.${ext}`;
}

/**
 * Map letter type to category name.
 */
export function typeToCategory(type: LetterType): 'letters' | 'covers' | 'extras' {
  switch (type.toUpperCase()) {
    case 'L': return 'letters';
    case 'C': return 'covers';
    default: return 'extras';
  }
}

/**
 * Get human-readable name for a type letter.
 */
export function getTypeName(type: LetterType): string {
  const upperType = type.toUpperCase();
  return KNOWN_TYPES[upperType] || upperType;
}
