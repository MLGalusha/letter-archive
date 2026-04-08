import { Router, type Response } from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../utils/logger.js';
import {
  issueStreamToken as issueToken,
  consumeStreamToken as consumeToken,
} from '../../services/stream-tokens.js';
import { registerBroadcaster } from '../../services/processes/runner.js';
import type { ProcessingEvent } from '../../services/processes/types.js';

const log = createLogger({ module: 'processing-stream' });

const STREAM_NAMESPACE = 'processing';

export function issueProcessingStreamToken(userId: string, email: string) {
  return issueToken(STREAM_NAMESPACE, userId, email);
}

function consumeStreamToken(token: string) {
  return consumeToken(STREAM_NAMESPACE, token);
}

// ============================================================================
// Client registry
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

function broadcast(event: ProcessingEvent): void {
  if (clients.size === 0) return;
  for (const client of clients) {
    const ok = writeEvent(client.res, 'processing', event);
    if (!ok) clients.delete(client);
  }
}

/** Wire the runner → SSE broadcaster. Safe to call multiple times. */
let broadcasterInitialized = false;
export function initProcessingStreamBroadcaster(): void {
  if (broadcasterInitialized) return;
  registerBroadcaster(broadcast);
  broadcasterInitialized = true;
}

/** Test-only: current connected client count. */
export function _getProcessingStreamClientCountForTests(): number {
  return clients.size;
}

// ============================================================================
// Route
// ============================================================================

const router = Router();

router.get('/processing/stream', (req, res) => {
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const client: StreamClient = {
    id: crypto.randomUUID(),
    res,
    userId: payload.userId,
  };
  clients.add(client);
  log.info(
    { clientId: client.id, userId: payload.userId, total: clients.size },
    'Processing SSE client connected'
  );

  writeEvent(res, 'connected', { at: new Date().toISOString() });

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
    log.info({ clientId: client.id, total: clients.size }, 'Processing SSE client disconnected');
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
});

export default router;
