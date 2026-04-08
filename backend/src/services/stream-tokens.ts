import crypto from 'node:crypto';

// ============================================================================
// Stream tokens — short-lived, one-time credentials for EventSource.
//
// EventSource can't set custom headers, so we issue a short-lived opaque
// token via a normal authed POST and the client passes it as `?token=...`
// when opening the stream. Shared between notifications and processing
// streams (and any future SSE surface).
// ============================================================================

interface StreamToken {
  userId: string;
  email: string;
  expiresAt: number;
}

const STREAM_TOKEN_TTL_MS = 30_000;

// Each stream namespace has its own token bucket so tokens issued for the
// notifications stream can't be consumed by the processing stream.
const buckets = new Map<string, Map<string, StreamToken>>();

function bucket(namespace: string): Map<string, StreamToken> {
  let b = buckets.get(namespace);
  if (!b) {
    b = new Map();
    buckets.set(namespace, b);
  }
  return b;
}

/** Issue a one-time stream token within the given namespace. */
export function issueStreamToken(
  namespace: string,
  userId: string,
  email: string
): { token: string; expiresAt: number } {
  const b = bucket(namespace);
  const now = Date.now();
  for (const [key, tok] of b) {
    if (tok.expiresAt < now) b.delete(key);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now + STREAM_TOKEN_TTL_MS;
  b.set(token, { userId, email, expiresAt });
  return { token, expiresAt };
}

/**
 * Consume a token (single-use). Returns the payload or null if the token
 * is invalid, expired, or from a different namespace.
 */
export function consumeStreamToken(
  namespace: string,
  token: string
): { userId: string; email: string } | null {
  const b = bucket(namespace);
  const entry = b.get(token);
  if (!entry) return null;
  b.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, email: entry.email };
}

/** Test-only: clear every namespace. */
export function _clearStreamTokensForTests(): void {
  buckets.clear();
}
