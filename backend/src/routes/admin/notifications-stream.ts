import { Router, type Response } from 'express';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  registerNotificationBroadcaster,
  type AdminNotification,
} from '../../services/notifications.js';
import { db, letters, collections } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  issueStreamToken as issueToken,
  consumeStreamToken as consumeToken,
  _clearStreamTokensForTests as _clearAllStreamTokens,
} from '../../services/stream-tokens.js';

const log = createLogger({ module: 'notifications-stream' });

const STREAM_NAMESPACE = 'notifications';

/**
 * Issue a one-time stream token for the notifications stream. Pass-through to
 * the shared stream-tokens service with this router's namespace baked in, so
 * existing callers (`notifications.ts` route, tests) don't need to change.
 */
export function issueStreamToken(userId: string, email: string): {
  token: string;
  expiresAt: number;
} {
  return issueToken(STREAM_NAMESPACE, userId, email);
}

function consumeStreamToken(token: string) {
  return consumeToken(STREAM_NAMESPACE, token);
}

/** Test-only: clear tokens across all namespaces. */
export function _clearStreamTokensForTests(): void {
  _clearAllStreamTokens();
}

// ============================================================================
// Client registry + broadcaster
// ============================================================================

interface StreamClient {
  id: string;
  res: Response;
  userId: string;
}

const clients = new Set<StreamClient>();

function writeEvent(res: Response, event: string, data: unknown): boolean {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (err) {
    log.warn({ err }, 'Failed to write SSE event — client likely disconnected');
    return false;
  }
}

/**
 * Look up a letter's collection code + date so we can show admins something
 * meaningful instead of a raw UUID. Returns null on any failure.
 */
async function resolveLetterLabel(letterId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({
        letterDate: letters.letterDate,
        dateRaw: letters.dateRaw,
        collectionCode: collections.collectionCode,
      })
      .from(letters)
      .leftJoin(collections, eq(letters.collectionId, collections.id))
      .where(eq(letters.id, letterId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const parts: string[] = [];
    if (row.collectionCode) parts.push(row.collectionCode);
    const date = row.letterDate ?? row.dateRaw;
    if (date) parts.push(date);
    return parts.length > 0 ? parts.join(' · ') : null;
  } catch (err) {
    log.warn({ err, letterId }, 'Failed to resolve letter label for SSE broadcast');
    return null;
  }
}

function pushToClients(notification: AdminNotification & { sourceLabel?: string }): void {
  if (clients.size === 0) return;
  for (const client of clients) {
    const ok = writeEvent(client.res, 'notification', notification);
    if (!ok) clients.delete(client);
  }
}

/**
 * Broadcast a notification to every connected client. For letter-typed
 * notifications, asynchronously resolves a friendly label (collection · date)
 * before pushing so the UI never has to render a raw UUID.
 */
function broadcast(notification: AdminNotification): void {
  if (clients.size === 0) return;
  if (notification.sourceType === 'letter' && notification.sourceId) {
    void resolveLetterLabel(notification.sourceId).then((label) => {
      pushToClients(label ? { ...notification, sourceLabel: label } : notification);
    });
    return;
  }
  pushToClients(notification);
}

/**
 * Wire the SSE broadcaster into the notifications service so that every
 * `notify()` call pushes to connected clients. Safe to call multiple times.
 */
export function initNotificationStreamBroadcaster(): void {
  registerNotificationBroadcaster(broadcast);
}

/** Test-only: read the current live client count. */
export function _getStreamClientCountForTests(): number {
  return clients.size;
}

// ============================================================================
// Route
// ============================================================================

const router = Router();

/**
 * GET /admin/notifications/stream?token=...
 *
 * Opens a Server-Sent Events connection. The `token` query param is a
 * single-use token issued via POST /admin/notifications/stream-token.
 */
router.get('/notifications/stream', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(401).json({ error: 'Missing stream token' });
    return;
  }

  const payload = consumeStreamToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired stream token' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders?.();

  // Tell the client to reconnect quickly if the connection drops
  res.write('retry: 3000\n\n');

  const client: StreamClient = {
    id: crypto.randomUUID(),
    res,
    userId: payload.userId,
  };
  clients.add(client);
  log.info({ clientId: client.id, userId: payload.userId, total: clients.size }, 'SSE client connected');

  writeEvent(res, 'connected', { at: new Date().toISOString() });

  // Heartbeat every 25s so proxies don't close the connection
  const heartbeat = setInterval(() => {
    const ok = writeEvent(res, 'heartbeat', { at: Date.now() });
    if (!ok) {
      clearInterval(heartbeat);
      clients.delete(client);
    }
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(client);
    log.info({ clientId: client.id, total: clients.size }, 'SSE client disconnected');
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
});

export default router;
