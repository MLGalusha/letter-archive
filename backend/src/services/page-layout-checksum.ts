import { createHash } from 'node:crypto';

function canonicalJson(value: unknown, inArray = false): string {
  if (value === undefined) {
    if (inArray) return 'null';
    throw new TypeError('Undefined is not a canonical JSON value');
  }
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('Value is not serializable as canonical JSON');
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, true)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    // Canonical digests must not depend on the host's ICU locale. Relational
    // string comparison is deterministic ECMAScript UTF-16 code-unit order.
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

/**
 * Hashes a JSON document independently of object insertion order.
 *
 * Object properties with undefined values and undefined array entries follow
 * JSON.stringify semantics so the digest is stable across the application
 * value and the JSONB representation persisted by the database driver.
 */
export function canonicalJsonChecksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function pageLayoutChecksum(value: unknown): string {
  return canonicalJsonChecksum(value);
}
