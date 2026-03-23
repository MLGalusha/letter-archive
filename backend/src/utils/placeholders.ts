/**
 * Placeholder Constants & Utilities
 *
 * When AI cannot determine the sender or recipient name, it uses
 * guillemet-wrapped placeholders: «SENDER» and «RECIPIENT».
 * These get replaced when a human reviewer provides the real name.
 */

export const PLACEHOLDERS = {
  SENDER: '«SENDER»',
  RECIPIENT: '«RECIPIENT»',
} as const;

export const PLACEHOLDER_REGEX = /«([A-Za-z_]+)»/gi;

/** Check if a string contains any placeholder tokens */
export function hasPlaceholders(text: string): boolean {
  PLACEHOLDER_REGEX.lastIndex = 0;
  return PLACEHOLDER_REGEX.test(text);
}

/** Check if a specific value is a placeholder */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return value === PLACEHOLDERS.SENDER || value === PLACEHOLDERS.RECIPIENT;
}

/** Replace all occurrences of a placeholder in a string */
export function replacePlaceholder(text: string, placeholder: string, replacement: string): string {
  // Replace the guillemet placeholder token itself
  let result = text.split(placeholder).join(replacement);

  if (placeholder === PLACEHOLDERS.SENDER) {
    // Replace "the sender's" with possessive (check before "the sender" to avoid partial match)
    result = result.replace(/\bthe sender's\b/gi, `${replacement}'s`);
    // Replace "the sender" / "The sender" with the name
    result = result.replace(/\bthe sender\b/gi, (match) => {
      return match[0] === 'T' ? replacement : replacement;
    });
  }

  if (placeholder === PLACEHOLDERS.RECIPIENT) {
    // Replace "the recipient's" with possessive
    result = result.replace(/\bthe recipient's\b/gi, `${replacement}'s`);
    // Replace "the recipient" / "The recipient"
    result = result.replace(/\bthe recipient\b/gi, (match) => {
      return match[0] === 'T' ? replacement : replacement;
    });
  }

  return result;
}

/** Validate that no orphaned placeholders remain after propagation */
export function findOrphanedPlaceholders(text: string): string[] {
  PLACEHOLDER_REGEX.lastIndex = 0;
  const matches: string[] = [];
  let match;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}
