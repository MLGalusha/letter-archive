/** camelCase / snake_case to a readable label. */
export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

/** Render metadata compactly for primitives and as JSON for objects or arrays. */
export function formatMetadataValue(value: unknown): { display: string; isCode: boolean } {
  if (value === null || value === undefined) return { display: '—', isCode: false };
  if (typeof value === 'string') return { display: value, isCode: false };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { display: String(value), isCode: false };
  }
  if (Array.isArray(value)) {
    const allPrimitive = value.every((item) => typeof item !== 'object' || item === null);
    if (allPrimitive && value.length <= 8) {
      return { display: value.map((item) => String(item)).join(', '), isCode: false };
    }
    return { display: JSON.stringify(value, null, 2), isCode: true };
  }
  return { display: JSON.stringify(value, null, 2), isCode: true };
}
