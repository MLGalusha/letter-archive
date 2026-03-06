/**
 * Name parsing utilities for resync functionality.
 *
 * Handles extracting first names from full names for use in
 * narrative text (summary, hook, quote contexts) while preserving
 * full names for linked person records.
 */

export interface ParsedName {
  fullName: string;
  firstName: string;
  lastName: string | null;
}

/**
 * Parse a full name into components.
 *
 * @example
 * parseName('Molly Bowles') // { fullName: 'Molly Bowles', firstName: 'Molly', lastName: 'Bowles' }
 * parseName('Jimmie') // { fullName: 'Jimmie', firstName: 'Jimmie', lastName: null }
 * parseName('Mary Jane Watson') // { fullName: 'Mary Jane Watson', firstName: 'Mary', lastName: 'Watson' }
 */
function parseName(fullName: string | null): ParsedName | null {
  if (!fullName || !fullName.trim()) {
    return null;
  }

  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/);

  return {
    fullName: trimmed,
    firstName: parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : null,
  };
}

/**
 * Extract first name from a full name.
 * Returns the full name if it appears to be a single name.
 *
 * @example
 * getFirstName('Molly Bowles') // 'Molly'
 * getFirstName('Jimmie') // 'Jimmie'
 * getFirstName(null) // null
 */
export function getFirstName(fullName: string | null): string | null {
  const parsed = parseName(fullName);
  return parsed?.firstName || null;
}
