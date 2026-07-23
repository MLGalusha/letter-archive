const REDACTED_QUERY_VALUE = '[REDACTED]';
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'admintoken',
  'access_token',
  'accesstoken',
  'authorization',
  'jwt',
]);

export function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase());
}

export function redactSensitiveQuery(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveQuery);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveQueryKey(key)
        ? REDACTED_QUERY_VALUE
        : redactSensitiveQuery(nestedValue),
    ]),
  );
}
